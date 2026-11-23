import { networks } from '@trezor/utxo-lib';

import {
    canIncludePayment,
    getAccountPayment,
    getInputEffectiveValue,
    getPaymentCost,
    getPaymentDestination,
    getPendingPayment,
    getRegisteredScripts,
    getRemainderLimits,
    getRemainingAmounts,
    getSigningPayments,
    isScriptInRound,
} from './paymentUtils';
import { createInput } from '../__fixtures__/input.fixture';
import { DEFAULT_ROUND, ROUND_CREATION_EVENT } from '../__fixtures__/round.fixture';
import { RoundPhase } from '../enums';
import type { AccountPayment, CoinjoinPayment } from '../types/account';
import type { CoinjoinRoundParameters, CoinjoinState, Round } from '../types/coordinator';

const P2WPKH_ADDRESS = 'bc1qkkr2uvry034tsj4p52za2pg42ug4pxg5qfxyfa';
const P2WPKH_SCRIPT = '0 b586ae30647c6ab84aa1a285d505155711509914';
const P2WPKH_SCRIPT_HEX = '0014b586ae30647c6ab84aa1a285d505155711509914';
const P2TR_ADDRESS = 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2';
const P2TR_SCRIPT = '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c';
const P2TR_SCRIPT_HEX = '5120b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c';

const PAYMENT: CoinjoinPayment = {
    id: 'payment-1',
    address: P2WPKH_ADDRESS,
    amount: 100000,
    anchor: `${'ab'.repeat(32)}00000000`,
};

const ACCOUNT_PAYMENT: AccountPayment = {
    ...PAYMENT,
    isCancelled: false,
    scriptType: 'P2WPKH',
    scriptPubKey: P2WPKH_SCRIPT,
    scriptPubKeyHex: P2WPKH_SCRIPT_HEX,
    outputSize: 31,
};

// 2 sat/vB, no coordination fee, minimum input and output amounts 5000
const ROUND_PARAMETERS: CoinjoinRoundParameters = {
    ...ROUND_CREATION_EVENT.RoundParameters,
    MiningFeeRate: 2000,
    CoordinationFeeRate: { Rate: 0, PlebsDontPayThreshold: 1000000 },
};

