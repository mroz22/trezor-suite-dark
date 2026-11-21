import type { ImmediateId, TimerId } from '@trezor/type-utils';
import { TypedEmitter } from '@trezor/utils';

import { WabiSabiProtocolErrorCode } from '../enums';
import type {
    CoinjoinPrisonEvents,
    CoinjoinPrisonInmate,
    CoinjoinPrisonShape,
    IsReusableOutputParams,
    RecyclableOutputsParams,
    RecycleOutputsParams,
} from '../types/prison';

export type DetainObject =
    | {
          outpoint: string;
          accountKey: string;
      }
    | {
          address: string;
          accountKey: string;
      }
    | {
          accountKey: string;
      };

export interface DetainOptions {
    roundId?: string;
    errorCode?: CoinjoinPrisonInmate['errorCode'];
    reason?: CoinjoinPrisonInmate['reason'];
    sentenceEnd?: number;
}

const isRecyclableOutput = (inmate: CoinjoinPrisonInmate, accountKey: string) =>
    inmate.errorCode === 'registeredOutput' && inmate.accountKey === accountKey;

// Errored or currently registered inputs and addresses are sent here
// inspiration: WalletWasabi/WabiSabi/Backend/Banning/Prison.cs

export class CoinjoinPrison
    extends TypedEmitter<CoinjoinPrisonEvents>
    implements CoinjoinPrisonShape
{
    inmates: CoinjoinPrisonInmate[] = [];
    // Inputs of the transactions signed in rounds which ended with NotAllAlicesSign, by round id.
    // Their blame rounds may contain only these. Kept apart from the inmates, so they are neither
    // emitted nor persisted and a blame round after a restart is refused.
    private blameOfOutpoints = new Map<string, readonly string[]>();
    private changeEventThrottle: ImmediateId | TimerId | undefined;

    constructor(initialState: CoinjoinPrisonInmate[] = []) {
        super();
        this.inmates = initialState;
    }

    private dispatchChange() {
        // throttle change events. might be emitted one after another (example: multiple detentions in loop after round end)
        const emitFn = () => {
            this.changeEventThrottle = undefined;
            this.emit('change', { prison: this.inmates });
        };

        if (typeof setImmediate !== 'undefined') {
            clearImmediate(this.changeEventThrottle as NodeJS.Immediate);
            this.changeEventThrottle = setImmediate(emitFn);
        } else {
            clearTimeout(this.changeEventThrottle as NodeJS.Timeout);
            this.changeEventThrottle = setTimeout(emitFn, 0);
        }
    }

    detain(inmate: DetainObject, options: DetainOptions = {}) {
        const sentenceStart = Date.now();
        const sentenceEnd = Date.now() + (options.sentenceEnd ? options.sentenceEnd : 6 * 60000);

        let id: string;
        let type: CoinjoinPrisonInmate['type'];
        if ('outpoint' in inmate) {
            type = 'input';
            id = inmate.outpoint;
        } else if ('address' in inmate) {
            type = 'output';
            id = inmate.address;
        } else {
            type = 'account';
            id = inmate.accountKey;
        }

        this.inmates = this.inmates
            .filter(i => i.id !== id)
            .concat({
                id,
                type,
                accountKey: inmate.accountKey,
                sentenceEnd,
                sentenceStart,
                errorCode: options.errorCode,
                reason: options.reason,
                roundId: options.roundId,
            });

        this.dispatchChange();
    }

    isDetained(inmate: string | DetainObject) {
        let id: string;
        if (typeof inmate === 'string') {
            id = inmate;
        } else if ('outpoint' in inmate) {
            id = inmate.outpoint;
        } else if ('address' in inmate) {
            id = inmate.address;
        } else {
            id = inmate.accountKey;
        }

        return this.inmates.find(i => i.id === id);
    }

    detainForBlameRound(inmates: DetainObject[], roundId: string, roundOutpoints: string[]) {
        this.blameOfOutpoints.set(roundId, roundOutpoints);
        inmates.forEach(inmate => {
            this.detain(inmate, {
                errorCode: 'blameOf',
                roundId,
            });
        });
    }

    // Output the client sent to the coordinator in the round, even if the request failed. It stays
    // detained after the round: only a blame round of the round may register it again
    // (isReusableOutput), and recycleOutputs releases it once the account runs out of change
    // addresses. Outputs of a signed transaction the coordinator broadcast, or may still broadcast,
    // get another errorCode in endedRound, so neither applies to them.
    detainRegisteredOutput(output: Extract<DetainObject, { address: string }>, roundId: string) {
        this.detain(output, { roundId, errorCode: 'registeredOutput', sentenceEnd: Infinity });
    }

    isReusableOutput({ address, accountKey, roundId }: IsReusableOutputParams) {
        const inmate = this.isDetained(address);

        return (
            inmate?.errorCode === 'registeredOutput' &&
            inmate.accountKey === accountKey &&
            inmate.roundId === roundId
        );
    }

    // Rounds with outputs of the account among the given addresses, oldest first. Rounds listed in
    // the status are left out, they may still run or the wallet may not know their transaction yet.
    private getRecyclableRounds({
        accountKey,
        addresses,
        statusRoundIds,
    }: RecyclableOutputsParams) {
        const givenAddresses = new Set(addresses);
        const keptRoundIds = new Set(statusRoundIds);
        const rounds = new Map<string, { sentenceStart: number; addressCount: number }>();
        this.inmates.forEach(inmate => {
            const { roundId } = inmate;
            if (
                !isRecyclableOutput(inmate, accountKey) ||
                !roundId ||
                keptRoundIds.has(roundId) ||
                !givenAddresses.has(inmate.id)
            ) {
                return;
            }

            const round = rounds.get(roundId);
            rounds.set(roundId, {
                sentenceStart: Math.min(round?.sentenceStart ?? Infinity, inmate.sentenceStart),
                addressCount: (round?.addressCount ?? 0) + 1,
            });
        });

        return Array.from(rounds).sort(([, a], [, b]) => a.sentenceStart - b.sentenceStart);
    }

    getRecyclableOutputCount(params: RecyclableOutputsParams) {
        return this.getRecyclableRounds(params).reduce(
            (sum, [, { addressCount }]) => sum + addressCount,
            0,
        );
    }

    // Releases the outputs the account registered in its oldest rounds, all of a round together,
    // until at least `count` of the given addresses are free. Releases none if even all
    // recyclable ones are fewer than `count`.
    recycleOutputs({ count, ...params }: RecycleOutputsParams) {
        const { accountKey } = params;
        const recycledRoundIds = new Set<string>();
        let addressCount = 0;
        this.getRecyclableRounds(params).forEach(([roundId, round]) => {
            if (addressCount >= count) return;

            recycledRoundIds.add(roundId);
            addressCount += round.addressCount;
        });

        if (recycledRoundIds.size === 0 || addressCount < count) {
            return { addressCount: 0, roundCount: 0 };
        }

        this.inmates = this.inmates.filter(
            inmate =>
                !isRecyclableOutput(inmate, accountKey) ||
                !inmate.roundId ||
                !recycledRoundIds.has(inmate.roundId),
        );
        this.dispatchChange();

        return { addressCount, roundCount: recycledRoundIds.size };
    }

    getBlameOfInmates() {
        return this.inmates.filter(i => i.errorCode === 'blameOf');
    }

    getBlameOfOutpoints(roundId: string) {
        return this.blameOfOutpoints.get(roundId);
    }

    releaseBlameOfInmates(roundId: string) {
        this.blameOfOutpoints.delete(roundId);
        // Outputs registered in the round stay, see detainRegisteredOutput.
        this.inmates = this.inmates.filter(
            inmate => inmate.roundId !== roundId || inmate.sentenceEnd === Infinity,
        );

        this.dispatchChange();
    }

    // release inputs detained by successful input-registration
    releaseRegisteredInmates(roundId: string) {
        this.inmates = this.inmates.filter(
            inmate =>
                !(
                    inmate.roundId === roundId &&
                    inmate.errorCode === WabiSabiProtocolErrorCode.AliceAlreadyRegistered
                ),
        );

        this.dispatchChange();
    }

    // called on each status change before rounds are processed
    release(rounds: string[]) {
        const now = Date.now();
        const prevLen = this.inmates.length;

        this.blameOfOutpoints.forEach((_, roundId) => {
            if (!rounds.includes(roundId)) this.blameOfOutpoints.delete(roundId);
        });

        this.inmates = this.inmates.filter(inmate => {
            if (inmate.sentenceEnd !== Infinity && inmate.roundId) {
                // release inmates assigned to Round which is no longer present in Status
                // regardless of their sentenceEnd
                if (!rounds.includes(inmate.roundId)) return false;
            }

            return inmate.sentenceEnd > now;
        });

        if (prevLen !== this.inmates.length) {
            this.dispatchChange();
        }
    }
}
