import {
    ACCOUNT,
    outputDecomposition as fixtures,
} from './__fixtures__/outputDecomposition.fixture';
import { outputDecomposition, setAccountError } from './outputDecomposition';
import { createServer } from '../../../mocks/server';
import { createInput } from '../../__fixtures__/input.fixture';
import {
    INPUT_ADDED_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../../__fixtures__/round.fixture';
import { SessionPhase } from '../../enums';
import type { AccountPayment } from '../../types/account';
import type { CoinjoinRoundParameters, CoinjoinStateEvent } from '../../types/coordinator';
import { redacted } from '../../utils/redacted';
import { CoinjoinPrison } from '../CoinjoinPrison';
import { CoordinatorMisbehaviorError } from '../coordinator';

let server: Awaited<ReturnType<typeof createServer>>;

describe('outputRegistration', () => {
    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        if (server) server.close();
    });

    it('outputDecomposition errors. missing data in input', async () => {
        await expect(
            outputDecomposition(
                createCoinjoinRound([createInput('account-A', 'A1')], {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                    },
                }),
                [],
                server?.requestOptions,
            ),
        ).rejects.toThrow('Missing confirmed credentials');
    });

    it('outputDecomposition in a blame round counts the outputs of the failed round', async () => {
        const availableVsize: number[] = [];
        server?.addListener('test-request', ({ url, resolve, data }) => {
            if (url.endsWith('/get-outputs-amounts')) {
                availableVsize.push(data.AvailableVsize);
                resolve({ OutputAmounts: [20000] });
            }
            resolve();
        });

        const blameOf = 'B'.repeat(64);
        const prison = new CoinjoinPrison();
        // Registered in the failed round, its blame round registers them again.
        prison.detainRegisteredOutput({ accountKey: 'account-A', address: 'bc1p0' }, blameOf);
        prison.detainRegisteredOutput({ accountKey: 'account-A', address: 'bc1p1' }, blameOf);
        // Registered in another failed round.
        prison.detainRegisteredOutput(
            { accountKey: 'account-A', address: 'bc1p2' },
            'C'.repeat(64),
        );

        const input = createInput(
            'account-A',
            'A00000000000000000000000000000000000000000000000000000000000000001000000',
            {
                confirmedAmountCredentials: [{ Value: 30000 }, { Value: 0 }],
                confirmedVsizeCredentials: [{ Value: 197 }, { Value: 0 }],
            },
        );
        const response = await outputDecomposition(
            createCoinjoinRound([input], {
                ...server?.requestOptions,
                prison,
                round: {
                    phase: 3,
                    blameOf,
                    coinjoinState: { Type: '', Events: [createInputAddedEvent(input.outpoint)] },
                },
                roundParameters: { MiningFeeRate: 2000 },
            }),
            [
                {
                    ...ACCOUNT,
                    changeAddresses: ['bc1p0', 'bc1p1', 'bc1p2'].map(address => ({ address })),
                },
            ],
            server?.requestOptions,
        );

        // No address is free, the two of the failed round take an output each.
        expect(availableVsize).toEqual([2 * 43]);
        expect(response).toMatchObject([{ outputs: [{ amount: 20086 }] }]);
    });

    fixtures.forEach(f => {
        it(`outputDecomposition ${f.description}`, async () => {
            const spy = jest.fn();
            const availableVsize: number[] = [];
            server?.addListener('test-request', ({ url, resolve, data }) => {
                if (url.endsWith('/get-outputs-amounts')) {
                    availableVsize.push(data.AvailableVsize);
                    resolve({
                        OutputAmounts: f.outputAmounts,
                    });
                }
                if (url.endsWith('/credential-issuance')) {
                    spy();
                }
                resolve();
            });

            // NOTE: scriptPubKey is only used to calculate external output size, it can be reused for all inputs
            const ScriptPubKey =
                '1 6a6daebd9abae25cdd376b811190163eb00c58e87da1867ba8546229098231c3';
            const inputs = f.inputs.map(i => createInput(...(i as Parameters<typeof createInput>)));
            const events: any[] = inputs.map(i => ({
                Type: 'InputAdded',
                Coin: {
                    Outpoint: i.outpoint,
                    TxOut: {
                        ScriptPubKey,
                        Value: i.amount,
                    },
                },
            }));

            const response = await outputDecomposition(
                createCoinjoinRound(inputs, {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                        coinjoinState: {
                            Type: '',
                            Events: [...events, INPUT_ADDED_EVENT],
                        },
                    },
                    roundParameters: f.roundParameters,
                }),
                f.accounts,
                server?.requestOptions,
            );

            expect(response.length).toBe(f.result.length);
            response.forEach((r, i) => {
                const { result } = f;
                // @ts-expect-error: indexing with noUncheckedIndexedAccess
                const expected: (typeof result)[number] = result[i];
                expect(r.outputs.length).toBe(expected.outputs.length);
                expect(r).toMatchObject(expected);
            });
            // per-account requests run concurrently (Promise.all), so their arrival order is not
            // guaranteed; compare as a multiset rather than a sequence
            const byValue = (a: number, b: number) => a - b;
            expect([...availableVsize].sort(byValue)).toEqual([...f.availableVsize].sort(byValue));
            expect(spy).toHaveBeenCalledTimes(f.credentialIssuanceCalls);
        });
    });

    it('outputDecomposition does not log own amounts', async () => {
        // @ts-expect-error: indexing with noUncheckedIndexedAccess
        const f: (typeof fixtures)[number] = fixtures[0];
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/get-outputs-amounts')) {
                resolve({ OutputAmounts: f.outputAmounts });
            }
            resolve();
        });

        const messages: string[] = [];
        const log = (message: string) => messages.push(redacted(message));
        const logger = { debug: log, info: log, log, warn: log, error: log };

        const inputs = f.inputs.map(i => createInput(...(i as Parameters<typeof createInput>)));
        const events: any[] = inputs.map(i => ({
            Type: 'InputAdded',
            Coin: {
                Outpoint: i.outpoint,
                TxOut: {
                    ScriptPubKey:
                        '1 6a6daebd9abae25cdd376b811190163eb00c58e87da1867ba8546229098231c3',
                    Value: i.amount,
                },
            },
        }));

        const response = await outputDecomposition(
            createCoinjoinRound(inputs, {
                ...server?.requestOptions,
                round: {
                    phase: 3,
                    coinjoinState: { Type: '', Events: [...events, INPUT_ADDED_EVENT] },
                },
                roundParameters: f.roundParameters,
            }),
            f.accounts,
            { ...server?.requestOptions, logger },
        );

        const ownAmounts = [
            ...inputs.flatMap(i => i.confirmedAmountCredentials!.map(c => c.Value)),
            ...f.outputAmounts,
            ...response.flatMap(r => r.outputs.map(o => o.amount)),
        ].filter(amount => amount > 0);

        expect(messages.length).toBeGreaterThan(0);
        messages.forEach(message => {
            ownAmounts.forEach(amount => {
                expect(message).not.toMatch(new RegExp(`\\b${amount}\\b`));
            });
        });
    });

    it('outputDecomposition fails only the account whose amounts cannot be decomposed', async () => {
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/get-outputs-amounts')) {
                if (data.InternalAmounts.includes(30000)) {
                    reject(500, { error: 'ExpectedRuntimeError' });
                } else {
                    resolve({ OutputAmounts: [19000] });
                }
            }
            resolve();
        });

        const createAccountInput = (accountKey: string, outpoint: string, value: number) =>
            createInput(accountKey, outpoint, {
                confirmedAmountCredentials: [{ Value: value }, { Value: 0 }],
                confirmedVsizeCredentials: [{ Value: 197 }, { Value: 0 }],
            });
        const inputs = [
            createAccountInput('account-A', `${'a0'.repeat(32)}00000000`, 30000),
            createAccountInput('account-B', `${'b0'.repeat(32)}00000000`, 20000),
        ];
        const round = createCoinjoinRound(inputs, {
            ...server?.requestOptions,
            round: {
                phase: 3,
                coinjoinState: {
                    Type: '',
                    Events: inputs.map(i => createInputAddedEvent(i.outpoint)),
                },
            },
            roundParameters: { MiningFeeRate: 2000 },
        });
        const setSessionPhase = jest.fn();

        const response = await outputDecomposition(
            round,
            [ACCOUNT, { ...ACCOUNT, accountKey: 'account-B' }],
            { ...server?.requestOptions, setSessionPhase },
        );

        // account-A is left out of the result and only its inputs fail
        expect(response).toMatchObject([{ accountKey: 'account-B', outputs: [{ amount: 19086 }] }]);
        expect(round.inputs.map(input => input.error?.message)).toEqual([
            expect.stringMatching(/failed: .*ExpectedRuntimeError/),
            undefined,
        ]);
        expect(setSessionPhase).toHaveBeenCalledWith({
            phase: SessionPhase.OutputRegistrationFailed,
            accountKeys: ['account-A'],
        });
    });
});

