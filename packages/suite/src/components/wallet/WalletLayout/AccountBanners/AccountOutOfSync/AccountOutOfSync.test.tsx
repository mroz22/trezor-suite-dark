import '@suite-common/test-utils/globalOverrides';

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
    CLIENT_STATUS_FALLBACK,
    type CoinjoinAccount,
    type CoinjoinClientInstance,
    type syncCoinjoinAccountThunk,
} from '@suite/coinjoin';
import { messages } from '@suite/intl';
import { TorStatus } from '@suite/tor';
import { createTestCompositionRoot } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import { type Account } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { RoundPhase } from '@trezor/coinjoin';
import { mock } from '@trezor/dependency-injection';

import { renderWithProviders } from '#src/support/test-utils/hooksHelper';

import { AccountOutOfSync } from './AccountOutOfSync';
import {
    type MockSuiteState,
    mockInitialAppState,
} from '../../../../../../mocks/mockInitialAppState';

const mockSyncThunk = mock<ReturnType<typeof syncCoinjoinAccountThunk>>(() => Promise.resolve());
const mockSyncCoinjoinAccountThunk = mock<typeof syncCoinjoinAccountThunk>(() => mockSyncThunk);

jest.mock('@suite/coinjoin', () => ({
    ...jest.requireActual('@suite/coinjoin'),
    syncCoinjoinAccountThunk: (...args: Parameters<typeof syncCoinjoinAccountThunk>) =>
        mockSyncCoinjoinAccountThunk(...args),
}));

const BTC = asNetworkSymbol('btc');

type RenderBannerParams = {
    status?: 'ready' | 'out-of-sync';
    isSyncing?: boolean;
    torStatus?: TorStatus;
    clientStatus?: CoinjoinClientInstance['status'];
    roundPhase?: RoundPhase;
};

const renderBanner = ({
    status = 'out-of-sync',
    isSyncing = false,
    torStatus = TorStatus.Enabled,
    clientStatus = 'loaded',
    roundPhase,
}: RenderBannerParams = {}) => {
    const account: Account = {
        ...mockWalletAccount({ symbol: BTC, accountType: 'coinjoin' }),
        backendType: 'coinjoin',
        status,
        syncing: isSyncing,
    };
    const coinjoinAccount: CoinjoinAccount = {
        key: account.key,
        symbol: BTC,
        rawLiquidityClue: null,
        session:
            roundPhase === undefined
                ? undefined
                : {
                      targetAnonymity: 5,
                      maxRounds: 10,
                      maxFeePerKvbyte: 1000,
                      maxCoordinatorFeeRate: 0,
                      timeCreated: 0,
                      sessionPhaseQueue: [],
                      signedRounds: [],
                      roundPhase,
                  },
    };
    const state: MockSuiteState = {
        ...mockInitialAppState,
        tor: { ...mockInitialAppState.tor, torStatus },
        wallet: {
            ...mockInitialAppState.wallet,
            accounts: [account],
            coinjoin: {
                ...mockInitialAppState.wallet.coinjoin,
                accounts: [coinjoinAccount],
                clients: { [BTC]: { ...CLIENT_STATUS_FALLBACK, status: clientStatus } },
            },
        },
    };
    const { services } = createTestCompositionRoot<void, MockSuiteState>({ preloadedState: state });

    renderWithProviders(services, <AccountOutOfSync account={account} />);

    return account;
};

const syncingTitle = messages.TR_COINJOIN_ACCOUNT_SYNCING.defaultMessage;
const outdatedText = messages.TR_COINJOIN_ACCOUNT_OUTDATED.defaultMessage;
const syncNowLabel = messages.TR_COINJOIN_ACCOUNT_SYNC_NOW.defaultMessage;

describe('AccountOutOfSync', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('shows nothing for a synced account', () => {
        renderBanner({ status: 'ready', isSyncing: true });

        expect(screen.queryByText(syncingTitle)).toBeNull();
        expect(screen.queryByText(outdatedText)).toBeNull();
    });

    it('leaves an account that cannot sync without Tor to the Tor banner', () => {
        renderBanner({ torStatus: TorStatus.Disabled });

        expect(screen.queryByText(syncingTitle)).toBeNull();
        expect(screen.queryByText(outdatedText)).toBeNull();
    });

    it('shows the sync of an account that is scanned', () => {
        renderBanner({ isSyncing: true });

        expect(screen.getByText(syncingTitle)).toBeTruthy();
        expect(screen.queryByRole('button', { name: syncNowLabel })).toBeNull();
    });

    it('shows the sync while the coinjoin client loads, as a scan follows', () => {
        renderBanner({ clientStatus: 'loading' });

        expect(screen.getByText(syncingTitle)).toBeTruthy();
    });

    it('syncs an outdated account on request', async () => {
        const account = renderBanner();

        expect(screen.getByText(outdatedText)).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: syncNowLabel }));

        expect(mockSyncCoinjoinAccountThunk).toHaveBeenCalledWith(account.key);
        expect(mockSyncThunk).toHaveBeenCalled();
    });

    it('offers no sync while a coinjoin round is in its critical phase', () => {
        renderBanner({ roundPhase: RoundPhase.OutputRegistration });

        expect(
            screen.getByText(messages.TR_COINJOIN_ACCOUNT_OUTDATED_UNTIL_ROUND_ENDS.defaultMessage),
        ).toBeTruthy();
        expect(screen.queryByRole('button', { name: syncNowLabel })).toBeNull();
    });
});
