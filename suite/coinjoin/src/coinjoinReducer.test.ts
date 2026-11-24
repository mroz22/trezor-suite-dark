import { ACCOUNT, PAYMENT, SESSION, btc } from './__fixtures__/coinjoinPayment';
import { actionFixtures, selectorFixtures } from './__fixtures__/coinjoinReducer';
import * as COINJOIN from './coinjoinConstants';
import { coinjoinAccountSetPayment } from './coinjoinPaymentActions';
import { type CoinjoinAction, coinjoinReducer, initialState } from './coinjoinReducer';
import { type CoinjoinRootState, selectRegisteredUtxosByAccountKey } from './coinjoinSelectors';
import { type CoinjoinSession, type CoinjoinState } from './coinjoinTypes';

describe('Coinjoin reducer actions', () => {
    actionFixtures.forEach(f => {
        it(f.description, () => {
            let state = f.initialState as unknown as CoinjoinState;
            f.actions.forEach(a => {
                state = coinjoinReducer(state, a as CoinjoinAction);
            });
            expect(state).toEqual(f.result);
        });
    });
});

describe('Coinjoin reducer selectors', () => {
    const selectors = { selectRegisteredUtxosByAccountKey };

    selectorFixtures.forEach(f => {
        it(`${f.selector}: ${f.description}`, () => {
            const state = {
                suite: {},
                wallet: {
                    accounts: [],
                    selectedAccount: {},
                    coinjoin: f.initialState,
                },
            } as unknown as CoinjoinRootState;

            const selectorFn = selectors[f.selector];
            const args = [state, ...f.selectorArgs] as unknown as Parameters<typeof selectorFn>;

            const result = selectorFn(...args);
            expect(result).toEqual(f.result);
        });
    });
});

// Suite Dark: pay in coinjoin.
describe('Coinjoin reducer payment', () => {
    const getState = (session?: CoinjoinSession): CoinjoinState => ({
        ...initialState,
        accounts: [{ key: ACCOUNT.key, symbol: btc, rawLiquidityClue: null, session }],
    });

    it('sets and removes the payment of the account', () => {
        const withPayment = coinjoinReducer(
            getState(),
            coinjoinAccountSetPayment(ACCOUNT.key, PAYMENT),
        );
        const withoutPayment = coinjoinReducer(
            withPayment,
            coinjoinAccountSetPayment(ACCOUNT.key, undefined),
        );

        expect(withPayment.accounts[0]?.payment).toEqual(PAYMENT);
        expect(withoutPayment.accounts[0]).not.toHaveProperty('payment');
    });

    it('keeps the payment the device authorized when a session starts or is restored', () => {
        const restore = (state: CoinjoinState, authorizedPaymentId?: string) =>
            coinjoinReducer(state, {
                type: COINJOIN.SESSION_RESTORE,
                payload: { accountKey: ACCOUNT.key, authorizedPaymentId },
            });
        const started = coinjoinReducer(getState(), {
            type: COINJOIN.ACCOUNT_AUTHORIZE_SUCCESS,
            payload: {
                accountKey: ACCOUNT.key,
                params: { ...SESSION, authorizedPaymentId: PAYMENT.id },
            },
        });
        const restored = restore(started, 'payment2');

        expect(started.accounts[0]?.session?.authorizedPaymentId).toBe(PAYMENT.id);
        expect(restored.accounts[0]?.session?.authorizedPaymentId).toBe('payment2');
        expect(restore(restored).accounts[0]?.session).not.toHaveProperty('authorizedPaymentId');
    });
});
