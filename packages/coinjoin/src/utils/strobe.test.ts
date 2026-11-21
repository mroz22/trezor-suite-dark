import { Strobe128 } from './strobe';
import { STROBE_TEST_VECTORS } from '../__fixtures__/strobe.fixture';

describe('Strobe128', () => {
    // The harness of WalletWasabi Strobe128Tests.TestVectors: the state after each operation.
    it.each(STROBE_TEST_VECTORS)('$name', ({ customString, initialState, operations }) => {
        const strobe = new Strobe128(customString);
        expect(strobe.dumpState()).toEqual(initialState);

        operations.forEach(operation => {
            if (operation.name === 'PRF') {
                const output = strobe.prf(operation.inputLength);
                expect(Buffer.from(output).toString('hex')).toEqual(operation.output);
            } else {
                const data = Buffer.from(operation.inputData, 'hex');
                if (operation.name === 'KEY') {
                    strobe.key(data);
                } else if (operation.meta) {
                    strobe.metaAd(data);
                } else {
                    strobe.ad(data);
                }
            }

            expect(strobe.dumpState()).toEqual(operation.stateAfter);
        });
    });

    it('continues an operation with the same flags only', () => {
        const strobe = new Strobe128('protocol');
        strobe.metaAd(Buffer.from('label'));
        const continued = new Strobe128('protocol');
        continued.metaAd(Buffer.from('lab'));
        continued.metaAd(Buffer.from('el'), true);

        expect(continued.dumpState()).toEqual(strobe.dumpState());
        expect(() => continued.ad(Buffer.from('data'), true)).toThrow(
            'Strobe operation continued with other flags',
        );
    });
});
