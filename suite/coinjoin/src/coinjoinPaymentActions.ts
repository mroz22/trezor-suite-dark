// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import { createAction } from '@reduxjs/toolkit';

import { type DeviceRootState } from '@suite-common/device';
import {
    type AccountsRootState,
    type TransactionsRootState,
    type WalletSettingsRootState,
    selectAccountTransactions,
} from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { type CoinjoinPaymentAttempt, type SerializedCoinjoinRound } from '@trezor/coinjoin';
import { type Dispatch } from '@trezor/redux-utils';
import { getRandomString } from '@trezor/utils';

import * as COINJOIN from './coinjoinConstants';
import { selectIsCoinjoinPaymentAvailableByAccountKey } from './coinjoinPaymentAvailability';
import {
    selectCoinjoinPaymentByAccountKey,
    selectCoinjoinPaymentFundingByAccountKey,
} from './coinjoinPaymentSelectors';
import {
    addCoinjoinPaymentAttempts,
    getSyncedCoinjoinPayment,
    isCoinjoinPaymentPending,
} from './coinjoinPaymentUtils';
import {
    type CoinjoinRootState,
    selectCoinjoinAccounts,
    selectIsAnySessionInCriticalPhase,
    selectSessionByAccountKey,
} from './coinjoinSelectors';
import { type CoinjoinAccountPayment } from './coinjoinTypes';

// Opaque, so it may be logged. The client accepts up to 64 letters, digits, `_` or `-`.
const PAYMENT_ID_LENGTH = 16;

export const createCoinjoinPaymentId = () => getRandomString(PAYMENT_ID_LENGTH);

export const coinjoinAccountSetPayment = createAction(
    COINJOIN.ACCOUNT_SET_PAYMENT,
    (accountKey: AccountKey, payment?: CoinjoinAccountPayment) => ({
        payload: { accountKey, payment },
    }),
);

export type CoinjoinPaymentAction = ReturnType<typeof coinjoinAccountSetPayment>;

export type RecordCoinjoinPaymentAttemptsThunkState = AccountsRootState &
    CoinjoinRootState &
    DeviceRootState &
    WalletSettingsRootState;

/**
 * Stores the attempts of a signature request before the account signs it, saving them with the
 * coinjoin account. Returns false if the account must not sign: the attempts are not of its
 * pending payment as the device authorized it, or the payment would not be saved.
 */
export const recordCoinjoinPaymentAttemptsThunk =
    (accountKey: AccountKey, attempts: CoinjoinPaymentAttempt[]) =>
    (dispatch: Dispatch, getState: () => RecordCoinjoinPaymentAttemptsThunkState) => {
        const payment = selectCoinjoinPaymentByAccountKey(getState(), accountKey);
        if (!payment || !selectIsCoinjoinPaymentAvailableByAccountKey(getState(), accountKey)) {
            return false;
        }

        const updatedPayment = addCoinjoinPaymentAttempts(
            payment,
            attempts,
            selectSessionByAccountKey(getState(), accountKey)?.authorizedPaymentId,
        );
        if (!updatedPayment) return false;

        if (updatedPayment.attemptTxids.length !== payment.attemptTxids.length) {
            dispatch(coinjoinAccountSetPayment(accountKey, updatedPayment));
        }

        return true;
    };

export type BlockRejectedCoinjoinPaymentsThunkState = CoinjoinRootState;

// The client blocks a payment the coordinator refused for its payee or amount only per session.
export const blockRejectedCoinjoinPaymentsThunk =
    (round: SerializedCoinjoinRound) =>
    (dispatch: Dispatch, getState: () => BlockRejectedCoinjoinPaymentsThunkState) => {
        selectCoinjoinAccounts(getState()).forEach(({ key, payment }) => {
            if (!isCoinjoinPaymentPending(payment)) return;

            const isBlocked = round.rejectedPayments.some(
                rejectedPayment =>
                    rejectedPayment.accountKey === key &&
                    rejectedPayment.paymentId === payment.id &&
                    rejectedPayment.isBlocked,
            );
            if (isBlocked) {
                dispatch(coinjoinAccountSetPayment(key, { ...payment, isBlocked: true }));
            }
        });
    };

export type SyncCoinjoinPaymentThunkState = AccountsRootState &
    CoinjoinRootState &
    TransactionsRootState;

/**
 * Applies the confirmed transactions of the account to its payment, see getSyncedCoinjoinPayment.
 * Not in a critical phase, which a changed payment would break. Returns whether the payment
 * changed, so that the caller passes it to the client.
 */
export const syncCoinjoinPaymentThunk =
    (accountKey: AccountKey) =>
    (dispatch: Dispatch, getState: () => SyncCoinjoinPaymentThunkState) => {
        if (selectIsAnySessionInCriticalPhase(getState())) return false;

        const payment = selectCoinjoinPaymentByAccountKey(getState(), accountKey);
        if (!payment) return false;

        const syncedPayment = getSyncedCoinjoinPayment({
            payment,
            transactions: selectAccountTransactions(getState(), accountKey),
            getNewAnchor: () =>
                selectCoinjoinPaymentFundingByAccountKey(getState(), accountKey, payment.address)
                    ?.anchor,
            createId: createCoinjoinPaymentId,
        });

        if (syncedPayment === payment) return false;

        dispatch(coinjoinAccountSetPayment(accountKey, syncedPayment));

        return true;
    };
