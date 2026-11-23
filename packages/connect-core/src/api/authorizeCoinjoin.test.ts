import type { AuthorizeCoinjoin as AuthorizeCoinjoinParams } from '@trezor/connect-common';

import AuthorizeCoinjoin from './authorizeCoinjoin';
import type { Device } from '../device/Device';

const base: AuthorizeCoinjoinParams = {
    path: "m/10025'/1'/0'/1'",
    coin: 'test',
    coordinator: 'CoinJoinCoordinatorIdentifier',
    maxRounds: 10,
    maxCoordinatorFeeRate: 0,
    maxFeePerKvbyte: 3500,
};

const payment = {
    address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    amount: '1000000',
    anchor: { prevHash: 'ab'.repeat(32), prevIndex: 1 },
};

const createMethod = (params: AuthorizeCoinjoinParams, capabilities: string[]) => {
    const commands = {
        preauthorize: jest.fn(() => Promise.resolve(true)),
        typedCall: jest.fn(() => Promise.resolve({ message: { message: 'Coinjoin authorized' } })),
    };
    const method = new AuthorizeCoinjoin({ payload: { method: 'authorizeCoinjoin', ...params } });
    method.setDevice({
        features: { capabilities },
        getCommands: () => commands,
    } as unknown as Device);

    return { method, commands };
};

// Suite Dark: Firmware Dark coinjoin payment
describe('AuthorizeCoinjoin payment', () => {
    it('sends the payment with its anchor', () => {
        const { method } = createMethod({ ...base, payment }, []);

        expect(method['params'].payment).toEqual({
            address: payment.address,
            amount: payment.amount,
            anchor_prev_hash: 'ab'.repeat(32),
            anchor_prev_index: 1,
        });
    });

    it('requires the anchor', () => {
        const { anchor: _anchor, ...withoutAnchor } = payment;

        expect(() =>
            createMethod({ ...base, payment: withoutAnchor as typeof payment }, []),
        ).toThrow();
    });

    it('sends no payment without one', () => {
        const { method } = createMethod(base, []);

        expect(method['params'].payment).toBeUndefined();
    });

    it('rejects a payment for a device without the capability', async () => {
        const { method, commands } = createMethod({ ...base, payment }, ['Capability_Bitcoin']);

        await expect(method.run()).rejects.toThrow('does not support coinjoin payments');
        expect(commands.typedCall).not.toHaveBeenCalled();
    });

    it('never takes the preauthorized shortcut with a payment', async () => {
        const { method, commands } = createMethod({ ...base, payment, preauthorized: true }, [
            'Capability_Bitcoin',
            'Capability_CoinJoinPayment',
        ]);

        await method.run();

        expect(commands.preauthorize).not.toHaveBeenCalled();
        expect(commands.typedCall).toHaveBeenCalledWith(
            'AuthorizeCoinJoin',
            'Success',
            expect.objectContaining({
                payment: expect.objectContaining({
                    address: payment.address,
                    amount: payment.amount,
                }),
            }),
        );
    });

    it('tags the payment screens, which send ButtonRequest_ConfirmOutput', () => {
        const { method } = createMethod({ ...base, payment }, []);
        const { method: methodWithoutPayment } = createMethod(base, []);

        expect(method.getButtonRequestData('ButtonRequest_ConfirmOutput')).toEqual({
            type: 'coinjoin-payment',
        });
        expect(method.getButtonRequestData('ButtonRequest_Other')).toBeUndefined();
        expect(
            methodWithoutPayment.getButtonRequestData('ButtonRequest_ConfirmOutput'),
        ).toBeUndefined();
    });

    it('keeps the preauthorized shortcut without a payment', async () => {
        const { method, commands } = createMethod({ ...base, preauthorized: true }, []);

        await method.run();

        expect(commands.preauthorize).toHaveBeenCalled();
        expect(commands.typedCall).not.toHaveBeenCalled();
    });
});
