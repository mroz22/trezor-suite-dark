import { verifyRoundInputs } from './verifyRoundInputs';
import { createInput } from '../../__fixtures__/input.fixture';
import { createInputAddedEvent } from '../../__fixtures__/round.fixture';
import { CoordinatorMisbehaviorError } from '../coordinator';

const OWN_OUTPOINT = 'a00000000000000000000000000000000000000000000000000000000000000001000000';
const OWN_OUTPOINT_2 = 'b00000000000000000000000000000000000000000000000000000000000000002000000';
const OTHER_OUTPOINT = 'C00000000000000000000000000000000000000000000000000000000000000003000000';
// Script of createInput in the format of the coordinator.
const OWN_SCRIPT_PUBKEY = '1 fc485427c6b286466faca747ad0faf6aaf6f7ef72ef7c81a2064df3796dbea2e';
const OTHER_SCRIPT_PUBKEY = '1 6a6daebd9abae25cdd376b811190163eb00c58e87da1867ba8546229098231c3';

// An own input which got its confirmed credentials from the coordinator.
const CONFIRMED = { confirmedAmountCredentials: [{ Value: 1 }] };

// Coordinator outpoints are uppercase, own outpoints of the client lowercase.
const createRound = (registeredOutpoints: string[]) => ({
    inputs: [
        createInput('account-A', OWN_OUTPOINT, CONFIRMED),
        createInput('account-B', OWN_OUTPOINT_2, CONFIRMED),
    ],
    coinjoinState: {
        Type: '',
        Events: registeredOutpoints.map(createInputAddedEvent),
    },
});

const getThrownError = (verify: () => void) => {
    try {
        verify();
    } catch (error) {
        return error;
    }
};

describe('verifyRoundInputs', () => {
    it('accepts own inputs of several accounts with inputs of other participants', () => {
        const round = createRound([
            OWN_OUTPOINT.toUpperCase(),
            OWN_OUTPOINT_2.toUpperCase(),
            OTHER_OUTPOINT,
        ]);

        expect(() => verifyRoundInputs(round, { minInputCount: 3 })).not.toThrow();
    });

    it('refuses duplicate inputs which differ only in letter case', () => {
        const round = createRound([
            OWN_OUTPOINT.toUpperCase(),
            OTHER_OUTPOINT,
            OTHER_OUTPOINT.toLowerCase(),
        ]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2 }));

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

        expect(() => verifyRoundInputs(round, { minInputCount: 2 })).toThrow(
            CoordinatorMisbehaviorError,
        );
    });

    it.each([
        ['missing', undefined],
        ['with a different amount', { ScriptPubKey: OWN_SCRIPT_PUBKEY, Value: 2 }],
        ['with a different script', { ScriptPubKey: OTHER_SCRIPT_PUBKEY, Value: 1 }],
        ['with a malformed script', { ScriptPubKey: '1 zz', Value: 1 }],
    ])('refuses an own input %s', (_, TxOut) => {
        const round = createRound([OWN_OUTPOINT.toUpperCase(), OTHER_OUTPOINT]);
        if (TxOut) {
            round.coinjoinState.Events.push({
                ...createInputAddedEvent(OWN_OUTPOINT_2.toUpperCase()),
                Coin: { Outpoint: OWN_OUTPOINT_2.toUpperCase(), TxOut },
            });
        }
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2 }));

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

        expect(() => verifyRoundInputs(round, { minInputCount: 2 })).not.toThrow();
    });

    it('refuses a round with fewer inputs than minInputCount', () => {
        const round = createRound([OWN_OUTPOINT, OWN_OUTPOINT_2, OTHER_OUTPOINT]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 4 }));

        expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty(
            'message',
            'Inconsistent data. Round has 3 registered inputs but minimum required is 4.',
        );
    });

    it('refuses a round without inputs of other participants as a non-misbehavior', () => {
        const round = createRound([OWN_OUTPOINT.toUpperCase(), OWN_OUTPOINT_2]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 2 }));

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty('message', 'No inputs of other participants in the round.');
    });

    it('refuses a round without registered inputs', () => {
        expect(() =>
            verifyRoundInputs({ ...createRound([]), inputs: [] }, { minInputCount: 0 }),
        ).toThrow('No inputs of other participants in the round.');
    });
});
