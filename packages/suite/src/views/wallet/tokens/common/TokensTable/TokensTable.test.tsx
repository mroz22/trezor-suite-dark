import '@suite-common/test-utils/globalOverrides';

import { type SuiteSettingsRootState, suiteSettingsInitialState } from '@suite/settings';
import { Feature, type MessageSystemRootState } from '@suite-common/message-system';
import { mockMessageSystemStateWithFeatureFlags } from '@suite-common/message-system/mocks';
import { createTestCompositionRoot } from '@suite-common/test-utils';
import { TokenManagementAction } from '@suite-common/token-definitions';
import { type tradingThunks } from '@suite-common/trading';
import { asNetworkSymbol, getNetwork } from '@suite-common/wallet-config';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { mock } from '@trezor/dependency-injection';

import { renderWithProviders } from '#src/support/test-utils/hooksHelper';

import { TokensTable } from './TokensTable';

type LoadInitialDataThunkProps = Parameters<typeof tradingThunks.loadInitialDataThunk>[0];

// Stands in for the catalog request, which would otherwise call the trading servers.
const mockLoadInitialDataThunk = mock((_props: LoadInitialDataThunkProps) => () => undefined);

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

type TokensTableState = MessageSystemRootState & SuiteSettingsRootState;

const ETH = asNetworkSymbol('eth');

type RenderTokensTableParams = {
    isRegionRestricted: boolean;
};

const renderTokensTable = ({ isRegionRestricted }: RenderTokensTableParams) => {
    const state: TokensTableState = {
        // The language places the user in the US.
        suiteSettings: { ...suiteSettingsInitialState, language: 'en-US' },
        messageSystem: mockMessageSystemStateWithFeatureFlags(
            { [Feature.regions.presenceRestriction]: isRegionRestricted },
            { [Feature.regions.presenceRestriction]: { countries: ['US'] } },
        ),
    };
    const { services } = createTestCompositionRoot<void, TokensTableState>({
        preloadedState: state,
    });

    renderWithProviders(
        services,
        <TokensTable
            account={mockWalletAccount({ symbol: ETH })}
            network={getNetwork(ETH)}
            tokensWithBalance={[]}
            tokensWithoutBalance={[]}
            tokenStatusType={TokenManagementAction.HIDE}
        />,
    );
};

describe('TokensTable', () => {
    beforeEach(() => {
        mockLoadInitialDataThunk.mockClear();
    });

    it('does not load the trading catalog when the region is restricted', () => {
        renderTokensTable({ isRegionRestricted: true });

        expect(mockLoadInitialDataThunk).not.toHaveBeenCalled();
    });

    it('loads the buy catalog when the region is not restricted', () => {
        renderTokensTable({ isRegionRestricted: false });

        expect(mockLoadInitialDataThunk).toHaveBeenCalledWith({ activeSection: 'buy' });
    });
});
