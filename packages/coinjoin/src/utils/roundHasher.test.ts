import { getInputRegistrationEnd, getRoundId, isRoundIdMatching } from './roundHasher';
import { getRoundParameters } from './roundUtils';
import { EndRoundState, RoundPhase } from '../enums';
import type { CoinjoinRoundParameters, Round } from '../types/coordinator';

// Round in the status of a BTCPay Server coordinator, from the test
// BtcPayServerCoordinatorCompatibility of WalletWasabi (MIT,
// WalletWasabi.Tests/UnitTests/WabiSabi/SerializationTests.cs).
const BTCPAY_ROUND_JSON =
    '{"Id":"c9fe80f588809feabf11043bf3e5952e9a6e861b68f3ca451b34507243545bd4","BlameOf":"0000000000000000000000000000000000000000000000000000000000000000","AmountCredentialIssuerParameters":{"Cw":"0354CB0724F653CC56C94C13ED949DE33378D3B88086E39932D42E27535B063AE6","I":"036018B97A215A680837671734CDC4CD8355AA56C45CA48E71CE7A6B51ACC856D6"},"VsizeCredentialIssuerParameters":{"Cw":"0332E8D9DD6116F49991044A97EF59E9AB081628B1E03ABA9BA3C71FCAF8354D40","I":"0358F51C185A8931BC5DAA1C85B5D63F0FD0C0481EE2EED8E92D4F4585A3F8307B"},"Phase":0,"EndRoundState":0,"InputRegistrationStart":"2025-04-22T14:10:12.970806+00:00","InputRegistrationTimeout":"0d 1h 0m 0s","CoinjoinState":{"Type":"ConstructionState","Events":[{"Type":"RoundCreated","RoundParameters":{"Network":"Main","MiningFeeRate":2000,"CoordinationFeeRate":{"Rate":0.0,"PlebsDontPayThreshold":0},"MaxSuggestedAmount":4300000000000,"MinInputCountByRound":21,"MaxInputCountByRound":210,"AllowedInputAmounts":{"Min":5000,"Max":4300000000000},"AllowedOutputAmounts":{"Min":5000,"Max":4300000000000},"AllowedInputTypes":[4,7],"AllowedOutputTypes":[0,1,2,3,4,5,6,7],"StandardInputRegistrationTimeout":"0d 1h 0m 0s","ConnectionConfirmationTimeout":"0d 0h 1m 0s","OutputRegistrationTimeout":"0d 0h 2m 10s","TransactionSigningTimeout":"0d 0h 2m 10s","BlameInputRegistrationTimeout":"0d 0h 3m 30s","MinAmountCredentialValue":5000,"MaxAmountCredentialValue":4300000000000,"InitialInputVsizeAllocation":99985,"MaxVsizeCredentialValue":255,"MaxVsizeAllocationPerAlice":255,"CoordinationIdentifier":"CoinJoinCoordinatorIdentifier","DelayTransactionSigning":false,"MaxTransactionSize":100000,"MinRelayTxFee":1000}}]},"InputRegistrationEnd":"2025-04-22T15:10:12.970806+00:00","IsBlame":false}';
const BTCPAY_ROUND_ID = 'c9fe80f588809feabf11043bf3e5952e9a6e861b68f3ca451b34507243545bd4';
const COORDINATOR_NAME = 'CoinJoinCoordinatorIdentifier';

type RoundChange = (round: Round, parameters: CoinjoinRoundParameters) => void;

const getBtcPayRound = (change?: RoundChange): Round => {
    const round: Round = JSON.parse(BTCPAY_ROUND_JSON);
    const parameters = getRoundParameters(round);
    if (!parameters) throw new Error('Missing round parameters');
    change?.(round, parameters);

    return round;
};

// Another valid point.
const OTHER_GROUP_ELEMENT = '0358F51C185A8931BC5DAA1C85B5D63F0FD0C0481EE2EED8E92D4F4585A3F8307B';

