import { type SuiteDeeplink } from './types';

export const SUITE_BRIDGE_DEEPLINK: SuiteDeeplink = 'trezorsuite://bridge-requested-by-a-3rd-party';
export const SUITE_WALLETCONNECT_DEEPLINK: SuiteDeeplink = 'trezorsuite://walletconnect';
export const SUITE_ANCHOR_DEEPLINK_PREFIX: SuiteDeeplink = 'trezorsuite://anchor-';

// Suite Dark: the app registers suitedark://, and http-receiver sends trading partners back there.
export const SUITE_TRADING_REDIRECT_DEEPLINKS: `suitedark://${string}`[] = [
    'suitedark://buy-redirect',
    'suitedark://sell-redirect',
    'suitedark://exchange-redirect',
];