describe('setAccountError', () => {
    const createRound = () =>
        createCoinjoinRound(
            [
                createInput('account-A', `${'a0'.repeat(32)}00000000`),
                createInput('account-B', `${'b0'.repeat(32)}00000000`),
            ],
            { ...server?.requestOptions },
        );

    it('fails the inputs of the account only', () => {
        const round = createRound();
        const setSessionPhase = jest.fn();

        setAccountError(round, 'account-A', new Error('Missing credentials to join'), {
            ...server?.requestOptions,
            setSessionPhase,
        });

        expect(round.inputs.map(input => input.error?.message)).toEqual([
            expect.stringMatching(/failed: Missing credentials to join/),
            undefined,
        ]);
        expect(setSessionPhase).toHaveBeenCalledWith({
            phase: SessionPhase.OutputRegistrationFailed,
            accountKeys: ['account-A'],
        });
    });

    it('rethrows a lie of the coordinator, which fails the whole round', () => {
        const round = createRound();
        const lie = new CoordinatorMisbehaviorError('Inconsistent data');

        expect(() =>
            setAccountError(round, 'account-A', lie, { ...server?.requestOptions }),
        ).toThrow(lie);
        // outputRegistration fails every input with it
        round.inputs.forEach(input => {
            expect(input.error).toBeUndefined();
        });
    });
});

