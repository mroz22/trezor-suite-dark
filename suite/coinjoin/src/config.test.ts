import { asNetworkSymbol } from '@suite-common/wallet-config';

import {
    COINJOIN_NETWORKS,
    type CoinjoinCoordinatorConfig,
    getCoinjoinConfig,
    getCoinjoinCoordinator,
    getCoinjoinCoordinators,
    getCoinjoinNetworkSettings,
} from './config';

const btcSymbol = asNetworkSymbol('btc');
const testSymbol = asNetworkSymbol('test');
const regtestSymbol = asNetworkSymbol('regtest');

describe('getCoinjoinConfig', () => {
    it('falls back to the default environment of the network for a removed one', () => {
        // the fallback warns in dev builds, keep the test output clean
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        // 'staging' may still be stored in persisted debug settings
        expect(getCoinjoinConfig(testSymbol, 'staging' as never)).toEqual(
            COINJOIN_NETWORKS.test?.public,
        );

        warnSpy.mockRestore();
    });

    it('btc has the Suite Dark coordinator, test has none, regtest has a local one', () => {
        expect(getCoinjoinConfig(btcSymbol).coordinatorUrl).toBe(
            'https://coinjoin.kruw.io/wabisabi/',
        );
        expect(getCoinjoinConfig(btcSymbol).wabisabiBackendUrl).toBeUndefined();
        expect(getCoinjoinConfig(testSymbol).coordinatorUrl).toBeUndefined();
        expect(getCoinjoinConfig(testSymbol).wabisabiBackendUrl).toBeUndefined();
        expect(getCoinjoinConfig(regtestSymbol).coordinatorUrl).toBeDefined();
    });
});

describe('coinjoin coordinators', () => {
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
    const COORDINATORS = [DEFAULT_COORDINATOR, OTHER_COORDINATOR];

    const listCoordinators = (coordinators?: CoinjoinCoordinatorConfig[]) => {
        jest.replaceProperty(COINJOIN_NETWORKS, 'test', {
            public: { ...COINJOIN_NETWORKS.test!.public!, coordinators },
        });
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('splits the network settings from the listed coordinators', () => {
        listCoordinators(COORDINATORS);

        const { settings, coordinators } = getCoinjoinNetworkSettings(testSymbol);
        expect(coordinators).toEqual(COORDINATORS);
        expect(getCoinjoinCoordinators(testSymbol)).toEqual(COORDINATORS);
        expect(settings).not.toHaveProperty('coordinators');
        expect(settings).not.toHaveProperty('coordinatorUrl');
        expect(settings.coordinatorName).toBe('CoinJoinCoordinatorIdentifier');
    });

    it('uses the first listed coordinator by default', () => {
        listCoordinators(COORDINATORS);

        const config = getCoinjoinConfig(testSymbol);
        expect(config).toMatchObject(DEFAULT_COORDINATOR);
        expect(config).not.toHaveProperty('coordinators');
    });

    it('finds the coordinator of a url, or the default one when it is not listed', () => {
        expect(getCoinjoinCoordinator(COORDINATORS, OTHER_COORDINATOR.coordinatorUrl)).toBe(
            OTHER_COORDINATOR,
        );
        expect(getCoinjoinCoordinator(COORDINATORS, 'https://removed.example/wabisabi/')).toBe(
            DEFAULT_COORDINATOR,
        );
        expect(getCoinjoinCoordinator(COORDINATORS)).toBe(DEFAULT_COORDINATOR);
        expect(getCoinjoinCoordinator([])).toBeUndefined();
    });

    it('has no coordinator without a list', () => {
        listCoordinators();

        expect(getCoinjoinCoordinators(testSymbol)).toEqual([]);
        // The same empty list every time, so that selectors keep their result.
        expect(getCoinjoinCoordinators(testSymbol)).toBe(getCoinjoinCoordinators(testSymbol));
        expect(getCoinjoinConfig(testSymbol).coordinatorUrl).toBeUndefined();
        expect(getCoinjoinConfig(testSymbol).coordinatorName).toBe('CoinJoinCoordinatorIdentifier');
    });
});
