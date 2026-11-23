// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import { type WalletAccountTransaction } from '@suite-common/wallet-types';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { type AnonymitySet } from '@trezor/blockchain-link';
import {
    COINJOIN_PAYMENT_MIN_AMOUNT,
    type CoinjoinPayment,
    type CoinjoinPaymentAttempt,
} from '@trezor/coinjoin';
import { COINJOIN_PAYMENT_MAX_INPUTS } from '@trezor/coinjoin/src/constants';
import { readOutpoint } from '@trezor/coinjoin/src/utils/coordinatorUtils';
import { getPaymentDestination } from '@trezor/coinjoin/src/utils/paymentUtils';
import { getCoinjoinNetwork } from '@trezor/coinjoin/src/utils/settingsUtils';
import { type AccountUtxo } from '@trezor/connect';

import {
    type CoinjoinAccount,
    type CoinjoinAccountPayment,
    type CoinjoinSession,
} from './coinjoinTypes';
import { type CoinjoinSymbol } from './config';

// Sats that stay in the account after a payment, so that no remainder too small to mix is left.
const COINJOIN_PAYMENT_ACCOUNT_RESERVE = 10_000;

export type CoinjoinPaymentStatus =
    | 'paid'
    | 'cancelled'
    | 'sending'
    | 'blocked'
    | 'unavailable'
    | 'paused'
    | 'needs-restart'
    | 'paying'
    | 'waiting';

export type CoinjoinPaymentError =
    | 'COINJOIN_RUNNING'
    | 'PAYMENT_EXISTS'
    | 'NO_PRIVATE_COINS'
    | 'INVALID_ADDRESS'
    | 'OWN_ADDRESS'
    | 'ADDRESS_IN_USE'
    | 'INVALID_AMOUNT'
    | 'AMOUNT_TOO_LOW'
    | 'AMOUNT_TOO_HIGH';

type Payment = CoinjoinAccountPayment | undefined;

const isConfirmedTransaction = ({ blockHeight }: WalletAccountTransaction) =>
    (blockHeight ?? 0) > 0;

export const isCoinjoinPaymentUnpaid = (payment: Payment): payment is CoinjoinAccountPayment =>
    !!payment && !payment.paidTxid;

// The payment the client should make: not paid, cancelled or refused by the coordinator.
export const isCoinjoinPaymentPending = (payment: Payment): payment is CoinjoinAccountPayment =>
    isCoinjoinPaymentUnpaid(payment) && !payment.isCancelled && !payment.isBlocked;

const getIsAnchorSpentBy = (anchor: string) => {
    const { hash, index } = readOutpoint(anchor);

    // Blockbook leaves out the index 0 of an input.
    return (transaction: WalletAccountTransaction) =>
        transaction.details.vin.some(vin => vin.txid === hash && (vin.vout ?? 0) === index);
};

/**
 * Whether a transaction makes the payment, by the rule of the device: it spends the anchor and
 * pays exactly the amount to the payee.
 */
export const getIsCoinjoinPaymentTx = ({ address, amount, anchor }: CoinjoinPayment) => {
    const isAnchorSpentBy = getIsAnchorSpentBy(anchor);
    const value = String(amount);

    return (transaction: WalletAccountTransaction) =>
        isAnchorSpentBy(transaction) &&
        transaction.details.vout.some(
            vout => vout.value === value && !!vout.addresses?.includes(address),
        );
};

export const getCoinjoinPaymentAnchorUtxo = (
    { anchor }: CoinjoinPayment,
    utxos: AccountUtxo[] | undefined,
) => utxos?.find(utxo => !!utxo.confirmations && getUtxoOutpoint(utxo) === anchor);

type HasCoinjoinPaymentToMixParams = {
    payment: Payment;
    session: CoinjoinSession | undefined;
    utxos: AccountUtxo[] | undefined;
    isAvailable: boolean;
};

/**
 * A round still has to mix the anchor: with the payment, or without it after a cancel, which
 * needs no device. A payment that is not available or that a running session did not authorize
 * waits.
 */
