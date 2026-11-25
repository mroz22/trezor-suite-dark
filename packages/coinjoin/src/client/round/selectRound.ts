import type { Logger } from '@trezor/logger';
import { arrayPartition, arrayToDictionary } from '@trezor/utils';

import {
    COINJOIN_PAYMENT_MAX_INPUTS,
    ROUND_MIN_OUTPUT_AMOUNT_SANITY,
    ROUND_SELECTION_MAX_OUTPUTS,
    ROUND_SELECTION_REGISTRATION_OFFSET,
} from '../../constants';
import { RoundPhase, SessionPhase, WabiSabiProtocolErrorCode } from '../../enums';
import type { AccountPayment, AccountUtxo } from '../../types/account';
import type { AliceGenerator, AliceShape } from '../../types/alice';
import type { AllowedScriptTypes, CoinjoinRoundParameters } from '../../types/coordinator';
import type { CoinjoinPrisonShape } from '../../types/prison';
import type {
    CoinjoinRoundGenerator,
    CoinjoinRoundOptions,
    CoinjoinRoundShape,
} from '../../types/round';
import { getInputSize, getOutputSize } from '../../utils/coordinatorUtils';
import {
    canIncludePayment,
    getInputEffectiveValue,
    getPaymentCost,
    getPendingPayment,
    getRegisteredScripts,
    getRemainderLimits,
} from '../../utils/paymentUtils';
import { getInputRegistrationEnd, isRoundIdMatching } from '../../utils/roundHasher';
import { compareOutpoint } from '../../utils/roundUtils';
import { type Account } from '../Account';
import { type Round } from '../coordinator';
import * as middleware from '../middleware';

export interface SelectRoundProps {
    roundGenerator: CoinjoinRoundGenerator;
    aliceGenerator: AliceGenerator;
    accounts: Account[];
    statusRounds: Round[];
    coinjoinRounds: CoinjoinRoundShape[];
    prison: CoinjoinPrisonShape;
    options: CoinjoinRoundOptions;
}

type ReleaseRefusedBlameRoundParams = Pick<SelectRoundProps, 'prison'> & {
    blameOf: string;
    logger: Logger;
};

// Inputs waiting for a blame round keep all accounts out of regular rounds (see
// selectInputsForRound), release them when their blame round is refused.
const releaseRefusedBlameRound = ({ blameOf, prison, logger }: ReleaseRefusedBlameRoundParams) => {
    if (!prison.getBlameOfInmates().some(inmate => inmate.roundId === blameOf)) return;

    logger.info(`Releasing inputs waiting for a refused blame round of ~~${blameOf}~~`);
    prison.releaseBlameOfInmates(blameOf);
};

type IsRoundFeeAboveAccountLimitParams = {
    round: CoinjoinRoundShape;
    account: Pick<Account, 'accountKey' | 'maxFeePerKvbyte' | 'maxCoordinatorFeeRate'>;
    logger: Logger;
};

// Fee limits of the account apply to regular and blame rounds alike, the skip is logged.
const isRoundFeeAboveAccountLimit = ({
    round,
    account,
    logger,
}: IsRoundFeeAboveAccountLimitParams): boolean => {
    const { MiningFeeRate, CoordinationFeeRate } = round.roundParameters;
    const isFeeAboveLimit =
        MiningFeeRate > account.maxFeePerKvbyte ||
        CoordinationFeeRate.Rate > account.maxCoordinatorFeeRate;

    if (isFeeAboveLimit) {
        logger.info(
            `Skipping round ~~${round.id}~~ for ~~${account.accountKey}~~. Fees to high ${MiningFeeRate} ${CoordinationFeeRate.Rate}`,
        );
    }

    return isFeeAboveLimit;
};

// Round parameters unsuitable for every account, in regular and blame rounds alike.
const getRoundSkipReason = (
    { MinInputCountByRound, AllowedOutputAmounts }: CoinjoinRoundParameters,
    minInputCount: number,
): string | undefined => {
    // MinInputCountByRound is not part of the round id, so it only preselects rounds.
    // verifyRoundInputs checks the actual inputs.
    if (MinInputCountByRound < minInputCount) {
        return `Min input count ${MinInputCountByRound} is below ${minInputCount}`;
    }

    if (AllowedOutputAmounts.Min >= ROUND_MIN_OUTPUT_AMOUNT_SANITY) {
        return `Min output amount ${AllowedOutputAmounts.Min} is not below ${ROUND_MIN_OUTPUT_AMOUNT_SANITY}`;
    }
};

