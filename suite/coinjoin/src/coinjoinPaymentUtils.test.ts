import { testMocks } from '@suite-common/test-utils';
import { asNetworkSymbol } from '@suite-common/wallet-config';
import { type WalletAccountTransaction } from '@suite-common/wallet-types';
import { getUtxoOutpoint } from '@suite-common/wallet-utils';
import { type CoinjoinPaymentAttempt } from '@trezor/coinjoin';

import {
    addCoinjoinPaymentAttempts,
    getClientCoinjoinPayment,
    getCoinjoinPaymentError,
    getCoinjoinPaymentFunding,
    getConnectCoinjoinPayment,
    getHeldBackCoinjoinAnchor,
    getSyncedCoinjoinPayment,
    hasCoinjoinPaymentToMix,
} from './coinjoinPaymentUtils';
import { type CoinjoinAccountPayment, type CoinjoinSession } from './coinjoinTypes';

const PAYEE_P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PAYEE_P2TR = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
// Bytes not all equal, so that reading the anchor in the wrong byte order fails the tests.
const ANCHOR_TXID = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const REVERSED_ANCHOR_TXID = '1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100';
const ANCHOR = getUtxoOutpoint({ txid: ANCHOR_TXID, vout: 1 });
const OTHER_ANCHOR = getUtxoOutpoint({
    txid: '0dac366fd8a67b2a89fbb0d31086e7acded7a5bbf9ef9daa935bc873229ef5b5',
    vout: 0,
});

const PAYMENT: CoinjoinAccountPayment = {
    id: 'payment1',
    address: PAYEE_P2WPKH,
    amount: 50_000,
    anchor: ANCHOR,
    attemptTxids: [],
};

const SESSION: CoinjoinSession = {
    targetAnonymity: 5,
    maxRounds: 10,
    maxFeePerKvbyte: 2000,
    maxCoordinatorFeeRate: 0,
    timeCreated: 0,
    sessionPhaseQueue: [],
    signedRounds: [],
};

const ANCHOR_UTXO = testMocks.getUtxo({ txid: ANCHOR_TXID, vout: 1, confirmations: 1 });

type GetTransactionParams = {
    txid?: string;
    blockHeight?: number;
    vin: WalletAccountTransaction['details']['vin'];
    vout: WalletAccountTransaction['details']['vout'];
};

const getTransaction = ({
    txid = 'c3'.repeat(32),
    blockHeight = 100,
    vin,
    vout,
}: GetTransactionParams) => {
    const transaction = testMocks.getWalletTransaction({ txid, blockHeight });

    return { ...transaction, details: { ...transaction.details, vin, vout } };
};

const ANCHOR_INPUT = {
    n: 0,
    isAddress: true,
    txid: ANCHOR_TXID,
    addresses: ['bc1qown'],
    value: '60000',
};

const spendingAnchor = () => [{ ...ANCHOR_INPUT, vout: 1 }];

const payingPayee = (amount = PAYMENT.amount, address = PAYMENT.address) => [
    { n: 0, isAddress: true, addresses: [address], value: String(amount) },
    { n: 1, isAddress: true, addresses: ['bc1qchange'], value: '9000' },
];