export const hasCoinjoinPaymentToMix = ({
    payment,
    session,
    utxos,
    isAvailable,
}: HasCoinjoinPaymentToMixParams) => {
    if (!isCoinjoinPaymentUnpaid(payment) || !getCoinjoinPaymentAnchorUtxo(payment, utxos)) {
        return false;
    }

    if (payment.isCancelled) {
        return true;
    }

    const isSessionRunning = !!session && !session.paused;

    return (
        isAvailable &&
        !payment.isBlocked &&
        (!isSessionRunning || session.authorizedPaymentId === payment.id)
    );
};

type GetClientCoinjoinPaymentParams = {
    payment: Payment;
    authorizedPaymentId: string | undefined;
    isAvailable: boolean;
};

/**
 * The payment the client gets: a cancelled one, so that it mixes the anchor, and a pending one
 * only if it is available and the device authorized it.
 */
export const getClientCoinjoinPayment = ({
    payment,
    authorizedPaymentId,
    isAvailable,
}: GetClientCoinjoinPaymentParams): CoinjoinPayment | undefined => {
    if (!isCoinjoinPaymentUnpaid(payment)) return;

    const { id, address, amount, anchor } = payment;
    if (payment.isCancelled) return { id, address, amount, anchor, isCancelled: true };
    if (isAvailable && !payment.isBlocked && id === authorizedPaymentId) {
        return { id, address, amount, anchor };
    }
};

/**
 * The anchor of an unpaid payment that the client does not get. It must not be mixed without the
 * payment, which would need a new anchor, or invalidate a signed attempt the user did not cancel.
 */
export const getHeldBackCoinjoinAnchor = (params: GetClientCoinjoinPaymentParams) =>
    isCoinjoinPaymentUnpaid(params.payment) &&
    !params.payment.isCancelled &&
    !getClientCoinjoinPayment(params)
        ? params.payment.anchor
        : undefined;

export const getConnectCoinjoinPayment = ({ address, amount, anchor }: CoinjoinPayment) => {
    const { hash, index } = readOutpoint(anchor);

    return { address, amount, anchor: { prevHash: hash, prevIndex: index } };
};

type GetCoinjoinPaymentFundingParams = {
    utxos: AccountUtxo[] | undefined;
    anonymitySet: AnonymitySet | undefined;
    targetAnonymity: number;
    prison: CoinjoinAccount['prison'];
    inputSize: number;
    outputSize: number;
    maxFeePerVbyte: number;
};

/**
 * Private coins that can fund a payment, as the client selects them: confirmed, at the target
 * anonymity, not detained, at most COINJOIN_PAYMENT_MAX_INPUTS. The largest is the anchor. The
 * highest amount leaves the mining fee for the payment output and the inputs, and
 * COINJOIN_PAYMENT_ACCOUNT_RESERVE.
 */
