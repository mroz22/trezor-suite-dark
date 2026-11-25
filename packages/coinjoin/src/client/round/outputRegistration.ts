import { arrayDistinct, arrayShuffle, getWeakRandomId, getWeakRandomInt } from '@trezor/utils';

import { SessionPhase, WabiSabiProtocolErrorCode } from '../../enums';
import type { AccountAddress, AccountPayment } from '../../types/account';
import type { AliceShape } from '../../types/alice';
import * as coordinator from '../coordinator';
import * as middleware from '../middleware';
import { type Bob, outputDecomposition, setAccountError } from './outputDecomposition';
import { verifyRoundInputs } from './verifyRoundInputs';
import type { CoinjoinRoundOptions, CoinjoinRoundShape } from '../../types/round';
import { getOutputSize } from '../../utils/coordinatorUtils';
import { scheduleDelay, sumCredentials } from '../../utils/roundUtils';
import type { Account } from '../Account';

/**
 * RoundPhase: 2, OutputRegistration
 *
 * Process steps:
 * - Calculate output amounts using middleware (see ./outputDecomposition)
 * - Combine registered Credentials in to outputs using coordinator /credential-issuance (see ./outputDecomposition)
 * - Register decomposed Credentials as outputs using coordinator /output-registration
 * - Finally call /ready-to-sign on coordinator for each input
 */

const getOutputCredentialRequests = async (
    round: CoinjoinRoundShape,
    { amountCredentials, vsizeCredentials }: Bob,
    { signal, middlewareUrl }: CoinjoinRoundOptions,
) => {
    const { roundParameters } = round;

    const outputAmountCredentials = await middleware.getRealCredentials(
        [], // NOTE: sending empty amountToRequest **will not** create credentialToRequest object which **should not** be sent to coordinator in output-registration request
        amountCredentials,
        round.amountCredentialIssuerParameters,
        roundParameters.MaxAmountCredentialValue,
        { signal, baseUrl: middlewareUrl },
    );
    const outputVsizeCredentials = await middleware.getRealCredentials(
        [],
        vsizeCredentials,
        round.vsizeCredentialIssuerParameters,
        roundParameters.MaxVsizeAllocationPerAlice,
        { signal, baseUrl: middlewareUrl },
    );

    return { outputAmountCredentials, outputVsizeCredentials };
};

const registerOutput = async (
    round: CoinjoinRoundShape,
    { accountKey, changeAddresses, scriptType }: Account,
    bob: Bob,
    assignedAddresses: AccountAddress[],
    options: CoinjoinRoundOptions,
) => {
    const { roundParameters, phaseDeadline } = round;
    const { signal, coordinatorUrl, logger } = options;
    const { amountCredentials } = bob;

    const remainingTime = phaseDeadline - Date.now();
    const delay = scheduleDelay(Math.floor(remainingTime * 0.8));

    const { outputAmountCredentials, outputVsizeCredentials } = await getOutputCredentialRequests(
        round,
        bob,
        options,
    );

    const isUnassigned = (address: AccountAddress) => !assignedAddresses.includes(address);
    // A blame round registers again the outputs this account registered in the failed round, as
    // WalletWasabi does. Fresh ones would set the outputs of this client apart.
    const isReusable = ({ address }: AccountAddress) =>
        round.prison.isReusableOutput({ address, accountKey, roundId: round.blameOf });

    // The retry after AlreadyRegisteredScript presents the same credentials with another address,
    // which links both for the coordinator. Retry once only, as the coordinator could otherwise
    // reject all addresses of the account. WalletWasabi does not retry.
    const tryToRegisterOutput = (isRetry = false): Promise<AccountAddress> => {
        const address =
            changeAddresses.find(a => isUnassigned(a) && isReusable(a)) ??
            changeAddresses.find(a => isUnassigned(a) && !round.prison.isDetained(a.address));
        if (!address) {
            const detained = changeAddresses.filter(a => round.prison.isDetained(a.address));
            logger.error(
                `No change address available. Assigned in round: ${assignedAddresses.length}. Detained: ${detained.length}. Total: ${changeAddresses.length}`,
            );
            throw new Error('No change address available');
        }

        assignedAddresses.push(address);
        // Before the request, the coordinator may keep the output even if the request fails.
        round.prison.detainRegisteredOutput({ ...address, accountKey }, round.id);

        return coordinator
            .outputRegistration(
                round.id,
                address,
                outputAmountCredentials,
                outputVsizeCredentials,
                {
                    signal,
                    baseUrl: coordinatorUrl,
                    identity: getWeakRandomId(10),
                    delay: isRetry ? 0 : delay,
                    deadline: round.phaseDeadline,
                },
            )
            .then(() => address)
            .catch(error => {
                if (error instanceof coordinator.WabiSabiProtocolException) {
                    if (error.errorCode === WabiSabiProtocolErrorCode.AlreadyRegisteredScript) {
                        logger.error(`Change address already used (AlreadyRegisteredScript)`);
                        round.prison.detain(
                            { ...address, accountKey },
                            {
                                errorCode: error.errorCode,
                                sentenceEnd: Infinity, // this address should never be recycled
                            },
                        );

                        if (!isRetry) return tryToRegisterOutput(true);
                    }
                    if (error.errorCode === WabiSabiProtocolErrorCode.NotEnoughFunds) {
                        // @ts-expect-error: indexing with noUncheckedIndexedAccess
                        const firstCred: (typeof amountCredentials)[number] = amountCredentials[0];
                        logger.error(
                            `NotEnoughFunds. Amount: ~~${firstCred.Value}~~ Delta: ~~${outputAmountCredentials.CredentialsRequest.Delta}~~ FeeRate: ${roundParameters.MiningFeeRate}`,
                        );
                    }
                }

                throw error;
            });
    };

    const address = await tryToRegisterOutput();

    // The coordinator pays the presented amount credentials minus the mining fee for the output
    // size (WalletWasabi Bob.CalculateOutputAmount with NBitcoin FeeRate.GetFee). Expect the fee
    // rounded up or, where it rounds down to 0 sat, the whole rate per kvB but at least 1 sat. That
    // is the most an honest coordinator charges, however it rounds a fee below 1 sat.
    const { MiningFeeRate } = roundParameters;
    const exactOutputFee = (getOutputSize(scriptType) * MiningFeeRate) / 1000;
    const outputFee =
        Math.floor(exactOutputFee) > 0 ? Math.ceil(exactOutputFee) : Math.max(1, MiningFeeRate);
    round.addresses.push({
        ...address,
        accountKey,
        amount: sumCredentials(amountCredentials) - outputFee,
    });
};

