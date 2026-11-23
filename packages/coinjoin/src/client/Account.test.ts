import { networks } from '@trezor/utxo-lib';

import { Account } from './Account';
import type { CoinjoinPayment, RegisterAccountParams } from '../types/account';

const ANCHOR = `${'aa'.repeat(32)}00000000`;

const PAYMENT: CoinjoinPayment = {
    id: 'payment-1',
    address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    amount: 50000,
    anchor: ANCHOR,
};

const PARAMS: RegisterAccountParams = {
    accountKey: 'account-A',
    scriptType: 'Taproot',
    targetAnonymity: 5,
    rawLiquidityClue: null,
    maxFeePerKvbyte: 200000,
    maxCoordinatorFeeRate: 0.003,
    maxRounds: 10,
    utxos: [
        {
            path: "m/10025'/1'/0'/1'/0/0",
            outpoint: ANCHOR,
            address: 'tb1ppxzlcdeawkpyg5q85lepuhsructwkxpgtxt5pcdq3hnfp0v372qq3tfr6s',
            amount: 100000,
            anonymityLevel: 10,
        },
    ],
    changeAddresses: [
        {
            path: "m/10025'/1'/0'/1'/1/0",
            address: 'tb1ppll2u0aaprp92gfkntamd476emye7weykcgnctlyj7lduprjx7ys9jn7w3',
        },
    ],
    payment: PAYMENT,
};

describe('Account', () => {
    it('parses the payment', () => {
        const account = new Account(PARAMS, networks.testnet);

        expect(account.payment).toEqual({
            id: 'payment-1',
            address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
            amount: 50000,
            anchor: ANCHOR,
            isCancelled: false,
            scriptType: 'P2WPKH',
            scriptPubKey: '0 751e76e8199196d454941c45d1b3a323f1433bd6',
            scriptPubKeyHex: '0014751e76e8199196d454941c45d1b3a323f1433bd6',
            outputSize: 31,
        });
        expect(account.blockedPaymentIds).toEqual([]);
    });

    it('updates, cancels and clears the payment', () => {
        const account = new Account({ ...PARAMS, payment: undefined }, networks.testnet);
        expect(account.payment).toBeUndefined();

        account.update(PARAMS);
        expect(account.payment).toMatchObject({ id: 'payment-1', amount: 50000 });

        account.update({ ...PARAMS, payment: { ...PAYMENT, amount: 60000 } });
        expect(account.payment).toMatchObject({ id: 'payment-1', amount: 60000 });

        account.update({ ...PARAMS, payment: { ...PAYMENT, isCancelled: true } });
        expect(account.payment).toMatchObject({ id: 'payment-1', isCancelled: true });

        account.update({ ...PARAMS, payment: undefined });
        expect(account.payment).toBeUndefined();
    });

    it('ignores an invalid payment and applies the rest of the update', () => {
        const account = new Account(PARAMS, networks.testnet);

        account.update({
            ...PARAMS,
            utxos: [],
            changeAddresses: [],
            targetAnonymity: 20,
            payment: { ...PAYMENT, address: 'not an address' },
        });

        expect(account.payment).toBeUndefined();
        expect(account.utxos).toEqual([]);
        expect(account.changeAddresses).toEqual([]);
        expect(account.targetAnonymity).toEqual(20);
    });

    it('keeps blocked payments across updates', () => {
        const account = new Account(PARAMS, networks.testnet);
        const { blockedPaymentIds } = account;
        blockedPaymentIds.push('payment-1');

        account.update(PARAMS);

        expect(account.blockedPaymentIds).toBe(blockedPaymentIds);
        expect(account.blockedPaymentIds).toEqual(['payment-1']);
    });
});
