import styled from 'styled-components';

import {
    DEFAULT_TARGET_ANONYMITY,
    SKIP_ROUNDS_BY_DEFAULT,
    coinjoinAccountUpdateSetupOption,
    isCoinjoinSupportedSymbol,
    selectCoinjoinAccountByKey,
    selectDefaultMaxMiningFeeByAccountKey,
} from '@suite/coinjoin';
import { Translation } from '@suite/intl';
import { type AccountKey } from '@suite-common/wallet-types';
import { Banner, Card, Radio } from '@trezor/components';
import { useServices } from '@trezor/dependency-injection';
import { injectDispatch } from '@trezor/redux-utils';

import { useSelector } from '#src/hooks/suite/useSelector';

import { AnonymityLevelSetup } from './AnonymityLevelSetup';
import { CoordinatorSetup } from './CoordinatorSetup';
import { MaxMiningFeeSetup } from './MaxMiningFeeSetup';
import { SkipRoundsSetup } from './SkipRoundsSetup';

const SetupOptions = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 12px 40px;
`;

const SetupSettings = styled.div`
    border-top: 1px solid ${({ theme }) => theme.surfaceBorderRaised};
    display: flex;
    flex-direction: column;
    gap: 32px;
    margin-top: 24px;
    padding-top: 16px;
`;

interface CoinjoinSetupProps {
    accountKey: AccountKey;
}

export const CoinjoinSetup = ({ accountKey }: CoinjoinSetupProps) => {
    const coinjoinAccount = useSelector(state => selectCoinjoinAccountByKey(state, accountKey));
    const defaultMaxMiningFee = useSelector(state =>
        selectDefaultMaxMiningFeeByAccountKey(state, accountKey),
    );

    const { dispatch } = useServices(injectDispatch);

    if (!coinjoinAccount) {
        return null;
    }

    const { setup, session } = coinjoinAccount;
    const isRecommended = !setup;
    const hasSession = !!session;
    // Without a custom setup the settings show, read-only, the values of the running session or
    // those a new session would use. A session keeps the max mining fee it authorized, while the
    // default one follows the fee rate median.
    const settings = setup ?? {
        targetAnonymity: session?.targetAnonymity ?? DEFAULT_TARGET_ANONYMITY,
        maxFeePerVbyte: session ? session.maxFeePerKvbyte / 1000 : defaultMaxMiningFee,
        skipRounds: session ? !!session.skipRounds : SKIP_ROUNDS_BY_DEFAULT,
    };

    const handleSetupOptionChange = (isRecommendedChosen: boolean) => {
        if (isRecommendedChosen !== isRecommended) {
            dispatch(coinjoinAccountUpdateSetupOption(accountKey, isRecommendedChosen));
        }
    };
    const setRecommendedSetup = () => handleSetupOptionChange(true);
    const setCustomSetup = () => handleSetupOptionChange(false);

    return (
        <Card>
            {hasSession && (
                <Banner
                    intent="info"
                    description={<Translation id="TR_DISABLED_ANONYMITY_CHANGE_MESSAGE" />}
                    margin={{ bottom: 16 }}
                />
            )}
            <SetupOptions>
                <Radio
                    isChecked={isRecommended}
                    onChange={setRecommendedSetup}
                    isDisabled={hasSession}
                >
                    <Translation id="TR_RECOMMENDED" />
                </Radio>
                <Radio isChecked={!isRecommended} onChange={setCustomSetup} isDisabled={hasSession}>
                    <Translation id="TR_CUSTOM" />
                </Radio>
            </SetupOptions>
            {/* The sliders keep their own position and last input, so remount them on a switch. */}
            <SetupSettings key={isRecommended ? 'recommended' : 'custom'}>
                <AnonymityLevelSetup
                    accountKey={accountKey}
                    targetAnonymity={settings.targetAnonymity}
                    isDisabled={isRecommended}
                />
                <MaxMiningFeeSetup
                    accountKey={accountKey}
                    maxMiningFee={settings.maxFeePerVbyte}
                    isDisabled={isRecommended}
                />
                <SkipRoundsSetup
                    accountKey={accountKey}
                    skipRounds={settings.skipRounds}
                    isDisabled={isRecommended}
                />
                {isCoinjoinSupportedSymbol(coinjoinAccount.symbol) && (
                    <CoordinatorSetup symbol={coinjoinAccount.symbol} isDisabled={isRecommended} />
                )}
            </SetupSettings>
        </Card>
    );
};
