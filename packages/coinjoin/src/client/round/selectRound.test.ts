import { noopLogger } from '@trezor/logger';

import { createServer } from '../../../mocks/server';
import {
    DEFAULT_ROUND,
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createStatusRound,
} from '../../__fixtures__/round.fixture';
import { ROUND_SELECTION_MAX_OUTPUTS } from '../../constants';
import { SessionPhase, WabiSabiProtocolErrorCode } from '../../enums';
import type { AliceGenerator } from '../../types/alice';
import type { CoinjoinRoundParameters, Round } from '../../types/coordinator';
import type { CoinjoinPrisonInmate } from '../../types/prison';
import type { CoinjoinRoundGenerator } from '../../types/round';
import { Alice } from '../Alice';
import { CoinjoinPrison } from '../CoinjoinPrison';
import { CoinjoinRound } from '../CoinjoinRound';
import {
    getAccountCandidates,
    getRoundCandidates,
    getUnregisteredAccounts,
    selectInputsForRound,
    selectRound,
} from './selectRound';

const ACCOUNT = {
    accountKey: 'account-A',
    scriptType: 'Taproot',
    skipRoundCounter: 0,
    utxos: [
        { outpoint: 'AA', anonymityLevel: 1 },
        { outpoint: 'AB', anonymityLevel: 1 },
    ],
    changeAddresses: new Array(ROUND_SELECTION_MAX_OUTPUTS).fill({ address: 'bc1p' }),
} as any; // as Account

