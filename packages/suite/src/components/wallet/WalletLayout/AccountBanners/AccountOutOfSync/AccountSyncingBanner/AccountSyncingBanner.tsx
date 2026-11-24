import { Translation } from '@suite/intl';
import { Banner } from '@trezor/components';

import { AccountSyncProgress } from './AccountSyncProgress';

type AccountSyncingBannerProps = {
    isScanning: boolean;
};

// The progress subscribes to the scan's events when it mounts, which needs the coinjoin service
// the client creates, so it mounts only once the scan runs.
export const AccountSyncingBanner = ({ isScanning }: AccountSyncingBannerProps) => (
    <Banner
        intent="info"
        isLoading
        title={<Translation id="TR_COINJOIN_ACCOUNT_SYNCING" />}
        description={isScanning ? <AccountSyncProgress /> : undefined}
    />
);
