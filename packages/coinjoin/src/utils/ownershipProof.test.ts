import { bip32, script as bscript, crypto } from '@trezor/utxo-lib';

import { type OwnershipProofVerification, verifyOwnershipProof } from './ownershipProof';
import { getCommitmentData } from './roundUtils';

// Proofs of trezor-firmware tests/device_tests/bitcoin/test_getownershipproof.py, made with the
// public test seed "all all all all all all all all all all all all".

// m/84h/0h/0h/1/0
const P2WPKH_SCRIPT_PUBKEY = '0014b2f771c370ccf219cd3059cda92bdf7f00cf2103';
// test_confirm_ownership_proof_with_data: body (magic, user confirmation flag, one ownership id),
// empty scriptSig and a witness with a DER signature, its hash type and the public key.
const P2WPKH_PROOF_BODY =
    '534c00190101a122407efc198211c81af4450f40b235d54775efd934d16b9e31c6ce9bad5707';
const P2WPKH_SIGNATURE =
    '3045022100b41c51d130d1e4e179679734b7fcb39abe8859727de10a782fac3f9bae82c31802205b0697eb1c101a1f5a3b103b7b6c34568adface1dbbb3512b783c66bb52f0c92';
const P2WPKH_PUBLIC_KEY = '032ef68318c8f6aaa0adec0199c69901f0db7d3485eb38d9ad235221dc3d61154b';
const P2WPKH_PROOF = `${P2WPKH_PROOF_BODY}000248${P2WPKH_SIGNATURE}0121${P2WPKH_PUBLIC_KEY}`;
const P2WPKH_COMMITMENT_DATA = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

// m/86h/0h/0h/1/0
const P2TR_SCRIPT_PUBKEY = '51204102897557de0cafea0a8401ea5b59668eccb753e4b100aebe6a19609f3cc79f';
// test_p2tr_ownership_proof: body without flags, empty scriptSig and a 64-byte signature.
const P2TR_PROOF_BODY =
    '534c00190001dc18066224b9e30e306303436dc18ab881c7266c13790350a3fe415e438135ec';
const P2TR_SIGNATURE =
    '647d6af883107a870417e808abe424882bd28ee04a28ba85a7e99400e1b9485075733695964c2a0fa02d4439ab80830e9566ccbd10f2597f5513eff9f03a0497';
const P2TR_PROOF = `${P2TR_PROOF_BODY}000140${P2TR_SIGNATURE}`;

// Taproot coinjoin input in trezor-firmware tests/device_tests/bitcoin/test_authorize_coinjoin.py
// (test_sign_tx), proved for round 1 of the coordinator www.example.com.
const COINJOIN_SCRIPT_PUBKEY =
    '5120b3a2750e21facec36b2a56d76cca6019bf517a5c45e2ea8e5b4ed191090f3003';
const COINJOIN_PROOF =
    '534c001901019cf1b0ad730100bd7a69e987d55348bb798e2b2096a6a5713e9517655bd2021300014052d479f48d34f1ca6872d4571413660040c3e98841ab23a2c5c1f37399b71bfa6f56364b79717ee90552076a872da68129694e1b4fb0e0651373dcf56db123c5';
const getRoundId = (round: number) => round.toString(16).padStart(64, '0');
const ROUND_1_COMMITMENT_DATA = getCommitmentData('www.example.com', getRoundId(1));

// A key of this test only, to sign proofs which the vectors do not cover.
const TEST_NODE = bip32.fromSeed(Buffer.alloc(32, 1));
const TEST_SCRIPT_PUBKEY = `0014${crypto.hash160(TEST_NODE.publicKey).toString('hex')}`;
const CURVE_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

// The same signature with S negated, which utxo-lib does not accept.
const getHighSSignature = (signature: Buffer) => {
    const sValue = BigInt(`0x${signature.subarray(32).toString('hex')}`);
    const highSValue = (CURVE_ORDER - sValue).toString(16).padStart(64, '0');

    return Buffer.concat([signature.subarray(0, 32), Buffer.from(highSValue, 'hex')]);
};

