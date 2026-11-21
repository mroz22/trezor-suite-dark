// Strobe test vectors of WalletWasabi (WalletWasabi.Tests/UnitTests/Data/StrobeTestVectors.json,
// MIT, removed in commit 90d3aaaa6), originally from mimoo/StrobeGo. As in its Strobe128Tests,
// each vector keeps its operations up to the first one other than KEY, AD and PRF, and the
// streaming vector is left out.

export type StrobeTestOperation =
    | { name: 'KEY' | 'AD'; meta: boolean; inputData: string; stateAfter: string }
    | { name: 'PRF'; inputLength: number; output: string; stateAfter: string };

export type StrobeTestVector = {
    name: string;
    customString: string;
    initialState: string;
    operations: StrobeTestOperation[];
};

export const STROBE_TEST_VECTORS: StrobeTestVector[] = [
    {
        name: 'simple tests',
        customString: 'custom string',
        initialState:
            '9c7f75fa8b893ab70ad448513c0b5263dc0c475c551526f6733bea22f16cb57cd31f682e660ee912824a772201ee1394226f4afcb62d331293cc92e8a624acf6e1b60095e322bbfbc845e5b26995fe7d7c841374d1ff5898c92ee0636b06727321c92a603907035349ccbb1b92b7b0057e8fa87fcebc7e88656fcb45ae04bc34cabeaebe79d91750c0e8bf13b966504d1343597265dd8865adf91409cc9b20d5f47444041f97b699ddfbdee91ea87bd09bf8b02da75a96e947f07f5b65bb4e6efefaa16abfd9fbf6',
        operations: [
            {
                name: 'KEY',
                meta: false,
                inputData: '303130313031',
                stateAfter:
                    '3031303130310e6be02d3677fb5a70dfc1f3a6f889f561699f053f97f705d671383c613b13b3e4184397827ad73b9c26e13af703f0bf70ff10d71516bb8a05a5b69775f1722daf9178b71cfca96cf36cd0fab68cac22f3f35afec0bf5066656d142761e3200b9e76a9ddd6ad74932110afd4a776fd82515edfe028dd4858abfda1c3b6bff17e9b82aad3b519e51e704cba48a6e383c8504cd1f7b13d7a6ac6e9690ed05ae90744c5c32a97af08d66f15c9357bf20ea9276cab5ac736b8a68f25b095c409a1c48fd4',
            },
            {
                name: 'AD',
                meta: false,
                inputData: '68656c6c6f2c20686f772061726520796f7520676f6f64207369723f',
                stateAfter:
                    '3031303130310e6988485a1b947650b7ae848699fb904110f0701ff0986ab2514b55130413b3e4184397827ad73b9c26e13af703f0bf70ff10d71516bb8a05a5b69775f1722daf9178b71cfca96cf36cd0fab68cac22f3f35afec0bf5066656d142761e3200b9e76a9ddd6ad74932110afd4a776fd82515edfe028dd4858abfda1c3b6bff17e9b82aad3b519e51e704cba48a6e383c8504cd1f7b13d7a6ac6e9690ed05ae90744c5c32a97af08d66f15c9357bf20ea9276cab5ac736b8a68f25b095c409a1c48fd4',
            },
            {
                name: 'PRF',
                inputLength: 16,
                output: '5ce86d0815c02a27d8bdd923f2cb0bd8',
                stateAfter:
                    '000000000000000000000000000000006380b09c7f711ca1c97eb6612cf25c2ab2abfb9cba447b27e72134629c3947281a0be4044d4e03c60564c66885407a2e6982603b07390ab718c0fa70f25e857c189caf2bdf42786669bc2f5d43440869e8feb7d47780383bb82c84705220c4d08b5df18081cb4939f3a38d059ee18529e85c6dade82e3c8b3c6cd0b56203299bb7311dfcbb68d1b5be5df6d2b8697dd60e89ca4fd78ffbd1c22b939311775d913a8bf324b8ebac782e1f99605eccf03c0e59770c177812d1',
            },
        ],
    },
    {
        name: 'meta tests',
        customString: "custom string number 2, that's a pretty long string",
        initialState:
            '9c7f75fa8b893ab70ad448513c0b5243b2792a3e306706c45f1b9e4a9018920ff37e485e146b9d66fb6a1b4d6f8933e7561d2392d12d331293cc92e8a624acf6e1b60095e322bbfbc845e5b26995fe7d7c841374d1ff5898c92ee0636b06727321c92a603907035349ccbb1b92b7b0057e8fa87fcebc7e88656fcb45ae04bc34cabeaebe79d91750c0e8bf13b966504d1343597265dd8865adf91409cc9b20d5f47444041f97b699ddfbdee91ea87bd09bf8b02da75a96e947f07f5b65bb4e6efefaa16abfd9fbf6',
        operations: [
            {
                name: 'KEY',
                meta: false,
                inputData: '303130313031',
                stateAfter:
                    '303130313031c70245935ce6fc2fffb47011279f887312c498f2a44a5aafb316e25f24fd46140c84c87f6613d7ff30a22d105ea7b8cde98ac104cf72d0c913bd71c6b7918cf8d1a15f8aa2b6bd6b92416e709b9678b52358884b3855dc4714ae0b93338829fbca58361efeeb58c41e9511258beba1322752c123696de8c20159b6b17303f56df8741c6fecc991611ca8f755d54bed57960feb032f47d64df53030a491151fe6f4cdd0c48f9c0a81e5bce406de061283d6257ac6ef2babc776e5dee146793acef9cf',
            },
            {
                name: 'AD',
                meta: true,
                inputData: '68656c6c6f2c20686f772061726520796f7520676f6f64207369723f',
                stateAfter:
                    '303130313031c7102df6308a9303dfdc1f6607fefa1632bdf787842d35c0d736913656c246140c84c87f6613d7ff30a22d105ea7b8cde98ac104cf72d0c913bd71c6b7918cf8d1a15f8aa2b6bd6b92416e709b9678b52358884b3855dc4714ae0b93338829fbca58361efeeb58c41e9511258beba1322752c123696de8c20159b6b17303f56df8741c6fecc991611ca8f755d54bed57960feb032f47d64df53030a491151fe6f4cdd0c48f9c0a81e5bce406de061283d6257ac6ef2babc776e5dee146793acef9cf',
            },
            {
                name: 'PRF',
                inputLength: 16,
                output: '87e57623d5c80f6d1083473a288ccdd7',
                stateAfter:
                    '0000000000000000000000000000000043b52a0e602d1f0ae3ef2604208be72c684fd6815a51820c6309f8a058b5c0789fd3caed49beb6c495a7750d1b542432eaa236d335b6fb348befdccd7104543aade1a95d7a92f5126586ae19a97e067712e23f9d818e3476bcc6fdbf6eec68911c59554ad3ec1cdd030ef5317de98593339d8e2858c26f1974475848d01d4a616be74e54321585a6da031bdbc2e0e47fb7f3d7deab9e814d76945a40c2c017960214317f7e113b877410fd3bbebf77cc66963763ebdd4a23',
            },
        ],
    },
    {
        name: 'boundary tests',
        customString: "custom string number 2, that's a pretty long string",
        initialState:
            '9c7f75fa8b893ab70ad448513c0b5243b2792a3e306706c45f1b9e4a9018920ff37e485e146b9d66fb6a1b4d6f8933e7561d2392d12d331293cc92e8a624acf6e1b60095e322bbfbc845e5b26995fe7d7c841374d1ff5898c92ee0636b06727321c92a603907035349ccbb1b92b7b0057e8fa87fcebc7e88656fcb45ae04bc34cabeaebe79d91750c0e8bf13b966504d1343597265dd8865adf91409cc9b20d5f47444041f97b699ddfbdee91ea87bd09bf8b02da75a96e947f07f5b65bb4e6efefaa16abfd9fbf6',
        operations: [
            {
                name: 'KEY',
                meta: false,
                inputData: '00',
                stateAfter:
                    '0073c69cfaafc70245935ce6fc2fffb47011279f887312c498f2a44a5aafb316e25f24fd46140c84c87f6613d7ff30a22d105ea7b8cde98ac104cf72d0c913bd71c6b7918cf8d1a15f8aa2b6bd6b92416e709b9678b52358884b3855dc4714ae0b93338829fbca58361efeeb58c41e9511258beba1322752c123696de8c20159b6b17303f56df8741c6fecc991611ca8f755d54bed57960feb032f47d64df53030a491151fe6f4cdd0c48f9c0a81e5bce406de061283d6257ac6ef2babc776e5dee146793acef9cf',
            },
            {
                name: 'AD',
                meta: false,
                inputData: '0001',
                stateAfter:
                    '0073c49cfbafc70245935ce6fc2fffb47011279f887312c498f2a44a5aafb316e25f24fd46140c84c87f6613d7ff30a22d105ea7b8cde98ac104cf72d0c913bd71c6b7918cf8d1a15f8aa2b6bd6b92416e709b9678b52358884b3855dc4714ae0b93338829fbca58361efeeb58c41e9511258beba1322752c123696de8c20159b6b17303f56df8741c6fecc991611ca8f755d54bed57960feb032f47d64df53030a491151fe6f4cdd0c48f9c0a81e5bce406de061283d6257ac6ef2babc776e5dee146793acef9cf',
            },
        ],
    },
];
