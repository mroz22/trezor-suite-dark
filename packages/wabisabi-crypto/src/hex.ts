/**
 * Port of `NWabiSabi/WabiSabi/Helpers/ByteHelpers.cs`.
 *
 * `Convert.ToHexString` emits UPPERCASE hex, and the coordinator sees these strings
 * verbatim in the credential request JSON. Lowercase hex is a rejected registration,
 * so the case is part of the wire format, not a formatting preference.
 */
export const toHex = (bytes: Uint8Array) => {
    let hex = '';
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0').toUpperCase();
    }

    return hex;
};

const HEX_DIGITS = /^[0-9a-fA-F]*$/;

/**
 * `ByteHelpers.FromHex`: nothing for an empty or white-space string, otherwise
 * `Convert.FromHexString`, which takes hex digits of either case and nothing else.
 */
export const fromHex = (hex: string) => {
    if (hex.trim().length === 0) {
        return new Uint8Array(0);
    }
    if (hex.length % 2 !== 0) {
        throw new Error('Hex string must have an even number of characters.');
    }
    // `Number.parseInt` alone takes a sign, leading white space and any valid prefix of a
    // pair, so a coordinator could tell this client from upstream's by a response only
    // this one accepts. The string is the coordinator's, so the error does not repeat it.
    if (!HEX_DIGITS.test(hex)) {
        throw new Error('Hex string must have only hexadecimal digits.');
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }

    return bytes;
};
