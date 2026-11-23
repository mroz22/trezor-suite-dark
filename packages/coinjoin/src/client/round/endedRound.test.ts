import { loggerMock } from '@trezor/logger/mocks';
import { networks } from '@trezor/utxo-lib';

import { ended } from './endedRound';
import { createInput } from '../../__fixtures__/input.fixture';
import { createCoinjoinRound, createTransactionData } from '../../__fixtures__/round.fixture';
import { EndRoundState, RoundPhase, WabiSabiProtocolErrorCode } from '../../enums';

describe('ended', () => {
    const logger = loggerMock;

    const options: any = {
        coordinatorName: 'CoinJoinCoordinatorIdentifier',
        logger,
        network: networks.bitcoin,
    };

    // Transaction to sign with the own input and an input of another participant.
    const TRANSACTION_DATA = createTransactionData([
        '0'.repeat(72),
        'A00000000000000000000000000000000000000000000000000000000000000001000000',
    ]);

    beforeAll(async () => {});

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterAll(() => {});

    it('NotAllAlicesSign by this instance (missing confirmed inputs)', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.NotAllAlicesSign,
                },
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringMatching(/Missing confirmed inputs/),
        );
        expect(round.prison.inmates.length).toEqual(1);
    });

    it('NotAllAlicesSign by this instance (missing outputs)', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                    confirmationData: {},
                    confirmedAmountCredentials: {},
                    confirmedVsizeCredentials: {},
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.NotAllAlicesSign,
                },
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Missing outputs/));
        expect(round.prison.inmates.length).toEqual(1);
    });

    it('NotAllAlicesSign by this instance (missing witnesses)', () => {
        // create CoinjoinRound in phase 1 (ConnectionConfirmation)
        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                    confirmationData: {},
                    confirmedAmountCredentials: {},
                    confirmedVsizeCredentials: {},
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.NotAllAlicesSign,
                    addresses: [
                        {
                            address:
                                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                            path: '',
                            scriptPubKey: '',
                        },
                    ],
                },
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Missing signed inputs/));
        expect(round.prison.inmates.length).toEqual(1); // input is detained
    });

    it('NotAllAlicesSign by this instance (other)', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                    confirmationData: {},
                    confirmedAmountCredentials: {},
                    confirmedVsizeCredentials: {},
                    witness: '0'.repeat(97 * 2 + 4),
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.NotAllAlicesSign,
                    addresses: [
                        {
                            address:
                                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                            path: '',
                            scriptPubKey: '',
                        },
                    ],
                    transactionData: TRANSACTION_DATA,
                },
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringMatching(/This should never happen/),
        );
        expect(round.prison.inmates.length).toEqual(1); // input is detained
        expect(round.prison.getBlameOfOutpoints(round.id)).toBeUndefined(); // no blame round
    });

    it('AbortedNotEnoughAlicesSigned by other instance (no blame round)', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', '0'.repeat(72), {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                    confirmationData: {},
                    confirmedAmountCredentials: {},
                    confirmedVsizeCredentials: {},
                    witness: '0'.repeat(97 * 2 + 4),
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    signed: true,
                    endRoundState: EndRoundState.AbortedNotEnoughAlicesSigned,
                    addresses: [
                        {
                            address:
                                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                            path: '',
                            scriptPubKey: '',
                        },
                    ],
                    transactionData: TRANSACTION_DATA,
                },
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(0);
        expect(round.prison.inmates.length).toEqual(0);
        expect(round.prison.getBlameOfOutpoints(round.id)).toBeUndefined();
    });

    it('NotAllAlicesSign by other instance (wait for blame round)', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', '0'.repeat(72), {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                    confirmationData: {},
                    confirmedAmountCredentials: {},
                    confirmedVsizeCredentials: {},
                    witness: '0'.repeat(97 * 2 + 4),
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    signed: true,
                    endRoundState: EndRoundState.NotAllAlicesSign,
                    addresses: [
                        {
                            address:
                                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                            path: '',
                            scriptPubKey: '',
                        },
                    ],
                    transactionData: TRANSACTION_DATA,
                },
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(0);
        expect(round.prison.inmates.length).toEqual(1); // input is detained
        // The blame round may contain only inputs of the signed transaction.
        expect(round.prison.getBlameOfOutpoints(round.id)).toEqual([
            '0'.repeat(72),
            'A00000000000000000000000000000000000000000000000000000000000000001000000',
        ]);
    });

    it.each([
        [EndRoundState.NotAllAlicesSign, false],
        [EndRoundState.NotAllAlicesSign, true],
        [EndRoundState.AbortedNotEnoughAlicesSigned, false],
        [EndRoundState.AbortedNotEnoughAlicesSigned, true],
        [EndRoundState.AbortedWithError, true],
        [EndRoundState.TransactionBroadcastFailed, false],
    ])('keeps registered addresses detained on %s (signed: %s)', (endRoundState, signed) => {
        const address = 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2';
        const round = createCoinjoinRound(
            [createInput('account-A', '0'.repeat(72), { witness: '0'.repeat(97 * 2 + 4) })],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    signed,
                    endRoundState,
                    addresses: [
                        { address, accountKey: 'account-A', path: '', scriptPubKey: '', amount: 1 },
                    ],
                    transactionData: TRANSACTION_DATA,
                },
            },
        );
        // as outputRegistration does
        round.prison.detainRegisteredOutput({ accountKey: 'account-A', address }, round.id);

        ended(round, [], options);

        expect(round.prison.isDetained(address)).toMatchObject({
            errorCode: 'registeredOutput',
            roundId: round.id,
            sentenceEnd: Infinity,
        });
    });

    it('TransactionBroadcastFailed signed by this instance', () => {
        const address = 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2';
        const round = createCoinjoinRound(
            [createInput('account-A', '0'.repeat(72), { witness: '0'.repeat(97 * 2 + 4) })],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    signed: true,
                    endRoundState: EndRoundState.TransactionBroadcastFailed,
                    addresses: [
                        { address, accountKey: 'account-A', path: '', scriptPubKey: '', amount: 1 },
                    ],
                    transactionData: TRANSACTION_DATA,
                },
            },
        );
        // as outputRegistration does
        round.prison.detainRegisteredOutput({ accountKey: 'account-A', address }, round.id);

        ended(round, [], options);

        // The coordinator may still broadcast the transaction, so as after a broadcast the address
        // is neither reused by a blame round nor recycled.
        expect(round.prison.isDetained(address)).toMatchObject({
            errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
            roundId: round.id,
            sentenceEnd: Infinity,
        });
    });

    it('AbortedNotEnoughAlices', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', '0'.repeat(72), {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.AbortedNotEnoughAlices,
                },
            },
        );

        // NOTE: registered inputs are detained by inputRegistration process
        round.prison.detain(
            { accountKey: 'account-A', outpoint: '0'.repeat(72) },
            {
                roundId: round.id,
                errorCode: WabiSabiProtocolErrorCode.AliceAlreadyRegistered,
            },
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(0);
        expect(round.prison.inmates.length).toEqual(0); // input released from detention
    });

    it('TransactionBroadcasted', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', '0'.repeat(72), {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                }),
            ],
            {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.TransactionBroadcasted,
                    addresses: [
                        {
                            address:
                                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                            path: '',
                            scriptPubKey:
                                '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                        },
                    ],
                },
            },
        );

        // as outputRegistration does
        round.prison.detainRegisteredOutput(
            {
                accountKey: 'account-A',
                address: 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
            },
            round.id,
        );

        ended(round, [], options);

        expect(logger.error).toHaveBeenCalledTimes(0);
        expect(round.prison.inmates.length).toEqual(2); // input and output detained forever
        // neither reused by a blame round nor recycled
        expect(
            round.prison.isDetained(
                'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
            ),
        ).toMatchObject({
            errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
            roundId: round.id,
            sentenceEnd: Infinity,
        });
    });

    describe('payments', () => {
        const PAYMENT = {
            accountKey: 'account-A',
            paymentId: 'payment-1',
            address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            scriptPubKey: '0 751e76e8199196d454941c45d1b3a323f1433bd6',
            scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
            amount: 100000,
            anchor: '0'.repeat(72),
        };
        const confirmedInput = () =>
            createInput('account-A', '0'.repeat(72), {
                ownershipProof: '01A1',
                registrationData: { AliceId: '01A1-01a1' },
                realAmountCredentials: {},
                realVsizeCredentials: {},
                confirmationData: {},
                confirmedAmountCredentials: {},
                confirmedVsizeCredentials: {},
            });

        it('NotAllAlicesSign by this instance with a payment output only', () => {
            const round = createCoinjoinRound([confirmedInput()], {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.NotAllAlicesSign,
                    addresses: [],
                    payments: [PAYMENT],
                },
            });

            ended(round, [], options);

            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledWith(
                expect.stringMatching(/Missing signed inputs/),
            );
            // the payee is never detained
            expect(round.prison.inmates.map(i => i.id)).toEqual(['0'.repeat(72)]);
        });

        it('TransactionBroadcasted blocks the payment', () => {
            const account = { accountKey: 'account-A', blockedPaymentIds: [] as string[] };
            const changeAddress = {
                accountKey: 'account-A',
                address: 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2',
                path: '',
                scriptPubKey: '1 b67b77a4cac9a32c463e5bbe0c6cbfbab3c86cb59518e5661766056e6a7e849c',
                amount: 10000,
            };
            const round = createCoinjoinRound([confirmedInput()], {
                ...options,
                round: {
                    phase: RoundPhase.Ended,
                    endRoundState: EndRoundState.TransactionBroadcasted,
                    addresses: [changeAddress],
                    payments: [PAYMENT],
                },
            });

            ended(round, [account as any], options); // partial Account

            expect(logger.error).toHaveBeenCalledTimes(0);
            // input and change detained forever, the payee is not
            expect(round.prison.inmates.map(i => i.id)).toEqual([
                '0'.repeat(72),
                changeAddress.address,
            ]);
            expect(account.blockedPaymentIds).toEqual([PAYMENT.paymentId]);
        });

        it('TransactionBroadcastFailed signed by this instance does not detain the payee', () => {
            const account = { accountKey: 'account-A', blockedPaymentIds: [] as string[] };
            const changeAddress = 'bc1pkeah0fx2ex3jc337twlqcm9lh2eusm94j5vw2eshvczku6n7sjwqrfyfj2';
            const round = createCoinjoinRound(
                [createInput('account-A', '0'.repeat(72), { witness: '0'.repeat(97 * 2 + 4) })],
                {
                    ...options,
                    round: {
                        phase: RoundPhase.Ended,
                        signed: true,
                        endRoundState: EndRoundState.TransactionBroadcastFailed,
                        addresses: [
                            {
                                address: changeAddress,
                                accountKey: 'account-A',
                                path: '',
                                scriptPubKey: '',
                                amount: 1,
                            },
                        ],
                        payments: [PAYMENT],
                        transactionData: TRANSACTION_DATA,
                    },
                },
            );
            // as outputRegistration does, for the change output only
            round.prison.detainRegisteredOutput(
                { accountKey: 'account-A', address: changeAddress },
                round.id,
            );

            ended(round, [account as any], options); // partial Account

            expect(round.prison.isDetained(changeAddress)).toMatchObject({
                errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
            });
            expect(round.prison.isDetained(PAYMENT.address)).toBeUndefined();
            // The anchor keeps a later attempt from confirming next to this one.
            expect(account.blockedPaymentIds).toEqual([]);
        });
    });
});
