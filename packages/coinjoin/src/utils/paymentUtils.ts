import { type Network, address as baddress } from '@trezor/utxo-lib';

import {
    getInputFees,
    getInputSize,
    getMiningFee,
    getOutputSize,
    getScriptPubKeyFromAddress,
    prefixScriptPubKey,
} from './coordinatorUtils';
import { getRoundEvents } from './roundUtils';
import { COINJOIN_PAYMENT_MIN_AMOUNT, SIGNER_MIN_REGISTRABLE_OUTPUT_AMOUNT } from '../constants';
import { RoundPhase } from '../enums';
import type {
    AccountAddress,
    AccountPayment,
    AccountUtxo,
    CoinjoinPayment,
} from '../types/account';
import type {
    AllowedScriptTypes,
    CoinjoinRoundParameters,
    CoinjoinState,
    Round,
    RoundScriptType,
} from '../types/coordinator';
import type { CoinjoinRoundShape } from '../types/round';

type PaymentDestination = Pick<
    AccountPayment,
    'scriptType' | 'scriptPubKey' | 'scriptPubKeyHex' | 'outputSize'
>;

const getPaymentScriptType = (
    address: string,
    network: Network,
): AllowedScriptTypes | undefined => {
    const addressType = baddress.getAddressType(address, network);
    if (addressType === 'p2wpkh') return 'P2WPKH';
    if (addressType === 'p2tr') return 'Taproot';
};

// Payee script of a P2WPKH or P2TR address of the network. Every WalletWasabi coordinator accepts
// these output types.
export const getPaymentDestination = (
    address: string,
    network: Network,
): PaymentDestination | undefined => {
    const scriptType = getPaymentScriptType(address, network);
    if (!scriptType) return;

    try {
        const scriptPubKey = getScriptPubKeyFromAddress(address, network, scriptType);

        return {
            scriptType,
            scriptPubKey,
            scriptPubKeyHex: prefixScriptPubKey(scriptPubKey),
            outputSize: getOutputSize(scriptType),
        };
    } catch {
        // The address data do not form a valid script.
    }
};

type GetAccountPaymentParams = {
    payment: CoinjoinPayment | undefined;
    network: Network;
    utxos: AccountUtxo[];
    changeAddresses: AccountAddress[];
};

// Validated payment of the account, or nothing if the payment is invalid. Never throws, so that
// an invalid payment cannot stop the rest of the account update.
export const getAccountPayment = ({
    payment,
    network,
    utxos,
    changeAddresses,
}: GetAccountPaymentParams): AccountPayment | undefined => {
    if (!payment) return;

    const { id, address, amount, anchor, isCancelled } = payment;
    // The id is the only value of a payment that may be logged, so it must not contain the ~~
    // redaction marks.
    if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return;
    if (!Number.isSafeInteger(amount) || amount < COINJOIN_PAYMENT_MIN_AMOUNT) return;
    if (typeof anchor !== 'string' || !/^[0-9a-f]{72}$/i.test(anchor)) return;
    if (typeof address !== 'string') return;

    const destination = getPaymentDestination(address, network);
    if (!destination) return;

    const isOwnScript =
        changeAddresses.some(({ scriptPubKey }) => scriptPubKey === destination.scriptPubKey) ||
        utxos.some(({ scriptPubKey }) => scriptPubKey === destination.scriptPubKeyHex);
    if (isOwnScript) return;

    return { id, address, amount, anchor, isCancelled: isCancelled === true, ...destination };
};

type GetPendingPaymentParams = {
    payment?: AccountPayment;
    blockedPaymentIds: string[];
};

// Payment that should be made in the next round: present, not cancelled and not blocked.
export const getPendingPayment = ({ payment, blockedPaymentIds }: GetPendingPaymentParams) => {
    if (!payment || payment.isCancelled || blockedPaymentIds.includes(payment.id)) return;

    return payment;
};

// Payments registered in the round by accounts that still have inputs in it. An account whose
// output registration failed after its payment was registered keeps the payment in
// round.payments, but its inputs are failed and do not sign.
export const getSigningPayments = ({
    payments,
    inputs,
}: Pick<CoinjoinRoundShape, 'payments' | 'inputs'>) =>
    payments.filter(payment => inputs.some(input => input.accountKey === payment.accountKey));

// Amount Credential value of the payment output: the coordinator takes the mining fee for the
// output vsize from it, so the payee receives exactly the payment amount.
export const getPaymentCost = (payment: AccountPayment, miningFeeRate: number) =>
    payment.amount + getMiningFee(payment.outputSize, miningFeeRate);