type CreateTestProofParams = {
    flags?: string;
    scriptPubKey?: string;
    hashType?: string;
    hasHighS?: boolean;
};

// P2WPKH proof without ownership ids and commitment data, signed by TEST_NODE. The sighash covers
// the 22-byte scriptPubKey and the empty commitment data, the proof has an empty scriptSig and two
// witness items.
const createTestProof = ({
    flags = '01',
    scriptPubKey = TEST_SCRIPT_PUBKEY,
    hashType = '01',
    hasHighS = false,
}: CreateTestProofParams) => {
    const body = `534c0019${flags}00`;
    const sighash = crypto.sha256(Buffer.from(`${body}16${scriptPubKey}00`, 'hex'));
    const lowSSignature = TEST_NODE.sign(sighash);
    const compactSignature = hasHighS ? getHighSSignature(lowSSignature) : lowSSignature;
    // script.signature.encode accepts only the hash types of BIP62, replace it.
    const derSignature = bscript.signature.encode(compactSignature, 0x01).subarray(0, -1);
    const signature = `${derSignature.toString('hex')}${hashType}`;
    const publicKey = TEST_NODE.publicKey.toString('hex');

    return `${body}0002${(signature.length / 2).toString(16)}${signature}21${publicKey}`;
};

describe('verifyOwnershipProof', () => {
    it.each([
        [
            'P2WPKH (test_p2wpkh_ownership_proof)',
            '534c00190001a122407efc198211c81af4450f40b235d54775efd934d16b9e31c6ce9bad57070002483045022100c0dc28bb563fc5fea76cacff75dba9cb4122412faae01937cdebccfb065f9a7002202e980bfbd8a434a7fc4cd2ca49da476ce98ca097437f8159b1a386b41fcdfac50121032ef68318c8f6aaa0adec0199c69901f0db7d3485eb38d9ad235221dc3d61154b',
            P2WPKH_SCRIPT_PUBKEY,
            '',
        ],
        [
            'P2WPKH with user confirmation (test_confirm_ownership_proof)',
            '534c00190101a122407efc198211c81af4450f40b235d54775efd934d16b9e31c6ce9bad5707000247304402201c8d141bcb99660d5de876e51d929abd2954a2eb79adde83d25cc5e94f085ace02207b14736cd0515a11571bcecfbd44f11ca8a2d661b5235fd27837b74ca5071a120121032ef68318c8f6aaa0adec0199c69901f0db7d3485eb38d9ad235221dc3d61154b',
            P2WPKH_SCRIPT_PUBKEY,
            '',
        ],
        [
            'P2WPKH with commitment data (test_confirm_ownership_proof_with_data)',
            P2WPKH_PROOF,
            P2WPKH_SCRIPT_PUBKEY,
            P2WPKH_COMMITMENT_DATA,
        ],
        ['Taproot (test_p2tr_ownership_proof)', P2TR_PROOF, P2TR_SCRIPT_PUBKEY, ''],
        ['Taproot coinjoin input', COINJOIN_PROOF, COINJOIN_SCRIPT_PUBKEY, ROUND_1_COMMITMENT_DATA],
        [
            'uppercase',
            COINJOIN_PROOF.toUpperCase(),
            COINJOIN_SCRIPT_PUBKEY,
            ROUND_1_COMMITMENT_DATA,
        ],
    ])('accepts a valid proof: %s', (_, ownershipProof, scriptPubKey, commitmentData) => {
        expect(verifyOwnershipProof({ ownershipProof, scriptPubKey, commitmentData })).toBe(
            'valid',
        );
    });

    it.each([
        [
            'P2WPKH',
            `${P2WPKH_PROOF_BODY}000248${P2WPKH_SIGNATURE.slice(0, -2)}930121${P2WPKH_PUBLIC_KEY}`,
            P2WPKH_SCRIPT_PUBKEY,
            P2WPKH_COMMITMENT_DATA,
        ],
        [
            'Taproot',
            `${P2TR_PROOF_BODY}000140${P2TR_SIGNATURE.slice(0, -2)}96`,
            P2TR_SCRIPT_PUBKEY,
            '',
        ],
    ])('refuses an invalid signature: %s', (_, ownershipProof, scriptPubKey, commitmentData) => {
        expect(verifyOwnershipProof({ ownershipProof, scriptPubKey, commitmentData })).toBe(
            'invalid',
        );
    });

    it.each([
        ['P2WPKH without commitment data', P2WPKH_PROOF, P2WPKH_SCRIPT_PUBKEY, ''],
        ['Taproot with commitment data', P2TR_PROOF, P2TR_SCRIPT_PUBKEY, '00'],
        [
            'another round',
            COINJOIN_PROOF,
            COINJOIN_SCRIPT_PUBKEY,
            getCommitmentData('www.example.com', getRoundId(2)),
        ],
        [
            'another coordinator',
            COINJOIN_PROOF,
            COINJOIN_SCRIPT_PUBKEY,
            getCommitmentData('www.example2.com', getRoundId(1)),
        ],
    ])(
        'refuses a proof for other commitment data: %s',
        (_, ownershipProof, scriptPubKey, commitmentData) => {
            expect(verifyOwnershipProof({ ownershipProof, scriptPubKey, commitmentData })).toBe(
                'invalid',
            );
        },
    );

    it.each([
        ['P2WPKH', P2WPKH_PROOF, `0014${'00'.repeat(20)}`, P2WPKH_COMMITMENT_DATA],
        ['Taproot', P2TR_PROOF, COINJOIN_SCRIPT_PUBKEY, ''],
        ['Taproot proof for P2WPKH', P2TR_PROOF, P2WPKH_SCRIPT_PUBKEY, ''],
        ['P2WPKH proof for Taproot', P2WPKH_PROOF, P2TR_SCRIPT_PUBKEY, P2WPKH_COMMITMENT_DATA],
        [
            // SLIP-19 test vector 2, trezor-firmware core/tests/test_apps.bitcoin.ownership_proof.py.
            'valid P2SH-P2WPKH proof',
            '534c0019010192caf0b8daf78f1d388dbbceaec34bd2dabc31b217e32343663667f6694a3f4617160014e0cffbee1925a411844f44c3b8d81365ab51d0360247304402207f1003c59661ddf564af2e10d19ad8d6a1a47ad30e7052197d95fd65d186a67802205f0a804509980fec1b063554aadd8fb871d7c9fe934087cba2da09cbeff8531c012103a961687895a78da9aef98eed8e1f2a3e91cfb69d2f3cf11cbd0bb1773d951928',
            'a914b9ddc52a7d95ad46d474bfc7186d0150e15a499187',
            Buffer.from('TREZOR').toString('hex'),
        ],
    ])(
        'refuses a proof for another scriptPubKey: %s',
        (_, ownershipProof, scriptPubKey, commitmentData) => {
            expect(verifyOwnershipProof({ ownershipProof, scriptPubKey, commitmentData })).toBe(
                'invalid',
            );
        },
    );

    it.each<[string, CreateTestProofParams, OwnershipProofVerification]>([
        ['user confirmation', { flags: '01' }, 'valid'],
        ['no flags', { flags: '00' }, 'valid'],
        ['a high S', { hasHighS: true }, 'valid'],
        // The device accepts these hash types and ignores them, the hash type is not signed.
        ['SIGHASH_DEFAULT', { hashType: '00' }, 'valid'],
        ['SIGHASH_FORKID', { hashType: '40' }, 'valid'],
        ['SIGHASH_ALL_FORKID', { hashType: '41' }, 'valid'],
        // Signed by the owner, but the device refuses them.
        ['an unknown flag', { flags: '03' }, 'unsupported'],
        ['SIGHASH_NONE', { hashType: '02' }, 'unsupported'],
        ['SIGHASH_ALL | SIGHASH_ANYONECANPAY', { hashType: '81' }, 'unsupported'],
        // The signature is valid, but the public key does not hash to the scriptPubKey.
        ['the scriptPubKey of another key', { scriptPubKey: P2WPKH_SCRIPT_PUBKEY }, 'invalid'],
    ])('verifies a P2WPKH proof with %s', (_, params, verification) => {
        expect(
            verifyOwnershipProof({
                ownershipProof: createTestProof(params),
                scriptPubKey: params.scriptPubKey ?? TEST_SCRIPT_PUBKEY,
                commitmentData: '',
            }),
        ).toBe(verification);
    });

    it.each([
        ['SIGHASH_DEFAULT', '00', 'valid'],
        ['SIGHASH_ALL', '01', 'valid'],
        ['SIGHASH_ALL_FORKID', '41', 'valid'],
        ['SIGHASH_NONE', '02', 'unsupported'],
    ])('verifies a Taproot proof with the hash type byte of %s', (_, hashType, verification) => {
        expect(
            verifyOwnershipProof({
                ownershipProof: `${P2TR_PROOF_BODY}000141${P2TR_SIGNATURE}${hashType}`,
                scriptPubKey: P2TR_SCRIPT_PUBKEY,
                commitmentData: '',
            }),
        ).toBe(verification);
    });

    it('refuses unknown flags with a signature of other flags as invalid', () => {
        expect(
            verifyOwnershipProof({
                ownershipProof: `534c001902${P2TR_PROOF.slice(10)}`,
                scriptPubKey: P2TR_SCRIPT_PUBKEY,
                commitmentData: '',
            }),
        ).toBe('invalid');
    });

    it.each([
        ['empty', ''],
        ['not hex', 'not-relevant'],
        ['odd length', `${P2TR_PROOF}0`],
        ['magic only', '534c0019'],
        ['unknown magic', `534c0020${P2TR_PROOF.slice(8)}`],
        ['truncated', P2TR_PROOF.slice(0, -2)],
        ['trailing byte', `${P2TR_PROOF}00`],
        ['non-empty scriptSig', `${P2TR_PROOF_BODY}01000140${P2TR_SIGNATURE}`],
        ['two witness items', `${P2TR_PROOF_BODY}000240${P2TR_SIGNATURE}00`],
        ['66-byte signature', `${P2TR_PROOF_BODY}000142${P2TR_SIGNATURE}0101`],
        ['more ownership ids than bytes', `534c00190005${P2TR_PROOF.slice(12)}`],
    ])('refuses a malformed Taproot proof: %s', (_, ownershipProof) => {
        expect(
            verifyOwnershipProof({
                ownershipProof,
                scriptPubKey: P2TR_SCRIPT_PUBKEY,
                commitmentData: '',
            }),
        ).toBe('invalid');
    });

    it.each([
        ['no public key', `${P2WPKH_PROOF_BODY}000148${P2WPKH_SIGNATURE}01`],
        ['empty signature', `${P2WPKH_PROOF_BODY}00020021${P2WPKH_PUBLIC_KEY}`],
        [
            'signature not in DER',
            `${P2WPKH_PROOF_BODY}00024831${P2WPKH_SIGNATURE.slice(2)}0121${P2WPKH_PUBLIC_KEY}`,
        ],
    ])('refuses a malformed P2WPKH proof: %s', (_, ownershipProof) => {
        expect(
            verifyOwnershipProof({
                ownershipProof,
                scriptPubKey: P2WPKH_SCRIPT_PUBKEY,
                commitmentData: P2WPKH_COMMITMENT_DATA,
            }),
        ).toBe('invalid');
    });
});
