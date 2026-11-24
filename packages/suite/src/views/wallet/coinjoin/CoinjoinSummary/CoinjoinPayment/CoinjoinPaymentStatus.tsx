// Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md.
import {
    type CoinjoinPaymentStatus as CoinjoinPaymentStatusType,
    cancelCoinjoinPaymentThunk,
    restoreCoinjoinSessionThunk,
    selectCoinjoinPaymentByAccountKey,
    selectCoinjoinPaymentStatusByAccountKey,
    selectCoinjoinSessionBlockerByAccountKey,
    selectIsAnySessionInCriticalPhase,
} from '@suite/coinjoin';
import { Translation, type TranslationKey } from '@suite/intl';
import { selectAccountByKey } from '@suite-common/wallet-core';
import { type AccountKey } from '@suite-common/wallet-types';
import { formatNetworkAmount } from '@suite-common/wallet-utils';
import { Button, Column, InfoItem, Paragraph, Row, Text } from '@trezor/components';
import { useServices } from '@trezor/dependency-injection';
import { injectDispatch } from '@trezor/redux-utils';

import { FormattedCryptoAmount } from '#src/components/suite/FormattedCryptoAmount';
import { useSelector } from '#src/hooks/suite/useSelector';

const LABEL_WIDTH = 160;

const STATUS_MESSAGES: Record<CoinjoinPaymentStatusType, TranslationKey> = {
    paid: 'TR_COINJOIN_PAYMENT_PAID',
    cancelled: 'TR_COINJOIN_PAYMENT_CANCELLED',
    sending: 'TR_COINJOIN_PAYMENT_SENDING',
    blocked: 'TR_COINJOIN_PAYMENT_BLOCKED',
    unavailable: 'TR_COINJOIN_PAYMENT_UNAVAILABLE',
    paused: 'TR_COINJOIN_PAYMENT_PAUSED',
    'needs-restart': 'TR_COINJOIN_PAYMENT_NEEDS_RESTART',
    waiting: 'TR_COINJOIN_PAYMENT_WAITING',
};

const CANCELLABLE_STATUSES: CoinjoinPaymentStatusType[] = [
    'waiting',
    'paused',
    'needs-restart',
    'blocked',
    'unavailable',
];

type CoinjoinPaymentStatusProps = {
    accountKey: AccountKey;
};

export const CoinjoinPaymentStatus = ({ accountKey }: CoinjoinPaymentStatusProps) => {
    const payment = useSelector(state => selectCoinjoinPaymentByAccountKey(state, accountKey));
    const status = useSelector(state => selectCoinjoinPaymentStatusByAccountKey(state, accountKey));
    const symbol = useSelector(state => selectAccountByKey(state, accountKey)?.symbol);
    const isCriticalPhase = useSelector(selectIsAnySessionInCriticalPhase);
    const sessionBlocker = useSelector(state =>
        selectCoinjoinSessionBlockerByAccountKey(state, accountKey),
    );

    const { dispatch } = useServices(injectDispatch);

    if (!payment || !status || !symbol) {
        return null;
    }

    const handleResume = () => dispatch(restoreCoinjoinSessionThunk(accountKey));
    const handleCancel = () => dispatch(cancelCoinjoinPaymentThunk(accountKey));

    const hasEarlierAttempt = payment.attemptTxids.length > 0 && status !== 'paid';
    const isResumeShown = status === 'paused';
    const isCancelShown = CANCELLABLE_STATUSES.includes(status);
    const isDismissShown = status === 'paid';

    return (
        <Column gap={12} alignItems="stretch">
            <InfoItem
                direction="row"
                labelWidth={LABEL_WIDTH}
                label={<Translation id="TR_RECIPIENT_ADDRESS" />}
            >
                <Text wordBreak="break-all">{payment.address}</Text>
            </InfoItem>
            <InfoItem direction="row" labelWidth={LABEL_WIDTH} label={<Translation id="AMOUNT" />}>
                <FormattedCryptoAmount
                    value={formatNetworkAmount(String(payment.amount), symbol)}
                    networkSymbol={symbol}
                />
            </InfoItem>
            <Paragraph typographyStyle="body-sm" data-testid="@coinjoin/payment/status">
                <Translation id={STATUS_MESSAGES[status]} />
            </Paragraph>
            {hasEarlierAttempt && (
                <Paragraph intent="neutral" priority="secondary" typographyStyle="body-sm">
                    <Translation id="TR_COINJOIN_PAYMENT_EARLIER_ATTEMPT" />
                </Paragraph>
            )}
            <Row gap={8} justifyContent="flex-end">
                {isResumeShown && (
                    <Button
                        size="small"
                        onClick={handleResume}
                        isDisabled={isCriticalPhase || !!sessionBlocker}
                    >
                        <Translation id="TR_RESUME" />
                    </Button>
                )}
                {isCancelShown && (
                    <Button
                        size="small"
                        intent="neutral"
                        priority="secondary"
                        onClick={handleCancel}
                        isDisabled={isCriticalPhase}
                    >
                        <Translation id="TR_CANCEL" />
                    </Button>
                )}
                {isDismissShown && (
                    <Button
                        size="small"
                        intent="neutral"
                        priority="secondary"
                        onClick={handleCancel}
                        isDisabled={isCriticalPhase}
                    >
                        <Translation id="TR_DISMISS" />
                    </Button>
                )}
            </Row>
        </Column>
    );
};
