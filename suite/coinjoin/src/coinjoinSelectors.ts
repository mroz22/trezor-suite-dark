import { type SelectedAccountRootState, selectSelectedAccount } from '@suite/account';
import { type LocksRootState, selectIsDeviceOrUiLocked } from '@suite/locks';
import { type TorRootState, selectIsTorEnabled } from '@suite/tor';
import { type DeviceRootState, selectDeviceStatus } from '@suite-common/device';
import {
    Feature,
    type MessageSystemRootState,
    selectFeatureConfig,
    selectIsFeatureDisabled,
} from '@suite-common/message-system';
import { type NetworkSymbol } from '@suite-common/wallet-config';
import {
    type AccountsRootState,
    type TransactionsRootState,
    selectAccountByKey,
    selectAccountTransactions,
} from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { getInputSize, getOutputSize } from '@trezor/coinjoin';
import { ROUND_MIN_INPUT_COUNT } from '@trezor/coinjoin/src/constants';
import { createWeakMapSelector } from '@trezor/redux-utils';
import { BigNumber, deepEqual } from '@trezor/utils';

import { type CoinjoinState } from './coinjoinTypes';
import {
    breakdownCoinjoinBalance,
    calculateAnonymityProgress,
    calculateAverageAnonymityGainPerRound,
    getCoinjoinAccountAddresses,
    getMaxFeePerVbyte,
    getMaxRounds,
    getSkipRounds,
    isCoinjoinSupportedSymbol,
} from './coinjoinUtils';
import {
    CLIENT_STATUS_FALLBACK,
    type CoinjoinNetworksConfig,
    type CoinjoinSymbol,
    DEFAULT_TARGET_ANONYMITY,
    FEE_RATE_MEDIAN_FALLBACK,
    MAX_COORDINATOR_FEE_RATE,
    MIN_ANONYMITY_GAINED_PER_ROUND,
    SKIP_ROUNDS_BY_DEFAULT,
    UNECONOMICAL_COINJOIN_THRESHOLD,
    ZKSNACKS_LEGAL_DOCUMENTS_VERSION,
    getCoinjoinCoordinator,
    getCoinjoinCoordinators,
    getCoinjoinNetworkSettings,
} from './config';

export type CoinjoinRootState = {
    wallet: {
        coinjoin: CoinjoinState;
    };
};

// Slim suite slice declared locally to avoid a dependency on the desktop app's whole state.
export type SuiteOnlineRootState = {
    suite: {
        online: boolean;
    };
};

const createMemoizedSelector = createWeakMapSelector.withTypes<
    CoinjoinRootState & AccountsRootState
>();

export const selectCoinjoinAccounts = (state: CoinjoinRootState) => state.wallet.coinjoin.accounts;

export const selectCoinjoinIsPreloading = (state: CoinjoinRootState) =>
    state.wallet.coinjoin.isPreloading;

export const selectCoinjoinClients = (state: CoinjoinRootState) => state.wallet.coinjoin.clients;

export const selectCoinjoinDebug = (state: CoinjoinRootState) => state.wallet.coinjoin.debug;

export const selectChosenCoinjoinCoordinatorUrls = (state: CoinjoinRootState) =>
    state.wallet.coinjoin.chosenCoordinatorUrls;

export const selectRoundsDurationInHours = (state: CoinjoinRootState) =>
    state.wallet.coinjoin.config.roundsDurationInHours;

export const selectRoundsFailRateBuffer = (state: CoinjoinRootState) =>
    state.wallet.coinjoin.config.roundsFailRateBuffer;

export const selectMaxMiningFeeModifier = (state: CoinjoinRootState) =>
    state.wallet.coinjoin.config.maxMiningFeeModifier;

export const selectMaxMiningFeeConfig = (state: CoinjoinRootState) =>
    state.wallet.coinjoin.config.maxFeePerVbyte;

export const selectCoinjoinAccountByKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey | null,
) => {
    const coinjoinAccounts = selectCoinjoinAccounts(state);

    return coinjoinAccounts.find(account => account.key === accountKey);
};

export const selectCoinjoinClient = (state: CoinjoinRootState, accountKey: AccountKey | null) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const clients = selectCoinjoinClients(state);

    return coinjoinAccount?.symbol && clients[coinjoinAccount?.symbol];
};

export const selectSessionByAccountKey = (state: CoinjoinRootState, accountKey: AccountKey) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);

    return coinjoinAccount?.session;
};