describe('paymentUtils', () => {
    it('getPaymentDestination', () => {
        expect(getPaymentDestination(P2WPKH_ADDRESS, networks.bitcoin)).toEqual({
            scriptType: 'P2WPKH',
            scriptPubKey: P2WPKH_SCRIPT,
            scriptPubKeyHex: P2WPKH_SCRIPT_HEX,
            outputSize: 31,
        });
        expect(getPaymentDestination(P2TR_ADDRESS, networks.bitcoin)).toEqual({
            scriptType: 'Taproot',
            scriptPubKey: P2TR_SCRIPT,
            scriptPubKeyHex: P2TR_SCRIPT_HEX,
            outputSize: 43,
        });

        [
            '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', // P2PKH
            '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', // P2SH
            'bc1q5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxquwd2ql', // P2WSH
            'not an address',
            '',
        ].forEach(address => {
            expect(getPaymentDestination(address, networks.bitcoin)).toBeUndefined();
        });

        // address of another network
        expect(getPaymentDestination(P2WPKH_ADDRESS, networks.testnet)).toBeUndefined();
    });

    it('getAccountPayment', () => {
        const params = { network: networks.bitcoin, utxos: [], changeAddresses: [] };

        expect(getAccountPayment({ ...params, payment: undefined })).toBeUndefined();
        // the anchor does not have to be among the utxos
        expect(getAccountPayment({ ...params, payment: PAYMENT })).toEqual(ACCOUNT_PAYMENT);
        expect(
            getAccountPayment({
                ...params,
                payment: { ...PAYMENT, address: P2TR_ADDRESS, isCancelled: true },
            }),
        ).toMatchObject({ isCancelled: true, scriptType: 'Taproot', outputSize: 43 });

        [
            { amount: 9999 },
            { amount: 10000.5 },
            { amount: Number.MAX_SAFE_INTEGER + 1 },
            { id: '' },
            { id: '~~payment~~' },
            { anchor: PAYMENT.anchor.slice(1) },
            { anchor: `${'xy'.repeat(32)}00000000` },
            { address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy' },
        ].forEach(invalid => {
            expect(
                getAccountPayment({ ...params, payment: { ...PAYMENT, ...invalid } }),
            ).toBeUndefined();
        });

        // payee is an address of the account
        expect(
            getAccountPayment({
                ...params,
                payment: PAYMENT,
                changeAddresses: [{ path: 'm/1', address: '', scriptPubKey: P2WPKH_SCRIPT }],
            }),
        ).toBeUndefined();
        expect(
            getAccountPayment({
                ...params,
                payment: PAYMENT,
                utxos: [
                    {
                        path: 'm/1',
                        outpoint: PAYMENT.anchor,
                        address: P2WPKH_ADDRESS,
                        scriptPubKey: P2WPKH_SCRIPT_HEX,
                        amount: 200000,
                        anonymityLevel: 1,
                    },
                ],
            }),
        ).toBeUndefined();
    });

    it('getPendingPayment', () => {
        expect(getPendingPayment({ blockedPaymentIds: [] })).toBeUndefined();
        expect(getPendingPayment({ payment: ACCOUNT_PAYMENT, blockedPaymentIds: [] })).toBe(
            ACCOUNT_PAYMENT,
        );
        expect(
            getPendingPayment({
                payment: { ...ACCOUNT_PAYMENT, isCancelled: true },
                blockedPaymentIds: [],
            }),
        ).toBeUndefined();
        expect(
            getPendingPayment({ payment: ACCOUNT_PAYMENT, blockedPaymentIds: [PAYMENT.id] }),
        ).toBeUndefined();
    });

    it('getPaymentCost', () => {
        expect(getPaymentCost(ACCOUNT_PAYMENT, 2000)).toEqual(100062);
        expect(getPaymentCost({ ...ACCOUNT_PAYMENT, outputSize: 43 }, 2000)).toEqual(100086);
    });

    it('canIncludePayment', () => {
        expect(canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', ROUND_PARAMETERS)).toBe(true);
        expect(
            canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', {
                ...ROUND_PARAMETERS,
                AllowedOutputTypes: ['Taproot'],
            }),
        ).toBe(false);
        expect(
            canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', {
                ...ROUND_PARAMETERS,
                AllowedInputTypes: ['P2WPKH'],
            }),
        ).toBe(false);
        expect(
            canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', {
                ...ROUND_PARAMETERS,
                AllowedOutputAmounts: { Min: 100001, Max: 1000000 },
            }),
        ).toBe(false);
        expect(
            canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', {
                ...ROUND_PARAMETERS,
                AllowedOutputAmounts: { Min: 5000, Max: 99999 },
            }),
        ).toBe(false);
        expect(
            canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', {
                ...ROUND_PARAMETERS,
                MaxAmountCredentialValue: 100061,
            }),
        ).toBe(false);
        expect(
            canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', {
                ...ROUND_PARAMETERS,
                MaxAmountCredentialValue: 100062,
            }),
        ).toBe(true);
    });

    it('canIncludePayment with NBitcoin ScriptType values', () => {
        // WalletWasabi coordinators send the values, P2WPKH is 4 and Taproot 7
        const withTypes = (
            AllowedInputTypes: CoinjoinRoundParameters['AllowedInputTypes'],
            AllowedOutputTypes: CoinjoinRoundParameters['AllowedOutputTypes'],
        ) => ({ ...ROUND_PARAMETERS, AllowedInputTypes, AllowedOutputTypes });
        const taprootPayment: AccountPayment = {
            ...ACCOUNT_PAYMENT,
            scriptType: 'Taproot',
            scriptPubKey: P2TR_SCRIPT,
            scriptPubKeyHex: P2TR_SCRIPT_HEX,
            outputSize: 43,
        };

        expect(canIncludePayment(ACCOUNT_PAYMENT, 'Taproot', withTypes([4, 7], [4, 7]))).toBe(true);
        expect(
            canIncludePayment(
                ACCOUNT_PAYMENT,
                'Taproot',
                withTypes(['P2WPKH', 'Taproot'], ['P2WPKH', 'Taproot']),
            ),
        ).toBe(true);
        expect(canIncludePayment(taprootPayment, 'Taproot', withTypes([7], [4]))).toBe(false);
        expect(canIncludePayment(ACCOUNT_PAYMENT, 'P2WPKH', withTypes([7], [4]))).toBe(false);
        expect(canIncludePayment(taprootPayment, 'P2WPKH', withTypes([4], [7]))).toBe(true);
        // other NBitcoin values, P2WSH is 5
        expect(canIncludePayment(ACCOUNT_PAYMENT, 'P2WPKH', withTypes([4], [5]))).toBe(false);
    });

    it('getSigningPayments', () => {
        const payment = (accountKey: string) => ({
            accountKey,
            paymentId: `payment-${accountKey}`,
            address: P2WPKH_ADDRESS,
            scriptPubKey: P2WPKH_SCRIPT,
            scriptPubKeyHex: P2WPKH_SCRIPT_HEX,
            amount: 100000,
            anchor: PAYMENT.anchor,
        });
        const inputs = [createInput('account-A', PAYMENT.anchor)];

        expect(
            getSigningPayments({ payments: [payment('account-A'), payment('account-B')], inputs }),
        ).toEqual([payment('account-A')]);
        expect(getSigningPayments({ payments: [payment('account-B')], inputs: [] })).toEqual([]);
    });

    it('getInputEffectiveValue', () => {
        // mining fee for 58 vB
        expect(getInputEffectiveValue(200000, 'Taproot', ROUND_PARAMETERS)).toEqual(199884);
        const withCoordinationFee = {
            ...ROUND_PARAMETERS,
            CoordinationFeeRate: { Rate: 0.003, PlebsDontPayThreshold: 1000000 },
        };
        // no coordination fee up to the threshold
        expect(getInputEffectiveValue(1000000, 'Taproot', withCoordinationFee)).toEqual(999884);
        expect(getInputEffectiveValue(2000000, 'Taproot', withCoordinationFee)).toEqual(
            2000000 - 116 - 6000,
        );
    });

    it('getRemainderLimits', () => {
        expect(getRemainderLimits(ROUND_PARAMETERS, 43)).toEqual({
            maxDust: 5086,
            minChange: 5086,
        });
        expect(
            getRemainderLimits(
                {
                    ...ROUND_PARAMETERS,
                    AllowedInputAmounts: { Min: 1000, Max: 1000000 },
                    AllowedOutputAmounts: { Min: 10000, Max: 1000000 },
                },
                43,
            ),
        ).toEqual({ maxDust: 1086, minChange: 10086 });
    });

    it('getRemainingAmounts', () => {
        expect(getRemainingAmounts([60000, 50000, 8000], 100062)).toEqual([8000, 9938]);
        expect(getRemainingAmounts([8000, 60000, 40062], 100062)).toEqual([8000]);
        expect(getRemainingAmounts([60000, 40062], 100062)).toEqual([]);
        expect(getRemainingAmounts([150000], 100062)).toEqual([49938]);
    });

    it('getRegisteredScripts and isScriptInRound', () => {
        const coinjoinState: CoinjoinState = {
            Type: '',
            Events: [
                {
                    Type: 'InputAdded',
                    Coin: {
                        Outpoint: PAYMENT.anchor,
                        TxOut: { ScriptPubKey: P2TR_SCRIPT.toUpperCase(), Value: 10000 },
                    },
                    OwnershipProof: '',
                },
                {
                    Type: 'OutputAdded',
                    Output: { ScriptPubKey: P2WPKH_SCRIPT, Value: 10000 },
                },
                {
                    Type: 'OutputAdded',
                    Output: { ScriptPubKey: 'malformed script', Value: 10000 },
                },
            ],
        };
        const round = (Phase: Round['Phase']): Round => ({
            ...DEFAULT_ROUND,
            Phase,
            CoinjoinState: coinjoinState,
        });

        expect(getRegisteredScripts([round(RoundPhase.OutputRegistration)])).toEqual(
            new Set([P2TR_SCRIPT_HEX, P2WPKH_SCRIPT_HEX]),
        );
        // outputs of an ended round may be registered again
        expect(getRegisteredScripts([round(RoundPhase.Ended)])).toEqual(new Set([P2TR_SCRIPT_HEX]));
        expect(getRegisteredScripts([])).toEqual(new Set());

        expect(isScriptInRound(coinjoinState, P2TR_SCRIPT_HEX)).toBe(true);
        expect(isScriptInRound(coinjoinState, P2WPKH_SCRIPT_HEX)).toBe(true);
        expect(isScriptInRound(coinjoinState, `0014${'00'.repeat(20)}`)).toBe(false);
    });
});
