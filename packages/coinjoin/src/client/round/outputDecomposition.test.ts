import {
    ACCOUNT,
    outputDecomposition as fixtures,
} from './__fixtures__/outputDecomposition.fixture';
import { outputDecomposition } from './outputDecomposition';
import { createServer } from '../../../mocks/server';
import { createInput } from '../../__fixtures__/input.fixture';
import {
    INPUT_ADDED_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../../__fixtures__/round.fixture';
import { redacted } from '../../utils/redacted';
import { CoinjoinPrison } from '../CoinjoinPrison';

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
});
