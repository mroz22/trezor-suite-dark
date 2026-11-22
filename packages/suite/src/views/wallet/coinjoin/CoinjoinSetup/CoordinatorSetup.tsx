import { FormattedNumber } from 'react-intl';

import {
    type CoinjoinSymbol,
    chooseCoinjoinCoordinatorThunk,
    selectCoinjoinClients,
    selectCoinjoinCoordinatorsBySymbol,
    selectCoinjoinMinInputCountBySymbol,
    selectCoinjoinNetworkConfig,
    selectCoordinatorFeeRateCapBySymbol,
    selectHasCoinjoinSessionBySymbol,
    selectIsCoinjoinCoordinatorOverriddenBySymbol,
} from '@suite/coinjoin';
import { Translation } from '@suite/intl';
import { Banner, Column, H3, InfoItem, type Option, Paragraph, Select } from '@trezor/components';
import { useServices } from '@trezor/dependency-injection';
import { injectDispatch } from '@trezor/redux-utils';

import { useSelector } from '#src/hooks/suite/useSelector';

const LABEL_WIDTH = 200;

// Without the scheme but with the path, which tells apart two coordinators on one host.
const getCoordinatorLabel = (coordinatorUrl: string) => coordinatorUrl.replace(/^https?:\/\//, '');

type CoordinatorSetupProps = {
    symbol: CoinjoinSymbol;
};

export const CoordinatorSetup = ({ symbol }: CoordinatorSetupProps) => {
    const coordinators = useSelector(state => selectCoinjoinCoordinatorsBySymbol(state, symbol));
    const isOverridden = useSelector(state =>
        selectIsCoinjoinCoordinatorOverriddenBySymbol(state, symbol),
    );
    const coordinatorUrl = useSelector(
        state => selectCoinjoinNetworkConfig(state, symbol).coordinatorUrl,
    );
    const coordinatorName = useSelector(
        state => selectCoinjoinNetworkConfig(state, symbol).coordinatorName,
    );
    const coordinatorFeeRateCap = useSelector(state =>
        selectCoordinatorFeeRateCapBySymbol(state, symbol),
    );
    const minInputCount = useSelector(state => selectCoinjoinMinInputCountBySymbol(state, symbol));
    const clientStatus = useSelector(state => selectCoinjoinClients(state)[symbol]?.status);
    const hasSession = useSelector(state => selectHasCoinjoinSessionBySymbol(state, symbol));

    const { dispatch } = useServices(injectDispatch);

    if (!coordinatorUrl) {
        return null;
    }

    const options = coordinators.map(coordinator => ({
        value: coordinator.coordinatorUrl,
        label: getCoordinatorLabel(coordinator.coordinatorUrl),
    }));
    const selectedOption = options.find(option => option.value === coordinatorUrl);
    // A coordinator passed at startup replaces the listed ones until the next start.
    const isChoiceShown = options.length > 1 && !isOverridden;

    const handleChange = ({ value }: Option) =>
        dispatch(chooseCoinjoinCoordinatorThunk(symbol, value));

    return (
        <Column gap={12} alignItems="stretch">
            <H3>
                <Translation id="TR_COINJOIN_COORDINATOR" />
            </H3>
            <Paragraph intent="neutral" priority="secondary" typographyStyle="body-sm">
                <Translation id="TR_COINJOIN_COORDINATOR_DESCRIPTION" />
            </Paragraph>
            {isChoiceShown && (
                <Select
                    options={options}
                    value={selectedOption}
                    onChange={handleChange}
                    isDisabled={hasSession || clientStatus === 'loading'}
                    isClearable={false}
                    isSearchable={false}
                    data-testid="@coinjoin/coordinator-select"
                />
            )}
            {isChoiceShown && hasSession && (
                <Paragraph intent="neutral" priority="secondary" typographyStyle="body-sm">
                    <Translation id="TR_COINJOIN_COORDINATOR_CHANGE_DISABLED" />
                </Paragraph>
            )}
            <InfoItem
                direction="row"
                labelWidth={LABEL_WIDTH}
                label={<Translation id="TR_ADDRESS" />}
            >
                {coordinatorUrl}
            </InfoItem>
            <InfoItem
                direction="row"
                labelWidth={LABEL_WIDTH}
                label={<Translation id="TR_COINJOIN_COORDINATOR_IDENTIFIER" />}
            >
                {coordinatorName}
            </InfoItem>
            <InfoItem
                direction="row"
                labelWidth={LABEL_WIDTH}
                label={<Translation id="TR_COINJOIN_COORDINATOR_FEE_RATE_CAP" />}
            >
                <FormattedNumber
                    value={coordinatorFeeRateCap}
                    style="percent"
                    maximumFractionDigits={3}
                />
            </InfoItem>
            <InfoItem
                direction="row"
                labelWidth={LABEL_WIDTH}
                label={<Translation id="TR_COINJOIN_COORDINATOR_MIN_INPUT_COUNT" />}
            >
                {minInputCount}
            </InfoItem>
            {clientStatus === 'unavailable' && (
                <Banner
                    intent="warning"
                    description={<Translation id="TR_UNAVAILABLE_COINJOIN_COORDINATOR" />}
                />
            )}
        </Column>
    );
};