describe('outputDecomposition with payment', () => {
    const INPUT_SCRIPT = '1 6a6daebd9abae25cdd376b811190163eb00c58e87da1867ba8546229098231c3';
    const PAYEE_SCRIPT = '0 b586ae30647c6ab84aa1a285d505155711509914';
    const ANCHOR = `${'a0'.repeat(32)}00000000`;

    // cost of the payment output: 100000 + 62 (31 vB at 2 sat/vB)
    const PAYMENT: AccountPayment = {
        id: 'payment-1',
        address: 'bc1qkkr2uvry034tsj4p52za2pg42ug4pxg5qfxyfa',
        amount: 100000,
        anchor: ANCHOR,
        isCancelled: false,
        scriptType: 'P2WPKH',
        scriptPubKey: PAYEE_SCRIPT,
        scriptPubKeyHex: '0014b586ae30647c6ab84aa1a285d505155711509914',
        outputSize: 31,
    };

    const NOT_ENOUGH_COINS = {
        error: 'Not enough coins registered to participate in the coinjoin.',
    };

    type DecomposeParams = {
        // amount credentials of the inputs, the first input is the anchor
        credentials: number[];
        // anonymity levels of the inputs, 10 by default, the account target is 5
        anonymityLevels?: number[];
        // amount credentials of the inputs of another account in the round, without a payment
        otherAccountCredentials?: number[];
        payment?: AccountPayment;
        blockedPaymentIds?: string[];
        paymentAccountKeys?: string[];
        roundParameters?: Partial<CoinjoinRoundParameters>;
        outputAmounts?: number[];
        middlewareError?: Record<string, string>;
        events?: CoinjoinStateEvent[];
    };

    const decompose = ({
        credentials,
        anonymityLevels = [],
        otherAccountCredentials = [],
        payment = PAYMENT,
        blockedPaymentIds = [],
        paymentAccountKeys = ['account-A'],
        roundParameters,
        outputAmounts = [],
        middlewareError,
        events = [],
    }: DecomposeParams) => {
        const outputAmountsRequests: Record<string, any>[] = [];
        server?.removeAllListeners('test-request');
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/get-outputs-amounts')) {
                outputAmountsRequests.push(data);
                if (middlewareError) {
                    reject(500, middlewareError);
                } else {
                    resolve({ OutputAmounts: outputAmounts });
                }
            }
            resolve();
        });

        const messages: string[] = [];
        const log = (message: string) => messages.push(redacted(message));
        const logger = { debug: log, info: log, log, warn: log, error: log };

        const createAccountInput = (accountKey: string, outpoint: string, value: number) =>
            createInput(accountKey, outpoint, {
                amount: value + 116,
                confirmedAmountCredentials: [{ Value: value }, { Value: 0 }],
                confirmedVsizeCredentials: [{ Value: 197 }, { Value: 0 }],
            });
        const accountInputs = credentials.map((value, index) =>
            createAccountInput(
                'account-A',
                index === 0 ? ANCHOR : `${'b1'.repeat(32)}0${index}000000`,
                value,
            ),
        );
        const otherAccountInputs = otherAccountCredentials.map((value, index) =>
            createAccountInput('account-B', `${'d1'.repeat(32)}0${index}000000`, value),
        );
        const inputs = [...accountInputs, ...otherAccountInputs];
        const inputEvents: CoinjoinStateEvent[] = inputs.map(input => ({
            Type: 'InputAdded',
            Coin: {
                Outpoint: input.outpoint.toUpperCase(),
                TxOut: { ScriptPubKey: INPUT_SCRIPT, Value: input.amount },
            },
            OwnershipProof: '',
        }));

        const round = createCoinjoinRound(inputs, {
            ...server?.requestOptions,
            round: {
                phase: 2,
                paymentAccountKeys,
                coinjoinState: { Type: '', Events: [...inputEvents, ...events] },
            },
            roundParameters: { MiningFeeRate: 2000, ...roundParameters },
        });

        const account = {
            ...ACCOUNT,
            scriptType: 'Taproot',
            targetAnonymity: 5,
            utxos: accountInputs.map(({ outpoint }, index) => ({
                outpoint,
                anonymityLevel: anonymityLevels[index] ?? 10,
            })),
            payment,
            blockedPaymentIds,
        };
        const otherAccount = { ...ACCOUNT, accountKey: 'account-B', scriptType: 'Taproot' };

        const response = outputDecomposition(round, [account, otherAccount], {
            ...server?.requestOptions,
            logger,
        });

        return { response, round, outputAmountsRequests, messages };
    };

    // the account is left out of the result and only its inputs fail
    const expectAccountError = async (
        { response, round }: ReturnType<typeof decompose>,
        message: string,
    ) => {
        expect(await response).toEqual([]);
        expect(round.inputs.length).toBeGreaterThan(0);
        round.inputs.forEach(input => {
            expect(input.error?.message).toMatch(message);
        });
    };

    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        server?.close();
    });

    it('reserves the payment and decomposes the rest', async () => {
        const { response, outputAmountsRequests, messages } = decompose({
            credentials: [60000, 50000],
            outputAmounts: [9800],
        });

        expect(await response).toMatchObject([
            {
                accountKey: 'account-A',
                outputs: [
                    {
                        amount: 100062,
                        vsize: 31,
                        amountCredentials: [{ Value: 100062 }, { Value: 0 }],
                        vsizeCredentials: [{ Value: 31 }, { Value: 0 }],
                        payment: PAYMENT,
                    },
                    {
                        amount: 9886,
                        vsize: 43,
                        amountCredentials: [{ Value: 9886 }, { Value: 0 }],
                        vsizeCredentials: [{ Value: 43 }, { Value: 0 }],
                    },
                ],
            },
        ]);
        // 110000 - 100062 left for change, 2 * 197 - 31 vB
        expect(outputAmountsRequests).toMatchObject([
            { InternalAmounts: [9938], AvailableVsize: 363, InputSize: 58, OutputSize: 43 },
        ]);
        messages.forEach(message => {
            [100000, 100062, 9938, 9886].forEach(amount => {
                expect(message).not.toMatch(new RegExp(`\\b${amount}\\b`));
            });
        });
    });

    it('pairs vsize of a P2TR payee', async () => {
        const payment: AccountPayment = {
            ...PAYMENT,
            address: 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
            scriptType: 'Taproot',
            scriptPubKey: '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
            scriptPubKeyHex: '5120b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
            outputSize: 43,
        };
        // the remainder 9914 is enough for a change output, the middleware returns none
        await expectAccountError(
            decompose({ credentials: [60000, 50000], payment }),
            'Unexpected payment change amounts',
        );

        const { response: response2, outputAmountsRequests } = decompose({
            credentials: [60000, 50000],
            payment,
            outputAmounts: [9800],
        });
        expect(await response2).toMatchObject([
            {
                outputs: [
                    { amount: 100086, vsize: 43, vsizeCredentials: [{ Value: 43 }, { Value: 0 }] },
                    { amount: 9886, vsize: 43 },
                ],
            },
        ]);
        expect(outputAmountsRequests).toMatchObject([
            { InternalAmounts: [9914], AvailableVsize: 351 },
        ]);
    });

    it('registers a remainder that cannot be decomposed as one change output', async () => {
        const { response } = decompose({
            credentials: [60000, 50000],
            middlewareError: NOT_ENOUGH_COINS,
        });

        expect(await response).toMatchObject([
            {
                outputs: [
                    { amount: 100062, vsize: 31, payment: PAYMENT },
                    { amount: 9938, vsize: 43, amountCredentials: [{ Value: 9938 }, { Value: 0 }] },
                ],
            },
        ]);
    });

    it('fails on other middleware errors', async () => {
        await expectAccountError(
            decompose({
                credentials: [60000, 50000],
                middlewareError: { error: 'ExpectedRuntimeError' },
            }),
            'ExpectedRuntimeError',
        );
    });

    it('fails when one change output cannot be registered', async () => {
        // change value 199852 is above the maximum output amount
        await expectAccountError(
            decompose({
                credentials: [100000, 200000],
                roundParameters: { AllowedOutputAmounts: { Min: 5000, Max: 150000 } },
                middlewareError: NOT_ENOUGH_COINS,
            }),
            'Payment change cannot be registered',
        );

        // change credential 129938 is above the maximum credential value
        await expectAccountError(
            decompose({
                credentials: [110000, 120000],
                roundParameters: { MaxAmountCredentialValue: 120000 },
                middlewareError: NOT_ENOUGH_COINS,
            }),
            'Payment change cannot be registered',
        );
    });

    it('leaves a small remainder as a fee', async () => {
        const { response, outputAmountsRequests } = decompose({ credentials: [60000, 43062] });

        expect(await response).toMatchObject([
            { outputs: [{ amount: 100062, vsize: 31, payment: PAYMENT }] },
        ]);
        expect(outputAmountsRequests).toEqual([]);
    });

    it('fails on a remainder too large for a fee and too small for a change output', async () => {
        // remainder up to 1086 is a fee, from 10086 a change output
        await expectAccountError(
            decompose({
                credentials: [60000, 45062],
                roundParameters: {
                    AllowedInputAmounts: { Min: 1000, Max: 134375000000 },
                    AllowedOutputAmounts: { Min: 10000, Max: 134375000000 },
                },
            }),
            'Payment remainder cannot be registered',
        );
    });

    it('fails when only the anchor was confirmed', async () => {
        await expectAccountError(
            decompose({ credentials: [60000] }),
            'Not enough registered amount for payment',
        );
    });

    const PAYEE_INPUT_EVENT: CoinjoinStateEvent = {
        Type: 'InputAdded',
        Coin: {
            Outpoint: `${'c1'.repeat(32)}00000000`,
            TxOut: { ScriptPubKey: PAYEE_SCRIPT.toUpperCase(), Value: 100000 },
        },
        OwnershipProof: '',
    };

    it('fails when the payee script is an input of the round', async () => {
        await expectAccountError(
            decompose({
                credentials: [60000, 50000],
                outputAmounts: [9800],
                events: [PAYEE_INPUT_EVENT],
            }),
            'Payment cannot be made in this round',
        );
    });

    it('a payment that cannot be made fails only the paying account', async () => {
        const { response, round } = decompose({
            credentials: [60000, 50000],
            otherAccountCredentials: [50000],
            outputAmounts: [49800],
            events: [PAYEE_INPUT_EVENT],
        });

        expect(await response).toMatchObject([
            { accountKey: 'account-B', outputs: [{ amount: 49886, vsize: 43 }] },
        ]);
        round.inputs.forEach(input => {
            if (input.accountKey === 'account-A') {
                expect(input.error?.message).toMatch('Payment cannot be made in this round');
            } else {
                expect(input.error).toBeUndefined();
            }
        });
    });

    it.each([
        ['the account was not selected to pay', { paymentAccountKeys: [] }],
        ['the payment was cancelled', { payment: { ...PAYMENT, isCancelled: true } }],
        ['the payment is blocked', { blockedPaymentIds: [PAYMENT.id] }],
        ['an input is below the anonymity target', { anonymityLevels: [10, 4] }],
    ])('decomposes without the payment when %s', async (_, params) => {
        const { response, outputAmountsRequests } = decompose({
            credentials: [60000, 50000],
            outputAmounts: [100000],
            ...params,
        });

        const [result] = await response;
        expect(result?.outputs).toMatchObject([{ amount: 100086, vsize: 43 }]);
        expect(result?.outputs[0]?.payment).toBeUndefined();
        expect(outputAmountsRequests).toMatchObject([
            { InternalAmounts: [60000, 50000], AvailableVsize: 394 },
        ]);
    });
});
