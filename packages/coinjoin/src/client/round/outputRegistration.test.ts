import { outputDecomposition } from './outputDecomposition';
import { outputRegistration } from './outputRegistration';
import { createServer } from '../../../mocks/server';
import { createInput } from '../../__fixtures__/input.fixture';
import {
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../../__fixtures__/round.fixture';
import { verifyOwnershipProof } from '../../utils/ownershipProof';

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
                        {
                            address:
                                'tb1p4jf9crt5gh57h2spvfht4zwjtnre700uvs4u63l2g2huchrk2dms4lm6kv',
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
});