export const getCoinjoinPaymentFunding = ({
    utxos = [],
    anonymitySet = {},
    targetAnonymity,
    prison = {},
    inputSize,
    outputSize,
    maxFeePerVbyte,
}: GetCoinjoinPaymentFundingParams) => {
    const coins = utxos
        .filter(
            utxo =>
                !!utxo.confirmations &&
                (anonymitySet[utxo.address] ?? 0) >= targetAnonymity &&
                !prison[getUtxoOutpoint(utxo)],
        )
        .toSorted((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, COINJOIN_PAYMENT_MAX_INPUTS);
    const [anchorUtxo] = coins;
    const amountSum = coins.reduce((sum, { amount }) => sum + Number(amount), 0);
    const miningFee = Math.ceil((outputSize + coins.length * inputSize) * maxFeePerVbyte);

    return {
        anchor: anchorUtxo && getUtxoOutpoint(anchorUtxo),
        maxAmount: amountSum - miningFee - COINJOIN_PAYMENT_ACCOUNT_RESERVE,
    };
};

export type CoinjoinPaymentFunding = ReturnType<typeof getCoinjoinPaymentFunding>;

type GetCoinjoinPaymentErrorParams = {
    symbol: CoinjoinSymbol;
    address: string;
    amount: number;
    isCoinjoinRunning: boolean;
    hasUnpaidPayment: boolean;
    funding: CoinjoinPaymentFunding;
    // Called with the address in lower case, only once the cheaper checks pass.
    isOwnAddress: (address: string) => boolean;
    isUsedAddress: (address: string) => boolean;
};

/**
 * The first reason why the payment cannot be created. The address is checked as typed, so a bech32
 * address in mixed case is refused, and compared in lower case.
 */
export const getCoinjoinPaymentError = ({
    symbol,
    address,
    amount,
    isCoinjoinRunning,
    hasUnpaidPayment,
    funding,
    isOwnAddress,
    isUsedAddress,
}: GetCoinjoinPaymentErrorParams): CoinjoinPaymentError | undefined => {
    if (isCoinjoinRunning) return 'COINJOIN_RUNNING';
    if (hasUnpaidPayment) return 'PAYMENT_EXISTS';
    if (!funding.anchor || funding.maxAmount < COINJOIN_PAYMENT_MIN_AMOUNT) {
        return 'NO_PRIVATE_COINS';
    }

    const payeeAddress = address.trim();
    if (!getPaymentDestination(payeeAddress, getCoinjoinNetwork(symbol))) return 'INVALID_ADDRESS';
    if (isOwnAddress(payeeAddress.toLowerCase())) return 'OWN_ADDRESS';
    if (isUsedAddress(payeeAddress.toLowerCase())) return 'ADDRESS_IN_USE';

    if (!Number.isSafeInteger(amount) || amount <= 0) return 'INVALID_AMOUNT';
    if (amount < COINJOIN_PAYMENT_MIN_AMOUNT) return 'AMOUNT_TOO_LOW';
    if (amount > funding.maxAmount) return 'AMOUNT_TOO_HIGH';
};

/**
 * The payment with the attempts of a signature request, or nothing if one of them is not an
 * attempt of this pending payment as the device authorized it.
 */
export const addCoinjoinPaymentAttempts = (
    payment: Payment,
    attempts: CoinjoinPaymentAttempt[],
    authorizedPaymentId: string | undefined,
): CoinjoinAccountPayment | undefined => {
    if (!isCoinjoinPaymentPending(payment) || payment.id !== authorizedPaymentId) return;

    const isPaymentAttempt = ({ paymentId, address, amount, anchor }: CoinjoinPaymentAttempt) =>
        paymentId === payment.id &&
        address === payment.address &&
        amount === payment.amount &&
        anchor === payment.anchor;
    if (!attempts.every(isPaymentAttempt)) return;

    const attemptTxids = new Set(payment.attemptTxids.concat(attempts.map(({ txid }) => txid)));

    return { ...payment, attemptTxids: Array.from(attemptTxids) };
};

type GetSyncedCoinjoinPaymentParams = {
    payment: CoinjoinAccountPayment;
    transactions: WalletAccountTransaction[];
    getNewAnchor: () => string | undefined;
    createId: () => string;
};

/**
 * The payment after the confirmed transactions of the account, the same object if nothing changed.
 * A confirmed payment is paid, whether its attempt was recorded or not. Once the anchor is spent
 * without the payment, no attempt can confirm any more: a cancelled payment is dropped and a
 * pending one gets a new anchor and a new id, which the device has not authorized yet. All of it
 * happens at the first confirmation and a reorg does not undo it, an accepted risk, see
 * docs/features/pay-in-coinjoin.md (Security notes, reorg).
 */
export const getSyncedCoinjoinPayment = ({
    payment,
    transactions,
    getNewAnchor,
    createId,
}: GetSyncedCoinjoinPaymentParams): CoinjoinAccountPayment | undefined => {
    if (payment.paidTxid) return payment;

    const confirmedTransactions = transactions.filter(isConfirmedTransaction);
    const paymentTransaction = confirmedTransactions.find(getIsCoinjoinPaymentTx(payment));
    if (paymentTransaction) return { ...payment, paidTxid: paymentTransaction.txid };

    if (!confirmedTransactions.some(getIsAnchorSpentBy(payment.anchor))) return payment;

    if (payment.isCancelled) return;
    if (payment.isBlocked) return payment;

    const newAnchor = getNewAnchor();
    if (!newAnchor || newAnchor === payment.anchor) return payment;

    return { ...payment, id: createId(), anchor: newAnchor, attemptTxids: [] };
};

// The payment is in a broadcast transaction that has not confirmed yet.
export const isCoinjoinPaymentSending = (
    payment: CoinjoinPayment,
    transactions: WalletAccountTransaction[],
) => {
    const isCoinjoinPaymentTx = getIsCoinjoinPaymentTx(payment);

    return transactions.some(
        transaction => !isConfirmedTransaction(transaction) && isCoinjoinPaymentTx(transaction),
    );
};