// Ids of skipped rounds which were already logged. Rounds are listed by the status for minutes
// and getRoundCandidates runs on every status update.
const loggedSkippedRounds = new Set<string>();
const LOGGED_SKIPPED_ROUNDS_LIMIT = 100;

const logSkippedRoundOnce = (roundId: string, log: () => void) => {
    if (loggedSkippedRounds.has(roundId)) return;

    if (loggedSkippedRounds.size >= LOGGED_SKIPPED_ROUNDS_LIMIT) {
        loggedSkippedRounds.clear();
    }
    loggedSkippedRounds.add(roundId);
    log();
};

// Basic preselect CoinjoinRound candidates
// reuse existing CoinjoinRounds or create new one
export const getRoundCandidates = ({
    roundGenerator,
    statusRounds,
    coinjoinRounds,
    options,
    prison,
}: Omit<SelectRoundProps, 'aliceGenerator' | 'accounts'>) => {
    const now = Date.now();
    const { logger, minInputCount, coordinatorName } = options;

    return statusRounds
        .filter(round => round.Phase === RoundPhase.InputRegistration)
        .filter(round => {
            // Before anything else uses the id or the parameters of the round. The coordinator
            // could otherwise serve this client other parameters under the id of the round.
            if (isRoundIdMatching(round, coordinatorName)) return true;
            // A joined round is not skipped. Status reports it as changed and
            // CoinjoinRound.onPhaseChange leaves it.
            if (coinjoinRounds.some(({ id }) => id === round.Id)) return false;

            logSkippedRoundOnce(round.Id, () =>
                logger.warn(
                    `Skipping round ~~${round.Id}~~. Its id does not match its parameters and coordinator`,
                ),
            );
            releaseRefusedBlameRound({ blameOf: round.BlameOf, prison, logger });

            return false;
        })
        .filter(round => getInputRegistrationEnd(round) - now > ROUND_SELECTION_REGISTRATION_OFFSET)
        .flatMap(round => {
            const current = coinjoinRounds.find(r => r.id === round.Id);
            if (current) return current;
            // try to create new CoinjoinRound
            try {
                return roundGenerator(round, prison, options);
            } catch {
                // constructor fails on invalid round data (highly unlikely)
                return [];
            }
        })
        .filter(round => {
            const skipReason = getRoundSkipReason(round.roundParameters, minInputCount);
            if (!skipReason) return true;

            logSkippedRoundOnce(round.id, () =>
                logger.info(`Skipping round ~~${round.id}~~. ${skipReason}`),
            );
            releaseRefusedBlameRound({ blameOf: round.blameOf, prison, logger });

            return false;
        });
};

export const getUnregisteredAccounts = ({
    accounts,
    coinjoinRounds,
    options: { logger },
}: Pick<SelectRoundProps, 'accounts' | 'coinjoinRounds' | 'options'>) =>
    accounts.filter(({ accountKey }) => {
        const isAlreadyRegistered = coinjoinRounds.find(
            round =>
                round.phase !== RoundPhase.Ended &&
                round.inputs.find(input => input.accountKey === accountKey),
        );

        if (isAlreadyRegistered) {
            logger.info(`Skipping candidate ~~${accountKey}~~. Already registered to round`);
        }

        return !isAlreadyRegistered;
    });

