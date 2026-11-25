import styled from 'styled-components';

import { Translation } from '@suite/intl';
import { type AccountKey } from '@suite-common/wallet-types';
import { H3 } from '@trezor/components';

import { CoinjoinBalanceSection } from './CoinjoinBalanceSection';
import { CoinjoinPayment } from './CoinjoinPayment/CoinjoinPayment';

const Container = styled.div`
    width: 100%;
`;

interface CoinjoinSummaryProps {
    accountKey: AccountKey;
}

export const CoinjoinSummary = ({ accountKey }: CoinjoinSummaryProps) => (
    <Container>
        <H3 margin={{ bottom: 24 }}>
            <Translation id="TR_MY_COINS" />
        </H3>

        <CoinjoinBalanceSection accountKey={accountKey} />
        {/* Suite Dark: pay in coinjoin, see docs/features/pay-in-coinjoin.md. */}
        <CoinjoinPayment accountKey={accountKey} />
    </Container>
);
