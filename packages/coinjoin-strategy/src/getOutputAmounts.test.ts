import { DeterministicRandom } from '@trezor/wabisabi-crypto/src/testing';

import getOutputsAmounts from './__fixtures__/getOutputsAmounts.json';
import { getOutputAmounts } from './getOutputAmounts';

/**
 * Parity against
 * `WalletWasabi.WabiSabiClientLibrary.Tests/IntegrationTests/TestVectors/GetOutputsAmounts.json`
 * and `UnitTests/Controllers/Helpers/GetOutputHelperTests.cs`, both under
 * `DeterministicRandom(0)`.
 */
describe('getOutputAmounts — upstream test vectors', () => {
    getOutputsAmounts.forEach((vector, index) => {
        const name = vector.Name === '' ? `vector ${index}` : vector.Name;

        if (vector.ExpectedStatusCode === 200) {
            it(`${name} produces the expected amounts`, () => {
                expect(getOutputAmounts(vector.Request, new DeterministicRandom(0))).toEqual(
                    (vector.ExpectedResponse as { OutputAmounts: number[] }).OutputAmounts,
                );
            });
        } else {
            it(`${name} fails with the expected message`, () => {
                expect(() => getOutputAmounts(vector.Request, new DeterministicRandom(0))).toThrow(
                    (vector.ExpectedResponse as { Description: string }).Description,
                );
            });
        }
    });

    // Port of `SimpleGetOutputAmountsTest` in GetOutputHelperTests.cs
    it('decomposes a single small input', () => {
        const amounts = getOutputAmounts(
            {
                InternalAmounts: [1000],
                ExternalAmounts: [2000],
                OutputSize: 43,
                InputSize: 58,
                AvailableVsize: 10_000,
                MiningFeeRate: 100,
                AllowedOutputAmounts: { Min: 10, Max: 10_000 },
            },
            new DeterministicRandom(0),
        );

        expect(amounts).toEqual([729, 263]);
    });

    it('rejects anything but taproot sizes', () => {
        const request = {
            InternalAmounts: [1000],
            ExternalAmounts: [2000],
            OutputSize: 43,
            InputSize: 58,
            AvailableVsize: 10_000,
            MiningFeeRate: 100,
            AllowedOutputAmounts: { Min: 10, Max: 10_000 },
        };

        expect(() =>
            getOutputAmounts({ ...request, InputSize: 69 }, new DeterministicRandom(0)),
        ).toThrow('Incorrect input size. Only taproot is supported.');
        expect(() =>
            getOutputAmounts({ ...request, OutputSize: 31 }, new DeterministicRandom(0)),
        ).toThrow('Incorrect output size. Only taproot is supported');
    });
});

describe('getOutputAmounts — what the coordinator reports', () => {
    const request = {
        InternalAmounts: [6500, 6300],
        ExternalAmounts: Array.from({ length: 148 }, (_, i) => 6000 - (i % 7)),
        OutputSize: 43,
        InputSize: 58,
        AvailableVsize: 255,
        MiningFeeRate: 1000,
        AllowedOutputAmounts: { Min: 5000, Max: 134_375_000_000 },
    };

    // The amounts of the other inputs are the coordinator's word. With every bitcoin there is
    // next to inputs this small, a breakdown that lists each use of a denomination runs out of
    // memory, which ends the process rather than the round.
    it('decomposes next to a foreign input far above all the others', () => {
        const amounts = getOutputAmounts(
            { ...request, ExternalAmounts: [2_099_999_997_690_000, ...request.ExternalAmounts] },
            new DeterministicRandom(0),
        );

        expect(amounts).toEqual([5000, 5000]);
    });

    it('rejects a negative mining fee rate, as upstream does when it reads the request', () => {
        expect(() =>
            getOutputAmounts({ ...request, MiningFeeRate: -1 }, new DeterministicRandom(0)),
        ).toThrow('A fee rate cannot be less than 0.');
    });
});
