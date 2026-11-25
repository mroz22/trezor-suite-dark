import { createAction } from '@reduxjs/toolkit';

import { type LocksRootState, selectIsDeviceLocked } from '@suite/locks';
import { type ModalRootState, closeModal, openModal, selectModal } from '@suite/modal';
import { type DeviceRootState, selectDevices } from '@suite-common/device';
import {
    Feature,
    type MessageSystemRootState,
    selectIsFeatureDisabled,
} from '@suite-common/message-system';
import { getDeviceInstances } from '@suite-common/suite-utils';
import { notificationsActions } from '@suite-common/toast-notifications';
import {
    type AccountsRootState,
    type WalletSettingsRootState,
    selectAccountByKey,
    selectAccounts,
    selectAddressDisplayType,
} from '@suite-common/wallet-core';
import { type Account, type AccountKey, AddressDisplayOptions } from '@suite-common/wallet-types';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import {
    type CoinjoinClient,
    type CoinjoinClientEvents,
    type CoinjoinClientVersion,
    type CoinjoinPrisonInmate,
    type CoinjoinRequestEvent,
    type CoinjoinResponseEvent,
    type CoinjoinRoundEvent,
    type CoinjoinStatusEvent,
    RoundPhase,
    type SerializedCoinjoinRound,
} from '@trezor/coinjoin';
import TrezorConnect from '@trezor/connect';
import { asCoinSymbol } from '@trezor/connect-common';
import { getOsName } from '@trezor/env-utils';
import { type Dispatch } from '@trezor/redux-utils';
import { arrayDistinct, arrayToDictionary, promiseAllSequence } from '@trezor/utils';

import * as COINJOIN from './coinjoinConstants';
import {
    blockRejectedCoinjoinPaymentsThunk,
    recordCoinjoinPaymentAttemptsThunk,
} from './coinjoinPaymentActions';
import {
    type CoinjoinRootState,
    selectCoinjoinAccounts,
    selectCoinjoinClients,
    selectCoinjoinNetworkConfig,
    selectHasCoinjoinSessionBySymbol,
    selectRoundsDurationInHours,
    selectRoundsLeftByAccountKey,
    selectRoundsNeededByAccountKey,
} from './coinjoinSelectors';
import { CoinjoinService } from './coinjoinService';
import { type CoinjoinAccount, type CoinjoinDebugSettings, EndRoundState } from './coinjoinTypes';
import {
    getChangeAddressesUpToLastUsed,
    getEstimatedTimePerRound,
    getSessionDeadline,
    isCoinjoinSupportedSymbol,
    prepareCoinjoinTransaction,
} from './coinjoinUtils';
import { type CoinjoinSymbol } from './config';

const clientEnable = createAction(COINJOIN.CLIENT_ENABLE, (symbol: Account['symbol']) => ({
    payload: { symbol },
}));

export const clientDisable = createAction(COINJOIN.CLIENT_DISABLE, (symbol: Account['symbol']) => ({
    payload: { symbol },
}));

export const clientEnableSuccess = createAction(
    COINJOIN.CLIENT_ENABLE_SUCCESS,
    (
        symbol: Account['symbol'],
        { version, ...status }: CoinjoinStatusEvent & { version: CoinjoinClientVersion },
    ) => ({ payload: { symbol, status, version } }),
);

export const clientEnableFailed = createAction(
    COINJOIN.CLIENT_ENABLE_FAILED,
    (symbol: Account['symbol']) => ({ payload: { symbol } }),
);

const clientOnStatusEvent = createAction(
    COINJOIN.CLIENT_STATUS,
    (symbol: Account['symbol'], status: CoinjoinStatusEvent) => ({
        payload: { symbol, status },
    }),
);

export const clientOnPrisonEvent = createAction(
    COINJOIN.CLIENT_PRISON_EVENT,
    (event: CoinjoinClientEvents['prison']) => ({ payload: event.prison }),
);

export const clientSessionRoundChanged = createAction(
    COINJOIN.SESSION_ROUND_CHANGED,
    (accountKey: string, round: SerializedCoinjoinRound, sessionDeadline: number) => ({
        payload: { accountKey, round, sessionDeadline },
    }),
);

export const coinjoinSessionCompleted = createAction(
    COINJOIN.SESSION_COMPLETED,
    (accountKey: string) => ({ payload: { accountKey } }),
);

