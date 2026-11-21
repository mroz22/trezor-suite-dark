import type { WabiSabiProtocolErrorCode } from '../enums';

export interface CoinjoinPrisonEvents {
    change: { prison: CoinjoinPrisonInmate[] };
}

export interface CoinjoinPrisonInmate {
    type: 'input' | 'output' | 'account';
    accountKey: string;
    id: string; // AccountUtxo/Alice.outpoint or AccountAddress scriptPubKey or Account key
    sentenceStart: number;
    sentenceEnd: number;
    // 'registeredOutput': output registered in round roundId, see detainRegisteredOutput.
    errorCode?: WabiSabiProtocolErrorCode | 'blameOf' | 'registeredOutput';
    reason?: string;
    roundId?: string;
}

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

export interface IsReusableOutputParams {
    address: string;
    accountKey: string;
    roundId: string;
}

export interface RecyclableOutputsParams {
    accountKey: string;
    addresses: string[];
    // Ids of the rounds listed in the status, their outputs are not recycled.
    statusRoundIds: string[];
}

export interface RecycleOutputsParams extends RecyclableOutputsParams {
    count: number;
}

// shape if src/client/CoinjoinPrison.ts
export interface CoinjoinPrisonShape {
    inmates: CoinjoinPrisonInmate[];
    detain(inmate: DetainObject, options?: DetainOptions): void;
    isDetained(inmate: string | DetainObject): CoinjoinPrisonInmate | undefined;
    detainForBlameRound(inmates: DetainObject[], roundId: string, roundOutpoints: string[]): void;
    detainRegisteredOutput(
        output: Extract<DetainObject, { address: string }>,
        roundId: string,
    ): void;
    isReusableOutput(params: IsReusableOutputParams): boolean;
    getRecyclableOutputCount(params: RecyclableOutputsParams): number;
    recycleOutputs(params: RecycleOutputsParams): { addressCount: number; roundCount: number };
    getBlameOfInmates(): CoinjoinPrisonInmate[];
    getBlameOfOutpoints(roundId: string): readonly string[] | undefined;
    releaseBlameOfInmates(roundId: string): void;
    releaseRegisteredInmates(roundId: string): void;
    release(rounds: string[]): void;
}
