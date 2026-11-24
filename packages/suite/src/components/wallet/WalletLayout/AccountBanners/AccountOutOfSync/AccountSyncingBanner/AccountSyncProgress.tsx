import { useTheme } from 'styled-components';

import { Translation } from '@suite/intl';
import { selectLanguage } from '@suite/settings';
import { Column, ProgressBar } from '@trezor/components';
import { localizeNumber } from '@trezor/utils';

import { useCoinjoinAccountLoadingProgress } from '#src/hooks/coinjoin/useCoinjoinAccountLoadingProgress';
import { useSelector } from '#src/hooks/suite/useSelector';

export const AccountSyncProgress = () => {
    const locale = useSelector(selectLanguage);
    const theme = useTheme();
    const { messageId, outOf, progress } = useCoinjoinAccountLoadingProgress();

    const messageValues = outOf && {
        current: localizeNumber(outOf.current, locale),
        total: localizeNumber(outOf.total, locale),
    };

    return (
        <Column gap={8} alignItems="stretch">
            {messageId !== undefined && <Translation id={messageId} values={messageValues} />}
            <ProgressBar
                max={1.01}
                value={progress}
                backgroundColor={theme.elementFillNeutralSoft}
            />
        </Column>
    );
};