// Basic preselect Accounts
// exclude Account.utxos which are registered in CoinjoinRounds or detained in CoinjoinPrison
export const getAccountCandidates = ({
    accounts,
    statusRounds,
    coinjoinRounds,
    prison,
    options: { logger, setSessionPhase },
}: Pick<
    SelectRoundProps,
    'accounts' | 'statusRounds' | 'coinjoinRounds' | 'prison' | 'options'
>) => {
    // collect outpoints of all currently registered inputs in CoinjoinRounds + inputs in prison
    const registeredOutpoints = coinjoinRounds
        .flatMap(round => round.inputs.concat(round.failed).map(u => u.outpoint))
        .concat(prison.inmates.map(i => i.id));
    const statusRoundIds = statusRounds.map(({ Id }) => Id);

    const blameOfInputs = prison.getBlameOfInmates();
    const skippedAccounts: Array<{ key: string; reason: SessionPhase }> = [];

    const candidates = accounts.flatMap(account => {
        // skip account registered to critical rounds
        const { accountKey } = account;
        // TODO: double-check account max signed rounds, should be done by suite tho

        // account was detained
        if (prison.isDetained(accountKey)) {
            logger.info(`Account ~~${accountKey}~~ detained`);

            return [];
        }

        const blameOfUtxos = arrayToDictionary(
            account.utxos,
            utxo => {
                const blamedUtxo = blameOfInputs.find(i => i.id === utxo.outpoint);

                return blamedUtxo?.roundId;
            },
            true,
        );

        if (Object.keys(blameOfUtxos).length > 0) {
            logger.info(`Found account candidate for blame round ~~${accountKey}~~`);

            return {
                ...account,
                blameOf: blameOfUtxos,
                utxos: [],
            };
        }

        // Blame candidates are not checked above, a blame round reuses the outputs of its failed
        // round (see outputRegistration) and outputDecomposition limits outputs to the addresses.
        const freeAddressCount = account.changeAddresses.filter(
            addr => !prison.isDetained(addr.address),
        ).length;
        const missingAddressCount = ROUND_SELECTION_MAX_OUTPUTS - freeAddressCount;
        const recyclableOutputs = {
            accountKey,
            addresses: account.changeAddresses.map(({ address }) => address),
            statusRoundIds,
        };
        if (
            missingAddressCount > 0 &&
            prison.getRecyclableOutputCount(recyclableOutputs) < missingAddressCount
        ) {
            logger.info(`Skip candidate ~~${accountKey}~~. Not enough change addresses`);
            skippedAccounts.push({
                key: account.accountKey,
                reason: SessionPhase.SkippingRound,
            });

            return [];
        }

        // filter out InputLongBanned utxos until we know how to deal with them...
        const [_, whitelistedUtxos] = arrayPartition(
            account.utxos,
            utxo =>
                prison.isDetained(utxo.outpoint)?.errorCode ===
                WabiSabiProtocolErrorCode.InputLongBanned,
        );

        // collect known InputBanned
        const bannedUtxos = whitelistedUtxos.filter(
            utxo =>
                prison.isDetained(utxo.outpoint)?.errorCode ===
                WabiSabiProtocolErrorCode.InputBanned,
        );

        if (bannedUtxos.length > 0) {
            let tooManyBannedUtxos = false;
            if (bannedUtxos.length > whitelistedUtxos.length * 0.4) {
                // most of utxos are temporary banned
                tooManyBannedUtxos = true;
            }
            const bannedAmount = bannedUtxos.reduce((sum, utxo) => sum + utxo.amount, 0);
            const totalAmount = whitelistedUtxos.reduce((sum, utxo) => sum + utxo.amount, 0);
            if (bannedAmount > totalAmount * 0.4) {
                // most of amount is temporary banned
                tooManyBannedUtxos = true;
            }

            if (tooManyBannedUtxos) {
                logger.error(`Skip candidate. Too many unavailable utxos`);
                skippedAccounts.push({
                    key: account.accountKey,
                    reason: SessionPhase.BlockedUtxos,
                });

                return [];
            }
        }

        // exclude account utxos which are unavailable
        const utxos = whitelistedUtxos.filter(utxo => !registeredOutpoints.includes(utxo.outpoint));
        if (utxos.length > 0) {
            if (account.skipRounds) {
                const [low, high] = account.skipRounds;
                // skip reached lower limit
                // or skip randomly (20% chance with [4, 5] settings)
                if (
                    account.skipRoundCounter >= low ||
                    (account.skipRoundCounter > 0 && Math.random() > low / high)
                ) {
                    account.skipRoundCounter = 0;
                    logger.info(`Random skip candidate ~~${accountKey}~~`);
                    skippedAccounts.push({
                        key: account.accountKey,
                        reason: SessionPhase.SkippingRound,
                    });

                    return [];
                }
                account.skipRoundCounter++;
            }

            if (utxos.some(({ anonymityLevel }) => anonymityLevel === undefined)) {
                logger.info(
                    `Stopping the session for ~~${account.accountKey}~~. Missing anonymity level info.`,
                );
                skippedAccounts.push({
                    key: account.accountKey,
                    reason: SessionPhase.CriticalError,
                });

                return [];
            }

            if (missingAddressCount > 0) {
                // Unlike WalletWasabi, which registers them again in its next round, reuse outputs
                // of failed rounds only once fresh addresses run out, and only for an account with
                // inputs for a round.
                const recycled = prison.recycleOutputs({
                    ...recyclableOutputs,
                    count: missingAddressCount,
                });
                logger.info(
                    `Recycling ${recycled.addressCount} change addresses of ${recycled.roundCount} failed rounds of ~~${accountKey}~~`,
                );
            }

            logger.info(`Found account candidate ~~${accountKey}~~ with ${utxos.length} inputs`);

            return {
                ...account,
                blameOf: null,
                utxos,
            };
        }

        logger.info(
            `Skipping candidate ~~${accountKey}~~. Utxos ${utxos.length} of ${account.utxos.length}`,
        );
        skippedAccounts.push({
            key: account.accountKey,
            reason: SessionPhase.AccountMissingUtxos,
        });

        return [];
    });

    if (skippedAccounts.length) {
        const eventGroups = skippedAccounts.reduce(
            (groups, { key, reason }) => {
                if (!groups[reason]) {
                    groups[reason] = { phase: reason, accountKeys: [key] };
                } else {
                    groups[reason].accountKeys.push(key);
                }

                return groups;
            },
            {} as Record<SessionPhase, Parameters<typeof setSessionPhase>[0]>,
        );

        Object.values(eventGroups).forEach(group => setSessionPhase(group));
    }

    return candidates;
};

