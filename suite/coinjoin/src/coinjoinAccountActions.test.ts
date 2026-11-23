import { combineReducers, createReducer } from '@reduxjs/toolkit';

import { type SelectedAccountState, selectedAccountReducer } from '@suite/account';
import { type LocksState, locksReducer } from '@suite/locks';
import { MODAL_CONTEXT_NONE } from '@suite/modal';
import { type TorState, TorStatus, torReducer } from '@suite/tor';
import { type DeviceReducerState } from '@suite-common/device';
import { type MessageSystemState, prepareMessageSystemReducer } from '@suite-common/message-system';
import { type NetworksState } from '@suite-common/networks';
import { mockNetworksState } from '@suite-common/networks/mocks';
import { type TrezorDevice } from '@suite-common/suite-types';
import { mockSuiteDevice } from '@suite-common/suite-types/mocks';
import { createTestCompositionRoot, initPreloadedState, testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import {
    type AccountsState,
    type TransactionsState,
    type WalletSettingsState,
    initialWalletSettingsState,
    prepareAccountsReducer,
    prepareTransactionsReducer,
    prepareWalletSettingsReducer,
} from '@suite-common/wallet-core';
import { mockSetAccountAddMetadata } from '@suite-common/wallet-core/mocks';
import { type Account, type WalletAccountTransaction } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { RoundPhase } from '@trezor/coinjoin';
import { mockActionType, mockReducer } from '@trezor/redux-utils/mocks';

import * as fixtures from './__fixtures__/coinjoinAccountActions';
import {
    ANCHOR,
    ANCHOR_TXID,
    ANCHOR_UTXO,
    OTHER_TXID,
    PAYMENT,
    ACCOUNT as PAYMENT_ACCOUNT,
    PAYMENT_DEVICE,
    SESSION as PAYMENT_SESSION,
    getPaymentTransaction,
} from './__fixtures__/coinjoinPayment';
import * as coinjoinAccountActions from './coinjoinAccountActions';
import * as coinjoinClientActions from './coinjoinClientActions';
import { coinjoinAccountSetPayment } from './coinjoinPaymentActions';
import { initialState as coinjoinInitialState, coinjoinReducer } from './coinjoinReducer';
import { CoinjoinService } from './coinjoinService';
import {
    type CoinjoinAccountPayment,
    type CoinjoinSession,
    type CoinjoinState,
} from './coinjoinTypes';

jest.mock('./coinjoinService', () => {
    const mock = jest.requireActual('./__fixtures__/mockCoinjoinService');

    return mock.mockCoinjoinService();
});

const DEVICE = mockSuiteDevice({
    state: { staticSessionId: '1stTestnetAddress@device_id:0' },
    connected: true,
});

const networks = mockNetworksState([
    asNetworkSymbol('btc'),
    asNetworkSymbol('test'),
    asNetworkSymbol('regtest'),
]);

const rootReducer = combineReducers({
    networks: () => networks,
    suite: createReducer(
        {
            settings: {
                debug: {},
            },
        },
        () => ({}),
    ),
    locks: locksReducer,
    messageSystem: prepareMessageSystemReducer({
        actionTypes: { storageLoad: mockActionType('storageLoad') },
    }),
    device: createReducer(
        { devices: [DEVICE], selectedDevice: DEVICE, buttonRequestsByPath: {} },
        () => ({}),
    ),
    modal: () => ({}),
    tor: torReducer,
    wallet: combineReducers({
        coinjoin: coinjoinReducer,
        accounts: prepareAccountsReducer({
            actionTypes: { storageLoad: mockActionType('storageLoad') },
            actions: { setAccountAddMetadata: mockSetAccountAddMetadata() },
            reducers: { storageLoadAccounts: mockReducer() },
        }),
        selectedAccount: selectedAccountReducer,
        blockchain: () => ({ btc: { blockHeight: 150 } }),
        transactions: prepareTransactionsReducer({
            actionTypes: { storageLoad: mockActionType('storageLoad') },
            reducers: { storageLoadTransactions: mockReducer() },
        }),
        settings: prepareWalletSettingsReducer({
            actionTypes: { storageLoad: mockActionType('storageLoad') },
            reducers: { storageLoadWalletSettings: mockReducer() },
        }),
    }),
});

// These fixtures dispatch several account thunks and assert changes across their shared reducers.
type State = {
    networks: NetworksState;
    suite: { settings: { debug: Record<never, never> } };
    locks: LocksState;
    messageSystem: MessageSystemState;
    device: {
        devices: TrezorDevice[];
        selectedDevice: TrezorDevice;
        buttonRequestsByPath: DeviceReducerState['buttonRequestsByPath'];
    };
    modal: Record<never, never>;
    tor: TorState;
    wallet: {
        coinjoin: CoinjoinState;
        accounts: AccountsState;
        selectedAccount: SelectedAccountState;
        blockchain: { btc: { blockHeight: number } };
        transactions: TransactionsState;
        settings: WalletSettingsState;
    };
};
type Wallet = Partial<State['wallet']> & {
    devices?: State['device']['devices'];
    torStatus?: TorStatus;
};

const initStore = ({
    accounts,
    coinjoin,
    devices,
    settings,
    torStatus,
    transactions,
}: Wallet = {}) =>
    createTestCompositionRoot<void, State>({
        reducer: rootReducer,
        preloadedState: initPreloadedState({
            rootReducer,
            partialState: {
                ...(devices !== undefined ? { device: { devices } } : {}),
                ...(torStatus !== undefined ? { tor: { torStatus } } : {}),
                wallet: { accounts, coinjoin, settings, transactions },
            },
        }),
    }).services.store;

describe('coinjoinAccountActions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        CoinjoinService.getInstances().forEach(({ client }) => {
            CoinjoinService.removeInstance(asNetworkSymbol(client.settings.network));
        });
    });

    fixtures.createCoinjoinAccount.forEach(f => {
        it(`createCoinjoinAccount: ${f.description}`, async () => {
            const store = initStore();
            testMocks.setTrezorConnectFixtures(f.connect);
            jest.spyOn(console, 'log').mockImplementation(() => {});

            await store.dispatch(
                coinjoinAccountActions.createCoinjoinAccountThunk(
                    f.params.network as any,
                    f.params.account as any,
                ),
            ); // params are incomplete

            const actions = store.getActions();
            expect(actions.map(a => a.type)).toEqual(f.result.actions);
        });
    });

    // A scan that fails after it found transactions has already added them to the history and
    // stored its checkpoint, so the next scan finds nothing new.
    it('fetchAndUpdateAccount: updates an out-of-sync account whose scan finds nothing new', async () => {
        const symbol = asNetworkSymbol('btc');
        const account: Account = {
            ...mockWalletAccount({ symbol, accountType: 'coinjoin' }),
            backendType: 'coinjoin',
            status: 'out-of-sync',
        };
        const store = initStore({
            accounts: [account],
            coinjoin: { accounts: [{ key: account.key, symbol: account.symbol }] },
        } as Wallet);

        await store.dispatch(coinjoinAccountActions.fetchAndUpdateAccountThunk(account));

        expect(CoinjoinService.getInstance(symbol)?.backend.getAccountInfo).toHaveBeenCalled();
    });

    fixtures.startCoinjoinSession.forEach(f => {
        it(`startCoinjoinSession: ${f.description}`, async () => {
            const store = initStore(f.state as Wallet);
            testMocks.setTrezorConnectFixtures(f.connect);
            // @ts-expect-error params are incomplete
            await store.dispatch(coinjoinAccountActions.startCoinjoinSessionThunk(f.params, {}));

            const actions = store.getActions();
            expect(actions.map(a => a.type)).toEqual(f.result.actions);
        });
    });

    fixtures.stopCoinjoinSession.forEach(f => {
        it(`stopCoinjoinSession: ${f.description}`, async () => {
            const store = initStore(f.state as Wallet);

            if (f.client) {
                await CoinjoinService.createInstance({ symbol: f.client as any });
            }

            await store.dispatch(coinjoinClientActions.stopCoinjoinSessionThunk(f.param));

            const actions = store.getActions();
            expect(actions.map(a => a.type)).toEqual(f.result.actions);
        });
    });

    fixtures.restoreCoinjoinAccounts.forEach(f => {
        it(`restoreCoinjoinAccounts: ${f.description}`, async () => {
            const store = initStore(f.state as Wallet);

            await store.dispatch(coinjoinAccountActions.restoreCoinjoinAccountsThunk());

            const actions = store.getActions();
            expect(actions.map(a => a.type)).toEqual(f.result.actions);
        });
    });

    fixtures.restoreCoinjoinSession.forEach(f => {
        it(`restoreCoinjoinSession: ${f.description}`, async () => {
            const store = initStore(f.state as Wallet);

            if (f.client) {
                await CoinjoinService.createInstance({ symbol: f.client as any });
            }

            await store.dispatch(coinjoinAccountActions.restoreCoinjoinSessionThunk(f.param));

            const actions = store.getActions();

            expect(actions.map(a => a.type)).toEqual(f.result.actions);
        });
    });

    it('restoreCoinjoinSession: does not register an account whose session ended meanwhile', async () => {
        const [f] = fixtures.restoreCoinjoinSession;
        if (!f) throw new Error('Fixture missing');
        const store = initStore(f.state as Wallet);
        const { client } = await CoinjoinService.createInstance({ symbol: asNetworkSymbol('btc') });
        // The session ends while the device authorizes it, e.g. when the coordinator lies.
        testMocks.setTrezorConnectFixtures([
            () => {
                store.dispatch(coinjoinClientActions.coinjoinAccountUnregister(f.param));

                return { success: true };
            },
        ]);

        await store.dispatch(coinjoinAccountActions.restoreCoinjoinSessionThunk(f.param));

        expect(client.registerAccount).not.toHaveBeenCalled();
        expect(store.getState().wallet.coinjoin.accounts[0]?.session).toBeUndefined();
    });

    describe('authorizes the coordinator fee rate in whole firmware units', () => {
        const f = fixtures.coordinatorFeeRateInFirmwareUnits;
        const { authorizeCoinjoin } = testMocks.getTrezorConnectMock();

        it('startCoinjoinSession', async () => {
            const store = initStore(f.startState as Wallet);
            testMocks.setTrezorConnectFixtures(f.connect);
            await store.dispatch(
                // @ts-expect-error params are incomplete
                coinjoinAccountActions.startCoinjoinSessionThunk(f.account, f.sessionParams),
            );

            expect(authorizeCoinjoin).toHaveBeenCalledWith(
                expect.objectContaining({ maxCoordinatorFeeRate: f.authorizedFeeRate }),
            );
        });

        it('restoreCoinjoinSession', async () => {
            const store = initStore(f.restoreState as Wallet);
            testMocks.setTrezorConnectFixtures(f.connect);
            await CoinjoinService.createInstance({ symbol: asNetworkSymbol('btc') });

            await store.dispatch(coinjoinAccountActions.restoreCoinjoinSessionThunk(f.accountKey));

            expect(authorizeCoinjoin).toHaveBeenCalledWith(
                expect.objectContaining({ maxCoordinatorFeeRate: f.authorizedFeeRate }),
            );
        });
    });

    describe('syncCoinjoinAccount', () => {
        const symbol = asNetworkSymbol('btc');
        const account: Account = {
            ...mockWalletAccount({ symbol, accountType: 'coinjoin' }),
            backendType: 'coinjoin',
            status: 'out-of-sync',
        };

        it('scans the account', async () => {
            const store = initStore({ accounts: [account], torStatus: TorStatus.Enabled });
            const { backend } = await CoinjoinService.createInstance({ symbol });

            await store.dispatch(coinjoinAccountActions.syncCoinjoinAccountThunk(account.key));

            expect(backend.scanAccount).toHaveBeenCalled();
        });

        it('does not scan the account without Tor', async () => {
            const store = initStore({ accounts: [account], torStatus: TorStatus.Disabled });
            const { backend } = await CoinjoinService.createInstance({ symbol });

            await store.dispatch(coinjoinAccountActions.syncCoinjoinAccountThunk(account.key));

            expect(backend.scanAccount).not.toHaveBeenCalled();
        });
    });

    // Suite Dark: pay in coinjoin.
    describe('authorizes a pending payment with its anchor', () => {
        const { authorizeCoinjoin } = testMocks.getTrezorConnectMock();
        const btc = asNetworkSymbol('btc');
        const CONNECT_PAYMENT = {
            address: PAYMENT.address,
            amount: PAYMENT.amount,
            anchor: { prevHash: ANCHOR_TXID, prevIndex: 1 },
        };
        const CLIENT_PAYMENT = {
            id: PAYMENT.id,
            address: PAYMENT.address,
            amount: PAYMENT.amount,
            anchor: ANCHOR,
        };

        type InitPaymentStoreParams = {
            payment?: CoinjoinAccountPayment;
            device?: TrezorDevice;
            isAutoEjectEnabled?: boolean;
            isPaused?: boolean;
            session?: CoinjoinSession; // instead of the paused one or none
            account?: Account;
            transactions?: WalletAccountTransaction[];
        };

        const initPaymentStore = ({
            payment = PAYMENT,
            device = PAYMENT_DEVICE,
            isAutoEjectEnabled = false,
            isPaused = false,
            session = isPaused
                ? { ...PAYMENT_SESSION, paused: true, authorizedPaymentId: PAYMENT.id }
                : undefined,
            account = PAYMENT_ACCOUNT,
            transactions = [],
        }: InitPaymentStoreParams = {}) => {
            testMocks.setTrezorConnectFixtures({
                success: true,
                payload: { message: 'Authorized' },
            });

            return initStore({
                accounts: [account],
                coinjoin: {
                    ...coinjoinInitialState,
                    accounts: [
                        {
                            key: PAYMENT_ACCOUNT.key,
                            symbol: btc,
                            rawLiquidityClue: null,
                            payment,
                            session,
                        },
                    ],
                },
                devices: [device],
                settings: { ...initialWalletSettingsState, isAutoEjectEnabled },
                transactions: {
                    transactions: { [PAYMENT_ACCOUNT.key]: transactions },
                    phishing: {},
                    fetchStatusDetail: {},
                },
            });
        };
        const getClient = () => CoinjoinService.getInstance(btc)?.client;
        const getRegisteredAccount = () =>
            jest.mocked(getClient()?.registerAccount)?.mock.calls[0]?.[0];
        const getSession = (store: ReturnType<typeof initStore>) =>
            store.getState().wallet.coinjoin.accounts[0]?.session;
        const getPayment = (store: ReturnType<typeof initStore>) =>
            store.getState().wallet.coinjoin.accounts[0]?.payment;

        // The anchor was spent by a confirmed round without the payment; another private coin is
        // left for a new anchor.
        const NEW_COIN = testMocks.getUtxo({ ...ANCHOR_UTXO, txid: OTHER_TXID, vout: 0 });
        const NEW_ANCHOR = getUtxoOutpoint(NEW_COIN);
        const ANCHOR_SPENT = {
            account: { ...PAYMENT_ACCOUNT, utxo: [NEW_COIN] },
            payment: { ...PAYMENT, amount: PAYMENT.amount + 1, attemptTxids: ['c3'.repeat(32)] },
            transactions: [getPaymentTransaction(100)],
        };

        it('startCoinjoinSession', async () => {
            const store = initPaymentStore();

            await store.dispatch(
                coinjoinAccountActions.startCoinjoinSessionThunk(PAYMENT_ACCOUNT, PAYMENT_SESSION),
            );

            expect(authorizeCoinjoin).toHaveBeenCalledWith(
                expect.objectContaining({ payment: CONNECT_PAYMENT }),
            );
            expect(getSession(store)?.authorizedPaymentId).toBe(PAYMENT.id);
            expect(getRegisteredAccount()).toMatchObject({ payment: CLIENT_PAYMENT });
        });

        it('restoreCoinjoinSession on the Resume of the payment card', async () => {
            const store = initPaymentStore({ isPaused: true });
            await CoinjoinService.createInstance({ symbol: btc });

            await store.dispatch(
                coinjoinAccountActions.restoreCoinjoinSessionThunk(PAYMENT_ACCOUNT.key, {
                    isUserAction: true,
                }),
            );

            expect(authorizeCoinjoin).toHaveBeenCalledWith(
                expect.objectContaining({ preauthorized: true, payment: CONNECT_PAYMENT }),
            );
            expect(getSession(store)?.authorizedPaymentId).toBe(PAYMENT.id);
            expect(getRegisteredAccount()).toMatchObject({ payment: CLIENT_PAYMENT });
        });

        it('never restores a session with a payment to authorize automatically', async () => {
            const store = initPaymentStore({ isPaused: true });
            await CoinjoinService.createInstance({ symbol: btc });

            await store.dispatch(
                coinjoinAccountActions.restoreCoinjoinSessionThunk(PAYMENT_ACCOUNT.key),
            );

            expect(authorizeCoinjoin).not.toHaveBeenCalled();
            expect(getRegisteredAccount()).toBeUndefined();
            expect(getSession(store)).toMatchObject({ paused: true });
            expect(getSession(store)?.starting).toBeFalsy();
        });

        it('leaves the session paused when the sync of an automatic restore anchors the payment anew', async () => {
            const store = initPaymentStore({ isPaused: true, ...ANCHOR_SPENT });
            await CoinjoinService.createInstance({ symbol: btc });

            await store.dispatch(
                coinjoinAccountActions.restoreCoinjoinSessionThunk(PAYMENT_ACCOUNT.key),
            );

            expect(getPayment(store)?.anchor).toBe(NEW_ANCHOR);
            expect(authorizeCoinjoin).not.toHaveBeenCalled();
            expect(getSession(store)).toMatchObject({ paused: true });

            await store.dispatch(
                coinjoinAccountActions.restoreCoinjoinSessionThunk(PAYMENT_ACCOUNT.key, {
                    isUserAction: true,
                }),
            );

            expect(authorizeCoinjoin).toHaveBeenCalledWith(
                expect.objectContaining({
                    payment: {
                        address: PAYMENT.address,
                        amount: PAYMENT.amount + 1,
                        anchor: { prevHash: OTHER_TXID, prevIndex: 0 },
                    },
                }),
            );
            expect(getSession(store)?.authorizedPaymentId).toBe(getPayment(store)?.id);
        });

        it.each<[string, InitPaymentStoreParams]>([
            [
                'on a wallet that is not remembered',
                { device: { ...PAYMENT_DEVICE, remember: false } },
            ],
            ['with auto-eject on', { isAutoEjectEnabled: true }],
            [
                'without the capability',
                {
                    device: mockSuiteDevice(
                        { state: PAYMENT_DEVICE.state, remember: true, connected: true },
                        { capabilities: ['Capability_Bitcoin'] },
                    ),
                },
            ],
        ])('authorizes no payment %s and holds back its anchor', async (_name, params) => {
            const store = initPaymentStore(params);

            await store.dispatch(
                coinjoinAccountActions.startCoinjoinSessionThunk(PAYMENT_ACCOUNT, PAYMENT_SESSION),
            );

            expect(authorizeCoinjoin.mock.calls[0]?.[0]).not.toHaveProperty('payment');
            expect(getSession(store)).not.toHaveProperty('authorizedPaymentId');
            expect(getRegisteredAccount()).toMatchObject({ payment: undefined, utxos: [] });
        });

        it('passes no payment that is no longer available to the client', async () => {
            const store = initPaymentStore({ isPaused: true, isAutoEjectEnabled: true });
            await CoinjoinService.createInstance({ symbol: btc });

            // The test store has no modal slice, which the thunk reads.
            coinjoinAccountActions.updateClientAccountThunk(PAYMENT_ACCOUNT)(
                store.dispatch,
                () => ({
                    ...store.getState(),
                    modal: { context: MODAL_CONTEXT_NONE },
                }),
            );

            expect(getClient()?.updateAccount).toHaveBeenCalledWith(
                expect.objectContaining({ payment: undefined, utxos: [] }),
            );
        });

        it('keeps a payment that is no longer available and its session in a critical phase', async () => {
            const store = initPaymentStore({
                isAutoEjectEnabled: true,
                session: {
                    ...PAYMENT_SESSION,
                    authorizedPaymentId: PAYMENT.id,
                    roundPhase: RoundPhase.ConnectionConfirmation,
                },
            });
            await CoinjoinService.createInstance({ symbol: btc });

            coinjoinAccountActions.updateClientAccountThunk(PAYMENT_ACCOUNT)(
                store.dispatch,
                () => ({
                    ...store.getState(),
                    modal: { context: MODAL_CONTEXT_NONE },
                }),
            );

            // A removed payment or anchor would break the round; the signing refuses the payment.
            expect(getClient()?.updateAccount).toHaveBeenCalledWith(
                expect.objectContaining({
                    payment: CLIENT_PAYMENT,
                    utxos: [expect.objectContaining({ outpoint: ANCHOR })],
                }),
            );
            expect(getSession(store)).toMatchObject({
                roundPhase: RoundPhase.ConnectionConfirmation,
            });
        });

        it('authorizes no paid payment', async () => {
            const store = initPaymentStore({ payment: { ...PAYMENT, paidTxid: 'b2'.repeat(32) } });

            await store.dispatch(
                coinjoinAccountActions.startCoinjoinSessionThunk(PAYMENT_ACCOUNT, PAYMENT_SESSION),
            );

            expect(authorizeCoinjoin.mock.calls[0]?.[0]).not.toHaveProperty('payment');
            expect(getRegisteredAccount()).toMatchObject({
                payment: undefined,
                utxos: [expect.objectContaining({ outpoint: ANCHOR })],
            });
        });

        it('saves the payment with the coinjoin account', () => {
            expect(
                coinjoinAccountActions.isCoinjoinAccountPersistenceAction(
                    coinjoinAccountSetPayment(PAYMENT_ACCOUNT.key, PAYMENT),
                ),
            ).toBe(true);
        });

        describe('fetchAndUpdateAccount', () => {
            const SYNCED_ACCOUNT = {
                ...PAYMENT_ACCOUNT,
                backendType: 'coinjoin',
                status: 'ready',
            } as Account;

            it('anchors the payment anew without new transactions and passes it to the client', async () => {
                const store = initPaymentStore({
                    isPaused: true,
                    ...ANCHOR_SPENT,
                    account: { ...SYNCED_ACCOUNT, utxo: [NEW_COIN] } as Account,
                });
                const { backend, client } = await CoinjoinService.createInstance({ symbol: btc });

                await store.dispatch(
                    coinjoinAccountActions.fetchAndUpdateAccountThunk(SYNCED_ACCOUNT),
                );

                expect(backend.getAccountInfo).not.toHaveBeenCalled();
                expect(getPayment(store)).toMatchObject({ anchor: NEW_ANCHOR, attemptTxids: [] });
                expect(client.updateAccount).toHaveBeenCalledTimes(1);
                // The device has not approved the new anchor yet, so the client does not get it.
                expect(client.updateAccount).toHaveBeenCalledWith(
                    expect.objectContaining({ payment: undefined, utxos: [] }),
                );
            });

            it('does not update the client when nothing changed', async () => {
                const store = initPaymentStore({ isPaused: true, account: SYNCED_ACCOUNT });
                const { client } = await CoinjoinService.createInstance({ symbol: btc });

                await store.dispatch(
                    coinjoinAccountActions.fetchAndUpdateAccountThunk(SYNCED_ACCOUNT),
                );

                expect(getPayment(store)).toEqual(PAYMENT);
                expect(client.updateAccount).not.toHaveBeenCalled();
            });

            it('marks the payment paid when its transaction arrives and passes that to the client', async () => {
                const paymentTransaction = getPaymentTransaction(100);
                const store = initPaymentStore({ isPaused: true, account: SYNCED_ACCOUNT });
                const { backend, client } = await CoinjoinService.createInstance({ symbol: btc });
                jest.mocked(backend.scanAccount).mockResolvedValueOnce({
                    pending: [paymentTransaction],
                    checkpoint: {
                        blockHash: 'hash',
                        blockHeight: 100,
                        receiveCount: 20,
                        changeCount: 20,
                    },
                    cache: undefined,
                });
                jest.mocked(backend.getAccountInfo).mockResolvedValueOnce({
                    ...SYNCED_ACCOUNT,
                    // A copy, the thunk writes the anonymity set into it.
                    addresses: { ...PAYMENT_ACCOUNT.addresses },
                    history: { total: 1, unconfirmed: 0, transactions: [paymentTransaction] },
                    utxo: [],
                } as any);

                await store.dispatch(
                    coinjoinAccountActions.fetchAndUpdateAccountThunk(SYNCED_ACCOUNT),
                );

                expect(backend.getAccountInfo).toHaveBeenCalled();
                expect(getPayment(store)?.paidTxid).toBe(paymentTransaction.txid);
                expect(client.updateAccount).toHaveBeenCalledWith(
                    expect.objectContaining({ payment: undefined }),
                );
            });
        });
    });
});
