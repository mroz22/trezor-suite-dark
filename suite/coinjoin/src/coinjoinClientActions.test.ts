import { combineReducers, createReducer } from '@reduxjs/toolkit';

import { type SelectedAccountRootState, selectedAccountReducer } from '@suite/account';
import { type LocksRootState, locksReducer } from '@suite/locks';
import {
    MODAL_CONTEXT_NONE,
    type State as ModalReducerState,
    modalReducer,
    openModal,
} from '@suite/modal';
import { type TorRootState, TorStatus, torActions, torReducer } from '@suite/tor';
import { type DeviceReducerState } from '@suite-common/device';
import {
    type MessageSystemRootState,
    prepareMessageSystemReducer,
} from '@suite-common/message-system';
import { type TrezorDevice } from '@suite-common/suite-types';
import { mockSuiteDevice } from '@suite-common/suite-types/mocks';
import { createTestCompositionRoot, initPreloadedState, testMocks } from '@suite-common/test-utils';
import { notificationsActions } from '@suite-common/toast-notifications';
import { type NetworkSymbol, asNetworkSymbol } from '@suite-common/wallet-config';
import {
    type AccountsRootState,
    type WalletSettingsRootState,
    prepareAccountsReducer,
    prepareWalletSettingsReducer,
} from '@suite-common/wallet-core';
import { mockSetAccountAddMetadata } from '@suite-common/wallet-core/mocks';
import '@suite-common/test-utils/globalOverrides';
import { asAccountDescriptor } from '@suite-common/wallet-types';
import { mockAccountKey, mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { EndRoundState, RoundPhase, SessionPhase } from '@trezor/coinjoin';
import { type StaticSessionId } from '@trezor/device-utils';
import { mockActionType, mockReducer } from '@trezor/redux-utils/mocks';
import { promiseAllSequence } from '@trezor/utils';

import * as fixtures from './__fixtures__/coinjoinClientActions';
import {
    clientEmitException,
    clientSessionPhase,
    initCoinjoinServiceThunk,
    onCoinjoinClientRequest,
    onCoinjoinRoundChangedThunk,
    pauseCoinjoinSessionThunk,
    setDebugSettings,
    stopCoinjoinSessionThunk,
} from './coinjoinClientActions';
import { coinjoinMiddleware } from './coinjoinMiddleware';
import { coinjoinReducer } from './coinjoinReducer';
import { type CoinjoinRootState } from './coinjoinSelectors';
import { CoinjoinService } from './coinjoinService';

const TrezorConnect = testMocks.getTrezorConnectMock();
jest.mock('./coinjoinService', () => {
    const mock = jest.requireActual('./__fixtures__/mockCoinjoinService');

    return mock.mockCoinjoinService();
});

const messageSystemReducer = prepareMessageSystemReducer({
    actionTypes: { storageLoad: mockActionType('storageLoad') },
});

const walletSettingsReducer = prepareWalletSettingsReducer({
    actionTypes: { storageLoad: mockActionType('storageLoad') },
    reducers: { storageLoadWalletSettings: mockReducer() },
});
const btcSymbol = asNetworkSymbol('btc');
const testSymbol = asNetworkSymbol('test');
const regtestSymbol = asNetworkSymbol('regtest');
const ltcSymbol = asNetworkSymbol('ltc');

const rootReducer = combineReducers({
    suite: createReducer({}, () => ({})),
    tor: torReducer,
    discreetMode: createReducer({ isActive: false }, () => {}),
    locks: locksReducer,
    device: createReducer(
        { devices: [fixtures.DEVICE], selectedDevice: fixtures.DEVICE, buttonRequestsByPath: {} },
        () => ({}),
    ),
    modal: modalReducer,
    messageSystem: messageSystemReducer,
    wallet: combineReducers({
        coinjoin: coinjoinReducer,
        accounts: prepareAccountsReducer({
            actionTypes: { storageLoad: mockActionType('storageLoad') },
            actions: { setAccountAddMetadata: mockSetAccountAddMetadata() },
            reducers: { storageLoadAccounts: mockReducer() },
        }),
        selectedAccount: selectedAccountReducer,
        settings: walletSettingsReducer,
    }),
});

// Client lifecycle cases share reducers for several thunks and device/modal side effects.
type State = AccountsRootState &
    CoinjoinRootState &
    SelectedAccountRootState &
    WalletSettingsRootState &
    TorRootState &
    LocksRootState &
    MessageSystemRootState & {
        suite: Record<never, never>;
        discreetMode: { isActive: boolean };
        device: {
            devices: TrezorDevice[];
            selectedDevice: TrezorDevice;
            buttonRequestsByPath: DeviceReducerState['buttonRequestsByPath'];
        };
        modal: ModalReducerState;
    };
type Wallet = Partial<State['wallet']> & {
    device?: State['device'];
    suite?: State['suite'];
    locks?: Partial<State['locks']>;
};

const initStore = ({ accounts, coinjoin, device, selectedAccount, suite, locks }: Wallet = {}) =>
    createTestCompositionRoot<void, State>({
        reducer: rootReducer,
        preloadedState: initPreloadedState({
            rootReducer,
            partialState: {
                suite,
                locks,
                device,
                wallet: {
                    accounts,
                    coinjoin,
                    selectedAccount,
                },
            },
        }),
        middleware: [coinjoinMiddleware],
    }).services.store;

describe('coinjoinClientActions', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });
    fixtures.onCoinjoinRoundChanged.forEach(f => {
        it(`onCoinjoinRoundChangedThunk: ${f.description}`, async () => {
            const store = initStore(f.state as Wallet);
            testMocks.setTrezorConnectFixtures(f.connect);

            if (Array.isArray(f.params)) {
                await promiseAllSequence(
                    f.params.map(
                        (round: any) => () =>
                            store.dispatch(
                                onCoinjoinRoundChangedThunk({ round }), // params are incomplete
                            ),
                    ),
                );
            } else {
                await store.dispatch(
                    onCoinjoinRoundChangedThunk({ round: f.params as any }), // params are incomplete
                );
            }

            const actions = store.getActions();
            expect(actions.map(a => a.type)).toEqual(f.result.actions);

            if (typeof f.result.trezorConnectCalledTimes === 'number') {
                expect(TrezorConnect.setBusy).toHaveBeenCalledTimes(
                    f.result.trezorConnectCalledTimes,
                );
            }
            if (f.result.trezorConnectCallsWith) {
                expect(TrezorConnect.setBusy).toHaveBeenLastCalledWith(
                    expect.objectContaining(f.result.trezorConnectCallsWith),
                );
            }
        });
    });

    fixtures.getOwnershipProof.forEach(f => {
        it(`getOwnershipProof: ${f.description}`, async () => {
            const store = initStore(f.state as any); // params are incomplete
            testMocks.setTrezorConnectFixtures(f.connect);

            const response = await store.dispatch(onCoinjoinClientRequest(f.params as any));

            expect(response).toMatchObject(f.result.response);

            expect(TrezorConnect.getOwnershipProof).toHaveBeenCalledTimes(
                f.result.trezorConnectCalledTimes,
            );
        });
    });

    fixtures.signCoinjoinTx.forEach(f => {
        it(`signCoinjoinTx: ${f.description}`, async () => {
            const store = initStore(f.state as any);
            testMocks.setTrezorConnectFixtures(f.connect);

            const [response] = await store.dispatch(
                onCoinjoinClientRequest([f.params as any]), // params are incomplete
            );

            expect(TrezorConnect.signTransaction).toHaveBeenCalledTimes(
                f.result.trezorConnectCalledTimes,
            );

            f.result.trezorConnectCalledWith.forEach((params, index) => {
                expect(TrezorConnect.signTransaction.mock.calls[index]?.[0]).toMatchObject(params);
            });

            // toMatchObject ignores extra keys, assert the removed affiliate data explicitly
            TrezorConnect.signTransaction.mock.calls.forEach(([params]) => {
                params.inputs.forEach(input => expect(input).not.toHaveProperty('coinjoin_flags'));
                expect(params.coinjoinRequest).not.toHaveProperty('mask_public_key');
                expect(params.coinjoinRequest).not.toHaveProperty('signature');
            });

            expect(response).toMatchObject(f.result.response);
        });
    });

    it('initCoinjoinServiceThunk and restore prison', async () => {
        const store = initStore({
            accounts: [
                {
                    key: 'account-A',
                    symbol: 'btc',
                    utxo: [
                        {
                            txid: '123400000000000000000000000000000000000000000000000000000000dbca',
                            vout: 5,
                        },
                    ],
                    addresses: {
                        change: [
                            { address: 'A1', transfers: 1 },
                            { address: 'A2', transfers: 0 },
                            { address: 'A2', transfers: 0 },
                        ],
                    },
                },
            ],
            coinjoin: {
                clients: {},
                accounts: [
                    {
                        key: 'account-A',
                        symbol: 'btc',
                        prison: {
                            '000000': { type: 'input', sentenceEnd: Infinity },
                            A1: { type: 'output', sentenceEnd: Infinity },
                            A2: { type: 'output', sentenceEnd: Infinity },
                            A3: { type: 'output', sentenceEnd: 10000 },
                        },
                    },
                    {
                        key: 'account-B',
                        symbol: 'btc',
                        prison: {},
                    },
                ],
                debug: {
                    coinjoinServerEnvironment: { btc: 'public' },
                },
            },
        } as any); // partial required state

        const spy = jest.spyOn(CoinjoinService, 'createInstance');
        const cli1 = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));
        const cli2 = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));
        expect(cli1).toEqual(cli2);
        expect(spy.mock.calls[0]?.[0]).toMatchObject({
            symbol: 'btc',
            prison: [
                {
                    accountKey: 'account-A',
                    id: 'A2',
                    sentenceEnd: Infinity,
                    type: 'output',
                },
                {
                    accountKey: 'account-A',
                    id: 'A3',
                    sentenceEnd: 10000,
                    type: 'output',
                },
            ],
        });
        spy.mockClear();

        // for coverage, init same instance multiple times without waiting
        // eslint-disable-next-line jest/valid-expect-in-promise
        store.dispatch(initCoinjoinServiceThunk(testSymbol)).then(cli3 => {
            expect(cli3?.client.settings.network).toEqual('test');
        });
        const cli3a = await store.dispatch(initCoinjoinServiceThunk(testSymbol));
        expect(cli3a).toBe(undefined); // undefined because cli3 is not loaded yet
    });

    it('initCoinjoinServiceThunk and throw error', async () => {
        const store = initStore();
        const cli = await store.dispatch(initCoinjoinServiceThunk(ltcSymbol)); // ltc not supported
        expect(cli).toBe(undefined);
    });

    it('initCoinjoinServiceThunk and errors to enable', async () => {
        const store = initStore();
        const spy = jest.spyOn(CoinjoinService, 'createInstance').mockImplementationOnce(
            () =>
                ({
                    client: {
                        enable: () => Promise.resolve({ success: false, error: 'Some error' }),
                    },
                }) as any,
        );
        const cli = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));
        expect(cli).toBe(undefined);
        spy.mockClear();
    });

    fixtures.clientEvents.forEach(f => {
        it(`CoinjoinClient events: ${f.description}`, async () => {
            const store = initStore(f.state as Wallet);

            const cli = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));
            cli?.client.emit(f.event as any, f.params);

            expect(store.getState().wallet.coinjoin).toMatchObject(f.result);
        });
    });

    it('setDebugSettings', () => {
        const store = initStore();
        expect(store.getState().wallet.coinjoin.debug).toBeUndefined();

        store.dispatch(setDebugSettings({ coinjoinServerEnvironment: { [testSymbol]: 'public' } }));

        expect(store.getState().wallet.coinjoin.debug).toMatchObject({
            coinjoinServerEnvironment: { test: 'public' },
        });

        store.dispatch(
            setDebugSettings({ coinjoinServerEnvironment: { [regtestSymbol]: 'localhost' } }),
        );
        expect(store.getState().wallet.coinjoin.debug).toMatchObject({
            coinjoinServerEnvironment: { test: 'public', regtest: 'localhost' },
        });
    });

    it('clientEmitException', async () => {
        const store = initStore();

        const cli1 = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));
        const cli2 = await store.dispatch(initCoinjoinServiceThunk(testSymbol));

        if (!cli1 || !cli2) throw new Error('Client not initialized');

        store.dispatch(clientEmitException('Some exception'));

        expect(cli1.client.emit).toHaveBeenCalledTimes(1);
        expect(cli2.client.emit).toHaveBeenCalledTimes(1);
        expect(cli2.client.emit).toHaveBeenCalledWith('log', {
            level: 'error',
            payload: 'Some exception',
        });

        store.dispatch(clientEmitException('Other exception', { symbol: btcSymbol }));

        expect(cli1.client.emit).toHaveBeenCalledTimes(2);
        expect(cli2.client.emit).toHaveBeenCalledTimes(1);
    });

    it('clientEmitException from coinjoinMiddleware', async () => {
        const account = mockWalletAccount({
            deviceState: '1stTestnetAddress@device_id:0',
            accountType: 'coinjoin',
            descriptor: asAccountDescriptor('account1'),
            symbol: asNetworkSymbol('btc'),
        });

        const initializeStore = () =>
            initStore({
                accounts: [account],
                coinjoin: {
                    accounts: [
                        {
                            key: account.key,
                            symbol: 'btc',
                            session: { roundPhase: 1, signedRounds: [], maxRounds: 10 },
                        },
                    ],
                } as any,
            });

        const store = initializeStore();

        const cli = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));

        if (!cli) throw new Error('Client not initialized');

        store.dispatch({ type: '@suite/online-status', payload: false });
        expect(cli.client.emit).toHaveBeenCalledTimes(1);

        // restore session after previous action, and set phase to critical again
        // NOTE: dispatching torActions.setTorStatus('Enabled') requires a lot more fixtures
        const restoreSession = () => {
            store.dispatch({
                type: '@coinjoin/session-restore',
                payload: { accountKey: account.key },
            });
            store.dispatch({
                type: '@coinjoin/session-round-changed',
                payload: { accountKey: account.key, round: { phase: 1 } },
            });
        };

        restoreSession();
        store.dispatch(torActions.setTorStatus(TorStatus.Disabled));
        expect(cli.client.emit).toHaveBeenCalledTimes(2);

        restoreSession();
        store.dispatch({ type: 'device-disconnect', payload: { id: 'device-id' } });
        expect(cli.client.emit).toHaveBeenCalledTimes(3);

        // previous action stops the session
        const store2 = initializeStore();

        store2.dispatch({
            type: '@common/wallet-core/accounts/removeAccount',
            payload: [{ key: account.key }],
        });
        expect(cli.client.emit).toHaveBeenCalledTimes(4);
    });

    // for coverage: edge cases, missing data etc...
    it('pauseCoinjoinSessionThunk without related account', () => {
        const store = initStore();
        store.dispatch(pauseCoinjoinSessionThunk(mockAccountKey({ descriptor: 'accountZ' })));
    });

    it('stopCoinjoinSessionThunk without connected device', async () => {
        const accountAKey = mockAccountKey({ descriptor: 'accountA' });
        const store = initStore({
            accounts: [{ key: accountAKey, symbol: 'btc' }],
        } as any);

        testMocks.setTrezorConnectFixtures([{ success: false }]);

        await store.dispatch(initCoinjoinServiceThunk(btcSymbol));

        store.dispatch(stopCoinjoinSessionThunk(accountAKey));
    });

    it('stopCoinjoinSessionThunk with error from Trezor', async () => {
        const accountAKey = mockAccountKey({ descriptor: 'accountA' });
        const store = initStore({
            accounts: [
                {
                    key: accountAKey,
                    symbol: 'btc',
                    deviceState: '1stTestnetAddress@device_id:0',
                },
            ],
        } as any);

        testMocks.setTrezorConnectFixtures([
            { success: false, error: { message: 'Firmware error' } },
        ]);

        await store.dispatch(initCoinjoinServiceThunk(btcSymbol));

        store.dispatch(stopCoinjoinSessionThunk(accountAKey));

        expect(TrezorConnect.cancelCoinjoinAuthorization).toHaveBeenCalledTimes(1);
    });

    it('stopCoinjoinSessionThunk but not cancel authorization', async () => {
        const deviceBStaticSessionId: StaticSessionId = '1stTestnetAddress@device_b_id:0';
        const accountAKey = mockAccountKey({ descriptor: 'accountA' });
        const accountBKey = mockAccountKey({
            descriptor: 'accountB',
            deviceStaticSessionId: deviceBStaticSessionId,
        });
        const store = initStore({
            device: {
                devices: [
                    fixtures.DEVICE,
                    { ...fixtures.DEVICE, state: { staticSessionId: deviceBStaticSessionId } },
                ],
            },
            accounts: [
                {
                    key: accountAKey,
                    accountType: 'coinjoin',
                    symbol: 'btc',
                    deviceState: '1stTestnetAddress@device_id:0',
                },
                {
                    key: accountBKey,
                    accountType: 'coinjoin',
                    symbol: 'btc',
                    deviceState: deviceBStaticSessionId,
                },
            ],
            coinjoin: {
                accounts: [
                    { key: accountAKey, session: {} },
                    { key: accountBKey, session: {} },
                ],
            },
        } as any);

        await store.dispatch(initCoinjoinServiceThunk(btcSymbol));

        store.dispatch(stopCoinjoinSessionThunk(accountAKey));

        expect(TrezorConnect.cancelCoinjoinAuthorization).toHaveBeenCalledTimes(0);
    });

    it('stops all sessions of the network after the coordinator lies, then ends the round', async () => {
        const device2StaticSessionId: StaticSessionId = '1stTestnetAddress@device_2_id:0';
        const busyDevice = { ...fixtures.DEVICE, features: { busy: true } };
        const device2 = mockSuiteDevice({
            id: 'device-2-id',
            path: '2',
            state: { staticSessionId: device2StaticSessionId },
            connected: true,
            available: true,
            remember: true,
        });
        const createCoinjoinAccount = (
            descriptor: string,
            symbol: NetworkSymbol,
            deviceState: StaticSessionId,
        ) =>
            mockWalletAccount({
                accountType: 'coinjoin',
                descriptor: asAccountDescriptor(descriptor),
                symbol,
                deviceState,
            });
        // Account A has an input in the lying round, B is registered without one and C is paused.
        const accountA = createCoinjoinAccount(
            'accountA',
            btcSymbol,
            '1stTestnetAddress@device_id:0',
        );
        const accountB = createCoinjoinAccount('accountB', btcSymbol, device2StaticSessionId);
        const accountC = createCoinjoinAccount(
            'accountC',
            btcSymbol,
            '1stTestnetAddress@device_id:0',
        );
        // Another network, its coordinator did not lie.
        const accountD = createCoinjoinAccount('accountD', testSymbol, device2StaticSessionId);
        const session = { signedRounds: [], maxRounds: 10, sessionPhaseQueue: [] };
        const store = initStore({
            device: { devices: [busyDevice, device2] },
            accounts: [accountA, accountB, accountC, accountD],
            coinjoin: {
                accounts: [
                    { key: accountA.key, symbol: 'btc', session: { ...session, roundPhase: 3 } },
                    { key: accountB.key, symbol: 'btc', session: { ...session, roundPhase: 3 } },
                    { key: accountC.key, symbol: 'btc', session: { ...session, paused: true } },
                    { key: accountD.key, symbol: 'test', session },
                ],
            },
        } as any); // partial required state
        store.dispatch(
            openModal({ type: 'critical-coinjoin-phase', relatedAccountKey: accountA.key }),
        );
        store.clearActions();

        // The client emits the session phase while the round ends, before the round event.
        store.dispatch(
            clientSessionPhase({
                phase: SessionPhase.CoordinatorMisbehavior,
                accountKeys: [accountA.key, accountB.key],
            }),
        );
        await store.dispatch(
            onCoinjoinRoundChangedThunk({
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.None,
                    inputs: [],
                    failed: [{ accountKey: accountA.key }],
                    roundDeadline: Date.now(),
                },
            } as any), // params are incomplete
        );
        // Let the thunk dispatched by coinjoinMiddleware finish.
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(
            store.getState().wallet.coinjoin.accounts.map(({ key, session }) => [key, !!session]),
        ).toEqual([
            [accountA.key, false],
            [accountB.key, false],
            [accountC.key, false],
            [accountD.key, true],
        ]);
        expect(store.getActions()).toContainEqual(
            expect.objectContaining({
                type: notificationsActions.addToast.type,
                payload: expect.objectContaining({
                    type: 'coinjoin-coordinator-misbehavior',
                    autoClose: false,
                }),
            }),
        );
        // onCoinjoinRoundChangedThunk skips the round, the stop ends it on the device once.
        expect(store.getState().modal.context).toBe(MODAL_CONTEXT_NONE);
        expect(TrezorConnect.setBusy).toHaveBeenCalledTimes(1);
        expect(TrezorConnect.setBusy).toHaveBeenCalledWith(
            expect.objectContaining({ device: { path: busyDevice.path }, expiry_ms: undefined }),
        );
        // Device 2 keeps the authorization for the session of account D.
        expect(TrezorConnect.cancelCoinjoinAuthorization).toHaveBeenCalledTimes(1);
        expect(TrezorConnect.cancelCoinjoinAuthorization).toHaveBeenCalledWith({
            device: busyDevice,
        });
        // SetBusy would override the pending cancel.
        const [setBusyCall] = TrezorConnect.setBusy.mock.invocationCallOrder;
        const [cancelCall] = TrezorConnect.cancelCoinjoinAuthorization.mock.invocationCallOrder;
        expect(setBusyCall).toBeLessThan(cancelCall ?? 0);
    });

    it('CoinjoinClient events', async () => {
        const store = initStore();
        const cli = await store.dispatch(initCoinjoinServiceThunk(btcSymbol));

        // other requests are covered by fixtures.getOwnershipProof and fixtures.signCoinjoinTx
        cli?.client.emit('request', [{ type: 'unknown' } as any]);

        cli?.client.emit('log', { level: 'warn', payload: 'Warn' });
        cli?.client.emit('log', { level: 'error', payload: 'Error' });
    });
});