export const selectTargetAnonymityByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey | null,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    if (!coinjoinAccount) return;

    return coinjoinAccount.setup?.targetAnonymity ?? DEFAULT_TARGET_ANONYMITY;
};

// Coordinators the network can mix through, see selectCoinjoinNetworkConfig for the one it uses.
export const selectCoinjoinCoordinatorsBySymbol = (
    state: CoinjoinRootState,
    symbol: CoinjoinSymbol,
) =>
    getCoinjoinCoordinators(
        symbol,
        selectCoinjoinDebug(state)?.coinjoinServerEnvironment?.[symbol],
    );

// A coordinator passed at startup through debug.coinjoinConfigOverride replaces the listed ones.
export const selectIsCoinjoinCoordinatorOverriddenBySymbol = (
    state: CoinjoinRootState,
    symbol: CoinjoinSymbol,
) => !!selectCoinjoinDebug(state)?.coinjoinConfigOverride?.[symbol]?.coordinatorUrl;

// Settings of the network's coinjoin client: the chosen coordinator and the debug overrides.
export const selectCoinjoinNetworkConfig = (
    state: CoinjoinRootState,
    symbol: CoinjoinSymbol,
): CoinjoinNetworksConfig => {
    const debug = selectCoinjoinDebug(state);
    const override = debug?.coinjoinConfigOverride?.[symbol];
    const { settings, coordinators } = getCoinjoinNetworkSettings(
        symbol,
        debug?.coinjoinServerEnvironment?.[symbol],
    );
    // The fields a coordinator passed at startup does not set come from the network, not from a
    // listed coordinator.
    const coordinator = selectIsCoinjoinCoordinatorOverriddenBySymbol(state, symbol)
        ? undefined
        : getCoinjoinCoordinator(
              coordinators,
              selectChosenCoinjoinCoordinatorUrls(state)?.[symbol],
          );

    return { ...settings, ...coordinator, ...override };
};

// Highest coordinator fee rate a coinjoin session of the network authorizes on the device.
export const selectCoordinatorFeeRateCapBySymbol = (
    state: CoinjoinRootState,
    symbol: CoinjoinSymbol,
) => selectCoinjoinNetworkConfig(state, symbol).maxCoordinatorFeeRate ?? MAX_COORDINATOR_FEE_RATE;

// Rounds of the network with fewer inputs are skipped, coinjoins with fewer inputs refused.
export const selectCoinjoinMinInputCountBySymbol = (
    state: CoinjoinRootState,
    symbol: CoinjoinSymbol,
) => {
    const { minInputCount, network } = selectCoinjoinNetworkConfig(state, symbol);

    return minInputCount ?? ROUND_MIN_INPUT_COUNT[network];
};

// A session, also a paused one, authorized the coordinator of the network on the device.
export const selectHasCoinjoinSessionBySymbol = (
    state: CoinjoinRootState,
    symbol: CoinjoinSymbol,
) => selectCoinjoinAccounts(state).some(account => account.symbol === symbol && !!account.session);

// Mixing needs a coordinator, listed for the network or passed at startup through
// `--state.wallet.coinjoin.debug.coinjoinConfigOverride.<symbol>`. The public ones shut down, so btc
// and test list none, while regtest lists its local one. The message-system flag can still turn
// coinjoin off remotely.
export const selectIsMixingEnabled = (
    state: CoinjoinRootState & MessageSystemRootState,
    symbol: NetworkSymbol,
) => {
    if (!isCoinjoinSupportedSymbol(symbol) || selectIsFeatureDisabled(state, Feature.coinjoin)) {
        return false;
    }

    return !!selectCoinjoinNetworkConfig(state, symbol).coordinatorUrl;
};

// Holding low-anonymity coins back only protects something where coins went through a coinjoin
// round or can still go through one; any other Privacy account spends like a standard account.
export const selectIsSpendingRestrictedByAccountKey = (
    state: CoinjoinRootState & MessageSystemRootState & TransactionsRootState,
    accountKey: AccountKey,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    if (!coinjoinAccount) return false;

    return (
        selectIsMixingEnabled(state, coinjoinAccount.symbol) ||
        selectAccountTransactions(state, accountKey).some(({ type }) => type === 'joint')
    );
};

// Target anonymity as the spending path sees it. Mixing surfaces keep reading the stored target
// through `selectTargetAnonymityByAccountKey`.
export const selectEffectiveTargetAnonymityByAccountKey = (
    state: CoinjoinRootState & MessageSystemRootState & TransactionsRootState,
    accountKey: AccountKey | null,
) => {
    const targetAnonymity = selectTargetAnonymityByAccountKey(state, accountKey);
    if (targetAnonymity === undefined || !accountKey) return targetAnonymity;

    return selectIsSpendingRestrictedByAccountKey(state, accountKey) ? targetAnonymity : 1;
};

