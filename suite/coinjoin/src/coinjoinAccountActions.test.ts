import { combineReducers, createReducer } from '@reduxjs/toolkit';

import { type SelectedAccountState, selectedAccountReducer } from '@suite/account';
import { type LocksState, locksReducer } from '@suite/locks';
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
    prepareWalletSettingsReducer,
    transactionsInitialState,
} from '@suite-common/wallet-core';
import { mockSetAccountAddMetadata } from '@suite-common/wallet-core/mocks';
import { mockActionType, mockReducer } from '@trezor/redux-utils/mocks';

import * as fixtures from './__fixtures__/coinjoinAccountActions';
import {
    ANCHOR,
    PAYMENT,
    ACCOUNT as PAYMENT_ACCOUNT,
    PAYMENT_DEVICE,
    SESSION as PAYMENT_SESSION,
} from './__fixtures__/coinjoinPayment';
import * as coinjoinAccountActions from './coinjoinAccountActions';
import * as coinjoinClientActions from './coinjoinClientActions';
import { initialState as coinjoinInitialState, coinjoinReducer } from './coinjoinReducer';
import { CoinjoinService } from './coinjoinService';
import { type CoinjoinAccountPayment, type CoinjoinState } from './coinjoinTypes';

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
    wallet: combineReducers({
        coinjoin: coinjoinReducer,
        accounts: prepareAccountsReducer({
            actionTypes: { storageLoad: mockActionType('storageLoad') },
            actions: { setAccountAddMetadata: mockSetAccountAddMetadata() },
            reducers: { storageLoadAccounts: mockReducer() },
        }),
        selectedAccount: selectedAccountReducer,
        blockchain: () => ({ btc: { blockHeight: 150 } }),
        transactions: () => transactionsInitialState,
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
    wallet: {
        coinjoin: CoinjoinState;
        accounts: AccountsState;
        selectedAccount: SelectedAccountState;
        blockchain: { btc: { blockHeight: number } };
        transactions: TransactionsState;
        settings: WalletSettingsState;
    };
};
type Wallet = Partial<State['wallet']> & { devices?: State['device']['devices'] };

const initStore = ({ accounts, coinjoin, devices, settings }: Wallet = {}) =>
    createTestCompositionRoot<void, State>({
        reducer: rootReducer,
        preloadedState: initPreloadedState({
            rootReducer,
            partialState: {
                ...(devices !== undefined ? { device: { devices } } : {}),
                wallet: { accounts, coinjoin, settings },
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

    // Suite Dark: pay in coinjoin.
    describe('authorizes a pending payment with its anchor', () => {
        const { authorizeCoinjoin } = testMocks.getTrezorConnectMock();
        const btc = asNetworkSymbol('btc');
        const CONNECT_PAYMENT = {
            address: PAYMENT.address,
            amount: PAYMENT.amount,
            anchor: { prevHash: 'a1'.repeat(32), prevIndex: 1 },
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
        };

        const initPaymentStore = ({
            payment = PAYMENT,
            device = PAYMENT_DEVICE,
            isAutoEjectEnabled = false,
            isPaused = false,
        }: InitPaymentStoreParams = {}) => {
            testMocks.setTrezorConnectFixtures({
                success: true,
                payload: { message: 'Authorized' },
            });

            return initStore({
                accounts: [PAYMENT_ACCOUNT],
                coinjoin: {
                    ...coinjoinInitialState,
                    accounts: [
                        {
                            key: PAYMENT_ACCOUNT.key,
                            symbol: btc,
                            rawLiquidityClue: null,
                            payment,
                            session: isPaused ? { ...PAYMENT_SESSION, paused: true } : undefined,
                        },
                    ],
                },
                devices: [device],
                settings: { ...initialWalletSettingsState, isAutoEjectEnabled },
            });
        };
        const getRegisteredAccount = () =>
            jest.mocked(CoinjoinService.getInstance(btc)?.client.registerAccount)?.mock
                .calls[0]?.[0];
        const getSession = (store: ReturnType<typeof initStore>) =>
            store.getState().wallet.coinjoin.accounts[0]?.session;

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

        it('restoreCoinjoinSession', async () => {
            const store = initPaymentStore({ isPaused: true });
            await CoinjoinService.createInstance({ symbol: btc });

            await store.dispatch(
                coinjoinAccountActions.restoreCoinjoinSessionThunk(PAYMENT_ACCOUNT.key),
            );

            expect(authorizeCoinjoin).toHaveBeenCalledWith(
                expect.objectContaining({ preauthorized: true, payment: CONNECT_PAYMENT }),
            );
            expect(getSession(store)?.authorizedPaymentId).toBe(PAYMENT.id);
            expect(getRegisteredAccount()).toMatchObject({ payment: CLIENT_PAYMENT });
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
    });
});