interface SelectInputsForRoundProps extends Pick<
    SelectRoundProps,
    'aliceGenerator' | 'accounts' | 'options' | 'statusRounds'
> {
    roundCandidates: CoinjoinRoundShape[];
    accountCandidates: ReturnType<typeof getAccountCandidates>;
}

type AccountCandidate = SelectInputsForRoundProps['accountCandidates'][number];

const isPaymentInputCandidate = (
    utxo: AccountUtxo,
    scriptType: AllowedScriptTypes,
    roundParameters: CoinjoinRoundParameters,
) =>
    utxo.amount >= roundParameters.AllowedInputAmounts.Min &&
    utxo.amount <= roundParameters.AllowedInputAmounts.Max &&
    utxo.amount <= roundParameters.MaxSuggestedAmount &&
    getInputEffectiveValue(utxo.amount, scriptType, roundParameters) > 0;

type PaymentAccount = Pick<
    AccountCandidate,
    'utxos' | 'scriptType' | 'targetAnonymity' | 'payment' | 'blockedPaymentIds'
>;

// Effective value of a coin that may fund the payment of the account: a private coin that can be
// registered in the round. Undefined for any other coin.
const getPaymentInputValue = (
    utxo: AccountUtxo,
    { scriptType, targetAnonymity }: Pick<PaymentAccount, 'scriptType' | 'targetAnonymity'>,
    roundParameters: CoinjoinRoundParameters,
) => {
    const isPrivate = (utxo.anonymityLevel ?? 0) >= targetAnonymity;
    if (!isPrivate || !isPaymentInputCandidate(utxo, scriptType, roundParameters)) return;

    return getInputEffectiveValue(utxo.amount, scriptType, roundParameters);
};

// What remains after the payment is either small enough to be left as a fee accepted by the signer
// or large enough for a change output.
const getPaymentFunding = (
    payment: AccountPayment,
    scriptType: AllowedScriptTypes,
    roundParameters: CoinjoinRoundParameters,
) => {
    const cost = getPaymentCost(payment, roundParameters.MiningFeeRate);
    const { maxDust, minChange } = getRemainderLimits(roundParameters, getOutputSize(scriptType));
    const isFunded = (sum: number) => {
        const remainder = sum - cost;

        return remainder >= 0 && (remainder <= maxDust || remainder >= minChange);
    };

    return { cost, minChange, isFunded };
};

