import { arrayShuffle, getWeakRandomId, getWeakRandomInt } from '@trezor/utils';

import { SessionPhase, WabiSabiProtocolErrorCode } from '../../enums';
import type { AccountAddress } from '../../types/account';
import type { AliceShape } from '../../types/alice';
import * as coordinator from '../coordinator';
import * as middleware from '../middleware';
import { type Bob, outputDecomposition } from './outputDecomposition';
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

const registerOutput = async (
    round: CoinjoinRoundShape,
    { accountKey, changeAddresses, scriptType }: Account,
    { amountCredentials, vsizeCredentials }: Bob,
    assignedAddresses: AccountAddress[],
    options: CoinjoinRoundOptions,
) => {
    const { roundParameters, phaseDeadline } = round;
    const { signal, coordinatorUrl, middlewareUrl, logger } = options;

    const remainingTime = phaseDeadline - Date.now();
    const delay = scheduleDelay(Math.floor(remainingTime * 0.8));

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

                return Promise.all(
                    arrayShuffle(outputs, { randomInt: getWeakRandomInt }).map(output =>
                        registerOutput(round, account, output, assignedAddresses, options),
                    ),
                );
            }),
        );

        round.setSessionPhase(SessionPhase.AwaitingOthersOutputs);
        // inform coordinator that each registered input is ready to sign
        await Promise.all(
            arrayShuffle(round.inputs, { randomInt: getWeakRandomInt }).map(input =>
                readyToSign(round, input, options),
            ),
        );
        logger.info(`Ready to sign ~~${round.id}~~`);
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