const clientSessionTxSigned = createAction(
    COINJOIN.SESSION_TX_SIGNED,
    (payload: {
        accountKey: string;
        roundId: string;
        rawLiquidityClue: CoinjoinAccount['rawLiquidityClue'];
    }) => ({ payload }),
);

const clientSessionTxCandidate = createAction(
    COINJOIN.SESSION_TX_CANDIDATE,
    (accountKey: string, roundId: string) => ({ payload: { accountKey, roundId } }),
);

export const clientSessionTxBroadcasted = createAction(
    COINJOIN.SESSION_TX_BROADCASTED,
    (accountKeys: string[], round: SerializedCoinjoinRound) => ({
        payload: { accountKeys, round },
    }),
);

const clientSessionTxFailed = createAction(
    COINJOIN.SESSION_TX_FAILED,
    (accountKeys: string[], round: SerializedCoinjoinRound) => ({
        payload: { accountKeys, round },
    }),
);

export const clientSessionPhase = createAction(
    COINJOIN.CLIENT_SESSION_PHASE,
    (payload: CoinjoinClientEvents['session-phase']) => ({ payload }),
);

export const setDebugSettings = createAction(
    COINJOIN.SET_DEBUG_SETTINGS,
    (payload: CoinjoinDebugSettings) => ({ payload }),
);

export const chooseCoordinator = createAction(
    COINJOIN.CHOOSE_COORDINATOR,
    (symbol: CoinjoinSymbol, coordinatorUrl: string) => ({ payload: { symbol, coordinatorUrl } }),
);

export const coinjoinSessionPause = createAction(COINJOIN.SESSION_PAUSE, (accountKey: string) => ({
    payload: { accountKey },
}));

export const coinjoinAccountUnregister = createAction(
    COINJOIN.ACCOUNT_UNREGISTER,
    (accountKey: string) => ({ payload: { accountKey } }),
);

export type CoinjoinClientAction = ReturnType<
    | typeof setDebugSettings
    | typeof chooseCoordinator
    | typeof clientEnable
    | typeof clientDisable
    | typeof clientEnableSuccess
    | typeof clientEnableFailed
    | typeof clientOnStatusEvent
    | typeof clientOnPrisonEvent
    | typeof clientSessionRoundChanged
    | typeof coinjoinSessionCompleted
    | typeof clientSessionPhase
    | typeof clientSessionTxSigned
    | typeof clientSessionTxCandidate
    | typeof clientSessionTxBroadcasted
    | typeof clientSessionTxFailed
    | typeof coinjoinSessionPause
    | typeof coinjoinAccountUnregister
>;

// return only active instances
export const getCoinjoinClient = (symbol: CoinjoinSymbol) =>
    CoinjoinService.getInstance(symbol)?.client;

type UnregisterByAccountKeyThunkState = AccountsRootState;

export const unregisterByAccountKeyThunk =
    (accountKey: string) =>
    (_dispatch: Dispatch, getState: () => UnregisterByAccountKeyThunkState) => {
        const accounts = selectAccounts(getState());
        const realAccount = accounts.find(a => a.key === accountKey);

        const client =
            realAccount && isCoinjoinSupportedSymbol(realAccount.symbol)
                ? getCoinjoinClient(realAccount.symbol)
                : undefined;

        if (client) {
            client.unregisterAccount(accountKey);
        }
    };

export const endCoinjoinSession = (accountKey: string) => (dispatch: Dispatch) => {
    dispatch(coinjoinSessionCompleted(accountKey));
    dispatch(unregisterByAccountKeyThunk(accountKey));
};

type SetBusyScreenThunkState = AccountsRootState & DeviceRootState;

/**
 * Show "do not disconnect" screen on Trezor.
 * Multiple possible setups:
 * - 1 account on 1 device
 * - N accounts on 1 devices (like two passphrases)
 * - N accounts on X devices (like two physical device)
 */
export const setBusyScreenThunk =
    (accountKeys: string[], expiry?: number) =>
    (_dispatch: Dispatch, getState: () => SetBusyScreenThunkState) => {
        const accounts = selectAccounts(getState());
        const devices = selectDevices(getState());

        // collect unique deviceStates from accounts (passphrase)
        const uniqueDeviceStates = accountKeys.flatMap(key => {
            const account = accounts.find(a => a.key === key);

            return account?.deviceState || [];
        });

        // collect unique physical devices (by device.id)
        const uniquePhysicalDevices = uniqueDeviceStates.reduce(
            (result, state) => {
                const device = devices.find(d => d.connected && d.state?.staticSessionId === state);
                if (device && !result.some(d => d.id === device.id)) {
                    return result.concat(device);
                }

                return result;
            },
            [] as typeof devices,
        );

        // async actions on each physical device in sequence
        return promiseAllSequence(
            uniquePhysicalDevices.map(device => () => {
                if (!expiry && !device.features?.busy) {
                    // skip unnecessary call if device is not in busy state
                    return Promise.resolve();
                }

                return TrezorConnect.setBusy({
                    device: { path: device?.path },
                    keepSession: !!expiry, // do not release device session, keep it for signTransaction
                    expiry_ms: expiry,
                });
            }),
        );
    };

