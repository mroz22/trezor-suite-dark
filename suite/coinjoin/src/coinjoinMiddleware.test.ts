import { combineReducers, createReducer } from '@reduxjs/toolkit';

import { type SelectedAccountRootState, selectedAccountReducer } from '@suite/account';
import { type LocksRootState, locksReducer } from '@suite/locks';
import { type RouterRootState, routerLocationChange, routerReducer } from '@suite/router';
import { type TorRootState, TorStatus, torReducer } from '@suite/tor';
import {
    type MessageSystemRootState,
    prepareMessageSystemReducer,
} from '@suite-common/message-system';
import { createTestCompositionRoot, testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import {
    type AccountsRootState,
    type TransactionsState,
    prepareAccountsReducer,
    transactionsInitialState,
} from '@suite-common/wallet-core';
import { mockSetAccountAddMetadata } from '@suite-common/wallet-core/mocks';
import { type Account } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import '@suite-common/test-utils/globalOverrides';
import { mockActionType, mockReducer } from '@trezor/redux-utils/mocks';

import { fixtures } from './__fixtures__/coinjoinMiddleware';
import { rescanCoinjoinAccountThunk } from './coinjoinAccountActions';
import { clientEnableFailed, clientEnableSuccess } from './coinjoinClientActions';
import { coinjoinMiddleware } from './coinjoinMiddleware';
import { coinjoinReducer } from './coinjoinReducer';
import { type CoinjoinRootState, type SuiteOnlineRootState } from './coinjoinSelectors';
import { CoinjoinService } from './coinjoinService';

jest.mock('./coinjoinService', () => {
    const mock = jest.requireActual('./__fixtures__/mockCoinjoinService');

    return mock.mockCoinjoinService();
});

const messageSystem = prepareMessageSystemReducer({
    actionTypes: { storageLoad: mockActionType('storageLoad') },
});

const rootReducer = combineReducers({
    device: createReducer({}, () => ({})),
    locks: locksReducer,
    messageSystem,
    router: routerReducer,
    suite: createReducer({ online: true }, () => ({})),
    tor: torReducer,
    discreetMode: createReducer({ isActive: false }, () => {}),
    wallet: combineReducers({
        accounts: prepareAccountsReducer({
            actionTypes: { storageLoad: mockActionType('storageLoad') },
            actions: { setAccountAddMetadata: mockSetAccountAddMetadata() },
            reducers: { storageLoadAccounts: mockReducer() },
        }),
        coinjoin: coinjoinReducer,
        selectedAccount: selectedAccountReducer,
        transactions: () => transactionsInitialState,
    }),
});

type State = AccountsRootState &
    CoinjoinRootState &
    SelectedAccountRootState &
    LocksRootState &
    MessageSystemRootState &
    RouterRootState &
    SuiteOnlineRootState &
    TorRootState & {
        device: Record<never, never>;
        discreetMode: { isActive: boolean };
        wallet: { transactions: TransactionsState };
    };

// The wallet is merged into the initial one, so a test passes only the slices it needs.
type InitStoreParams = Partial<Omit<State, 'wallet'>> & { wallet?: Partial<State['wallet']> };

const initStore = ({ device, router, suite, tor, wallet }: InitStoreParams = {}) => {
    const preloadedState: State = rootReducer(undefined, { type: 'init' });

    if (device) {
        preloadedState.device = device;
    }

    if (router) {
        preloadedState.router = {
            ...preloadedState.router,
            ...router,
        };
    }

    if (suite) {
        preloadedState.suite = {
            ...preloadedState.suite,
            ...suite,
        };
    }

    if (tor) {
        preloadedState.tor = {
            ...preloadedState.tor,
            ...tor,
        };
    }

    if (wallet) {
        preloadedState.wallet = {
            ...preloadedState.wallet,
            ...wallet,
        };
    }

    return createTestCompositionRoot<void, State>({
        reducer: rootReducer,
        preloadedState,
        middleware: [coinjoinMiddleware],
    }).services.store;
};

describe('coinjoinMiddleware', () => {
    beforeEach(() => {
        CoinjoinService.getInstances().forEach(({ client }) => {
            CoinjoinService.removeInstance(asNetworkSymbol(client.settings.network));
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    fixtures.forEach(f => {
        it(f.description, async () => {
            const store = initStore(f.state);

            if (f.connect) {
                testMocks.setTrezorConnectFixtures(f.connect);
            }

            if (f.client) {
                await CoinjoinService.createInstance({ symbol: asNetworkSymbol(f.client) });
            }

            store.dispatch(f.action);
            expect(await store.getActions()).toEqual([f.action, ...f.expectedActions]);
        });
    });

    it('keeps scanning Privacy accounts when the user leaves the wallet', async () => {
        const store = initStore();
        const { backend } = await CoinjoinService.createInstance({
            symbol: asNetworkSymbol('btc'),
        });

        store.dispatch({
            type: routerLocationChange.type,
            payload: { app: 'dashboard', route: { name: 'suite-index' } },
        });

        expect(backend.cancel).not.toHaveBeenCalled();
    });

    // A scan requested while the client loads is skipped, so the next one would otherwise wait for
    // the next blockchain sync.
    describe('scans Privacy accounts once their coinjoin client has loaded', () => {
        const symbol = asNetworkSymbol('btc');
        const account: Account = {
            ...mockWalletAccount({ symbol, accountType: 'coinjoin' }),
            backendType: 'coinjoin',
            status: 'out-of-sync',
        };

        const initStoreWithAccount = async () => {
            const store = initStore({
                tor: { torStatus: TorStatus.Enabled, torBootstrap: null },
                wallet: { accounts: [account] },
            });
            const { backend } = await CoinjoinService.createInstance({ symbol });
            // The scans stay running, the tests need only their start.
            jest.mocked(backend.scanAccount).mockImplementation(() => new Promise<never>(() => {}));

            return { store, backend };
        };

        it.each([
            [
                'enabled',
                clientEnableSuccess(symbol, {
                    rounds: [],
                    changed: [],
                    feeRateMedian: 0,
                    coordinationFeeRate: { rate: 0, plebsDontPayThreshold: 0 },
                    allowedInputAmounts: { min: 5000, max: 134375000000 },
                    version: { majorVersion: '2', commitHash: '', legalDocumentsVersion: '' },
                }),
            ],
            ['failed to enable', clientEnableFailed(symbol)],
        ])('when the client %s', async (_, action) => {
            const { store, backend } = await initStoreWithAccount();

            store.dispatch(action);
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(backend.scanAccount).toHaveBeenCalledWith(
                expect.objectContaining({ descriptor: account.descriptor }),
            );
        });

        it('once when its rescan loads the client', async () => {
            const { store, backend } = await initStoreWithAccount();

            store.dispatch(rescanCoinjoinAccountThunk(account.key, true));
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(backend.scanAccount).toHaveBeenCalledTimes(1);
        });
    });
});
