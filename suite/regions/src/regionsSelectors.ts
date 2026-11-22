import { type SuiteSettingsRootState, selectLanguage } from '@suite/settings';
import { type MessageSystemRootState } from '@suite-common/message-system';
import {
    getPlaceholderCountryFromLocale,
    selectIsRegionRestrictedByCountry,
} from '@suite-common/regions';

import { IS_TRADING_HIDDEN } from './trading.suite-dark';

type RegionsRootState = MessageSystemRootState & SuiteSettingsRootState;

const selectPresenceCountry = (state: SuiteSettingsRootState) =>
    getPlaceholderCountryFromLocale(selectLanguage(state));

// Suite Dark: every desktop trading entry point and the wallet-trading-* route guard read this
// selector, so reporting a restricted region hides all of them.
export const selectIsRegionRestricted = (state: RegionsRootState): boolean =>
    IS_TRADING_HIDDEN || selectIsRegionRestrictedByCountry(state, selectPresenceCountry(state));
