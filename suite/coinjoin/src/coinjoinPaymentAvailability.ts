// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md. Kept apart from
// coinjoinPaymentSelectors, which imports coinjoinSelectors, so that coinjoinSelectors can use it.
import { type DeviceRootState, selectDeviceByStaticSessionId } from '@suite-common/device';
import { getIsDeviceRemembered } from '@suite-common/suite-utils';
import {
    type AccountsRootState,
    type WalletSettingsRootState,
    selectAccountByKey,
    selectIsDeviceAutoEjectEnabled,
} from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';

export type CoinjoinPaymentAvailabilityRootState = AccountsRootState &
    DeviceRootState &
    WalletSettingsRootState;

/**
 * A payment survives a restart and is signed only on the account's own device when that device is
 * remembered without auto-eject, so that its anchor and signed attempts are saved, and has
 * Firmware Dark's Capability_CoinJoinPayment.
 */
export const selectIsCoinjoinPaymentAvailableByAccountKey = (
    state: CoinjoinPaymentAvailabilityRootState,
    accountKey: AccountKey | null | undefined,
) => {
    const account = selectAccountByKey(state, accountKey);
    if (!account) return false;

    const device = selectDeviceByStaticSessionId(state, account.deviceState);

    return (
        getIsDeviceRemembered(device) &&
        !selectIsDeviceAutoEjectEnabled(state) &&
        !!device?.features?.capabilities?.includes('Capability_CoinJoinPayment')
    );
};
