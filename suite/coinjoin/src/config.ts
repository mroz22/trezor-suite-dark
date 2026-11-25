import { isDevEnv } from '@suite-common/suite-utils';
import type { NetworkSymbol } from '@suite-common/wallet-config';
import type { CoinjoinBackendSettings, CoinjoinClientSettings } from '@trezor/coinjoin';
import {
    COORDINATOR_FEE_RATE_FALLBACK,
    MAX_ALLOWED_AMOUNT_FALLBACK,
    MIN_ALLOWED_AMOUNT_FALLBACK,
    PLEBS_DONT_PAY_THRESHOLD_FALLBACK,
} from '@trezor/coinjoin/src/constants';
import type { PartialRecord } from '@trezor/type-utils';

export type CoinjoinSymbol = NetworkSymbol & ('btc' | 'test' | 'regtest');
export type CoinjoinServerEnvironment = 'public' | 'localhost';
export type CoinjoinNetworksConfig = CoinjoinBackendSettings &
    CoinjoinClientSettings & {
        blockbookUrls: string[];
        // Replaces MAX_COORDINATOR_FEE_RATE for the coordinator of the network.
        maxCoordinatorFeeRate?: number;
    };

// A coordinator a network can mix through. Its fields replace those of the network config.
export type CoinjoinCoordinatorConfig = Required<Pick<CoinjoinNetworksConfig, 'coordinatorUrl'>> &
    Pick<
        CoinjoinNetworksConfig,
        'coordinatorName' | 'wabisabiBackendUrl' | 'maxCoordinatorFeeRate'
    >;

// The network's coordinatorName is the identifier used without a coordinator, for example with a
// coordinatorUrl passed at startup through debug.coinjoinConfigOverride.
type CoinjoinNetworkEnvironmentConfig = Omit<
    CoinjoinNetworksConfig,
    'coordinatorUrl' | 'wabisabiBackendUrl' | 'maxCoordinatorFeeRate'
> & {
    // The first one is the default, users can choose another one in the coinjoin settings.
    coordinators?: readonly CoinjoinCoordinatorConfig[];
};

type ServerEnvironment = PartialRecord<CoinjoinServerEnvironment, CoinjoinNetworkEnvironmentConfig>;

