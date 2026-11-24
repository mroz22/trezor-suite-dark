import { testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import { type AccountsRootState } from '@suite-common/wallet-core';
import { mockAccountKey, mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { RoundPhase } from '@trezor/coinjoin';

import {
    ANCHOR_UTXO,
    type GetPaymentStateParams,
    PAYMENT,
    ACCOUNT as PAYMENT_ACCOUNT,
    getPaymentState,
} from './__fixtures__/coinjoinPayment';
import { initialState } from './coinjoinReducer';
import {
    type CoinjoinRootState,
    selectCoinjoinMinInputCountBySymbol,
    selectCoinjoinNetworkConfig,
    selectCoordinatorFeeRateCapBySymbol,
    selectHasCoinjoinSessionBySymbol,
    selectIsCoinjoinCoordinatorOverriddenBySymbol,
    selectIsNothingToAnonymizeByAccountKey,
    selectMaxCoordinatorFeeRateByAccountKey,
    selectRegisteredUtxosByAccountKey,
} from './coinjoinSelectors';
import {
    type CoinjoinAccount,
    type CoinjoinState,
    WabiSabiProtocolErrorCode,
} from './coinjoinTypes';
import {
    CLIENT_STATUS_FALLBACK,
    COINJOIN_NETWORKS,
    type CoinjoinCoordinatorConfig,
    MAX_COORDINATOR_FEE_RATE,
} from './config';

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

describe('coordinator selectors', () => {
    const testSymbol = asNetworkSymbol('test');
    const DEFAULT_COORDINATOR: CoinjoinCoordinatorConfig = {
        coordinatorUrl: 'https://default.example/wabisabi/',
        coordinatorName: 'CoinJoinCoordinatorIdentifier',
        wabisabiBackendUrl: 'https://default.example/',
    };
    const OTHER_COORDINATOR: CoinjoinCoordinatorConfig = {
        coordinatorUrl: 'https://other.example/wabisabi/',
        coordinatorName: 'OtherCoordinatorIdentifier',
        maxCoordinatorFeeRate: 0,
    };

    const getCoordinatorState = (coinjoin: Partial<CoinjoinState>): CoinjoinRootState => ({
        wallet: { coinjoin: { ...initialState, ...coinjoin } },
    });

    beforeEach(() => {
        jest.replaceProperty(COINJOIN_NETWORKS, 'btc', {
            public: {
                ...COINJOIN_NETWORKS.btc!.public!,
                coordinators: [DEFAULT_COORDINATOR, OTHER_COORDINATOR],
            },
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('uses the default coordinator until the user chooses another one', () => {
        const state = getCoordinatorState({});

        expect(selectCoinjoinNetworkConfig(state, btcSymbol)).toMatchObject(DEFAULT_COORDINATOR);
        expect(selectCoordinatorFeeRateCapBySymbol(state, btcSymbol)).toBe(
            MAX_COORDINATOR_FEE_RATE,
        );
    });

    it('uses the chosen coordinator with its own fields only', () => {
        const state = getCoordinatorState({
            chosenCoordinatorUrls: { [btcSymbol]: OTHER_COORDINATOR.coordinatorUrl },
        });

        const config = selectCoinjoinNetworkConfig(state, btcSymbol);
        expect(config).toMatchObject(OTHER_COORDINATOR);
        expect(config.wabisabiBackendUrl).toBeUndefined();
        expect(selectCoordinatorFeeRateCapBySymbol(state, btcSymbol)).toBe(0);
    });

    it('uses a coordinator passed at startup with the network fields instead of a listed one', () => {
        const state = getCoordinatorState({
            chosenCoordinatorUrls: { [btcSymbol]: OTHER_COORDINATOR.coordinatorUrl },
            debug: {
                coinjoinConfigOverride: {
                    [btcSymbol]: {
                        coordinatorUrl: 'https://startup.example/wabisabi/',
                        minInputCount: 5,
                    },
                },
            },
        });

        const config = selectCoinjoinNetworkConfig(state, btcSymbol);
        expect(config.coordinatorUrl).toBe('https://startup.example/wabisabi/');
        expect(config.coordinatorName).toBe('CoinJoinCoordinatorIdentifier');
        expect(config.wabisabiBackendUrl).toBeUndefined();
        expect(selectCoordinatorFeeRateCapBySymbol(state, btcSymbol)).toBe(
            MAX_COORDINATOR_FEE_RATE,
        );
        expect(selectCoinjoinMinInputCountBySymbol(state, btcSymbol)).toBe(5);
        expect(selectIsCoinjoinCoordinatorOverriddenBySymbol(state, btcSymbol)).toBe(true);
        expect(selectIsCoinjoinCoordinatorOverriddenBySymbol(state, testSymbol)).toBe(false);
    });

    it('keeps the listed coordinator under an override without a coordinator url', () => {
        const state = getCoordinatorState({
            debug: { coinjoinConfigOverride: { [btcSymbol]: { maxCoordinatorFeeRate: 0.003 } } },
        });

        expect(selectCoinjoinNetworkConfig(state, btcSymbol)).toMatchObject({
            ...DEFAULT_COORDINATOR,
            maxCoordinatorFeeRate: 0.003,
        });
        expect(selectIsCoinjoinCoordinatorOverriddenBySymbol(state, btcSymbol)).toBe(false);
    });

    it('takes the minimum of inputs from the network by default', () => {
        expect(selectCoinjoinMinInputCountBySymbol(getCoordinatorState({}), btcSymbol)).toBe(21);
    });

    it('tells whether a session, also a paused one, runs on the network', () => {
        const account: CoinjoinAccount = {
            key: ACCOUNT_KEY,
            symbol: btcSymbol,
            rawLiquidityClue: null,
            session: {
                targetAnonymity: 10,
                maxRounds: 10,
                maxFeePerKvbyte: 1,
                maxCoordinatorFeeRate: 0,
                timeCreated: 0,
                sessionPhaseQueue: [],
                signedRounds: [],
                paused: true,
            },
        };
        const state = getCoordinatorState({ accounts: [account] });

        expect(selectHasCoinjoinSessionBySymbol(state, btcSymbol)).toBe(true);
        expect(selectHasCoinjoinSessionBySymbol(state, testSymbol)).toBe(false);
        expect(
            selectHasCoinjoinSessionBySymbol(
                getCoordinatorState({ accounts: [{ ...account, session: undefined }] }),
                btcSymbol,
            ),
        ).toBe(false);
    });
});

describe('selectRegisteredUtxosByAccountKey', () => {
    type Prison = NonNullable<CoinjoinAccount['prison']>;
    type Inmate = Prison[string];

    const SESSION: CoinjoinAccount['session'] = {
        targetAnonymity: 10,
        maxRounds: 10,
        maxFeePerKvbyte: 1,
        maxCoordinatorFeeRate: 0.003,
        timeCreated: 0,
        sessionPhaseQueue: [],
        signedRounds: [],
    };

    // Change addresses 0 to 39, the one with index 10 has a confirmed transaction, so the client
    // gets those with index 11 to 30 without an unconfirmed output.
    const createAccount = (addressesWithUtxo: string[]) =>
        mockWalletAccount({
            symbol: btcSymbol,
            accountType: 'coinjoin',
            path: "m/10025'/0'/0'/1'",
            addresses: {
                change: Array.from({ length: 40 }, (_, index) => ({
                    address: `bc1p${index}`,
                    path: `m/10025'/0'/0'/1'/1/${index}`,
                    transfers: index === 10 ? 1 : 0,
                    balance: '0',
                    sent: '0',
                    received: '0',
                })),
                used: [],
                unused: [],
            },
            utxo: addressesWithUtxo.map(address =>
                testMocks.getUtxo({ address, confirmations: 0 }),
            ),
        });

    type SelectParams = {
        prison: Prison;
        addressesWithUtxo?: string[];
        session?: CoinjoinAccount['session'];
    };

    // The round 'running' is in the status, the round 'signed' was signed here.
    const select = ({ prison, addressesWithUtxo = [], session }: SelectParams) => {
        const account = createAccount(addressesWithUtxo);
        const state: CoinjoinRootState & AccountsRootState = {
            wallet: {
                accounts: [account],
                coinjoin: {
                    ...initialState,
                    accounts: [
                        {
                            key: account.key,
                            symbol: btcSymbol,
                            rawLiquidityClue: null,
                            prison,
                            session,
                            transactionCandidates: [{ roundId: 'signed' }],
                        },
                    ],
                    clients: {
                        [btcSymbol]: {
                            ...CLIENT_STATUS_FALLBACK,
                            rounds: [{ id: 'running', phase: RoundPhase.OutputRegistration }],
                            status: 'loaded',
                        },
                    },
                },
            },
        };

        return selectRegisteredUtxosByAccountKey(state, account.key);
    };

    // Output registered in a round, see CoinjoinPrison.detainRegisteredOutput.
    const registeredOutput = (roundId: string, sentenceStart: number): Inmate => ({
        type: 'output',
        errorCode: 'registeredOutput',
        roundId,
        sentenceStart,
        sentenceEnd: Infinity,
    });

    const detain = (indexes: number[], inmate: Inmate): Prison =>
        Object.fromEntries(indexes.map(index => [`bc1p${index}`, inmate]));

    const release = (prison: Prison, address: string) =>
        Object.fromEntries(Object.entries(prison).filter(([id]) => id !== address));

    // Every address the client gets is detained: outputs of a broadcast transaction, of a round in
    // the status, of a round signed here and of two failed rounds.
    const fullWindowPrison: Prison = {
        ...detain([11, 12, 13, 14, 15], {
            type: 'output',
            errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
            roundId: 'broadcast',
            sentenceStart: 1,
            sentenceEnd: Infinity,
        }),
        ...detain([16, 17, 18, 19, 20], registeredOutput('running', 1)),
        ...detain([21, 22, 23, 24, 25], registeredOutput('signed', 1)),
        ...detain([26, 27, 30], registeredOutput('failed-later', 4)),
        ...detain([28], registeredOutput('failed', 2)),
        ...detain([29], registeredOutput('failed', 3)),
        // An output of a failed round below the last used address, a regular send skips it.
        ...detain([5], registeredOutput('failed', 0)),
    };

    it('selects outputs detained for good also without a session', () => {
        const outputs = {
            ...detain([11], registeredOutput('failed', 1)),
            ...detain([12], {
                type: 'output',
                errorCode: WabiSabiProtocolErrorCode.AlreadyRegisteredScript,
                sentenceStart: 1,
                sentenceEnd: Infinity,
            }),
        };
        const prison: Prison = {
            ...outputs,
            A0: { type: 'input', roundId: 'running', sentenceStart: 1, sentenceEnd: 2 },
        };

        expect(select({ prison })).toEqual(outputs);
        expect(select({ prison, session: SESSION })).toEqual(prison);
    });

    it('keeps every output while an address the client gets is free', () => {
        const prison = release(fullWindowPrison, 'bc1p30');

        expect(select({ prison })).toEqual(prison);
    });

    it('frees the oldest output of a failed round once no address the client gets is free', () => {
        expect(select({ prison: fullWindowPrison })).toEqual(release(fullWindowPrison, 'bc1p28'));
        // A coinjoin may pay an address with an unconfirmed output, the client does not get it.
        expect(select({ prison: fullWindowPrison, addressesWithUtxo: ['bc1p28'] })).toEqual(
            release(fullWindowPrison, 'bc1p29'),
        );
    });

    it('frees nothing without an output of a failed round', () => {
        const prison = {
            ...fullWindowPrison,
            ...detain([26, 27, 28, 29, 30], registeredOutput('running', 0)),
        };

        expect(select({ prison })).toEqual(prison);
    });
});

// Suite Dark: pay in coinjoin.
describe('selectIsNothingToAnonymizeByAccountKey with a payment', () => {
    const isNothingToAnonymize = (params: GetPaymentStateParams) =>
        selectIsNothingToAnonymizeByAccountKey(getPaymentState(params), PAYMENT_ACCOUNT.key);

    it('mixes all private coins while a payment or a cancelled one needs a round', () => {
        expect(isNothingToAnonymize({ payment: null })).toBe(true);
        expect(isNothingToAnonymize({})).toBe(false);
        expect(isNothingToAnonymize({ payment: { ...PAYMENT, isCancelled: true } })).toBe(false);
    });

    it('has nothing to mix for a paid or blocked payment or an anchor spent in the mempool', () => {
        expect(isNothingToAnonymize({ payment: { ...PAYMENT, paidTxid: 'b2'.repeat(32) } })).toBe(
            true,
        );
        expect(isNothingToAnonymize({ payment: { ...PAYMENT, isBlocked: true } })).toBe(true);
        expect(
            isNothingToAnonymize({
                accounts: [{ ...PAYMENT_ACCOUNT, utxo: [{ ...ANCHOR_UTXO, confirmations: 0 }] }],
            }),
        ).toBe(true);
    });
});