export const selectCurrentCoinjoinBalanceBreakdown = (
    state: CoinjoinRootState & SelectedAccountRootState,
) => {
    const selectedAccount = selectSelectedAccount(state);
    const targetAnonymity = selectedAccount
        ? selectTargetAnonymityByAccountKey(state, selectedAccount.key)
        : undefined;

    const { addresses, utxo: utxos } = selectedAccount || {};

    const balanceBreakdown = breakdownCoinjoinBalance({
        targetAnonymity,
        anonymitySet: addresses?.anonymitySet,
        utxos,
    });

    return balanceBreakdown;
};

export const selectRegisteredUtxosByAccountKey = createMemoizedSelector(
    [selectCoinjoinAccountByKey, selectAccountByKey, selectCoinjoinClients],
    (coinjoinAccount, account, clients) => {
        if (!coinjoinAccount?.prison) return;
        const { prison, session, symbol, transactionCandidates } = coinjoinAccount;
        const isTxCandidate = (roundId: string) =>
            !!transactionCandidates?.some(tx => tx.roundId === roundId);

        const registered = Object.keys(prison).reduce<typeof prison>((result, key) => {
            // @ts-expect-error: indexing with noUncheckedIndexedAccess
            const inmate: (typeof prison)[string] = prison[key];
            // select **only** inmates with assigned roundId (signed in current round or promised to future blaming round)
            // and, also without a session, outputs detained for good: the coordinator saw them
            if (
                (inmate.type === 'output' && inmate.sentenceEnd === Infinity) ||
                (inmate.roundId && (session || isTxCandidate(inmate.roundId)))
            ) {
                result[key] = inmate;
            }

            return result;
        }, {});

        // A regular send takes the first free change address after the last used one (see
        // composeBitcoinTransactionFeeLevelsThunk). With none of the addresses the client gets
        // free, it would take one past them, which a wallet discovering the account with the
        // common gap limit of 20 does not find. Free an output of the oldest failed round for it
        // instead, the client recycles that round first as well: the coordinator may link the
        // transaction to the round, but the funds stay where wallets look. Not an output of a
        // round in the status, which may still run, nor of a round signed here, whose transaction
        // may still appear.
        const changeAddresses = account ? getCoinjoinAccountAddresses(account) : [];
        if (
            changeAddresses.length === 0 ||
            changeAddresses.some(({ address }) => !registered[address])
        ) {
            return registered;
        }

        const statusRoundIds = new Set(clients[symbol]?.rounds.map(({ id }) => id));
        const [oldestFailedRoundOutput] = changeAddresses
            .flatMap(({ address }) => {
                const inmate = registered[address];

                return inmate?.errorCode === 'registeredOutput' &&
                    inmate.roundId &&
                    !statusRoundIds.has(inmate.roundId) &&
                    !isTxCandidate(inmate.roundId)
                    ? [{ address, sentenceStart: inmate.sentenceStart }]
                    : [];
            })
            .toSorted((a, b) => a.sentenceStart - b.sentenceStart);
        if (!oldestFailedRoundOutput) return registered;

        return Object.fromEntries(
            Object.entries(registered).filter(([id]) => id !== oldestFailedRoundOutput.address),
        );
    },
    // The clients change with every status, keep the result unless it changes.
    { memoizeOptions: { resultEqualityCheck: deepEqual } },
);

export const selectSessionProgressByAccountKey = (
    state: AccountsRootState & CoinjoinRootState,
    accountKey: AccountKey | null,
) => {
    const relatedAccount = selectAccountByKey(state, accountKey);
    const targetAnonymity = selectTargetAnonymityByAccountKey(state, accountKey);

    const { addresses, balance, utxo: utxos } = relatedAccount || {};

    if (!balance || !utxos) {
        return 0;
    }

    const progress = calculateAnonymityProgress({
        targetAnonymity,
        anonymitySet: addresses?.anonymitySet,
        utxos,
    });

    return progress;
};

export const selectCurrentCoinjoinSession = (
    state: CoinjoinRootState & SelectedAccountRootState,
) => {
    const selectedAccount = selectSelectedAccount(state);
    const coinjoinAccounts = selectCoinjoinAccounts(state);

    const currentCoinjoinAccount = coinjoinAccounts.find(
        account => account.key === selectedAccount?.key,
    );

    const { session } = currentCoinjoinAccount || {};

    return session;
};