// Suite Dark: btc mixes through the kruw.io coordinator below by default, OpenCoordinator can be chosen
// instead. The test network has no coordinator because the public ones shut down; testers set one
// through debug.coinjoinConfigOverride, see docs/features/coinjoin.md.
export const COINJOIN_NETWORKS: PartialRecord<'btc' | 'test' | 'regtest', ServerEnvironment> = {
    btc: {
        /* default, see getCoinjoinConfig */
        public: {
            network: 'btc',
            coordinatorName: 'CoinJoinCoordinatorIdentifier',
            coordinators: [
                {
                    // Suite Dark: a public zero-fee WalletWasabi coordinator, so mixing works
                    // without a debug override. It runs no backend, so wabisabiBackendUrl stays
                    // unset and the coordinator version falls back to the client's stub values.
                    coordinatorUrl: 'https://coinjoin.kruw.io/wabisabi/',
                    coordinatorName: 'CoinJoinCoordinatorIdentifier',
                    // Suite Dark: kruw charges no coordinator fee, so authorize none. A round with
                    // a fee is skipped instead of paid.
                    maxCoordinatorFeeRate: 0,
                },
                {
                    // Suite Dark: OpenCoordinator, another public zero-fee WalletWasabi coordinator
                    // the user can choose in the coinjoin settings. Its status had the default
                    // identifier, no fee, at least 21 inputs and Taproot on 2026-11-22. Its backend
                    // stays unset as for kruw: with it, Suite would ask to agree again to the
                    // zkSNACKs legal documents, whose version that backend reports.
                    coordinatorUrl: 'https://api.opencoordinator.org/wabisabi/',
                    coordinatorName: 'CoinJoinCoordinatorIdentifier',
                    maxCoordinatorFeeRate: 0,
                },
            ],
            blockbookUrls: ['https://btc.trezor.io'],
            onionDomains: {
                'trezor.io': 'trezoriovpjcahpzkrewelclulmszwbqpzmzgub37gbcjlvluxtruqad.onion',
            },
            /* 28.02.2023 */
            baseBlockHeight: 778666,
            baseBlockHash: '000000000000000000054d1ca4a160dd37541d776ccc34af955dbfcd3b2405f6',
            // TODO post MVP: unify filters batch size with wabisabi or implement filters on blockbooks
            // https://github.com/trezor/trezor-suite/issues/7182#issuecomment-1438182493
            filtersBatchSize: 500,
        },
    },
    test: {
        /* default, see getCoinjoinConfig */
        public: {
            network: 'test',
            coordinatorName: 'CoinJoinCoordinatorIdentifier',
            blockbookUrls: ['https://tbtc4.trezor.io'],
            onionDomains: {
                'trezor.io': 'trezoriovpjcahpzkrewelclulmszwbqpzmzgub37gbcjlvluxtruqad.onion',
            },
            /* wasabi production *
            baseBlockHeight: 828575,
            baseBlockHash: '00000000000f0d5edcaeba823db17f366be49a80d91d15b77747c2e017b8c20a',
            /* */
            /* 50 tys, ~1 btc year *
            baseBlockHeight: 2367432,
            baseBlockHash: '0000000000006f5a1958de7f2ddd3157fb2f12a392b4e034e09d30da8151195c',
            /* */
            /* all all 49'/1'/0' first tx *
            baseBlockHeight: 1746250,
            baseBlockHash: '000000001eec9e483ddc3a9f2eea25b2639887def9ee2816c748b77248335c08',
            /*  */
            /* first block for vpub5Yme8cvVDuECgS5vuY8rYyVMrnSvDaUwbDeKLNhh3BKZYe3fpKKapVQUFAEVpyBbwaUhZLeZLcwcoRMweSfRtFxB6MenWh3NweXrQ3CTZM9 *
            baseBlockHeight: 1821033,
            baseBlockHash: '00000000000bb983f68a7bcff154f229f777ff0802788ae26424af9c15db3959',
            /* */
            /* October 1st, 2022  */
            baseBlockHeight: 0,
            baseBlockHash: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
            /* */
            filtersBatchSize: 5000,
        },
    },
    regtest: {
        /* default, see getCoinjoinConfig */
        localhost: {
            network: 'regtest',
            coordinatorName: 'CoinJoinCoordinatorIdentifier',
            coordinators: [
                {
                    coordinatorUrl: 'http://127.0.0.1:8081/backend/wabisabi/',
                    coordinatorName: 'CoinJoinCoordinatorIdentifier',
                    wabisabiBackendUrl: 'http://127.0.0.1:8081/backend/',
                },
            ],
            // backend settings
            blockbookUrls: ['http://127.0.0.1:19121'],
            baseBlockHeight: 0,
            baseBlockHash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
            filtersBatchSize: 5000,
        },
    },
};

