import { mockSuiteDevice } from '@suite-common/suite-types/mocks';
import { testMocks } from '@suite-common/test-utils';
import { asAccountDescriptor } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';

import {
    ACCOUNT,
    ANCHOR,
    CHANGE_ADDRESS,
    DEVICE_STATE,
    type GetPaymentStateParams,
    OTHER_PAYEE,
    PAID_ADDRESS,
    PAYEE,
    PAYMENT,
    PAYMENT_DEVICE,
    RECEIVE_ADDRESS,
    SESSION,
    btc,
    getPaymentState,
    getPaymentTransaction,
} from './__fixtures__/coinjoinPayment';
import {
    selectCoinjoinPaymentErrorByAccountKey,
    selectCoinjoinPaymentFundingByAccountKey,
    selectCoinjoinPaymentStatusByAccountKey,
    selectCoinjoinPaymentToAuthorizeByAccountKey,
    selectIsCoinjoinPaymentAvailableByAccountKey,
} from './coinjoinPaymentSelectors';
import { type CoinjoinAccount, type CoinjoinAccountPayment } from './coinjoinTypes';

describe('selectIsCoinjoinPaymentAvailableByAccountKey', () => {
    it('needs the remembered device of the account with the capability, without auto-eject', () => {
        const isAvailable = (params: GetPaymentStateParams) =>
            selectIsCoinjoinPaymentAvailableByAccountKey(getPaymentState(params), ACCOUNT.key);

        expect(isAvailable({})).toBe(true);
        expect(isAvailable({ isAutoEjectEnabled: true })).toBe(false);
        expect(isAvailable({ devices: [{ ...PAYMENT_DEVICE, remember: false }] })).toBe(false);
        expect(
            isAvailable({
                devices: [
                    mockSuiteDevice(
                        { state: { staticSessionId: DEVICE_STATE }, remember: true },
                        { capabilities: ['Capability_Bitcoin'] },
                    ),
                ],
            }),
        ).toBe(false);
        expect(isAvailable({ devices: [] })).toBe(false);
    });
});

describe('selectCoinjoinPaymentToAuthorizeByAccountKey', () => {
    const select = (params: GetPaymentStateParams) =>
        selectCoinjoinPaymentToAuthorizeByAccountKey(getPaymentState(params), ACCOUNT.key);

    it('authorizes a pending payment whose anchor is a confirmed coin', () => {
        expect(select({})).toBe(PAYMENT);
    });

    it('authorizes no paid, cancelled, blocked or unavailable payment, nor a spent anchor', () => {
        expect(select({ payment: { ...PAYMENT, paidTxid: 'b2'.repeat(32) } })).toBeUndefined();
        expect(select({ payment: { ...PAYMENT, isCancelled: true } })).toBeUndefined();
        expect(select({ payment: { ...PAYMENT, isBlocked: true } })).toBeUndefined();
        expect(select({ isAutoEjectEnabled: true })).toBeUndefined();
        expect(
            select({
                payment: {
                    ...PAYMENT,
                    anchor: getUtxoOutpoint({ txid: 'c3'.repeat(32), vout: 0 }),
                },
            }),
        ).toBeUndefined();
    });
});

describe('selectCoinjoinPaymentFundingByAccountKey', () => {
    it('uses the limits of the session if there is one', () => {
        const withoutSession = getPaymentState({ payment: null });
        const withSession = getPaymentState({
            payment: null,
            session: { ...SESSION, maxFeePerKvbyte: 10_000 },
        });

        // A P2WPKH payee and a Taproot input at the default 5 sat/vB, then at 10 sat/vB.
        expect(
            selectCoinjoinPaymentFundingByAccountKey(withoutSession, ACCOUNT.key, PAYEE),
        ).toEqual({
            anchor: ANCHOR,
            maxAmount: 300_000 - (31 + 58) * 5 - 10_000,
        });
        expect(selectCoinjoinPaymentFundingByAccountKey(withSession, ACCOUNT.key, PAYEE)).toEqual({
            anchor: ANCHOR,
            maxAmount: 300_000 - (31 + 58) * 10 - 10_000,
        });
        expect(
            selectCoinjoinPaymentFundingByAccountKey(
                getPaymentState({ payment: null, session: { ...SESSION, targetAnonymity: 20 } }),
                ACCOUNT.key,
                PAYEE,
            )?.anchor,
        ).toBeUndefined();
    });
});

