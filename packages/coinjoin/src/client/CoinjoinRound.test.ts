import { loggerMock } from '@trezor/logger/mocks';
import * as trezorUtils from '@trezor/utils';
import { networks } from '@trezor/utxo-lib';

import { CoordinatorMisbehaviorError } from './coordinator';
import { createServer } from '../../mocks/server';
import { createInput } from '../__fixtures__/input.fixture';
import {
    DEFAULT_ROUND,
    ROUND_CREATION_EVENT,
    createCoinjoinRound,
    createInputAddedEvent,
} from '../__fixtures__/round.fixture';
import * as CONSTANTS from '../constants';
import { EndRoundState, RoundPhase, WabiSabiProtocolErrorCode } from '../enums';
import type { CoinjoinRoundPayment, CoinjoinTransactionData } from '../types/round';
import { getCoinjoinTransaction } from '../utils/roundUtils';

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
jest.mock('../utils/ownershipProof', () => ({
    verifyOwnershipProof: () => 'valid',
}));

// mock ROUND_PHASE_PROCESS_TIMEOUT, use getter to mock individually for each test
jest.mock('../constants', () => {
    const originalModule = jest.requireActual('../constants');

    return {
        __esModule: true,
        ...originalModule,
        get ROUND_PHASE_PROCESS_TIMEOUT() {
            return 10000;
        },
        get ROUND_SELECTION_REGISTRATION_OFFSET() {
            return 30000;
        },
    };
});