describe('selectRound', () => {
    let server: Awaited<ReturnType<typeof createServer>>;

    const roundGenerator: CoinjoinRoundGenerator = (...args) => new CoinjoinRound(...args);
    const aliceGenerator: AliceGenerator = (...args) => new Alice(...args);
    const prison = new CoinjoinPrison();

    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        prison.inmates = [];
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        jest.clearAllMocks();
        if (server) server.close();
    });

    it('no available candidates in status Rounds', async () => {
        const result = await getRoundCandidates({
            roundGenerator,
            prison,
            statusRounds: [{ Phase: 1 }, { Phase: 0, InputRegistrationEnd: new Date() }] as any,
            coinjoinRounds: [],
            options: server?.requestOptions,
        });
        expect(result).toEqual([]);
    });

    it('CoinjoinRound creation errored on status Round without RoundCreated event', async () => {
        const result = await getRoundCandidates({
            roundGenerator,
            prison,
            statusRounds: [
                {
                    ...DEFAULT_ROUND,
                    CoinjoinState: {
                        Events: [],
                    },
                },
            ] as any,
            coinjoinRounds: [],
            options: server?.requestOptions,
        });
        expect(result).toEqual([]);
    });

    it('select existing CoinjoinRound', () => {
        const cjRound = new CoinjoinRound(DEFAULT_ROUND, prison, server?.requestOptions);
        const result = getRoundCandidates({
            roundGenerator,
            prison,
            statusRounds: [DEFAULT_ROUND],
            coinjoinRounds: [cjRound],
            options: server?.requestOptions,
        });
        expect(result[0]).toBe(cjRound);
    });

    // Status round with the given parameters. Rounds with other numbers start at other times, so
    // they have other ids.
    const createNumberedRound = (
        roundNumber: number,
        RoundParameters: Partial<CoinjoinRoundParameters>,
        BlameOf = DEFAULT_ROUND.BlameOf,
    ): Round =>
        createStatusRound({
            BlameOf,
            InputRegistrationStart: new Date(
                Date.parse(DEFAULT_ROUND.InputRegistrationStart) + roundNumber,
            ).toISOString(),
            RoundParameters,
        });

    describe('rounds whose id does not match their parameters', () => {
        // The coordinator serves other credential issuer keys under the id of a round.
        const withOtherIssuerKeys = (round: Round): Round => ({
            ...round,
            AmountCredentialIssuerParameters: DEFAULT_ROUND.VsizeCredentialIssuerParameters,
        });

        it('skips them before a CoinjoinRound is created and logs each once', () => {
            const logger = { ...noopLogger, warn: jest.fn() };
            const generator = jest.fn(roundGenerator);
            const matchingRound = createNumberedRound(61, {});
            const otherIssuerKeysRound = withOtherIssuerKeys(createNumberedRound(62, {}));
            const otherParametersRound = {
                ...createNumberedRound(63, { MaxAmountCredentialValue: 1000000 }),
                Id: createNumberedRound(63, {}).Id,
            };
            const otherCoordinatorRound = createNumberedRound(64, {
                CoordinationIdentifier: 'OtherCoordinatorIdentifier',
            });
            const params = {
                roundGenerator: generator,
                prison,
                statusRounds: [
                    otherIssuerKeysRound,
                    matchingRound,
                    otherParametersRound,
                    otherCoordinatorRound,
                ],
                coinjoinRounds: [],
                options: { ...server?.requestOptions, logger },
            };

            expect(getRoundCandidates(params).map(({ id }) => id)).toEqual([matchingRound.Id]);
            expect(getRoundCandidates(params).map(({ id }) => id)).toEqual([matchingRound.Id]);

            expect(generator.mock.calls.map(([round]) => round.Id)).toEqual([
                matchingRound.Id,
                matchingRound.Id,
            ]);
            expect(logger.warn).toHaveBeenCalledTimes(3);
            [otherIssuerKeysRound, otherParametersRound, otherCoordinatorRound].forEach(round =>
                expect(logger.warn).toHaveBeenCalledWith(
                    `Skipping round ~~${round.Id}~~. Its id does not match its parameters and coordinator`,
                ),
            );
        });

        it('does not keep a joined round whose status no longer matches its id', () => {
            const logger = { ...noopLogger, warn: jest.fn() };
            const statusRound = createNumberedRound(65, {});
            const joinedRound = new CoinjoinRound(statusRound, prison, server?.requestOptions);

            const result = getRoundCandidates({
                roundGenerator,
                prison,
                statusRounds: [withOtherIssuerKeys(statusRound)],
                coinjoinRounds: [joinedRound],
                options: { ...server?.requestOptions, logger },
            });

            expect(result).toEqual([]);
            // The client leaves the round, it does not skip it.
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('releases inputs waiting for a skipped blame round', () => {
            const blameOf = '6'.repeat(64);
            prison.detainForBlameRound([{ accountKey: 'account-A', outpoint: 'AA' }], blameOf, [
                'AA',
            ]);

            const result = getRoundCandidates({
                roundGenerator,
                prison,
                statusRounds: [withOtherIssuerKeys(createNumberedRound(66, {}, blameOf))],
                coinjoinRounds: [],
                options: server?.requestOptions,
            });

            expect(result).toEqual([]);
            expect(prison.getBlameOfInmates()).toEqual([]);
        });
    });

    it('takes the end of the input registration from its start and timeout', () => {
        const minute = 60000;
        // InputRegistrationEnd is not part of the round id, as in WalletWasabi it is not read.
        const createRoundEndingIn = (endsIn: number, InputRegistrationEnd: string) => ({
            ...createStatusRound({
                InputRegistrationStart: new Date(Date.now() + endsIn - minute).toISOString(),
            }),
            InputRegistrationEnd,
        });
        const endingRound = createRoundEndingIn(
            10000,
            new Date(Date.now() + 10 * minute).toISOString(),
        );
        const openRound = createRoundEndingIn(10 * minute, new Date(Date.now()).toISOString());

        const result = getRoundCandidates({
            roundGenerator,
            prison,
            statusRounds: [endingRound, openRound],
            coinjoinRounds: [],
            options: server?.requestOptions,
        });

        expect(result.map(({ id }) => id)).toEqual([openRound.Id]);
        expect(result[0]?.inputRegistrationEnd).toEqual(
            new Date(Date.parse(openRound.InputRegistrationStart) + minute).toISOString(),
        );
    });

    describe('rounds with MinInputCountByRound below minInputCount', () => {
        const blameOf = '1'.repeat(64);

        it('skips regular and blame rounds', () => {
            const joinedRound = createNumberedRound(2, { MinInputCountByRound: 21 });
            const joinedBlameRound = createNumberedRound(4, { MinInputCountByRound: 21 }, blameOf);
            const result = getRoundCandidates({
                roundGenerator,
                prison,
                statusRounds: [
                    createNumberedRound(1, { MinInputCountByRound: 20 }),
                    joinedRound,
                    createNumberedRound(3, { MinInputCountByRound: 20 }, blameOf),
                    joinedBlameRound,
                ],
                coinjoinRounds: [],
                options: { ...server?.requestOptions, minInputCount: 21 },
            });

            expect(result.map(({ id }) => id)).toEqual([joinedRound.Id, joinedBlameRound.Id]);
        });

        it('releases inputs waiting for a skipped blame round', () => {
            const otherBlameOf = '2'.repeat(64);
            prison.detainForBlameRound([{ accountKey: 'account-A', outpoint: 'AA' }], blameOf, [
                'AA',
            ]);
            prison.detainForBlameRound(
                [{ accountKey: 'account-B', outpoint: 'BA' }],
                otherBlameOf,
                ['BA'],
            );

            const params = {
                roundGenerator,
                prison,
                coinjoinRounds: [],
                options: server?.requestOptions,
            };

            // a skipped regular round does not release them
            expect(
                getRoundCandidates({
                    ...params,
                    statusRounds: [createNumberedRound(11, { MinInputCountByRound: 1 })],
                }),
            ).toEqual([]);
            expect(prison.getBlameOfInmates()).toHaveLength(2);

            expect(
                getRoundCandidates({
                    ...params,
                    statusRounds: [createNumberedRound(12, { MinInputCountByRound: 1 }, blameOf)],
                }),
            ).toEqual([]);
            expect(prison.getBlameOfInmates()).toEqual([
                expect.objectContaining({ id: 'BA', roundId: otherBlameOf }),
            ]);
        });

        it('logs a skipped round once', () => {
            const logger = { ...noopLogger, info: jest.fn() };
            const statusRound = createNumberedRound(21, { MinInputCountByRound: 1 });
            const params = {
                roundGenerator,
                prison,
                statusRounds: [statusRound],
                coinjoinRounds: [],
                options: { ...server?.requestOptions, logger },
            };

            getRoundCandidates(params);
            getRoundCandidates(params);

            expect(logger.info).toHaveBeenCalledTimes(1);
            expect(logger.info).toHaveBeenCalledWith(
                `Skipping round ~~${statusRound.Id}~~. Min input count 1 is below 2`,
            );
        });
    });

    describe('rounds with AllowedOutputAmounts.Min of 0.0001 BTC or more', () => {
        const withMinOutputAmount = (Min: number) => ({
            AllowedOutputAmounts: {
                ...ROUND_CREATION_EVENT.RoundParameters.AllowedOutputAmounts,
                Min,
            },
        });

        it('skips regular and blame rounds and releases inputs waiting for them', () => {
            const blameOf = '3'.repeat(64);
            const skippedBlameOf = '4'.repeat(64);
            prison.detainForBlameRound([{ accountKey: 'account-A', outpoint: 'AA' }], blameOf, [
                'AA',
            ]);
            prison.detainForBlameRound(
                [{ accountKey: 'account-B', outpoint: 'BA' }],
                skippedBlameOf,
                ['BA'],
            );

            const joinedRound = createNumberedRound(31, withMinOutputAmount(9999));
            const joinedBlameRound = createNumberedRound(33, withMinOutputAmount(9999), blameOf);
            const result = getRoundCandidates({
                roundGenerator,
                prison,
                statusRounds: [
                    joinedRound,
                    createNumberedRound(32, withMinOutputAmount(10000)),
                    joinedBlameRound,
                    createNumberedRound(34, withMinOutputAmount(10000), skippedBlameOf),
                ],
                coinjoinRounds: [],
                options: server?.requestOptions,
            });

            expect(result.map(({ id }) => id)).toEqual([joinedRound.Id, joinedBlameRound.Id]);
            expect(prison.getBlameOfInmates()).toEqual([
                expect.objectContaining({ id: 'AA', roundId: blameOf }),
            ]);
        });
    });

    describe('blame rounds with fees above the limits of the account', () => {
        const blameOf = '5'.repeat(64);
        const { MiningFeeRate, CoordinationFeeRate } = ROUND_CREATION_EVENT.RoundParameters;
        const account = {
            ...ACCOUNT,
            maxFeePerKvbyte: MiningFeeRate,
            maxCoordinatorFeeRate: CoordinationFeeRate.Rate,
            utxos: [{ outpoint: 'AA', amount: 5000, anonymityLevel: 1 }],
        };

        it.each([
            ['mining fee rate', { MiningFeeRate: MiningFeeRate + 1 }],
            [
                'coordination fee rate',
                { CoordinationFeeRate: { ...CoordinationFeeRate, Rate: 0.0031 } },
            ],
        ])('skips the round with a high %s and releases its inputs', async (_, roundParameters) => {
            prison.detainForBlameRound([{ accountKey: 'account-A', outpoint: 'AA' }], blameOf, [
                'AA',
            ]);

            const result = await selectRound({
                roundGenerator,
                aliceGenerator,
                accounts: [account],
                statusRounds: [createNumberedRound(51, roundParameters, blameOf)],
                coinjoinRounds: [],
                prison,
                options: server?.requestOptions,
            });

            expect(result).toBeUndefined();
            expect(prison.getBlameOfInmates()).toEqual([]);
        });

        it('joins the round with inputs of the accounts within their limits', async () => {
            const blameRound = createNumberedRound(52, {}, blameOf);
            prison.detainForBlameRound(
                [
                    { accountKey: 'account-A', outpoint: 'AA' },
                    { accountKey: 'account-B', outpoint: 'BA' },
                ],
                blameOf,
                ['AA', 'BA'],
            );

            const result = await selectRound({
                roundGenerator,
                aliceGenerator,
                accounts: [
                    { ...account, maxFeePerKvbyte: MiningFeeRate - 1 },
                    {
                        ...account,
                        accountKey: 'account-B',
                        utxos: [{ outpoint: 'BA', amount: 5000, anonymityLevel: 1 }],
                    },
                ],
                statusRounds: [blameRound],
                coinjoinRounds: [],
                prison,
                options: server?.requestOptions,
            });

            expect(result).toMatchObject({
                id: blameRound.Id,
                blameOf,
                inputs: [{ outpoint: 'BA' }],
            });
        });
    });

    it('no available Accounts', () => {
        const result = getAccountCandidates({
            accounts: [],
            statusRounds: [],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result).toEqual([]);
    });

    it('no available utxos', () => {
        const result = getAccountCandidates({
            accounts: [{ ...ACCOUNT, utxos: [] }],
            statusRounds: [],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result).toEqual([]);
    });

    it('utxo in prison', () => {
        prison.detain({ accountKey: ACCOUNT.accountKey, outpoint: 'Ba99ed' });

        const result = getAccountCandidates({
            accounts: [{ ...ACCOUNT, utxos: [{ outpoint: 'Ba99ed', anonymityLevel: 1 }] }],
            statusRounds: [],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result).toEqual([]);
    });

    it('utxo already registered in CoinjoinRound', () => {
        const result = getAccountCandidates({
            accounts: [{ ...ACCOUNT, utxos: [{ outpoint: 'AA', anonymityLevel: 1 }] }],
            statusRounds: [],
            coinjoinRounds: [
                {
                    id: '00',
                    inputs: [{ outpoint: 'AA' }],
                    failed: [],
                },
            ] as any,
            prison,
            options: server?.requestOptions,
        });
        expect(result).toEqual([]);
    });

    it('Account already registered in CoinjoinRound', () => {
        const result = getUnregisteredAccounts({
            accounts: [ACCOUNT],
            coinjoinRounds: [
                {
                    id: '03',
                    inputs: [{ accountKey: 'account-A', outpoint: 'AA' }],
                    failed: [{ outpoint: 'Fa17ed' }],
                },
            ] as any,
            options: server?.requestOptions,
        });

        expect(result).toEqual([]);
    });

    it('Account skipping rounds', () => {
        const accounts = [{ ...ACCOUNT, skipRounds: [4, 5] }];
        // iterate 5 times
        const result = new Array(5).fill(0, 0, 5).flatMap(() =>
            getAccountCandidates({
                accounts,
                statusRounds: [],
                coinjoinRounds: [],
                prison,
                options: server?.requestOptions,
            }),
        );

        // skipped at least once
        expect(result.length).toBeLessThan(5); // should be 4 but there is always 20% chance that will be 3
    });

    describe('change addresses of the account', () => {
        const CHANGE_ADDRESSES = Array.from({ length: 20 }, (_, index) => ({
            address: `bc1p${index}`,
        }));
        const createInmates = (
            addresses: number[],
            inmate: Omit<CoinjoinPrisonInmate, 'id' | 'type'>,
        ): CoinjoinPrisonInmate[] =>
            addresses.map(index => ({ ...inmate, id: `bc1p${index}`, type: 'output' }));
        const getCandidates = (
            inmates: CoinjoinPrisonInmate[],
            {
                account = {},
                statusRounds = [],
            }: { account?: Partial<typeof ACCOUNT>; statusRounds?: Round[] } = {},
        ) => {
            const accountPrison = new CoinjoinPrison(inmates);
            const logger = { ...noopLogger, info: jest.fn() };
            const setSessionPhase = jest.fn();
            const candidates = getAccountCandidates({
                accounts: [{ ...ACCOUNT, changeAddresses: CHANGE_ADDRESSES, ...account }],
                statusRounds,
                coinjoinRounds: [],
                prison: accountPrison,
                options: { ...server?.requestOptions, logger, setSessionPhase },
            });

            return { candidates, accountPrison, logger, setSessionPhase };
        };
        const BROADCAST = {
            accountKey: 'account-A',
            sentenceStart: 1000,
            sentenceEnd: Infinity,
            errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
            roundId: 'B'.repeat(64),
        };
        const registeredInRound = (roundId: string, sentenceStart: number) => ({
            accountKey: 'account-A',
            sentenceStart,
            sentenceEnd: Infinity,
            errorCode: 'registeredOutput' as const,
            roundId,
        });

        it('need 10 free ones', () => {
            const account = { changeAddresses: CHANGE_ADDRESSES.slice(0, 10) };
            expect(getCandidates([], { account }).candidates).toHaveLength(1);

            const { candidates, setSessionPhase } = getCandidates(
                createInmates([0], {
                    accountKey: 'account-A',
                    sentenceStart: Date.now(),
                    sentenceEnd: Date.now() + 60000,
                }),
                { account },
            );
            expect(candidates).toEqual([]);
            expect(setSessionPhase).toHaveBeenCalledWith({
                phase: SessionPhase.SkippingRound,
                accountKeys: ['account-A'],
            });
        });

        it('are recycled from the oldest failed rounds until 10 are free', () => {
            const inmates = [
                ...createInmates([0, 1, 2, 3], BROADCAST), // oldest, broadcast
                // rejected by the coordinator with AlreadyRegisteredScript
                ...createInmates([4], { ...BROADCAST, sentenceStart: 1500, roundId: undefined }),
                ...createInmates([5, 6, 7, 8], registeredInRound('01', 2000)),
                ...createInmates([9, 10, 11], registeredInRound('02', 3000)),
                ...createInmates([12, 13, 14], registeredInRound('03', 4000)),
                // the oldest failed round, its address is no longer among the change addresses
                { ...registeredInRound('00', 500), id: 'bc1p99', type: 'output' as const },
            ];

            const { candidates, accountPrison, logger } = getCandidates(inmates);

            expect(candidates).toHaveLength(1);
            expect(logger.info).toHaveBeenCalledWith(
                'Recycling 7 change addresses of 2 failed rounds of ~~account-A~~',
            );
            expect(accountPrison.inmates.map(({ id }) => id)).toEqual([
                ...['bc1p0', 'bc1p1', 'bc1p2', 'bc1p3', 'bc1p4'],
                ...['bc1p12', 'bc1p13', 'bc1p14', 'bc1p99'],
            ]);
        });

        it('of a broadcast transaction are never recycled', () => {
            const inmates = [
                ...createInmates([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], BROADCAST),
                ...createInmates([11], registeredInRound('01', 2000)),
            ];

            const { candidates, accountPrison, setSessionPhase } = getCandidates(inmates);

            // 8 free ones and 1 recyclable one are too few, none is recycled
            expect(candidates).toEqual([]);
            expect(accountPrison.inmates).toEqual(inmates);
            expect(setSessionPhase).toHaveBeenCalledWith({
                phase: SessionPhase.SkippingRound,
                accountKeys: ['account-A'],
            });
        });

        it('of a round in the status are not recycled', () => {
            const inmates = [
                ...createInmates([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], registeredInRound('01', 2000)),
                ...createInmates([10, 11, 12], registeredInRound('02', 3000)),
                ...createInmates([13, 14], registeredInRound('03', 4000)),
            ];

            const { candidates, accountPrison, logger } = getCandidates(inmates, {
                statusRounds: [{ ...DEFAULT_ROUND, Id: '01' }],
            });

            expect(candidates).toHaveLength(1);
            expect(logger.info).toHaveBeenCalledWith(
                'Recycling 5 change addresses of 2 failed rounds of ~~account-A~~',
            );
            expect(accountPrison.inmates).toEqual(inmates.slice(0, 10));
        });

        it.each([
            ['without available utxos', { utxos: [] }, SessionPhase.AccountMissingUtxos],
            [
                'skipping the round',
                { skipRounds: [4, 5], skipRoundCounter: 4 },
                SessionPhase.SkippingRound,
            ],
        ])('are not recycled for an account %s', (_, account, phase) => {
            const inmates = createInmates(
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                registeredInRound('01', 2000),
            );

            const { candidates, accountPrison, setSessionPhase } = getCandidates(inmates, {
                account,
            });

            expect(candidates).toEqual([]);
            expect(accountPrison.inmates).toEqual(inmates);
            expect(setSessionPhase).toHaveBeenCalledWith({ phase, accountKeys: ['account-A'] });
        });
    });

    it('middleware/select-inputs-for-round throws error', async () => {
        // mock server response
        // return error for each round with miningFeeRate: 1 (second round in fixture)
        // for other rounds return invalid indices
        const spy = jest.fn();
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                spy();
                if (data.MiningFeeRate === 1) {
                    reject(500, { error: 'ExpectedRuntimeError' });
                } else {
                    resolve({
                        Indices: [5], // non existing indices (utxo indexes)
                    });
                }
            }
            resolve();
        });

        const result = await selectInputsForRound({
            aliceGenerator,
            roundCandidates: [
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: '01' },
                }),
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: '02' },
                    roundParameters: { MiningFeeRate: 1 },
                }),
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: '03' },
                }),
            ],
            accountCandidates: [
                {
                    ...ACCOUNT,
                    accountKey: 'account1',
                    utxos: [{ outpoint: 'AA', amount: 100, anonymityLevel: 1 }],
                },
                {
                    ...ACCOUNT,
                    accountKey: 'account2',
                    utxos: [{ outpoint: 'BA', amount: 100, anonymityLevel: 1 }],
                },
            ],
            options: server?.requestOptions,
        });

        expect(spy).toHaveBeenCalledTimes(6);
        expect(result).toBeUndefined();
    });

    it('Skipping round when fees are high', async () => {
        // mock server response
        // return error for each round with miningFeeRate: 1 (second round in fixture)
        // for other rounds return invalid indices
        const spy = jest.fn();
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                spy();
                resolve([]);
            }
            resolve();
        });

        const result = await selectInputsForRound({
            aliceGenerator,
            roundCandidates: [
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: '01' },
                    roundParameters: {
                        MiningFeeRate: 200,
                        CoordinationFeeRate: {
                            Rate: 0.004,
                            PlebsDontPayThreshold: 0.004,
                        },
                    },
                }),
            ],
            accountCandidates: [
                {
                    ...ACCOUNT,
                    accountKey: 'account1',
                    maxFeePerKvbyte: 100,
                    utxos: [{ outpoint: 'AA', amount: 100, anonymityLevel: 1 }],
                },
                {
                    ...ACCOUNT,
                    accountKey: 'account2',
                    maxCoordinatorFeeRate: 0.003,
                    utxos: [{ outpoint: 'BA', amount: 100, anonymityLevel: 1 }],
                },
                {
                    ...ACCOUNT,
                    accountKey: 'account3',
                    maxCoordinatorFeeRate: 0.005,
                    utxos: [{ outpoint: 'CA', amount: 1000, anonymityLevel: 1 }],
                },
            ],
            options: server?.requestOptions,
        });

        expect(spy).toHaveBeenCalledTimes(1); // middleware was called once for account3
        expect(result).toBeUndefined();
    });

    it('Skipping round when selected utxo value > maxSuggestedAmount', async () => {
        const spy = jest.fn();
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                spy();
                resolve({ Indices: [0] });
            }
            resolve();
        });

        const result = await selectInputsForRound({
            aliceGenerator,
            roundCandidates: [
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: '01' },
                    roundParameters: {
                        MaxSuggestedAmount: 1000,
                    },
                }),
            ],
            accountCandidates: [
                {
                    ...ACCOUNT,
                    accountKey: 'account1',
                    utxos: [{ outpoint: 'AA', amount: 1001, anonymityLevel: 1 }],
                },
            ],
            options: server?.requestOptions,
        });

        expect(spy).toHaveBeenCalledTimes(1); // middleware was called once
        expect(result).toBeUndefined();
    });

    it('Skipping round when selected utxo effective value < allowedOutputAmounts.min', async () => {
        const spy = jest.fn();
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                spy();
                resolve({ Indices: [0] });
            }
            resolve();
        });

        const result = await selectInputsForRound({
            aliceGenerator,
            roundCandidates: [
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    roundParameters: {
                        MiningFeeRate: 20000,
                    },
                }),
            ],
            accountCandidates: [
                {
                    ...ACCOUNT,
                    accountKey: 'account1',
                    utxos: [{ outpoint: 'AA', amount: 6561, anonymityLevel: 1 }],
                },
            ],
            options: server?.requestOptions,
        });

        expect(spy).toHaveBeenCalledTimes(1); // middleware was called once
        expect(result).toBeUndefined();
    });

    it('Multiple blame rounds in roundCandidates', async () => {
        // pick utxo which amount is greater than miningFeeRate
        server?.addListener('test-request', ({ url, data, resolve }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                const Indices = data.Utxos.flatMap((utxo: any, i: number) => {
                    if (utxo.Amount < data.MiningFeeRate) return [];

                    return i;
                });
                resolve({ Indices });
            }
            resolve();
        });

        const result = await selectInputsForRound({
            aliceGenerator,
            roundCandidates: [
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: 'ff01', BlameOf: '01ff' },
                }),
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: 'aa02' },
                    roundParameters: {
                        MiningFeeRate: 300000, // this round will be skipped, fees to high
                    },
                }),
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: 'ff02', BlameOf: '02ff' },
                }),
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: 'aa01' },
                }),
                createCoinjoinRound([], {
                    ...server?.requestOptions,
                    statusRound: { Id: 'ff03', BlameOf: '03ff' },
                }),
            ],
            accountCandidates: [
                {
                    ...ACCOUNT,
                    accountKey: 'account1',
                    utxos: [{ outpoint: 'AA', amount: 200000, anonymityLevel: 1 }],
                },
                {
                    ...ACCOUNT,
                    accountKey: 'account2',
                    utxos: [{ outpoint: 'BA', amount: 200000, anonymityLevel: 1 }],
                },
            ],
            options: server?.requestOptions,
        });

        expect(result).toMatchObject({
            id: 'aa01',
            inputs: [{ outpoint: 'AA' }, { outpoint: 'BA' }],
        });
    });

    it('Success. new CoinjoinRound created', async () => {
        // dummy mock of /select-inputs-for-round
        // pick utxo which amount is greater than miningFeeRate + 1000
        const spy = jest.fn();
        server?.addListener('test-request', ({ url, data, resolve }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                spy();
                const Indices = data.Utxos.flatMap((utxo: any, i: number) => {
                    if (utxo.Amount < 1000 + data.MiningFeeRate) return [];

                    return i;
                });

                resolve({
                    Indices,
                });
            }
            resolve();
        });

        const roundWithMiningFee = (MiningFeeRate: number) =>
            createStatusRound({
                RoundParameters: {
                    MiningFeeRate,
                    AllowedOutputAmounts: {
                        Min: 1000, // custom min allowed output amount
                        Max: 1000000000,
                    },
                },
            });
        const roundWithMostUtxos = roundWithMiningFee(1);

        const result = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [
                {
                    ...ACCOUNT,
                    accountKey: 'account-A',
                    utxos: [
                        { outpoint: 'AA', amount: 20000, anonymityLevel: 1 }, // this will be picked by all rounds
                        { outpoint: 'AB', amount: 1001, anonymityLevel: 1 }, // this will be picked only by round "02"
                        { outpoint: 'AC', amount: 1010, anonymityLevel: 1 }, // this will be picked by round "02" and "03" rounds
                    ],
                },
                {
                    ...ACCOUNT,
                    accountKey: 'account-B',
                    utxos: [{ outpoint: 'BA', amount: 900, anonymityLevel: 1 }], // this will not be picked by any round
                },
                {
                    ...ACCOUNT,
                    accountKey: 'account-C',
                    utxos: [{ outpoint: 'CA', amount: 2000, anonymityLevel: 1 }], // this will be picked by all rounds
                },
            ],
            statusRounds: [roundWithMiningFee(20), roundWithMostUtxos, roundWithMiningFee(10)],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });

        expect(spy).toHaveBeenCalledTimes(9);

        ['AA', 'AB', 'AC', 'CA'].forEach((outpoint, index) => {
            const { inputs } = result!;
            // @ts-expect-error: indexing with noUncheckedIndexedAccess
            const input: (typeof result)['inputs'][number] = inputs[index];
            expect(input.outpoint).toEqual(outpoint);
        });

        expect(result).toMatchObject({
            id: roundWithMostUtxos.Id, // this round contains most utxo candidates
            phase: 0,
            roundParameters: { MiningFeeRate: 1 },
            commitmentData: expect.any(String),
        });
    });

    it('Success. new blame Round created', async () => {
        const spy = jest.fn();
        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/select-inputs-for-round')) {
                spy();
                resolve([]);
            }
            resolve();
        });

        const blameOf = '1'.repeat(64);

        const signedOutpoints = ['AA', 'AB', 'CA'];
        prison.detainForBlameRound(
            [
                { accountKey: 'account-A', outpoint: 'AA' },
                { accountKey: 'account-A', outpoint: 'AB' },
            ],
            blameOf,
            signedOutpoints,
        );

        // A blame round has its own input registration timeout, and so its own id.
        const blameRound = createStatusRound({
            BlameOf: blameOf,
            InputRegistrationTimeout: '0d 0h 1m 1s',
        });
        const result = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [
                {
                    ...ACCOUNT,
                    accountKey: 'account-A',
                    utxos: [
                        { outpoint: 'AA', amount: 5000, anonymityLevel: 1 },
                        { outpoint: 'AB', amount: 5000, anonymityLevel: 1 },
                        { outpoint: 'AC', amount: 5000, anonymityLevel: 1 },
                    ],
                },
            ],
            statusRounds: [DEFAULT_ROUND, blameRound],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });

        expect(spy).toHaveBeenCalledTimes(0); // middleware was not called, detained inputs were used
        expect(result?.inputs.length).toBe(2);
        expect(result).toMatchObject({
            id: blameRound.Id,
            blameOf,
            inputs: [{ outpoint: 'AA' }, { outpoint: 'AB' }],
            blameOfOutpoints: signedOutpoints, // the failed round may leave the status
        });
    });

    it('Skip blame Round and release its inputs if inputs of the failed round are unknown', async () => {
        const blameOf = '1'.repeat(64);
        // Prison restored after a restart, the inputs of the failed round are not persisted.
        const restoredPrison = new CoinjoinPrison([
            {
                type: 'input',
                accountKey: 'account-A',
                id: 'AA',
                sentenceStart: Date.now(),
                sentenceEnd: Date.now() + 60000,
                errorCode: 'blameOf',
                roundId: blameOf,
            },
        ]);

        const result = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [
                {
                    ...ACCOUNT,
                    accountKey: 'account-A',
                    utxos: [{ outpoint: 'AA', amount: 5000, anonymityLevel: 1 }],
                },
            ],
            statusRounds: [{ ...DEFAULT_ROUND, BlameOf: blameOf }],
            coinjoinRounds: [],
            prison: restoredPrison,
            options: server?.requestOptions,
        });

        expect(result).toBeUndefined();
        // The inputs would keep all accounts out of regular rounds.
        expect(restoredPrison.inmates).toEqual([]);
    });

    it('too many blocked utxos', async () => {
        prison.detain(
            { outpoint: 'A0', accountKey: ACCOUNT.key },
            { errorCode: WabiSabiProtocolErrorCode.InputBanned },
        );
        prison.detain(
            { outpoint: 'A1', accountKey: ACCOUNT.key },
            { errorCode: WabiSabiProtocolErrorCode.InputBanned },
        );
        prison.detain(
            { outpoint: 'A9', accountKey: ACCOUNT.key },
            { errorCode: WabiSabiProtocolErrorCode.InputLongBanned },
        );

        const setSessionPhaseMock = jest.fn();

        // most of utxos are banned
        const result = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [
                {
                    ...ACCOUNT,
                    utxos: [
                        { outpoint: 'A0', amount: 10000 },
                        { outpoint: 'A1', amount: 10000 },
                        { outpoint: 'AC', amount: 60000 },
                        { outpoint: 'A9', amount: 60000000 },
                    ],
                },
            ],
            statusRounds: [DEFAULT_ROUND],
            coinjoinRounds: [],
            prison,
            options: { ...server?.requestOptions, setSessionPhase: setSessionPhaseMock },
        });
        expect(result).toBeUndefined();
        expect(setSessionPhaseMock).toHaveBeenLastCalledWith({
            accountKeys: ['account-A'],
            phase: SessionPhase.BlockedUtxos,
        });

        // most of amount is banned
        const result2 = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [
                {
                    ...ACCOUNT,
                    accountKey: 'account-B',
                    utxos: [
                        { outpoint: 'A0', amount: 10000 },
                        { outpoint: 'AB', amount: 6000 },
                        { outpoint: 'AC', amount: 6000 },
                        { outpoint: 'A9', amount: 60000000 },
                    ],
                },
            ],
            statusRounds: [DEFAULT_ROUND],
            coinjoinRounds: [],
            prison,
            options: { ...server?.requestOptions, setSessionPhase: setSessionPhaseMock },
        });
        expect(result2).toBeUndefined();
        expect(setSessionPhaseMock).toHaveBeenLastCalledWith({
            accountKeys: ['account-B'],
            phase: SessionPhase.BlockedUtxos,
        });
    });

    // all tested above, this is just for coverage
    it('selectRound without results', async () => {
        // no rounds
        const result = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [],
            statusRounds: [],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result).toBeUndefined();

        // no accounts
        const result2 = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [],
            statusRounds: [DEFAULT_ROUND],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result2).toBeUndefined();

        // no result from middleware
        const result3 = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [{ ...ACCOUNT }],
            statusRounds: [DEFAULT_ROUND],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result3).toBeUndefined();

        // not enough change addresses
        const result4 = await selectRound({
            roundGenerator,
            aliceGenerator,
            accounts: [
                {
                    ...ACCOUNT,
                    changeAddresses: [],
                },
            ],
            statusRounds: [DEFAULT_ROUND],
            coinjoinRounds: [],
            prison,
            options: server?.requestOptions,
        });
        expect(result4).toBeUndefined();
    });
});
