import { type Network } from '@trezor/utxo-lib';

import { type RegisterAccountParams } from '../types';
import { type AccountAddress, type AccountPayment, type AccountUtxo } from '../types/account';
import { type AllowedScriptTypes, type Round } from '../types/coordinator';
import { type RawLiquidityClue } from '../types/middleware';
import { getScriptPubKeyFromAddress, prefixScriptPubKey } from '../utils/coordinatorUtils';
import { getAccountPayment } from '../utils/paymentUtils';
import { compareOutpoint, getRoundEvents } from '../utils/roundUtils';

const enhanceAccountUtxo = (
    utxos: Omit<AccountUtxo, 'scriptPubKey'>[],
    network: Network,
    scriptType: AllowedScriptTypes,
): AccountUtxo[] =>
    utxos.map(({ path, address, outpoint, amount, anonymityLevel }) => ({
        path,
        address,
        scriptPubKey: prefixScriptPubKey(
            getScriptPubKeyFromAddress(address, network, scriptType),
            true,
        ),
        outpoint,
        amount,
        anonymityLevel,
    }));

const enhanceAccountAddresses = (
    addresses: Omit<AccountAddress, 'scriptPubKey'>[],
    network: Network,
    scriptType: AllowedScriptTypes,
): AccountAddress[] =>
    addresses.map(({ path, address }) => ({
        path,
        address,
        scriptPubKey: getScriptPubKeyFromAddress(address, network, scriptType),
    }));

export class Account {
    accountKey: string;
    scriptType: AllowedScriptTypes;
    network: Network;
    utxos: AccountUtxo[];
    changeAddresses: AccountAddress[];
    targetAnonymity: number;
    maxFeePerKvbyte: number;
    maxCoordinatorFeeRate: number;
    maxRounds: number;
    skipRounds?: [number, number];
    skipRoundCounter = 0;
    rawLiquidityClue: RawLiquidityClue;
    payment?: AccountPayment; // Undefined if the account has no valid payment.
    // Payments that must not be made again in this session: their payee or amount was rejected by
    // the coordinator, or they were already broadcast. The anchor of a blocked payment is held back
    // until the wallet cancels the payment. The array is shared with copies of the account, never
    // replace it.
    readonly blockedPaymentIds: string[] = [];

    constructor(account: RegisterAccountParams, network: Network) {
        this.accountKey = account.accountKey;
        this.network = network;
        this.scriptType = account.scriptType;
        this.utxos = enhanceAccountUtxo(account.utxos, network, account.scriptType);
        this.changeAddresses = enhanceAccountAddresses(
            account.changeAddresses,
            network,
            account.scriptType,
        );
        this.targetAnonymity = account.targetAnonymity;
        this.rawLiquidityClue = account.rawLiquidityClue;
        this.maxFeePerKvbyte = account.maxFeePerKvbyte;
        this.maxCoordinatorFeeRate = account.maxCoordinatorFeeRate;
        this.maxRounds = account.maxRounds;
        this.skipRounds = account.skipRounds;
        this.payment = getAccountPayment({
            payment: account.payment,
            network,
            utxos: this.utxos,
            changeAddresses: this.changeAddresses,
        });
    }

    // find inputs/outputs already registered in Round(s)
    findDetainedElements(rounds: Round[]) {
        const { accountKey } = this;

        return rounds.flatMap(round => {
            if (round.Phase > 0) {
                const registeredInputs = getRoundEvents('InputAdded', round.CoinjoinState.Events);
                const registeredOutputs = getRoundEvents('OutputAdded', round.CoinjoinState.Events);
                const inputs = registeredInputs
                    .flatMap(
                        ({ Coin }) =>
                            this.utxos.find(a => compareOutpoint(a.outpoint, Coin.Outpoint)) ?? [],
                    )
                    .map(input => ({ accountKey, ...input }));

                const outputs = registeredOutputs
                    .flatMap(
                        ({ Output }) =>
                            this.changeAddresses.find(
                                o => Output.ScriptPubKey === o.scriptPubKey,
                            ) ?? [],
                    )
                    .map(output => ({ accountKey, roundId: round.Id, ...output }));

                return [...inputs, ...outputs];
            }

            return [];
        });
    }

    update(account: RegisterAccountParams) {
        this.utxos = enhanceAccountUtxo(account.utxos, this.network, account.scriptType);
        this.changeAddresses = enhanceAccountAddresses(
            account.changeAddresses,
            this.network,
            account.scriptType,
        );
        this.targetAnonymity = account.targetAnonymity;
        this.payment = getAccountPayment({
            payment: account.payment,
            network: this.network,
            utxos: this.utxos,
            changeAddresses: this.changeAddresses,
        });
    }

    updateRawLiquidityClue(value: RawLiquidityClue) {
        this.rawLiquidityClue = value;
    }
}