type HasCriticalPhaseModalThunkState = ModalRootState;

export const hasCriticalPhaseModalThunk =
    () => (_: Dispatch, getState: () => HasCriticalPhaseModalThunkState) => {
        const modal = selectModal(getState());

        return 'payload' in modal && modal.payload.type === 'critical-coinjoin-phase';
    };

export const closeCriticalPhaseModal = () => (dispatch: Dispatch) => {
    if (dispatch(hasCriticalPhaseModalThunk())) {
        dispatch(closeModal());
    }
};

type PauseCoinjoinSessionThunkState = AccountsRootState;

// called from coinjoin account UI or exceptions like device disconnection, forget wallet/account etc.
export const pauseCoinjoinSessionThunk =
    (accountKey: AccountKey) =>
    (dispatch: Dispatch, getState: () => PauseCoinjoinSessionThunkState) => {
        const account = selectAccountByKey(getState(), accountKey);

        if (!account || !isCoinjoinSupportedSymbol(account.symbol)) {
            return;
        }
        // get @trezor/coinjoin client if available
        const client = getCoinjoinClient(account.symbol);

        // unregister account in @trezor/coinjoin
        client?.unregisterAccount(accountKey);

        // dispatch data to reducer
        dispatch(coinjoinSessionPause(accountKey));
    };

type GetDeviceToCancelCoinjoinAuthorizationState = AccountsRootState &
    CoinjoinRootState &
    DeviceRootState;

// cancelCoinjoinAuthorization should be called only if there is no other registered coinjoin account
const getDeviceToCancelCoinjoinAuthorization = (
    state: GetDeviceToCancelCoinjoinAuthorizationState,
    account: Account,
) => {
    const devices = selectDevices(state);
    const accounts = selectAccounts(state);
    const coinjoinAccounts = selectCoinjoinAccounts(state);
    const device = devices.find(d => d.state?.staticSessionId === account.deviceState);
    let shouldCancelAuthorization = device?.connected;
    if (device) {
        // find all instances of this physical device
        const deviceInstances = getDeviceInstances(device, devices);
        // find other coinjoin accounts related to this physical device
        const otherAccounts = deviceInstances.flatMap(d =>
            accounts.filter(
                a =>
                    a.accountType === 'coinjoin' &&
                    a.key !== account.key &&
                    a.deviceState === d.state?.staticSessionId,
            ),
        );
        // find coinjoin account with session
        const otherRegisteredAccounts = otherAccounts.flatMap(a =>
            coinjoinAccounts.filter(cja => cja.key === a.key && cja.session),
        );
        if (otherRegisteredAccounts.length > 0) {
            shouldCancelAuthorization = false;
        }
    }

    return shouldCancelAuthorization ? device : undefined;
};

const cancelCoinjoinAuthorizationErrorToast = (message: string) =>
    notificationsActions.addToast({
        type: 'error',
        error: `Cancel coinjoin authorization ${message}`,
    });

type StopCoinjoinSessionThunkState = AccountsRootState & CoinjoinRootState & DeviceRootState;

// called from coinjoin account UI or exceptions like device disconnection, forget wallet/account etc.
export const stopCoinjoinSessionThunk =
    (accountKey: AccountKey) =>
    async (dispatch: Dispatch, getState: () => StopCoinjoinSessionThunkState) => {
        const account = selectAccountByKey(getState(), accountKey);

        if (!account || !isCoinjoinSupportedSymbol(account.symbol)) {
            return;
        }

        // get @trezor/coinjoin client if available
        const client = getCoinjoinClient(account.symbol);
        // unregister account in @trezor/coinjoin
        client?.unregisterAccount(account.key);

        const device = getDeviceToCancelCoinjoinAuthorization(getState(), account);
        if (device) {
            const result = await TrezorConnect.cancelCoinjoinAuthorization({ device });

            if (!result.success) {
                dispatch(cancelCoinjoinAuthorizationErrorToast(result.error.message));
            }
        }

        // dispatch data to reducer
        dispatch(coinjoinAccountUnregister(accountKey));
    };

