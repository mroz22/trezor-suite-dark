import { testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import type { Account } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { DISCOVERY_LOOKOUT } from '@trezor/coinjoin';

import * as fixtures from './__fixtures__/coinjoinUtils';
import { type CoinjoinAccountPayment } from './coinjoinTypes';
import * as coinjoinUtils from './coinjoinUtils';

describe('breakdownCoinjoinBalance', () => {
    it('works without session', () => {
        const breakdown = coinjoinUtils.breakdownCoinjoinBalance(fixtures.breakdownParams);

        expect(breakdown).toEqual({
            notAnonymized: '200',
            anonymized: '100',
        });
    });
});

describe('calculateAnonymityProgress', () => {
    it('calculates correctly', () => {
        fixtures.calculateProgressParams.forEach(({ params, result }) => {
            const progress = coinjoinUtils.calculateAnonymityProgress(params);

            expect(progress).toEqual(result);
        });
    });
});

describe('getRoundPhaseFromSessionPhase', () => {
    it('gets correct value or throws', () => {
        fixtures.getRoundPhaseFromSessionPhase.forEach(({ sessionPhase, result }) => {
            const getSessionPhase = () => coinjoinUtils.getRoundPhaseFromSessionPhase(sessionPhase);

            if (result === 'error') {
                expect(getSessionPhase).toThrow();
            } else {
                expect(getSessionPhase()).toEqual(result);
            }
        });
    });
});

describe('getFirstSessionPhaseFromRoundPhase', () => {
    it('gets correct value or throws', () => {
        fixtures.getFirstSessionPhaseFromRoundPhase.forEach(({ roundPhase, result }) => {
            const getSessionPhase = () =>
                coinjoinUtils.getFirstSessionPhaseFromRoundPhase(roundPhase);

            if (result === 'error') {
                expect(getSessionPhase).toThrow();
            } else {
                expect(getSessionPhase()).toEqual(result);
            }
        });
    });
});

describe('cleanAnonymityGains', () => {
    it('cleans correctly', () => {
        fixtures.cleanAnonymityGains.forEach(({ params, resultLength }) => {
            const records = coinjoinUtils.cleanAnonymityGains(params);

            expect(records).toHaveLength(resultLength);
        });
    });
});

describe('calculateAverageAnonymityGainPerRound', () => {
    it('calculates correctly', () => {
        fixtures.averageAnonymityGainsParams.forEach(({ params, checkResult }) => {
            const average = coinjoinUtils.calculateAverageAnonymityGainPerRound(...params);

            expect(checkResult(average)).toBe(true);
        });
    });
});

describe('getRegisterAccountParams', () => {
    const SESSION = {
        targetAnonymity: 10,
        maxRounds: 10,
        maxFeePerKvbyte: 1,
        maxCoordinatorFeeRate: 0.003,
    };
    const getIndexes = (from: number, to: number) =>
        Array.from({ length: to - from + 1 }, (_, index) => from + index);

    // Account with change addresses 0 to 69, those with the given indexes have a confirmed
    // transaction.
    const createAccount = (usedIndexes: number[], utxo: Account['utxo'] = []) =>
        mockWalletAccount({
            symbol: asNetworkSymbol('btc'),
            path: "m/10025'/0'/0'/1'",
            addresses: {
                change: getIndexes(0, 69).map(index => ({
                    address: `bc1p${index}`,
                    path: `m/10025'/0'/0'/1'/1/${index}`,
                    transfers: usedIndexes.includes(index) ? 1 : 0,
                    balance: '0',
                    sent: '0',
                    received: '0',
                })),
                used: [],
                unused: [],
            },
            utxo,
        });
    const getChangeAddressIndexes = (account: Account) =>
        coinjoinUtils
            .getRegisterAccountParams(account, { rawLiquidityClue: null, session: SESSION })
            .changeAddresses.map(({ address }) => Number(address.slice('bc1p'.length)));

    it('takes DISCOVERY_LOOKOUT change addresses after the last used one', () => {
        expect(DISCOVERY_LOOKOUT).toBe(20);
        expect(getChangeAddressIndexes(createAccount([]))).toEqual(getIndexes(0, 19));
        // unused addresses below the last used one are left out
        expect(getChangeAddressIndexes(createAccount([3, 10]))).toEqual(getIndexes(11, 30));
    });

    it('leaves out change addresses with an unconfirmed output', () => {
        const account = createAccount(
            [10],
            [testMocks.getUtxo({ address: 'bc1p12', confirmations: 0 })],
        );

        expect(getChangeAddressIndexes(account)).toEqual(
            getIndexes(11, 30).filter(index => index !== 12),
        );
    });

    // Suite Dark: pay in coinjoin.
    describe('with a payment', () => {
        const anchorUtxo = testMocks.getUtxo({
            txid: 'a1'.repeat(32),
            vout: 1,
            address: 'bc1p20',
            path: "m/10025'/0'/0'/1'/1/20",
        });
        const otherUtxo = testMocks.getUtxo({ txid: 'b2'.repeat(32), vout: 0, address: 'bc1p40' });
        const anchor = getUtxoOutpoint(anchorUtxo);
        const payment: CoinjoinAccountPayment = {
            id: 'payment1',
            address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            amount: 50_000,
            anchor,
            attemptTxids: [],
        };
        const account = createAccount([10], [anchorUtxo, otherUtxo]);
        const getParams = (accountPayment: CoinjoinAccountPayment, authorizedPaymentId?: string) =>
            coinjoinUtils.getRegisterAccountParams(account, {
                rawLiquidityClue: null,
                session: { ...SESSION, authorizedPaymentId },
                payment: accountPayment,
            });

        it('passes the payment the device authorized', () => {
            const params = getParams(payment, payment.id);

            expect(params.payment).toEqual({
                id: payment.id,
                address: payment.address,
                amount: payment.amount,
                anchor,
            });
            expect(params.utxos.map(({ outpoint }) => outpoint)).toContain(anchor);
        });

        it.each([
            ['a payment the device did not authorize', payment, 'other'],
            ['a blocked payment', { ...payment, isBlocked: true }, payment.id],
        ])('holds back the anchor of %s', (_name, accountPayment, authorizedPaymentId) => {
            const params = getParams(accountPayment, authorizedPaymentId);

            expect(params.payment).toBeUndefined();
            expect(params.utxos.map(({ outpoint }) => outpoint)).toEqual([
                getUtxoOutpoint(otherUtxo),
            ]);
            // The address of the anchor, within the change addresses the client gets, still gets
            // no change output.
            expect(params.changeAddresses.map(({ address }) => address)).toEqual(
                getIndexes(11, 30)
                    .filter(index => index !== 20)
                    .map(index => `bc1p${index}`),
            );
        });

        it('passes a cancelled payment and mixes its anchor', () => {
            const params = getParams({ ...payment, isCancelled: true });

            expect(params.payment).toMatchObject({ id: payment.id, isCancelled: true });
            expect(params.utxos.map(({ outpoint }) => outpoint)).toContain(anchor);
        });
    });
});

describe('getChangeAddressesUpToLastUsed', () => {
    it('returns used and unused change addresses up to the last used one', () => {
        const change = [0, 1, 2, 3].map(index => ({
            address: `bc1p${index}`,
            path: `m/10025'/0'/0'/1'/1/${index}`,
            transfers: index === 2 ? 1 : 0,
            balance: '0',
            sent: '0',
            received: '0',
        }));

        expect(
            coinjoinUtils.getChangeAddressesUpToLastUsed(change).map(({ address }) => address),
        ).toEqual(['bc1p0', 'bc1p1', 'bc1p2']);
        expect(coinjoinUtils.getChangeAddressesUpToLastUsed(change.slice(0, 2))).toEqual([]);
    });
});
