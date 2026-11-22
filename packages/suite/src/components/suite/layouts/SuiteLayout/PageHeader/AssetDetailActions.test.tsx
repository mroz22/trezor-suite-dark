import '@suite-common/test-utils/globalOverrides';

import { Feature } from '@suite-common/message-system';
import { mockMessageSystemStateWithFeatureFlags } from '@suite-common/message-system/mocks';
import { createTestCompositionRoot } from '@suite-common/test-utils';
import { type tradingThunks } from '@suite-common/trading';
import { mock } from '@trezor/dependency-injection';
import { noop } from '@trezor/utils';

import { renderWithProviders } from '#src/support/test-utils/hooksHelper';

import { AssetDetailActions } from './AssetDetailActions';
import {
    type MockSuiteState,
    mockInitialAppState,
} from '../../../../../../mocks/mockInitialAppState';

type LoadInitialDataThunkProps = Parameters<typeof tradingThunks.loadInitialDataThunk>[0];

// Stands in for the catalog request, which would otherwise call the trading servers.
const mockLoadInitialDataThunk = mock((_props: LoadInitialDataThunkProps) => () => ({
    abort: noop,
}));

jest.mock('@suite-common/trading', () => {
    const actual = jest.requireActual('@suite-common/trading');

    return {
        ...actual,
        tradingThunks: {
            ...actual.tradingThunks,
            loadInitialDataThunk: (props: LoadInitialDataThunkProps) =>
                mockLoadInitialDataThunk(props),
        },
    };
});

// Suite Dark: the fork hides trading; these tests cover upstream's trading UI.
jest.mock('@suite/regions/src/trading.suite-dark', () => ({ IS_TRADING_HIDDEN: false }));

type RenderAssetDetailActionsParams = {
    isRegionRestricted: boolean;
};

const renderAssetDetailActions = ({ isRegionRestricted }: RenderAssetDetailActionsParams) => {
    const state: MockSuiteState = {
        ...mockInitialAppState,
        // The language places the user in the US.
        suiteSettings: { ...mockInitialAppState.suiteSettings, language: 'en-US' },
        messageSystem: mockMessageSystemStateWithFeatureFlags(
            { [Feature.regions.presenceRestriction]: isRegionRestricted },
            { [Feature.regions.presenceRestriction]: { countries: ['US'] } },
        ),
    };
    const { services } = createTestCompositionRoot<void, MockSuiteState>({
        preloadedState: state,
    });

    renderWithProviders(services, <AssetDetailActions />);
};

describe('AssetDetailActions', () => {
    beforeEach(() => {
        mockLoadInitialDataThunk.mockClear();
    });

    it('does not load the trading catalog when the region is restricted', () => {
        renderAssetDetailActions({ isRegionRestricted: true });

        expect(mockLoadInitialDataThunk).not.toHaveBeenCalled();
    });

    it('loads the buy catalog when the region is not restricted', () => {
        renderAssetDetailActions({ isRegionRestricted: false });

        expect(mockLoadInitialDataThunk).toHaveBeenCalledWith({ activeSection: 'buy' });
    });
});
