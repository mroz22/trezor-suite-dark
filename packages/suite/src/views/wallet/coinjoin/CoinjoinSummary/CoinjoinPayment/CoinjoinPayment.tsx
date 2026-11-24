// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import {
    selectCoinjoinPaymentByAccountKey,
    selectIsCoinjoinPaymentAvailableByAccountKey,
} from '@suite/coinjoin';
import { Translation } from '@suite/intl';
import { type AccountKey } from '@suite-common/wallet-types';
import { Card, Column, H3, Paragraph } from '@trezor/components';

import { useSelector } from '#src/hooks/suite/useSelector';

import { CoinjoinPaymentForm } from './CoinjoinPaymentForm';
import { CoinjoinPaymentStatus } from './CoinjoinPaymentStatus';

type CoinjoinPaymentProps = {
    accountKey: AccountKey;
};

export const CoinjoinPayment = ({ accountKey }: CoinjoinPaymentProps) => {
    const payment = useSelector(state => selectCoinjoinPaymentByAccountKey(state, accountKey));
    const isAvailable = useSelector(state =>
        selectIsCoinjoinPaymentAvailableByAccountKey(state, accountKey),
    );

    // An existing payment stays visible, so that it can be cancelled.
    if (!payment && !isAvailable) {
        return null;
    }

    return (
        <Card margin={{ top: 24 }} data-testid="@coinjoin/payment">
            <Column gap={12} alignItems="stretch">
                <H3>
                    <Translation id="TR_COINJOIN_PAYMENT_HEADING" />
                </H3>
                <Paragraph intent="neutral" priority="secondary" typographyStyle="body-sm">
                    <Translation id="TR_COINJOIN_PAYMENT_DESCRIPTION" />
                </Paragraph>
                {payment ? (
                    <CoinjoinPaymentStatus accountKey={accountKey} />
                ) : (
                    <CoinjoinPaymentForm accountKey={accountKey} />
                )}
            </Column>
        </Card>
    );
};