// Select private coins funding the pending payment of the account, always including its anchor,
// as WalletWasabi PrivatePaymentCoinSelector does (see getPaymentFunding).
// Returns indexes of account utxos, or an empty list if the payment cannot be funded in this round.
export const selectInputsForPayment = (
    account: PaymentAccount,
    roundParameters: CoinjoinRoundParameters,
) => {
    const payment = getPendingPayment(account);
    if (!payment) return [];

    const { cost, minChange, isFunded } = getPaymentFunding(
        payment,
        account.scriptType,
        roundParameters,
    );

    const candidates = account.utxos.flatMap((utxo, index) => {
        const value = getPaymentInputValue(utxo, account, roundParameters);

        return value === undefined ? [] : { index, outpoint: utxo.outpoint, value };
    });

    const anchor = candidates.find(({ outpoint }) => compareOutpoint(outpoint, payment.anchor));
    if (!anchor) return [];

    const selection = [anchor];
    let sum = anchor.value;
    let available = candidates
        .filter(candidate => candidate !== anchor)
        .toSorted((a, b) => a.value - b.value);
    while (
        !isFunded(sum) &&
        selection.length < COINJOIN_PAYMENT_MAX_INPUTS &&
        available.length > 0
    ) {
        // Cover the payment first, then a remainder too large to leave as a fee and too small for
        // a change output.
        const target = sum < cost ? cost : cost + minChange;
        const next = available.find(({ value }) => value >= target - sum) ?? available.at(-1);
        if (!next) break;

        selection.push(next);
        sum += next.value;
        available = available.filter(candidate => candidate !== next);
    }

    return isFunded(sum) ? selection.map(({ index }) => index) : [];
};

type SelectInputsWithMiddlewareParams = Pick<SelectInputsForRoundProps, 'options'> & {
    account: AccountCandidate;
    roundParameters: CoinjoinRoundParameters;
};

// Select the best combination of account utxos for the round with the middleware algorithm.
// Returns indexes of account utxos.
const selectInputsWithMiddleware = ({
    account,
    roundParameters,
    options,
}: SelectInputsWithMiddlewareParams) => {
    const { logger } = options;
    const anchor = account.payment?.anchor;
    const isAnchor = (utxo: AccountUtxo) => !!anchor && compareOutpoint(utxo.outpoint, anchor);

    // The anchor is only spent in a round carrying its payment, or after the payment was
    // cancelled, so that earlier signed attempts of the payment cannot confirm any more.
    const middlewareUtxos = account.utxos.flatMap((utxo, index) =>
        isAnchor(utxo) ? [] : { utxo, index },
    );
    const Utxos = middlewareUtxos.map(({ utxo }) => ({
        Outpoint: utxo.outpoint,
        Amount: utxo.amount,
        ScriptPubKey: utxo.scriptPubKey,
        AnonymitySet: utxo.anonymityLevel as number,
    }));

    const addCancelledPaymentAnchor = (indices: number[]) => {
        if (!account.payment?.isCancelled) return indices;

        const anchorIndex = account.utxos.findIndex(
            utxo =>
                isAnchor(utxo) &&
                isPaymentInputCandidate(utxo, account.scriptType, roundParameters),
        );

        return anchorIndex < 0 || indices.includes(anchorIndex)
            ? indices
            : [...indices, anchorIndex];
    };

    // get liquidityClue and try to select the best utxos combination for given Round
    return middleware
        .getLiquidityClue(account.rawLiquidityClue, roundParameters.MaxSuggestedAmount, {
            baseUrl: options.middlewareUrl,
        })
        .then(LiquidityClue =>
            middleware.selectInputsForRound(
                {
                    MiningFeeRate: roundParameters.MiningFeeRate,
                    CoordinationFeeRate: roundParameters.CoordinationFeeRate,
                    AllowedInputAmounts: roundParameters.AllowedInputAmounts,
                    AllowedOutputAmounts: roundParameters.AllowedOutputAmounts,
                    AllowedInputTypes: roundParameters.AllowedInputTypes,
                    Utxos,
                    AnonScoreTarget: account.targetAnonymity,
                    LiquidityClue,
                    SemiPrivateThreshold: 2,
                    ConsolidationMode: false,
                },
                {
                    signal: options.signal,
                    baseUrl: options.middlewareUrl,
                },
            ),
        )
        .then(indices => indices.flatMap(i => middlewareUtxos[i]?.index ?? [])) // filter valid existing indices
        .catch(error => {
            logger.error(`selectInputsForRound failed ${error.message}`);

            return [] as number[];
        })
        .then(addCancelledPaymentAnchor);
};