export const selectCurrentTargetAnonymity = (
    state: CoinjoinRootState & SelectedAccountRootState,
) => {
    const selectedAccount = selectSelectedAccount(state);
    const targetAnonymity = selectedAccount
        ? selectTargetAnonymityByAccountKey(state, selectedAccount.key)
        : undefined;

    return targetAnonymity;
};

const isRoundPhaseCritical = (roundPhase?: number) => (roundPhase ?? 0) > 0;

export const selectIsAnySessionInCriticalPhase = (state: CoinjoinRootState) => {
    const coinjoinAccounts = selectCoinjoinAccounts(state);

    return coinjoinAccounts.some(acc => isRoundPhaseCritical(acc.session?.roundPhase));
};

export const selectIsAccountWithSessionInCriticalPhaseByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);

    return isRoundPhaseCritical(coinjoinAccount?.session?.roundPhase);
};

export const selectIsAccountWithSessionByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const coinjoinAccounts = selectCoinjoinAccounts(state);

    return coinjoinAccounts.find(a => a.key === accountKey && a.session && !a.session.paused);
};

export const selectFeeRateMedianByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const coinjoinClient = selectCoinjoinClient(state, accountKey);

    return coinjoinClient?.feeRateMedian || FEE_RATE_MEDIAN_FALLBACK;
};

export const selectDefaultMaxMiningFeeByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const feeRateMedian = selectFeeRateMedianByAccountKey(state, accountKey);
    const maxMiningFeeModifier = selectMaxMiningFeeModifier(state);
    const maxMiningFeeConfig = selectMaxMiningFeeConfig(state); // value defined in message system config has priority over default value (but not over custom value set by user)

    return maxMiningFeeConfig ?? getMaxFeePerVbyte(feeRateMedian, maxMiningFeeModifier);
};

// Coordinator fee rate a new session authorizes on the device: the rate of the coordinator's last
// round, capped by the network config or MAX_COORDINATOR_FEE_RATE.
export const selectMaxCoordinatorFeeRateByAccountKey = (
    state: CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const coinjoinClient = selectCoinjoinClient(state, accountKey);

    if (!coinjoinAccount || !coinjoinClient || !isCoinjoinSupportedSymbol(coinjoinAccount.symbol)) {
        return;
    }

    return Math.min(
        coinjoinClient.coordinationFeeRate.rate,
        selectCoordinatorFeeRateCapBySymbol(state, coinjoinAccount.symbol),
    );
};

export const selectMinAllowedInputWithFee = (state: CoinjoinRootState, accountKey: AccountKey) => {
    const coinjoinClient = selectCoinjoinClient(state, accountKey);
    const status = coinjoinClient || CLIENT_STATUS_FALLBACK;
    const minAllowedInput = status.allowedInputAmounts.min;
    const txSize = getInputSize('Taproot') + getOutputSize('Taproot');

    // Add estimated fee based on weekly median fee rate.
    return minAllowedInput + txSize * status.feeRateMedian;
};

export const selectIsNothingToAnonymizeByAccountKey = (
    state: AccountsRootState & CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const minAllowedInputWithFee = selectMinAllowedInputWithFee(state, accountKey);
    const account = selectAccountByKey(state, accountKey);
    const targetAnonymity =
        selectTargetAnonymityByAccountKey(state, accountKey) ?? DEFAULT_TARGET_ANONYMITY;

    const anonymitySet = account?.addresses?.anonymitySet || {};
    const utxos = account?.utxo || [];

    // Return true if all non-private funds are too small.
    return utxos
        .filter(utxo => (anonymitySet[utxo.address] ?? 1) < targetAnonymity)
        .every(utxo => new BigNumber(utxo.amount).lt(minAllowedInputWithFee));
};

export const selectWeightedAnonymityByAccountKey = (
    state: AccountsRootState & CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const account = selectAccountByKey(state, accountKey);
    const targetAnonymity =
        selectTargetAnonymityByAccountKey(state, accountKey) ?? DEFAULT_TARGET_ANONYMITY;

    const anonymitySet = account?.addresses?.anonymitySet || {};
    const utxos = account?.utxo || [];
    const weightedAnonymitySum = BigNumber.sum(
        0,
        ...utxos.map(utxo =>
            new BigNumber(utxo.amount).times(
                Math.min(targetAnonymity, anonymitySet[utxo.address] || 1),
            ),
        ),
    );
    const amountsSum = BigNumber.sum(0, ...utxos.map(utxo => utxo.amount));

    return amountsSum.isZero() ? 1 : weightedAnonymitySum.div(amountsSum).toNumber();
};

