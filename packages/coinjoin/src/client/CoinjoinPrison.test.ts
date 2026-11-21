import { CoinjoinPrison } from './CoinjoinPrison';
import type { CoinjoinPrisonEvents } from '../types/prison';

describe('CoinjoinPrison', () => {
    it('release inmate when Round is no longer present in Status', () =>
        new Promise<void>(done => {
            const inmate = {
                accountKey: 'account-A',
                type: 'input',
                sentenceStart: Date.now() - 10000,
            } as const;

            const prison = new CoinjoinPrison([
                { ...inmate, id: '00AA', roundId: '00', sentenceEnd: Date.now() + 10000 }, // will be released - round not present)
                { ...inmate, id: '00AB', roundId: '00', sentenceEnd: Infinity }, // will NOT be released - sentence Infinity
                { ...inmate, id: '01AA', roundId: '01', sentenceEnd: Date.now() + 10000 }, // wil NOT be released - round IS present
                { ...inmate, id: '01AB', roundId: '01', sentenceEnd: Date.now() - 1 }, // will be released - sentence is lower
            ]);

            prison.on('change', () => done()); // end test after change event

            prison.release(['01']); // only one round is present in Status

            expect(prison.inmates.map(({ id }) => id)).toEqual(['00AB', '01AA']);
        }));

    describe('inputs of rounds awaiting their blame round', () => {
        const ownInput = { accountKey: 'account-A', outpoint: 'AA' };
        const signedOutpoints = ['AA', 'BB'];

        it('are kept apart from the inmates', async () => {
            const prison = new CoinjoinPrison();
            const changeEvent = new Promise<CoinjoinPrisonEvents['change']>(resolve =>
                prison.once('change', resolve),
            );

            prison.detainForBlameRound([ownInput], '01', signedOutpoints);

            expect(prison.getBlameOfOutpoints('01')).toEqual(signedOutpoints);
            expect(prison.getBlameOfOutpoints('02')).toBeUndefined();
            // Neither emitted nor persisted with the inmates.
            const inmates = [
                expect.objectContaining({ id: 'AA', errorCode: 'blameOf', roundId: '01' }),
            ];
            expect(prison.inmates).toEqual(inmates);
            expect(await changeEvent).toEqual({ prison: inmates });
        });

        it('are released with the inmates of the round', () => {
            const prison = new CoinjoinPrison();
            prison.detainForBlameRound([ownInput], '01', signedOutpoints);

            prison.releaseBlameOfInmates('01');

            expect(prison.getBlameOfOutpoints('01')).toBeUndefined();
            expect(prison.inmates).toEqual([]);
        });

        it('are released without the outputs registered in the round', () => {
            const prison = new CoinjoinPrison();
            prison.detainForBlameRound([ownInput], '01', signedOutpoints);
            prison.detainRegisteredOutput({ accountKey: 'account-A', address: 'bc1p01' }, '01');

            prison.releaseBlameOfInmates('01');

            expect(prison.inmates).toEqual([
                expect.objectContaining({
                    id: 'bc1p01',
                    errorCode: 'registeredOutput',
                    roundId: '01',
                    sentenceEnd: Infinity,
                }),
            ]);
        });

        it('are released when the round is no longer present in Status', () => {
            const prison = new CoinjoinPrison();
            prison.detainForBlameRound([ownInput], '01', signedOutpoints);
            prison.detainForBlameRound([], '02', ['CC']);

            prison.release(['01']);
            expect(prison.getBlameOfOutpoints('01')).toEqual(signedOutpoints);
            expect(prison.getBlameOfOutpoints('02')).toBeUndefined();

            prison.release([]);
            expect(prison.getBlameOfOutpoints('01')).toBeUndefined();
            expect(prison.inmates).toEqual([]);
        });
    });
});
