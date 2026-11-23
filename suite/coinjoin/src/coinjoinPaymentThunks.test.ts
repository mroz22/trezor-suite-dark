import { type UnknownAction } from '@reduxjs/toolkit';

import { MODAL_CONTEXT_NONE, type ModalRootState } from '@suite/modal';
import { mockSuiteDevice } from '@suite-common/suite-types/mocks';
import { createTestCompositionRoot, testMocks } from '@suite-common/test-utils';
import { RoundPhase } from '@trezor/coinjoin';
import { createMockDispatch } from '@trezor/redux-utils/mocks';

import {
    ACCOUNT,
    ANCHOR,
    ANCHOR_UTXO,
    DEVICE_STATE,
    type GetPaymentStateParams,
    OTHER_TXID,
    PAYEE,
    PAYMENT,
    PAYMENT_DEVICE,
    SESSION,
    btc,
    getPaymentState,
    getPaymentTransaction,
} from './__fixtures__/coinjoinPayment';
import { coinjoinAccountSetPayment } from './coinjoinPaymentActions';
import {
    type CancelCoinjoinPaymentThunkState,
    type CreateCoinjoinPaymentThunkState,
    cancelCoinjoinPaymentThunk,
    createCoinjoinPaymentThunk,
} from './coinjoinPaymentThunks';
import { type CoinjoinAction, coinjoinReducer } from './coinjoinReducer';
import { CoinjoinService } from './coinjoinService';
import { type CoinjoinAccountPayment } from './coinjoinTypes';

jest.mock('./coinjoinService', () => {
    const mock = jest.requireActual('./__fixtures__/mockCoinjoinService');

    return mock.mockCoinjoinService();
});

describe('createCoinjoinPaymentThunk', () => {
    const create = (params: GetPaymentStateParams, address = PAYEE) => {
        const state: CreateCoinjoinPaymentThunkState = getPaymentState({
            payment: null,
            ...params,
        });
        const getState = () => state;
        const { actions, dispatch } = createMockDispatch({ getState, extra: undefined });
        const result = createCoinjoinPaymentThunk({
            accountKey: ACCOUNT.key,
            address,
            amount: 50_000,
        })(dispatch, getState);

        return { result, actions };
    };

    it.each<[string, GetPaymentStateParams]>([
        [
            'without the capability',
            {
                devices: [
                    mockSuiteDevice({ state: { staticSessionId: DEVICE_STATE }, remember: true }),
                ],
            },
        ],
        [
            'on a wallet that is not remembered',
            { devices: [{ ...PAYMENT_DEVICE, remember: false }] },
        ],
        ['with auto-eject on', { isAutoEjectEnabled: true }],
    ])('refuses a payment %s', (_name, params) => {
        expect(create(params)).toEqual({ result: 'UNAVAILABLE', actions: [] });
    });

    it('refuses a payment while coinjoin runs and allows it while coinjoin is paused', () => {
        expect(create({ session: SESSION })).toEqual({ result: 'COINJOIN_RUNNING', actions: [] });
        expect(create({ session: { ...SESSION, paused: true } }).result).toBeUndefined();
    });

    it('stores the payment anchored on the largest private coin with a random id', () => {
        const smallerCoin = testMocks.getUtxo({
            ...ANCHOR_UTXO,
            txid: OTHER_TXID,
            amount: '200000',
        });
        const { result, actions } = create(
            { accounts: [{ ...ACCOUNT, utxo: [smallerCoin, ANCHOR_UTXO] }] },
            ` ${PAYEE.toUpperCase()}`,
        );

        expect(result).toBeUndefined();
        expect(actions).toEqual([
            coinjoinAccountSetPayment(ACCOUNT.key, {
                id: expect.stringMatching(/^[A-Za-z0-9]{16}$/),
                address: PAYEE,
                amount: 50_000,
                anchor: ANCHOR,
                attemptTxids: [],
            }),
        ]);
    });
});

describe('cancelCoinjoinPaymentThunk', () => {
    const initStore = (
        payment: CoinjoinAccountPayment,
        roundPhase?: RoundPhase,
        params: GetPaymentStateParams = {},
    ) => {
        const paymentState = getPaymentState({
            payment,
            session: { ...SESSION, authorizedPaymentId: PAYMENT.id, roundPhase },
            ...params,
        });
        const preloadedState: CancelCoinjoinPaymentThunkState = {
            ...paymentState,
            modal: { context: MODAL_CONTEXT_NONE },
        };

        return createTestCompositionRoot<void, CancelCoinjoinPaymentThunkState & ModalRootState>({
            preloadedState,
            reducer: (state = preloadedState, action: UnknownAction) => ({
                ...state,
                wallet: {
                    ...state.wallet,
                    coinjoin: coinjoinReducer(state.wallet.coinjoin, action as CoinjoinAction),
                },
            }),
        }).services.store;
    };
    const getPayment = (store: ReturnType<typeof initStore>) =>
        store.getState().wallet.coinjoin.accounts[0]?.payment;

    afterEach(() => {
        CoinjoinService.removeInstance(btc);
    });

    it('removes a payment without a signed attempt', () => {
        const store = initStore(PAYMENT);

        store.dispatch(cancelCoinjoinPaymentThunk(ACCOUNT.key));

        expect(getPayment(store)).toBeUndefined();
    });

    it('cancels a payment with a signed attempt and lets the client mix its anchor', async () => {
        const { client } = await CoinjoinService.createInstance({ symbol: btc });
        const store = initStore({ ...PAYMENT, attemptTxids: ['c3'.repeat(32)] });

        store.dispatch(cancelCoinjoinPaymentThunk(ACCOUNT.key));

        expect(getPayment(store)).toMatchObject({ isCancelled: true });
        expect(client.updateAccount).toHaveBeenCalledWith(
            expect.objectContaining({
                payment: expect.objectContaining({ id: PAYMENT.id, isCancelled: true }),
                utxos: [expect.objectContaining({ outpoint: ANCHOR })],
            }),
        );
    });

    it('drops a cancelled payment whose anchor a confirmed transaction already spent', async () => {
        const { client } = await CoinjoinService.createInstance({ symbol: btc });
        // A blocked payment whose anchor a round without the payment spent before the cancel.
        const store = initStore(
            {
                ...PAYMENT,
                amount: PAYMENT.amount + 1,
                attemptTxids: ['c3'.repeat(32)],
                isBlocked: true,
            },
            undefined,
            { accounts: [{ ...ACCOUNT, utxo: [] }], transactions: [getPaymentTransaction(100)] },
        );

        store.dispatch(cancelCoinjoinPaymentThunk(ACCOUNT.key));

        expect(getPayment(store)).toBeUndefined();
        expect(client.updateAccount).toHaveBeenCalledWith(
            expect.objectContaining({ payment: undefined, utxos: [] }),
        );
    });

    it('removes a paid payment', () => {
        const store = initStore({
            ...PAYMENT,
            attemptTxids: ['c3'.repeat(32)],
            paidTxid: 'c3'.repeat(32),
        });

        store.dispatch(cancelCoinjoinPaymentThunk(ACCOUNT.key));

        expect(getPayment(store)).toBeUndefined();
    });

    it('changes nothing in a critical phase', () => {
        const store = initStore(PAYMENT, RoundPhase.ConnectionConfirmation);

        store.dispatch(cancelCoinjoinPaymentThunk(ACCOUNT.key));

        expect(getPayment(store)).toEqual(PAYMENT);
    });
});