describe(`CoinjoinRound`, () => {
    let server: Awaited<ReturnType<typeof createServer>>;
    const logger = loggerMock;

    beforeAll(async () => {
        server = await createServer();
    });

    afterEach(() => {
        jest.clearAllMocks();
        server?.removeAllListeners('test-request');
    });

    afterAll(() => {
        server?.close();
    });

    it('onPhaseChange records phaseStartLowerBound and only updates it on an actual phase change', async () => {
        const round = createCoinjoinRound([], { ...server?.requestOptions, logger });

        // entering the signing phase records the lower bound the client passes (the previous
        // committed poll's request time) so transactionSigning can size the send window safely
        await round.onPhaseChange({ ...DEFAULT_ROUND, Phase: 3 }, 70000);
        expect(round.phaseStartLowerBound).toBe(70000);

        // a later same-phase re-poll must NOT overwrite it (a later poll time is a worse lower
        // bound); the assignment lives inside the `this.phase !== changed.Phase` guard on purpose
        await round.onPhaseChange({ ...DEFAULT_ROUND, Phase: 3 }, 90000);
        expect(round.phaseStartLowerBound).toBe(70000);
    });

    it('leaves the round when its status no longer matches the round id', async () => {
        const requestSpy = jest.fn();
        server?.addListener('test-request', ({ url, resolve }) => {
            requestSpy(url);
            resolve();
        });

        const outpoint = 'a10000000000000000000000000000000000000000000000000000000000000001000000';
        const address = {
            accountKey: 'account-A',
            address: 'tb1p-registered',
            path: '',
            scriptPubKey: '',
            amount: 1,
        };
        const round = createCoinjoinRound(
            [
                createInput('account-A', outpoint, {
                    ownershipProof: '01A1',
                    registrationData: { AliceId: '01A1-01a1' },
                    confirmationData: {},
                }),
            ],
            {
                ...server?.requestOptions,
                logger,
                round: {
                    phase: RoundPhase.OutputRegistration,
                    // The end state is not part of the round id, an earlier status may carry any.
                    endRoundState: EndRoundState.TransactionBroadcasted,
                    addresses: [address],
                },
            },
        );
        // As outputRegistration detains a registered address.
        round.prison.detain(address, {
            roundId: round.id,
            errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
        });
        const endedSpy = jest.fn();
        round.on('ended', endedSpy);

        // Other credential issuer keys under the same id.
        await round.onPhaseChange({
            ...DEFAULT_ROUND,
            Phase: RoundPhase.TransactionSigning,
            AmountCredentialIssuerParameters: DEFAULT_ROUND.VsizeCredentialIssuerParameters,
        });

        expect(round.phase).toBe(RoundPhase.Ended);
        expect(round.endRoundState).toBe(EndRoundState.None);
        expect(round.inputs[0]?.error).toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringMatching(/Leaving round .* Its parameters no longer match its id/),
        );

        await round.process([]);

        expect(round.inputs).toEqual([]);
        expect(round.failed.map(input => input.outpoint)).toEqual([outpoint]);
        expect(round.getRequest()).toBeUndefined();
        expect(endedSpy).toHaveBeenCalledTimes(1);
        expect(requestSpy).not.toHaveBeenCalled();
        expect(round.prison.isDetained(outpoint)).toMatchObject({
            roundId: round.id,
            reason: 'Round parameters do not match the round id',
        });
        // Not detained for good as after a broadcast, the end state of the coordinator is ignored.
        expect(round.prison.isDetained(address)).toMatchObject({
            roundId: round.id,
            sentenceEnd: expect.any(Number),
        });
        expect(round.prison.isDetained(address)?.sentenceEnd).not.toBe(Infinity);
    });

    it('catch errored Round', async () => {
        const ownOutpoint =
            'a10000000000000000000000000000000000000000000000000000000000000001000000';
        // create CoinjoinRound in phase 2 (OutputRegistration) with the own input and inputs of
        // other participants, so it passes verifyRoundInputs
        const round = createCoinjoinRound(
            [
                createInput('account-A', ownOutpoint, {
                    ownershipProof: '01A1',
                    registrationData: {
                        AliceId: '01A1-01a1',
                    },
                    realAmountCredentials: {},
                    realVsizeCredentials: {},
                    confirmationData: {},
                    confirmedAmountCredentials: [{}], // getOutputAmounts reads the first one
                    confirmedVsizeCredentials: {},
                }),
            ],
            {
                ...server?.requestOptions,
                logger,
                round: {
                    phase: 2,
                    coinjoinState: {
                        Type: '',
                        Events: [
                            ROUND_CREATION_EVENT,
                            createInputAddedEvent(ownOutpoint.toUpperCase()),
                            createInputAddedEvent(
                                'B00000000000000000000000000000000000000000000000000000000000000002000000',
                            ),
                            createInputAddedEvent(
                                'C00000000000000000000000000000000000000000000000000000000000000003000000',
                            ),
                        ],
                    },
                },
            },
        );

        // process phase (will throw error Missing credentials to join), which fails the inputs of
        // the account
        await round.process([]);

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
            expect.stringMatching(/Output registration failed: Missing credentials to join/),
        );
        expect(round.failed).toEqual([
            expect.objectContaining({
                error: expect.objectContaining({
                    message: expect.stringMatching(/Missing credentials to join/),
                }),
            }),
        ]);
    });

    it('end Round if any input-registration errors and there is only one account', async () => {
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/input-registration') && data.Input === 'A2') {
                // fail on second input
                reject(500, { errorCode: 'InputBanned', exceptionData: {} });
            }
            resolve();
        });

        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-A', 'A2', { ownershipProof: '01A2' }),
                createInput('account-A', 'A3', { ownershipProof: '01A3' }),
            ],
            server?.requestOptions,
        );

        await round.process([]);

        expect(round.phase).toBe(4); // RoundPhase.Ended
        expect(round.inputs.length).toBe(0); // all inputs are removed
    });

    it('exclude all account inputs from the Round if any input-registration errors', async () => {
        server?.addListener('test-request', ({ url, data, resolve, reject }) => {
            if (url.endsWith('/input-registration') && data.Input === 'B2') {
                // fail on second input of account-B
                reject(500, { errorCode: 'InputBanned', exceptionData: {} });
            }
            resolve();
        });

        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-B', 'B1', { ownershipProof: '01B1' }),
                createInput('account-A', 'A2', { ownershipProof: '01A2' }),
                createInput('account-B', 'B2', { ownershipProof: '01B2' }),
            ],
            server?.requestOptions,
        );

        await round.process([]);

        expect(round.phase).toBe(0); // RoundPhase did not ended
        expect(round.inputs.map(i => i.outpoint)).toEqual(['A1', 'A2']); // inputs from the account-A are still in the Round

        round.unregisterAccount('account-A'); // unregister account-A to stop confirmationInterval
    });

    it('onPhaseChange lock cool off resolved', async () => {
        const delayMock = jest
            .spyOn(trezorUtils, 'getWeakRandomNumberInRange')
            .mockImplementation(() => 800);

        const constantsMock = jest
            .spyOn(CONSTANTS, 'ROUND_SELECTION_REGISTRATION_OFFSET', 'get')
            .mockReturnValue(1000 as any);

        const registrationSpy = jest.fn();
        const confirmationSpy = jest.fn();

        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/input-registration')) {
                registrationSpy();
            }
            if (url.endsWith('/connection-confirmation')) {
                confirmationSpy();
            }
            resolve();
        });

        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-B', 'B1', { ownershipProof: '01B1' }),
            ],
            {
                ...server?.requestOptions,
                round: { phaseDeadline: Date.now() + 10000 },
                roundParameters: {
                    ConnectionConfirmationTimeout: '0d 0h 0m 4s',
                },
            },
        );

        // process but not wait for the result
        round.process([]);

        // input-registration is now set with delay ~0.8 sec.
        // we want to change phase earlier
        await new Promise(resolve => setTimeout(resolve, 500));
        expect(registrationSpy).toHaveBeenCalledTimes(0); // no registrations yet

        // change Round phase before input-registration was called
        await round.onPhaseChange({ ...DEFAULT_ROUND, Phase: 1 });

        // registrationData should be assigned,
        // confirmationInterval should be assigned,
        // lock was not aborted (no error in input => signal was not aborted)
        round.inputs.forEach(input => {
            expect(input.error).toBeUndefined();
            expect(input.registrationData).not.toBeUndefined();
            expect(input.getConfirmationInterval).not.toBeUndefined();
        });
        expect(registrationSpy).toHaveBeenCalledTimes(2); // two registrations
        expect(confirmationSpy).toHaveBeenCalledTimes(0); // no confirmations yet

        await round.process([]);
        round.inputs.forEach(input => {
            expect(input.error).toBeUndefined();
            expect(input.confirmationData).not.toBeUndefined();
        });
        expect(confirmationSpy).toHaveBeenCalledTimes(2); // two confirmations

        delayMock.mockRestore();
        constantsMock.mockRestore();
    });

    it('onPhaseChange lock cool off aborted', async () => {
        const constantsMock = jest
            .spyOn(CONSTANTS, 'ROUND_PHASE_PROCESS_TIMEOUT', 'get')
            .mockReturnValue(500 as any);

        server?.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/input-registration')) {
                setTimeout(resolve, 2000);
            } else {
                resolve();
            }
        });

        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-B', 'B1', { ownershipProof: '01B1' }),
            ],
            {
                ...server?.requestOptions,
                round: { phaseDeadline: Date.now() + 10000 },
                roundParameters: {
                    ConnectionConfirmationTimeout: '0d 0h 0m 5s',
                },
            },
        );

        // process phase 0 but not wait for the result
        round.process([]);

        // input-registration will respond in  ~2 sec.
        // we want to change phase earlier
        await new Promise(resolve => setTimeout(resolve, 500));

        // change Round phase before input-registration was called
        await round.onPhaseChange({ ...DEFAULT_ROUND, Phase: 1 });

        // registrationData should NOT be assigned,
        // confirmationInterval should NOT be assigned,
        // lock was aborted, registration request was aborted
        round.inputs.forEach(input => {
            expect(input.error?.message).toMatch(/Aborted by signal/);
            expect(input.registrationData).toBeUndefined();
            expect(input.getConfirmationInterval()).toBeUndefined();
        });

        // process phase 1
        await round.process([]);

        expect(round.inputs.length).toBe(0); // no valid inputs, requests aborted
        expect(round.failed.length).toBe(0); // no errored inputs, inputs with errors in inputRegistration are not passed further

        constantsMock.mockRestore();
    });

    it('onPhaseChange lock cool off not used', async () => {
        const spy = jest.fn();
        server.addListener('test-request', ({ url, resolve }) => {
            if (url.endsWith('/input-registration')) {
                spy();
                // throttle request so it can be aborted
                setTimeout(resolve, 5000);
            } else {
                resolve();
            }
        });

        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-B', 'B1', { ownershipProof: '01B1' }),
            ],
            {
                ...server?.requestOptions,
                round: { phaseDeadline: Date.now() + 5000 },
            },
        );

        // process but not wait for the result
        round.process([]);

        // we want to change phase before input-registration response
        await new Promise(resolve => setTimeout(resolve, 500));

        // change Round phase to Ended
        await round.onPhaseChange({ ...DEFAULT_ROUND, Phase: 4 });

        expect(round.inputs.length).toBe(0); // no valid inputs, requests aborted
        expect(round.failed.length).toBe(0); // no errored inputs, inputs with errors in inputRegistration are not passed further

        expect(spy).toHaveBeenCalledTimes(2); // two registrations called
    });

    it('unregisterAccount not in critical phase', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-B', 'B1', { ownershipProof: '01B1' }),
            ],
            {
                ...server?.requestOptions,
            },
        );

        const spyEnded = jest.fn();
        const spyChanged = jest.fn();
        round.on('ended', spyEnded);
        round.on('changed', spyChanged);

        round.unregisterAccount('account-A');
        expect(spyEnded).toHaveBeenCalledTimes(0); // not called because there is also account-B input in round

        round.unregisterAccount('account-B');
        expect(spyEnded).toHaveBeenCalledTimes(1);
        expect(spyChanged).toHaveBeenCalledTimes(1);
    });

    it('unregisterAccount in critical phase', () => {
        const round = createCoinjoinRound(
            [
                createInput('account-A', 'A1', { ownershipProof: '01A1' }),
                createInput('account-B', 'B1', { ownershipProof: '01B1' }),
            ],
            {
                ...server?.requestOptions,
                round: { phase: 2 },
            },
        );

        const spyEnded = jest.fn();
        const spyChanged = jest.fn();
        round.on('ended', spyEnded);
        round.on('changed', spyChanged);

        round.unregisterAccount('account-A');
        expect(spyEnded).toHaveBeenCalledTimes(1); // called immediately event if there is account-B input in round
        expect(spyChanged).toHaveBeenCalledTimes(1);
    });

    it('unregisterAccount when round is locked', async () => {
        const delayMock = jest
            .spyOn(trezorUtils, 'getWeakRandomNumberInRange')
            .mockImplementation(() => 800);

        const constantsMock = jest
            .spyOn(CONSTANTS, 'ROUND_SELECTION_REGISTRATION_OFFSET', 'get')
            .mockReturnValue(1000 as any);

        const round = createCoinjoinRound(
            [createInput('account-A', 'A1', { ownershipProof: '01A1' })],
            {
                ...server?.requestOptions,
                round: { phaseDeadline: Date.now() + 10000 },
                roundParameters: {
                    ConnectionConfirmationTimeout: '0d 0h 0m 4s',
                },
            },
        );

        const spyEnded = jest.fn();
        const spyChanged = jest.fn();
        round.on('ended', spyEnded);
        round.on('changed', spyChanged);

        // process but not wait for the result
        // eslint-disable-next-line jest/valid-expect-in-promise
        round.process([]).then(() => {
            expect(spyEnded).toHaveBeenCalledTimes(1);
            expect(spyChanged).toHaveBeenCalledTimes(1);
        });

        // we want to unregister account before input-registration response
        await new Promise(resolve => setTimeout(resolve, 100));
        round.unregisterAccount('account-A');

        delayMock.mockRestore();
        constantsMock.mockRestore();
    });

    describe('payments', () => {
        const PAYMENT: CoinjoinRoundPayment = {
            accountKey: 'account-A',
            paymentId: 'payment-1',
            address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            scriptPubKey: '0 751e76e8199196d454941c45d1b3a323f1433bd6',
            scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
            amount: 100000,
            anchor: `${'a0'.repeat(32)}00000000`,
        };
        const txInput = {
            path: undefined,
            amount: 150000,
            commitmentData: '',
            address: '',
            scriptPubKey: '',
            ownershipProof: '',
        };
        const TRANSACTION_DATA: CoinjoinTransactionData = {
            inputs: [
                { ...txInput, outpoint: PAYMENT.anchor, hash: 'a0'.repeat(32), index: 0 },
                {
                    ...txInput,
                    outpoint: `${'b0'.repeat(32)}00000000`,
                    hash: 'b0'.repeat(32),
                    index: 0,
                },
            ],
            outputs: [
                { address: PAYMENT.address, scriptPubKey: PAYMENT.scriptPubKeyHex, amount: 100000 },
                { address: '', scriptPubKey: `0014${'cd'.repeat(20)}`, amount: 199000 },
            ],
            coinjoinRequest: { fee_rate: 0, no_fee_threshold: 0, min_registrable_amount: 5000 },
        };

        const signingRound = (payments: CoinjoinRoundPayment[]) =>
            createCoinjoinRound(
                [
                    createInput('account-A', PAYMENT.anchor),
                    createInput('account-B', `${'b0'.repeat(32)}00000000`),
                ],
                {
                    ...server?.requestOptions,
                    network: networks.bitcoin,
                    round: {
                        phase: 3,
                        transactionData: TRANSACTION_DATA,
                        liquidityClues: [],
                        payments,
                    },
                },
            );

        it('getRequest returns the payment attempts with the signature request', () => {
            const request = signingRound([PAYMENT]).getRequest();

            expect(request).toMatchObject({
                type: 'signature',
                payments: [
                    {
                        accountKey: 'account-A',
                        paymentId: PAYMENT.paymentId,
                        address: PAYMENT.address,
                        amount: PAYMENT.amount,
                        anchor: PAYMENT.anchor,
                        txid: getCoinjoinTransaction({
                            transactionData: TRANSACTION_DATA,
                            network: networks.bitcoin,
                        }).getId(),
                        inputs: [PAYMENT.anchor],
                    },
                ],
            });

            expect(signingRound([]).getRequest()).toMatchObject({ payments: [] });
        });

        it('getRequest leaves out the payment of an account whose inputs failed', () => {
            // account-A registered its payment, but a change output of account-A failed and its
            // inputs left the round.
            const round = signingRound([PAYMENT]);
            round.inputs = round.inputs.filter(input => input.accountKey !== 'account-A');

            expect(round.getRequest()).toMatchObject({ type: 'signature', payments: [] });
        });

        it('toSerialized exposes payment ids only and end resets payments', () => {
            const round = createCoinjoinRound([], {
                ...server?.requestOptions,
                round: {
                    paymentAccountKeys: ['account-A'],
                    payments: [PAYMENT],
                    rejectedPayments: [
                        {
                            accountKey: 'account-B',
                            paymentId: 'payment-2',
                            errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
                            isBlocked: true,
                        },
                    ],
                },
            });

            expect(round.toSerialized()).toMatchObject({
                payments: [{ accountKey: 'account-A', paymentId: PAYMENT.paymentId }],
                rejectedPayments: [
                    {
                        accountKey: 'account-B',
                        paymentId: 'payment-2',
                        errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
                        isBlocked: true,
                    },
                ],
            });
            expect(round.toSerialized().payments[0]).toEqual({
                accountKey: 'account-A',
                paymentId: PAYMENT.paymentId,
            });

            round.end();

            expect(round.paymentAccountKeys).toEqual([]);
            expect(round.payments).toEqual([]);
            expect(round.rejectedPayments).toEqual([]);
        });
    });
});
