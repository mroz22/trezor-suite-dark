import { type NetworkSymbol } from '@suite-common/wallet-config';
import {
    type CoinjoinBackend,
    type CoinjoinClient,
    type CoinjoinPrisonInmate,
} from '@trezor/coinjoin';
import { isDesktop } from '@trezor/env-utils';
import { createIpcProxy } from '@trezor/ipc-proxy';

import type { CoinjoinNetworksConfig, CoinjoinSymbol } from './config';
import { getCoinjoinConfig } from './config';

const loadClient = (settings: CoinjoinNetworksConfig) => {
    if (isDesktop()) {
        return createIpcProxy<CoinjoinClient>('CoinjoinClient', { target: { settings } }, settings);
    }

    throw new Error('Coinjoin supported only in Suite Desktop');
};

const loadInstance = (settings: ReturnType<typeof getCoinjoinConfig>) => {
    if (isDesktop()) {
        return Promise.all([
            createIpcProxy<CoinjoinBackend>('CoinjoinBackend', { target: { settings } }, settings),
            loadClient(settings),
        ] as const);
    }

    throw new Error('Coinjoin supported only in Suite Desktop');
};

export interface CoinjoinServiceInstance {
    backend: CoinjoinBackend;
    client: CoinjoinClient;
}

type CoinjoinCreateInstance = {
    symbol: CoinjoinSymbol;
    prison?: CoinjoinPrisonInmate[];
    settings?: CoinjoinNetworksConfig;
};

type ReplaceClientParams = {
    symbol: CoinjoinSymbol;
    prison?: CoinjoinPrisonInmate[];
    settings: CoinjoinNetworksConfig;
};

export class CoinjoinService {
    private static instances: Record<NetworkSymbol, CoinjoinServiceInstance> = {};

    static async createInstance({ symbol, prison, settings }: CoinjoinCreateInstance) {
        if (this.instances[symbol]) return this.instances[symbol];
        const config = settings ?? getCoinjoinConfig(symbol);
        const [backend, client] = await loadInstance({ ...config, prison });
        const instance = { backend, client };

        this.instances[symbol] = instance;

        return instance;
    }

    // Replaces the client of an existing instance, for example for another coordinator. The backend
    // does not use the coordinator, so it keeps running and account scanning is not interrupted.
    // The instance object stays the same, so whoever holds it uses the new client from now on.
    static async replaceClient({ symbol, prison, settings }: ReplaceClientParams) {
        const instance = this.instances[symbol];
        if (!instance) return;
        // The new client is created first, so the instance keeps the previous one if loading fails.
        const client = await loadClient({ ...settings, prison });
        // Removed meanwhile.
        if (this.instances[symbol] !== instance) {
            client.disable();

            return;
        }
        const previousClient = instance.client;
        instance.client = client;
        previousClient.disable();

        return instance;
    }

    static getInstance(symbol: CoinjoinSymbol) {
        return this.instances[symbol];
    }

    static getInstances() {
        return Object.values(this.instances);
    }

    static removeInstance(symbol: CoinjoinSymbol) {
        const instance = this.instances[symbol];
        if (instance) {
            instance.backend.disable();
            instance.client.disable();
            delete this.instances[symbol];
        }
    }
}
