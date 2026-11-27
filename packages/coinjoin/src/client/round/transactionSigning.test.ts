import { getWeakRandomNumberInRange } from '@trezor/utils';
import { networks } from '@trezor/utxo-lib';

import { transactionSigning } from './transactionSigning';
import { createServer } from '../../../mocks/server';
import { createInput } from '../../__fixtures__/input.fixture';
import { createCoinjoinRound, createInputAddedEvent } from '../../__fixtures__/round.fixture';
import { SessionPhase } from '../../enums';
import * as coordinator from '../coordinator';

// The inputs of other participants have no valid ownership proofs, see verifyRoundInputs.test.ts.
jest.mock('../../utils/ownershipProof', () => ({
    verifyOwnershipProof: () => 'valid',
}));

jest.mock('../coordinator', () => ({
    ...jest.requireActual('../coordinator'),
    transactionSignature: jest.fn(jest.requireActual('../coordinator').transactionSignature),
}));

// mock random delay function
jest.mock('@trezor/utils', () => {
    const originalModule = jest.requireActual('@trezor/utils');

    return {
        __esModule: true,
        ...originalModule,
        getWeakRandomNumberInRange: jest.fn(() => 0),
    };
});

describe('transactionSigning', () => {
    let server: Awaited<ReturnType<typeof createServer>>;

    // Every own input which reaches signing got its confirmed credentials from the coordinator.
    const CONFIRMED = { confirmedAmountCredentials: [{ value: 1 }] };

    // Outpoints (hash:index) of the own input 1b5b1fee…00000000 and the external input
    // 0000…01000000, sorted, as outputRegistration pins them.
    const VERIFIED_INPUTS = [
        `${'0'.repeat(64)}:1`,
        '9fc41d8abd339243105397675ab237a344a71190635fdb5342eddfa4ee1f5b1b:0',
    ];

    const COINJOIN_REQUEST = {
        fee_rate: 300000,
        min_registrable_amount: 5000,
        no_fee_threshold: 1000000,
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

    it('getTransactionData: coinjoin request and locally updated liquidity clue', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        '1b5b1feea4dfed4253db5f639011a744a337b25a67975310439233bd8a1dc49f00000000',
                        { amount: 12300000 },
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                        verifiedInputs: VERIFIED_INPUTS,
                        addresses: [
                            {
                                accountKey: 'account-A',
                                path: "m/10025'/0'/0'/0'/1/0",
                                address:
                                    'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                                scriptPubKey:
                                    '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                                amount: 12300000 - 5000000 - 2000000 - 11000,
                            },
                        ],
                        coinjoinState: {
                            Type: '',
                            Events: [
                                {
                                    Type: 'InputAdded',
                                    Coin: {
                                        Outpoint:
                                            '1B5B1FEEA4DFED4253DB5F639011A744A337B25A67975310439233BD8A1DC49F00000000',
                                        TxOut: {
                                            ScriptPubKey:
                                                '1 fc485427c6b286466faca747ad0faf6aaf6f7ef72ef7c81a2064df3796dbea2e',
                                            Value: 12300000,
                                        },
                                    },
                                    OwnershipProof: 'not-relevant',
                                },
                                {
                                    Type: 'InputAdded', // external input
                                    Coin: {
                                        Outpoint:
                                            '000000000000000000000000000000000000000000000000000000000000000001000000',
                                        TxOut: {
                                            ScriptPubKey:
                                                '1 b899b1962f24757bf8f641d125a88944d1541272cc86da7815ff7899e368b2d4',
                                            Value: 12300000,
                                        },
                                    },
                                    OwnershipProof: 'not-relevant',
                                },
                                {
                                    Type: 'OutputAdded', // external output
                                    Output: {
                                        ScriptPubKey:
                                            '1 b899b1962f24757bf8f641d125a88944d1541272cc86da7815ff7899e368b2d4',
                                        Value: 2000000,
                                    },
                                },
                                {
                                    Type: 'OutputAdded',
                                    Output: {
                                        ScriptPubKey:
                                            '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                                        Value: 12300000 - 5000000 - 2000000 - 11000,
                                    },
                                },
                            ],
                        },
                    },
                },
            ),
            [
                {
                    accountKey: 'account-A',
                    changeAddresses: [
                        {
                            address:
                                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                        },
                    ],
                    updateRawLiquidityClue: () => {},
                } as any, // simplified Account
            ],
            { ...server?.requestOptions, network: networks.bitcoin },
        );

        expect(response).toMatchObject({
            transactionData: {
                coinjoinRequest: COINJOIN_REQUEST,
            },
            liquidityClues: [{ accountKey: 'account-A', rawLiquidityClue: 2000000 }],
        });
    });

    it('getTransactionData: outputs of all allowed types sorted by script bytes', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        '1b5b1feea4dfed4253db5f639011a744a337b25a67975310439233bd8a1dc49f00000000',
                        { amount: 12300000 },
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                        verifiedInputs: VERIFIED_INPUTS,
                        addresses: [
                            {
                                accountKey: 'account-A',
                                path: "m/10025'/0'/0'/0'/1/0",
                                address:
                                    'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                                scriptPubKey:
                                    '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                                amount: 1000000,
                            },
                        ],
                        coinjoinState: {
                            Type: '',
                            Events: [
                                {
                                    Type: 'InputAdded',
                                    Coin: {
                                        Outpoint:
                                            '1B5B1FEEA4DFED4253DB5F639011A744A337B25A67975310439233BD8A1DC49F00000000',
                                        TxOut: {
                                            ScriptPubKey:
                                                '1 fc485427c6b286466faca747ad0faf6aaf6f7ef72ef7c81a2064df3796dbea2e',
                                            Value: 12300000,
                                        },
                                    },
                                    OwnershipProof: 'not-relevant',
                                },
                                {
                                    Type: 'InputAdded', // external input
                                    Coin: {
                                        Outpoint:
                                            '000000000000000000000000000000000000000000000000000000000000000001000000',
                                        TxOut: {
                                            ScriptPubKey:
                                                '1 b899b1962f24757bf8f641d125a88944d1541272cc86da7815ff7899e368b2d4',
                                            Value: 12300000,
                                        },
                                    },
                                    OwnershipProof: 'not-relevant',
                                },
                                // all outputs have equal value, order is given by the script bytes
                                {
                                    Type: 'OutputAdded', // external P2SH output
                                    Output: {
                                        ScriptPubKey:
                                            'OP_HASH160 b472a266d0bd89c13706a4132ccfb16f7c3b9fcb OP_EQUAL',
                                        Value: 1000000,
                                    },
                                },
                                {
                                    Type: 'OutputAdded', // internal Taproot output
                                    Output: {
                                        ScriptPubKey:
                                            '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                                        Value: 1000000,
                                    },
                                },
                                {
                                    Type: 'OutputAdded', // external P2WSH output
                                    Output: {
                                        ScriptPubKey:
                                            '0 a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c',
                                        Value: 1000000,
                                    },
                                },
                                {
                                    Type: 'OutputAdded', // external P2PKH output
                                    Output: {
                                        ScriptPubKey:
                                            'OP_DUP OP_HASH160 751e76e8199196d454941c45d1b3a323f1433bd6 OP_EQUALVERIFY OP_CHECKSIG',
                                        Value: 1000000,
                                    },
                                },
                                {
                                    Type: 'OutputAdded', // external P2WPKH output
                                    Output: {
                                        ScriptPubKey: '0 b586ae30647c6ab84aa1a285d505155711509914',
                                        Value: 1000000,
                                    },
                                },
                            ],
                        },
                    },
                },
            ),
            [], // Account is not relevant for this test
            { ...server?.requestOptions, network: networks.bitcoin },
        );

        expect(response.transactionData?.outputs).toEqual([
            {
                path: undefined,
                address: 'bc1qkkr2uvry034tsj4p52za2pg42ug4pxg5qfxyfa',
                amount: 1000000,
                scriptPubKey: '0014b586ae30647c6ab84aa1a285d505155711509914',
            },
            {
                path: undefined,
                address: 'bc1q5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxquwd2ql',
                amount: 1000000,
                scriptPubKey:
                    '0020a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c',
            },
            {
                path: "m/10025'/0'/0'/0'/1/0",
                address: 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                amount: 1000000,
                scriptPubKey:
                    '5120b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
            },
            {
                path: undefined,
                address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH',
                amount: 1000000,
                scriptPubKey: '76a914751e76e8199196d454941c45d1b3a323f1433bd688ac',
            },
            {
                path: undefined,
                address: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
                amount: 1000000,
                scriptPubKey: 'a914b472a266d0bd89c13706a4132ccfb16f7c3b9fcb87',
            },
        ]);
    });

    it('getTransactionData: missing registered outputs', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        '1b5b1feea4dfed4253db5f639011a744a337b25a67975310439233bd8a1dc49f00000000',
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                    },
                },
            ),
            [],
            server?.requestOptions,
        );

        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(/No registered outputs/);
        });
    });

    it('getTransactionData: no registered outputs in the round', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        '1b5b1feea4dfed4253db5f639011a744a337b25a67975310439233bd8a1dc49f00000000',
                        CONFIRMED,
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                        addresses: [
                            {
                                accountKey: 'account-A',
                                path: "m/10025'/0'/0'/0'/1/0",
                                address:
                                    'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                                scriptPubKey:
                                    '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                                amount: 1000000,
                            },
                        ],
                        coinjoinState: {
                            Type: '',
                            Events: [
                                createInputAddedEvent(
                                    '1B5B1FEEA4DFED4253DB5F639011A744A337B25A67975310439233BD8A1DC49F00000000',
                                ),
                                createInputAddedEvent(
                                    '000000000000000000000000000000000000000000000000000000000000000001000000',
                                ),
                            ],
                        },
                    },
                },
            ),
            [],
            server?.requestOptions,
        );

        response.inputs.forEach(input => {
            expect(input.error).toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
            expect(input.error?.message).toMatch(/1 own outputs missing or with a lower amount/);
        });
    });

    it('getTransactionData: no registered inputs in the round', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        '1b5b1feea4dfed4253db5f639011a744a337b25a67975310439233bd8a1dc49f00000000',
                        CONFIRMED,
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                        addresses: [
                            {
                                accountKey: 'account-A',
                                path: "m/10025'/0'/0'/0'/1/0",
                                address:
                                    'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                                scriptPubKey:
                                    '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                                amount: 1000000,
                            },
                        ],
                    },
                },
            ),
            [],
            server?.requestOptions,
        );

        response.inputs.forEach(input => {
            expect(input.error).toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
            expect(input.error?.message).toMatch(
                /1 own inputs missing or registered with a different amount or script/,
            );
        });
    });

    describe('getTransactionData: registered inputs and outputs', () => {
        const OWN_OUTPOINT =
            '1b5b1feea4dfed4253db5f639011a744a337b25a67975310439233bd8a1dc49f00000000';
        const OTHER_OUTPOINT =
            '000000000000000000000000000000000000000000000000000000000000000001000000';
        const ANOTHER_OUTPOINT =
            '000000000000000000000000000000000000000000000000000000000000000002000000';
        const OWN_OUTPUT = {
            accountKey: 'account-A',
            path: "m/10025'/0'/0'/0'/1/0",
            address: 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
            scriptPubKey: '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
            amount: 12300000 - 5000000 - 11000,
        };

        // The coordinator pays the own output exactly the expected amount unless Output is given.
        const createSigningRound = (
            ownInputs: ReturnType<typeof createInput>[],
            registeredOutpoints: string[],
            setSessionPhase = jest.fn(),
            Output = { ScriptPubKey: OWN_OUTPUT.scriptPubKey, Value: OWN_OUTPUT.amount },
        ) =>
            createCoinjoinRound(ownInputs, {
                ...server?.requestOptions,
                setSessionPhase,
                round: {
                    phase: 3,
                    verifiedInputs: VERIFIED_INPUTS,
                    addresses: [OWN_OUTPUT],
                    coinjoinState: {
                        Type: '',
                        Events: [
                            ...registeredOutpoints.map(createInputAddedEvent),
                            { Type: 'OutputAdded', Output },
                        ],
                    },
                },
            });

        const ACCOUNTS = [
            {
                accountKey: 'account-A',
                changeAddresses: [
                    {
                        address: 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                    },
                ],
                updateRawLiquidityClue: () => {},
            } as any, // simplified Account
        ];

        it.each([
            [
                'fewer inputs than minInputCount',
                [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT],
                3,
                /Round has 2 registered inputs but minimum required is 3/,
            ],
            [
                'a duplicate input',
                [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT, OWN_OUTPOINT],
                2,
                /1 duplicate or malformed registered inputs/,
            ],
            [
                'an input added after output registration',
                [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT, ANOTHER_OUTPOINT],
                2,
                /Registered inputs changed after output registration/,
            ],
            [
                'an input replaced after output registration',
                [OWN_OUTPOINT.toUpperCase(), ANOTHER_OUTPOINT],
                2,
                /Registered inputs changed after output registration/,
            ],
        ])(
            'refuses to sign a transaction with %s',
            async (_, registeredOutpoints, minInputCount, message) => {
                const requestedUrls: string[] = [];
                server?.addListener('test-request', ({ url, resolve }) => {
                    requestedUrls.push(url);
                    resolve();
                });

                const setSessionPhase = jest.fn();
                const updateRawLiquidityClue = jest.fn();
                const round = createSigningRound(
                    [createInput('account-A', OWN_OUTPOINT, CONFIRMED)],
                    registeredOutpoints,
                    setSessionPhase,
                );
                const response = await transactionSigning(
                    round,
                    [{ ...ACCOUNTS[0], updateRawLiquidityClue }],
                    { ...server?.requestOptions, network: networks.bitcoin, minInputCount },
                );

                expect(response.transactionData).toBeUndefined();
                expect(requestedUrls).toEqual([]); // nothing sent to the coordinator
                // The outputs of a refused transaction do not reach the liquidity clue.
                expect(updateRawLiquidityClue).not.toHaveBeenCalled();
                expect(round.getRequest()).toBeUndefined(); // nothing to sign on the device
                response.inputs.forEach(input => {
                    expect(input.error).toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
                    expect(input.error?.message).toMatch(message);
                });
                expect(setSessionPhase).toHaveBeenLastCalledWith({
                    phase: SessionPhase.SignatureFailed,
                    accountKeys: ['account-A'],
                });
            },
        );

        it.each([
            [
                'an own input of a different amount',
                { ...CONFIRMED, amount: 2 },
                { ScriptPubKey: OWN_OUTPUT.scriptPubKey, Value: OWN_OUTPUT.amount },
                /1 own inputs missing or registered with a different amount or script/,
            ],
            [
                'a missing own output',
                CONFIRMED,
                {
                    ScriptPubKey:
                        '1 b899b1962f24757bf8f641d125a88944d1541272cc86da7815ff7899e368b2d4',
                    Value: OWN_OUTPUT.amount,
                },
                /1 own outputs missing or with a lower amount/,
            ],
            [
                'an own output of a lower amount',
                CONFIRMED,
                { ScriptPubKey: OWN_OUTPUT.scriptPubKey, Value: OWN_OUTPUT.amount - 1 },
                /1 own outputs missing or with a lower amount/,
            ],
        ])('refuses to sign a transaction with %s', async (_, inputOptions, Output, message) => {
            const round = createSigningRound(
                [createInput('account-A', OWN_OUTPOINT, inputOptions)],
                [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT],
                jest.fn(),
                Output,
            );
            const response = await transactionSigning(round, ACCOUNTS, {
                ...server?.requestOptions,
                network: networks.bitcoin,
            });

            expect(response.transactionData).toBeUndefined();
            expect(round.getRequest()).toBeUndefined(); // nothing to sign on the device
            response.inputs.forEach(input => {
                expect(input.error).toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
                expect(input.error?.message).toMatch(message);
            });
        });

        it('prepares a transaction paying the own output exactly the expected amount', async () => {
            const response = await transactionSigning(
                createSigningRound(
                    [createInput('account-A', OWN_OUTPOINT, CONFIRMED)],
                    [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT],
                ),
                ACCOUNTS,
                { ...server?.requestOptions, network: networks.bitcoin },
            );

            response.inputs.forEach(input => {
                expect(input.error).toBeUndefined();
            });
            // The own input carries the data of this client: createInput has a regtest address,
            // the script of the coordinator would give a mainnet one.
            expect(response.transactionData?.inputs).toContainEqual(
                expect.objectContaining({
                    path: 'm/10025',
                    outpoint: OWN_OUTPOINT,
                    amount: 1_000_000,
                    address: 'bcrt1pl3y9gf7xk2ryvmav5ar66ra0d2hk7lhh9mmusx3qvn0n09kmaghq6gq9fy',
                    scriptPubKey:
                        '5120fc485427c6b286466faca747ad0faf6aaf6f7ef72ef7c81a2064df3796dbea2e',
                }),
            );
            expect(response.transactionData?.outputs).toEqual([
                expect.objectContaining({ path: OWN_OUTPUT.path, amount: OWN_OUTPUT.amount }),
            ]);
        });

        it('refuses to sign inputs which were not verified before output registration', async () => {
            const round = createSigningRound(
                [createInput('account-A', OWN_OUTPOINT, CONFIRMED)],
                [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT],
            );
            round.verifiedInputs = undefined;
            const response = await transactionSigning(round, ACCOUNTS, {
                ...server?.requestOptions,
                network: networks.bitcoin,
            });

            expect(response.transactionData).toBeUndefined();
            expect(round.getRequest()).toBeUndefined(); // nothing to sign on the device
            response.inputs.forEach(input => {
                expect(input.error).not.toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
                expect(input.error?.message).toMatch(
                    /Inputs of the round not verified before output registration/,
                );
            });
        });

        it('refuses to sign a transaction without inputs of other participants', async () => {
            const response = await transactionSigning(
                createSigningRound(
                    [
                        createInput('account-A', OWN_OUTPOINT, CONFIRMED),
                        createInput('account-B', OTHER_OUTPOINT, CONFIRMED),
                    ],
                    [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT.toUpperCase()],
                ),
                ACCOUNTS,
                { ...server?.requestOptions, network: networks.bitcoin },
            );

            expect(response.transactionData).toBeUndefined();
            response.inputs.forEach(input => {
                expect(input.error).not.toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
                expect(input.error?.message).toMatch(/No inputs of other participants/);
            });
        });

        describe('blame round', () => {
            // The pinned inputs (VERIFIED_INPUTS) hold the input of the other participant, so only
            // the check of the blame round can refuse it.
            const createBlameSigningRound = (blameOfOutpoints: string[]) => {
                const round = createSigningRound(
                    [createInput('account-A', OWN_OUTPOINT, CONFIRMED)],
                    [OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT],
                );
                round.blameOf = '1'.repeat(64);
                round.blameOfOutpoints = blameOfOutpoints;

                return round;
            };

            it('prepares a transaction with inputs of the failed round', async () => {
                const response = await transactionSigning(
                    createBlameSigningRound([OWN_OUTPOINT, OTHER_OUTPOINT, ANOTHER_OUTPOINT]),
                    ACCOUNTS,
                    { ...server?.requestOptions, network: networks.bitcoin },
                );

                response.inputs.forEach(input => {
                    expect(input.error).toBeUndefined();
                });
                expect(response.transactionData?.inputs).toHaveLength(2);
            });

            it('refuses to sign an input which was not in the failed round', async () => {
                const round = createBlameSigningRound([OWN_OUTPOINT, ANOTHER_OUTPOINT]);
                const response = await transactionSigning(round, ACCOUNTS, {
                    ...server?.requestOptions,
                    network: networks.bitcoin,
                });

                expect(response.transactionData).toBeUndefined();
                expect(round.getRequest()).toBeUndefined(); // nothing to sign on the device
                response.inputs.forEach(input => {
                    expect(input.error).toBeInstanceOf(coordinator.CoordinatorMisbehaviorError);
                    expect(input.error?.message).toMatch(
                        /1 inputs of the blame round were not in the failed round/,
                    );
                });
            });
        });
    });

    it('signed successfully with one WitnessAlreadyProvided error', async () => {
        const spy = jest.fn();
        jest.spyOn(console, 'error').mockImplementation(() => {}); // do not show error in console

        let alreadyProvided = false;
        server?.addListener('test-request', ({ url, resolve, data, reject }) => {
            if (url.endsWith('/transaction-signature')) {
                spy();
                if (data.InputIndex === 1) {
                    if (!alreadyProvided) {
                        alreadyProvided = true;
                        reject(403); // Simulate cloudflare error. Enforce to repeat the request
                    } else {
                        reject(500, { ErrorCode: 'WitnessAlreadyProvided' });
                    }
                }
            }
            resolve();
        });

        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        'a00000000000000000000000000000000000000000000000000000000000000001000000',
                        {
                            witness: 'aa',
                            witnessIndex: 0,
                        },
                    ),
                    createInput(
                        'account-A',
                        'b00000000000000000000000000000000000000000000000000000000000000002000000',
                        {
                            witness: 'bb',
                            witnessIndex: 1,
                        },
                    ),
                    createInput(
                        'account-A',
                        'c00000000000000000000000000000000000000000000000000000000000000003000000',
                        {
                            witness: 'cc',
                            witnessIndex: 2,
                        },
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                        phaseDeadline: Date.now() + 5000, // use shortened delays...
                    },
                },
            ),
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        expect(spy).toHaveBeenCalledTimes(4); // called 4 times because witnessIndex 1 was repeated

        response.inputs.forEach(input => {
            expect(input.error).toBe(undefined);
        });

        expect(response.isSignedSuccessfully()).toBe(true);
    });

    it('errors to send signatures', async () => {
        server?.addListener('test-request', ({ url, resolve, reject }) => {
            if (url.endsWith('/transaction-signature')) {
                reject(500, { ErrorCode: 'WrongPhase' });
            }
            resolve();
        });

        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        'a00000000000000000000000000000000000000000000000000000000000000001000000',
                        {
                            witness: 'aa',
                            witnessIndex: 0,
                        },
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                    },
                },
            ),
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        response.inputs.forEach(input => {
            expect(input.error?.message).toMatch(/WrongPhase/);
        });

        expect(response.isSignedSuccessfully()).toBe(false);
    });

    it('try to sign input with error', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        'a00000000000000000000000000000000000000000000000000000000000000001000000',
                        {
                            error: new Error('Error from previous phase'),
                        },
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                    },
                },
            ),
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        response.inputs.forEach(input => {
            expect(input.error).not.toBe(undefined);
        });

        expect(response.isSignedSuccessfully()).toBe(false);
    });

    it('try to sign input with already requested signature', async () => {
        const response = await transactionSigning(
            createCoinjoinRound(
                [
                    createInput(
                        'account-A',
                        'a00000000000000000000000000000000000000000000000000000000000000001000000',
                        {
                            requested: { type: 'signature' },
                        },
                    ),
                ],
                {
                    ...server?.requestOptions,
                    round: {
                        phase: 3,
                    },
                },
            ),
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        response.inputs.forEach(input => {
            expect(input.error).toBe(undefined);
        });

        expect(response.isSignedSuccessfully()).toBe(false);
    });
});