// Rejections of the payee script or the payment amount, which do not depend on the round.
// WalletWasabi coordinators reject every script that was already an output of a coinjoin as
// AlreadyRegisteredScript, so retrying it in a later round would fail again.
const PAYMENT_BLOCKING_ERRORS = [
    WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
    WabiSabiProtocolErrorCode.ScriptNotAllowed,
    WabiSabiProtocolErrorCode.NonStandardOutput,
    WabiSabiProtocolErrorCode.DustOutput,
    WabiSabiProtocolErrorCode.NotEnoughFunds,
    WabiSabiProtocolErrorCode.TooMuchFunds,
];

// Register the payment output. It is never registered with another script: if the coordinator
// rejects it, the round fails for the inputs of the account before any signature. A rejection of
// the payee or the amount also blocks the payment for this session.
const registerPaymentOutput = async (
    round: CoinjoinRoundShape,
    account: Account,
    bob: Bob,
    payment: AccountPayment,
    options: CoinjoinRoundOptions,
) => {
    const { signal, coordinatorUrl, logger } = options;

    const remainingTime = round.phaseDeadline - Date.now();
    const delay = scheduleDelay(Math.floor(remainingTime * 0.8));

    const { outputAmountCredentials, outputVsizeCredentials } = await getOutputCredentialRequests(
        round,
        bob,
        options,
    );

    try {
        await coordinator.outputRegistration(
            round.id,
            payment,
            outputAmountCredentials,
            outputVsizeCredentials,
            {
                signal,
                baseUrl: coordinatorUrl,
                identity: getWeakRandomId(10),
                delay,
                deadline: round.phaseDeadline,
            },
        );
    } catch (error) {
        if (error instanceof coordinator.WabiSabiProtocolException) {
            const { errorCode } = error;
            const isBlocked =
                errorCode !== undefined && PAYMENT_BLOCKING_ERRORS.includes(errorCode);
            round.rejectedPayments.push({
                accountKey: account.accountKey,
                paymentId: payment.id,
                errorCode,
                isBlocked,
            });
            if (isBlocked && !account.blockedPaymentIds.includes(payment.id)) {
                account.blockedPaymentIds.push(payment.id);
            }
            // Only the error code is logged, the description of the coordinator may contain the
            // script.
            const errorCodeKey =
                errorCode === undefined ? 'unknown' : WabiSabiProtocolErrorCode[errorCode];
            logger.warn(`Payment rejected: ${errorCodeKey}`);

            throw new Error('Payment output rejected', { cause: error });
        }

        throw new Error('Payment output registration failed', { cause: error });
    }

    round.payments.push({
        accountKey: account.accountKey,
        paymentId: payment.id,
        address: payment.address,
        scriptPubKey: payment.scriptPubKey,
        scriptPubKeyHex: payment.scriptPubKeyHex,
        amount: payment.amount,
        anchor: payment.anchor,
    });
};

