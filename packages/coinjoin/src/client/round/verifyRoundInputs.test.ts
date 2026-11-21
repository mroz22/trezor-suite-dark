import { verifyRoundInputs } from './verifyRoundInputs';
import { createInput } from '../../__fixtures__/input.fixture';
import { createInputAddedEvent } from '../../__fixtures__/round.fixture';
import { CoordinatorMisbehaviorError } from '../coordinator';

const OWN_OUTPOINT = 'a00000000000000000000000000000000000000000000000000000000000000001000000';
const OWN_OUTPOINT_2 = 'b00000000000000000000000000000000000000000000000000000000000000002000000';
const OTHER_OUTPOINT = 'C00000000000000000000000000000000000000000000000000000000000000003000000';

// Coordinator outpoints are uppercase, own outpoints of the client lowercase.
const createRound = (registeredOutpoints: string[]) => ({
    inputs: [createInput('account-A', OWN_OUTPOINT), createInput('account-B', OWN_OUTPOINT_2)],
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

    it('refuses a round with fewer inputs than minInputCount', () => {
        const round = createRound([OWN_OUTPOINT, OTHER_OUTPOINT]);
        const error = getThrownError(() => verifyRoundInputs(round, { minInputCount: 3 }));

        expect(error).toBeInstanceOf(CoordinatorMisbehaviorError);
        expect(error).toHaveProperty(
            'message',
            'Inconsistent data. Round has 2 registered inputs but minimum required is 3.',
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
        expect(() => verifyRoundInputs(createRound([]), { minInputCount: 0 })).toThrow(
            'No inputs of other participants in the round.',
        );
    });
});
