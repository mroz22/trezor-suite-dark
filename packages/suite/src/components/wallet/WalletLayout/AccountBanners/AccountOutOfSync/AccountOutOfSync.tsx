import { selectCoinjoinClients } from '@suite/coinjoin';
import { selectIsTorEnabled } from '@suite/tor';
import type { Account } from '@suite-common/wallet-types';

import { useSelector } from '#src/hooks/suite/useSelector';

import { AccountOutdatedBanner } from './AccountOutdatedBanner';
import { AccountSyncingBanner } from './AccountSyncingBanner/AccountSyncingBanner';

type AccountOutOfSyncProps = {
    account: Account | undefined;
};

// A Privacy account goes out of sync only after it was discovered, so its balance and history stay
// on the page and this banner tells whether they are being synced.
export const AccountOutOfSync = ({ account }: AccountOutOfSyncProps) => {
    const isTorEnabled = useSelector(selectIsTorEnabled);
    const coinjoinClients = useSelector(selectCoinjoinClients);

    // Privacy accounts sync over Tor only, and the Tor banner already asks to enable it.
    if (account?.backendType !== 'coinjoin' || account.status !== 'out-of-sync' || !isTorEnabled) {
        return null;
    }

    const isScanning = !!account.syncing;
    // The coinjoin middleware scans the accounts as soon as their client has loaded.
    const isClientLoading = coinjoinClients[account.symbol]?.status === 'loading';

    // Keyed by the account, so another account starts with its own progress and button.
    if (isScanning || isClientLoading) {
        return <AccountSyncingBanner key={account.key} isScanning={isScanning} />;
    }

    return <AccountOutdatedBanner key={account.key} accountKey={account.key} />;
};
