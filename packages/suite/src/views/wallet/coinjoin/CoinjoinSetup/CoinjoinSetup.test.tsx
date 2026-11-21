import '@suite-common/test-utils/globalOverrides';

import { screen } from '@testing-library/react';

import { type SelectedAccountRootState } from '@suite/account';
import {
    COINJOIN_NETWORKS,
    type CoinjoinAccount,
    type CoinjoinCoordinatorConfig,
    type CoinjoinRootState,
    initialState as coinjoinInitialState,
} from '@suite/coinjoin';
import { messages } from '@suite/intl';
import { type SuiteSettingsRootState, suiteSettingsInitialState } from '@suite/settings';
import { createTestCompositionRoot } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import { mockAccountKey } from '@suite-common/wallet-types/mocks';

import { renderWithProviders } from '#src/support/test-utils/hooksHelper';

import { CoinjoinSetup } from './CoinjoinSetup';

type CoinjoinSetupState = CoinjoinRootState & SelectedAccountRootState & SuiteSettingsRootState;

const btcSymbol = asNetworkSymbol('btc');
const ACCOUNT_KEY = mockAccountKey({ symbol: btcSymbol });

const DEFAULT_COORDINATOR: CoinjoinCoordinatorConfig = {
    coordinatorUrl: 'https://default.example/wabisabi/',
    coordinatorName: 'CoinJoinCoordinatorIdentifier',
};
const OTHER_COORDINATOR: CoinjoinCoordinatorConfig = {
    coordinatorUrl: 'https://other.example/wabisabi/',
    coordinatorName: 'CoinJoinCoordinatorIdentifier',
};

const renderSetup = (setup: CoinjoinAccount['setup']) => {
    const account: CoinjoinAccount = {
        key: ACCOUNT_KEY,
        symbol: btcSymbol,
        rawLiquidityClue: null,
        setup,
    };
    const { services } = createTestCompositionRoot<void, CoinjoinSetupState>({
        preloadedState: {
            suiteSettings: suiteSettingsInitialState,
            wallet: {
                coinjoin: { ...coinjoinInitialState, accounts: [account] },
                selectedAccount: { status: 'none' },
                accounts: [],
            },
        },
    });

    return renderWithProviders(services, <CoinjoinSetup accountKey={ACCOUNT_KEY} />);
};

describe('CoinjoinSetup', () => {
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

    it('hides the coordinator with the recommended setup', () => {
        renderSetup(undefined);

        expect(
            screen.queryByText(messages.TR_COINJOIN_COORDINATOR.defaultMessage),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(DEFAULT_COORDINATOR.coordinatorUrl)).not.toBeInTheDocument();
    });

    // react-select loads with the first rendered Select, which can take seconds on a busy runner,
    // so the wait for it and the test get more than the default 1 s and 5 s.
    it('shows the coordinator with the custom setup', async () => {
        renderSetup({ targetAnonymity: 5, maxFeePerVbyte: 10, skipRounds: false });

        expect(
            screen.getByText(messages.TR_COINJOIN_COORDINATOR.defaultMessage),
        ).toBeInTheDocument();
        expect(screen.getByText(DEFAULT_COORDINATOR.coordinatorUrl)).toBeInTheDocument();
        expect(
            await screen.findByTestId(
                '@coinjoin/coordinator-select/input',
                {},
                { timeout: 10_000 },
            ),
        ).toBeInTheDocument();
    }, 15_000);
});
