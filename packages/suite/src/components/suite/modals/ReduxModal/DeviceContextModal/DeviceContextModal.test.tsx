import { IntlProvider } from 'react-intl';

import { render, screen } from '@testing-library/react';

import { MODAL_CONTEXT_DEVICE } from '@suite/modal';
import { mockSuiteDevice } from '@suite-common/suite-types/mocks';

import { DeviceContextModal } from './DeviceContextModal';

const DEVICE = mockSuiteDevice({ connected: true });

// Every selector of the modal gets the device; only the selected device matters here.
jest.mock('#src/hooks/suite/useSelector', () => ({
    useSelector: () => DEVICE,
}));
jest.mock('./ConfirmActionModal', () => ({
    ConfirmActionModal: ({ title }: { title?: string }) => (
        <div data-testid="confirm-action">{title}</div>
    ),
}));
jest.mock('../TransactionReviewModal/TransactionReviewModal', () => ({
    TransactionReviewModal: () => <div data-testid="transaction-review" />,
}));

const renderModal = (data?: { type: 'coinjoin-payment' }) =>
    render(
        <IntlProvider locale="en">
            <DeviceContextModal
                context={MODAL_CONTEXT_DEVICE}
                device={DEVICE}
                windowType="ButtonRequest_ConfirmOutput"
                data={data}
            />
        </IntlProvider>,
    );

describe('DeviceContextModal', () => {
    // Suite Dark: pay in coinjoin.
    it('asks to confirm a coinjoin payment instead of a transaction review', () => {
        renderModal({ type: 'coinjoin-payment' });

        expect(screen.getByTestId('confirm-action')).toHaveTextContent(
            'TR_COINJOIN_PAYMENT_CONFIRM_ON_DEVICE',
        );
        expect(screen.queryByTestId('transaction-review')).not.toBeInTheDocument();
    });

    it('reviews the transaction of any other output to confirm', () => {
        renderModal();

        expect(screen.getByTestId('transaction-review')).toBeInTheDocument();
        expect(screen.queryByTestId('confirm-action')).not.toBeInTheDocument();
    });
});
