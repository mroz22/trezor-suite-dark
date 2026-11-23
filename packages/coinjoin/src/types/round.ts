import type { Logger } from '@trezor/logger';
import type { Network } from '@trezor/utxo-lib';

import type { AccountAddress } from './account';
import type { AliceShape, SerializedAlice } from './alice';
import type { CoinjoinRequest, CoinjoinRoundParameters, Round } from './coordinator';
import type { RawLiquidityClue } from './middleware';
import type { CoinjoinPrisonShape } from './prison';
import type { EndRoundState, RoundPhase, SessionPhase, WabiSabiProtocolErrorCode } from '../enums';

export type SessionPhaseEvent = {
    phase: SessionPhase;
    accountKeys: string[];
};

export interface CoinjoinRoundOptions {
    network: Network;
    signal: AbortSignal;
    coordinatorName: string;
    coordinatorUrl: string;
    middlewareUrl: string;
    minInputCount: number; // CoinjoinClientSettings.minInputCount or its network default.
    logger: Logger;
    setSessionPhase: (event: SessionPhaseEvent) => void;
}

// Payment output registered by this client, with the payment as it was at registration.
export type CoinjoinRoundPayment = {
    accountKey: string;
    paymentId: string;
    address: string;
    scriptPubKey: string;
    scriptPubKeyHex: string;
    amount: number;
    anchor: string;
};

// Payment output rejected by the coordinator. A rejection of the payee script or the amount blocks
// the payment: it is not included again in this session, and its anchor stays unspent until the
// wallet cancels the payment. Other rejections, for example WrongPhase, fail only this round.
export type CoinjoinRejectedPayment = {
    accountKey: string;
    paymentId: string;
    errorCode?: WabiSabiProtocolErrorCode;
    isBlocked: boolean;
};

export type SerializedCoinjoinRoundPayment = Pick<CoinjoinRoundPayment, 'accountKey' | 'paymentId'>;

/**
 * Signed attempt to make a payment. The payment is made when a transaction that spends `anchor`
 * confirms with an output paying exactly `amount` to `address`. `txid` identifies this attempt:
 * witnesses do not change it, because every input of a signed round is P2WPKH or P2TR (own
 * scripts are compared in verifyRoundInputs, inputs of others need a valid ownership proof).
 */
export type CoinjoinPaymentAttempt = {
    accountKey: string;
    paymentId: string;
    address: string;
    amount: number;
    anchor: string;
    txid: string;
    inputs: string[]; // Outpoints of the inputs of the account in the transaction.
};

// shape if src/client/CoinjoinRound.ts
export interface CoinjoinRoundShape {
    readonly prison: CoinjoinPrisonShape;
    id: string;
    blameOf: string;
    phase: RoundPhase;
    endRoundState: EndRoundState;
    coinjoinState: Round['CoinjoinState'];
    inputRegistrationEnd: string;
    amountCredentialIssuerParameters: Round['AmountCredentialIssuerParameters'];
    vsizeCredentialIssuerParameters: Round['VsizeCredentialIssuerParameters'];

    roundParameters: CoinjoinRoundParameters;
    inputs: AliceShape[]; // list of registered inputs
    failed: AliceShape[]; // list of failed inputs
    phaseDeadline: number; // deadline is inaccurate, phase may change earlier
    phaseStartLowerBound?: number; // safe lower bound (ms) for when the current phase started (see getSigningSendDeadline)
    roundDeadline: number; // deadline is inaccurate,round may end earlier
    commitmentData: string; // commitment data used for ownership proof and witness requests
    // List of addresses (outputs) used in this round in outputRegistration phase. Amount is the
    // least value the coinjoin transaction has to pay to the address for its credentials.
    addresses: (AccountAddress & { accountKey: string; amount: number })[];
    verifiedInputs?: string[]; // sorted outpoints (hash:index) of all inputs verified in outputRegistration phase
    blameOfOutpoints?: readonly string[]; // inputs of the signed transaction of the round this one is blame of
    transactionData?: CoinjoinTransactionData; // transaction to sign
    broadcastedTxDetails?: BroadcastedTransactionDetails; // transaction broadcasted
    liquidityClues?: CoinjoinTransactionLiquidityClue[]; // updated liquidity clues
    paymentAccountKeys: string[]; // accounts selected to pay in this round
    payments: CoinjoinRoundPayment[]; // payment outputs registered in this round
    rejectedPayments: CoinjoinRejectedPayment[]; // payment outputs rejected by the coordinator