// NBitcoin ScriptType values, which WalletWasabi coordinators send in AllowedInputTypes and
// AllowedOutputTypes.
const ROUND_SCRIPT_TYPE_VALUES: Record<AllowedScriptTypes, number> = { P2WPKH: 4, Taproot: 7 };

// Round script types are names or NBitcoin ScriptType values, depending on the coordinator.
const isScriptTypeAllowed = (allowedTypes: RoundScriptType[], scriptType: AllowedScriptTypes) =>
    allowedTypes.some(
        allowedType =>
            allowedType === scriptType || allowedType === ROUND_SCRIPT_TYPE_VALUES[scriptType],
    );

export const canIncludePayment = (
    payment: AccountPayment,
    accountScriptType: AllowedScriptTypes,
    roundParameters: CoinjoinRoundParameters,
) => {
    const { AllowedInputTypes, AllowedOutputTypes, AllowedOutputAmounts } = roundParameters;

    return (
        isScriptTypeAllowed(AllowedInputTypes, accountScriptType) &&
        isScriptTypeAllowed(AllowedOutputTypes, payment.scriptType) &&
        payment.amount >= AllowedOutputAmounts.Min &&
        payment.amount <= AllowedOutputAmounts.Max &&
        getPaymentCost(payment, roundParameters.MiningFeeRate) <=
            roundParameters.MaxAmountCredentialValue
    );
};

// Amount Credential value of an input that is not registered yet. It is a lower bound: whether the
// coordinator charges the coordination fee (not for remixed inputs) is known only after the
// registration, so the fee is assumed.
export const getInputEffectiveValue = (
    amount: number,
    scriptType: AllowedScriptTypes,
    roundParameters: CoinjoinRoundParameters,
) => {
    const { coordinatorFee, miningFee } = getInputFees({
        amount,
        inputSize: getInputSize(scriptType),
        roundParameters,
        isPayingZeroCoordinationFee: false,
    });

    return amount - coordinatorFee - miningFee;
};

// Limits of what may remain after the payment is reserved from the registered amount:
// - up to `maxDust` may be left as a fee, the signer accepts it as an extra fee,
// - from `minChange` the remainder is enough for a change output.
export const getRemainderLimits = (
    roundParameters: CoinjoinRoundParameters,
    changeVsize: number,
) => {
    const changeFee = getMiningFee(changeVsize, roundParameters.MiningFeeRate);
    const minRegistrableAmount = Math.min(
        roundParameters.AllowedInputAmounts.Min,
        SIGNER_MIN_REGISTRABLE_OUTPUT_AMOUNT,
    );

    return {
        maxDust: minRegistrableAmount + changeFee,
        minChange: roundParameters.AllowedOutputAmounts.Min + changeFee,
    };
};

// Amounts left after `reservedAmount` is taken from the largest amounts first, with the unused
// part of the last taken amount, as WalletWasabi PaymentAwareOutputProvider does.
export const getRemainingAmounts = (amounts: number[], reservedAmount: number) => {
    const sorted = amounts.toSorted((a, b) => b - a);
    let reserved = 0;
    let takenCount = 0;
    while (reserved < reservedAmount && takenCount < sorted.length) {
        reserved += sorted[takenCount] ?? 0;
        takenCount++;
    }

    const unused = reserved - reservedAmount;

    return unused > 0 ? [...sorted.slice(takenCount), unused] : sorted.slice(takenCount);
};

const getScriptHex = (scriptPubKey: string) => {
    try {
        return prefixScriptPubKey(scriptPubKey);
    } catch {
        // Unknown script format, it cannot be compared.
    }
};

const getStateScripts = (coinjoinState: CoinjoinState, withOutputs: boolean) => {
    const inputScripts = getRoundEvents('InputAdded', coinjoinState.Events).map(
        ({ Coin }) => Coin.TxOut.ScriptPubKey,
    );
    const outputScripts = withOutputs
        ? getRoundEvents('OutputAdded', coinjoinState.Events).map(
              ({ Output }) => Output.ScriptPubKey,
          )
        : [];

    return inputScripts.concat(outputScripts).flatMap(script => getScriptHex(script) ?? []);
};

// Scripts the coordinator would reject as AlreadyRegisteredScript: inputs of every round and
// outputs of rounds that did not end yet.
export const getRegisteredScripts = (rounds: Round[]) =>
    new Set(
        rounds.flatMap(round =>
            getStateScripts(round.CoinjoinState, round.Phase !== RoundPhase.Ended),
        ),
    );

export const isScriptInRound = (coinjoinState: CoinjoinState, scriptPubKeyHex: string) =>
    getStateScripts(coinjoinState, true).includes(scriptPubKeyHex);
