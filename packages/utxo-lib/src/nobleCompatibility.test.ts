import * as ecc from './noble-compatibility';

const ORDER = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

const to32Buffer = (value: bigint): Buffer =>
    Buffer.from(value.toString(16).padStart(64, '0'), 'hex');

describe('noble compatibility', () => {
    const privateOne = to32Buffer(1n);
    const privateTwo = to32Buffer(2n);
    const privateNMinusOne = to32Buffer(ORDER - 1n);
    const zero32 = Buffer.alloc(32, 0);

    it('isPrivate matches secp256k1 bounds', () => {
        expect(ecc.isPrivate(privateOne)).toEqual(true);
        expect(ecc.isPrivate(privateNMinusOne)).toEqual(true);
        expect(ecc.isPrivate(zero32)).toEqual(false);
        expect(ecc.isPrivate(to32Buffer(ORDER))).toEqual(false);
        expect(ecc.isPrivate(Buffer.alloc(31, 1))).toEqual(false);
    });

    it('pointFromScalar returns known generator point and null for invalid scalar', () => {
        expect(ecc.pointFromScalar(privateOne)?.toString('hex')).toEqual(
            '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        );
        expect(ecc.pointFromScalar(privateOne, false)?.toString('hex')).toEqual(
            '0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
        );
        expect(() => ecc.pointFromScalar(zero32)).toThrow();
    });

    it('pointAddScalar behaves like tweak-add and returns null for invalid cases', () => {
        const pointOne = ecc.pointFromScalar(privateOne);

        expect(pointOne).toBeDefined();
        expect(pointOne).not.toEqual(null);
        expect(ecc.pointAddScalar(pointOne!, privateOne)?.toString('hex')).toEqual(
            ecc.pointFromScalar(privateTwo)?.toString('hex'),
        );

        expect(ecc.pointAddScalar(pointOne!, privateNMinusOne)).toEqual(null);
        expect(ecc.pointAddScalar(pointOne!, zero32)?.toString('hex')).toEqual(
            pointOne?.toString('hex'),
        );
        expect(() => ecc.pointAddScalar(Buffer.alloc(33, 0), privateOne)).toThrow();
    });

    it('privateAdd returns null for invalid input and zero result', () => {
        expect(ecc.privateAdd(privateOne, privateOne)?.toString('hex')).toEqual(
            privateTwo.toString('hex'),
        );
        expect(ecc.privateAdd(privateNMinusOne, privateOne)).toEqual(null);
        expect(ecc.privateAdd(privateOne, zero32)?.toString('hex')).toEqual(
            privateOne.toString('hex'),
        );
        expect(() => ecc.privateAdd(zero32, privateOne)).toThrow();
    });

    it('sign and verify are compatible for valid and invalid data', () => {
        const messageHash = Buffer.alloc(32, 2);
        const wrongHash = Buffer.alloc(32, 3);
        const publicKey = ecc.pointFromScalar(privateOne);

        expect(publicKey).toBeDefined();
        expect(publicKey).not.toEqual(null);

        const signature = ecc.sign(messageHash, privateOne);

        expect(signature.length).toEqual(64);
        expect(ecc.verify(messageHash, publicKey!, signature)).toEqual(true);
        expect(ecc.verify(wrongHash, publicKey!, signature)).toEqual(false);
        expect(() => ecc.verify(messageHash, Buffer.alloc(33, 0), signature)).toThrow();
        expect(ecc.verify(messageHash, publicKey!, Buffer.alloc(64, 0))).toEqual(false);
    });

    it('pointAddScalar throws "Expected Tweak" for non-32-byte tweak (exercises isValidScalar length guard via assertTweak)', () => {
        const pointOne = ecc.pointFromScalar(privateOne)!;
        expect(() => ecc.pointAddScalar(pointOne, Buffer.alloc(31, 1))).toThrow('Expected Tweak');
    });

    it('sign throws "Expected Hash" for non-32-byte hash (exercises assertHash length guard)', () => {
        expect(() => ecc.sign(Buffer.alloc(31, 1), privateOne)).toThrow('Expected Hash');
    });

    it('verify throws "Expected Signature" for non-64-byte signature (exercises assertSignature length guard)', () => {
        const messageHash = Buffer.alloc(32, 2);
        const publicKey = ecc.pointFromScalar(privateOne)!;
        expect(() => ecc.verify(messageHash, publicKey, Buffer.alloc(63, 0))).toThrow(
            'Expected Signature',
        );
    });

    it('signWithEntropy throws "Expected Extra Data (32 bytes)" for non-32-byte entropy (exercises assertExtraEntropy length guard)', () => {
        const messageHash = Buffer.alloc(32, 2);
        expect(() => ecc.signWithEntropy(messageHash, privateOne, Buffer.alloc(31, 9))).toThrow(
            'Expected Extra Data (32 bytes)',
        );
    });

    it('signWithEntropy is deterministic for fixed entropy', () => {
        const messageHash = Buffer.alloc(32, 7);
        const extraEntropy = Buffer.alloc(32, 9);

        const signatureA = ecc.signWithEntropy(messageHash, privateOne, extraEntropy);
        const signatureB = ecc.signWithEntropy(messageHash, privateOne, extraEntropy);

        expect(signatureA.toString('hex')).toEqual(signatureB.toString('hex'));
    });

    // Vectors 0-14 of https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv.
    // Vectors 15 and later sign messages that are not 32 bytes long.
    it.each([
        {
            index: 0,
            publicKey: 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9',
            message: '0000000000000000000000000000000000000000000000000000000000000000',
            signature:
                'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0',
            isValid: true,
        },
        {
            index: 1,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '6896BD60EEAE296DB48A229FF71DFE071BDE413E6D43F917DC8DCF8C78DE33418906D11AC976ABCCB20B091292BFF4EA897EFCB639EA871CFA95F6DE339E4B0A',
            isValid: true,
        },
        {
            index: 2,
            publicKey: 'DD308AFEC5777E13121FA72B9CC1B7CC0139715309B086C960E18FD969774EB8',
            message: '7E2D58D8B3BCDF1ABADEC7829054F90DDA9805AAB56C77333024B9D0A508B75C',
            signature:
                '5831AAEED7B44BB74E5EAB94BA9D4294C49BCF2A60728D8B4C200F50DD313C1BAB745879A5AD954A72C45A91C3A51D3C7ADEA98D82F8481E0E1E03674A6F3FB7',
            isValid: true,
        },
        {
            index: 3,
            publicKey: '25D1DFF95105F5253C4022F628A996AD3A0D95FBF21D468A1B33F8C160D8F517',
            message: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
            signature:
                '7EB0509757E246F19449885651611CB965ECC1A187DD51B64FDA1EDC9637D5EC97582B9CB13DB3933705B32BA982AF5AF25FD78881EBB32771FC5922EFC66EA3',
            isValid: true,
        },
        {
            index: 4,
            publicKey: 'D69C3509BB99E412E68B0FE8544E72837DFA30746D8BE2AA65975F29D22DC7B9',
            message: '4DF3C3F68FCC83B27E9D42C90431A72499F17875C81A599B566C9889B9696703',
            signature:
                '00000000000000000000003B78CE563F89A0ED9414F5AA28AD0D96D6795F9C6376AFB1548AF603B3EB45C9F8207DEE1060CB71C04E80F593060B07D28308D7F4',
            isValid: true,
        },
        {
            index: 5,
            publicKey: 'EEFDEA4CDB677750A420FEE807EACF21EB9898AE79B9768766E4FAA04A2D4A34',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B',
            isValid: false,
        },
        {
            index: 6,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                'FFF97BD5755EEEA420453A14355235D382F6472F8568A18B2F057A14602975563CC27944640AC607CD107AE10923D9EF7A73C643E166BE5EBEAFA34B1AC553E2',
            isValid: false,
        },
        {
            index: 7,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '1FA62E331EDBC21C394792D2AB1100A7B432B013DF3F6FF4F99FCB33E0E1515F28890B3EDB6E7189B630448B515CE4F8622A954CFE545735AAEA5134FCCDB2BD',
            isValid: false,
        },
        {
            index: 8,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769961764B3AA9B2FFCB6EF947B6887A226E8D7C93E00C5ED0C1834FF0D0C2E6DA6',
            isValid: false,
        },
        {
            index: 9,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '0000000000000000000000000000000000000000000000000000000000000000123DDA8328AF9C23A94C1FEECFD123BA4FB73476F0D594DCB65C6425BD186051',
            isValid: false,
        },
        {
            index: 10,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '00000000000000000000000000000000000000000000000000000000000000017615FBAF5AE28864013C099742DEADB4DBA87F11AC6754F93780D5A1837CF197',
            isValid: false,
        },
        {
            index: 11,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '4A298DACAE57395A15D0795DDBFD1DCB564DA82B0F269BC70A74F8220429BA1D69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B',
            isValid: false,
        },
        {
            index: 12,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F69E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B',
            isValid: false,
        },
        {
            index: 13,
            publicKey: 'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E177769FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
            isValid: false,
        },
        {
            index: 14,
            publicKey: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC30',
            message: '243F6A8885A308D313198A2E03707344A4093822299F31D0082EFA98EC4E6C89',
            signature:
                '6CFF5C3BA86C69EA4B7376F31A9BCB4F74C1976089B2D9963DA2E5543E17776969E89B4C5564D00349106B8497785DD7D1D713A8AE82B32FA79D5F7FC407D39B',
            isValid: false,
        },
    ])(
        'verifySchnorr returns $isValid for BIP340 vector $index',
        ({ publicKey, message, signature, isValid }) => {
            expect(
                ecc.verifySchnorr(
                    Buffer.from(message, 'hex'),
                    Buffer.from(publicKey, 'hex'),
                    Buffer.from(signature, 'hex'),
                ),
            ).toEqual(isValid);
        },
    );

    it('verifySchnorr throws for inputs of a wrong length', () => {
        const messageHash = Buffer.alloc(32, 2);
        const publicKey = Buffer.from(
            'DFF1D77F2A671C5F36183726DB2341BE58FEAE1DA2DECED843240F7B502BA659',
            'hex',
        );
        const compressedPublicKey = ecc.pointFromScalar(privateOne);
        const signature = Buffer.alloc(64, 1);

        expect(() => ecc.verifySchnorr(Buffer.alloc(31, 2), publicKey, signature)).toThrow(
            'Expected Hash',
        );
        expect(() => ecc.verifySchnorr(messageHash, compressedPublicKey, signature)).toThrow(
            'Expected Point',
        );
        expect(() => ecc.verifySchnorr(messageHash, publicKey, Buffer.alloc(63, 1))).toThrow(
            'Expected Signature',
        );
    });
});
