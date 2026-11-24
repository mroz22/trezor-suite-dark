// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import { type ModalRootState } from '@suite/modal';
import { type DeviceRootState } from '@suite-common/device';
import {
    type AccountsRootState,
    type TransactionsRootState,
    type WalletSettingsRootState,
    selectAccountByKey,
} from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { type Dispatch } from '@trezor/redux-utils';

import { updateClientAccountThunk } from './coinjoinAccountActions';
import { coinjoinAccountSetPayment, createCoinjoinPaymentId } from './coinjoinPaymentActions';
import {
    selectCoinjoinPaymentByAccountKey,
    selectCoinjoinPaymentErrorByAccountKey,
    selectCoinjoinPaymentFundingByAccountKey,
    selectIsCoinjoinPaymentAvailableByAccountKey,
} from './coinjoinPaymentSelectors';
import { type CoinjoinPaymentError } from './coinjoinPaymentUtils';
import { type CoinjoinRootState, selectIsAnySessionInCriticalPhase } from './coinjoinSelectors';

type CreateCoinjoinPaymentThunkParams = {
    accountKey: AccountKey;
    address: string;
    amount: number;
};

export type CreateCoinjoinPaymentThunkState = AccountsRootState &
    CoinjoinRootState &
    DeviceRootState &
    TransactionsRootState &
    WalletSettingsRootState;

/**
 * Creates the payment of the account, anchored on its largest private coin. The client gets it
 * only after the device authorized it, when coinjoin starts or resumes. Returns why the payment
 * was not created.
 */
export const createCoinjoinPaymentThunk =
    ({ accountKey, address, amount }: CreateCoinjoinPaymentThunkParams) =>
    (
        dispatch: Dispatch,
        getState: () => CreateCoinjoinPaymentThunkState,
    ): CoinjoinPaymentError | 'UNAVAILABLE' | undefined => {
        if (!selectIsCoinjoinPaymentAvailableByAccountKey(getState(), accountKey)) {
            return 'UNAVAILABLE';
        }

        const error = selectCoinjoinPaymentErrorByAccountKey(getState(), accountKey, {
            address,
            amount,
        });
        if (error) return error;

        const anchor = selectCoinjoinPaymentFundingByAccountKey(
            getState(),
            accountKey,
            address,
        )?.anchor;
        if (!anchor) return 'NO_PRIVATE_COINS';

        dispatch(
            coinjoinAccountSetPayment(accountKey, {
                id: createCoinjoinPaymentId(),
                address: address.trim().toLowerCase(),
                amount,
                anchor,
                attemptTxids: [],
            }),
        );
    };

export type CancelCoinjoinPaymentThunkState = AccountsRootState &
    CoinjoinRootState &
    ModalRootState;

/**
 * Removes a paid payment or one without a signed attempt. Otherwise the payment is cancelled: the
 * client mixes its anchor without it, which invalidates the attempts, and it is removed once a
 * transaction that spends the anchor confirms. Not in a critical phase, which a changed payment
 * would break.
 */
export const cancelCoinjoinPaymentThunk =
    (accountKey: AccountKey) =>
    (dispatch: Dispatch, getState: () => CancelCoinjoinPaymentThunkState) => {
        if (selectIsAnySessionInCriticalPhase(getState())) return;

        const payment = selectCoinjoinPaymentByAccountKey(getState(), accountKey);
        if (!payment) return;

        const isRemoved = !!payment.paidTxid || payment.attemptTxids.length === 0;
        dispatch(
            coinjoinAccountSetPayment(
                accountKey,
                isRemoved ? undefined : { ...payment, isCancelled: true },
            ),
        );

        const account = selectAccountByKey(getState(), accountKey);
        if (account) dispatch(updateClientAccountThunk(account));
    };