type AccountSelection = {
    indices: number[]; // Indexes of account utxos.
    isPayment: boolean; // Selected by selectInputsForPayment to fund the payment of the account.
};

// Payment that the blame round repeats: the account re-registers its anchor, and the re-registered
// coins fund it as selectInputsForPayment requires. The failed round may have mixed the anchor
// without the payment, for example with coins below the anonymity target before the payment was
// made, and such coins must not fund it.
const getBlameRoundPayment = (
    account: AccountCandidate,
    utxos: AccountUtxo[],
    roundParameters: CoinjoinRoundParameters,
) => {
    const payment = getPendingPayment(account);
    if (
        !payment ||
        !canIncludePayment(payment, account.scriptType, roundParameters) ||
        !utxos.some(utxo => compareOutpoint(utxo.outpoint, payment.anchor))
    ) {
        return;
    }

    const values = utxos.flatMap(
        utxo => getPaymentInputValue(utxo, account, roundParameters) ?? [],
    );
    if (values.length < utxos.length) return;

    const sum = values.reduce((total, value) => total + value, 0);
    const { isFunded } = getPaymentFunding(payment, account.scriptType, roundParameters);

    return isFunded(sum) ? payment : undefined;
};

// Payee scripts of the accounts already selected to pay in the round, which other accounts may
// join while it is in input registration (see getRoundCandidates). The coordinator merges outputs
// with the same script, so one payee script is paid at most once in a round. Any payment of such
// an account counts, also a cancelled or blocked one, as in checkPayments.
const getRoundPaymentScripts = (
    { paymentAccountKeys }: CoinjoinRoundShape,
    accounts: SelectRoundProps['accounts'],
) =>
    new Set(
        accounts.flatMap(({ accountKey, payment }) =>
            payment && paymentAccountKeys.includes(accountKey) ? payment.scriptPubKeyHex : [],
        ),
    );

const selectInputsForBlameRound = ({
    aliceGenerator,
    roundCandidates,
    accountCandidates,
    accounts,
    options: { logger },
}: Omit<SelectInputsForRoundProps, 'statusRounds'>) =>
    roundCandidates.find(round => {
        const inputs: AliceShape[] = [];
        let isRefusedByAccount = false;
        const paymentAccountKeys: string[] = [];
        const paymentScripts = getRoundPaymentScripts(round, accounts);
        accountCandidates.forEach(account => {
            const utxos = account.blameOf ? account.blameOf[round.blameOf] : null;
            if (utxos && utxos.length > 0) {
                if (isRoundFeeAboveAccountLimit({ round, account, logger })) {
                    isRefusedByAccount = true;

                    return;
                }

                logger.info(
                    `Found blame round for account ~~${account.accountKey}~~ with ${utxos.length} inputs`,
                );
                inputs.push(
                    ...utxos.map(utxo =>
                        aliceGenerator(account.accountKey, account.scriptType, utxo),
                    ),
                );

                // The coins are re-registered without the payment unless they may fund it.
                const payment = getBlameRoundPayment(account, utxos, round.roundParameters);
                if (payment && !paymentScripts.has(payment.scriptPubKeyHex)) {
                    paymentScripts.add(payment.scriptPubKeyHex);
                    paymentAccountKeys.push(account.accountKey);
                }
            }
        });

        if (inputs.length > 0) {
            // Inputs allowed in the blame round, see verifyRoundInputs. CoinjoinPrison keeps them
            // only in memory, so after a restart the round is refused, as WalletWasabi does not
            // continue a blame chain after a restart either. The failed round may leave the status
            // before this one ends, so the round keeps them.
            const blameOfOutpoints = round.prison.getBlameOfOutpoints(round.blameOf);
            if (!blameOfOutpoints) {
                logger.info(
                    `Skipping blame round ~~${round.id}~~. Inputs of the failed round are unknown`,
                );
                releaseRefusedBlameRound({ blameOf: round.blameOf, prison: round.prison, logger });

                return false;
            }

            round.blameOfOutpoints = blameOfOutpoints;
            round.inputs.push(...inputs);
            round.paymentAccountKeys.push(...paymentAccountKeys);
            logger.info(`Created blame round ~~${round.id}~~ with ${round.inputs.length} inputs`);

            return true;
        }

        // Refused by every account with inputs for it. Once some account joins the round,
        // CoinjoinClient releases the inputs of the refusing ones together with the others.
        if (isRefusedByAccount) {
            releaseRefusedBlameRound({ blameOf: round.blameOf, prison: round.prison, logger });
        }

        return false;
    });

