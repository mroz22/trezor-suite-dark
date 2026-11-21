import { Strobe128 } from './strobe';
import type {
    AllowedRange,
    CoinjoinRoundCreatedEvent,
    IssuerParameter,
    Round,
    RoundScriptType,
} from '../types/coordinator';

// Round id as WalletWasabi computes it: WalletWasabi/WabiSabi/Crypto/RoundHasher.cs and the
// StrobeHasher of the WabiSabi library (both MIT). Each value is appended to a Strobe transcript
// with its label and length, the id is the uint256 of the final PRF output.

const PROTOCOL_LABEL = 'WabiSabi_v1.0';
const ROUND_DOMAIN = 'round-parameters';
// NBitcoin ScriptType names by value, WalletWasabi hashes the names.
const SCRIPT_TYPE_NAMES = [
    'Witness',
    'P2PKH',
    'P2SH',
    'P2PK',
    'P2WPKH',
    'P2WSH',
    'MultiSig',
    'Taproot',
];
// DateTimeOffset as .NET writes it to JSON, with an explicit offset.
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;
// TimeSpan as WalletWasabi writes it to JSON, in whole seconds.
const TIME_SPAN_PATTERN = /^(0|[1-9]\d*)d (1?\d|2[0-3])h ([1-5]?\d)m ([1-5]?\d)s$/;
// Compressed secp256k1 point.
const GROUP_ELEMENT_PATTERN = /^0[23][0-9a-f]{64}$/i;
const TICKS_PER_SECOND = 10_000_000n;
const TICKS_PER_MILLISECOND = 10_000n;
const SATOSHIS_PER_COIN = 100_000_000;

const readString = (value: string) => {
    if (typeof value !== 'string') throw new Error('Not a string');

    return value;
};

const toInt32 = (value: number) => {
    if (!Number.isSafeInteger(value)) throw new Error('Not an integer');

    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value); // throws outside of int32

    return buffer;
};

const toInt64 = (value: number | bigint) => {
    if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) {
        throw new Error('Not a safe integer');
    }

    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64LE(BigInt(value)); // throws outside of int64

    return buffer;
};

// DateTimeOffset.ToUnixTimeMilliseconds, Date.parse drops the digits below milliseconds as well.
const readUnixTimeMilliseconds = (dateTime: string) => {
    if (!DATE_TIME_PATTERN.test(readString(dateTime))) throw new Error('Invalid date');

    const milliseconds = Date.parse(dateTime);
    if (!Number.isSafeInteger(milliseconds)) throw new Error('Invalid date');

    return milliseconds;
};

const readTimeSpanTicks = (timeSpan: string) => {
    const match = TIME_SPAN_PATTERN.exec(readString(timeSpan));
    if (!match) throw new Error('Invalid time span');

    const [days = 0n, hours = 0n, minutes = 0n, seconds = 0n] = match.slice(1).map(BigInt);

    return (((days * 24n + hours) * 60n + minutes) * 60n + seconds) * TICKS_PER_SECOND;
};

// WalletWasabi hashes the decimal rate as (long)(rate * Money.COIN). A rate with more than 8
// decimal places is not what the coordinator hashed.
const readCoordinationFeeRateUnits = (rate: number) => {
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Invalid coordination fee rate');

    const units = Math.round(rate * SATOSHIS_PER_COIN);
    if (Math.abs(rate * SATOSHIS_PER_COIN - units) > 1e-6) {
        throw new Error('Invalid coordination fee rate');
    }

    return units;
};

// Names of an ImmutableSortedSet<ScriptType>, which holds each value once and in ascending order.
// Coordinators send the values, the names are accepted as well.
const readScriptTypeNames = (scriptTypes: RoundScriptType[]) => {
    let previousIndex = -1;

    return scriptTypes.map(scriptType => {
        const index =
            typeof scriptType === 'number' ? scriptType : SCRIPT_TYPE_NAMES.indexOf(scriptType);
        const name = SCRIPT_TYPE_NAMES[index];
        if (name === undefined || index <= previousIndex) throw new Error('Invalid script types');

        previousIndex = index;

        return name;
    });
};

const readGroupElement = (hex: string) => {
    if (!GROUP_ELEMENT_PATTERN.test(readString(hex))) throw new Error('Invalid group element');

    return Buffer.from(hex, 'hex');
};

// The first RoundCreated event, as getRoundParameters in roundUtils.ts reads it.
const readRoundParameters = ({ CoinjoinState }: Round) => {
    const roundCreated = CoinjoinState.Events.find(
        (event): event is CoinjoinRoundCreatedEvent => event.Type === 'RoundCreated',
    );
    if (!roundCreated) throw new Error('Missing round parameters');

    return roundCreated.RoundParameters;
};

/**
 * Round id as WalletWasabi computes it (RoundHasher.CalculateHash) from the values the coordinator
 * sent. The sent coordination fee rate and MaxSuggestedAmount are hashed, as coordinators before
 * WalletWasabi 2.2.0 and 2.8.5 hashed their values and newer ones send the values they hash.
 * Throws on values WalletWasabi does not send.
 */
