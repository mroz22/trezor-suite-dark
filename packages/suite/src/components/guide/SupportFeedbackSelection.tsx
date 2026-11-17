import { UpdateState, selectDesktopUpdate } from '@suite/desktop-update';
import { Translation, type TranslationKey } from '@suite/intl';
import { selectSelectedDevice } from '@suite-common/device';
import { isDevEnv } from '@suite-common/suite-utils';
import { Box, CardList, Column, Icon, IconCircle, Row, Text } from '@trezor/components';
import { useServices } from '@trezor/dependency-injection';
import { getFirmwareVersion } from '@trezor/device-utils';
import { isDesktop } from '@trezor/env-utils';
import { ArrowLineUpRightIcon, ChatsIcon, LifebuoyIcon } from '@trezor/icons';
import { injectDispatch } from '@trezor/redux-utils';
import { TREZOR_FORUM_URL } from '@trezor/urls';

import { setView } from '#src/actions/suite/guideActions';
import { SupportConsentPopover } from '#src/components/guide/SupportConsentPopover';
import { useSelector } from '#src/hooks/suite/useSelector';

import { GuideContent } from './GuideContent';
import { GuideHeader } from './GuideHeader';
import { GuideSectionHeadline } from './GuideSectionHeadline';
import { GuideViewWrapper } from './GuideViewWrapper';

type StatusTextProps = { id: TranslationKey };

const StatusText = ({ id }: StatusTextProps) => (
    <Text typographyStyle="body-sm" intent="neutral" priority="secondary" as="div">
        <Translation id={id} />
    </Text>
);

export const SupportFeedbackSelection = () => {
    const { dispatch } = useServices(injectDispatch);
    const desktopUpdate = useSelector(selectDesktopUpdate);
    const device = useSelector(selectSelectedDevice);

    const appUpToDate =
        isDesktop() &&
        [UpdateState.Checking, UpdateState.NotAvailable].includes(desktopUpdate.state);
    const appUpdateAvailable =
        isDesktop() &&
        [UpdateState.Available, UpdateState.Downloading, UpdateState.Ready].includes(
            desktopUpdate.state,
        );
    const appVersion = `${process.env.VERSION}${isDevEnv ? '-dev' : ''}`;

    const isDeviceConnected = !!device?.features;
    const firmwareUpToDate = device?.firmware === 'valid';
    const getFirmwareVersionLabel = () => {
        if (!device?.features) {
            return '-/-';
        }

        const version = getFirmwareVersion(device);

        if (!version) {
            return <Translation id="TR_DEVICE_FW_UNKNOWN" />;
        }

        return <Translation id="TR_YOUR_CURRENT_VERSION" values={{ version }} />;
    };

    const getAppStatusId = (): TranslationKey | null => {
        if (appUpToDate) {
            return 'TR_UP_TO_DATE';
        }

        if (appUpdateAvailable) {
            return 'TR_UPDATE_AVAILABLE';
        }

        return null;
    };

    const getFirmwareStatusId = (): TranslationKey | null => {
        if (firmwareUpToDate) {
            return 'TR_UP_TO_DATE';
        }

        if (!isDeviceConnected) {
            return 'TR_GUIDE_SUPPORT_DEVICE_DISCONNECTED';
        }

        return null;
    };

    const appStatusId = getAppStatusId();
    const firmwareStatusId = getFirmwareStatusId();

    const goBack = () => dispatch(setView('GUIDE_DEFAULT'));

    return (
        <GuideViewWrapper>
            <GuideHeader
                back={goBack}
                label={<Translation id="TR_GUIDE_VIEW_HEADLINES_SUPPORT_FEEDBACK_SELECTION" />}
            />
            <GuideContent>
                <Column justifyContent="space-between" height="100%">
                    <Box flex="1">
                        <Box>
                            <GuideSectionHeadline id="TR_GUIDE_VIEW_HEADLINE_NEED_HELP" />
                            <CardList>
                                <SupportConsentPopover>
                                    <CardList.Item
                                        paddingType="medium"
                                        onClick={() => {}}
                                        data-testid="@guide/support"
                                        width="100%"
                                    >
                                        <Row gap={16} flex="1" overflow="hidden">
                                            <IconCircle
                                                icon={LifebuoyIcon}
                                                size={32}
                                                intent="neutral"
                                            />
                                            <Text
                                                typographyStyle="body-md"
                                                as="div"
                                                maxWidth="100%"
                                            >
                                                <Translation id="TR_GUIDE_SUPPORT" />
                                            </Text>
                                        </Row>
                                        <Icon
                                            as={ArrowLineUpRightIcon}
                                            size={20}
                                            intent="neutral"
                                            priority="secondary"
                                        />
                                    </CardList.Item>
                                </SupportConsentPopover>

                                <CardList.Item
                                    paddingType="medium"
                                    onClick={() => window.open(TREZOR_FORUM_URL, '_blank')}
                                    data-testid="@guide/forum"
                                >
                                    <Row gap={16} flex="1" overflow="hidden">
                                        <IconCircle icon={ChatsIcon} size={32} intent="neutral" />
                                        <Text typographyStyle="body-md" as="div" maxWidth="100%">
                                            <Translation id="TR_GUIDE_FORUM" />
                                        </Text>
                                    </Row>
                                    <Icon
                                        as={ArrowLineUpRightIcon}
                                        size={20}
                                        intent="neutral"
                                        priority="secondary"
                                    />
                                </CardList.Item>
                            </CardList>
                        </Box>
                    </Box>
                    <CardList margin={{ bottom: 16 }}>
                        <CardList.Item data-testid="@guide/support/version" paddingType="medium">
                            <Row justifyContent="space-between" width="100%" alignItems="flex-end">
                                <Column alignItems="flex-start" overflow="hidden">
                                    <Text typographyStyle="body-md" as="div" maxWidth="100%">
                                        <Translation id="TR_APPLICATION" />
                                    </Text>
                                    <Text
                                        typographyStyle="body-sm"
                                        intent="neutral"
                                        priority="secondary"
                                        as="div"
                                        maxWidth="100%"
                                        data-testid="@guide/support/app-version"
                                    >
                                        <Translation
                                            id="TR_YOUR_CURRENT_VERSION"
                                            values={{ version: appVersion }}
                                        />
                                    </Text>
                                </Column>
                                {!!appStatusId && <StatusText id={appStatusId} />}
                            </Row>
                        </CardList.Item>
                        <CardList.Item data-testid="@guide/support/firmware" paddingType="medium">
                            <Row justifyContent="space-between" width="100%" alignItems="flex-end">
                                <Column alignItems="flex-start" overflow="hidden">
                                    <Text typographyStyle="body-md" as="div" maxWidth="100%">
                                        <Translation id="TR_FIRMWARE" />
                                    </Text>
                                    <Text
                                        typographyStyle="body-sm"
                                        intent="neutral"
                                        priority="secondary"
                                        as="div"
                                        maxWidth="100%"
                                        data-testid="@guide/support/firmware-version"
                                    >
                                        {getFirmwareVersionLabel()}
                                    </Text>
                                </Column>
                                {!!firmwareStatusId && <StatusText id={firmwareStatusId} />}
                            </Row>
                        </CardList.Item>
                    </CardList>
                </Column>
            </GuideContent>
        </GuideViewWrapper>
    );
};
