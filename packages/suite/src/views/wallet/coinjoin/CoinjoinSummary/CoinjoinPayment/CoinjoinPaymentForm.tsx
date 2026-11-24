// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import { useState } from 'react';

import {
    type CoinjoinPaymentError,
    createCoinjoinPaymentThunk,
    selectCoinjoinPaymentErrorByAccountKey,
} from '@suite/coinjoin';
import { Translation, type TranslationKey } from '@suite/intl';
import { type NetworkSymbol, getNetworkDisplaySymbol } from '@suite-common/wallet-config';
import { selectAccountByKey } from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { asAmountUnit, unitsToSubunits } from '@suite-common/wallet-utils';
import { COINJOIN_PAYMENT_MIN_AMOUNT } from '@trezor/coinjoin';
import { Banner, Button, Column, Input, Text } from '@trezor/components';
import { useServices } from '@trezor/dependency-injection';
import { injectDispatch } from '@trezor/redux-utils';
import { BigNumber } from '@trezor/utils';

import { useSelector } from '#src/hooks/suite/useSelector';
import { useBitcoinAmountUnit } from '#src/hooks/wallet/useBitcoinAmountUnit';

const ERROR_MESSAGES: Record<CoinjoinPaymentError, TranslationKey> = {
    COINJOIN_RUNNING: 'TR_COINJOIN_PAYMENT_STOP_COINJOIN',
    PAYMENT_EXISTS: 'TR_COINJOIN_PAYMENT_EXISTS',
    NO_PRIVATE_COINS: 'TR_COINJOIN_PAYMENT_NO_PRIVATE_COINS',
    INVALID_ADDRESS: 'TR_COINJOIN_PAYMENT_INVALID_ADDRESS',
    OWN_ADDRESS: 'TR_COINJOIN_PAYMENT_OWN_ADDRESS',
    ADDRESS_IN_USE: 'TR_COINJOIN_PAYMENT_ADDRESS_IN_USE',
    INVALID_AMOUNT: 'TR_COINJOIN_PAYMENT_INVALID_AMOUNT',
    AMOUNT_TOO_LOW: 'TR_COINJOIN_PAYMENT_AMOUNT_TOO_LOW',
    AMOUNT_TOO_HIGH: 'TR_COINJOIN_PAYMENT_AMOUNT_TOO_HIGH',
};

// Errors of the whole form, shown before anything is typed.
const FORM_ERRORS: CoinjoinPaymentError[] = [
    'COINJOIN_RUNNING',
    'PAYMENT_EXISTS',
    'NO_PRIVATE_COINS',
];
const ADDRESS_ERRORS: CoinjoinPaymentError[] = ['INVALID_ADDRESS', 'OWN_ADDRESS', 'ADDRESS_IN_USE'];
const AMOUNT_ERRORS: CoinjoinPaymentError[] = [
    'INVALID_AMOUNT',
    'AMOUNT_TOO_LOW',
    'AMOUNT_TOO_HIGH',
];

type GetAmountInSatsParams = {
    amount: string;
    symbol: NetworkSymbol;
    isInSats: boolean;
};

// NaN for an amount that is not a number, which the payment refuses like a fraction of a sat.
const getAmountInSats = ({ amount, symbol, isInSats }: GetAmountInSatsParams) => {
    const value = new BigNumber(amount.trim());
    if (isInSats || value.isNaN()) return value.toNumber();

    return unitsToSubunits({ value: asAmountUnit(value), symbol }).toNumber();
};

type FieldErrorParams = {
    error: CoinjoinPaymentError | undefined;
    value: string;
    fieldErrors: CoinjoinPaymentError[];
};

// An error of the field, once something is typed in it.
const getFieldError = ({ error, value, fieldErrors }: FieldErrorParams) =>
    error && value.trim() && fieldErrors.includes(error) ? error : undefined;

type CoinjoinPaymentFormProps = {
    accountKey: AccountKey;
};

export const CoinjoinPaymentForm = ({ accountKey }: CoinjoinPaymentFormProps) => {
    const symbol = useSelector(state => selectAccountByKey(state, accountKey)?.symbol);

    const [address, setAddress] = useState('');
    const [amount, setAmount] = useState('');

    const { shouldSendInSats } = useBitcoinAmountUnit(symbol);
    const { dispatch } = useServices(injectDispatch);

    const amountInSats = symbol
        ? getAmountInSats({ amount, symbol, isInSats: !!shouldSendInSats })
        : NaN;
    const error = useSelector(state =>
        selectCoinjoinPaymentErrorByAccountKey(state, accountKey, {
            address,
            amount: amountInSats,
        }),
    );

    if (!symbol) {
        return null;
    }

    const handleSubmit = () =>
        dispatch(createCoinjoinPaymentThunk({ accountKey, address, amount: amountInSats }));

    const formError = error && FORM_ERRORS.includes(error) ? error : undefined;
    const addressError = getFieldError({ error, value: address, fieldErrors: ADDRESS_ERRORS });
    const amountError = getFieldError({ error, value: amount, fieldErrors: AMOUNT_ERRORS });
    const isDisabled = !!formError;

    return (
        <Column gap={12} alignItems="stretch">
            {formError ? (
                <Banner
                    intent="info"
                    description={<Translation id={ERROR_MESSAGES[formError]} />}
                />
            ) : null}
            <Input
                label={<Translation id="TR_RECIPIENT_ADDRESS" />}
                value={address}
                onChange={event => setAddress(event.target.value)}
                isDisabled={isDisabled}
                hasError={!!addressError}
                bottomText={
                    addressError ? <Translation id={ERROR_MESSAGES[addressError]} /> : undefined
                }
                data-testid="@coinjoin/payment/address"
            />
            <Input
                label={<Translation id="AMOUNT" />}
                value={amount}
                onChange={event => setAmount(event.target.value)}
                isDisabled={isDisabled}
                hasError={!!amountError}
                rightContent={
                    <Text>{shouldSendInSats ? 'sat' : getNetworkDisplaySymbol(symbol)}</Text>
                }
                bottomText={
                    amountError ? (
                        <Translation
                            id={ERROR_MESSAGES[amountError]}
                            values={{ min: COINJOIN_PAYMENT_MIN_AMOUNT }}
                        />
                    ) : undefined
                }
                data-testid="@coinjoin/payment/amount"
            />
            <Button onClick={handleSubmit} isDisabled={!!error} data-testid="@coinjoin/payment/add">
                <Translation id="TR_COINJOIN_PAYMENT_ADD" />
            </Button>
        </Column>
    );
};