describe('transactionSigning signature delay', () => {
    let server: Awaited<ReturnType<typeof createServer>>;
    let round: ReturnType<typeof createCoinjoinRound>;

    beforeAll(async () => {
        jest.spyOn(Date, 'now').mockImplementation(() => 0);
        server = await createServer();
        round = createCoinjoinRound([], {
            ...server?.requestOptions,
            round: {
                phase: 3,
                phaseDeadline: 60000 * 4, // 4 minutes
            },
        });
    });

    beforeEach(() => {
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        server?.close();
        jest.clearAllMocks();
    });

    it('DelayTransactionSigning enabled, singing resolved after 33 sec.', async () => {
        round.inputs = [
            createInput(
                'account-A',
                'a00000000000000000000000000000000000000000000000000000000000000001000000',
                {
                    witness: 'aa',
                    witnessIndex: 0,
                    resolved: [
                        {
                            type: 'signature',
                            timestamp: 33000,
                        },
                    ],
                },
            ),
        ];
        const response = await transactionSigning(
            round,
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        // signature is sent in range 17-67 sec. (resolve time is less than 50 sec TX_SIGNING_DELAY)
        expect(getWeakRandomNumberInRange).toHaveBeenLastCalledWith(17000, 67000);
        expect(response.isSignedSuccessfully()).toBe(true);
    });

    it('DelayTransactionSigning enabled, singing resolved after 53.79 sec.', async () => {
        round.inputs = [
            createInput(
                'account-A',
                'a00000000000000000000000000000000000000000000000000000000000000001000000',
                {
                    witness: 'aa',
                    witnessIndex: 0,
                    resolved: [
                        {
                            type: 'signature',
                            timestamp: 53790,
                        },
                    ],
                },
            ),
        ];

        const response = await transactionSigning(
            round,
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        // signature is sent in range 0-46.21 sec. (resolve time is greater than 50 sec of TX_SIGNING_DELAY)
        expect(getWeakRandomNumberInRange).toHaveBeenLastCalledWith(0, 46210);
        expect(response.isSignedSuccessfully()).toBe(true);
    });

    it('DelayTransactionSigning disabled', async () => {
        round.inputs = [
            createInput(
                'account-A',
                'a00000000000000000000000000000000000000000000000000000000000000001000000',
                {
                    witness: 'aa',
                    witnessIndex: 0,
                    resolved: [
                        {
                            type: 'signature',
                            timestamp: 51000,
                        },
                    ],
                },
            ),
        ];
        round.roundParameters.DelayTransactionSigning = false;

        const response = await transactionSigning(
            round,
            [], // Account is not relevant for this test
            server?.requestOptions,
        );

        // signature is sent immediately
        expect(getWeakRandomNumberInRange).toHaveBeenLastCalledWith(0, 0);
        expect(response.isSignedSuccessfully()).toBe(true);
    });
});

describe('transactionSigning send window (phaseStartLowerBound)', () => {
    let server: Awaited<ReturnType<typeof createServer>>;

    beforeAll(async () => {
        server = await createServer();
    });

    beforeEach(() => {
        server?.removeAllListeners('test-request');
        jest.mocked(getWeakRandomNumberInRange).mockClear();
        jest.mocked(coordinator.transactionSignature).mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.mocked(coordinator.transactionSignature).mockImplementation(
            jest.requireActual('../coordinator').transactionSignature,
        );
        jest.restoreAllMocks();
    });

    afterAll(() => {
        server?.close();
    });

    const signingRound = (roundOverrides: Partial<ReturnType<typeof createCoinjoinRound>>) =>
        createCoinjoinRound(
            [
                createInput(
                    'account-A',
                    'a00000000000000000000000000000000000000000000000000000000000000001000000',
                    {
                        witness: 'aa',
                        witnessIndex: 0,
                        resolved: [{ type: 'signature', timestamp: 5000 }],
                    },
                ),
            ],
            {
                ...server?.requestOptions,
                round: { phase: 3, ...roundOverrides },
            },
        );

    it('bounds the send spread by phaseStartLowerBound, not the poll-lagged phaseDeadline', async () => {
        // now = 100s; signing was first detected here, but the previous committed poll was at 70s,
        // so the real phase start is >= 70s. phaseDeadline (240s budget) is anchored to the later
        // detection time and is optimistic; the send must be bounded by phaseStartLowerBound +
        // TransactionSigningTimeout (70s + 60s = 130s) instead.
        jest.spyOn(Date, 'now').mockReturnValue(100000);
        const round = signingRound({
            phaseStartLowerBound: 70000,
            phaseDeadline: 100000 + 60000 * 4,
        });
        round.roundParameters.DelayTransactionSigning = false;

        jest.mocked(getWeakRandomNumberInRange).mockReturnValueOnce(900);
        const response = await transactionSigning(round, [], server?.requestOptions);

        // budget = sendDeadline(130s) - now(100s) = 30s; reserve 10s -> deadlineOffset 20s
        expect(getWeakRandomNumberInRange).toHaveBeenLastCalledWith(0, 20000);
        expect(coordinator.transactionSignature).toHaveBeenCalledWith(
            round.id,
            0,
            'aa',
            expect.objectContaining({ delay: 900, deadline: round.phaseDeadline }),
        );
        expect(response.isSignedSuccessfully()).toBe(true);
    });

    it.each([-1000, 0, 500, 1000, 5000, 10000])(
        'sends immediately with %i ms left before the conservative deadline',
        async remainingTime => {
            jest.spyOn(Date, 'now').mockReturnValue(100000);
            const round = signingRound({
                phaseStartLowerBound: 40000 + remainingTime,
                phaseDeadline: 100000 + 60000 * 4,
            });
            round.roundParameters.DelayTransactionSigning = true;

            const response = await transactionSigning(round, [], server?.requestOptions);

            expect(coordinator.transactionSignature).toHaveBeenCalledWith(
                round.id,
                0,
                'aa',
                expect.objectContaining({ delay: 0, deadline: round.phaseDeadline }),
            );
            expect(getWeakRandomNumberInRange).toHaveBeenCalledWith(0, 0);
            expect(response.isSignedSuccessfully()).toBe(true);
        },
    );

    it.each([
        [10500, 500],
        [11000, 1000],
    ])(
        'retains randomization with %i ms left before the conservative deadline',
        async (remainingTime, maximumDelay) => {
            jest.spyOn(Date, 'now').mockReturnValue(100000);
            const round = signingRound({
                phaseStartLowerBound: 40000 + remainingTime,
                phaseDeadline: 100000 + 60000 * 4,
            });
            round.roundParameters.DelayTransactionSigning = true;

            const delay = maximumDelay / 2;
            jest.mocked(getWeakRandomNumberInRange).mockReturnValueOnce(delay);
            const response = await transactionSigning(round, [], server?.requestOptions);

            expect(getWeakRandomNumberInRange).toHaveBeenLastCalledWith(0, maximumDelay);
            expect(coordinator.transactionSignature).toHaveBeenCalledWith(
                round.id,
                0,
                'aa',
                expect.objectContaining({ delay, deadline: round.phaseDeadline }),
            );
            expect(response.isSignedSuccessfully()).toBe(true);
        },
    );
});
