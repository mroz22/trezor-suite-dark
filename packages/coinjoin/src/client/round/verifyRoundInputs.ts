import type { CoinjoinInput } from '../../types/coordinator';
import type { CoinjoinRoundOptions, CoinjoinRoundShape } from '../../types/round';
import { prefixScriptPubKey, readOutpoint } from '../../utils/coordinatorUtils';
import { type OwnershipProofVerification, verifyOwnershipProof } from '../../utils/ownershipProof';
import { getRoundEvents } from '../../utils/roundUtils';
import { CoordinatorMisbehaviorError } from '../coordinator';

// 32 bytes of the transaction hash and 4 bytes of the output index.
const OUTPOINT_PATTERN = /^[0-9a-f]{72}$/i;

// Round.BlameOf of a round which is not a blame round.
const NO_BLAME_OF = '0'.repeat(64);

// Coordinator outpoints are uppercase and own outpoints lowercase, compare the parsed values.
const getOutpointKey = (outpoint: string) => {
    if (!OUTPOINT_PATTERN.test(outpoint)) return;

    const { hash, index } = readOutpoint(outpoint);

    return `${hash}:${index}`;
};

// Coordinator scripts are in the NBitcoin text format, own scripts in hex.
const getScriptPubKey = (coordinatorScriptPubKey: string) => {
    try {
        return prefixScriptPubKey(coordinatorScriptPubKey);
    } catch {
        // Not a script at all.
    }
};

/**
 * Checks the inputs of the round announced by the coordinator. Called before the outputs are
 * registered, so the coordinator does not learn them in a round which is refused, and again
 * before the transaction is signed.
 * Throws CoordinatorMisbehaviorError if the coordinator provably lies and a plain Error if the
 * round has no inputs of other participants or ownership proofs which the device refuses although
 * their owners signed them for the round, or if it is a blame round without known inputs of the
 * failed round. Returns the sorted outpoints (hash:index) of all inputs of the round.
 */
export const verifyRoundInputs = (
    round: Pick<
        CoinjoinRoundShape,
        'inputs' | 'coinjoinState' | 'commitmentData' | 'blameOf' | 'blameOfOutpoints'
    >,
    { minInputCount, logger }: Pick<CoinjoinRoundOptions, 'minInputCount' | 'logger'>,
): string[] => {
    const registeredInputs = getRoundEvents('InputAdded', round.coinjoinState.Events);
    const registeredCoins = new Map<string, CoinjoinInput>();
    const invalidInputs = registeredInputs.filter(({ Coin }) => {
        const key = getOutpointKey(Coin.Outpoint);
        if (!key || registeredCoins.has(key)) return true;

        registeredCoins.set(key, Coin);

        return false;
    });

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
                getScriptPubKey(coin.TxOut.ScriptPubKey) !== scriptPubKey
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

    // As WalletWasabi CoinJoinClient (BlameRoundRestrictions): an honest coordinator lets into a
    // blame round only inputs of the failed round (Arena.EndRoundAndTryCreateBlameRoundAsync), all
    // of them in the transaction this client signed there. Otherwise the coordinator could fill the
    // blame round with fresh inputs of its own and isolate this client.
    if (round.blameOf !== NO_BLAME_OF) {
        const { blameOfOutpoints } = round;
        if (!blameOfOutpoints) {
            // Not expected: selectRound joins a blame round only with them.
            throw new Error('Inputs of the failed round are unknown.');
        }

        const failedRoundInputKeys = new Set(
            blameOfOutpoints.map(outpoint => getOutpointKey(outpoint)),
        );
        const unexpectedOutpoints = registeredInputs
            .map(({ Coin }) => Coin.Outpoint)
            .filter(outpoint => !failedRoundInputKeys.has(getOutpointKey(outpoint)));
        const [unexpectedOutpoint] = unexpectedOutpoints;
        if (unexpectedOutpoint) {
            logger.warn(
                `Input ~~${unexpectedOutpoint}~~ and ${unexpectedOutpoints.length - 1} other inputs of the blame round were not in the failed round`,
            );
            throw new CoordinatorMisbehaviorError(
                `Inconsistent data. ${unexpectedOutpoints.length} inputs of the blame round were not in the failed round.`,
            );
        }
    }

    // As WalletWasabi MultipartyTransactionState.VerifyOwnershipProofs: only the owner of a coin can
    // prove it for this round (the commitment data holds the coordinator name and the round id), so
    // the coordinator cannot fill the round with coins of others which did not register in it. The
    // device checks the proofs as well, but only when it signs, after the outputs are registered.
    const outpointsByProof: Record<OwnershipProofVerification, string[]> = {
        valid: [],
        unsupported: [],
        invalid: [],
    };
    registeredInputs.forEach(({ Coin, OwnershipProof }) => {
        if (ownInputKeys.has(getOutpointKey(Coin.Outpoint))) return;

        const scriptPubKey = getScriptPubKey(Coin.TxOut.ScriptPubKey);
        const proofVerification = scriptPubKey
            ? verifyOwnershipProof({
                  ownershipProof: OwnershipProof,
                  scriptPubKey,
                  commitmentData: round.commitmentData,
              })
            : 'invalid';
        outpointsByProof[proofVerification].push(Coin.Outpoint);
    });

    const [invalidProofOutpoint] = outpointsByProof.invalid;
    if (invalidProofOutpoint) {
        logger.warn(
            `Invalid ownership proof of ~~${invalidProofOutpoint}~~ and ${outpointsByProof.invalid.length - 1} other inputs`,
        );
        throw new CoordinatorMisbehaviorError(
            `Inconsistent data. ${outpointsByProof.invalid.length} inputs of other participants with an invalid ownership proof.`,
        );
    }

    // Not a lie, another participant may register such a proof (see verifyOwnershipProof). Refused
    // before the outputs are registered, as the device would refuse to sign.
    const [unsupportedProofOutpoint] = outpointsByProof.unsupported;
    if (unsupportedProofOutpoint) {
        logger.warn(
            `Unsupported ownership proof of ~~${unsupportedProofOutpoint}~~ and ${outpointsByProof.unsupported.length - 1} other inputs`,
        );
        throw new Error(
            `${outpointsByProof.unsupported.length} inputs of other participants with an ownership proof which the device refuses.`,
        );
    }

    return Array.from(registeredCoins.keys()).toSorted();
};
