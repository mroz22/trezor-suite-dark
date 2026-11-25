import { getOutputAmounts } from '@trezor/coinjoin-strategy';
import { createDeferred } from '@trezor/utils';
import { networks } from '@trezor/utxo-lib';

import { CoinjoinClient } from './CoinjoinClient';
import { CoinjoinPrison } from './CoinjoinPrison';
import { CoinjoinRound } from './CoinjoinRound';
import { CoordinatorMisbehaviorError } from './coordinator';
import { createServer } from '../../mocks/server';
import { createInput } from '../__fixtures__/input.fixture';
import {
    DEFAULT_ROUND,
    FEE_RATE_MEDIANS,
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
    createStatusRound,
    createTransactionData,
} from '../__fixtures__/round.fixture';
import { EndRoundState, RoundPhase, SessionPhase } from '../enums';
import { type RegisterAccountParams } from '../types/account';
import type { CoinjoinInputAddedEvent, CoinjoinStateEvent, Round } from '../types/coordinator';
import type { CoinjoinPrisonInmate } from '../types/prison';
import type { SerializedCoinjoinRound, SessionPhaseEvent } from '../types/round';
import { getScriptPubKeyFromAddress } from '../utils/coordinatorUtils';

// Poll the status often, the blame round tests need several of its updates.
jest.mock('../constants', () => ({
    __esModule: true,
    ...jest.requireActual('../constants'),
    STATUS_TIMEOUT: { idle: 100, enabled: 100, registered: 100 },
}));

// Send coordinator requests without random delays.
jest.mock('@trezor/utils', () => ({
    __esModule: true,
    ...jest.requireActual('@trezor/utils'),
    getWeakRandomNumberInRange: () => 0,
}));

// The inputs of other participants have no valid ownership proofs, see verifyRoundInputs.test.ts.
jest.mock('../utils/ownershipProof', () => ({
    verifyOwnershipProof: () => 'valid',
}));

// The decomposer draws random amounts, a test pins them where it counts the outputs.
jest.mock('@trezor/coinjoin-strategy', () => {
    const actual = jest.requireActual('@trezor/coinjoin-strategy');

    return { ...actual, getOutputAmounts: jest.fn(actual.getOutputAmounts) };
});

// The blame round cases run the real credential crypto against the mock coordinator's issuer, which
// takes seconds on a loaded CI runner.
jest.setTimeout(60_000);

