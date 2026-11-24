// Suite Dark: pay in coinjoin, a Privacy account with one private coin on a remembered Firmware Dark
// device.
import { type DeviceRootState, deviceInitialState } from '@suite-common/device';
import { type TrezorDevice } from '@suite-common/suite-types';
import { mockSuiteDevice } from '@suite-common/suite-types/mocks';
import { testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import {
    type TransactionsRootState,
    type WalletSettingsRootState,
    initialWalletSettingsState,
    transactionsInitialState,
} from '@suite-common/wallet-core';
import { type Account, type WalletAccountTransaction } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { type StaticSessionId } from '@trezor/connect';

import { initialState as coinjoinInitialState } from '../coinjoinReducer';
import { type CoinjoinRootState } from '../coinjoinSelectors';
import {
    type CoinjoinAccount,
    type CoinjoinAccountPayment,
    type CoinjoinSession,
} from '../coinjoinTypes';

export const btc = asNetworkSymbol('btc');
export const DEVICE_STATE: StaticSessionId = '1stTestnetAddress@device_id:0';
export const PAYEE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
// BIP84 test vectors, valid P2WPKH addresses.
export const RECEIVE_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
export const CHANGE_ADDRESS = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
export const OTHER_PAYEE = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
export const PAID_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const PRIVATE_COIN_ADDRESS = 'bc1pprivate';

const getAccountAddress = (address: string, path: string) => ({
    address,
    path,
    transfers: 1,
    balance: '0',
    sent: '0',
    received: '0',
});

export const ANCHOR_UTXO = testMocks.getUtxo({
    txid: 'a1'.repeat(32),
    vout: 1,
    address: PRIVATE_COIN_ADDRESS,
    amount: '300000',
    confirmations: 1,
});
export const ANCHOR = getUtxoOutpoint(ANCHOR_UTXO);

export const ACCOUNT = mockWalletAccount({
    symbol: btc,
    accountType: 'coinjoin',
    path: "m/10025'/0'/0'/1'",
    deviceState: DEVICE_STATE,
    utxo: [ANCHOR_UTXO],
    addresses: {
        used: [getAccountAddress(RECEIVE_ADDRESS, "m/10025'/0'/0'/1'/0/0")],
        unused: [],
        change: [getAccountAddress(CHANGE_ADDRESS, "m/10025'/0'/0'/1'/1/0")],
        anonymitySet: { [PRIVATE_COIN_ADDRESS]: 10 },
    },
});

export const PAYMENT: CoinjoinAccountPayment = {
    id: 'payment1',
    address: PAYEE,
    amount: 50_000,
    anchor: ANCHOR,
    attemptTxids: [],
};

export const SESSION: CoinjoinSession = {
    targetAnonymity: 5,
    maxRounds: 10,
    maxFeePerKvbyte: 5000,
    maxCoordinatorFeeRate: 0,
    timeCreated: 0,
    sessionPhaseQueue: [],
    signedRounds: [],
};

export const PAYMENT_DEVICE = mockSuiteDevice(
    { state: { staticSessionId: DEVICE_STATE }, remember: true, connected: true },
    { capabilities: ['Capability_Bitcoin', 'Capability_CoinJoinPayment'] },
);

export type PaymentState = CoinjoinRootState &
    DeviceRootState &
    TransactionsRootState &
    WalletSettingsRootState;

export type GetPaymentStateParams = {
    accounts?: Account[];
    payment?: CoinjoinAccountPayment | null; // null for none
    session?: CoinjoinSession;
    devices?: TrezorDevice[];
    isAutoEjectEnabled?: boolean;
    transactions?: WalletAccountTransaction[];
    otherCoinjoinAccounts?: CoinjoinAccount[];
};

export const getPaymentState = ({
    accounts = [ACCOUNT],
    payment = PAYMENT,
    session,
    devices = [PAYMENT_DEVICE],
    isAutoEjectEnabled = false,
    transactions = [],
    otherCoinjoinAccounts = [],
}: GetPaymentStateParams = {}): PaymentState => ({
    device: { ...deviceInitialState, devices },
    wallet: {
        accounts,
        coinjoin: {
            ...coinjoinInitialState,
            accounts: [
                {
                    key: ACCOUNT.key,
                    symbol: btc,
                    rawLiquidityClue: null,
                    payment: payment ?? undefined,
                    session,
                },
                ...otherCoinjoinAccounts,
            ],
        },
        transactions: {
            ...transactionsInitialState,
            transactions: { [ACCOUNT.key]: transactions },
        },
        settings: { ...initialWalletSettingsState, isAutoEjectEnabled },
    },
});

export const getPaymentTransaction = (blockHeight: number) => {
    const transaction = testMocks.getWalletTransaction({ blockHeight });

    return {
        ...transaction,
        details: {
            ...transaction.details,
            vin: [{ n: 0, isAddress: true, txid: 'a1'.repeat(32), vout: 1 }],
            vout: [{ n: 0, isAddress: true, addresses: [PAYEE], value: '50000' }],
        },
    };
};
