import { createDeferred } from '@trezor/utils';
import { networks } from '@trezor/utxo-lib';

import { CoinjoinClient } from './CoinjoinClient';
import { CoinjoinPrison } from './CoinjoinPrison';
import { CoinjoinRound } from './CoinjoinRound';
import { createServer } from '../../mocks/server';
import { createInput } from '../__fixtures__/input.fixture';
import {
    DEFAULT_ROUND,
    FEE_RATE_MEDIANS,
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
    createTransactionData,
} from '../__fixtures__/round.fixture';
import { EndRoundState, RoundPhase, SessionPhase } from '../enums';
import { type RegisterAccountParams } from '../types/account';
import type { CoinjoinInputAddedEvent, CoinjoinStateEvent, Round } from '../types/coordinator';
import type { SerializedCoinjoinRound } from '../types/round';
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
        const prisonEventPromise = new Promise<void>(resolve => {
            cli.on('prison', event => {
                cli.unregisterAccount('account-A');
                cli.disable();

                expect(event.prison.length).toEqual(4); // 4 elements are detained at the end
                resolve();
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
        expect(spyDetain.mock.calls.length).toEqual(2); // but only 2 new inmates were added

        // wait for prison event
        await prisonEventPromise;
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

    describe('blame round', () => {
        const FAILED_ROUND_ID = '1'.repeat(64);
        const BLAME_ROUND_ID = '2'.repeat(64);
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

        // Inputs confirm their connection every half of the timeout, keep the test short.
        const BLAME_ROUND_CREATION_EVENT = {
            ...ROUND_CREATION_EVENT,
            RoundParameters: {
                ...ROUND_CREATION_EVENT.RoundParameters,
                ConnectionConfirmationTimeout: '0d 0h 0m 1s',
            },
        };

        const FAILED_ROUND: Round = {
            ...DEFAULT_ROUND,
            Id: FAILED_ROUND_ID,
            Phase: RoundPhase.TransactionSigning,
        };
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
            const InputRegistrationEnd = new Date(Date.now() + 120000).toUTCString();
            const createBlameRound = (Phase: RoundPhase, Events: CoinjoinStateEvent[] = []) => ({
                ...DEFAULT_ROUND,
                Id: BLAME_ROUND_ID,
                BlameOf: FAILED_ROUND_ID,
                Phase,
                InputRegistrationEnd,
                CoinjoinState: { Type: '', Events: [BLAME_ROUND_CREATION_EVENT, ...Events] },
            });

            let statusRounds = [FAILED_ROUND];
            const requestedUrls: string[] = [];
            const signatureSent = createDeferred();
            const outputRegistrationDone = createDeferred();
            server?.addListener('test-request', ({ url, resolve }) => {
                requestedUrls.push(url);
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
                } else if (url.endsWith('/connection-confirmation')) {
                    resolve({
                        RealAmountCredentials: [{ Value: 12000000 }, { Value: 0 }],
                        RealVsizeCredentials: [{ Value: 200 }, { Value: 0 }],
                    });
                } else if (url.endsWith('/get-outputs-amounts')) {
                    resolve({ OutputAmounts: [11000000] });
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
                .mockImplementationOnce(({ prison, options }) =>
                    Promise.resolve(
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
                    ),
                );

            const cli = new CoinjoinClient(server?.requestOptions);
            let blameRound: SerializedCoinjoinRound | undefined;
            cli.on('round', ({ round }) => {
                if (round.id !== BLAME_ROUND_ID) return;

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
                changeAddresses: [
                    {
                        path: "m/10025'/1'/0'/1'/1/0",
                        address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
                    },
                    {
                        path: "m/10025'/1'/0'/1'/1/1",
                        address: 'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
                    },
                ],
            });

            await signatureSent.promise;
            statusRounds = [ENDED_FAILED_ROUND, createBlameRound(RoundPhase.InputRegistration)];
            await outputRegistrationDone.promise;

            cli.disable();
            createSpy.mockRestore();

            return { requestedUrls, blameRound };
        };

        it('registers outputs in a blame round with inputs of the failed round', async () => {
            const { requestedUrls, blameRound } = await runBlameRound([OTHER_OUTPOINT]);

            expect(requestedUrls).toContainEqual(expect.stringMatching(/\/credential-issuance$/));
            expect(requestedUrls).toContainEqual(expect.stringMatching(/\/output-registration$/));
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
});