type StopCoinjoinSessionsOnCoordinatorMisbehaviorThunkState = AccountsRootState &
    CoinjoinRootState &
    DeviceRootState &
    ModalRootState;

// The client unregistered its accounts, its coordinator provably lied. End the sessions of all
// accounts of its network, paused and restoring ones too: a paused session would be restored
// automatically (e.g. when its account syncs) and rejoin the coordinator. The sessions end before
// onCoinjoinRoundChangedThunk handles the end of the round, so it skips them and only this thunk
// uses the devices. It ends the round on them as onCoinjoinRoundChangedThunk does before
// autostop, then cancels the authorizations as stopCoinjoinSessionThunk does.
export const stopCoinjoinSessionsOnCoordinatorMisbehaviorThunk =
    (accountKeys: string[]) =>
    async (
        dispatch: Dispatch,
        getState: () => StopCoinjoinSessionsOnCoordinatorMisbehaviorThunkState,
    ) => {
        const accounts = selectAccounts(getState());
        const coinjoinAccounts = selectCoinjoinAccounts(getState());
        const symbols = accounts.flatMap(({ key, symbol }) =>
            accountKeys.includes(key) ? symbol : [],
        );
        const accountsWithSession = accounts.filter(
            ({ key, symbol }) =>
                symbols.includes(symbol) &&
                coinjoinAccounts.some(account => account.key === key && account.session),
        );

        accountsWithSession.forEach(({ key }) => dispatch(coinjoinAccountUnregister(key)));
        dispatch(
            notificationsActions.addToast({
                type: 'coinjoin-coordinator-misbehavior',
                autoClose: false,
            }),
        );

        if (accountsWithSession.length === 0) return;

        await dispatch(setBusyScreenThunk(accountsWithSession.map(({ key }) => key)));
        dispatch(closeCriticalPhaseModal());

        // Once per physical device, stopCoinjoinSessionThunk cancels it with its last session.
        const devicesToCancel = arrayToDictionary(
            accountsWithSession.flatMap(
                account => getDeviceToCancelCoinjoinAuthorization(getState(), account) ?? [],
            ),
            ({ id }) => id,
        );
        await promiseAllSequence(
            Object.values(devicesToCancel).map(device => async () => {
                const result = await TrezorConnect.cancelCoinjoinAuthorization({ device });

                if (!result.success) {
                    dispatch(cancelCoinjoinAuthorizationErrorToast(result.error.message));
                }
            }),
        );
    };

type OnCoinjoinRoundChangedThunkState = AccountsRootState & CoinjoinRootState;