export const selectRoundsNeededByAccountKey = (
    state: AccountsRootState & CoinjoinRootState,
    accountKey: AccountKey,
) => {
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const targetAnonymity =
        selectTargetAnonymityByAccountKey(state, accountKey) ?? DEFAULT_TARGET_ANONYMITY;
    const weightedAnonymity = selectWeightedAnonymityByAccountKey(state, accountKey);
    const defaultAnonymityGainPerRound = state.wallet.coinjoin.config.averageAnonymityGainPerRound;

    const averageAnonymityGainPerRound = calculateAverageAnonymityGainPerRound(
        defaultAnonymityGainPerRound,
        coinjoinAccount?.anonymityGains?.history,
    );

    return Math.ceil(
        (targetAnonymity - weightedAnonymity) /
            Math.max(averageAnonymityGainPerRound, MIN_ANONYMITY_GAINED_PER_ROUND),
    );
};

export const selectRoundsLeftByAccountKey = (state: CoinjoinRootState, accountKey: AccountKey) => {
    const coinjoinSession = selectSessionByAccountKey(state, accountKey);

    if (!coinjoinSession) {
        return 0;
    }

    const { maxRounds, signedRounds } = coinjoinSession;

    return maxRounds - signedRounds.length;
};

export const selectHasAnonymitySetError = (state: SelectedAccountRootState) => {
    const selectedAccount = selectSelectedAccount(state);

    if (!selectedAccount) {
        return false;
    }

    const { addresses, utxo: utxos } = selectedAccount;

    const hasFaultyAnonymitySet = !utxos?.every(
        ({ address }) => addresses?.anonymitySet?.[address] !== undefined,
    );

    return hasFaultyAnonymitySet;
};

export const selectCoinjoinSessionBlockerByAccountKey = (
    state: CoinjoinRootState &
        DeviceRootState &
        LocksRootState &
        MessageSystemRootState &
        SelectedAccountRootState &
        SuiteOnlineRootState &
        TorRootState,
    accountKey: AccountKey | null,
) => {
    if (accountKey === null) {
        return;
    }

    if (selectSessionByAccountKey(state, accountKey)?.starting) {
        return 'SESSION_STARTING';
    }
    if (selectIsFeatureDisabled(state, Feature.coinjoin)) {
        return 'FEATURE_DISABLED';
    }
    if (selectCoinjoinClient(state, accountKey)?.status === 'unavailable') {
        return 'COORDINATOR_UNAVAILABLE';
    }
    if (!state.suite.online) {
        return 'OFFLINE';
    }
    if (selectIsNothingToAnonymizeByAccountKey(state, accountKey)) {
        return 'NOTHING_TO_ANONYMIZE';
    }
    if (!selectIsTorEnabled(state)) {
        return 'TOR_DISABLED';
    }
    if (!['connected', 'firmware-recommended'].includes(selectDeviceStatus(state) ?? '')) {
        return 'DEVICE_DISCONNECTED';
    }
    const account = selectAccountByKey(state, accountKey);
    if (account?.backendType === 'coinjoin' && account?.status === 'out-of-sync') {
        return 'ACCOUNT_OUT_OF_SYNC';
    }
    if (selectIsDeviceOrUiLocked(state)) {
        return 'DEVICE_LOCKED';
    }
    if (selectHasAnonymitySetError(state)) {
        return 'ANONYMITY_ERROR';
    }
};