describe('getCoinjoinPaymentError', () => {
    const OWN_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    const params = {
        symbol: asNetworkSymbol('btc'),
        address: PAYEE_P2WPKH,
        amount: 50_000,
        isCoinjoinRunning: false,
        hasUnpaidPayment: false,
        funding: { anchor: ANCHOR, maxAmount: 100_000 },
        isOwnAddress: (address: string) => address === OWN_ADDRESS,
        isUsedAddress: (address: string) => address === PAYEE_P2TR,
    };

    it('accepts a P2WPKH or P2TR payee of the network, in lower or upper case', () => {
        expect(getCoinjoinPaymentError(params)).toBeUndefined();
        expect(
            getCoinjoinPaymentError({
                ...params,
                isUsedAddress: () => false,
                address: PAYEE_P2TR,
            }),
        ).toBeUndefined();
        expect(
            getCoinjoinPaymentError({ ...params, address: ` ${PAYEE_P2WPKH.toUpperCase()} ` }),
        ).toBeUndefined();
    });

    it.each([
        ['P2PKH', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
        ['P2SH', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
        ['P2WSH', 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'],
        ['testnet P2WPKH', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
        ['mixed case P2WPKH', 'bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
        ['empty', ''],
    ])('refuses a payee address: %s', (_type, address) => {
        expect(getCoinjoinPaymentError({ ...params, address })).toBe('INVALID_ADDRESS');
    });

    it('refuses an address of the account and an address already paid or being paid', () => {
        expect(
            getCoinjoinPaymentError({
                ...params,
                isOwnAddress: () => false,
                address: OWN_ADDRESS,
            }),
        ).toBeUndefined();
        expect(getCoinjoinPaymentError({ ...params, address: OWN_ADDRESS.toUpperCase() })).toBe(
            'OWN_ADDRESS',
        );
        expect(getCoinjoinPaymentError({ ...params, address: PAYEE_P2TR })).toBe('ADDRESS_IN_USE');
    });

    it('looks up the addresses only once the cheaper checks pass', () => {
        const isOwnAddress = jest.fn(() => false);
        const isUsedAddress = jest.fn(() => false);

        expect(
            getCoinjoinPaymentError({
                ...params,
                isCoinjoinRunning: true,
                isOwnAddress,
                isUsedAddress,
            }),
        ).toBe('COINJOIN_RUNNING');
        expect(
            getCoinjoinPaymentError({
                ...params,
                address: 'invalid',
                isOwnAddress,
                isUsedAddress,
            }),
        ).toBe('INVALID_ADDRESS');
        expect(isOwnAddress).not.toHaveBeenCalled();
        expect(isUsedAddress).not.toHaveBeenCalled();
    });

    it('checks the amount against the minimum and the private coins', () => {
        expect(getCoinjoinPaymentError({ ...params, amount: 9_999 })).toBe('AMOUNT_TOO_LOW');
        expect(getCoinjoinPaymentError({ ...params, amount: 10_000 })).toBeUndefined();
        expect(getCoinjoinPaymentError({ ...params, amount: 100_000 })).toBeUndefined();
        expect(getCoinjoinPaymentError({ ...params, amount: 100_001 })).toBe('AMOUNT_TOO_HIGH');
        expect(getCoinjoinPaymentError({ ...params, amount: 10_000.5 })).toBe('INVALID_AMOUNT');
        expect(getCoinjoinPaymentError({ ...params, amount: NaN })).toBe('INVALID_AMOUNT');
    });

    it('refuses a payment while coinjoin runs, next to an unpaid one or without private coins', () => {
        expect(getCoinjoinPaymentError({ ...params, isCoinjoinRunning: true, address: '' })).toBe(
            'COINJOIN_RUNNING',
        );
        expect(getCoinjoinPaymentError({ ...params, hasUnpaidPayment: true })).toBe(
            'PAYMENT_EXISTS',
        );
        expect(
            getCoinjoinPaymentError({ ...params, funding: { anchor: undefined, maxAmount: 0 } }),
        ).toBe('NO_PRIVATE_COINS');
        expect(
            getCoinjoinPaymentError({ ...params, funding: { anchor: ANCHOR, maxAmount: 9_999 } }),
        ).toBe('NO_PRIVATE_COINS');
    });
});

describe('getCoinjoinPaymentFunding', () => {
    const getAddress = (index: number) => `bc1qaddress${index}`;
    const getCoin = (index: number, amount: number, confirmations = 1) =>
        testMocks.getUtxo({
            txid: index.toString(16).padStart(64, '0'),
            vout: 0,
            address: getAddress(index),
            amount: String(amount),
            confirmations,
        });
    const params = {
        targetAnonymity: 5,
        inputSize: 58,
        outputSize: 43,
        maxFeePerVbyte: 2,
    };

    it('funds from the largest confirmed private coins that are not detained', () => {
        const utxos = [
            getCoin(1, 300_000),
            getCoin(2, 200_000),
            getCoin(3, 500_000), // not private
            getCoin(4, 400_000, 0), // unconfirmed
            getCoin(5, 250_000), // detained
        ];
        const anonymitySet = {
            [getAddress(1)]: 5,
            [getAddress(2)]: 10,
            [getAddress(3)]: 4,
            [getAddress(4)]: 5,
            [getAddress(5)]: 5,
        };
        const prison = {
            [getUtxoOutpoint(getCoin(5, 250_000))]: {
                type: 'input' as const,
                sentenceEnd: 1,
                sentenceStart: 0,
            },
        };

        expect(getCoinjoinPaymentFunding({ ...params, utxos, anonymitySet, prison })).toEqual({
            anchor: getUtxoOutpoint(getCoin(1, 300_000)),
            // The payment output and two inputs at 2 sat/vB, and 10,000 sat stay in the account.
            maxAmount: 500_000 - (43 + 2 * 58) * 2 - 10_000,
        });
    });

    it('counts at most the ten largest coins', () => {
        const utxos = Array.from({ length: 12 }, (_, index) =>
            getCoin(index + 1, (index + 1) * 100_000),
        );
        const anonymitySet = Object.fromEntries(utxos.map(({ address }) => [address, 5]));
        const largestTen = ((3 + 12) * 10 * 100_000) / 2;

        expect(
            getCoinjoinPaymentFunding({ ...params, utxos, anonymitySet, prison: undefined }),
        ).toEqual({
            anchor: getUtxoOutpoint(getCoin(12, 1_200_000)),
            maxAmount: largestTen - (43 + 10 * 58) * 2 - 10_000,
        });
    });

    it('has no anchor without private coins', () => {
        expect(
            getCoinjoinPaymentFunding({
                ...params,
                utxos: [getCoin(1, 300_000)],
                anonymitySet: {},
                prison: undefined,
            }).anchor,
        ).toBeUndefined();
    });
});

describe('getSyncedCoinjoinPayment', () => {
    const createId = () => 'payment2';
    const sync = (
        payment: CoinjoinAccountPayment,
        transactions: WalletAccountTransaction[],
        newAnchor: string | null = OTHER_ANCHOR,
    ) =>
        getSyncedCoinjoinPayment({
            payment,
            transactions,
            getNewAnchor: () => newAnchor ?? undefined,
            createId,
        });

    it('marks the payment paid once a transaction spending the anchor and paying it confirms', () => {
        const paymentTx = getTransaction({
            txid: 'd4'.repeat(32),
            vin: spendingAnchor(),
            vout: payingPayee(),
        });

        // Also when the attempt was not recorded.
        expect(sync(PAYMENT, [paymentTx])).toEqual({ ...PAYMENT, paidTxid: 'd4'.repeat(32) });
        expect(
            sync({ ...PAYMENT, isCancelled: true, attemptTxids: ['x'] }, [paymentTx]),
        ).toMatchObject({
            paidTxid: 'd4'.repeat(32),
        });
    });

    it('reads a missing input index as 0', () => {
        const payment = { ...PAYMENT, anchor: getUtxoOutpoint({ txid: ANCHOR_TXID, vout: 0 }) };
        const paymentTx = getTransaction({ vin: [ANCHOR_INPUT], vout: payingPayee() });

        expect(sync(payment, [paymentTx])?.paidTxid).toBe(paymentTx.txid);
    });

    it('waits for the confirmation', () => {
        const pendingTx = getTransaction({
            blockHeight: -1,
            vin: spendingAnchor(),
            vout: payingPayee(),
        });

        expect(sync(PAYMENT, [pendingTx])).toBe(PAYMENT);
        // Spending the anchor without confirming changes nothing either.
        expect(
            sync(PAYMENT, [
                getTransaction({ blockHeight: 0, vin: spendingAnchor(), vout: payingPayee(1) }),
            ]),
        ).toBe(PAYMENT);
    });

    it('does not take a payment output that does not spend the anchor or pays another amount', () => {
        const foreignTx = getTransaction({
            vin: [{ n: 0, isAddress: true, txid: 'e5'.repeat(32), vout: 1 }],
            vout: payingPayee(),
        });
        // The anchor's txid in the byte order of the outpoint, not as displayed.
        const reversedAnchorTx = getTransaction({
            vin: [{ n: 0, isAddress: true, txid: REVERSED_ANCHOR_TXID, vout: 1 }],
            vout: payingPayee(),
        });

        expect(sync(PAYMENT, [foreignTx])).toBe(PAYMENT);
        expect(sync(PAYMENT, [reversedAnchorTx])).toBe(PAYMENT);
        expect(
            sync(PAYMENT, [
                getTransaction({ vin: spendingAnchor(), vout: payingPayee(PAYMENT.amount + 1) }),
            ]),
        ).toEqual({
            ...PAYMENT,
            id: 'payment2',
            anchor: OTHER_ANCHOR,
        });
    });

    it('anchors a pending payment anew once its anchor is spent without it', () => {
        const spendTx = getTransaction({
            vin: spendingAnchor(),
            vout: payingPayee(1, 'bc1qother'),
        });

        expect(sync({ ...PAYMENT, attemptTxids: ['attempt'] }, [spendTx])).toEqual({
            ...PAYMENT,
            id: 'payment2',
            anchor: OTHER_ANCHOR,
            attemptTxids: [],
        });
        expect(sync(PAYMENT, [spendTx], null)).toBe(PAYMENT);
    });

    it('drops a cancelled payment and keeps a blocked or paid one once the anchor is spent without it', () => {
        const spendTx = getTransaction({
            vin: spendingAnchor(),
            vout: payingPayee(1, 'bc1qother'),
        });
        const blocked = { ...PAYMENT, isBlocked: true };
        const paid = { ...PAYMENT, paidTxid: 'f6'.repeat(32) };

        expect(sync({ ...PAYMENT, isCancelled: true }, [spendTx])).toBeUndefined();
        expect(sync(blocked, [spendTx])).toBe(blocked);
        expect(sync(paid, [])).toBe(paid);
    });
});

describe('payment for the client and the device', () => {
    it.each([
        [
            'an authorized pending',
            PAYMENT,
            PAYMENT.id,
            true,
            { id: PAYMENT.id, address: PAYMENT.address, amount: PAYMENT.amount, anchor: ANCHOR },
            undefined,
        ],
        ['an unauthorized pending', PAYMENT, 'other', true, undefined, ANCHOR],
        ['an authorized but unavailable', PAYMENT, PAYMENT.id, false, undefined, ANCHOR],
        ['a blocked', { ...PAYMENT, isBlocked: true }, PAYMENT.id, true, undefined, ANCHOR],
        [
            'an unavailable cancelled',
            { ...PAYMENT, isCancelled: true, isBlocked: true },
            undefined,
            false,
            {
                id: PAYMENT.id,
                address: PAYMENT.address,
                amount: PAYMENT.amount,
                anchor: ANCHOR,
                isCancelled: true,
            },
            undefined,
        ],
        [
            'a paid',
            { ...PAYMENT, paidTxid: 'f6'.repeat(32) },
            PAYMENT.id,
            true,
            undefined,
            undefined,
        ],
        ['no', undefined, undefined, true, undefined, undefined],
    ])(
        'passes %s payment and holds back its anchor accordingly',
        (_name, payment, authorizedPaymentId, isAvailable, clientPayment, heldBackAnchor) => {
            const params = { payment, authorizedPaymentId, isAvailable };

            expect(getClientCoinjoinPayment(params)).toEqual(clientPayment);
            expect(getHeldBackCoinjoinAnchor(params)).toBe(heldBackAnchor);
        },
    );

    it('sends the anchor to the device as the txid as displayed and the index', () => {
        expect(getConnectCoinjoinPayment(PAYMENT)).toEqual({
            address: PAYEE_P2WPKH,
            amount: 50_000,
            anchor: { prevHash: ANCHOR_TXID, prevIndex: 1 },
        });
    });
});

describe('hasCoinjoinPaymentToMix', () => {
    const params = {
        payment: PAYMENT,
        session: undefined,
        utxos: [ANCHOR_UTXO],
        isAvailable: true,
    };

    it('mixes an unpaid anchor that is a confirmed coin of the account', () => {
        expect(hasCoinjoinPaymentToMix(params)).toBe(true);
        expect(hasCoinjoinPaymentToMix({ ...params, session: { ...SESSION, paused: true } })).toBe(
            true,
        );
        expect(
            hasCoinjoinPaymentToMix({
                ...params,
                session: { ...SESSION, authorizedPaymentId: PAYMENT.id },
            }),
        ).toBe(true);
        expect(
            hasCoinjoinPaymentToMix({
                ...params,
                payment: { ...PAYMENT, isCancelled: true },
                session: SESSION,
            }),
        ).toBe(true);
    });

    it('mixes the anchor of a cancelled payment that is no longer available', () => {
        expect(
            hasCoinjoinPaymentToMix({
                ...params,
                payment: { ...PAYMENT, isCancelled: true },
                isAvailable: false,
            }),
        ).toBe(true);
    });

    it('has nothing to mix for a spent anchor, a blocked, paid or unavailable payment or another authorized one', () => {
        expect(hasCoinjoinPaymentToMix({ ...params, utxos: [] })).toBe(false);
        expect(
            hasCoinjoinPaymentToMix({ ...params, utxos: [{ ...ANCHOR_UTXO, confirmations: 0 }] }),
        ).toBe(false);
        expect(
            hasCoinjoinPaymentToMix({ ...params, payment: { ...PAYMENT, isBlocked: true } }),
        ).toBe(false);
        expect(
            hasCoinjoinPaymentToMix({
                ...params,
                payment: { ...PAYMENT, paidTxid: 'f6'.repeat(32) },
            }),
        ).toBe(false);
        expect(hasCoinjoinPaymentToMix({ ...params, isAvailable: false })).toBe(false);
        expect(hasCoinjoinPaymentToMix({ ...params, session: SESSION })).toBe(false);
        expect(hasCoinjoinPaymentToMix({ ...params, payment: undefined })).toBe(false);
    });
});

describe('addCoinjoinPaymentAttempts', () => {
    const attempt: CoinjoinPaymentAttempt = {
        accountKey: 'account',
        paymentId: PAYMENT.id,
        address: PAYMENT.address,
        amount: PAYMENT.amount,
        anchor: ANCHOR,
        txid: 'a7'.repeat(32),
        inputs: [ANCHOR],
    };

    it('adds the txids of the attempts once', () => {
        const payment = { ...PAYMENT, attemptTxids: ['b8'.repeat(32)] };

        expect(addCoinjoinPaymentAttempts(payment, [attempt, attempt], PAYMENT.id)).toEqual({
            ...payment,
            attemptTxids: ['b8'.repeat(32), 'a7'.repeat(32)],
        });
    });

    it.each([
        ['another payment', { paymentId: 'other' }],
        ['another payee', { address: PAYEE_P2TR }],
        ['another amount', { amount: PAYMENT.amount + 1 }],
        ['another anchor', { anchor: OTHER_ANCHOR }],
    ])('refuses an attempt of %s', (_name, change) => {
        expect(
            addCoinjoinPaymentAttempts(PAYMENT, [attempt, { ...attempt, ...change }], PAYMENT.id),
        ).toBeUndefined();
    });

    it('refuses attempts of a payment the device did not authorize or that is not pending', () => {
        expect(addCoinjoinPaymentAttempts(PAYMENT, [attempt], undefined)).toBeUndefined();
        expect(
            addCoinjoinPaymentAttempts({ ...PAYMENT, isBlocked: true }, [attempt], PAYMENT.id),
        ).toBeUndefined();
        expect(
            addCoinjoinPaymentAttempts({ ...PAYMENT, isCancelled: true }, [attempt], PAYMENT.id),
        ).toBeUndefined();
    });
});