// Use middleware algorithm to process preselected CoinjoinRounds and Accounts
export const selectInputsForRound = async ({
    aliceGenerator,
    roundCandidates,
    accountCandidates,
    accounts,
    statusRounds,
    options,
}: SelectInputsForRoundProps) => {
    // NOTE: regular Round.blameOf field is 64 length string filled with 0
    // blame Round.blameOf is pointing to previously failed round id
    const noBlameOf = '0'.repeat(64);
    const [normalRounds, blameOfRounds] = arrayPartition(
        roundCandidates,
        r => r.blameOf === noBlameOf,
    );
    // Accounts awaiting for blame round are prioritized
    // do not register them anywhere else until blame round is resolved
    const [normalAccounts, blameOfAccounts] = arrayPartition(accountCandidates, r => !r.blameOf);

    if (blameOfAccounts.length > 0) {
        const blameRound = selectInputsForBlameRound({
            aliceGenerator,
            roundCandidates: blameOfRounds,
            accountCandidates: blameOfAccounts,
            accounts,
            options,
        });

        return blameRound;
    }

    const { logger } = options;

    // The coordinator rejects a payment output whose script is registered in any round.
    const registeredScripts = normalAccounts.some(account => getPendingPayment(account))
        ? getRegisteredScripts(statusRounds)
        : new Set<string>();

    // utxoSelection shape: array_of_rounds[ array_of_accounts[ AccountSelection ] ]
    // indices for 2 roundCandidates with 3 accountCandidates: [ [ [], [], [0, 1, 2] ], [ [3], [], [0, 1, 2] ] ]
    // each account/utxo set needs to be calculated separately because of different targetAnonymity
    const utxoSelection = await Promise.all(
        // for each CoinjoinRound...
        normalRounds.map(round => {
            const { roundParameters } = round;
            // Payments are selected before the first await below, in the order of accounts, so the
            // first account paying a script funds it in this round.
            const paymentScripts = getRoundPaymentScripts(round, accounts);

            return Promise.all(
                // ...and for each Account
                normalAccounts.map(async (account): Promise<AccountSelection> => {
                    if (isRoundFeeAboveAccountLimit({ round, account, logger })) {
                        return { indices: [], isPayment: false };
                    }

                    const payment = getPendingPayment(account);
                    if (
                        payment &&
                        canIncludePayment(payment, account.scriptType, roundParameters) &&
                        !registeredScripts.has(payment.scriptPubKeyHex) &&
                        !paymentScripts.has(payment.scriptPubKeyHex)
                    ) {
                        const indices = selectInputsForPayment(account, roundParameters);
                        if (indices.length > 0) {
                            paymentScripts.add(payment.scriptPubKeyHex);

                            return { indices, isPayment: true };
                        }
                    }

                    const indices = await selectInputsWithMiddleware({
                        account,
                        roundParameters,
                        options,
                    });

                    return { indices, isPayment: false };
                }),
            );
        }),
    );

    // find Round funding most payments, then with maximum possible utxos
    const roundScores = utxoSelection.map(selection => ({
        paymentCount: selection.filter(({ isPayment }) => isPayment).length,
        utxoCount: selection.reduce((sum, { indices }) => sum + indices.length, 0),
    }));
    const bestScore = roundScores.reduce(
        (best, score) =>
            score.paymentCount > best.paymentCount ||
            (score.paymentCount === best.paymentCount && score.utxoCount > best.utxoCount)
                ? score
                : best,
        { paymentCount: 0, utxoCount: 0 },
    );
    if (bestScore.utxoCount < 1) {
        logger.info('No results from selectInputsForRound');

        return;
    }

    // get index of Round with the best score
    const roundIndex = roundScores.indexOf(bestScore);
    // @ts-expect-error: indexing with noUncheckedIndexedAccess
    const selectedRound: (typeof normalRounds)[number] = normalRounds[roundIndex];

    // setup new Round
    accountCandidates.forEach((account, accountIndex) => {
        // find utxos assigned to this Round and Account
        const accountSelection = utxoSelection[roundIndex]?.[accountIndex];
        const utxoIndexes = accountSelection?.indices ?? [];
        const selectedUtxos = utxoIndexes.map(utxoIndex => {
            const { utxos } = account;
            // @ts-expect-error: indexing with noUncheckedIndexedAccess
            const utxo: (typeof utxos)[number] = utxos[utxoIndex];

            return utxo;
        });

        // Temporary workaround for middleware issue: https://github.com/zkSNACKs/WalletWasabi/issues/10759
        const feeRate = selectedRound.roundParameters.MiningFeeRate;
        const inputFee = Math.floor((getInputSize(account.scriptType) * feeRate) / 1000);
        const outputFee = Math.floor((getOutputSize(account.scriptType) * feeRate) / 1000);
        const totalValue = selectedUtxos.reduce((a, b) => a + b.amount, 0);
        const effectiveValue = totalValue - outputFee - selectedUtxos.length * inputFee;
        if (effectiveValue < selectedRound.roundParameters.AllowedOutputAmounts.Min) {
            // skip round if effective value is too low
            // https://github.com/zkSNACKs/WalletWasabi/issues/10759
            logger.error(
                `Skipping the round. Utxo effective value ~~${effectiveValue}~~ is too low`,
            );
        } else if (
            // skip round if selected utxo value is greater than maxSuggestedAmount
            // https://github.com/zkSNACKs/WalletWasabi/blob/23e4ec0971303b4502372332ecaffe4ff5d08917/WalletWasabi/WabiSabi/Client/CoinJoinClient.cs#L156
            selectedUtxos.some(
                utxo => utxo.amount > selectedRound.roundParameters.MaxSuggestedAmount,
            )
        ) {
            logger.info('Skipping the round for more optimal mixing.');
        } else {
            // create new Alice(s) and add it to CoinjoinRound
            selectedRound.inputs.push(
                ...selectedUtxos.map(utxo =>
                    aliceGenerator(account.accountKey, account.scriptType, utxo),
                ),
            );

            if (accountSelection?.isPayment && account.payment) {
                selectedRound.paymentAccountKeys.push(account.accountKey);
                logger.info(
                    `Payment funded by ${selectedUtxos.length} inputs in ~~${selectedRound.id}~~`,
                );
            }
        }
    });

    return selectedRound.inputs.length > 0 ? selectedRound : undefined;
};