export const getRoundId = (round: Round) => {
    const parameters = readRoundParameters(round);
    const strobe = new Strobe128(PROTOCOL_LABEL);

    const appendBytes = (label: string, value: Uint8Array) => {
        strobe.metaAd(Buffer.from(label, 'utf8'));
        strobe.metaAd(toInt32(value.length), true);
        strobe.ad(value);
    };
    const appendInt64 = (label: string, value: number | bigint) =>
        appendBytes(label, toInt64(value));
    // StrobeHasher appends ".Cw" to the label of a string value.
    const appendString = (label: string, value: string) =>
        appendBytes(`${label}.Cw`, Buffer.from(readString(value), 'utf8'));
    const appendRange = (label: string, { Min, Max }: AllowedRange) => {
        appendInt64(`${label}-min`, Min);
        appendInt64(`${label}-max`, Max);
    };
    const appendScriptTypes = (label: string, scriptTypes: RoundScriptType[]) =>
        readScriptTypeNames(scriptTypes).forEach((name, index) =>
            appendString(`${label}-${index}`, name),
        );
    const appendIssuerParameters = (label: string, { Cw, I }: IssuerParameter) => {
        appendBytes(`${label}.Cw`, readGroupElement(Cw));
        appendBytes(`${label}.I`, readGroupElement(I));
    };

    appendString('domain-separator', ROUND_DOMAIN);
    appendInt64('input-registration-start', readUnixTimeMilliseconds(round.InputRegistrationStart));
    appendInt64('input-registration-timeout', readTimeSpanTicks(round.InputRegistrationTimeout));
    appendInt64(
        'connection-confirmation-timeout',
        readTimeSpanTicks(parameters.ConnectionConfirmationTimeout),
    );
    appendInt64(
        'output-registration-timeout',
        readTimeSpanTicks(parameters.OutputRegistrationTimeout),
    );
    appendInt64(
        'transaction-signing-timeout',
        readTimeSpanTicks(parameters.TransactionSigningTimeout),
    );
    appendRange('allowed-input-amounts', parameters.AllowedInputAmounts);
    appendScriptTypes('allowed-input-types', parameters.AllowedInputTypes);
    appendRange('allowed-output-amounts', parameters.AllowedOutputAmounts);
    appendScriptTypes('allowed-output-types', parameters.AllowedOutputTypes);
    appendString('network', parameters.Network);
    appendInt64('fee-rate', parameters.MiningFeeRate);
    appendInt64(
        'coordination-fee-rate.Rate',
        readCoordinationFeeRateUnits(parameters.CoordinationFeeRate.Rate),
    );
    appendInt64(
        'coordination-fee-rate.PlebsDontPayThreshold',
        parameters.CoordinationFeeRate.PlebsDontPayThreshold,
    );
    appendBytes('max-transaction-size', toInt32(parameters.MaxTransactionSize));
    appendInt64('min-relay-tx-fee', parameters.MinRelayTxFee);
    appendInt64('maximum-amount-credential-value', parameters.MaxAmountCredentialValue);
    // Coordinators since WalletWasabi 2.8.0 do not send it and use MaxVsizeAllocationPerAlice.
    appendInt64(
        'maximum-vsize-credential-value',
        parameters.MaxVsizeCredentialValue ?? parameters.MaxVsizeAllocationPerAlice,
    );
    appendInt64('per-alice-vsize-allocation', parameters.MaxVsizeAllocationPerAlice);
    appendInt64('maximum-suggested-amount', parameters.MaxSuggestedAmount);
    appendString('coordination-identifier', parameters.CoordinationIdentifier);
    appendIssuerParameters(
        'amount-credential-issuer-parameters',
        round.AmountCredentialIssuerParameters,
    );
    appendIssuerParameters(
        'vsize-credential-issuer-parameters',
        round.VsizeCredentialIssuerParameters,
    );

    // NBitcoin uint256 keeps the bytes little-endian and prints them reversed.
    return Buffer.from(strobe.prf(32)).reverse().toString('hex');
};

/**
 * Whether the id of the round is the hash of its parameters, as WalletWasabi clients check since
 * 2.3.0 (RoundState.IsRoundIdMatching), and the round is of the coordinator with the given
 * identifier. All participants of a round commit to its id in their ownership proofs, so the
 * coordinator cannot serve some of them other parameters, such as other credential issuer keys.
 */
export const isRoundIdMatching = (round: Round, coordinatorName: string) => {
    try {
        return (
            readRoundParameters(round).CoordinationIdentifier === coordinatorName &&
            getRoundId(round) === round.Id
        );
    } catch {
        return false;
    }
};

/**
 * End of the input registration in milliseconds, as WalletWasabi derives it from hashed values
 * (RoundState.InputRegistrationEnd). Throws on values WalletWasabi does not send.
 */
export const getInputRegistrationEnd = ({
    InputRegistrationStart,
    InputRegistrationTimeout,
}: Pick<Round, 'InputRegistrationStart' | 'InputRegistrationTimeout'>) =>
    readUnixTimeMilliseconds(InputRegistrationStart) +
    Number(readTimeSpanTicks(InputRegistrationTimeout) / TICKS_PER_MILLISECOND);
