import {
    AuthorizeCoinjoin as AuthorizeCoinjoinSchema,
    type DeviceButtonRequestCode,
    type PermissionRequest,
} from '@trezor/connect-common';
import { ERRORS } from '@trezor/connect-common/src/constants';
import type { MessagesSchema as PROTO } from '@trezor/protobuf';
import { Assert } from '@trezor/schema-utils';

import type { MethodMessage } from '../core/AbstractMethod';
import { AbstractMethod } from '../core/AbstractMethod';
import { getBitcoinNetwork } from '../data/coinInfo';
import { getScriptType, validatePath } from '../utils/pathUtils';

export default class AuthorizeCoinjoin extends AbstractMethod<
    'authorizeCoinjoin',
    PROTO.AuthorizeCoinJoin
> {
    constructor(message: MethodMessage<'authorizeCoinjoin'>) {
        const { payload } = message;

        Assert(AuthorizeCoinjoinSchema, payload);
        const address_n = validatePath(payload.path, 3);
        const script_type = payload.scriptType || getScriptType(address_n);
        const coinInfo = getBitcoinNetwork(payload.coin || address_n);

        const params = {
            coordinator: payload.coordinator,
            max_rounds: payload.maxRounds,
            max_coordinator_fee_rate: payload.maxCoordinatorFeeRate,
            max_fee_per_kvbyte: payload.maxFeePerKvbyte,
            address_n,
            coin_name: coinInfo?.name,
            script_type,
            amount_unit: payload.amountUnit,
            // Suite Dark: Firmware Dark coinjoin payment
            payment: payload.payment && {
                address: payload.payment.address,
                amount: payload.payment.amount,
                anchor_prev_hash: payload.payment.anchor.prevHash,
                anchor_prev_index: payload.payment.anchor.prevIndex,
            },
        };

        super(message, params);

        this.requiredFirmwareCoins = [coinInfo];
        this.preauthorized = payload.preauthorized;
    }

    get requiredPermissions(): PermissionRequest[] {
        return [this.coinPerm('internal', this.requiredFirmwareCoins[0])];
    }

    // Suite Dark: Firmware Dark shows the payment's address and amount like an output to confirm,
    // so that the wallet can tell them from a transaction review.
    getButtonRequestData(code: DeviceButtonRequestCode) {
        if (this.params.payment && code === 'ButtonRequest_ConfirmOutput') {
            return { type: 'coinjoin-payment' as const };
        }
    }

    async run() {
        const device = this.getDevice();
        const cmd = device.getCommands();

        if (this.params.payment) {
            // Suite Dark: firmware without the capability would ignore the payment, authorize
            // and later refuse to sign the payment round.
            if (!device.features.capabilities.includes('Capability_CoinJoinPayment')) {
                throw ERRORS.TypedError(
                    'Device_MissingCapability',
                    'Device firmware does not support coinjoin payments.',
                );
            }
        } else if (this.preauthorized) {
            if (await cmd.preauthorize(false)) {
                // device is already preauthorized
                return { message: 'Success' };
            }
        }

        const response = await cmd.typedCall('AuthorizeCoinJoin', 'Success', this.params);

        return response.message;
    }
}
