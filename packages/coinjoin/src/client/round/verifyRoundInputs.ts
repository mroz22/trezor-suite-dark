import type { CoinjoinRoundOptions, CoinjoinRoundShape } from '../../types/round';
import { readOutpoint } from '../../utils/coordinatorUtils';
import { getRoundEvents } from '../../utils/roundUtils';
import { CoordinatorMisbehaviorError } from '../coordinator';

// 32 bytes of the transaction hash and 4 bytes of the output index.
const OUTPOINT_PATTERN = /^[0-9a-f]{72}$/i;

// Coordinator outpoints are uppercase and own outpoints lowercase, compare the parsed values.
const getOutpointKey = (outpoint: string) => {
    if (!OUTPOINT_PATTERN.test(outpoint)) return;

    const { hash, index } = readOutpoint(outpoint);

    return `${hash}:${index}`;
};

/**
 * Checks the inputs of the round announced by the coordinator. Called before the outputs are
 * registered, so the coordinator does not learn them in a round which is refused, and again
 * before the transaction is signed.
 * Throws CoordinatorMisbehaviorError if the coordinator provably lies and a plain Error if the
 * round has no inputs of other participants.
 */
export const verifyRoundInputs = (
    round: Pick<CoinjoinRoundShape, 'inputs' | 'coinjoinState'>,
    { minInputCount }: Pick<CoinjoinRoundOptions, 'minInputCount'>,
) => {
    const outpoints = getRoundEvents('InputAdded', round.coinjoinState.Events).map(
        ({ Coin }) => Coin.Outpoint,
    );
    const inputKeys = new Set<string>();
    const invalidOutpoints = outpoints.filter(outpoint => {
        const key = getOutpointKey(outpoint);
        if (!key || inputKeys.has(key)) return true;

        inputKeys.add(key);

        return false;
    });

    if (invalidOutpoints.length > 0) {
        throw new CoordinatorMisbehaviorError(
            `Inconsistent data. ${invalidOutpoints.length} duplicate or malformed registered inputs.`,
        );
    }

    // The round was selected only with MinInputCountByRound of at least minInputCount (see
    // getRoundCandidates) and the coordinator ends a round with fewer inputs before the outputs
    // are registered.
    if (inputKeys.size < minInputCount) {
        throw new CoordinatorMisbehaviorError(
            `Inconsistent data. Round has ${inputKeys.size} registered inputs but minimum required is ${minInputCount}.`,
        );
    }

    // Stricter than WalletWasabi isItForbiddenSoloCoinjoining, which counts as own only the inputs
    // of one wallet (CoinJoinTrackerFactory.cs creates a client per wallet): inputs of all accounts
    // of this client count as own. Not a lie, the round may be filled by own inputs only.
    const ownInputKeys = new Set(round.inputs.map(({ outpoint }) => getOutpointKey(outpoint)));
    if (Array.from(inputKeys).every(key => ownInputKeys.has(key))) {
        throw new Error('No inputs of other participants in the round.');
    }
};