const readyToSign = (
    { id, phaseDeadline }: CoinjoinRoundShape,
    input: AliceShape,
    { signal, coordinatorUrl }: CoinjoinRoundOptions,
) =>
    coordinator.readyToSign(id, input.registrationData!.AliceId, {
        signal,
        baseUrl: coordinatorUrl,
        identity: input.outpoint, // NOTE: recycle input identity
        delay: scheduleDelay(phaseDeadline - Date.now()),
        deadline: phaseDeadline,
    });

export const outputRegistration = async (
    round: CoinjoinRoundShape,
    accounts: Account[],
    options: CoinjoinRoundOptions,
) => {
    const { logger } = options;

    // in case of error we want to know it it happened during credential-issuance (outputDecomposition) or output-registration
    let phaseStep = 0;

    logger.info(`outputRegistration: ~~${round.id}~~`);
    // TODO:
    // - decide if there is only 1 account registered should i abaddon this round and blame it on some "youngest" input?
    // - maybe if there is only 1 account inputs are so "far away" from each other that it is wort to mix anyway?
    try {
        // Signed later only with exactly these inputs, see getTransactionData.
        round.verifiedInputs = verifyRoundInputs(round, options);

        round.setSessionPhase(SessionPhase.RegisteringOutputs);
        // decompose output amounts for all registered inputs grouped by Account
        const decomposedGroup = await outputDecomposition(round, accounts, options);

        // first step completed
        phaseStep = 1;

        await Promise.all(
            decomposedGroup.map(({ accountKey, outputs }) => {
                const account = accounts.find(a => a.accountKey === accountKey);
                if (!account) throw new Error(`Unknown account ~~${accountKey}~~`);

                const assignedAddresses: AccountAddress[] = [];
                // Once the account failed, a delayed payment registration is not sent: it would
                // show the payee together with the anchor in a round the account does not sign.
                const paymentAbort = new AbortController();
                const paymentOptions = {
                    ...options,
                    signal: AbortSignal.any([options.signal, paymentAbort.signal]),
                };

                // The payment output is registered together with the change outputs, in random order.
                // A failed registration fails only the inputs of the account.
                return Promise.all(
                    arrayShuffle(outputs, { randomInt: getWeakRandomInt }).map(output =>
                        output.payment
                            ? registerPaymentOutput(
                                  round,
                                  account,
                                  output,
                                  output.payment,
                                  paymentOptions,
                              )
                            : registerOutput(round, account, output, assignedAddresses, options),
                    ),
                ).catch(error => {
                    paymentAbort.abort();
                    setAccountError(round, accountKey, error, options);
                });
            }),
        );

        // Inform the coordinator that each input of the accounts that registered their outputs is
        // ready to sign.
        const readyInputs = round.inputs.filter(input => !input.error);
        if (readyInputs.length > 0) {
            options.setSessionPhase({
                phase: SessionPhase.AwaitingOthersOutputs,
                accountKeys: readyInputs.map(input => input.accountKey).filter(arrayDistinct),
            });
            await Promise.all(
                arrayShuffle(readyInputs, { randomInt: getWeakRandomInt }).map(input =>
                    readyToSign(round, input, options),
                ),
            );
            logger.info(`Ready to sign ~~${round.id}~~`);
        }
    } catch (error) {
        // NOTE: if anything goes wrong in this process this Round will be corrupted for all the users
        // registered inputs will probably be banned
        const message = `Output registration in ~~${round.id}~~ failed: ${error.message}`;
        logger.error(`Output registration failed: (${phaseStep}) ${error.message}`);
        round.setSessionPhase(SessionPhase.OutputRegistrationFailed);

        // Keep the class, a lie of the coordinator stops the client (see CoinjoinClient).
        const inputError =
            error instanceof coordinator.CoordinatorMisbehaviorError
                ? new coordinator.CoordinatorMisbehaviorError(message)
                : new Error(message);
        round.inputs.forEach(input => input.setError(inputError));
    }

    return round;
};