export const onCoinjoinRoundChangedThunk =
    ({ round }: CoinjoinRoundEvent) =>
    async (dispatch: Dispatch, getState: () => OnCoinjoinRoundChangedThunkState) => {
        // Suite Dark: pay in coinjoin, keep a payment refused for its payee or amount blocked.
        dispatch(blockRejectedCoinjoinPaymentsThunk(round));

        const coinjoinAccounts = selectCoinjoinAccounts(getState());
        const roundsDurationInHours = selectRoundsDurationInHours(getState());
        // collect all account.keys from the round including failed one
        const accountKeys = round.inputs
            .concat(round.failed)
            .map(input => input.accountKey as AccountKey)
            .filter(arrayDistinct);

        const currentTimestamp = Date.now();

        const coinjoinAccountsWithSession = accountKeys
            .flatMap(
                accountKey => coinjoinAccounts.find(r => r.key === accountKey && r.session) || [],
            )
            .map(account => ({
                account,
                roundsLeft: selectRoundsLeftByAccountKey(getState(), account.key),
                roundsNeeded: selectRoundsNeededByAccountKey(getState(), account.key),
            }));

        let phaseChanged = false;
        coinjoinAccountsWithSession.forEach(({ account, roundsLeft, roundsNeeded }) => {
            if (account.session?.roundPhase !== round.phase) {
                phaseChanged = true;
            }

            const sessionDeadline = getSessionDeadline({
                currentTimestamp,
                roundDeadline: round.roundDeadline,
                timePerRound: getEstimatedTimePerRound(
                    roundsDurationInHours,
                    account.session?.skipRounds,
                ),
                roundsLeft,
                roundsNeeded,
            });

            // notify reducers
            dispatch(clientSessionRoundChanged(account.key, round, sessionDeadline));
        });

        // round event is triggered multiple times. like at the beginning and at the end of round process
        // critical actions should be triggered only once
        if (phaseChanged) {
            if (round.phase === RoundPhase.Ended) {
                await dispatch(setBusyScreenThunk(accountKeys));
                dispatch(closeCriticalPhaseModal());

                if (round.endRoundState === EndRoundState.TransactionBroadcasted) {
                    dispatch(clientSessionTxBroadcasted(accountKeys, round));
                } else {
                    dispatch(clientSessionTxFailed(accountKeys, round));
                }

                const accountsReachingMaxRounds = coinjoinAccountsWithSession.filter(
                    ({ account: { session } }) =>
                        session?.signedRounds?.length === session?.maxRounds,
                );
                if (accountsReachingMaxRounds.length) {
                    dispatch(openModal({ type: 'more-rounds-needed' }));
                    accountsReachingMaxRounds.forEach(({ account: { key } }) => {
                        dispatch(endCoinjoinSession(key));
                    });
                }

                const accountsWithAutostop = coinjoinAccountsWithSession.filter(
                    ({ account: { key, session } }) =>
                        !accountsReachingMaxRounds.some(({ account }) => account.key === key) &&
                        session?.isAutoStopEnabled,
                );

                accountsWithAutostop.forEach(({ account: { key } }) => {
                    dispatch(stopCoinjoinSessionThunk(key));
                });
            } else if (
                round.phase > RoundPhase.InputRegistration &&
                !dispatch(hasCriticalPhaseModalThunk())
            ) {
                await dispatch(setBusyScreenThunk(accountKeys, round.roundDeadline - Date.now()));

                dispatch(
                    openModal({
                        type: 'critical-coinjoin-phase',
                        relatedAccountKey: coinjoinAccountsWithSession[0]?.account.key ?? '', // since all accounts share the round, any key can be used,
                    }),
                );
            }
        }
    };

// populate errors for failed subset of requested inputs
const coinjoinResponseError = (utxos: CoinjoinRequestEvent['inputs'], error: string) =>
    utxos.map(u => ({ outpoint: u.outpoint, error }));

type GetOwnershipProofThunkState = AccountsRootState &
    CoinjoinRootState &
    DeviceRootState &
    LocksRootState;

const getOwnershipProofThunk =
    (request: Extract<CoinjoinRequestEvent, { type: 'ownership' }>) =>
    async (_dispatch: Dispatch, getState: () => GetOwnershipProofThunkState) => {
        const coinjoinAccounts = selectCoinjoinAccounts(getState());
        const accounts = selectAccounts(getState());
        const devices = selectDevices(getState());
        const isDeviceLocked = selectIsDeviceLocked(getState());

        // prepare empty response object
        const response: CoinjoinResponseEvent = {
            type: request.type,
            roundId: request.roundId,
            inputs: [],
        };

        // group utxos by account
        const groupUtxosByAccount = arrayToDictionary(
            request.inputs,
            utxo => utxo.accountKey,
            true,
        );

        // prepare array of parameters for TrezorConnect, grouped by TrezorDevice
        const groupParamsByDevice = Object.keys(groupUtxosByAccount).flatMap(key => {
            const coinjoinAccount = coinjoinAccounts.find(r => r.key === key);
            const realAccount = accounts.find(a => a.key === key);
            const utxos = groupUtxosByAccount[key] ?? [];
            if (!coinjoinAccount || !realAccount) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Account not found'));

                return [];
            }
            const { session } = coinjoinAccount;
            // do not provide ownership if requested account is no longer authorized
            if (!session || session.paused || session.signedRounds.length >= session.maxRounds) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Account without session'));

                return [];
            }

            const device = devices.find(d => d.state?.staticSessionId === realAccount.deviceState);
            if (!device?.connected) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Device disconnected'));

                return [];
            }

            if (isDeviceLocked) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Device locked'));

                return [];
            }

            // TODO: double check if requested utxo exists in account?

            const bundle = (groupUtxosByAccount[key] ?? []).map(utxo => ({
                path: utxo.path,
                coin: asCoinSymbol(realAccount.symbol),
                commitmentData: request.commitmentData,
                userConfirmation: true,
                preauthorized: true,
            }));

            return { key, device, bundle, utxos };
        });

        // process all bundles in sequence one device by one, fill the response object
        await promiseAllSequence(
            groupParamsByDevice.map(({ device, bundle, utxos }) => async () => {
                const proof = await TrezorConnect.getOwnershipProof({ device, bundle });
                if (proof.success) {
                    proof.payload.forEach((p, i) => {
                        const utxo = utxos[i];
                        if (!utxo) return; // double check if data from Trezor corresponds with request
                        response.inputs.push({
                            outpoint: utxo.outpoint,
                            ownershipProof: p.ownership_proof,
                        });
                    });

                    return;
                }
                utxos.forEach(u => {
                    response.inputs.push({
                        outpoint: u.outpoint,
                        error: proof.error?.message,
                    });
                });
            }),
        );

        // finally walk thru all requested utxos and find not resolved
        request.inputs.forEach(utxo => {
            if (!response.inputs.find(u => u.outpoint === utxo.outpoint)) {
                response.inputs.push({ outpoint: utxo.outpoint, error: 'Request unresolved' });
            }
        });

        return response;
    };