export const selectRound = async ({
    roundGenerator,
    aliceGenerator,
    accounts,
    statusRounds,
    coinjoinRounds,
    prison,
    options,
}: SelectRoundProps): Promise<CoinjoinRoundShape | undefined> => {
    const { logger, setSessionPhase } = options;

    const unregisteredAccounts = getUnregisteredAccounts({ accounts, coinjoinRounds, options });
    const unregisteredAccountKeys = unregisteredAccounts.map(({ accountKey }) => accountKey);

    logger.info('Looking for rounds');
    setSessionPhase({ phase: SessionPhase.RoundSearch, accountKeys: unregisteredAccountKeys });
    const roundCandidates = getRoundCandidates({
        roundGenerator,
        statusRounds,
        coinjoinRounds,
        options,
        prison,
    });
    if (roundCandidates.length < 1) {
        logger.info('No suitable rounds');

        return;
    }

    logger.info('Looking for accounts');
    setSessionPhase({ phase: SessionPhase.CoinSelection, accountKeys: unregisteredAccountKeys });
    const accountCandidates = getAccountCandidates({
        accounts: unregisteredAccounts,
        statusRounds,
        coinjoinRounds,
        prison,
        options,
    });

    if (accountCandidates.length < 1) {
        logger.info('No suitable accounts');

        return;
    }

    logger.info(`Looking for utxos`);
    setSessionPhase({ phase: SessionPhase.RoundPairing, accountKeys: unregisteredAccountKeys });
    const newRound = await selectInputsForRound({
        aliceGenerator,
        roundCandidates,
        accountCandidates,
        accounts,
        statusRounds,
        options,
    });
    if (!newRound) {
        logger.info('No suitable utxos');
        setSessionPhase({
            phase: SessionPhase.RetryingRoundPairing,
            accountKeys: unregisteredAccountKeys,
        });

        return;
    }

    logger.info(`Created new round ~~${newRound.id}~~ with ${newRound.inputs.length} inputs`);

    return newRound;
};
