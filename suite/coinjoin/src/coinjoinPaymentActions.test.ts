import { testMocks } from '@suite-common/test-utils';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import {
    type CoinjoinPaymentAttempt,
    EndRoundState,
    RoundPhase,
    type SerializedCoinjoinRound,
} from '@trezor/coinjoin';
import { createMockDispatch } from '@trezor/redux-utils/mocks';

import {
    ACCOUNT,
    ANCHOR,
    ANCHOR_UTXO,
    type GetPaymentStateParams,
    PAYMENT,
    PAYMENT_DEVICE,
    SESSION,
    getPaymentState,
    getPaymentTransaction,
} from './__fixtures__/coinjoinPayment';
import {
    type BlockRejectedCoinjoinPaymentsThunkState,
    type RecordCoinjoinPaymentAttemptsThunkState,
    type SyncCoinjoinPaymentThunkState,
    blockRejectedCoinjoinPaymentsThunk,
    coinjoinAccountSetPayment,
    recordCoinjoinPaymentAttemptsThunk,
    syncCoinjoinPaymentThunk,
} from './coinjoinPaymentActions';

const ATTEMPT: CoinjoinPaymentAttempt = {
    accountKey: ACCOUNT.key,
    paymentId: PAYMENT.id,
    address: PAYMENT.address,
    amount: PAYMENT.amount,
    anchor: ANCHOR,
    txid: 'd4'.repeat(32),
    inputs: [ANCHOR],
};

const getMockDispatch = <TState>(state: TState) => {
    const getState = () => state;

    return { getState, ...createMockDispatch({ getState, extra: undefined }) };
};

describe('recordCoinjoinPaymentAttemptsThunk', () => {
    const record = (params: GetPaymentStateParams, attempts = [ATTEMPT]) => {
        const state: RecordCoinjoinPaymentAttemptsThunkState = getPaymentState({
            session: { ...SESSION, authorizedPaymentId: PAYMENT.id },
            ...params,
        });
        const { actions, dispatch, getState } = getMockDispatch(state);

        return {
            isRecorded: recordCoinjoinPaymentAttemptsThunk(ACCOUNT.key, attempts)(
                dispatch,
                getState,
            ),
            actions,
        };
    };

    it('stores the attempts of the authorized payment', () => {
        expect(record({})).toEqual({
            isRecorded: true,
            actions: [
                coinjoinAccountSetPayment(ACCOUNT.key, {
                    ...PAYMENT,
                    attemptTxids: [ATTEMPT.txid],
                }),
            ],
        });
        // Nothing new to store.
        expect(record({ payment: { ...PAYMENT, attemptTxids: [ATTEMPT.txid] } })).toEqual({
            isRecorded: true,
            actions: [],
        });
    });

    it.each<[string, GetPaymentStateParams, CoinjoinPaymentAttempt[]]>([
        ['of another payment', {}, [{ ...ATTEMPT, paymentId: 'other' }]],
        ['of a payment the session did not authorize', { session: SESSION }, [ATTEMPT]],
        ['of a cancelled payment', { payment: { ...PAYMENT, isCancelled: true } }, [ATTEMPT]],
        [
            'on a wallet that is not remembered',
            { devices: [{ ...PAYMENT_DEVICE, remember: false }] },
            [ATTEMPT],
        ],
        ['without a payment', { payment: null }, [ATTEMPT]],
    ])('refuses attempts %s', (_name, params, attempts) => {
        expect(record(params, attempts)).toEqual({ isRecorded: false, actions: [] });
    });
});

describe('blockRejectedCoinjoinPaymentsThunk', () => {
    const block = (
        rejectedPayments: SerializedCoinjoinRound['rejectedPayments'],
        payment = PAYMENT,
    ) => {
        const state: BlockRejectedCoinjoinPaymentsThunkState = getPaymentState({ payment });
        const { actions, dispatch, getState } = getMockDispatch(state);
        const round: SerializedCoinjoinRound = {
            id: '01',
            phase: RoundPhase.OutputRegistration,
            endRoundState: EndRoundState.None,
            inputs: [],
            failed: [],
            addresses: [],
            phaseDeadline: 0,
            roundDeadline: 0,
            payments: [],
            rejectedPayments,
        };
        blockRejectedCoinjoinPaymentsThunk(round)(dispatch, getState);

        return actions;
    };

    it('blocks a payment the coordinator refused for its payee or amount', () => {
        expect(
            block([{ accountKey: ACCOUNT.key, paymentId: PAYMENT.id, isBlocked: true }]),
        ).toEqual([coinjoinAccountSetPayment(ACCOUNT.key, { ...PAYMENT, isBlocked: true })]);
    });

    it('keeps a payment refused for another reason, another payment and a blocked one', () => {
        expect(
            block([{ accountKey: ACCOUNT.key, paymentId: PAYMENT.id, isBlocked: false }]),
        ).toEqual([]);
        expect(block([{ accountKey: ACCOUNT.key, paymentId: 'other', isBlocked: true }])).toEqual(
            [],
        );
        expect(
            block([{ accountKey: ACCOUNT.key, paymentId: PAYMENT.id, isBlocked: true }], {
                ...PAYMENT,
                isBlocked: true,
            }),
        ).toEqual([]);
    });
});

describe('syncCoinjoinPaymentThunk', () => {
    const sync = (params: GetPaymentStateParams) => {
        const state: SyncCoinjoinPaymentThunkState = getPaymentState(params);
        const { actions, dispatch, getState } = getMockDispatch(state);
        syncCoinjoinPaymentThunk(ACCOUNT.key)(dispatch, getState);

        return actions;
    };

    it('marks the payment paid once its transaction confirms', () => {
        const transaction = getPaymentTransaction(100);

        expect(sync({ transactions: [transaction] })).toEqual([
            coinjoinAccountSetPayment(ACCOUNT.key, { ...PAYMENT, paidTxid: transaction.txid }),
        ]);
        expect(sync({ transactions: [getPaymentTransaction(-1)] })).toEqual([]);
    });

    it('anchors the payment on the largest private coin once its anchor is spent without it', () => {
        const spendTransaction = getPaymentTransaction(100);
        const newCoin = testMocks.getUtxo({ ...ANCHOR_UTXO, txid: 'e5'.repeat(32), vout: 0 });

        expect(
            sync({
                accounts: [{ ...ACCOUNT, utxo: [newCoin] }],
                payment: {
                    ...PAYMENT,
                    amount: PAYMENT.amount + 1,
                    attemptTxids: ['f6'.repeat(32)],
                },
                transactions: [spendTransaction],
            }),
        ).toEqual([
            coinjoinAccountSetPayment(ACCOUNT.key, {
                ...PAYMENT,
                amount: PAYMENT.amount + 1,
                id: expect.not.stringMatching(PAYMENT.id),
                anchor: getUtxoOutpoint(newCoin),
                attemptTxids: [],
            }),
        ]);
    });

    it('changes nothing in a critical phase', () => {
        expect(
            sync({
                session: { ...SESSION, roundPhase: 2 },
                transactions: [getPaymentTransaction(100)],
            }),
        ).toEqual([]);
    });
});
