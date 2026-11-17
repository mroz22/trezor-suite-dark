import { notificationsActions } from '@suite-common/toast-notifications';
import { createThunk } from '@trezor/redux-utils';

import { type Feedback } from './feedback';

const FEEDBACK_MODULE_PREFIX = '@suite/feedback';

// Suite Dark: feedback forms are removed. A form upstream adds later still sends nothing to
// data.trezor.io: the thunk rejects without a request and the form shows its send error.
export const sendFeedbackThunk = createThunk<void, Feedback, void>(
    `${FEEDBACK_MODULE_PREFIX}/sendFeedback`,
    (_feedback, { dispatch, rejectWithValue }) => {
        dispatch(notificationsActions.addToast({ type: 'user-feedback-send-error' }));

        return rejectWithValue('Suite Dark sends no feedback');
    },
);