describe('selectCoinjoinPaymentErrorByAccountKey', () => {
    const getError = (address: string, params: GetPaymentStateParams = {}) =>
        selectCoinjoinPaymentErrorByAccountKey(
            getPaymentState({ payment: null, ...params }),
            ACCOUNT.key,
            { address, amount: 50_000 },
        );

    it('refuses any address of the account', () => {
        expect(getError(PAYEE)).toBeUndefined();
        expect(getError(RECEIVE_ADDRESS)).toBe('OWN_ADDRESS');
        expect(getError(CHANGE_ADDRESS)).toBe('OWN_ADDRESS');
    });

    it('refuses an address paid in the history or paid by another account of the network', () => {
        const paidTransaction = testMocks.getWalletTransaction();
        const transactions = [
            {
                ...paidTransaction,
                details: {
                    ...paidTransaction.details,
                    vout: [{ n: 0, isAddress: true, addresses: [PAID_ADDRESS], value: '1' }],
                },
            },
        ];
        const otherAccount = (payment: CoinjoinAccountPayment): CoinjoinAccount => ({
            key: mockWalletAccount({ symbol: btc, descriptor: asAccountDescriptor('other') }).key,
            symbol: btc,
            rawLiquidityClue: null,
            payment,
        });

        expect(getError(PAID_ADDRESS, { transactions })).toBe('ADDRESS_IN_USE');
        expect(
            getError(OTHER_PAYEE, {
                otherCoinjoinAccounts: [
                    otherAccount({ ...PAYMENT, address: OTHER_PAYEE, isCancelled: true }),
                ],
            }),
        ).toBe('ADDRESS_IN_USE');
        expect(
            getError(OTHER_PAYEE, {
                otherCoinjoinAccounts: [
                    otherAccount({ ...PAYMENT, address: OTHER_PAYEE, paidTxid: 'b2'.repeat(32) }),
                ],
            }),
        ).toBeUndefined();
    });

    it('allows a new payment next to a paid one and with a paused session only', () => {
        expect(getError(PAYEE, { payment: PAYMENT })).toBe('PAYMENT_EXISTS');
        expect(
            getError(PAYEE, { payment: { ...PAYMENT, paidTxid: 'b2'.repeat(32) } }),
        ).toBeUndefined();
        expect(getError(PAYEE, { session: SESSION })).toBe('COINJOIN_RUNNING');
        expect(getError(PAYEE, { session: { ...SESSION, paused: true } })).toBeUndefined();
    });
});

describe('selectCoinjoinPaymentStatusByAccountKey', () => {
    const getStatus = (params: GetPaymentStateParams) =>
        selectCoinjoinPaymentStatusByAccountKey(getPaymentState(params), ACCOUNT.key);

    it.each<[string, string, GetPaymentStateParams]>([
        ['paid', 'confirmed', { payment: { ...PAYMENT, paidTxid: 'b2'.repeat(32) } }],
        ['cancelled', 'cancelled', { payment: { ...PAYMENT, isCancelled: true } }],
        [
            'sending',
            'in an unconfirmed transaction',
            { payment: { ...PAYMENT, isBlocked: true }, transactions: [getPaymentTransaction(-1)] },
        ],
        ['blocked', 'refused by the coordinator', { payment: { ...PAYMENT, isBlocked: true } }],
        [
            'unavailable',
            'with auto-eject on',
            { session: { ...SESSION, paused: true }, isAutoEjectEnabled: true },
        ],
        [
            'paused',
            'in a paused session',
            { session: { ...SESSION, paused: true, authorizedPaymentId: PAYMENT.id } },
        ],
        [
            'needs-restart',
            'not authorized by the running session',
            { session: { ...SESSION, authorizedPaymentId: 'other' } },
        ],
        [
            'waiting',
            'authorized by the running session',
            { session: { ...SESSION, authorizedPaymentId: PAYMENT.id } },
        ],
        ['waiting', 'without a session', {}],
    ])('is %s %s', (status, _description, params) => {
        expect(getStatus(params)).toBe(status);
    });

    it('has no status without a payment', () => {
        expect(getStatus({ payment: null })).toBeUndefined();
    });
});
