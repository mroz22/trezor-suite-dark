import { type RouterState, routerLocationChange } from '@suite/router';
import { TorStatus, torActions } from '@suite/tor';
import { testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import { type TransactionsState, accountsActions } from '@suite-common/wallet-core';
import { type Account, type SelectedAccountLoaded } from '@suite-common/wallet-types';
import { mockAccountKey } from '@suite-common/wallet-types/mocks';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { type AnonymitySet } from '@trezor/blockchain-link';
import { DEVICE, type StaticSessionId } from '@trezor/connect';

import * as COINJOIN from '../coinjoinConstants';
import {
    type CoinjoinAccount,
    type CoinjoinAccountPayment,
    type CoinjoinSession,
    type CoinjoinState,
} from '../coinjoinTypes';

type FixtureDevice = {
    available: boolean;
    connected: boolean;
    id: string;
    remember: boolean;
    state: {
        staticSessionId: string;
    };
    type: string;
    features?: { capabilities: string[] };
};

type FixtureState = Partial<{
    device: {
        devices: FixtureDevice[];
        selectedDevice: FixtureDevice;
    };
    router: RouterState;
    suite: {
        online: boolean;
    };
    tor: {
        torStatus: TorStatus;
        torBootstrap: null;
    };
    wallet: {
        accounts: Account[];
        coinjoin: CoinjoinState;
        selectedAccount: SelectedAccountLoaded;
        // Suite Dark: pay in coinjoin, a fixture may preload the transactions of its payment.
        transactions?: TransactionsState;
    };
}>;

type FixtureAction = {
    type: string;
    payload?: unknown;
};

/** Opaque mock responses passed directly to setTrezorConnectFixtures. */
type ConnectFixtures = unknown;

type Fixture = {
    description: string;
    state: FixtureState;
    action: FixtureAction;
    expectedActions: FixtureAction[];
    client?: 'btc';
    connect?: ConnectFixtures;
};

const DEVICE_A = {
    available: true,
    connected: true,
    id: 'device-A-id',
    remember: true,
    state: { staticSessionId: '1stTestnet@device_A_id:0' },
    type: 'acquired',
};
const DEVICE_B = {
    ...DEVICE_A,
    id: 'device-B-id',
    state: { staticSessionId: '1stTestnet@device_B_id:0' },
};

const ACCOUNT_A_KEY = mockAccountKey({
    descriptor: 'accountAKey',
    symbol: asNetworkSymbol('btc'),
    deviceStaticSessionId: '1stTestnet@device_A_id:0',
});
const ACCOUNT_B_KEY = mockAccountKey({
    descriptor: 'accountBKey',
    symbol: asNetworkSymbol('btc'),
    deviceStaticSessionId: '1stTestnet@device_B_id:0',
});

const ACCOUNT_A = {
    accountType: 'coinjoin',
    backendType: 'coinjoin',
    deviceState: '1stTestnet@device_A_id:0' as StaticSessionId,
    history: {},
    key: ACCOUNT_A_KEY,
    status: 'ready',
    symbol: 'btc',
    utxo: [{ address: 'address', amount: '10000', vout: 1 }],
    addresses: {
        anonymitySet: {
            address: 1,
        } as AnonymitySet,
    },
} as Account;
const ACCOUNT_B = {
    ...ACCOUNT_A,
    deviceState: '1stTestnet@device_B_id:0' as StaticSessionId,
    key: ACCOUNT_B_KEY,
};

const COINJOIN_ACCOUNT_A = {
    key: ACCOUNT_A_KEY,
    session: { signedRounds: [] as string[] },
    setup: {
        targetAnonymity: 2,
    },
} as CoinjoinAccount;
const COINJOIN_ACCOUNT_B = {
    ...COINJOIN_ACCOUNT_A,
    key: ACCOUNT_B_KEY,
};

const DEFAULT_STATE = {
    device: {
        devices: [DEVICE_A, DEVICE_B],
        selectedDevice: DEVICE_A,
    },
    suite: { online: true },
    tor: {
        torStatus: TorStatus.Enabled,
        torBootstrap: null,
    },
    wallet: {
        accounts: [ACCOUNT_A, ACCOUNT_B],
        coinjoin: {
            accounts: [COINJOIN_ACCOUNT_A, COINJOIN_ACCOUNT_B],
        } as CoinjoinState,
        selectedAccount: {
            account: ACCOUNT_B,
        } as SelectedAccountLoaded,
    },
};
const STATE_WITH_INTERRUPTED_SESSION = {
    ...DEFAULT_STATE,
    wallet: {
        ...DEFAULT_STATE.wallet,
        coinjoin: {
            ...DEFAULT_STATE.wallet.coinjoin,
            accounts: [
                {
                    ...COINJOIN_ACCOUNT_A,
                    session: {
                        ...COINJOIN_ACCOUNT_A.session,
                    } as CoinjoinSession,
                },
                {
                    ...COINJOIN_ACCOUNT_B,
                    session: {
                        ...COINJOIN_ACCOUNT_B.session,
                        paused: true,
                    } as CoinjoinSession,
                },
            ],
        },
    },
};

// Suite Dark: pay in coinjoin, account B has a payment its remembered Firmware Dark device approves.
// Bytes not all equal, so that a reversed byte order does not match.
const PAYMENT_ANCHOR = {
    txid: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    vout: 1,
};
const PAYMENT_B: CoinjoinAccountPayment = {
    id: 'payment1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    amount: 50_000,
    anchor: getUtxoOutpoint(PAYMENT_ANCHOR),
    attemptTxids: [],
};
const getStateWithInterruptedPayment = (payment: CoinjoinAccountPayment) => ({
    ...STATE_WITH_INTERRUPTED_SESSION,
    device: {
        ...STATE_WITH_INTERRUPTED_SESSION.device,
        devices: [
            DEVICE_A,
            { ...DEVICE_B, features: { capabilities: ['Capability_CoinJoinPayment'] } },
        ],
    },
    wallet: {
        ...STATE_WITH_INTERRUPTED_SESSION.wallet,
        accounts: [
            ACCOUNT_A,
            {
                ...ACCOUNT_B,
                utxo: [
                    { address: 'address', amount: '300000', confirmations: 1, ...PAYMENT_ANCHOR },
                ],
            } as Account,
        ],
        coinjoin: {
            ...STATE_WITH_INTERRUPTED_SESSION.wallet.coinjoin,
            accounts: STATE_WITH_INTERRUPTED_SESSION.wallet.coinjoin.accounts.map(account =>
                account.key === ACCOUNT_B_KEY ? { ...account, payment } : account,
            ),
        },
    },
});

// The anchor was spent by a confirmed round without the payment, which the payment sync has not
// applied yet; a private coin is left for a new anchor and a non-private one to mix.
const NEW_ANCHOR_COIN = {
    address: 'private',
    amount: '200000',
    confirmations: 1,
    txid: '0dac366fd8a67b2a89fbb0d31086e7acded7a5bbf9ef9daa935bc873229ef5b5',
    vout: 0,
};
const getStateWithSpentAnchor = () => {
    const state = getStateWithInterruptedPayment(PAYMENT_B);
    const spendingTransaction = testMocks.getWalletTransaction({ blockHeight: 100 });

    return {
        ...state,
        wallet: {
            ...state.wallet,
            accounts: [
                ACCOUNT_A,
                {
                    ...ACCOUNT_B,
                    utxo: [
                        NEW_ANCHOR_COIN,
                        { ...NEW_ANCHOR_COIN, address: 'address', vout: 1, amount: '300000' },
                    ],
                    addresses: { anonymitySet: { address: 1, private: 5 } as AnonymitySet },
                } as Account,
            ],
            transactions: {
                transactions: {
                    [ACCOUNT_B_KEY]: [
                        {
                            ...spendingTransaction,
                            details: {
                                ...spendingTransaction.details,
                                vin: [{ n: 0, isAddress: true, ...PAYMENT_ANCHOR }],
                                vout: [{ n: 0, isAddress: true, addresses: ['bc1p'], value: '1' }],
                            },
                        },
                    ],
                },
                phishing: {},
                fetchStatusDetail: {},
            },
        },
    };
};

// Account B syncs: the restore's own payment sync anchors the payment anew, which is checked in the
// test, since the new id is random.
export const spentAnchorFixture = {
    state: getStateWithSpentAnchor(),
    action: {
        type: accountsActions.endCoinjoinAccountSync.type,
        payload: { accountKey: ACCOUNT_B_KEY, status: 'ready' },
    },
    accountKey: ACCOUNT_B_KEY,
    payment: PAYMENT_B,
    newAnchor: getUtxoOutpoint(NEW_ANCHOR_COIN),
};

const PAUSE_ALL_INTERRUPTED_SESSIONS_ACTIONS = [
    {
        type: COINJOIN.SESSION_PAUSE,
        payload: {
            accountKey: ACCOUNT_A_KEY,
        },
    },
    {
        type: COINJOIN.SESSION_PAUSE,
        payload: {
            accountKey: ACCOUNT_B_KEY,
        },
    },
];

const RESTORE_SESSION_B_ACTIONS = [
    {
        type: COINJOIN.SESSION_STARTING,
        payload: {
            accountKey: ACCOUNT_B_KEY,
            isStarting: true,
        },
    },
    {
        type: COINJOIN.SESSION_RESTORE,
        payload: {
            accountKey: ACCOUNT_B_KEY,
        },
    },
    {
        type: COINJOIN.SESSION_STARTING,
        payload: {
            accountKey: ACCOUNT_B_KEY,
            isStarting: false,
        },
    },
];

export const fixtures: Fixture[] = [
    {
        description: 'stopping coinjoin session when remembered device disconnects',
        state: DEFAULT_STATE,
        client: asNetworkSymbol('btc'),
        action: {
            type: DEVICE.DISCONNECT,
            payload: {
                id: 'device-A-id',
            },
        },
        expectedActions: [
            {
                type: COINJOIN.ACCOUNT_UNREGISTER,
                payload: {
                    accountKey: ACCOUNT_A_KEY,
                },
            },
        ],
    },
    {
        description: 'interrupt all coinjoin sessions when Tor is disabled',
        state: DEFAULT_STATE,
        action: torActions.setTorStatus(TorStatus.Disabled),
        expectedActions: PAUSE_ALL_INTERRUPTED_SESSIONS_ACTIONS,
    },
    {
        description: 'restore all interrupted coinjoin sessions when Tor is enabled',
        state: STATE_WITH_INTERRUPTED_SESSION,
        client: asNetworkSymbol('btc'),
        connect: {
            success: true,
        },
        action: torActions.setTorStatus(TorStatus.Enabled),
        expectedActions: RESTORE_SESSION_B_ACTIONS,
    },
    {
        description: 'interrupt current coinjoin session when user enters send form',
        state: DEFAULT_STATE,
        action: {
            type: routerLocationChange.type,
            payload: {
                route: {
                    name: 'wallet-send',
                },
            },
        },
        expectedActions: [
            {
                type: COINJOIN.SESSION_PAUSE,
                payload: {
                    accountKey: ACCOUNT_B_KEY,
                },
            },
        ],
    },
    {
        description: 'restore all interrupted coinjoin sessions when user leaves send form',
        state: STATE_WITH_INTERRUPTED_SESSION,
        client: asNetworkSymbol('btc'),
        connect: [
            {
                success: true,
            },
        ],
        action: {
            type: routerLocationChange.type,
            payload: {
                route: {
                    name: 'settings-index',
                },
                settingsBackRoute: {
                    name: 'wallet-send',
                },
            },
        },
        expectedActions: RESTORE_SESSION_B_ACTIONS,
    },
    {
        description: 'interrupt related coinjoin session when an account goes out of sync',
        state: DEFAULT_STATE,
        action: {
            type: accountsActions.endCoinjoinAccountSync.type,
            payload: { accountKey: ACCOUNT_B.key, status: 'out-of-sync' },
        },
        expectedActions: [
            {
                type: COINJOIN.SESSION_PAUSE,
                payload: {
                    accountKey: ACCOUNT_B_KEY,
                },
            },
        ],
    },
    {
        description:
            'do not interrupt related coinjoin session when an account goes out of sync during critical phase',
        state: {
            ...DEFAULT_STATE,
            wallet: {
                ...DEFAULT_STATE.wallet,
                coinjoin: {
                    ...DEFAULT_STATE.wallet.coinjoin,
                    accounts: [
                        {
                            ...COINJOIN_ACCOUNT_B,
                            session: {
                                ...COINJOIN_ACCOUNT_B.session,
                                roundPhase: 1,
                            } as CoinjoinSession,
                        },
                    ],
                },
            },
        },
        action: {
            type: accountsActions.endCoinjoinAccountSync.type,
            payload: { accountKey: ACCOUNT_B.key, status: 'out-of-sync' },
        },
        expectedActions: [],
    },
    {
        description: 'restore related coinjoin session when an account syncs',
        state: STATE_WITH_INTERRUPTED_SESSION,
        client: asNetworkSymbol('btc'),
        connect: [
            {
                success: true,
            },
        ],
        action: {
            type: accountsActions.endCoinjoinAccountSync.type,
            payload: { accountKey: ACCOUNT_B.key, status: 'ready' },
        },
        expectedActions: RESTORE_SESSION_B_ACTIONS,
    },
    {
        description: 'interrupt all coinjoin sessions when Suite goes offline',
        state: DEFAULT_STATE,
        action: {
            type: '@suite/online-status',
            payload: false,
        },
        expectedActions: PAUSE_ALL_INTERRUPTED_SESSIONS_ACTIONS,
    },
    {
        description: 'restore all interrupted coinjoin sessions when Suite goes online',
        state: STATE_WITH_INTERRUPTED_SESSION,
        client: asNetworkSymbol('btc'),
        connect: [
            {
                success: true,
            },
        ],
        action: {
            type: '@suite/online-status',
            payload: true,
        },
        expectedActions: RESTORE_SESSION_B_ACTIONS,
    },
    {
        description: 'do not restore session when in send form',
        state: {
            ...STATE_WITH_INTERRUPTED_SESSION,
            router: { route: { name: 'wallet-send' } } as RouterState,
        },
        client: asNetworkSymbol('btc'),
        connect: [
            {
                success: true,
            },
        ],
        action: {
            type: '@suite/online-status',
            payload: true,
        },
        expectedActions: [],
    },
    {
        description:
            'do not restore a session whose payment the device would approve again when Suite goes online',
        state: getStateWithInterruptedPayment(PAYMENT_B),
        client: asNetworkSymbol('btc'),
        connect: [{ success: true }],
        action: {
            type: '@suite/online-status',
            payload: true,
        },
        expectedActions: [],
    },
    {
        description:
            'do not restore a session whose payment the device would approve again when its account syncs',
        state: getStateWithInterruptedPayment(PAYMENT_B),
        client: asNetworkSymbol('btc'),
        connect: [{ success: true }],
        action: {
            type: accountsActions.endCoinjoinAccountSync.type,
            payload: { accountKey: ACCOUNT_B.key, status: 'ready' },
        },
        expectedActions: [],
    },
    {
        description: 'restore a session whose payment is paid when Suite goes online',
        state: getStateWithInterruptedPayment({ ...PAYMENT_B, paidTxid: 'b2'.repeat(32) }),
        client: asNetworkSymbol('btc'),
        connect: [{ success: true }],
        action: {
            type: '@suite/online-status',
            payload: true,
        },
        expectedActions: RESTORE_SESSION_B_ACTIONS,
    },
];