export const selectCurrentCoinjoinWheelStates = (
    state: CoinjoinRootState &
        DeviceRootState &
        LocksRootState &
        MessageSystemRootState &
        SelectedAccountRootState &
        SuiteOnlineRootState &
        TorRootState,
) => {
    const { notAnonymized } = selectCurrentCoinjoinBalanceBreakdown(state);
    const { key, balance } = selectSelectedAccount(state) || {};
    const coinjoinAccount = selectCoinjoinAccountByKey(state, key || null);
    const coinjoinClient = selectCoinjoinClient(state, key || null);
    const sessionProgress = selectSessionProgressByAccountKey(state, key || null);

    const coinjoinSessionBlocker = selectCoinjoinSessionBlockerByAccountKey(state, key || null);

    const { paused } = coinjoinAccount?.session || {};

    // session states
    const isSessionActive = !!coinjoinAccount?.session;
    const isPaused = !!paused;
    const isLoading = coinjoinSessionBlocker === 'SESSION_STARTING';
    const isAutoStopEnabled = coinjoinAccount?.session?.isAutoStopEnabled;
    const isCriticalPhase = isRoundPhaseCritical(coinjoinAccount?.session?.roundPhase);

    // account states
    const isAccountEmpty = !balance || balance === '0';
    const isNonePrivate = sessionProgress === 0;
    const isAllPrivate = notAnonymized === '0';
    const isCoinjoinUneco = !!balance && new BigNumber(balance).lt(UNECONOMICAL_COINJOIN_THRESHOLD);

    const agreedToLegalDocumentVersions = coinjoinAccount?.agreedToLegalDocumentVersions;
    const latestTezorLegalDocumentVersion = state.wallet.coinjoin.config.legalDocumentsVersion;
    const latestZkSNACKsLegalDocumentVersion =
        coinjoinClient?.version?.legalDocumentsVersion ?? ZKSNACKS_LEGAL_DOCUMENTS_VERSION;

    const isLegalDocumentConfirmed =
        agreedToLegalDocumentVersions?.zkSNACKs === latestZkSNACKsLegalDocumentVersion &&
        agreedToLegalDocumentVersions.trezor === latestTezorLegalDocumentVersion;

    // error state
    const isResumeBlockedByLastingIssue =
        !!coinjoinSessionBlocker &&
        !['DEVICE_LOCKED', 'SESSION_STARTING'].includes(coinjoinSessionBlocker);

    return {
        isSessionActive,
        isPaused,
        isLoading,
        isAutoStopEnabled,
        isCriticalPhase,
        isAccountEmpty,
        isNonePrivate,
        isAllPrivate,
        isResumeBlockedByLastingIssue,
        isCoinjoinUneco,
        isLegalDocumentConfirmed,
    };
};

// return tuple of arguments used by startCoinjoinSession action
export const selectStartCoinjoinSessionArguments = (
    state: CoinjoinRootState & SelectedAccountRootState,
    accountKey: AccountKey,
) => {
    const selectedAccount = selectSelectedAccount(state);
    const coinjoinAccount = selectCoinjoinAccountByKey(state, accountKey);
    const maxCoordinatorFeeRate = selectMaxCoordinatorFeeRateByAccountKey(state, accountKey);
    const roundsNeeded = selectRoundsNeededByAccountKey(state, accountKey);
    const roundsFailRateBuffer = selectRoundsFailRateBuffer(state);
    const defaultMaxMiningFee = selectDefaultMaxMiningFeeByAccountKey(state, accountKey);
    const targetAnonymity =
        selectTargetAnonymityByAccountKey(state, accountKey) ?? DEFAULT_TARGET_ANONYMITY;

    // Without a coinjoin client there is no fee rate to authorize.
    if (!selectedAccount || !coinjoinAccount || maxCoordinatorFeeRate === undefined) return;

    const maxFeePerKvbyte = (coinjoinAccount.setup?.maxFeePerVbyte ?? defaultMaxMiningFee) * 1000; // Transform to kvB.
    const maxRounds = getMaxRounds(roundsNeeded, roundsFailRateBuffer);
    const skipRounds = getSkipRounds(
        coinjoinAccount.setup ? coinjoinAccount.setup.skipRounds : SKIP_ROUNDS_BY_DEFAULT,
    );

    return [
        selectedAccount,
        {
            maxCoordinatorFeeRate,
            maxFeePerKvbyte,
            maxRounds,
            skipRounds,
            targetAnonymity,
        },
    ] as const;
};

export const selectCurrentSessionDeadlineInfo = (
    state: CoinjoinRootState & SelectedAccountRootState,
) => {
    const session = selectCurrentCoinjoinSession(state);

    const { roundPhase, roundPhaseDeadline, sessionDeadline } = session || {};

    return {
        roundPhase,
        roundPhaseDeadline,
        sessionDeadline,
    };
};

// Return true if it's not explicitly set to false in the message-system config.
export const selectIsPublic = (state: MessageSystemRootState) =>
    selectFeatureConfig(state, Feature.coinjoin)?.isPublic !== false;

export const selectIsSessionAutostopped = (state: CoinjoinRootState, accountKey: AccountKey) => {
    const currentState = selectSessionByAccountKey(state, accountKey);

    return !!currentState?.isAutoStopEnabled;
};
