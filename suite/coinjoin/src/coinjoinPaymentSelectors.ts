// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import {
    type AccountsRootState,
    type TransactionsRootState,
    selectAccountByKey,
    selectAccountTransactions,
} from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { getInputSize, getOutputSize } from '@trezor/coinjoin';
import { getPaymentDestination } from '@trezor/coinjoin/src/utils/paymentUtils';
import { getCoinjoinNetwork } from '@trezor/coinjoin/src/utils/settingsUtils';
import { createWeakMapSelector } from '@trezor/redux-utils';

import {
    type CoinjoinPaymentAvailabilityRootState,
    selectIsCoinjoinPaymentAvailableByAccountKey,
} from './coinjoinPaymentAvailability';
import {
    type CoinjoinPaymentError,
    type CoinjoinPaymentStatus,
    getCoinjoinPaymentAnchorUtxo,
    getCoinjoinPaymentError,
    getCoinjoinPaymentFunding,
    isCoinjoinPaymentPending,
    isCoinjoinPaymentSending,
    isCoinjoinPaymentUnpaid,
} from './coinjoinPaymentUtils';
import {
    type CoinjoinRootState,
    selectCoinjoinAccountByKey,
    selectCoinjoinAccounts,
    selectDefaultMaxMiningFeeByAccountKey,
    selectTargetAnonymityByAccountKey,
} from './coinjoinSelectors';
import { getCoinjoinAccountScriptType, isCoinjoinSupportedSymbol } from './coinjoinUtils';
import { DEFAULT_TARGET_ANONYMITY } from './config';

type CoinjoinPaymentRootState = CoinjoinPaymentAvailabilityRootState &
    CoinjoinRootState &
    TransactionsRootState;

const createMemoizedSelector = createWeakMapSelector.withTypes<
    AccountsRootState & CoinjoinRootState & TransactionsRootState
>();

export const selectCoinjoinPaymentByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
) => selectCoinjoinAccountByKey(state, accountKey)?.payment;

// The payment the next authorization on the device carries, if any.
export const selectCoinjoinPaymentToAuthorizeByAccountKey = (
    state: CoinjoinPaymentAvailabilityRootState & CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const payment = selectCoinjoinPaymentByAccountKey(state, accountKey);
    if (!isCoinjoinPaymentPending(payment)) return;
    if (!selectIsCoinjoinPaymentAvailableByAccountKey(state, accountKey)) return;
    if (!getCoinjoinPaymentAnchorUtxo(payment, selectAccountByKey(state, accountKey)?.utxo)) return;

    return payment;
};

/**
 * Private coins for a payment to the address, with the limits of the session if there is one, else
 * with those a new session would use.
 */
export const selectCoinjoinPaymentFundingByAccountKey = (
    state: AccountsRootState & CoinjoinRootState,
    accountKey: AccountKey,
    address: string,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const account = selectAccountByKey(state, accountKey);
    if (!coinjoinAccount || !account || !isCoinjoinSupportedSymbol(account.symbol)) return;

    const { session, setup, prison } = coinjoinAccount;
    const destination = getPaymentDestination(address.trim(), getCoinjoinNetwork(account.symbol));

    return getCoinjoinPaymentFunding({
        utxos: account.utxo,
        anonymitySet: account.addresses?.anonymitySet,
        targetAnonymity:
            session?.targetAnonymity ??
            selectTargetAnonymityByAccountKey(state, accountKey) ??
            DEFAULT_TARGET_ANONYMITY,
        prison,
        inputSize: getInputSize(getCoinjoinAccountScriptType(account.path)),
        outputSize: destination?.outputSize ?? getOutputSize('Taproot'),
        maxFeePerVbyte: session
            ? session.maxFeePerKvbyte / 1000
            : (setup?.maxFeePerVbyte ?? selectDefaultMaxMiningFeeByAccountKey(state, accountKey)),
    });
};

// Addresses of the account in lower case.
const selectOwnAddressesByAccountKey = createMemoizedSelector([selectAccountByKey], account => {
    const addresses = account?.addresses;
    if (!addresses) return new Set<string>();

    return new Set(
        [...addresses.used, ...addresses.unused, ...addresses.change].map(({ address }) =>
            address.toLowerCase(),
        ),
    );
});

/**
 * Every output address of the account's transactions in lower case, a coinjoin output included,
 * which the coordinator would refuse as a payee. Memoised on the transactions only, which coinjoin
 * actions do not change.
 */
const selectOutputAddressesByAccountKey = createMemoizedSelector(
    [selectAccountTransactions],
    transactions =>
        new Set(
            transactions.flatMap(({ details }) =>
                details.vout.flatMap(({ addresses }) =>
                    (addresses ?? []).map(address => address.toLowerCase()),
                ),
            ),
        ),
);

// Whether another Privacy account of the network has an unpaid payment to the address.
const getIsOtherPayeeAddress = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
    address: string,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);

    return selectCoinjoinAccounts(state).some(
        ({ key, symbol, payment }) =>
            key !== accountKey &&
            symbol === coinjoinAccount?.symbol &&
            isCoinjoinPaymentUnpaid(payment) &&
            payment.address.toLowerCase() === address,
    );
};

type CoinjoinPaymentInput = {
    address: string;
    amount: number;
};

export const selectCoinjoinPaymentErrorByAccountKey = (
    state: AccountsRootState & CoinjoinRootState & TransactionsRootState,
    accountKey: AccountKey,
    { address, amount }: CoinjoinPaymentInput,
): CoinjoinPaymentError | undefined => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const account = selectAccountByKey(state, accountKey);
    const funding = selectCoinjoinPaymentFundingByAccountKey(state, accountKey, address);
    if (!coinjoinAccount || !account || !funding || !isCoinjoinSupportedSymbol(account.symbol)) {
        return 'NO_PRIVATE_COINS';
    }

    const { session, payment } = coinjoinAccount;

    return getCoinjoinPaymentError({
        symbol: account.symbol,
        address,
        amount,
        isCoinjoinRunning: !!session && !session.paused,
        hasUnpaidPayment: isCoinjoinPaymentUnpaid(payment),
        funding,
        isOwnAddress: payeeAddress =>
            selectOwnAddressesByAccountKey(state, accountKey).has(payeeAddress),
        isUsedAddress: payeeAddress =>
            selectOutputAddressesByAccountKey(state, accountKey).has(payeeAddress) ||
            getIsOtherPayeeAddress(state, accountKey, payeeAddress),
    });
};

export const selectCoinjoinPaymentStatusByAccountKey = (
    state: CoinjoinPaymentRootState,
    accountKey: AccountKey,
): CoinjoinPaymentStatus | undefined => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const payment = coinjoinAccount?.payment;
    if (!payment) return;

    if (payment.paidTxid) return 'paid';
    if (payment.isCancelled) return 'cancelled';
    if (isCoinjoinPaymentSending(payment, selectAccountTransactions(state, accountKey))) {
        return 'sending';
    }
    if (payment.isBlocked) return 'blocked';
    if (!selectIsCoinjoinPaymentAvailableByAccountKey(state, accountKey)) return 'unavailable';

    const { session } = coinjoinAccount;
    if (session?.paused) return 'paused';
    if (session && session.authorizedPaymentId !== payment.id) return 'needs-restart';
    if (session?.isPaymentInRound) return 'paying';

    return 'waiting';
};