describe(`CoinjoinClient`, () => {
    let server: Awaited<ReturnType<typeof createServer>>;

    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        server?.close();
    });

    it('enable success', async () => {
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/status')) {
                resolve({
                    RoundStates: [DEFAULT_ROUND],
                    CoinJoinFeeRateMedians: FEE_RATE_MEDIANS,
                });
            }
            resolve();
        });

        const cli = new CoinjoinClient(server?.requestOptions);

        const status = await cli.enable();
        if (!status.success) throw new Error(`Client not enabled ${status.error}`);
        expect(status.rounds.length).toBeGreaterThan(0);
        expect(status.coordinationFeeRate.rate).toBeGreaterThan(0);

        cli.disable();
    });

    it('registerAccount and detain registered inputs/outputs from Status', async () => {
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/status')) {
                resolve({
                    CoinJoinFeeRateMedians: FEE_RATE_MEDIANS,
                    RoundStates: [
                        DEFAULT_ROUND,
                        {
                            ...DEFAULT_ROUND,
                            Id: '8080808080808080808080808080808080808080808080808080808080808080',
                            Phase: 1,
                            CoinjoinState: {
                                Events: [
                                    {
                                        Type: 'InputAdded',
                                        Coin: {
                                            Outpoint:
                                                'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA00000000',
                                            TxOut: {
                                                ScriptPubKey:
                                                    '51208b0bc63a6c9c4459fe510d7c42c8dade5e8070ca623a9aed9086a7d21a3423b2',
                                                Value: 10000,
                                            },
                                        },
                                    },
                                    {
                                        Type: 'OutputAdded',
                                        Output: {
                                            ScriptPubKey:
                                                '1 0ffeae3fbd08c25521369afbb6d7dacec99f3b24b6113c2fe497bede04723789',
                                            Value: 8000,
                                        },
                                    },
                                ],
                            },
                        },
                        {
                            ...DEFAULT_ROUND,
                            Id: '9090909090909090909090909090909090909090909090909090909090909090',
                            Phase: 2,
                            CoinjoinState: {
                                Events: [
                                    {
                                        Type: 'InputAdded',
                                        Coin: {
                                            Outpoint:
                                                'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB00000000',
                                            TxOut: {
                                                ScriptPubKey:
                                                    '51208b0bc63a6c9c4459fe510d7c42c8dade5e8070ca623a9aed9086a7d21a3423b2',
                                                Value: 10000,
                                            },
                                        },
                                    },
                                    {
                                        Type: 'OutputAdded',
                                        Output: {
                                            ScriptPubKey:
                                                '1 a52d19f3baa0000803d228a67307439c66bbaca8929ce889305e0445b5febad7',
                                            Value: 8000,
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                });
            }
            resolve();
        });

        const spyIsDetained = jest.spyOn(CoinjoinPrison.prototype, 'isDetained');
        const spyDetain = jest.spyOn(CoinjoinPrison.prototype, 'detain');

        // initialize Client with persistent Prison
        const cli = new CoinjoinClient({
            ...server?.requestOptions,
            prison: [
                {
                    accountKey: 'account-A',
                    type: 'input',
                    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000',
                    sentenceStart: Date.now() - 1000000,
                    sentenceEnd: Date.now() + 1000000,
                },
                {
                    accountKey: 'account-A',
                    type: 'output',
                    id: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
                    sentenceStart: Date.now() - 1000000,
                    sentenceEnd: Date.now() + 1000000,
                },
            ],
        });

        await cli.enable();

        // set prison event listener
        const prisonEventPromise = new Promise<CoinjoinPrisonInmate[]>(resolve => {
            cli.on('prison', event => {
                cli.unregisterAccount('account-A');
                cli.disable();

                resolve(event.prison);
            });
        });

        cli.registerAccount({
            accountKey: 'account-A',
            scriptType: 'Taproot',
            targetAnonymity: 10,
            rawLiquidityClue: 0,
            maxFeePerKvbyte: 1,
            maxCoordinatorFeeRate: 1,
            maxRounds: 10,
            utxos: [
                // 1. this utxo is registered in 1st Round and already detained in prison
                {
                    path: "m/10025'/1'/0'/1'/0/0",
                    outpoint:
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa00000000',
                    address: 'tb1ppxzlcdeawkpyg5q85lepuhsructwkxpgtxt5pcdq3hnfp0v372qq3tfr6s',
                    amount: 10000,
                    anonymityLevel: 0,
                },
                // 2. this utxo is registered in 2nd Round and will be detained from the Status
                {
                    path: "m/10025'/1'/0'/1'/0/1",
                    outpoint:
                        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb00000000',
                    address: 'tb1p3v9uvwnvn3z9nlj3p47y9jx6me0gqux2vgaf4mvss6nayx35yweqq5sjj2',
                    amount: 10000,
                    anonymityLevel: 0,
                },
                {
                    path: "m/10025'/1'/0'/1'/0/2",
                    outpoint:
                        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc00000000',
                    address: 'tb1phrhxq2tc9uj5eh0n62ag506ax8kgrfvrkdnqj6nlvvsdejkwe2hqgcyw9j',
                    amount: 6000,
                    anonymityLevel: 0,
                },
            ],
            changeAddresses: [
                // 1. this output is registered in 1st Round and already detained in prison
                {
                    path: "m/10025'/1'/0'/1'/1/0",
                    address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
                },
                // 2. this output is registered in 2nd Round and will be detained from the Status
                {
                    path: "m/10025'/1'/0'/1'/1/1",
                    address: 'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
                },
                {
                    path: "m/10025'/1'/0'/1'/1/2",
                    address: 'tb1p4jf9crt5gh57h2spvfht4zwjtnre700uvs4u63l2g2huchrk2dms4lm6kv',
                },
            ],
        });

        // register the same account just for coverage
        expect(() => cli.registerAccount({ accountKey: 'account-A' } as any)).toThrow();

        expect(spyIsDetained.mock.calls.length).toEqual(4); // isDetained was checked 4 times
        // 2 new inmates were added, the already detained output is now detained for good
        expect(spyDetain.mock.calls.length).toEqual(3);

        // wait for prison event
        const inmates = await prisonEventPromise;
        expect(inmates.length).toEqual(4); // 4 elements are detained at the end
        // The coordinator has seen the outputs, see CoinjoinPrison.detainRegisteredOutput.
        expect(inmates.filter(({ type }) => type === 'output')).toEqual([
            expect.objectContaining({
                id: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
                errorCode: 'registeredOutput',
                roundId: '8080808080808080808080808080808080808080808080808080808080808080',
                sentenceEnd: Infinity,
            }),
            expect.objectContaining({
                id: 'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
                errorCode: 'registeredOutput',
                roundId: '9090909090909090909090909090909090909090909090909090909090909090',
                sentenceEnd: Infinity,
            }),
        ]);
    });

    it('registerAccount without coordinatorUrl does not create a round', async () => {
        const createSpy = jest.spyOn(CoinjoinRound, 'create').mockResolvedValue(undefined);
        const account: RegisterAccountParams = {
            accountKey: 'account-A',
            scriptType: 'Taproot',
            utxos: [],
            changeAddresses: [],
            targetAnonymity: 10,
            rawLiquidityClue: 0,
            maxFeePerKvbyte: 1,
            maxCoordinatorFeeRate: 1,
            maxRounds: 10,
        };
        // registerAccount triggers round processing without awaiting it
        const flush = () => new Promise(resolve => setTimeout(resolve, 0));

        const cli = new CoinjoinClient({ ...server?.requestOptions, coordinatorUrl: undefined });
        cli.registerAccount(account);
        await flush();
        expect(createSpy).toHaveBeenCalledTimes(0);
        cli.disable();

        // with a coordinator the very same call does try to create a round
        const cliWithCoordinator = new CoinjoinClient(server?.requestOptions);
        cliWithCoordinator.registerAccount(account);
        await flush();
        expect(createSpy).toHaveBeenCalledTimes(1);
        cliWithCoordinator.disable();

        createSpy.mockRestore();
    });

    it('selects for one round at a time and once more for requests during it', async () => {
        const selections = [createDeferred<undefined>(), createDeferred<undefined>()];
        let started = 0;
        const createSpy = jest.spyOn(CoinjoinRound, 'create').mockImplementation(() => {
            started += 1;

            return selections[started - 1]!.promise;
        });
        const account = (accountKey: string): RegisterAccountParams => ({
            accountKey,
            scriptType: 'Taproot',
            utxos: [],
            changeAddresses: [],
            targetAnonymity: 10,
            rawLiquidityClue: 0,
            maxFeePerKvbyte: 1,
            maxCoordinatorFeeRate: 1,
            maxRounds: 10,
        });
        // registerAccount triggers round processing without awaiting it
        const flush = () => new Promise(resolve => setTimeout(resolve, 0));

        const cli = new CoinjoinClient(server?.requestOptions);
        cli.registerAccount(account('account-A'));
        await flush();
        // Both come while the first selection runs.
        cli.registerAccount(account('account-B'));
        cli.updateAccount(account('account-A'));
        await flush();
        expect(createSpy).toHaveBeenCalledTimes(1);

        selections[0]!.resolve(undefined);
        await flush();
        expect(createSpy).toHaveBeenCalledTimes(2);
        expect(createSpy.mock.calls[1]![0].accounts.map(a => a.accountKey)).toEqual([
            'account-A',
            'account-B',
        ]);

        selections[1]!.resolve(undefined);
        await flush();
        expect(createSpy).toHaveBeenCalledTimes(2);

        cli.disable();
        createSpy.mockRestore();
    });

    it.each([
        ['btc', undefined, 21],
        ['test', undefined, 2],
        ['regtest', undefined, 2],
        ['btc', 5, 5],
    ] as const)(
        'passes minInputCount of %s network (setting %s) to rounds',
        async (network, minInputCount, expected) => {
            const createSpy = jest.spyOn(CoinjoinRound, 'create').mockResolvedValue(undefined);
            const cli = new CoinjoinClient({ ...server?.requestOptions, network, minInputCount });
            cli.registerAccount({
                accountKey: 'account-A',
                scriptType: 'Taproot',
                utxos: [],
                changeAddresses: [],
                targetAnonymity: 10,
                rawLiquidityClue: 0,
                maxFeePerKvbyte: 1,
                maxCoordinatorFeeRate: 1,
                maxRounds: 10,
            });
            // registerAccount triggers round processing without awaiting it
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(createSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    options: expect.objectContaining({ minInputCount: expected }),
                }),
            );

            cli.disable();
            createSpy.mockRestore();
        },
    );

    it('leaves a joined round whose status stops matching its id in the same phase', async () => {
        const outpoint = `${'a'.repeat(64)}00000000`;
        let statusRounds = [DEFAULT_ROUND];
        const registrationRequested = createDeferred();
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/status')) {
                resolve({ RoundStates: statusRounds, CoinJoinFeeRateMedians: FEE_RATE_MEDIANS });
            } else if (url.endsWith('/input-registration')) {
                // No response, the registration runs until the client leaves the round.
                registrationRequested.resolve();
            } else {
                resolve();
            }
        });

        // The client joins the round with an input which has its ownership proof.
        let joinedRound: CoinjoinRound | undefined;
        const createSpy = jest
            .spyOn(CoinjoinRound, 'create')
            .mockImplementation(({ accounts, prison, options }) => {
                if (joinedRound || accounts.length === 0) return Promise.resolve(undefined);

                joinedRound = createCoinjoinRound(
                    [createInput('account-A', outpoint, { ownershipProof: '01A1' })],
                    { ...options, prison },
                );

                return Promise.resolve(joinedRound);
            });

        const cli = new CoinjoinClient(server?.requestOptions);
        const ended = createDeferred<SerializedCoinjoinRound>();
        cli.on('round', ({ round }) => {
            if (round.phase === RoundPhase.Ended) ended.resolve(round);
        });
        const sessionPhaseSpy = jest.fn();
        cli.on('session-phase', sessionPhaseSpy);

        await cli.enable();
        cli.registerAccount({
            accountKey: 'account-A',
            scriptType: 'Taproot',
            utxos: [],
            changeAddresses: [],
            targetAnonymity: 10,
            rawLiquidityClue: 0,
            maxFeePerKvbyte: 1,
            maxCoordinatorFeeRate: 1,
            maxRounds: 10,
        });
        await registrationRequested.promise;

        // Other credential issuer keys under the same id, still in input registration.
        statusRounds = [
            {
                ...DEFAULT_ROUND,
                AmountCredentialIssuerParameters: DEFAULT_ROUND.VsizeCredentialIssuerParameters,
            },
        ];

        const endedRound = await ended.promise;
        const registeredAccounts = cli.getAccounts();
        cli.disable();
        createSpy.mockRestore();

        // The input fails with the lie, not with the aborted registration.
        expect(endedRound).toMatchObject({
            id: DEFAULT_ROUND.Id,
            endRoundState: EndRoundState.None,
            inputs: [],
            failed: [{ outpoint, error: 'Round parameters do not match the round id' }],
        });
        expect(joinedRound?.prison.isDetained(outpoint)).toMatchObject({
            roundId: DEFAULT_ROUND.Id,
        });
        // The client stops mixing, as after the other lies.
        expect(sessionPhaseSpy).toHaveBeenCalledWith({
            phase: SessionPhase.CoordinatorMisbehavior,
            accountKeys: ['account-A'],
        });
        expect(registeredAccounts).toEqual([]);
    });

    describe('blame round', () => {
        const OWN_UTXO = {
            path: "m/10025'/1'/0'/1'/0/0",
            outpoint: `${'d'.repeat(64)}00000000`,
            address: 'tb1ppxzlcdeawkpyg5q85lepuhsructwkxpgtxt5pcdq3hnfp0v372qq3tfr6s',
            amount: 12300000,
            anonymityLevel: 0,
        };
        // Input of another participant in the failed round.
        const OTHER_OUTPOINT = `${'E'.repeat(64)}01000000`;
        // Input which was not in the failed round.
        const FOREIGN_OUTPOINT = `${'F'.repeat(64)}02000000`;

        // The own utxo as registered by the coordinator.
        const OWN_INPUT_ADDED_EVENT: CoinjoinInputAddedEvent = {
            Type: 'InputAdded',
            Coin: {
                Outpoint: OWN_UTXO.outpoint.toUpperCase(),
                TxOut: {
                    ScriptPubKey: getScriptPubKeyFromAddress(
                        OWN_UTXO.address,
                        networks.testnet,
                        'Taproot',
                    ),
                    Value: OWN_UTXO.amount,
                },
            },
            OwnershipProof: 'not-relevant',
        };

        const FAILED_ROUND: Round = {
            ...DEFAULT_ROUND,
            Phase: RoundPhase.TransactionSigning,
        };
        // Change addresses of the account. The first one it registered in an earlier failed round,
        // the last one in the failed round.
        const EARLIER_ROUND_ADDRESS =
            'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3';
        const FAILED_ROUND_ADDRESS =
            'tb1p4jf9crt5gh57h2spvfht4zwjtnre700uvs4u63l2g2huchrk2dms4lm6kv';
        const CHANGE_ADDRESSES = [
            EARLIER_ROUND_ADDRESS,
            'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
            FAILED_ROUND_ADDRESS,
        ];
        const ENDED_FAILED_ROUND: Round = {
            ...FAILED_ROUND,
            Phase: RoundPhase.Ended,
            EndRoundState: EndRoundState.NotAllAlicesSign,
        };

        // The client signs the failed round, the coordinator ends it with NotAllAlicesSign and
        // starts its blame round with the given inputs of other participants. Resolves with the
        // requested urls and the last state of the blame round once it registers its outputs or
        // fails.
        const runBlameRound = async (otherOutpoints: string[]) => {
            // Its input registration ends in 2 minutes. Inputs confirm their connection every half
            // of the timeout; it leaves the real credential crypto of a confirmation time to finish
            // before the deadline on a loaded machine.
            const blameStatusRound = createStatusRound({
                BlameOf: FAILED_ROUND.Id,
                InputRegistrationStart: new Date(Date.now() + 60000).toISOString(),
                RoundParameters: { ConnectionConfirmationTimeout: '0d 0h 0m 10s' },
            });
            const createBlameRound = (Phase: RoundPhase, Events: CoinjoinStateEvent[] = []) => ({
                ...blameStatusRound,
                Phase,
                CoinjoinState: {
                    ...blameStatusRound.CoinjoinState,
                    Events: [...blameStatusRound.CoinjoinState.Events, ...Events],
                },
            });

            let statusRounds = [FAILED_ROUND];
            const requestedUrls: string[] = [];
            const registeredScripts: string[] = [];
            const signatureSent = createDeferred();
            const outputRegistrationDone = createDeferred();
            server?.addListener('test-request', ({ url, data, resolve }) => {
                requestedUrls.push(url);
                if (url.endsWith('/output-registration')) registeredScripts.push(data.Script);
                if (url.endsWith('/status')) {
                    resolve({
                        RoundStates: statusRounds,
                        CoinJoinFeeRateMedians: FEE_RATE_MEDIANS,
                    });
                } else if (url.endsWith('/transaction-signature')) {
                    signatureSent.resolve();
                    resolve();
                } else if (url.endsWith('/input-registration')) {
                    statusRounds = [
                        ENDED_FAILED_ROUND,
                        createBlameRound(RoundPhase.ConnectionConfirmation),
                    ];
                    resolve();
                } else if (url.endsWith('/ready-to-sign')) {
                    outputRegistrationDone.resolve();
                    resolve();
                } else {
                    resolve();
                }
            });

            // The failed round, with the own input signed and the transaction it was signed for.
            // How the client joined it does not matter here. The first status update creates it.
            const createSpy = jest
                .spyOn(CoinjoinRound, 'create')
                .mockImplementationOnce(({ prison, options }) => {
                    // as outputRegistration did
                    prison.detainRegisteredOutput(
                        { accountKey: 'account-A', address: EARLIER_ROUND_ADDRESS },
                        '3'.repeat(64),
                    );
                    prison.detainRegisteredOutput(
                        { accountKey: 'account-A', address: FAILED_ROUND_ADDRESS },
                        FAILED_ROUND.Id,
                    );

                    return Promise.resolve(
                        createCoinjoinRound(
                            [
                                createInput('account-A', OWN_UTXO.outpoint, {
                                    witness: 'aa',
                                    witnessIndex: 0,
                                }),
                            ],
                            {
                                ...options,
                                prison,
                                statusRound: FAILED_ROUND,
                                round: {
                                    phase: RoundPhase.TransactionSigning,
                                    phaseDeadline: Date.now() + 60000,
                                    transactionData: createTransactionData([
                                        OWN_UTXO.outpoint,
                                        OTHER_OUTPOINT,
                                    ]),
                                },
                            },
                        ),
                    );
                });

            const cli = new CoinjoinClient(server?.requestOptions);
            let blameRound: SerializedCoinjoinRound | undefined;
            cli.on('round', ({ round }) => {
                if (round.id !== blameStatusRound.Id) return;

                blameRound = round;
                if (round.phase === RoundPhase.Ended) outputRegistrationDone.resolve();
            });
            cli.on('request', requests =>
                cli.resolveRequest(
                    requests.flatMap(request =>
                        request.type === 'ownership'
                            ? {
                                  type: request.type,
                                  roundId: request.roundId,
                                  inputs: request.inputs.map(({ outpoint }) => ({
                                      outpoint,
                                      ownershipProof: '00',
                                  })),
                              }
                            : [],
                    ),
                ),
            );
            cli.on('session-phase', ({ phase }) => {
                // All inputs are confirmed, the coordinator announces them in output registration.
                if (phase === SessionPhase.AwaitingOthersConfirmation) {
                    statusRounds = [
                        ENDED_FAILED_ROUND,
                        createBlameRound(RoundPhase.OutputRegistration, [
                            OWN_INPUT_ADDED_EVENT,
                            ...otherOutpoints.map(createInputAddedEvent),
                        ]),
                    ];
                }
            });

            await cli.enable();
            cli.registerAccount({
                accountKey: 'account-A',
                scriptType: 'Taproot',
                targetAnonymity: 10,
                rawLiquidityClue: 0,
                maxFeePerKvbyte: 200000,
                maxCoordinatorFeeRate: 0.01,
                maxRounds: 10,
                utxos: [OWN_UTXO],
                changeAddresses: CHANGE_ADDRESSES.map((address, index) => ({
                    path: `m/10025'/1'/0'/1'/1/${index}`,
                    address,
                })),
            });

            await signatureSent.promise;
            statusRounds = [ENDED_FAILED_ROUND, createBlameRound(RoundPhase.InputRegistration)];
            await outputRegistrationDone.promise;

            cli.disable();
            createSpy.mockRestore();

            return { requestedUrls, registeredScripts, blameRound };
        };

        it('registers outputs in a blame round with inputs of the failed round', async () => {
            // One output, so that only the address of the failed round is registered.
            jest.mocked(getOutputAmounts).mockReturnValueOnce([11000000]);
            const { requestedUrls, registeredScripts, blameRound } = await runBlameRound([
                OTHER_OUTPOINT,
            ]);

            expect(requestedUrls).toContainEqual(expect.stringMatching(/\/credential-issuance$/));
            // The output of the failed round, not the free address nor that of the earlier round.
            expect(registeredScripts).toEqual([
                getScriptPubKeyFromAddress(FAILED_ROUND_ADDRESS, networks.testnet, 'Taproot'),
            ]);
            expect(blameRound?.failed).toEqual([]);
        });

        it('refuses a blame round with an input which was not in the failed round', async () => {
            const { requestedUrls, blameRound } = await runBlameRound([
                OTHER_OUTPOINT,
                FOREIGN_OUTPOINT,
            ]);

            // The own input joined the blame round, but the coordinator learns no output.
            expect(requestedUrls).toContainEqual(expect.stringMatching(/\/input-registration$/));
            expect(requestedUrls).not.toContainEqual(
                expect.stringMatching(/\/credential-issuance$/),
            );
            expect(requestedUrls).not.toContainEqual(
                expect.stringMatching(/\/output-registration$/),
            );
            expect(blameRound?.failed).toEqual([
                expect.objectContaining({
                    outpoint: OWN_UTXO.outpoint,
                    error: expect.stringMatching(
                        /1 inputs of the blame round were not in the failed round/,
                    ),
                }),
            ]);
        });
    });

    describe('coordinator misbehavior', () => {
        const OWN_OUTPOINT = `${'a'.repeat(64)}00000000`;
        const OTHER_OWN_OUTPOINT = `${'b'.repeat(64)}00000000`;

        const createAccount = (accountKey: string): RegisterAccountParams => ({
            accountKey,
            scriptType: 'Taproot',
            utxos: [],
            changeAddresses: [],
            targetAnonymity: 10,
            rawLiquidityClue: 0,
            maxFeePerKvbyte: 1,
            maxCoordinatorFeeRate: 1,
            maxRounds: 10,
        });

        // The first round the client gets with accounts is in output registration and has only
        // the given inputs of account-A.
        const mockFirstRound = (outpoints: string[]) => {
            let firstRound: CoinjoinRound | undefined;
            const createSpy = jest
                .spyOn(CoinjoinRound, 'create')
                .mockImplementation(({ accounts, prison, options }) => {
                    if (firstRound || accounts.length === 0) return Promise.resolve(undefined);

                    firstRound = createCoinjoinRound(
                        outpoints.map(outpoint => createInput('account-A', outpoint)),
                        {
                            ...options,
                            prison,
                            round: {
                                phase: RoundPhase.OutputRegistration,
                                coinjoinState: {
                                    Type: '',
                                    Events: [
                                        ROUND_CREATION_EVENT,
                                        ...outpoints.map(outpoint =>
                                            createInputAddedEvent(outpoint.toUpperCase()),
                                        ),
                                    ],
                                },
                            },
                        },
                    );

                    return Promise.resolve(firstRound);
                });

            return { createSpy, getFirstRound: () => firstRound };
        };

        it('stops all accounts once the coordinator lies in a round', async () => {
            let statusRounds = [DEFAULT_ROUND];
            const requestedUrls: string[] = [];
            server?.addListener('test-request', ({ url, resolve }) => {
                requestedUrls.push(url);
                if (url.endsWith('/status')) {
                    resolve({
                        RoundStates: statusRounds,
                        CoinJoinFeeRateMedians: FEE_RATE_MEDIANS,
                    });
                }
                resolve();
            });

            // Fewer inputs than minInputCount of the mock server.
            const { createSpy, getFirstRound } = mockFirstRound([OWN_OUTPOINT]);

            const cli = new CoinjoinClient(server?.requestOptions);
            const stopped = createDeferred<SessionPhaseEvent>();
            cli.on('session-phase', event => {
                if (event.phase === SessionPhase.CoordinatorMisbehavior) stopped.resolve(event);
            });

            await cli.enable();
            cli.registerAccount(createAccount('account-A'));
            cli.registerAccount(createAccount('account-B'));

            // account-B has no input in the round and stops as well.
            expect(await stopped.promise).toEqual({
                phase: SessionPhase.CoordinatorMisbehavior,
                accountKeys: ['account-A', 'account-B'],
            });
            expect(getFirstRound()?.failed).toEqual([
                expect.objectContaining({ error: expect.any(CoordinatorMisbehaviorError) }),
            ]);
            expect(cli.getAccounts()).toEqual([]);

            // A new round in the status gets no account.
            const callsBeforeNewRound = createSpy.mock.calls.length;
            const statusChanged = createDeferred();
            cli.on('status', () => statusChanged.resolve());
            statusRounds = [
                DEFAULT_ROUND,
                createStatusRound({ InputRegistrationTimeout: '0d 0h 2m 0s' }),
            ];
            await statusChanged.promise;
            // onStatusUpdate creates rounds after the status event.
            await new Promise(resolve => setTimeout(resolve, 0));

            const callsAfterNewRound = createSpy.mock.calls.slice(callsBeforeNewRound);
            expect(callsAfterNewRound).not.toHaveLength(0);
            callsAfterNewRound.forEach(([{ accounts }]) => expect(accounts).toEqual([]));
            expect(requestedUrls).not.toContainEqual(
                expect.stringMatching(/\/input-registration$/),
            );

            cli.disable();
            createSpy.mockRestore();
        });

        it('keeps the accounts when a round fails without a lie', async () => {
            server?.addListener('test-request', ({ url, resolve }) => {
                if (url.endsWith('/status')) {
                    resolve({
                        RoundStates: [DEFAULT_ROUND],
                        CoinJoinFeeRateMedians: FEE_RATE_MEDIANS,
                    });
                }
                resolve();
            });

            // No inputs of other participants, a plain Error (see verifyRoundInputs).
            const { createSpy, getFirstRound } = mockFirstRound([OWN_OUTPOINT, OTHER_OWN_OUTPOINT]);

            const cli = new CoinjoinClient(server?.requestOptions);
            const sessionPhases: SessionPhase[] = [];
            cli.on('session-phase', ({ phase }) => sessionPhases.push(phase));
            const ended = createDeferred();
            cli.on('round', ({ round }) => {
                if (round.phase === RoundPhase.Ended) ended.resolve();
            });

            await cli.enable();
            cli.registerAccount(createAccount('account-A'));
            cli.registerAccount(createAccount('account-B'));
            await ended.promise;

            const failed = getFirstRound()?.failed ?? [];
            expect(failed.map(({ error }) => error?.message)).toEqual([
                expect.stringMatching(/No inputs of other participants/),
                expect.stringMatching(/No inputs of other participants/),
            ]);
            expect(failed.map(({ error }) => error instanceof CoordinatorMisbehaviorError)).toEqual(
                [false, false],
            );
            expect(sessionPhases).not.toContain(SessionPhase.CoordinatorMisbehavior);
            expect(cli.getAccounts().map(({ accountKey }) => accountKey)).toEqual([
                'account-A',
                'account-B',
            ]);

            cli.disable();
            createSpy.mockRestore();
        });
    });
});
