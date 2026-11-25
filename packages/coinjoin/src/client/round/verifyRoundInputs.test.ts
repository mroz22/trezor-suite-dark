import { loggerMock as logger } from '@trezor/logger/mocks';

import { verifyRoundInputs } from './verifyRoundInputs';
import { createInput } from '../../__fixtures__/input.fixture';
import { DEFAULT_ROUND, createInputAddedEvent } from '../../__fixtures__/round.fixture';
import { getCommitmentData } from '../../utils/roundUtils';
import { CoordinatorMisbehaviorError } from '../coordinator';

const OWN_OUTPOINT = 'a00000000000000000000000000000000000000000000000000000000000000001000000';
const OWN_OUTPOINT_2 = 'b00000000000000000000000000000000000000000000000000000000000000002000000';
const OTHER_OUTPOINT = 'C00000000000000000000000000000000000000000000000000000000000000003000000';
// Script of createInput in the format of the coordinator.
const OWN_SCRIPT_PUBKEY = '1 fc485427c6b286466faca747ad0faf6aaf6f7ef72ef7c81a2064df3796dbea2e';
const OTHER_SCRIPT_PUBKEY = '1 6a6daebd9abae25cdd376b811190163eb00c58e87da1867ba8546229098231c3';

// An own input which got its confirmed credentials from the coordinator.
const CONFIRMED = { confirmedAmountCredentials: [{ value: 1 }] };

// Taproot input with its ownership proof for round 1 of the coordinator www.example.com, from
// trezor-firmware tests/device_tests/bitcoin/test_authorize_coinjoin.py (test_sign_tx).
const OTHER_INPUT = {
    TxOut: {
        ScriptPubKey: '1 b3a2750e21facec36b2a56d76cca6019bf517a5c45e2ea8e5b4ed191090f3003',
        Value: 100000,
    },
    OwnershipProof:
        '534C001901019CF1B0AD730100BD7A69E987D55348BB798E2B2096A6A5713E9517655BD2021300014052D479F48D34F1CA6872D4571413660040C3E98841AB23A2C5C1F37399B71BFA6F56364B79717EE90552076A872DA68129694E1B4FB0E0651373DCF56DB123C5',
};
const COMMITMENT_DATA = getCommitmentData('www.example.com', `${'0'.repeat(63)}1`);

// Coordinator outpoints are uppercase, own outpoints of the client lowercase. Ownership proofs of
// own inputs are not verified.
const createRound = (registeredOutpoints: string[]) => ({
    inputs: [
        createInput('account-A', OWN_OUTPOINT, CONFIRMED),
        createInput('account-B', OWN_OUTPOINT_2, CONFIRMED),
    ],
    coinjoinState: {
        Type: '',
        Events: registeredOutpoints.map(outpoint => {
            const event = createInputAddedEvent(outpoint);
            if (outpoint.toUpperCase() !== OTHER_OUTPOINT) return event;

            const { TxOut, OwnershipProof } = OTHER_INPUT;

            return { ...event, Coin: { Outpoint: outpoint, TxOut }, OwnershipProof };
        }),
    },
    commitmentData: COMMITMENT_DATA,
    blameOf: DEFAULT_ROUND.BlameOf,
});

const getThrownError = (verify: () => void) => {
    try {
        verify();
    } catch (error) {
        return error;
    }
};

