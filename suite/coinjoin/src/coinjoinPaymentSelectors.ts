// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import { type DeviceRootState, selectDeviceByStaticSessionId } from '@suite-common/device';
import { getIsDeviceRemembered } from '@suite-common/suite-utils';
import {
    type AccountsRootState,
    type TransactionsRootState,
    type WalletSettingsRootState,
    selectAccountByKey,
    selectAccountTransactions,
    selectIsDeviceAutoEjectEnabled,
} from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { getInputSize, getOutputSize } from '@trezor/coinjoin';
import { getPaymentDestination } from '@trezor/coinjoin/src/utils/paymentUtils';
import { getCoinjoinNetwork } from '@trezor/coinjoin/src/utils/settingsUtils';
import { createWeakMapSelector } from '@trezor/redux-utils';

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

type CoinjoinPaymentAvailabilityRootState = AccountsRootState &
    DeviceRootState &
    WalletSettingsRootState;

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

/**
 * A payment survives a restart and is signed only on the account's own device when that device is
 * remembered without auto-eject, so that its anchor and signed attempts are saved, and has
 * Firmware Dark's Capability_CoinJoinPayment.
 */
export const selectIsCoinjoinPaymentAvailableByAccountKey = (
    state: CoinjoinPaymentAvailabilityRootState,
    accountKey: AccountKey,
) => {
    const account = selectAccountByKey(state, accountKey);
    if (!account) return false;

    const device = selectDeviceByStaticSessionId(state, account.deviceState);

    return (
        getIsDeviceRemembered(device) &&
        !selectIsDeviceAutoEjectEnabled(state) &&
        !!device?.features?.capabilities?.includes('Capability_CoinJoinPayment')
    );
};

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
 * Payees the coordinator would refuse or that another payment may still pay, in lower case: every
 * output of the account's transactions, a coinjoin output included, and the payees of the unpaid
 * payments of the network's other Privacy accounts.
 */
const selectUsedPayeeAddressesByAccountKey = createMemoizedSelector(
    [selectAccountTransactions, selectCoinjoinAccounts, selectCoinjoinAccountByKey],
    (transactions, coinjoinAccounts, coinjoinAccount) => {
        const outputAddresses = transactions.flatMap(({ details }) =>
            details.vout.flatMap(({ addresses }) => addresses ?? []),
        );
        const otherPayeeAddresses = coinjoinAccounts.flatMap(({ key, symbol, payment }) =>
            key !== coinjoinAccount?.key &&
            symbol === coinjoinAccount?.symbol &&
            isCoinjoinPaymentUnpaid(payment)
                ? payment.address
                : [],
        );

        return new Set(
            outputAddresses.concat(otherPayeeAddresses).map(address => address.toLowerCase()),
        );
    },
);

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
        ownAddresses: selectOwnAddressesByAccountKey(state, accountKey),
        usedAddresses: selectUsedPayeeAddressesByAccountKey(state, accountKey),
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

    return 'waiting';
};
