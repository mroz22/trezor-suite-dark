import { useState } from 'react';

import { selectIsAnySessionInCriticalPhase, syncCoinjoinAccountThunk } from '@suite/coinjoin';
import { Translation } from '@suite/intl';
import type { AccountKey } from '@suite-common/wallet-types';
import { Banner } from '@trezor/components';
import { useServices } from '@trezor/dependency-injection';
import { injectDispatch } from '@trezor/redux-utils';

import { useSelector } from '#src/hooks/suite/useSelector';

type AccountOutdatedBannerProps = {
    accountKey: AccountKey;
};

export const AccountOutdatedBanner = ({ accountKey }: AccountOutdatedBannerProps) => {
    const isAnySessionInCriticalPhase = useSelector(selectIsAnySessionInCriticalPhase);
    const [isSyncRequested, setIsSyncRequested] = useState(false);
    const { dispatch } = useServices(injectDispatch);

    const handleSyncClick = () => {
        setIsSyncRequested(true);
        dispatch(syncCoinjoinAccountThunk(accountKey)).finally(() => setIsSyncRequested(false));
    };

    // No scan starts while a coinjoin round is in its critical phase, the button would do nothing.
    if (isAnySessionInCriticalPhase) {
        return (
            <Banner
                intent="warning"
                description={<Translation id="TR_COINJOIN_ACCOUNT_OUTDATED_UNTIL_ROUND_ENDS" />}
            />
        );
    }

    return (
        <Banner
            intent="warning"
            description={<Translation id="TR_COINJOIN_ACCOUNT_OUTDATED" />}
            rightContent={
                <Banner.Button onClick={handleSyncClick} isLoading={isSyncRequested}>
                    <Translation id="TR_COINJOIN_ACCOUNT_SYNC_NOW" />
                </Banner.Button>
            }
        />
    );
};