export const ESTIMATED_ANONYMITY_GAINED_PER_ROUND = 10; // initial value replaced by config via message-system in state.wallet.coinjoin.config.averageAnonymityGainPerRound
export const MIN_ANONYMITY_GAINED_PER_ROUND = 0.1; // the minimum anonymity gain per coinjoin round that is used to avoid division by zero when computing roundsNeeded.
export const ESTIMATED_ROUNDS_FAIL_RATE_BUFFER = 10;
export const MAX_ROUNDS_ALLOWED = 500; // Never ask trezor to sign more than 500 rounds, it will fail if safety checks are enabled.
export const ESTIMATED_MIN_ROUNDS_NEEDED = 4;
export const ESTIMATED_HOURS_PER_ROUND = 1;
export const UNECONOMICAL_COINJOIN_THRESHOLD = 1_000_000;
export const COORDINATOR_FEE_RATE_MULTIPLIER = 10 ** 8; // coordinator fee rate from status format (0.003) - firmware format (300 000 = 0.003 * 10 ** 8)
// Highest coordinator fee rate (0.1 %) a coinjoin session authorizes on the device. The device does
// not show the authorized rate, so the rate a coordinator advertises in its status must not decide
// it alone. Rounds with a higher rate are skipped.
export const MAX_COORDINATOR_FEE_RATE = 0.001;
export const DEFAULT_TARGET_ANONYMITY = 5;
export const SKIP_ROUNDS_BY_DEFAULT = false;
export const SKIP_ROUNDS_VALUE_WHEN_ENABLED = [4, 5] as [number, number];
export const FEE_RATE_MEDIAN_FALLBACK = 2;
export const MAX_MINING_FEE_MODIFIER = 2.5; // modifier applied to a median fee rate to set default max mining fee rate per vbyte
export const CLIENT_STATUS_FALLBACK = {
    rounds: [],
    feeRateMedian: FEE_RATE_MEDIAN_FALLBACK,
    coordinationFeeRate: {
        rate: COORDINATOR_FEE_RATE_FALLBACK,
        plebsDontPayThreshold: PLEBS_DONT_PAY_THRESHOLD_FALLBACK,
    },
    allowedInputAmounts: {
        min: MIN_ALLOWED_AMOUNT_FALLBACK,
        max: MAX_ALLOWED_AMOUNT_FALLBACK,
    },
};
export const ZKSNACKS_LEGAL_DOCUMENTS_VERSION = '1.0';
export const TREZOR_LEGAL_DOCUMENTS_VERSION = '1.0';

// Estimating anonymity gain per round:
// How many previous coinjoin transactions are taken into account
export const ANONYMITY_GAINS_HINDSIGHT_COUNT = 10;
// What are the oldest coinjoin transactions taken into account
export const ANONYMITY_GAINS_HINDSIGHT_DAYS = 30;

const getNetworkEnvironmentConfig = (
    symbol: CoinjoinSymbol,
    environment?: CoinjoinServerEnvironment,
) => {
    const config = COINJOIN_NETWORKS[symbol as keyof typeof COINJOIN_NETWORKS];
    // Debug settings may still store a removed environment (test 'staging'), use the default one.
    const settings = config
        ? ((environment && config[environment]) ??
          config[Object.keys(config)[0] as CoinjoinServerEnvironment])
        : undefined;
    if (isDevEnv && environment && config && !config[environment]) {
        // the fallback would silently ignore a wrong debug environment, at least report it in dev
        console.warn(
            `Coinjoin environment ${environment} is not configured for ${symbol}, using the default one`,
        );
    }
    if (!settings)
        throw new Error(`Missing settings for coinjoin network ${symbol} env ${environment}`);

    return settings;
};

// One empty list, so that selectors return the same value every time.
const NO_COORDINATORS: readonly CoinjoinCoordinatorConfig[] = [];

// Settings of the network without a coordinator, and the coordinators listed for it.
export const getCoinjoinNetworkSettings = (
    symbol: CoinjoinSymbol,
    environment?: CoinjoinServerEnvironment,
) => {
    const { coordinators = NO_COORDINATORS, ...settings } = getNetworkEnvironmentConfig(
        symbol,
        environment,
    );

    return { settings, coordinators };
};

export const getCoinjoinCoordinators = (
    symbol: CoinjoinSymbol,
    environment?: CoinjoinServerEnvironment,
) => getCoinjoinNetworkSettings(symbol, environment).coordinators;

// The coordinator of the given url, or the default one (the first listed) when that one is not
// listed, for example no longer after an update.
export const getCoinjoinCoordinator = (
    coordinators: readonly CoinjoinCoordinatorConfig[],
    coordinatorUrl?: string,
): CoinjoinCoordinatorConfig | undefined =>
    coordinators.find(listed => listed.coordinatorUrl === coordinatorUrl) ?? coordinators[0];

// Settings of the network with its default coordinator.
export const getCoinjoinConfig = (
    symbol: CoinjoinSymbol,
    environment?: CoinjoinServerEnvironment,
): CoinjoinNetworksConfig => {
    const { settings, coordinators } = getCoinjoinNetworkSettings(symbol, environment);

    return { ...settings, ...getCoinjoinCoordinator(coordinators) };
};
