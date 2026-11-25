import { type CoinjoinAccount } from '@suite/coinjoin';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import { mockAccountKey } from '@suite-common/wallet-types/mocks';

import { serializeCoinjoinAccount } from './storage';

describe('serializeCoinjoinAccount', () => {
    // Suite Dark: pay in coinjoin, the payment and its signed attempts survive a restart.
    it('saves the payment and leaves out the session and transaction candidates', () => {
        const payment: CoinjoinAccount['payment'] = {
            id: 'payment1',
            address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
            amount: 50_000,
            anchor: '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a0908070605040302010001000000',
            attemptTxids: ['0dac366fd8a67b2a89fbb0d31086e7acded7a5bbf9ef9daa935bc873229ef5b5'],
        };
        const coinjoinAccount: CoinjoinAccount = {
            key: mockAccountKey({ symbol: asNetworkSymbol('btc') }),
            symbol: asNetworkSymbol('btc'),
            rawLiquidityClue: null,
            payment,
            session: {
                targetAnonymity: 5,
                maxRounds: 10,
                maxFeePerKvbyte: 5000,
                maxCoordinatorFeeRate: 0,
                timeCreated: 0,
                sessionPhaseQueue: [],
                signedRounds: [],
            },
            transactionCandidates: [],
        };

        const serialized = serializeCoinjoinAccount(coinjoinAccount);

        expect(serialized).toEqual({
            key: coinjoinAccount.key,
            symbol: coinjoinAccount.symbol,
            rawLiquidityClue: null,
            payment,
        });
    });
});
