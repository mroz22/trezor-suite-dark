import '@suite-common/test-utils/globalOverrides';

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { type SelectedAccountRootState } from '@suite/account';
import {
    type CoinjoinAccountPayment,
    type CoinjoinRootState,
    type CoinjoinSession,
    type SuiteOnlineRootState,
    initialState as coinjoinInitialState,
} from '@suite/coinjoin';
import { messages } from '@suite/intl';
import { type LocksRootState, locksInitialState } from '@suite/locks';
import { type SuiteSettingsRootState, suiteSettingsInitialState } from '@suite/settings';
import { type TorRootState, TorStatus } from '@suite/tor';
import { type DeviceRootState, deviceInitialState } from '@suite-common/device';
import { type DiscreetModeRootState } from '@suite-common/discreet-mode';
import {
    type MessageSystemRootState,
    messageSystemInitialState,
} from '@suite-common/message-system';
import { type TrezorDevice } from '@suite-common/suite-types';
import { mockSuiteDevice } from '@suite-common/suite-types/mocks';
import { createTestCompositionRoot, testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import {
    type TransactionsRootState,
    type WalletSettingsRootState,
    initialWalletSettingsState,
    transactionsInitialState,
} from '@suite-common/wallet-core';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { type StaticSessionId } from '@trezor/connect';

import { renderWithProviders } from '#src/support/test-utils/hooksHelper';

import { CoinjoinPayment } from './CoinjoinPayment';

type CoinjoinPaymentTestState = CoinjoinRootState &
    DeviceRootState &
    DiscreetModeRootState &
    LocksRootState &
    MessageSystemRootState &
    SelectedAccountRootState &
    SuiteOnlineRootState &
    SuiteSettingsRootState &
    TorRootState &
    TransactionsRootState &
    WalletSettingsRootState;

const btc = asNetworkSymbol('btc');
const DEVICE_STATE: StaticSessionId = '1stTestnetAddress@device_id:0';
// BIP84 test vector, a valid P2WPKH address.
const RECEIVE_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const PRIVATE_COIN_ADDRESS = 'bc1pprivate';

const ANCHOR_UTXO = testMocks.getUtxo({
    txid: 'a1'.repeat(32),
    vout: 1,
    address: PRIVATE_COIN_ADDRESS,
    amount: '300000',
    confirmations: 1,
});

const ACCOUNT = mockWalletAccount({
    symbol: btc,
    accountType: 'coinjoin',
    path: "m/10025'/0'/0'/1'",
    deviceState: DEVICE_STATE,
    utxo: [ANCHOR_UTXO],
    addresses: {
        used: [
            {
                address: RECEIVE_ADDRESS,
                path: "m/10025'/0'/0'/1'/0/0",
                transfers: 1,
                balance: '0',
                sent: '0',
                received: '0',
            },
        ],
        unused: [],
        change: [],
        anonymitySet: { [PRIVATE_COIN_ADDRESS]: 10 },
    },
});

const PAYMENT: CoinjoinAccountPayment = {
    id: 'payment1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    amount: 50_000,
    anchor: getUtxoOutpoint(ANCHOR_UTXO),
    attemptTxids: [],
};

const PAUSED_SESSION: CoinjoinSession = {
    targetAnonymity: 5,
    maxRounds: 10,
    maxFeePerKvbyte: 5000,
    maxCoordinatorFeeRate: 0,
    timeCreated: 0,
    sessionPhaseQueue: [],
    signedRounds: [],
    paused: true,
    authorizedPaymentId: PAYMENT.id,
};

const PAYMENT_DEVICE = mockSuiteDevice(
    { state: { staticSessionId: DEVICE_STATE }, remember: true, connected: true },
    { capabilities: ['Capability_Bitcoin', 'Capability_CoinJoinPayment'] },
);

type RenderPaymentParams = {
    payment?: CoinjoinAccountPayment;
    session?: CoinjoinSession;
    device?: TrezorDevice;
};

const renderPayment = ({ payment, session, device = PAYMENT_DEVICE }: RenderPaymentParams) => {
    const preloadedState: CoinjoinPaymentTestState = {
        device: { ...deviceInitialState, devices: [device], selectedDevice: device },
        discreetMode: { isActive: false },
        locks: locksInitialState,
        messageSystem: messageSystemInitialState,
        suite: { online: true },
        suiteSettings: suiteSettingsInitialState,
        tor: { torStatus: TorStatus.Enabled, torBootstrap: null },
        wallet: {
            accounts: [ACCOUNT],
            coinjoin: {
                ...coinjoinInitialState,
                accounts: [
                    { key: ACCOUNT.key, symbol: btc, rawLiquidityClue: null, payment, session },
                ],
            },
            selectedAccount: { status: 'none' },
            settings: initialWalletSettingsState,
            transactions: transactionsInitialState,
        },
    };
    const { services } = createTestCompositionRoot<void, CoinjoinPaymentTestState>({
        preloadedState,
    });

    return renderWithProviders(services, <CoinjoinPayment accountKey={ACCOUNT.key} />);
};

describe('CoinjoinPayment', () => {
    it('is not offered without the capability or on a wallet that is not remembered', () => {
        renderPayment({
            device: mockSuiteDevice(
                { state: { staticSessionId: DEVICE_STATE }, remember: true, connected: true },
                { capabilities: ['Capability_Bitcoin'] },
            ),
        });
        expect(screen.queryByTestId('@coinjoin/payment')).not.toBeInTheDocument();

        renderPayment({ device: { ...PAYMENT_DEVICE, remember: false } });
        expect(screen.queryByTestId('@coinjoin/payment')).not.toBeInTheDocument();
    });

    it('refuses an address of the account', async () => {
        renderPayment({});

        const [addressInput] = screen.getAllByRole('textbox');
        if (!addressInput) throw new Error('The address input is not rendered');
        await userEvent.type(addressInput, RECEIVE_ADDRESS);

        expect(
            screen.getByText(messages.TR_COINJOIN_PAYMENT_OWN_ADDRESS.defaultMessage),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: messages.TR_COINJOIN_PAYMENT_ADD.defaultMessage }),
        ).toBeDisabled();
    });

    it('offers to resume or cancel a paused payment and warns of an earlier attempt', () => {
        renderPayment({
            payment: { ...PAYMENT, attemptTxids: ['b2'.repeat(32)] },
            session: PAUSED_SESSION,
        });

        expect(screen.getByTestId('@coinjoin/payment/status')).toHaveTextContent(
            messages.TR_COINJOIN_PAYMENT_PAUSED.defaultMessage,
        );
        expect(
            screen.getByText(messages.TR_COINJOIN_PAYMENT_EARLIER_ATTEMPT.defaultMessage),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: messages.TR_RESUME.defaultMessage }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: messages.TR_CANCEL.defaultMessage }),
        ).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('shows a paid payment, also on a wallet no longer offered, until it is dismissed', () => {
        renderPayment({
            payment: { ...PAYMENT, attemptTxids: ['b2'.repeat(32)], paidTxid: 'b2'.repeat(32) },
            device: { ...PAYMENT_DEVICE, remember: false },
        });

        expect(screen.getByTestId('@coinjoin/payment/status')).toHaveTextContent(
            messages.TR_COINJOIN_PAYMENT_PAID.defaultMessage,
        );
        expect(
            screen.getByRole('button', { name: messages.TR_DISMISS.defaultMessage }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: messages.TR_CANCEL.defaultMessage }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByText(messages.TR_COINJOIN_PAYMENT_EARLIER_ATTEMPT.defaultMessage),
        ).not.toBeInTheDocument();
    });
});
