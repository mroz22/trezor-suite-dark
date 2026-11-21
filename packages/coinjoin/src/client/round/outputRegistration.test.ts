import { outputDecomposition } from './outputDecomposition';
import { outputRegistration } from './outputRegistration';
import { createServer } from '../../../mocks/server';
import { createInput } from '../../__fixtures__/input.fixture';
import {
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../../__fixtures__/round.fixture';

// mock random delay function
jest.mock('@trezor/utils', () => {
    const originalModule = jest.requireActual('@trezor/utils');

    return {
        __esModule: true,
        ...originalModule,
        getWeakRandomNumberInRange: () => 0,
    };
});

jest.mock('./outputDecomposition', () => ({
    ...jest.requireActual('./outputDecomposition'),
    outputDecomposition: jest.fn(jest.requireActual('./outputDecomposition').outputDecomposition),
}));

const OWN_OUTPOINT = 'a00000000000000000000000000000000000000000000000000000000000000001000000';
const OTHER_OUTPOINT = 'B00000000000000000000000000000000000000000000000000000000000000002000000';

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
});
