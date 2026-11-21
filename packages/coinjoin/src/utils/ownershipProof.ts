import { bip32, script as bscript, bufferutils, crypto, verifySchnorr } from '@trezor/utxo-lib';

// SLIP-19 proof of ownership: https://github.com/satoshilabs/slips/blob/master/slip-0019.md
const VERSION_MAGIC = Buffer.from('534c0019', 'hex');
const FLAG_USER_CONFIRMED = 0x01;
const OWNERSHIP_ID_LENGTH = 32;
const SIGHASH_DEFAULT = 0x00;
const SIGHASH_ALL = 0x01;
// The hash type is not signed. The device accepts these in a proof (trezor-firmware
// core/src/apps/bitcoin/common.py, SigHashType) and does not check it further.
const DEVICE_HASH_TYPES = [SIGHASH_DEFAULT, SIGHASH_ALL, 0x40, 0x41];
const CURVE_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/i;
// utxo-lib verifies ECDSA signatures only through a BIP32 node, which needs some chain code.
const UNUSED_CHAIN_CODE = Buffer.alloc(32);

// The proof body is signed, the BIP-322 scriptSig and witness carry the signature.
const readOwnershipProof = (proof: Buffer) => {
    const reader = new bufferutils.BufferReader(proof);
    if (!reader.readSlice(VERSION_MAGIC.length).equals(VERSION_MAGIC)) return;

    const flags = reader.readUInt8();
    reader.readSlice(reader.readVarInt() * OWNERSHIP_ID_LENGTH);
    const body = proof.subarray(0, reader.offset);
    const scriptSig = reader.readVarSlice();
    const witness = reader.readVector();
    if (reader.offset !== proof.length) return;

    return { body, flags, scriptSig, witness };
};

// SHA256 of the proof body, the scriptPubKey and the commitment data, the last two prefixed with
// their compact size.
const getProofSighash = (body: Buffer, scriptPubKey: Buffer, commitmentData: Buffer) => {
    const data = Buffer.allocUnsafe(
        body.length +
            bufferutils.varIntSize(scriptPubKey.length) +
            scriptPubKey.length +
            bufferutils.varIntSize(commitmentData.length) +
            commitmentData.length,
    );
    const writer = new bufferutils.BufferWriter(data);
    writer.writeSlice(body);
    writer.writeVarSlice(scriptPubKey);
    writer.writeVarSlice(commitmentData);

    return crypto.sha256(data);
};

// OP_0 <20-byte public key hash>
const isP2WPKH = (scriptPubKey: Buffer) =>
    scriptPubKey.length === 22 && scriptPubKey[0] === 0x00 && scriptPubKey[1] === 0x14;

// OP_1 <32-byte output key>
const isP2TR = (scriptPubKey: Buffer) =>
    scriptPubKey.length === 34 && scriptPubKey[0] === 0x51 && scriptPubKey[1] === 0x20;

// utxo-lib verifies only a low S. Anyone can negate S without the key, and the device normalizes
// it before it verifies (trezor-firmware crypto/zkp_ecdsa.c, zkp_ecdsa_verify_digest).
const normalizeSignature = (compactSignature: Buffer) => {
    const sValue = BigInt(`0x${compactSignature.subarray(32).toString('hex')}`);
    if (sValue <= CURVE_ORDER / 2n || sValue >= CURVE_ORDER) return compactSignature;

    const lowSValue = (CURVE_ORDER - sValue).toString(16).padStart(64, '0');

    return Buffer.concat([compactSignature.subarray(0, 32), Buffer.from(lowSValue, 'hex')]);
};

// Returns the hash type of a valid signature.
const verifyP2WPKHSignature = (
    sighash: Buffer,
    scriptPubKey: Buffer,
    witness: Buffer[],
): number | undefined => {
    const [signature, publicKey] = witness;
    if (witness.length !== 2 || !signature || !publicKey) return;
    if (!crypto.hash160(publicKey).equals(scriptPubKey.subarray(2))) return;

    // script.signature.decode accepts only the hash types of BIP62, decode the DER signature with
    // SIGHASH_ALL in place of its hash type.
    const { signature: compactSignature } = bscript.signature.decode(
        Buffer.concat([signature.subarray(0, -1), Buffer.of(SIGHASH_ALL)]),
    );
    const node = bip32.fromPublicKey(publicKey, UNUSED_CHAIN_CODE);
    if (!node.verify(sighash, normalizeSignature(compactSignature))) return;

    return signature[signature.length - 1];
};

// Returns the hash type of a valid signature.
const verifyP2TRSignature = (
    sighash: Buffer,
    scriptPubKey: Buffer,
    witness: Buffer[],
): number | undefined => {
    const [signature] = witness;
    if (witness.length !== 1 || !signature) return;
    if (signature.length !== 64 && signature.length !== 65) return;
    if (!verifySchnorr(sighash, scriptPubKey.subarray(2), signature.subarray(0, 64))) return;

    // A 64-byte signature has no hash type byte.
    return signature[64] ?? SIGHASH_DEFAULT;
};

/**
 * - valid: the device accepts the proof when it signs.
 * - unsupported: the owner of the scriptPubKey signed the proof for the commitment data, but with
 *   unknown flags or a hash type which the device refuses. WalletWasabi reads the flags without
 *   checking them and verifies the signature without its hash type
 *   (WalletWasabi/Crypto/ProofBody.cs, Bip322Signature.cs).
 * - invalid: anything else.
 */
export type OwnershipProofVerification = 'valid' | 'unsupported' | 'invalid';

type VerifyOwnershipProofParams = {
    ownershipProof: string;
    scriptPubKey: string;
    commitmentData: string;
};

/**
 * Verifies a SLIP-19 proof of ownership of a P2WPKH or Taproot scriptPubKey, all in hex, as the
 * device verifies proofs of external inputs before it signs (trezor-firmware
 * core/src/apps/bitcoin/ownership.py, verify_nonownership). Proofs of other script types are
 * invalid.
 */
export const verifyOwnershipProof = ({
    ownershipProof,
    scriptPubKey,
    commitmentData,
}: VerifyOwnershipProofParams): OwnershipProofVerification => {
    // Buffer.from would drop everything from the first character which is not hex.
    if (!HEX_PATTERN.test(ownershipProof)) return 'invalid';

    const scriptPubKeyBuffer = Buffer.from(scriptPubKey, 'hex');
    try {
        const proof = readOwnershipProof(Buffer.from(ownershipProof, 'hex'));
        // Witness programs are spent with an empty scriptSig.
        if (!proof || proof.scriptSig.length > 0) return 'invalid';

        const sighash = getProofSighash(
            proof.body,
            scriptPubKeyBuffer,
            Buffer.from(commitmentData, 'hex'),
        );
        let hashType: number | undefined;
        if (isP2WPKH(scriptPubKeyBuffer)) {
            hashType = verifyP2WPKHSignature(sighash, scriptPubKeyBuffer, proof.witness);
        } else if (isP2TR(scriptPubKeyBuffer)) {
            hashType = verifyP2TRSignature(sighash, scriptPubKeyBuffer, proof.witness);
        }
        if (hashType === undefined) return 'invalid';

        // Like the device, refuse unknown flags but do not require the user confirmation.
        const hasUnknownFlags = (proof.flags & ~FLAG_USER_CONFIRMED) !== 0;

        return hasUnknownFlags || !DEVICE_HASH_TYPES.includes(hashType) ? 'unsupported' : 'valid';
    } catch {
        // Truncated proof, malformed signature or public key.
        return 'invalid';
    }
};
