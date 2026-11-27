import { fromHex, toHex } from './hex';
import { deserializeGroupElement, deserializeScalar } from './serialization';

describe('toHex', () => {
    it('writes uppercase pairs, as the coordinator reads them', () => {
        expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001ABFF');
    });
});

describe('fromHex', () => {
    it('reads hex digits of either case', () => {
        expect(Array.from(fromHex('0001ABFF'))).toEqual([0, 1, 0xab, 0xff]);
        expect(Array.from(fromHex('0001abff'))).toEqual([0, 1, 0xab, 0xff]);
    });

    it('reads nothing from an empty or white-space string', () => {
        expect(fromHex('')).toHaveLength(0);
        expect(fromHex('  ')).toHaveLength(0);
    });

    it('rejects an odd number of characters', () => {
        expect(() => fromHex('ABC')).toThrow('even number of characters');
    });

    // All but the last two are pairs that `Number.parseInt` reads as a byte.
    it.each([' 1', '+1', '-1', '1G', '1.', '\n1', '1_', '-0', '0x', 'G1'])(
        'rejects %j, which upstream does not read as a byte',
        pair => {
            expect(() => fromHex(pair)).toThrow('only hexadecimal digits');
            expect(() => fromHex(`AB${pair}CD`)).toThrow('only hexadecimal digits');
        },
    );

    it('does not repeat the string it rejects', () => {
        expect(() => fromHex('secret-ish!!')).toThrow(
            new Error('Hex string must have only hexadecimal digits.'),
        );
    });
});

describe('deserialization of what the coordinator sends', () => {
    const one = `${'00'.repeat(31)}01`;
    const generator = '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798';

    it('reads a canonical scalar and group element', () => {
        expect(deserializeScalar(one)).toBe(1n);
        expect(deserializeGroupElement(generator).toHex()).toBe(generator);
    });

    it('rejects a scalar and a group element written with other characters', () => {
        expect(() => deserializeScalar(`${' 0'.repeat(31)}+1`)).toThrow('only hexadecimal digits');
        expect(() => deserializeGroupElement(` 2${generator.slice(2)}`)).toThrow(
            'only hexadecimal digits',
        );
    });
});
