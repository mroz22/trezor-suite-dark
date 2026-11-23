import { MessagesSchema as PROTO } from '@trezor/protobuf';
import type { Static } from '@trezor/schema-utils';
import { Type } from '@trezor/schema-utils';

import { CoinSymbolParam } from '../../coinInfo';
import type { Params, Response } from '../../params';
import { DerivationPath } from '../../params';

// Suite Dark: a payment made as an output of a coinjoin round, Firmware Dark only
// (Capability_CoinJoinPayment). The device credits it only in transactions spending `anchor`,
// an outpoint of the account (`prevHash` is the txid as displayed), so at most one of them can confirm.
export type AuthorizeCoinjoinPayment = Static<typeof AuthorizeCoinjoinPayment>;
export const AuthorizeCoinjoinPayment = Type.Object({
    address: Type.String(),
    amount: Type.Uint(),
    anchor: Type.Object({
        prevHash: Type.String(),
        prevIndex: Type.Number(),
    }),
});

export type AuthorizeCoinjoin = Static<typeof AuthorizeCoinjoin>;
export const AuthorizeCoinjoin = Type.Object({
    path: DerivationPath,
    coordinator: Type.String(),
    maxRounds: Type.Number(),
    maxCoordinatorFeeRate: Type.Number(),
    maxFeePerKvbyte: Type.Number(),
    coin: Type.Optional(CoinSymbolParam()),
    scriptType: Type.Optional(PROTO.InternalInputScriptType),
    amountUnit: Type.Optional(PROTO.EnumAmountUnit),
    preauthorized: Type.Optional(Type.Boolean()),
    payment: Type.Optional(AuthorizeCoinjoinPayment),
});

export declare function authorizeCoinjoin(
    params: Params<AuthorizeCoinjoin>,
): Response<PROTO.Success>;
