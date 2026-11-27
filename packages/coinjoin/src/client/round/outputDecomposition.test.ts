import { getOutputAmounts } from '@trezor/coinjoin-strategy';

import {
    ACCOUNT,
    outputDecomposition as fixtures,
} from './__fixtures__/outputDecomposition.fixture';
import { outputDecomposition, setAccountError } from './outputDecomposition';
import {
    configureMockCoordinator,
    createServer,
    getRoundCredentialKinds,
    resetMockCoordinator,
} from '../../../mocks/server';
import { mintCredentials } from '../../__fixtures__/credentialIssuer.fixture';
import { createInput } from '../../__fixtures__/input.fixture';
import {
    DEFAULT_ROUND,
    INPUT_ADDED_EVENT,
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../../__fixtures__/round.fixture';
import { SessionPhase } from '../../enums';
import { redacted } from '../../utils/redacted';
import { CoinjoinPrison } from '../CoinjoinPrison';
import { CoordinatorMisbehaviorError } from '../coordinator';

/**
 * This suite is about the plumbing between decomposition and credential joining: which
 * amounts are asked for, how `availableVsize` is derived, and how many credential
 * issuance round trips it takes to split the inputs' credentials into those amounts.
 *
 * Only the decomposer is stubbed, so that each case can pin the amounts it is about. The
 * credentials are real: the fixtures start in the middle of a round, and the values they
 * name are minted from the mock coordinator's own issuer, which then validates every
 * reissuance the suite drives through it — the balance proof, both range proofs and the
 * serial numbers. A join that does not balance fails here instead of being waved through.
 */
jest.mock('@trezor/coinjoin-strategy', () => ({
    ...jest.requireActual('@trezor/coinjoin-strategy'),
    getOutputAmounts: jest.fn(),
}));

const getOutputAmountsMock = getOutputAmounts as jest.MockedFunction<typeof getOutputAmounts>;

let server: Awaited<ReturnType<typeof createServer>>;

/**
 * The input's confirmed credentials, minted for the values the fixture names.
 *
 * A fixture can only name values; a `Credential` is a value plus a blinding factor plus
 * a MAC that only the coordinator can produce, so the values have to be taken through a
 * registration against the issuer that will later verify them.
 */
const withMintedCredentials = async (options: Record<string, any>) => {
    const kinds = getRoundCredentialKinds(DEFAULT_ROUND.Id);
    const values = (credentials: { value: number }[]) =>
        credentials.map(credential => credential.value) as [number, number];

    return {
        ...options,
        confirmedAmountCredentials: await mintCredentials(
            kinds.amount,
            values(options.confirmedAmountCredentials),
        ),
        confirmedVsizeCredentials: await mintCredentials(
            kinds.vsize,
            values(options.confirmedVsizeCredentials),
        ),
    };
};

describe('outputRegistration', () => {
    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        server?.removeAllListeners('test-request');
    });

    afterEach(() => {
        resetMockCoordinator();
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
        getOutputAmountsMock.mockImplementation(request => {
            availableVsize.push(request.AvailableVsize);

            return [20000];
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
            await withMintedCredentials({
                confirmedAmountCredentials: [{ value: 30000 }, { value: 0 }],
                confirmedVsizeCredentials: [{ value: 197 }, { value: 0 }],
            }),
        );
        const response = await outputDecomposition(
            createCoinjoinRound([input], {
                ...server?.requestOptions,
                prison,
                round: {
                    phase: 3,
                    phaseDeadline: Date.now() + 120_000,
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
    }, 120_000);

    fixtures.forEach(f => {
        it(`outputDecomposition ${f.description}`, async () => {
            const spy = jest.fn();
            const availableVsize: number[] = [];
            getOutputAmountsMock.mockImplementation(request => {
                availableVsize.push(request.AvailableVsize);

                return f.outputAmounts;
            });
            server?.addListener('test-request', ({ url, resolve }) => {
                if (url.endsWith('/credential-issuance')) {
                    spy();
                }
                // Answered by the mock coordinator's issuer, which verifies the join.
                resolve();
            });

            // The issuer has to be built for the credential bounds the client is sizing
            // its range proofs from, which one case deliberately lowers.
            configureMockCoordinator({
                MaxAmountCredentialValue:
                    f.roundParameters.MaxAmountCredentialValue ??
                    ROUND_CREATION_EVENT.RoundParameters.MaxAmountCredentialValue,
            });

            // NOTE: scriptPubKey is only used to calculate external output size, it can be reused for all inputs
            const ScriptPubKey =
                '1 6a6daebd9abae25cdd376b811190163eb00c58e87da1867ba8546229098231c3';
            const inputs = await Promise.all(
                f.inputs.map(async ([accountKey, outpoint, options]) =>
                    createInput(
                        accountKey as string,
                        outpoint as string,
                        await withMintedCredentials(options as Record<string, any>),
                    ),
                ),
            );
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
                        // The deadline of the fixture round counts from when this file was
                        // loaded, and on a loaded CI runner the earlier cases use it up.
                        phaseDeadline: Date.now() + 120_000,
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
            // Minting the inputs' credentials and every reissuance the case drives are
            // real range proofs, a few hundred milliseconds each.
        }, 120_000);
    });

    it('outputDecomposition does not log own amounts', async () => {
        // @ts-expect-error: indexing with noUncheckedIndexedAccess
        const f: (typeof fixtures)[number] = fixtures[0];
        getOutputAmountsMock.mockReturnValue(f.outputAmounts);

        const messages: string[] = [];
        const log = (message: string) => messages.push(redacted(message));
        const logger = { debug: log, info: log, log, warn: log, error: log };

        const inputs = await Promise.all(
            f.inputs.map(async ([accountKey, outpoint, options]) =>
                createInput(
                    accountKey as string,
                    outpoint as string,
                    await withMintedCredentials(options as Record<string, any>),
                ),
            ),
        );
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
                    phaseDeadline: Date.now() + 120_000,
                    coinjoinState: { Type: '', Events: [...events, INPUT_ADDED_EVENT] },
                },
                roundParameters: f.roundParameters,
            }),
            f.accounts,
            { ...server?.requestOptions, logger },
        );

        const ownAmounts = [
            ...inputs.flatMap(i => i.confirmedAmountCredentials!.map(c => c.value)),
            ...f.outputAmounts,
            ...response.flatMap(r => r.outputs.map(o => o.amount)),
        ].filter(amount => amount > 0);

        expect(messages.length).toBeGreaterThan(0);
        messages.forEach(message => {
            ownAmounts.forEach(amount => {
                expect(message).not.toMatch(new RegExp(`\\b${amount}\\b`));
            });
        });
    }, 120_000);

    it('outputDecomposition fails only the account whose amounts cannot be decomposed', async () => {
        getOutputAmountsMock.mockImplementation(request => {
            // The decomposer throws, for example `Not enough money`, for one account only.
            if (request.InternalAmounts.includes(30000)) throw new Error('ExpectedRuntimeError');

            return [19000];
        });

        const createAccountInput = async (accountKey: string, outpoint: string, value: number) =>
            createInput(
                accountKey,
                outpoint,
                await withMintedCredentials({
                    confirmedAmountCredentials: [{ value }, { value: 0 }],
                    confirmedVsizeCredentials: [{ value: 197 }, { value: 0 }],
                }),
            );
        const inputs = [
            await createAccountInput('account-A', `${'a0'.repeat(32)}00000000`, 30000),
            await createAccountInput('account-B', `${'b0'.repeat(32)}00000000`, 20000),
        ];
        const round = createCoinjoinRound(inputs, {
            ...server?.requestOptions,
            round: {
                phase: 3,
                // The default deadline of the round fixture is a minute after the suite started.
                phaseDeadline: Date.now() + 120_000,
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
    }, 120_000);
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