describe('roundHasher', () => {
    it('computes the id of a round of a WalletWasabi coordinator', () => {
        const round = getBtcPayRound();

        expect(getRoundId(round)).toEqual(BTCPAY_ROUND_ID);
        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(true);
    });

    it.each<[string, RoundChange]>([
        [
            'InputRegistrationStart',
            round => {
                round.InputRegistrationStart = '2025-04-22T14:10:12.971+00:00';
            },
        ],
        [
            'InputRegistrationTimeout',
            round => {
                round.InputRegistrationTimeout = '0d 1h 0m 1s';
            },
        ],
        [
            'ConnectionConfirmationTimeout',
            (_, parameters) => {
                parameters.ConnectionConfirmationTimeout = '0d 0h 1m 1s';
            },
        ],
        [
            'OutputRegistrationTimeout',
            (_, parameters) => {
                parameters.OutputRegistrationTimeout = '0d 0h 2m 11s';
            },
        ],
        [
            'TransactionSigningTimeout',
            (_, parameters) => {
                parameters.TransactionSigningTimeout = '0d 0h 3m 0s';
            },
        ],
        [
            'AllowedInputAmounts.Min',
            (_, parameters) => {
                parameters.AllowedInputAmounts.Min = 5001;
            },
        ],
        [
            'AllowedInputAmounts.Max',
            (_, parameters) => {
                parameters.AllowedInputAmounts.Max = 4299999999999;
            },
        ],
        [
            'AllowedInputTypes',
            (_, parameters) => {
                parameters.AllowedInputTypes = [7];
            },
        ],
        [
            'AllowedOutputAmounts.Min',
            (_, parameters) => {
                parameters.AllowedOutputAmounts.Min = 5001;
            },
        ],
        [
            'AllowedOutputAmounts.Max',
            (_, parameters) => {
                parameters.AllowedOutputAmounts.Max = 4299999999999;
            },
        ],
        [
            'AllowedOutputTypes',
            (_, parameters) => {
                parameters.AllowedOutputTypes = [4, 7];
            },
        ],
        [
            'Network',
            (_, parameters) => {
                parameters.Network = 'TestNet';
            },
        ],
        [
            'MiningFeeRate',
            (_, parameters) => {
                parameters.MiningFeeRate = 2001;
            },
        ],
        [
            'CoordinationFeeRate.Rate',
            (_, parameters) => {
                parameters.CoordinationFeeRate.Rate = 0.00000001;
            },
        ],
        [
            'CoordinationFeeRate.PlebsDontPayThreshold',
            (_, parameters) => {
                parameters.CoordinationFeeRate.PlebsDontPayThreshold = 1;
            },
        ],
        [
            'MaxTransactionSize',
            (_, parameters) => {
                parameters.MaxTransactionSize = 100001;
            },
        ],
        [
            'MinRelayTxFee',
            (_, parameters) => {
                parameters.MinRelayTxFee = 1001;
            },
        ],
        [
            'MaxAmountCredentialValue',
            (_, parameters) => {
                parameters.MaxAmountCredentialValue = 4299999999999;
            },
        ],
        [
            'MaxVsizeCredentialValue',
            (_, parameters) => {
                parameters.MaxVsizeCredentialValue = 254;
            },
        ],
        [
            'MaxVsizeAllocationPerAlice',
            (_, parameters) => {
                parameters.MaxVsizeAllocationPerAlice = 254;
            },
        ],
        [
            'MaxSuggestedAmount',
            (_, parameters) => {
                parameters.MaxSuggestedAmount = 4299999999999;
            },
        ],
        [
            'CoordinationIdentifier',
            (_, parameters) => {
                parameters.CoordinationIdentifier = 'OtherCoordinatorIdentifier';
            },
        ],
        [
            'AmountCredentialIssuerParameters.Cw',
            round => {
                round.AmountCredentialIssuerParameters.Cw = OTHER_GROUP_ELEMENT;
            },
        ],
        [
            'AmountCredentialIssuerParameters.I',
            round => {
                round.AmountCredentialIssuerParameters.I = OTHER_GROUP_ELEMENT;
            },
        ],
        [
            'VsizeCredentialIssuerParameters.Cw',
            round => {
                round.VsizeCredentialIssuerParameters.Cw = OTHER_GROUP_ELEMENT;
            },
        ],
        [
            'VsizeCredentialIssuerParameters.I',
            round => {
                round.VsizeCredentialIssuerParameters.I = `02${OTHER_GROUP_ELEMENT.slice(2)}`;
            },
        ],
    ])('hashes %s', (_, change) => {
        const round = getBtcPayRound(change);

        expect(getRoundId(round)).not.toEqual(BTCPAY_ROUND_ID);
        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(false);
    });

    it.each<[string, RoundChange]>([
        [
            'other fields of the status',
            round => {
                round.BlameOf = '1'.repeat(64);
                round.Phase = RoundPhase.ConnectionConfirmation;
                round.EndRoundState = EndRoundState.NotAllAlicesSign;
                round.InputRegistrationEnd = '2025-04-22T15:20:00+00:00';
                round.CoinjoinState.Events.push({
                    Type: 'OutputAdded',
                    Output: {
                        ScriptPubKey: '0 76215d74689b52e41c1636e46df04bde793be57a',
                        Value: 5000,
                    },
                });
            },
        ],
        [
            'other round parameters',
            (_, parameters) => {
                parameters.MinInputCountByRound = 2;
                parameters.MaxInputCountByRound = 400;
                parameters.StandardInputRegistrationTimeout = '0d 2h 0m 0s';
                parameters.BlameInputRegistrationTimeout = '0d 0h 1m 0s';
                parameters.MinAmountCredentialValue = 1;
                parameters.DelayTransactionSigning = true;
            },
        ],
        [
            'digits of InputRegistrationStart below milliseconds',
            round => {
                round.InputRegistrationStart = '2025-04-22T11:10:12.9709999-03:00';
            },
        ],
        [
            'MaxVsizeCredentialValue left out, as WalletWasabi 2.8.0 and newer do',
            (_, parameters) => {
                delete parameters.MaxVsizeCredentialValue;
            },
        ],
        [
            'script types sent by name',
            (_, parameters) => {
                parameters.AllowedInputTypes = ['P2WPKH', 'Taproot'];
            },
        ],
    ])('does not change with %s', (_, change) => {
        const round = getBtcPayRound(change);

        expect(getRoundId(round)).toEqual(BTCPAY_ROUND_ID);
        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(true);
    });

    it('accepts coordination fee rates with 8 decimal places', () => {
        // 0.0003 * 1e8 is 29999.999999999996.
        const ids = [0.0003, 0.00030001, 0.003].map(rate =>
            getRoundId(
                getBtcPayRound((_, parameters) => {
                    parameters.CoordinationFeeRate.Rate = rate;
                }),
            ),
        );

        expect(new Set(ids).size).toBe(3);
    });

    it.each<[string, RoundChange]>([
        [
            'a TimeSpan with fractions',
            round => {
                round.InputRegistrationTimeout = '0d 1h 0m 0.5s';
            },
        ],
        [
            'a TimeSpan out of range',
            (_, parameters) => {
                parameters.ConnectionConfirmationTimeout = '0d 0h 0m 60s';
            },
        ],
        [
            'a TimeSpan with leading zeros',
            (_, parameters) => {
                parameters.OutputRegistrationTimeout = '0d 0h 02m 10s';
            },
        ],
        [
            'a TimeSpan in another format',
            (_, parameters) => {
                parameters.TransactionSigningTimeout = '00:02:10';
            },
        ],
        [
            'a date without offset',
            round => {
                round.InputRegistrationStart = '2025-04-22T14:10:12.970806';
            },
        ],
        [
            'a date in another format',
            round => {
                round.InputRegistrationStart = 'Tue, 22 Apr 2025 14:10:12 GMT';
            },
        ],
        [
            'a rate with more than 8 decimal places',
            (_, parameters) => {
                parameters.CoordinationFeeRate.Rate = 0.000000001;
            },
        ],
        [
            'a negative rate',
            (_, parameters) => {
                parameters.CoordinationFeeRate.Rate = -0.001;
            },
        ],
        [
            'an amount above the safe integers',
            (_, parameters) => {
                parameters.MaxAmountCredentialValue = 2 ** 53;
            },
        ],
        [
            'a fractional amount',
            (_, parameters) => {
                parameters.AllowedInputAmounts.Min = 5000.5;
            },
        ],
        [
            'an amount as a string',
            (_, parameters) => {
                // @ts-expect-error: data the coordinator does not send
                parameters.MiningFeeRate = '2000';
            },
        ],
        [
            'a transaction size above int32',
            (_, parameters) => {
                parameters.MaxTransactionSize = 2 ** 31;
            },
        ],
        [
            'unsorted script types',
            (_, parameters) => {
                parameters.AllowedInputTypes = [7, 4];
            },
        ],
        [
            'duplicate script types',
            (_, parameters) => {
                parameters.AllowedInputTypes = [4, 4, 7];
            },
        ],
        [
            'an unknown script type',
            (_, parameters) => {
                parameters.AllowedOutputTypes = [0, 1, 2, 3, 4, 5, 6, 7, 8];
            },
        ],
        [
            'an unknown script type name',
            (_, parameters) => {
                // @ts-expect-error: data the coordinator does not send
                parameters.AllowedInputTypes = ['P2WPKH', 'P2TR'];
            },
        ],
        [
            'an uncompressed point',
            round => {
                round.AmountCredentialIssuerParameters.Cw = `04${'AB'.repeat(64)}`;
            },
        ],
        [
            'a point which is not hex',
            round => {
                round.VsizeCredentialIssuerParameters.I = `03${'ZZ'.repeat(32)}`;
            },
        ],
        [
            'the point at infinity',
            round => {
                round.VsizeCredentialIssuerParameters.Cw = '00'.repeat(33);
            },
        ],
        [
            'no RoundCreated event',
            round => {
                round.CoinjoinState.Events = [];
            },
        ],
    ])('refuses %s', (_, change) => {
        const round = getBtcPayRound(change);

        expect(() => getRoundId(round)).toThrow();
        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(false);
    });

    it('refuses a blame round of a coordinator older than WalletWasabi 2.3.0', () => {
        // Such a coordinator computed the id with the standard input registration timeout and
        // only then set the timeout of the blame round (WalletWasabi commit 7c4ce04ee fixed it).
        const round = getBtcPayRound((statusRound, parameters) => {
            statusRound.BlameOf = '1'.repeat(64);
            statusRound.InputRegistrationTimeout = parameters.StandardInputRegistrationTimeout;
            statusRound.Id = getRoundId(statusRound);
            statusRound.InputRegistrationTimeout = parameters.BlameInputRegistrationTimeout;
        });

        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(false);
    });

    it('refuses an id which is not lowercase', () => {
        const round = getBtcPayRound(statusRound => {
            statusRound.Id = BTCPAY_ROUND_ID.toUpperCase();
        });

        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(false);
    });

    it('refuses a round of another coordinator', () => {
        const coordinatorName = 'OtherCoordinatorIdentifier';
        const round = getBtcPayRound((statusRound, parameters) => {
            parameters.CoordinationIdentifier = coordinatorName;
            statusRound.Id = getRoundId(statusRound);
        });

        expect(isRoundIdMatching(round, coordinatorName)).toBe(true);
        expect(isRoundIdMatching(round, COORDINATOR_NAME)).toBe(false);
    });

    it('getInputRegistrationEnd', () => {
        const round = getBtcPayRound();

        expect(getInputRegistrationEnd(round)).toEqual(Date.parse(round.InputRegistrationEnd));
        expect(() =>
            getInputRegistrationEnd({ ...round, InputRegistrationTimeout: '1h 0m 0s' }),
        ).toThrow();
    });
});
