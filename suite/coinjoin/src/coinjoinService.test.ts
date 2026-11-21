import { asNetworkSymbol } from '@suite-common/wallet-config';

import { CoinjoinService } from './coinjoinService';
import { getCoinjoinConfig } from './config';

type MockProxy = {
    channelName: string;
    disable: jest.Mock;
};

// What happened to the proxies, in order.
const mockEvents: string[] = [];
let mockPendingClient: Promise<void> | undefined;

jest.mock('@trezor/env-utils', () => ({
    ...jest.requireActual('@trezor/env-utils'),
    isDesktop: () => true,
}));

jest.mock('@trezor/ipc-proxy', () => ({
    createIpcProxy: jest.fn(async (channelName: string) => {
        if (channelName === 'CoinjoinClient') await mockPendingClient;
        const index = mockEvents.filter(event => event.startsWith('create')).length;
        const name = `${channelName} ${index}`;
        mockEvents.push(`create ${name}`);
        const proxy: MockProxy = {
            channelName,
            disable: jest.fn(() => mockEvents.push(`disable ${name}`)),
        };

        return proxy;
    }),
}));

const btcSymbol = asNetworkSymbol('btc');

describe('CoinjoinService.replaceClient', () => {
    const settings = getCoinjoinConfig(btcSymbol);
    const otherSettings = { ...settings, coordinatorUrl: 'https://other.example/wabisabi/' };

    afterEach(() => {
        CoinjoinService.removeInstance(btcSymbol);
        mockEvents.length = 0;
        mockPendingClient = undefined;
    });

    it('creates the new client before it disables the previous one and keeps the backend', async () => {
        const instance = await CoinjoinService.createInstance({ symbol: btcSymbol, settings });
        const { backend, client: previousClient } = instance;

        const replaced = await CoinjoinService.replaceClient({
            symbol: btcSymbol,
            settings: otherSettings,
        });

        // The same object, so whoever holds the instance uses the new client.
        expect(replaced).toBe(instance);
        expect(CoinjoinService.getInstance(btcSymbol)).toBe(instance);
        expect(instance.backend).toBe(backend);
        expect(instance.client).not.toBe(previousClient);
        expect(mockEvents).toEqual([
            'create CoinjoinBackend 0',
            'create CoinjoinClient 1',
            'create CoinjoinClient 2',
            'disable CoinjoinClient 1',
        ]);
    });

    it('disables the new client when the instance was removed meanwhile', async () => {
        await CoinjoinService.createInstance({ symbol: btcSymbol, settings });
        let createClient = () => {};
        mockPendingClient = new Promise(resolve => {
            createClient = resolve;
        });

        const replacing = CoinjoinService.replaceClient({
            symbol: btcSymbol,
            settings: otherSettings,
        });
        CoinjoinService.removeInstance(btcSymbol);
        createClient();

        expect(await replacing).toBeUndefined();
        expect(CoinjoinService.getInstance(btcSymbol)).toBeUndefined();
        expect(mockEvents.slice(-2)).toEqual([
            'create CoinjoinClient 2',
            'disable CoinjoinClient 2',
        ]);
    });

    it('does nothing without an instance', async () => {
        expect(
            await CoinjoinService.replaceClient({ symbol: btcSymbol, settings: otherSettings }),
        ).toBeUndefined();
        expect(mockEvents).toEqual([]);
    });
});
