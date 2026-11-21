import type { CoinjoinInput } from '../../types/coordinator';
import type { CoinjoinRoundOptions, CoinjoinRoundShape } from '../../types/round';
import { prefixScriptPubKey, readOutpoint } from '../../utils/coordinatorUtils';
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

// Coordinator scripts are in the NBitcoin text format, own scripts in hex, compare the bytes.
const isSameScriptPubKey = (coordinatorScriptPubKey: string, scriptPubKey: string) => {
    try {
        return prefixScriptPubKey(coordinatorScriptPubKey) === scriptPubKey;
    } catch {
        // Not a script at all.
        return false;
    }
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
    const registeredCoins = new Map<string, CoinjoinInput>();
    const invalidInputs = getRoundEvents('InputAdded', round.coinjoinState.Events).filter(
        ({ Coin }) => {
            const key = getOutpointKey(Coin.Outpoint);
            if (!key || registeredCoins.has(key)) return true;

            registeredCoins.set(key, Coin);

            return false;
        },
    );

    if (invalidInputs.length > 0) {
        throw new CoordinatorMisbehaviorError(
            `Inconsistent data. ${invalidInputs.length} duplicate or malformed registered inputs.`,
        );
    }

    // The coordinator adds an input to the round when it issues its confirmed credentials, so
    // every own input with them is there with the amount and script of its utxo (as checked by
    // WalletWasabi CoinJoinClient.cs, CoordinatorLiedAboutInputs). An input which did not confirm
    // its connection in time is removed from the round without a lie. outputDecomposition refuses
    // it with a plain Error, so every own input has confirmed credentials when it is signed.
    const changedOwnInputs = round.inputs.filter(
        ({ outpoint, amount, scriptPubKey, confirmedAmountCredentials }) => {
            if (!confirmedAmountCredentials) return false;

            const key = getOutpointKey(outpoint);
            const coin = key === undefined ? undefined : registeredCoins.get(key);
            if (!coin) return true;

            return (
                coin.TxOut.Value !== amount ||
                !isSameScriptPubKey(coin.TxOut.ScriptPubKey, scriptPubKey)
            );
        },
    );

    if (changedOwnInputs.length > 0) {
        throw new CoordinatorMisbehaviorError(
            `Inconsistent data. ${changedOwnInputs.length} own inputs missing or registered with a different amount or script.`,
        );
    }

    // The round was selected only with MinInputCountByRound of at least minInputCount (see
    // getRoundCandidates) and the coordinator ends a round with fewer inputs before the outputs
    // are registered.
    if (registeredCoins.size < minInputCount) {
        throw new CoordinatorMisbehaviorError(
            `Inconsistent data. Round has ${registeredCoins.size} registered inputs but minimum required is ${minInputCount}.`,
        );
    }

    // Stricter than WalletWasabi isItForbiddenSoloCoinjoining, which counts as own only the inputs
    // of one wallet (CoinJoinTrackerFactory.cs creates a client per wallet): inputs of all accounts
    // of this client count as own. Not a lie, the round may be filled by own inputs only.
    const ownInputKeys = new Set(round.inputs.map(({ outpoint }) => getOutpointKey(outpoint)));
    if (Array.from(registeredCoins.keys()).every(key => ownInputKeys.has(key))) {
        throw new Error('No inputs of other participants in the round.');
    }
};