describe('verifyRoundInputs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('accepts own inputs of several accounts with inputs of other participants', () => {
        const round = createRound([
            OWN_OUTPOINT.toUpperCase(),
            OTHER_OUTPOINT,
            OWN_OUTPOINT_2.toUpperCase(),
        ]);

        // Sorted outpoints as hash:index.
        expect(verifyRoundInputs(round, { minInputCount: 3, logger })).toEqual([
            `${'0'.repeat(62)}a0:1`,
            `${'0'.repeat(62)}b0:2`,
            `${'0'.repeat(62)}c0:3`,
        ]);
    });

    it('refuses duplicate inputs which differ only in letter case', () => {
        const round = createRound([
            OWN_OUTPOINT.toUpperCase(),
            OTHER_OUTPOINT,
            OTHER_OUTPOINT.toLowerCase(),
        ]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2, logger }));

        expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty(
            'message',
            'Inconsistent data. 1 duplicate or malformed registered inputs.',
        );
    });

    it.each([
        ['empty', ''],
        ['too short', OTHER_OUTPOINT.slice(0, -2)],
        ['odd length', OTHER_OUTPOINT.slice(0, -1)],
        ['too long', `${OTHER_OUTPOINT}00`],
        ['not hex', `${OTHER_OUTPOINT.slice(0, -2)}0Z`],
    ])('refuses a malformed outpoint (%s)', (_, outpoint) => {
        const round = createRound([OWN_OUTPOINT, OTHER_OUTPOINT, outpoint]);

        expect(() => verifyRoundInputs(round, { minInputCount: 2, logger })).toThrow(
            CoordinatorMisbehaviorError,
        );
    });

    it.each([
        ['missing', undefined],
        ['with a different amount', { ScriptPubKey: OWN_SCRIPT_PUBKEY, Value: 2 }],
        ['with a different script', { ScriptPubKey: OTHER_SCRIPT_PUBKEY, Value: 1_000_000 }],
        ['with a malformed script', { ScriptPubKey: '1 zz', Value: 1_000_000 }],
    ])('refuses an own input %s', (_, TxOut) => {
        const round = createRound([OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT]);
        if (TxOut) {
            round.coinjoinState.Events.push({
                ...createInputAddedEvent(OWN_OUTPOINT_2.toUpperCase()),
                Coin: { Outpoint: OWN_OUTPOINT_2.toUpperCase(), TxOut },
            });
        }
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2, logger }));

        expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty(
            'message',
            'Inconsistent data. 1 own inputs missing or registered with a different amount or script.',
        );
    });

    it('accepts a missing own input without confirmed credentials', () => {
        // The coordinator removes an input which does not confirm its connection in time.
        const round = {
            ...createRound([OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT]),
            inputs: [
                createInput('account-A', OWN_OUTPOINT, CONFIRMED),
                createInput('account-B', OWN_OUTPOINT_2),
            ],
        };

        expect(() => verifyRoundInputs(round, { minInputCount: 2, logger })).not.toThrow();
    });

    it('refuses a round with fewer inputs than minInputCount', () => {
        const round = createRound([OWN_OUTPOINT, OWN_OUTPOINT_2, OTHER_OUTPOINT]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 4, logger }));

        expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty(
            'message',
            'Inconsistent data. Round has 3 registered inputs but minimum required is 4.',
        );
    });

    it('refuses a round without inputs of other participants as a non-misbehavior', () => {
        const round = createRound([OWN_OUTPOINT.toUpperCase(), OWN_OUTPOINT_2]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2, logger }));

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty('message', 'No inputs of other participants in the round.');
    });

    it.each([
        ['an invalid ownership proof', OTHER_INPUT.TxOut, 'not-relevant', COMMITMENT_DATA],
        [
            'an ownership proof for another round',
            OTHER_INPUT.TxOut,
            OTHER_INPUT.OwnershipProof,
            getCommitmentData('www.example.com', `${'0'.repeat(63)}2`),
        ],
        [
            'another script',
            { ...OTHER_INPUT.TxOut, ScriptPubKey: OTHER_SCRIPT_PUBKEY },
            OTHER_INPUT.OwnershipProof,
            COMMITMENT_DATA,
        ],
        [
            'a malformed script',
            { ...OTHER_INPUT.TxOut, ScriptPubKey: '1 zz' },
            OTHER_INPUT.OwnershipProof,
            COMMITMENT_DATA,
        ],
    ])(
        'refuses an input of another participant with %s',
        (_, TxOut, OwnershipProof, commitmentData) => {
            const round = {
                ...createRound([OWN_OUTPOINT.toUpperCase(), OWN_OUTPOINT_2.toUpperCase()]),
                commitmentData,
            };
            round.coinjoinState.Events.push({
                Type: 'InputAdded',
                Coin: { Outpoint: OTHER_OUTPOINT, TxOut },
                OwnershipProof,
            });
            const error = getThrownError(() =>
                verifyRoundInputs(round, { minInputCount: 2, logger }),
            );

            expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
            expect(error).toHaveProperty(
                'message',
                'Inconsistent data. 1 inputs of other participants with an invalid ownership proof.',
            );
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(logger.warn).toHaveBeenCalledWith(
                `Invalid ownership proof of ~~${OTHER_OUTPOINT}~~ and 0 other inputs`,
            );
        },
    );

    it('refuses an ownership proof which the device refuses as a non-misbehavior', () => {
        // The signed body (38 bytes) and an empty scriptSig, then the signature with SIGHASH_NONE.
        const { OwnershipProof } = OTHER_INPUT;
        const proofWithSighashNone = `${OwnershipProof.slice(0, 76)}000141${OwnershipProof.slice(82)}02`;
        const round = createRound([OWN_OUTPOINT.toUpperCase(), OWN_OUTPOINT_2.toUpperCase()]);
        round.coinjoinState.Events.push({
            Type: 'InputAdded',
            Coin: { Outpoint: OTHER_OUTPOINT, TxOut: OTHER_INPUT.TxOut },
            OwnershipProof: proofWithSighashNone,
        });
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2, logger }));

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty(
            'message',
            '1 inputs of other participants with an ownership proof which the device refuses.',
        );
        expect(logger.warn).toHaveBeenCalledWith(
            `Unsupported ownership proof of ~~${OTHER_OUTPOINT}~~ and 0 other inputs`,
        );
    });

    it('refuses a round without registered inputs', () => {
        expect(() =>
            verifyRoundInputs({ ...createRound([]), inputs: [] }, { minInputCount: 0, logger }),
        ).toThrow('No inputs of other participants in the round.');
    });

    describe('blame round', () => {
        const ANOTHER_OUTPOINT =
            'D00000000000000000000000000000000000000000000000000000000000000004000000';

        const createBlameRound = (registeredOutpoints: string[], blameOfOutpoints?: string[]) => ({
            ...createRound(registeredOutpoints),
            blameOf: '1'.repeat(64),
            blameOfOutpoints,
        });

        it('accepts inputs of the failed round in another letter case', () => {
            // As signed in the failed round: own outpoints lowercase, the others uppercase. An
            // honest coordinator may leave some of them out.
            const round = createBlameRound(
                [
                    OWN_OUTPOINT.toUpperCase(),
                    OWN_OUTPOINT_2.toUpperCase(),
                    OTHER_OUTPOINT.toLowerCase(),
                ],
                [OWN_OUTPOINT, OWN_OUTPOINT_2, OTHER_OUTPOINT, ANOTHER_OUTPOINT],
            );

            expect(verifyRoundInputs(round, { minInputCount: 2, logger })).toEqual([
                `${'0'.repeat(62)}a0:1`,
                `${'0'.repeat(62)}b0:2`,
                `${'0'.repeat(62)}c0:3`,
            ]);
        });

        it.each([
            ['missing', [OWN_OUTPOINT, OWN_OUTPOINT_2]],
            ['malformed', [OWN_OUTPOINT, `${OTHER_OUTPOINT}ZZ`, OWN_OUTPOINT_2]],
        ])(
            'refuses inputs which were not in the failed round (%s there)',
            (_, blameOfOutpoints) => {
                // The other inputs fail before their ownership proofs are verified.
                const round = createBlameRound(
                    [OWN_OUTPOINT, OWN_OUTPOINT_2, OTHER_OUTPOINT, ANOTHER_OUTPOINT],
                    blameOfOutpoints,
                );
                const error = getThrownError(() =>
                    verifyRoundInputs(round, { minInputCount: 2, logger }),
                );

                expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
                expect(error).toHaveProperty(
                    'message',
                    'Inconsistent data. 2 inputs of the blame round were not in the failed round.',
                );
                expect(logger.warn).toHaveBeenCalledTimes(1);
                expect(logger.warn).toHaveBeenCalledWith(
                    `Input ~~${OTHER_OUTPOINT}~~ and 1 other inputs of the blame round were not in the failed round`,
                );
            },
        );

        it('refuses a blame round without known inputs of the failed round as a non-misbehavior', () => {
            const round = createBlameRound([OWN_OUTPOINT, OWN_OUTPOINT_2, OTHER_OUTPOINT]);
            const error = getThrownError(() =>
                verifyRoundInputs(round, { minInputCount: 2, logger }),
            );

            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
            expect(error).toHaveProperty('message', 'Inputs of the failed round are unknown.');
        });
    });
});