interface ClientEmitExceptionOptions {
    symbol?: Account['symbol'];
}

// use CoinjoinClient emitter to log/throw exceptions
// exceptions will be reported to sentry in suite-desktop build
export const clientEmitException =
    (reason: string, options: ClientEmitExceptionOptions = {}) =>
    () => {
        (options.symbol && isCoinjoinSupportedSymbol(options.symbol)
            ? [CoinjoinService.getInstance(options.symbol)]
            : CoinjoinService.getInstances()
        ).forEach(instance => {
            instance?.client.emit('log', { level: 'error', payload: reason });
        });
    };

type SignCoinjoinTxThunkState = AccountsRootState &
    CoinjoinRootState &
    DeviceRootState &
    WalletSettingsRootState;

const signCoinjoinTxThunk =
    (request: Extract<CoinjoinRequestEvent, { type: 'signature' }>) =>
    async (dispatch: Dispatch, getState: () => SignCoinjoinTxThunkState) => {
        const coinjoinAccounts = selectCoinjoinAccounts(getState());
        const accounts = selectAccounts(getState());
        const devices = selectDevices(getState());
        const addressDisplayType = selectAddressDisplayType(getState());

        // prepare empty response object
        const response: CoinjoinResponseEvent = {
            type: request.type,
            roundId: request.roundId,
            inputs: [],
        };

        // group utxos by account
        const groupUtxosByAccount = arrayToDictionary(
            request.inputs,
            utxo => utxo.accountKey,
            true,
        );

        const groupParamsByDevice = Object.keys(groupUtxosByAccount).flatMap(key => {
            const coinjoinAccount = coinjoinAccounts.find(r => r.key === key);
            const realAccount = accounts.find(a => a.key === key);
            const utxos = groupUtxosByAccount[key] ?? [];
            if (!coinjoinAccount || !realAccount) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Account not found'));

                return [];
            }

            const { session, rawLiquidityClue } = coinjoinAccount;
            if (!session || session.signedRounds.length >= session.maxRounds) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Account without session'));

                return [];
            }

            const device = devices.find(d => d.state?.staticSessionId === realAccount.deviceState);
            if (!device?.connected) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Device disconnected'));

                return [];
            }

            // Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md. Save the attempts
            // before signing them; an account whose attempts are not saved does not sign.
            const attempts = request.payments.filter(({ accountKey }) => accountKey === key);
            if (
                attempts.length > 0 &&
                !dispatch(recordCoinjoinPaymentAttemptsThunk(coinjoinAccount.key, attempts))
            ) {
                response.inputs.push(...coinjoinResponseError(utxos, 'Payment not recorded'));

                return [];
            }

            const tx = prepareCoinjoinTransaction(realAccount, request.transaction);

            return {
                device,
                unlockPath: realAccount.unlockPath,
                tx,
                utxos,
                roundId: request.roundId,
                key,
                network: realAccount.symbol,
                rawLiquidityClue,
            };
        });

        // sign all transactions in sequence one device by one, fill the response object
        await promiseAllSequence(
            groupParamsByDevice.map(
                ({ device, tx, utxos, roundId, key, network, unlockPath, rawLiquidityClue }) =>
                    async () => {
                        // notify reducer before signing, failed signing are also counted in Trezor maxRound limit
                        dispatch(
                            clientSessionTxSigned({
                                accountKey: key,
                                roundId,
                                rawLiquidityClue:
                                    request.liquidityClues.find(l => l.accountKey === key)
                                        ?.rawLiquidityClue || rawLiquidityClue,
                            }),
                        );

                        const signTx = await TrezorConnect.signTransaction({
                            version: 1, // Coinjoin requires the 1, the default is now 2, as most wallets have 2
                            device,
                            inputs: tx.inputs,
                            outputs: tx.outputs,
                            coinjoinRequest: tx.coinjoinRequest,
                            coin: asCoinSymbol(network),
                            preauthorized: true,
                            serialize: false,
                            unlockPath,
                            chunkify: addressDisplayType === AddressDisplayOptions.CHUNKED,
                        });

                        if (signTx.success) {
                            let utxoIndex = 0;
                            tx.inputs.forEach((input, index) => {
                                const utxo = utxos[utxoIndex];
                                const signature = signTx.payload.signatures[index];
                                if (input.script_type !== 'EXTERNAL' && utxo && signature) {
                                    response.inputs.push({
                                        outpoint: utxo.outpoint,
                                        signature,
                                        index,
                                    });
                                    utxoIndex++;
                                }
                            });

                            // create tx candidate
                            dispatch(clientSessionTxCandidate(key, roundId));

                            return;
                        }

                        const fwVersion = `${device?.features?.major_version}.${device?.features?.minor_version}.${device?.features?.patch_version}-${device?.features?.revision}`;
                        utxos.forEach(u => {
                            response.inputs.push({
                                outpoint: u.outpoint,
                                error: `${fwVersion} (${getOsName()}) ${signTx.error.message}`,
                            });
                        });

                        dispatch(
                            notificationsActions.addToast({
                                type: 'error',
                                error: `Coinjoin signTransaction: ${signTx.error.message}`,
                            }),
                        );
                    },
            ),
        );

        // disable busy screen
        await dispatch(setBusyScreenThunk(Object.keys(groupUtxosByAccount)));
        // and close 'critical-coinjoin-phase' modal
        dispatch(closeCriticalPhaseModal());

        // finally walk thru all requested utxos and find not resolved
        request.inputs.forEach(utxo => {
            if (!response.inputs.find(u => u.outpoint === utxo.outpoint)) {
                response.inputs.push({ outpoint: utxo.outpoint, error: 'Request unresolved' });
            }
        });

        return response;
    };

