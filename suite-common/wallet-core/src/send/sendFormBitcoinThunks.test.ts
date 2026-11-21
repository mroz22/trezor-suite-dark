import { createTestCompositionRoot, testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol, getNetwork } from '@suite-common/wallet-config';
import { type Account, type FeeInfo, type FormState } from '@suite-common/wallet-types';
import { mockWalletAccount } from '@suite-common/wallet-types/mocks';
import TrezorConnect, { PROTO } from '@trezor/connect';

import { composeBitcoinTransactionFeeLevelsThunk } from './sendFormBitcoinThunks';
import { type WalletSettingsRootState } from '../settings/walletSettingsReducer';

const RECIPIENT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

// Change addresses 0 to 9, the one with index 3 has a confirmed transaction.
const createAccount = (accountType: Account['accountType']) =>
    mockWalletAccount({
        symbol: asNetworkSymbol('btc'),
        accountType,
        path: "m/10025'/0'/0'/1'",
        addresses: {
            change: Array.from({ length: 10 }, (_, index) => ({
                address: `bc1p${index}`,
                path: `m/10025'/0'/0'/1'/1/${index}`,
                transfers: index === 3 ? 1 : 0,
                balance: '0',
                sent: '0',
                received: '0',
            })),
            used: [],
            unused: [],
        },
        utxo: [
            testMocks.getUtxo({ address: 'bc1p3', amount: '100000' }),
            // An unconfirmed output, as of a broadcast coinjoin.
            testMocks.getUtxo({
                address: 'bc1p5',
                amount: '1000',
                confirmations: 0,
                txid: 'f'.repeat(64),
            }),
        ],
    });

const feeInfo: FeeInfo = {
    blockHeight: 0,
    blockTime: -1,
    minFee: 1,
    maxFee: 100,
    minPriorityFee: -1,
    levels: [{ label: 'normal', feePerUnit: '1', blocks: -1 }],
};

const formState = {
    outputs: [{ type: 'payment', address: RECIPIENT, amount: '0.0001' }],
    selectedFee: 'normal',
    options: ['broadcast'],
} as unknown as FormState;

const compose = (account: Account, prison?: Record<string, unknown>) =>
    createTestCompositionRoot<void, WalletSettingsRootState>({
        preloadedState: { wallet: { settings: { bitcoinAmountUnit: PROTO.AmountUnit.BITCOIN } } },
    })
        .services.store.dispatch(
            composeBitcoinTransactionFeeLevelsThunk({
                formState,
                composeContext: { account, network: getNetwork('btc'), feeInfo, prison },
            }),
        )
        .unwrap();

describe('composeBitcoinTransactionFeeLevelsThunk', () => {
    let mockComposeTransaction: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        mockComposeTransaction = jest.spyOn(TrezorConnect, 'composeTransaction').mockResolvedValue({
            success: true,
            payload: [
                { type: 'nonfinal', totalSpent: '10200', fee: '200', feePerByte: '1', bytes: 200 },
            ],
        } as any);
    });

    const expectChangeAddress = (address: string) =>
        expect(mockComposeTransaction).toHaveBeenCalledWith(
            expect.objectContaining({ changeAddress: expect.objectContaining({ address }) }),
        );

    it('takes the change of a coinjoin account after its last used change address', async () => {
        // Below the last used address and detained or with an unconfirmed output: none of them.
        await compose(createAccount('coinjoin'), { bc1p4: { type: 'output' } });

        expectChangeAddress('bc1p6');
    });

    it('takes the first unused change address of another account', async () => {
        await compose(createAccount('normal'));

        expectChangeAddress('bc1p0');
    });
});
