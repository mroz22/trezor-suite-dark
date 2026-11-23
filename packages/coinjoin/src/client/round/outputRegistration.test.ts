import { createDeferred } from '@trezor/utils';
import { networks } from '@trezor/utxo-lib';

import { outputDecomposition } from './outputDecomposition';
import { outputRegistration } from './outputRegistration';
import { createServer } from '../../../mocks/server';
import { createInput } from '../../__fixtures__/input.fixture';
import {
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../../__fixtures__/round.fixture';
import { SessionPhase, WabiSabiProtocolErrorCode } from '../../enums';
import type { AccountAddress, AccountPayment } from '../../types/account';
import type { CoinjoinInputAddedEvent } from '../../types/coordinator';
import type { CoinjoinPrisonInmate } from '../../types/prison';
import { getScriptPubKeyFromAddress } from '../../utils/coordinatorUtils';
import { verifyOwnershipProof } from '../../utils/ownershipProof';
import { CoordinatorMisbehaviorError } from '../coordinator';

// mock random delay function
jest.mock('@trezor/utils', () => {
    const originalModule = jest.requireActual('@trezor/utils');

    return {
        __esModule: true,
        ...originalModule,
        getWeakRandomNumberInRange: () => 0,
    };
});

// The inputs of other participants have no valid ownership proofs, see verifyRoundInputs.test.ts.
jest.mock('../../utils/ownershipProof', () => ({
    verifyOwnershipProof: jest.fn(() => 'valid'),
}));

jest.mock('./outputDecomposition', () => ({
    ...jest.requireActual('./outputDecomposition'),
    outputDecomposition: jest.fn(jest.requireActual('./outputDecomposition').outputDecomposition),
}));

const OWN_OUTPOINT = 'a00000000000000000000000000000000000000000000000000000000000000001000000';
const OTHER_OUTPOINT = 'B00000000000000000000000000000000000000000000000000000000000000002000000';
const OTHER_OUTPOINT_2 = 'C00000000000000000000000000000000000000000000000000000000000000003000000';

// CoinjoinState with the RoundCreated event and the given registered inputs.
const createCoinjoinState = (registeredOutpoints: string[]) => ({
    Type: '',
    Events: [ROUND_CREATION_EVENT, ...registeredOutpoints.map(createInputAddedEvent)],
});

describe('outputRegistration', () => {
    let server: Awaited<ReturnType<typeof createServer>>;

    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        server?.close();
    });

    it('errors on joining credentials (missing data in input)', async () => {
        const response = await outputRegistration(
            createCoinjoinRound([createInput('account-A', OWN_OUTPOINT)], {
                ...server?.requestOptions,
                round: {
                    phase: 3,
                    coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
                },
            }),
            [],
            server?.requestOptions,
        );
        const { inputs } = response;
        // @ts-expect-error: indexing with noUncheckedIndexedAccess
        const firstInput: (typeof inputs)[number] = inputs[0];
        expect(firstInput.error?.message).toMatch(/Missing confirmed credentials/);
        expect(firstInput.error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
    });

    it('errors on insufficient amount of available change addresses', async () => {
        server?.addListener('test-request', ({ url, resolve, reject }) => {
            if (url.endsWith('/output-registration')) {
                // do not accept **any** output
                reject(500, { ErrorCode: 'AlreadyRegisteredScript' });
            }
            resolve();
        });

        // Mock outputDecomposition module responses
        (outputDecomposition as jest.Mock).mockImplementation(() =>
            Promise.resolve([
                {
                    accountKey: 'account-A',
                    outputs: [
                        {
                            accountKey: 'account-A',
                            amount: 2000,
                            vsize: 43,
                            amountCredentials: [],
                            vsizeCredentials: [],
                        },
                    ],
                },
            ]),
        );

        const round = createCoinjoinRound([createInput('account-A', OWN_OUTPOINT)], {
            ...server?.requestOptions,
            round: {
                phase: 3,
                coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
            },
        });

        // Detain first address **before** processing other addresses will not be accepted by coordinator
        round.prison.detain({
            accountKey: 'account-A',
            address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
        });

        const response = await outputRegistration(
            round,
            [
                {
                    accountKey: 'account-A',
                    changeAddresses: [
                        {
                            address:
                                'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
                        },
                        {
                            address:
                                'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
                        },
                    ],
                } as any, // partial Account
            ],
            server?.requestOptions,
        );

        const { inputs } = response;
        // @ts-expect-error: indexing with noUncheckedIndexedAccess
        const firstInput2: (typeof inputs)[number] = inputs[0];
        expect(firstInput2.error?.message).toMatch(/No change address available/);
    });

    describe('change addresses', () => {
        const createChangeAddress = (address: string, index: number): AccountAddress => ({
            path: `m/10025'/1'/0'/1'/1/${index}`,
            address,
            scriptPubKey: getScriptPubKeyFromAddress(address, networks.testnet, 'Taproot'),
        });
        const FIRST = createChangeAddress(
            'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
            0,
        );
        const SECOND = createChangeAddress(
            'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
            1,
        );
        const THIRD = createChangeAddress(
            'tb1p4jf9crt5gh57h2spvfht4zwjtnre700uvs4u63l2g2huchrk2dms4lm6kv',
            2,
        );
        const ACCOUNT = {
            accountKey: 'account-A',
            scriptType: 'Taproot',
            changeAddresses: [FIRST, SECOND, THIRD],
        } as any; // partial Account
        const FAILED_ROUND_ID = '1'.repeat(64);

        // A round of the own and another input in output registration, in which the account
        // registers one output.
        const createRound = (BlameOf = '0'.repeat(64)) => {
            (outputDecomposition as jest.Mock).mockImplementationOnce(() =>
                Promise.resolve([
                    {
                        accountKey: 'account-A',
                        outputs: [
                            {
                                accountKey: 'account-A',
                                amount: 100000,
                                vsize: 43,
                                amountCredentials: [{ Value: 100000 }, { Value: 0 }],
                                vsizeCredentials: [{ Value: 43 }, { Value: 0 }],
                            },
                        ],
                    },
                ]),
            );

            return createCoinjoinRound(
                [createInput('account-A', OWN_OUTPOINT, { registrationData: { AliceId: 'A' } })],
                {
                    ...server?.requestOptions,
                    statusRound: { BlameOf },
                    round: {
                        phase: 2,
                        coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
                        blameOfOutpoints: [OWN_OUTPOINT, OTHER_OUTPOINT],
                    },
                },
            );
        };

        it('are detained for good before the request, also if it fails', async () => {
            const round = createRound();
            const registeredOutput = {
                errorCode: 'registeredOutput',
                roundId: round.id,
                sentenceEnd: Infinity,
            };
            let inmateOnRequest: CoinjoinPrisonInmate | undefined;
            server?.addListener('test-request', ({ url, resolve, reject }) => {
                if (url.endsWith('/output-registration')) {
                    inmateOnRequest = round.prison.isDetained(FIRST.address);
                    reject(500, { ErrorCode: 'WrongPhase' });
                }
                resolve();
            });

            const response = await outputRegistration(round, [ACCOUNT], server?.requestOptions);

            expect(inmateOnRequest).toMatchObject(registeredOutput);
            expect(response.addresses).toEqual([]);
            response.inputs.forEach(input => {
                expect(input.error?.message).toMatch(/WrongPhase/);
            });
            // Not released by the end of the round, see CoinjoinPrison.release.
            round.prison.release([]);
            expect(round.prison.isDetained(FIRST.address)).toMatchObject(registeredOutput);
        });

        it.each([
            ['a blame round of the failed round', FAILED_ROUND_ID, THIRD],
            ['a blame round of another round', '2'.repeat(64), SECOND],
            ['a regular round', '0'.repeat(64), SECOND],
        ])(
            'of a failed round are registered again only in its blame round (%s)',
            async (_, BlameOf, expected) => {
                const scripts: string[] = [];
                server?.addListener('test-request', ({ url, data, resolve }) => {
                    if (url.endsWith('/output-registration')) scripts.push(data.Script);
                    resolve();
                });
                const round = createRound(BlameOf);
                // Registered by the account in another failed round and in the failed round.
                round.prison.detainRegisteredOutput(
                    { accountKey: 'account-A', address: FIRST.address },
                    '3'.repeat(64),
                );
                round.prison.detainRegisteredOutput(
                    { accountKey: 'account-A', address: THIRD.address },
                    FAILED_ROUND_ID,
                );

                const response = await outputRegistration(round, [ACCOUNT], server?.requestOptions);

                response.inputs.forEach(input => {
                    expect(input.error).toBeUndefined();
                });
                expect(scripts).toEqual([expected.scriptPubKey]);
                // A blame round of this round may register it again.
                expect(round.prison.isDetained(expected.address)).toMatchObject({
                    errorCode: 'registeredOutput',
                    roundId: round.id,
                });
                expect(round.prison.isDetained(FIRST.address)).toMatchObject({
                    roundId: '3'.repeat(64),
                });
            },
        );

        it('are tried once more after AlreadyRegisteredScript', async () => {
            const scripts: string[] = [];
            server?.addListener('test-request', ({ url, data, resolve, reject }) => {
                if (url.endsWith('/output-registration')) {
                    scripts.push(data.Script);
                    reject(500, { ErrorCode: 'AlreadyRegisteredScript' });
                }
                resolve();
            });
            const round = createRound();

            const response = await outputRegistration(round, [ACCOUNT], server?.requestOptions);

            response.inputs.forEach(input => {
                expect(input.error?.message).toMatch(/AlreadyRegisteredScript/);
            });
            expect(scripts).toEqual([FIRST.scriptPubKey, SECOND.scriptPubKey]);
            [FIRST, SECOND].forEach(({ address }) => {
                const inmate = round.prison.isDetained(address);
                expect(inmate).toMatchObject({
                    errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
                    sentenceEnd: Infinity,
                });
                expect(inmate?.roundId).toBeUndefined(); // never registered again
            });
            expect(round.prison.isDetained(THIRD.address)).toBeUndefined();
        });
    });

    it('refuses a round with fewer inputs than minInputCount before revealing outputs', async () => {
        const requestedUrls: string[] = [];
        server?.addListener('test-request', ({ url, resolve }) => {
            requestedUrls.push(url);
            resolve();
        });

        const options = { ...server?.requestOptions, minInputCount: 3 };
        const response = await outputRegistration(
            createCoinjoinRound([createInput('account-A', OWN_OUTPOINT)], {
                ...options,
                round: {
                    phase: 2,
                    coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
                },
            }),
            [],
            options,
        );

        expect(outputDecomposition).not.toHaveBeenCalled();
        expect(requestedUrls).toEqual([]); // no /credential-issuance or /output-registration
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(
                /Round has 2 registered inputs but minimum required is 3/,
            );
            // CoinjoinClient stops all accounts on it.
            expect(input.error).toBeInstanceOf(CoordinatorMisbehaviorError);
        });
    });

    it('refuses a round with a different amount of an own input before revealing outputs', async () => {
        const requestedUrls: string[] = [];
        server?.addListener('test-request', ({ url, resolve }) => {
            requestedUrls.push(url);
            resolve();
        });

        // The coordinator announces the own input with amount 1.
        const ownInput = createInput('account-A', OWN_OUTPOINT, {
            amount: 2,
            confirmedAmountCredentials: [{ Value: 2 }],
        });
        const response = await outputRegistration(
            createCoinjoinRound([ownInput], {
                ...server?.requestOptions,
                round: {
                    phase: 2,
                    coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
                },
            }),
            [],
            server?.requestOptions,
        );

        expect(outputDecomposition).not.toHaveBeenCalled();
        expect(requestedUrls).toEqual([]); // no /credential-issuance or /output-registration
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(
                /1 own inputs missing or registered with a different amount or script/,
            );
        });
    });

    it('refuses a round with an invalid ownership proof before revealing outputs', async () => {
        const requestedUrls: string[] = [];
        server?.addListener('test-request', ({ url, resolve }) => {
            requestedUrls.push(url);
            resolve();
        });
        jest.mocked(verifyOwnershipProof).mockReturnValueOnce('invalid');

        const response = await outputRegistration(
            createCoinjoinRound([createInput('account-A', OWN_OUTPOINT)], {
                ...server?.requestOptions,
                round: {
                    phase: 2,
                    coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
                },
            }),
            [],
            server?.requestOptions,
        );

        expect(verifyOwnershipProof).toHaveBeenCalledTimes(1); // not for the own input
        expect(outputDecomposition).not.toHaveBeenCalled();
        expect(requestedUrls).toEqual([]); // no /credential-issuance or /output-registration
        expect(response.verifiedInputs).toBeUndefined();
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(
                /1 inputs of other participants with an invalid ownership proof/,
            );
        });
    });

    it('refuses a blame round with an input which was not in the failed round before revealing outputs', async () => {
        const requestedUrls: string[] = [];
        server?.addListener('test-request', ({ url, resolve }) => {
            requestedUrls.push(url);
            resolve();
        });

        const response = await outputRegistration(
            createCoinjoinRound([createInput('account-A', OWN_OUTPOINT)], {
                ...server?.requestOptions,
                statusRound: { BlameOf: '1'.repeat(64) },
                round: {
                    phase: 2,
                    coinjoinState: createCoinjoinState([
                        OWN_OUTPOINT,
                        OTHER_OUTPOINT,
                        OTHER_OUTPOINT_2,
                    ]),
                    blameOfOutpoints: [OWN_OUTPOINT, OTHER_OUTPOINT],
                },
            }),
            [],
            server?.requestOptions,
        );

        expect(outputDecomposition).not.toHaveBeenCalled();
        expect(requestedUrls).toEqual([]); // no /credential-issuance or /output-registration
        expect(response.verifiedInputs).toBeUndefined();
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(
                /1 inputs of the blame round were not in the failed round/,
            );
        });
    });

    it('does not take a missing own input without confirmed credentials for a lie', async () => {
        const requestedUrls: string[] = [];
        server?.addListener('test-request', ({ url, resolve }) => {
            requestedUrls.push(url);
            resolve();
        });
        // An earlier test replaces the implementation.
        (outputDecomposition as jest.Mock).mockImplementation(
            jest.requireActual('./outputDecomposition').outputDecomposition,
        );

        // The coordinator removed the own input, which did not confirm its connection in time.
        const response = await outputRegistration(
            createCoinjoinRound([createInput('account-A', OWN_OUTPOINT)], {
                ...server?.requestOptions,
                round: {
                    phase: 2,
                    coinjoinState: createCoinjoinState([OTHER_OUTPOINT, OTHER_OUTPOINT_2]),
                },
            }),
            [],
            server?.requestOptions,
        );

        expect(requestedUrls).toEqual([]); // no /credential-issuance or /output-registration
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(/Missing confirmed credentials/);
        });
    });

    // A Taproot output has 43 vB. At 1234 sat/kvB it costs 53.062 sat, the coordinator charges
    // 53 sat and the client expects 54 sat at most. Below 1 sat the client expects the whole rate
    // per kvB, at least 1 sat.
    it.each([
        [1234, 54],
        [20, 20],
        [0, 1],
    ])(
        'expects an output at %i sat/kvB to get its credentials minus %i sat',
        async (MiningFeeRate, outputFee) => {
            (outputDecomposition as jest.Mock).mockImplementationOnce(() =>
                Promise.resolve([
                    {
                        accountKey: 'account-A',
                        outputs: [
                            {
                                accountKey: 'account-A',
                                amount: 100000,
                                vsize: 43,
                                amountCredentials: [{ Value: 100000 }, { Value: 0 }],
                                vsizeCredentials: [{ Value: 43 }, { Value: 0 }],
                            },
                        ],
                    },
                ]),
            );
            const changeAddress = {
                path: "m/10025'/1'/0'/1'/1/0",
                address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
                scriptPubKey: '1 0ffeae3fbd08c25521369afbb6d7dacec99f3b24b6113c2fe497bede04723789',
            };

            const response = await outputRegistration(
                createCoinjoinRound(
                    [
                        createInput('account-A', OWN_OUTPOINT, {
                            registrationData: { AliceId: 'A' },
                        }),
                    ],
                    {
                        ...server?.requestOptions,
                        round: {
                            phase: 2,
                            coinjoinState: createCoinjoinState([OWN_OUTPOINT, OTHER_OUTPOINT]),
                        },
                        roundParameters: { MiningFeeRate },
                    },
                ),
                [
                    {
                        accountKey: 'account-A',
                        scriptType: 'Taproot',
                        changeAddresses: [changeAddress],
                    } as any, // partial Account
                ],
                server?.requestOptions,
            );

            response.inputs.forEach(input => {
                expect(input.error).toBeUndefined();
            });
            // Sorted outpoints as hash:index, the transaction is signed only with these inputs.
            expect(response.verifiedInputs).toEqual([
                `${'0'.repeat(62)}a0:1`,
                `${'0'.repeat(62)}b0:2`,
            ]);
            expect(response.addresses).toEqual([
                { ...changeAddress, accountKey: 'account-A', amount: 100000 - outputFee },
            ]);
        },
    );

    it('a failed output registration fails only the inputs of its account', async () => {
        const FAILING_ADDRESS = {
            path: "m/10025'/1'/0'/1'/1/0",
            address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
            scriptPubKey: '1 0ffeae3fbd08c25521369afbb6d7dacec99f3b24b6113c2fe497bede04723789',
        };
        const OTHER_ACCOUNT_ADDRESS = {
            path: "m/10025'/1'/1'/1'/1/0",
            address: 'tb1p4jf9crt5gh57h2spvfht4zwjtnre700uvs4u63l2g2huchrk2dms4lm6kv',
            scriptPubKey: '1 ac925c0d7445e9ebaa01626eba89d25cc79f3dfc642bcd47ea42afcc5c765377',
        };
        const OTHER_ACCOUNT_OUTPOINT =
            'd00000000000000000000000000000000000000000000000000000000000000004000000';
        const registrations: string[] = [];
        const readyToSign: string[] = [];
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/output-registration')) {
                registrations.push(data.Script);
                if (data.Script === FAILING_ADDRESS.scriptPubKey) {
                    reject(500, { ErrorCode: 'WrongPhase' });
                }
            }
            if (url.endsWith('/ready-to-sign')) readyToSign.push(data.AliceId);
            resolve();
        });
        const createOutput = (accountKey: string, amount: number) => ({
            accountKey,
            amount,
            vsize: 43,
            amountCredentials: [{ Value: amount }, { Value: 0 }],
            vsizeCredentials: [{ Value: 43 }, { Value: 0 }],
        });
        (outputDecomposition as jest.Mock).mockImplementationOnce(() =>
            Promise.resolve([
                { accountKey: 'account-A', outputs: [createOutput('account-A', 100000)] },
                { accountKey: 'account-B', outputs: [createOutput('account-B', 50000)] },
            ]),
        );
        const setSessionPhase = jest.fn();
        const options = { ...server?.requestOptions, setSessionPhase };
        const round = createCoinjoinRound(
            [
                createInput('account-A', OWN_OUTPOINT, { registrationData: { AliceId: 'A' } }),
                createInput('account-B', OTHER_ACCOUNT_OUTPOINT, {
                    registrationData: { AliceId: 'B' },
                }),
            ],
            {
                ...options,
                round: {
                    phase: 2,
                    coinjoinState: createCoinjoinState([
                        OWN_OUTPOINT,
                        OTHER_ACCOUNT_OUTPOINT,
                        OTHER_OUTPOINT,
                    ]),
                },
            },
        );

        const response = await outputRegistration(
            round,
            [
                {
                    accountKey: 'account-A',
                    scriptType: 'Taproot',
                    changeAddresses: [FAILING_ADDRESS],
                },
                {
                    accountKey: 'account-B',
                    scriptType: 'Taproot',
                    changeAddresses: [OTHER_ACCOUNT_ADDRESS],
                },
            ] as any[], // partial Accounts
            options,
        );

        expect(registrations.sort()).toEqual(
            [FAILING_ADDRESS.scriptPubKey, OTHER_ACCOUNT_ADDRESS.scriptPubKey].sort(),
        );
        expect(readyToSign).toEqual(['B']);
        expect(response.inputs.map(input => input.error?.message)).toEqual([
            expect.stringMatching(/WrongPhase/),
            undefined,
        ]);
        expect(response.inputs[0]?.error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(setSessionPhase).toHaveBeenCalledWith({
            phase: SessionPhase.OutputRegistrationFailed,
            accountKeys: ['account-A'],
        });
        expect(setSessionPhase).toHaveBeenLastCalledWith({
            phase: SessionPhase.AwaitingOthersOutputs,
            accountKeys: ['account-B'],
        });
    });
});

