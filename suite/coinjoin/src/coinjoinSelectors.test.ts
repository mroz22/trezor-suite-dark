import { asNetworkSymbol } from '@suite-common/wallet-config';
import { mockAccountKey } from '@suite-common/wallet-types/mocks';

import { initialState } from './coinjoinReducer';
import {
    type CoinjoinRootState,
    selectMaxCoordinatorFeeRateByAccountKey,
} from './coinjoinSelectors';
import { CLIENT_STATUS_FALLBACK } from './config';

const btcSymbol = asNetworkSymbol('btc');
const ACCOUNT_KEY = mockAccountKey({ symbol: btcSymbol });

type GetStateParams = {
    rate?: number;
    maxCoordinatorFeeRate?: number;
};

// A coinjoin account whose client read `rate` from the coordinator status. The network config cap
// is set through the debug override, which the selector merges into the network config.
const getState = ({ rate, maxCoordinatorFeeRate }: GetStateParams): CoinjoinRootState => ({
    wallet: {
        coinjoin: {
            ...initialState,
            accounts: [{ key: ACCOUNT_KEY, symbol: btcSymbol, rawLiquidityClue: null }],
            clients:
                rate === undefined
                    ? {}
                    : {
                          [btcSymbol]: {
                              ...CLIENT_STATUS_FALLBACK,
                              coordinationFeeRate: {
                                  ...CLIENT_STATUS_FALLBACK.coordinationFeeRate,
                                  rate,
                              },
                              status: 'loaded',
                          },
                      },
            debug: { coinjoinConfigOverride: { [btcSymbol]: { maxCoordinatorFeeRate } } },
        },
    },
});

describe('selectMaxCoordinatorFeeRateByAccountKey', () => {
    it('caps the rate advertised by the coordinator at 0.1 %', () => {
        expect(selectMaxCoordinatorFeeRateByAccountKey(getState({ rate: 0.01 }), ACCOUNT_KEY)).toBe(
            0.001,
        );
        expect(
            selectMaxCoordinatorFeeRateByAccountKey(getState({ rate: 0.003 }), ACCOUNT_KEY),
        ).toBe(0.001);
    });

    it('keeps a lower rate advertised by the coordinator', () => {
        expect(
            selectMaxCoordinatorFeeRateByAccountKey(getState({ rate: 0.0003 }), ACCOUNT_KEY),
        ).toBe(0.0003);
        expect(selectMaxCoordinatorFeeRateByAccountKey(getState({ rate: 0 }), ACCOUNT_KEY)).toBe(0);
    });

    it('takes the cap from the network config when it sets one', () => {
        expect(
            selectMaxCoordinatorFeeRateByAccountKey(
                getState({ rate: 0.003, maxCoordinatorFeeRate: 0 }),
                ACCOUNT_KEY,
            ),
        ).toBe(0);
        expect(
            selectMaxCoordinatorFeeRateByAccountKey(
                getState({ rate: 0.003, maxCoordinatorFeeRate: 0.005 }),
                ACCOUNT_KEY,
            ),
        ).toBe(0.003);
        expect(
            selectMaxCoordinatorFeeRateByAccountKey(
                getState({ rate: 0.01, maxCoordinatorFeeRate: 0.005 }),
                ACCOUNT_KEY,
            ),
        ).toBe(0.005);
    });

    it('returns undefined without a coinjoin client', () => {
        expect(selectMaxCoordinatorFeeRateByAccountKey(getState({}), ACCOUNT_KEY)).toBeUndefined();
    });
});