    setSessionPhase(phase: SessionPhase): void;
    signedSuccessfully(): void;
    isSignedSuccessfully(): boolean;
}

export type CoinjoinRoundGenerator = (
    round: Round,
    prison: CoinjoinPrisonShape,
    options: CoinjoinRoundOptions,
) => CoinjoinRoundShape;

export interface SerializedCoinjoinRound {
    id: string;
    phase: RoundPhase;
    endRoundState: EndRoundState;
    inputs: SerializedAlice[]; // list of registered inputs
    failed: SerializedAlice[]; // list of failed inputs
    addresses: AccountAddress[]; // list of addresses (outputs) used in this round in outputRegistration phase
    phaseDeadline: number; // deadline is inaccurate, phase may change earlier
    roundDeadline: number; // deadline is inaccurate,round may end earlier
    broadcastedTxDetails?: BroadcastedTransactionDetails; // calculated from tx data and witnesses from coordinator
    payments: SerializedCoinjoinRoundPayment[]; // payment outputs registered in this round
    rejectedPayments: CoinjoinRejectedPayment[]; // payment outputs rejected by the coordinator
}

export interface CoinjoinRoundEvent {
    round: SerializedCoinjoinRound;
}

export interface CoinjoinTxInputs {
    path?: string;
    outpoint: string;
    amount: number;
    hash: string;
    index: number;
    commitmentData: string;
    address: string;
    scriptPubKey: string;
    ownershipProof: string;
}

export interface CoinjoinTxOutputs {
    path?: string;
    address: string;
    scriptPubKey: string;
    amount: number;
}

export interface CoinjoinTransactionData {
    inputs: CoinjoinTxInputs[];
    outputs: CoinjoinTxOutputs[];
    coinjoinRequest: CoinjoinRequest;
}

export interface BroadcastedTransactionDetails extends CoinjoinTransactionData {
    txid: string;
    hash: string;
    hex: string;
    size: number;
    vsize: number;
}

export interface CoinjoinTransactionLiquidityClue {
    accountKey: string;
    rawLiquidityClue: RawLiquidityClue;
}

export interface CoinjoinRequestOwnershipEvent {
    type: 'ownership';
    roundId: string;
    inputs: SerializedAlice[];
    commitmentData: string;
}

export interface CoinjoinRequestSignatureEvent {
    type: 'signature';
    roundId: string;
    inputs: SerializedAlice[];
    transaction: CoinjoinTransactionData;
    liquidityClues: CoinjoinTransactionLiquidityClue[];
    payments: CoinjoinPaymentAttempt[]; // to be stored before the transaction is signed
}

export type CoinjoinRequestEvent = CoinjoinRequestOwnershipEvent | CoinjoinRequestSignatureEvent;

export interface CoinjoinResponseOwnership {
    outpoint: string;
    ownershipProof: string;
}

export interface CoinjoinResponseWitness {
    outpoint: string;
    signature: string;
    index: number;
}

export interface CoinjoinResponseWithError {
    outpoint: string;
    error: string;
}

export interface CoinjoinResponseOwnershipEvent {
    type: 'ownership';
    roundId: string;
    inputs: (CoinjoinResponseOwnership | CoinjoinResponseWithError)[];
}

export interface CoinjoinResponseSignatureEvent {
    type: 'signature';
    roundId: string;
    inputs: (CoinjoinResponseWitness | CoinjoinResponseWithError)[];
}

export type CoinjoinResponseEvent = CoinjoinResponseOwnershipEvent | CoinjoinResponseSignatureEvent;
