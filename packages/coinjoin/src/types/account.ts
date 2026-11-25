import { type AllowedScriptTypes } from './coordinator';
import { type RawLiquidityClue } from './middleware';

export type RegisterAccountParams = {
    accountKey: string;
    scriptType: AllowedScriptTypes;
    utxos: Omit<AccountUtxo, 'scriptPubKey'>[];
    changeAddresses: Omit<AccountAddress, 'scriptPubKey'>[];
    targetAnonymity: number;
    rawLiquidityClue: RawLiquidityClue;
    maxFeePerKvbyte: number;
    maxCoordinatorFeeRate: number;
    maxRounds: number;
    skipRounds?: [number, number];
    payment?: CoinjoinPayment;
};

/**
 * Payment to a third party, made as an output of a coinjoin round funded by private coins of the
 * account. Every transaction that carries the payment spends `anchor`, so at most one of them can
 * ever confirm. A signer that supports coinjoin payments credits the payment only in a
 * transaction that spends the anchor.
 *
 * The client holds back and mixes only the anchor of the payment it is given. So once an attempt
 * may have been signed, the wallet keeps passing the payment until its anchor is spent, also after
 * the coordinator rejected it, and sets `isCancelled` when the payment is no longer wanted. Until
 * then a new or edited payment reuses the same anchor; a payment with another anchor could confirm
 * next to an earlier attempt. Once a transaction that spends the anchor without the payment
 * confirms, no attempt can confirm any more and the payment may get a new anchor.
 */
export type CoinjoinPayment = {
    // Opaque id assigned by the wallet, up to 64 letters, digits, `_` or `-`. The only value of
    // a payment that may be logged.
    id: string;
    // P2WPKH or P2TR address of the payee.
    address: string;
    // Exact amount in satoshis that the payee receives.
    amount: number;
    // Outpoint of one of the coins that fund the payment, in the AccountUtxo.outpoint format.
    anchor: string;
    // The payment is no longer made. The anchor is mixed without it in a later round, which
    // invalidates earlier attempts.
    isCancelled?: boolean;
};

export type AccountPayment = CoinjoinPayment & {
    scriptType: AllowedScriptTypes;
    scriptPubKey: string; // WabiSabi format, sent in output registration.
    scriptPubKeyHex: string; // Script bytes in hex, used in every comparison.
    outputSize: number;
};

export interface AccountUtxo {
    path: string;
    outpoint: string;
    address: string;
    scriptPubKey: string;
    amount: number;
    anonymityLevel: number | undefined;
}

export interface AccountAddress {
    path: string;
    address: string;
    scriptPubKey: string;
}