describe('outputRegistration with payment', () => {
    let server: Awaited<ReturnType<typeof createServer>>;

    const ANCHOR = `${'a0'.repeat(32)}00000000`;
    const SECOND_INPUT = `${'a1'.repeat(32)}00000000`;
    const OTHER_ACCOUNT_INPUT = `${'b0'.repeat(32)}00000000`;
    // Input of another participant.
    const FOREIGN_INPUT = `${'C0'.repeat(32)}00000000`;
    const FAILED_ROUND_ID = '1'.repeat(64);

    const PAYMENT: AccountPayment = {
        id: 'payment-1',
        address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        amount: 100000,
        anchor: ANCHOR,
        isCancelled: false,
        scriptType: 'P2WPKH',
        scriptPubKey: '0 751e76e8199196d454941c45d1b3a323f1433bd6',
        scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
        outputSize: 31,
    };

    const CHANGE_ADDRESSES = [
        {
            path: "m/10025'/1'/0'/1'/1/0",
            address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
            scriptPubKey: '1 0ffeae3fbd08c25521369afbb6d7dacec99f3b24b6113c2fe497bede04723789',
        },
        {
            path: "m/10025'/1'/0'/1'/1/1",
            address: 'tb1p55k3nua65qqqsq7j9zn8xp6rn3ntht9gj2ww3zfstczytd07htts3txmh9',
            scriptPubKey: '1 a52d19f3baa0000803d228a67307439c66bbaca8929ce889305e0445b5febad7',
        },
    ];

    // change address of another account in the round, without a payment
    const OTHER_CHANGE_ADDRESS = {
        path: "m/10025'/1'/1'/1'/1/0",
        address: 'tb1p4jf9crt5gh57h2spvfht4zwjtnre700uvs4u63l2g2huchrk2dms4lm6kv',
        scriptPubKey: '1 ac925c0d7445e9ebaa01626eba89d25cc79f3dfc642bcd47ea42afcc5c765377',
    };

    // Registered input as the coordinator announces it, with the script of createInput.
    const inputAddedEvent = (
        outpoint: string,
        Value: number,
        ScriptPubKey?: string,
    ): CoinjoinInputAddedEvent => {
        const event = createInputAddedEvent(outpoint.toUpperCase());

        return {
            ...event,
            Coin: {
                ...event.Coin,
                TxOut: { ScriptPubKey: ScriptPubKey ?? event.Coin.TxOut.ScriptPubKey, Value },
            },
        };
    };

    type Registration = { script: string; isRejected?: boolean };

    type RegisterParams = {
        // response of the coordinator to the payment output registration
        respond?: (reject: (code: number, error?: any) => void) => void;
        // response of the coordinator to the change output registration of the paying account,
        // after the payment output was registered
        respondToChange?: (reject: (code: number, error?: any) => void) => void;
        // another account registers a change output in the round
        withOtherAccount?: boolean;
        // id of the failed round, the round is its blame round
        blameOf?: string;
    };

    // register a change output and the payment output
    const register = async ({
        respond = () => {},
        respondToChange,
        withOtherAccount = false,
        blameOf,
    }: RegisterParams = {}) => {
        const registrations: Registration[] = [];
        const readyToSign: string[] = [];
        const paymentRequested = createDeferred();
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/output-registration')) {
                registrations.push({ script: data.Script });
                if (data.Script === PAYMENT.scriptPubKey) {
                    respond(reject);
                    resolve();
                    paymentRequested.resolve();
                }
                const isPayingAccountChange = CHANGE_ADDRESSES.some(
                    address => address.scriptPubKey === data.Script,
                );
                if (respondToChange && isPayingAccountChange) {
                    // after the client handled the response to the payment output
                    paymentRequested.promise.then(() =>
                        setTimeout(() => respondToChange(reject), 50),
                    );

                    return;
                }
            }
            if (url.endsWith('/ready-to-sign')) {
                readyToSign.push(data.AliceId);
            }
            resolve();
        });

        (outputDecomposition as jest.Mock).mockImplementation(() =>
            Promise.resolve([
                {
                    accountKey: 'account-A',
                    outputs: [
                        {
                            accountKey: 'account-A',
                            amount: 20086,
                            vsize: 43,
                            amountCredentials: [],
                            vsizeCredentials: [],
                        },
                        {
                            accountKey: 'account-A',
                            amount: 100062,
                            vsize: 31,
                            amountCredentials: [],
                            vsizeCredentials: [],
                            payment: PAYMENT,
                        },
                    ],
                },
                ...(withOtherAccount
                    ? [
                          {
                              accountKey: 'account-B',
                              outputs: [
                                  {
                                      accountKey: 'account-B',
                                      amount: 50086,
                                      vsize: 43,
                                      amountCredentials: [],
                                      vsizeCredentials: [],
                                  },
                              ],
                          },
                      ]
                    : []),
            ]),
        );

        const account = {
            accountKey: 'account-A',
            scriptType: 'Taproot',
            changeAddresses: CHANGE_ADDRESSES,
            blockedPaymentIds: [] as string[],
        };
        const otherAccount = {
            accountKey: 'account-B',
            scriptType: 'Taproot',
            changeAddresses: [OTHER_CHANGE_ADDRESS],
            blockedPaymentIds: [] as string[],
        };
        const inputs = [
            createInput('account-A', ANCHOR, { registrationData: { AliceId: 'alice-a0' } }),
            createInput('account-A', SECOND_INPUT, { registrationData: { AliceId: 'alice-a1' } }),
            ...(withOtherAccount
                ? [
                      createInput('account-B', OTHER_ACCOUNT_INPUT, {
                          registrationData: { AliceId: 'alice-b0' },
                      }),
                  ]
                : []),
        ];
        const registeredOutpoints = [...inputs.map(input => input.outpoint), FOREIGN_INPUT];
        const round = createCoinjoinRound(inputs, {
            ...server?.requestOptions,
            statusRound: blameOf ? { BlameOf: blameOf } : undefined,
            round: {
                phase: 2,
                paymentAccountKeys: ['account-A'],
                coinjoinState: createCoinjoinState(registeredOutpoints),
                blameOfOutpoints: blameOf ? registeredOutpoints : undefined,
            },
            roundParameters: { MiningFeeRate: 2000 },
        });
        if (blameOf) {
            // as outputRegistration of the failed round did
            round.prison.detainRegisteredOutput(
                { accountKey: 'account-A', address: CHANGE_ADDRESSES[1]!.address },
                blameOf,
            );
        }

        const messages: string[] = [];
        const log = (message: string) => messages.push(message);
        const logger = { debug: log, info: log, log, warn: log, error: log };

        const response = await outputRegistration(
            round,
            [account, otherAccount] as any[], // partial Accounts
            { ...server?.requestOptions, logger },
        );

        return { response, account, registrations, readyToSign, messages };
    };

    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        server?.removeAllListeners('test-request');
        // An earlier test replaces the implementation.
        (outputDecomposition as jest.Mock).mockImplementation(
            jest.requireActual('./outputDecomposition').outputDecomposition,
        );
    });

    afterAll(() => {
        server?.close();
    });

    it('registers the payment output', async () => {
        const { response, account, registrations, readyToSign } = await register();

        expect(registrations.map(r => r.script).sort()).toEqual(
            [CHANGE_ADDRESSES[0]?.scriptPubKey, PAYMENT.scriptPubKey].sort(),
        );
        expect(response.payments).toEqual([
            {
                accountKey: 'account-A',
                paymentId: PAYMENT.id,
                address: PAYMENT.address,
                scriptPubKey: PAYMENT.scriptPubKey,
                scriptPubKeyHex: PAYMENT.scriptPubKeyHex,
                amount: PAYMENT.amount,
                anchor: PAYMENT.anchor,
            },
        ]);
        // the payment output is not an own address, its amount is checked by checkPayments
        expect(response.addresses).toMatchObject([{ address: CHANGE_ADDRESSES[0]?.address }]);
        expect(response.rejectedPayments).toEqual([]);
        expect(response.prison.inmates.map(i => i.id)).toEqual([CHANGE_ADDRESSES[0]?.address]);
        expect(readyToSign.sort()).toEqual(['alice-a0', 'alice-a1']);
        expect(account.blockedPaymentIds).toEqual([]);
        response.inputs.forEach(input => {
            expect(input.error).toBeUndefined();
        });
    });

    it('registers the payee again with the change output of the failed round in its blame round', async () => {
        const { response, registrations } = await register({ blameOf: FAILED_ROUND_ID });

        response.inputs.forEach(input => {
            expect(input.error).toBeUndefined();
        });
        // the change output of the failed round, not a fresh one
        expect(registrations.map(r => r.script).sort()).toEqual(
            [CHANGE_ADDRESSES[1]?.scriptPubKey, PAYMENT.scriptPubKey].sort(),
        );
        expect(response.payments).toMatchObject([{ paymentId: PAYMENT.id }]);
        expect(response.prison.isDetained(CHANGE_ADDRESSES[1]!.address)).toMatchObject({
            errorCode: 'registeredOutput',
            roundId: response.id,
        });
        // the payee is never detained
        expect(response.prison.isDetained(PAYMENT.address)).toBeUndefined();
    });

    it.each([
        ['AlreadyRegisteredScript', true],
        ['ScriptNotAllowed', true],
        ['NotEnoughFunds', true],
        ['WrongPhase', false],
        ['RoundNotFound', false],
    ] as const)(
        'fails the round when the coordinator rejects the payment output: %s',
        async (errorCode, isBlocked) => {
            const { response, account, registrations, readyToSign, messages } = await register({
                respond: reject =>
                    reject(500, { ErrorCode: errorCode, Description: PAYMENT.scriptPubKey }),
            });

            // no retry with another script
            expect(registrations.filter(r => r.script === PAYMENT.scriptPubKey)).toHaveLength(1);
            expect(readyToSign).toEqual([]);
            response.inputs.forEach(input => {
                expect(input.error?.message).toMatch(/Payment output rejected/);
                expect(input.error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
            });
            expect(response.payments).toEqual([]);
            expect(response.rejectedPayments).toEqual([
                {
                    accountKey: 'account-A',
                    paymentId: PAYMENT.id,
                    errorCode: WabiSabiProtocolErrorCode[errorCode],
                    isBlocked,
                },
            ]);
            // a rejection of the round state does not stop the payment
            expect(account.blockedPaymentIds).toEqual(isBlocked ? [PAYMENT.id] : []);
            expect(response.prison.inmates.map(i => i.id)).not.toContain(PAYMENT.address);
            // the description of the coordinator may contain the script
            expect(messages.length).toBeGreaterThan(0);
            messages.forEach(message => {
                expect(message).not.toContain(PAYMENT.id);
                expect(message).not.toContain(PAYMENT.scriptPubKey);
            });
        },
    );

    it('a rejected payment output fails only the paying account', async () => {
        const { response, account, registrations, readyToSign } = await register({
            respond: reject => reject(500, { ErrorCode: 'AlreadyRegisteredScript' }),
            withOtherAccount: true,
        });

        expect(registrations.map(r => r.script)).toContain(OTHER_CHANGE_ADDRESS.scriptPubKey);
        expect(readyToSign).toEqual(['alice-b0']);
        response.inputs.forEach(input => {
            if (input.accountKey === 'account-A') {
                expect(input.error?.message).toMatch(/Payment output rejected/);
            } else {
                expect(input.error).toBeUndefined();
            }
        });
        expect(account.blockedPaymentIds).toEqual([PAYMENT.id]);
    });

    it('a failed change output fails only the paying account, its registered payment stays', async () => {
        const { response, account, readyToSign } = await register({
            respondToChange: reject => reject(500, { ErrorCode: 'WrongPhase' }),
            withOtherAccount: true,
        });

        expect(readyToSign).toEqual(['alice-b0']);
        response.inputs.forEach(input => {
            if (input.accountKey === 'account-A') {
                expect(input.error?.message).toMatch(/WrongPhase/);
            } else {
                expect(input.error).toBeUndefined();
            }
        });
        // The coordinator has the payment output, but the inputs of account-A do not sign: the
        // signing checks and the payment attempts leave it out (see transactionSigning and
        // CoinjoinRound tests).
        expect(response.payments).toMatchObject([{ accountKey: 'account-A' }]);
        expect(response.rejectedPayments).toEqual([]);
        expect(account.blockedPaymentIds).toEqual([]);
    });

    describe('with output decomposition', () => {
        const createConfirmedInput = (accountKey: string, outpoint: string, value: number) =>
            createInput(accountKey, outpoint, {
                amount: value + 116,
                registrationData: { AliceId: `alice-${outpoint}` },
                confirmedAmountCredentials: [{ Value: value }, { Value: 0 }],
                confirmedVsizeCredentials: [{ Value: 197 }, { Value: 0 }],
            });
        const createAccounts = () => [
            {
                accountKey: 'account-A',
                scriptType: 'Taproot',
                targetAnonymity: 5,
                utxos: [
                    { outpoint: ANCHOR, anonymityLevel: 10 },
                    { outpoint: SECOND_INPUT, anonymityLevel: 10 },
                ],
                changeAddresses: CHANGE_ADDRESSES,
                payment: PAYMENT,
                blockedPaymentIds: [] as string[],
            },
            {
                accountKey: 'account-B',
                scriptType: 'Taproot',
                changeAddresses: [OTHER_CHANGE_ADDRESS],
                blockedPaymentIds: [] as string[],
            },
        ];
        const inputs = () => [
            createConfirmedInput('account-A', ANCHOR, 60000),
            createConfirmedInput('account-A', SECOND_INPUT, 50000),
            createConfirmedInput('account-B', OTHER_ACCOUNT_INPUT, 50000),
        ];

        it('a payment that cannot be made in the round fails only the paying account', async () => {
            const roundId = 'f0'.repeat(32);
            const registrations: string[] = [];
            const readyToSign: string[] = [];
            server?.addListener('test-request', ({ url, data, resolve }) => {
                if (url.endsWith('/get-outputs-amounts')) {
                    resolve({ OutputAmounts: [49800] });
                }
                // registrations of an earlier test may still arrive
                if (url.endsWith('/output-registration') && data.RoundId === roundId) {
                    registrations.push(data.Script);
                }
                if (url.endsWith('/ready-to-sign') && data.RoundId === roundId) {
                    readyToSign.push(data.AliceId);
                }
                resolve();
            });

            const roundInputs = inputs();
            const round = createCoinjoinRound(roundInputs, {
                ...server?.requestOptions,
                statusRound: { Id: roundId },
                round: {
                    phase: 2,
                    paymentAccountKeys: ['account-A'],
                    coinjoinState: {
                        Type: '',
                        Events: [
                            ROUND_CREATION_EVENT,
                            ...roundInputs.map(input =>
                                inputAddedEvent(input.outpoint, input.amount),
                            ),
                            // the payee script is an input of another participant
                            inputAddedEvent(FOREIGN_INPUT, 100000, PAYMENT.scriptPubKey),
                        ],
                    },
                },
                roundParameters: { MiningFeeRate: 2000 },
            });
            const accounts = createAccounts();

            const response = await outputRegistration(
                round,
                accounts as any[], // partial Accounts
                server?.requestOptions,
            );

            expect(registrations).toEqual([OTHER_CHANGE_ADDRESS.scriptPubKey]);
            expect(readyToSign).toEqual([`alice-${OTHER_ACCOUNT_INPUT}`]);
            response.inputs.forEach(input => {
                if (input.accountKey === 'account-A') {
                    expect(input.error?.message).toMatch(/Payment cannot be made in this round/);
                } else {
                    expect(input.error).toBeUndefined();
                }
            });
            // the anchor stays unspent and the payment is not blocked
            expect(response.rejectedPayments).toEqual([]);
            expect(accounts[0]?.blockedPaymentIds).toEqual([]);
        });

        it('refuses a round with fewer inputs than minInputCount before revealing the payee', async () => {
            const requestedUrls: string[] = [];
            server?.addListener('test-request', ({ url, resolve }) => {
                requestedUrls.push(url);
                resolve();
            });

            const roundInputs = inputs();
            const options = { ...server?.requestOptions, minInputCount: 5 };
            const round = createCoinjoinRound(roundInputs, {
                ...options,
                round: {
                    phase: 2,
                    paymentAccountKeys: ['account-A'],
                    coinjoinState: {
                        Type: '',
                        Events: [
                            ROUND_CREATION_EVENT,
                            ...roundInputs.map(input =>
                                inputAddedEvent(input.outpoint, input.amount),
                            ),
                            inputAddedEvent(FOREIGN_INPUT, 100000),
                        ],
                    },
                },
                roundParameters: { MiningFeeRate: 2000 },
            });
            const accounts = createAccounts();

            const response = await outputRegistration(
                round,
                accounts as any[], // partial Accounts
                options,
            );

            expect(outputDecomposition).not.toHaveBeenCalled();
            expect(requestedUrls).toEqual([]); // no /credential-issuance or /output-registration
            // A lie fails the inputs of every account, CoinjoinClient stops all accounts on it.
            expect(response.inputs).toHaveLength(3);
            response.inputs.forEach(input => {
                expect(input.error).toBeInstanceOf(CoordinatorMisbehaviorError);
            });
            expect(response.payments).toEqual([]);
            expect(response.rejectedPayments).toEqual([]);
            expect(accounts[0]?.blockedPaymentIds).toEqual([]);
        });
    });

    it('fails the round without blocking the payment on a network error', async () => {
        const { response, account, readyToSign } = await register({
            respond: reject => reject(500),
        });

        expect(readyToSign).toEqual([]);
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(/Payment output registration failed/);
        });
        expect(response.payments).toEqual([]);
        expect(response.rejectedPayments).toEqual([]);
        expect(account.blockedPaymentIds).toEqual([]);
    });

    it('does not send the payee once a change output of the account failed', async () => {
        const PAYMENT_CREDENTIAL = 100062;
        const roundId = 'f1'.repeat(32);
        const registrations: string[] = [];
        const changeRejected = createDeferred();
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            const isPaymentCredential = data.CredentialsToPresent?.some(
                ({ Value }: { Value: number }) => Value === PAYMENT_CREDENTIAL,
            );
            if (url.endsWith('/get-real-credential-requests') && isPaymentCredential) {
                // the payment output would be registered after the change output failed
                changeRejected.promise.then(() => setTimeout(() => resolve(), 50));

                return;
            }
            // registrations of an earlier test may still arrive
            if (url.endsWith('/output-registration') && data.RoundId === roundId) {
                registrations.push(data.Script);
                if (data.Script !== PAYMENT.scriptPubKey) {
                    reject(500, { ErrorCode: 'WrongPhase' });
                    changeRejected.resolve();

                    return;
                }
            }
            resolve();
        });
        (outputDecomposition as jest.Mock).mockImplementation(() =>
            Promise.resolve([
                {
                    accountKey: 'account-A',
                    outputs: [
                        {
                            accountKey: 'account-A',
                            amount: 20086,
                            vsize: 43,
                            amountCredentials: [{ Value: 20086 }],
                            vsizeCredentials: [],
                        },
                        {
                            accountKey: 'account-A',
                            amount: PAYMENT_CREDENTIAL,
                            vsize: 31,
                            amountCredentials: [{ Value: PAYMENT_CREDENTIAL }],
                            vsizeCredentials: [],
                            payment: PAYMENT,
                        },
                    ],
                },
            ]),
        );
        const account = {
            accountKey: 'account-A',
            scriptType: 'Taproot',
            changeAddresses: CHANGE_ADDRESSES,
            blockedPaymentIds: [] as string[],
        };
        const round = createCoinjoinRound(
            [createInput('account-A', ANCHOR, { registrationData: { AliceId: 'alice-a0' } })],
            {
                ...server?.requestOptions,
                statusRound: { Id: roundId },
                round: {
                    phase: 2,
                    paymentAccountKeys: ['account-A'],
                    coinjoinState: createCoinjoinState([ANCHOR, FOREIGN_INPUT]),
                },
                roundParameters: { MiningFeeRate: 2000 },
            },
        );

        const response = await outputRegistration(
            round,
            [account] as any[], // partial Account
            server?.requestOptions,
        );
        // the credential requests of the payment are answered by now
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(registrations).toEqual([CHANGE_ADDRESSES[0]?.scriptPubKey]);
        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(/WrongPhase/);
        });
        expect(response.payments).toEqual([]);
        expect(response.rejectedPayments).toEqual([]);
        expect(account.blockedPaymentIds).toEqual([]);
    });
});
