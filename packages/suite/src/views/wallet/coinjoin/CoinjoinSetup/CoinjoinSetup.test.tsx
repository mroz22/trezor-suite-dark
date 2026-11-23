import '@suite-common/test-utils/globalOverrides';

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { type SelectedAccountRootState } from '@suite/account';
import {
    COINJOIN_NETWORKS,
    type CoinjoinAccount,
    type CoinjoinAction,
    type CoinjoinCoordinatorConfig,
    type CoinjoinRootState,
    type CoinjoinSession,
    initialState as coinjoinInitialState,
    coinjoinReducer,
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

// DEFAULT_TARGET_ANONYMITY, and the max mining fee of the coinjoin config, which Recommended prefers
// to the fee rate median and which differs from every other value here.
const RECOMMENDED_TARGET_ANONYMITY = '5';
const CONFIG_MAX_MINING_FEE = 42;

const renderSetup = (session?: CoinjoinSession) => {
    const account: CoinjoinAccount = {
        key: ACCOUNT_KEY,
        symbol: btcSymbol,
        rawLiquidityClue: null,
        session,
    };
    const preloadedState: CoinjoinSetupState = {
        suiteSettings: suiteSettingsInitialState,
        wallet: {
            coinjoin: {
                ...coinjoinInitialState,
                config: { ...coinjoinInitialState.config, maxFeePerVbyte: CONFIG_MAX_MINING_FEE },
                accounts: [account],
            },
            selectedAccount: { status: 'none' },
            accounts: [],
        },
    };
    const { services } = createTestCompositionRoot<void, CoinjoinSetupState>({
        preloadedState,
        reducer: (state = preloadedState, action) => ({
            ...state,
            wallet: {
                ...state.wallet,
                coinjoin: coinjoinReducer(state.wallet.coinjoin, action as CoinjoinAction),
            },
        }),
    });

    return renderWithProviders(services, <CoinjoinSetup accountKey={ACCOUNT_KEY} />);
};

// react-select loads with the first rendered Select, which can take seconds on a busy runner.
const findCoordinatorSelect = async () =>
    within(
        await screen.findByTestId('@coinjoin/coordinator-select/input', {}, { timeout: 10_000 }),
    ).getByRole('combobox');

const getSettings = () => {
    const [anonymityInput, maxMiningFeeInput] = screen.getAllByRole<HTMLInputElement>('textbox');
    const [anonymitySlider, maxMiningFeeSlider] = screen.getAllByRole<HTMLInputElement>('slider');
    if (!anonymityInput || !maxMiningFeeInput || !anonymitySlider || !maxMiningFeeSlider) {
        throw new Error('The anonymity level and max mining fee settings are not rendered');
    }

    return {
        anonymityInput,
        maxMiningFeeInput,
        anonymitySlider,
        maxMiningFeeSlider,
        skipRoundsSwitch: screen.getByRole('switch'),
    };
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

    it('shows the recommended values read-only and makes them editable with the custom setup', async () => {
        renderSetup();

        const coordinatorSelect = await findCoordinatorSelect();
        const settings = getSettings();
        const recommendedAnonymityPosition = settings.anonymitySlider.value;

        expect(
            screen.getByRole('radio', { name: messages.TR_RECOMMENDED.defaultMessage }),
        ).toBeChecked();
        expect(settings.anonymityInput).toHaveValue(RECOMMENDED_TARGET_ANONYMITY);
        expect(settings.maxMiningFeeInput).toHaveValue(String(CONFIG_MAX_MINING_FEE));
        expect(settings.skipRoundsSwitch).not.toBeChecked();
        expect(screen.getByText(DEFAULT_COORDINATOR.coordinatorUrl)).toBeInTheDocument();
        [...Object.values(settings), coordinatorSelect].forEach(element =>
            expect(element).toBeDisabled(),
        );

        await userEvent.click(
            screen.getByRole('radio', { name: messages.TR_CUSTOM.defaultMessage }),
        );

        const customSettings = getSettings();
        expect(customSettings.anonymityInput).toHaveValue(RECOMMENDED_TARGET_ANONYMITY);
        expect(customSettings.maxMiningFeeInput).toHaveValue(String(CONFIG_MAX_MINING_FEE));
        [...Object.values(customSettings), await findCoordinatorSelect()].forEach(element =>
            expect(element).toBeEnabled(),
        );

        await userEvent.type(customSettings.anonymityInput, '30{Enter}');
        await userEvent.type(getSettings().maxMiningFeeInput, '100{Enter}');

        expect(getSettings().anonymityInput).toHaveValue('30');
        expect(getSettings().anonymitySlider).not.toHaveValue(recommendedAnonymityPosition);
        expect(getSettings().maxMiningFeeInput).toHaveValue('100');

        await userEvent.click(
            screen.getByRole('radio', { name: messages.TR_RECOMMENDED.defaultMessage }),
        );

        const restoredSettings = getSettings();
        expect(restoredSettings.anonymityInput).toHaveValue(RECOMMENDED_TARGET_ANONYMITY);
        expect(restoredSettings.anonymitySlider).toHaveValue(recommendedAnonymityPosition);
        expect(restoredSettings.maxMiningFeeInput).toHaveValue(String(CONFIG_MAX_MINING_FEE));
        expect(restoredSettings.anonymityInput).toBeDisabled();

        await userEvent.click(
            screen.getByRole('radio', { name: messages.TR_CUSTOM.defaultMessage }),
        );
        // Leaving the input empty restores its last value, which must not be the 100 of before.
        await userEvent.type(getSettings().maxMiningFeeInput, '{Enter}');

        expect(getSettings().maxMiningFeeInput).toHaveValue(String(CONFIG_MAX_MINING_FEE));
    }, 20_000);

    it('shows the max mining fee of a running session with the recommended setup', async () => {
        renderSetup({
            targetAnonymity: 5,
            maxRounds: 10,
            maxFeePerKvbyte: 7000,
            maxCoordinatorFeeRate: 0,
            timeCreated: 0,
            sessionPhaseQueue: [],
            signedRounds: [],
        });

        const coordinatorSelect = await findCoordinatorSelect();
        const settings = getSettings();

        expect(settings.anonymityInput).toHaveValue(RECOMMENDED_TARGET_ANONYMITY);
        expect(settings.maxMiningFeeInput).toHaveValue('7');
        [...Object.values(settings), coordinatorSelect, ...screen.getAllByRole('radio')].forEach(
            element => expect(element).toBeDisabled(),
        );
    }, 15_000);
});