export const onCoinjoinClientRequest = (data: CoinjoinRequestEvent[]) => (dispatch: Dispatch) =>
    Promise.all(
        data.map(request => {
            if (request.type === 'ownership') {
                return dispatch(getOwnershipProofThunk(request));
            }
            if (request.type === 'signature') {
                return dispatch(signCoinjoinTxThunk(request));
            }

            return request;
        }),
    );

// Restores the prison of a new client from the coinjoin accounts of its network, without outdated
// inmates.
const getClientPrison = (
    state: AccountsRootState & CoinjoinRootState,
    symbol: CoinjoinSymbol,
): CoinjoinPrisonInmate[] =>
    selectCoinjoinAccounts(state)
        .filter(account => account.symbol === symbol && account.prison)
        .flatMap(account => {
            const realAccount = selectAccountByKey(state, account.key);
            if (!realAccount) return [];

            const utxos = realAccount.utxo!.map(getUtxoOutpoint);
            const changeUpToLastUsed = new Set(
                getChangeAddressesUpToLastUsed(realAccount.addresses!.change).map(a => a.address),
            );

            return Object.entries(account.prison ?? {}).flatMap(([id, inmate]) => {
                // clear outdated info with Infinity sentence
                if (inmate.sentenceEnd === Infinity) {
                    // utxos which are no longer in account (spent utxos)
                    if (inmate.type === 'input' && !utxos.includes(id)) {
                        return [];
                    }
                    // change addresses which the client no longer gets (used, skipped or
                    // registered in failed rounds)
                    if (inmate.type === 'output' && changeUpToLastUsed.has(id)) {
                        return [];
                    }
                }

                return {
                    id,
                    accountKey: account.key,
                    ...inmate,
                };
            });
        });

// Enables a new client of the network and handles its events.
const enableClientThunk =
    (symbol: CoinjoinSymbol, client: CoinjoinClient) => async (dispatch: Dispatch) => {
        const status = await client.enable();
        // handle status change
        client.on('status', status => dispatch(clientOnStatusEvent(symbol, status)));
        // handle prison event
        client.on('prison', event => dispatch(clientOnPrisonEvent(event)));
        // handle active round change
        client.on('round', event => dispatch(onCoinjoinRoundChangedThunk(event)));
        // handle requests (ownership proof, sign transaction)
        client.on('request', async data => {
            const response = await dispatch(onCoinjoinClientRequest(data));
            client.resolveRequest(response);
        });
        // handle session phase change
        client.on('session-phase', event => dispatch(clientSessionPhase(event)));

        if (!status.success) {
            dispatch(clientEnableFailed(symbol));
        } else {
            dispatch(clientEnableSuccess(symbol, status));
        }
    };

type InitCoinjoinServiceThunkState = AccountsRootState & CoinjoinRootState & MessageSystemRootState;

export const initCoinjoinServiceThunk =
    (symbol: Account['symbol']) =>
    async (dispatch: Dispatch, getState: () => InitCoinjoinServiceThunkState) => {
        const clients = selectCoinjoinClients(getState());

        if (!isCoinjoinSupportedSymbol(symbol)) return;

        const knownClient = clients[symbol];
        if (knownClient?.status === 'loading') return;

        // find already running instance of @trezor/coinjoin client
        const knownService = CoinjoinService.getInstance(symbol);
        if (knownService && knownClient?.status === 'loaded') {
            return knownService;
        }

        const isCoinjoinDisabledByFeatureFlag = selectIsFeatureDisabled(
            getState(),
            Feature.coinjoin,
        );
        // retry if client was not enabled properly until now
        if (knownService && knownClient?.status === 'unavailable') {
            if (!isCoinjoinDisabledByFeatureFlag) {
                const { client } = knownService;
                const status = await client.enable();
                // Unless the client was replaced for another coordinator meanwhile.
                if (status.success && knownService.client === client) {
                    dispatch(clientEnableSuccess(symbol, status));
                }
            }

            return knownService;
        }

        // or start new instance
        dispatch(clientEnable(symbol));

        const prison = getClientPrison(getState(), symbol);

        try {
            const service = await CoinjoinService.createInstance({
                symbol,
                prison,
                settings: selectCoinjoinNetworkConfig(getState(), symbol),
            });
            if (isCoinjoinDisabledByFeatureFlag) {
                dispatch(clientEnableFailed(symbol));

                return service;
            }
            await dispatch(enableClientThunk(symbol, service.client));

            return service;
        } catch (error) {
            CoinjoinService.removeInstance(symbol);
            dispatch(clientDisable(symbol));
            dispatch(
                notificationsActions.addToast({
                    type: 'error',
                    error: `CoinjoinClient ${error.message}`,
                }),
            );
        }
    };

type ChooseCoinjoinCoordinatorThunkState = InitCoinjoinServiceThunkState;

export const chooseCoinjoinCoordinatorThunk =
    (symbol: CoinjoinSymbol, coordinatorUrl: string) =>
    async (dispatch: Dispatch, getState: () => ChooseCoinjoinCoordinatorThunkState) => {
        // A session authorized its coordinator on the device. A client being enabled would keep
        // the previous one.
        if (
            selectHasCoinjoinSessionBySymbol(getState(), symbol) ||
            selectCoinjoinClients(getState())[symbol]?.status === 'loading'
        ) {
            return;
        }

        const previousCoordinatorUrl = selectCoinjoinNetworkConfig(
            getState(),
            symbol,
        ).coordinatorUrl;
        dispatch(chooseCoordinator(symbol, coordinatorUrl));
        const settings = selectCoinjoinNetworkConfig(getState(), symbol);
        // Without a client, the next one is created with the chosen coordinator.
        if (
            settings.coordinatorUrl === previousCoordinatorUrl ||
            !CoinjoinService.getInstance(symbol)
        ) {
            return;
        }

        dispatch(clientDisable(symbol));
        dispatch(clientEnable(symbol));

        try {
            const service = await CoinjoinService.replaceClient({
                symbol,
                prison: getClientPrison(getState(), symbol),
                settings,
            });
            // Removed meanwhile, the next client is created with the chosen coordinator.
            if (!service) {
                dispatch(clientDisable(symbol));

                return;
            }

            if (selectIsFeatureDisabled(getState(), Feature.coinjoin)) {
                dispatch(clientEnableFailed(symbol));

                return;
            }
            await dispatch(enableClientThunk(symbol, service.client));
        } catch (error) {
            CoinjoinService.removeInstance(symbol);
            dispatch(clientDisable(symbol));
            dispatch(
                notificationsActions.addToast({
                    type: 'error',
                    error: `CoinjoinClient ${error.message}`,
                }),
            );
        }
    };
