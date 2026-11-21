import { keccakP } from '@noble/hashes/sha3.js';
import { swap32IfBE, u32 } from '@noble/hashes/utils.js';

// Strobe v1.0.2 (https://strobe.sourceforge.io/specs/) with 128-bit security over Keccak-f[1600],
// limited to the operations WalletWasabi uses to hash round parameters. Port of Strobe128 of
// WalletWasabi (MIT, WalletWasabi/Crypto/StrobeProtocol/Strobe.cs until commit 90d3aaaa6, since
// then in its WabiSabi library), which is based on strobe.rs of merlin.

const KECCAK_STATE_SIZE = 200;
// Rate of the sponge minus the 2 bytes Strobe uses for padding.
const STROBE_R = 166;

const FLAG_I = 1;
const FLAG_A = 1 << 1;
const FLAG_C = 1 << 2;
const FLAG_M = 1 << 4;

const PADDING_DATA = 0x04;
const PADDING_RATE = 0x80;

export class Strobe128 {
    private readonly state = new Uint8Array(KECCAK_STATE_SIZE);
    private readonly stateWords = u32(this.state);
    private position = 0;
    private beginPosition = 0;
    private currentFlags = 0;

    constructor(protocolLabel: string) {
        this.state.set([1, STROBE_R + 2, 1, 0, 1, 12 * 8]);
        this.state.set(Buffer.from('STROBEv1.0.2', 'utf8'), 6);
        this.permute();
        this.metaAd(Buffer.from(protocolLabel, 'utf8'));
    }

    metaAd(data: Uint8Array, more = false) {
        this.beginOperation(FLAG_M | FLAG_A, more);
        this.absorb(data);
    }

    ad(data: Uint8Array, more = false) {
        this.beginOperation(FLAG_A, more);
        this.absorb(data);
    }

    key(data: Uint8Array, more = false) {
        this.beginOperation(FLAG_A | FLAG_C, more);
        data.forEach(byte => this.setNextByte(byte));
    }

    prf(length: number, more = false) {
        this.beginOperation(FLAG_I | FLAG_A | FLAG_C, more);

        return Uint8Array.from({ length }, () => {
            const byte = this.getByte(this.position);
            this.setNextByte(0);

            return byte;
        });
    }

    // Hex of the whole sponge state, which the Strobe test vectors check after each operation.
    dumpState() {
        return Buffer.from(this.state).toString('hex');
    }

    private getByte(index: number) {
        return this.state[index] ?? 0;
    }

    private xorByte(index: number, byte: number) {
        this.state[index] = this.getByte(index) ^ byte;
    }

    private setNextByte(byte: number) {
        this.state[this.position] = byte;
        this.advance();
    }

    private absorb(data: Uint8Array) {
        data.forEach(byte => {
            this.xorByte(this.position, byte);
            this.advance();
        });
    }

    private advance() {
        this.position++;
        if (this.position === STROBE_R) this.runF();
    }

    private beginOperation(flags: number, more: boolean) {
        if (more) {
            if (flags !== this.currentFlags) {
                throw new Error('Strobe operation continued with other flags');
            }

            return;
        }

        const previousBeginPosition = this.beginPosition;
        this.currentFlags = flags;
        this.beginPosition = this.position + 1;
        this.absorb(Uint8Array.of(previousBeginPosition, flags));

        // Operations which change the state as a whole start in a fresh block.
        if ((flags & FLAG_C) !== 0 && this.position !== 0) this.runF();
    }

    private runF() {
        this.xorByte(this.position, this.beginPosition);
        this.xorByte(this.position + 1, PADDING_DATA);
        this.xorByte(STROBE_R + 1, PADDING_RATE);
        this.permute();
        this.position = 0;
        this.beginPosition = 0;
    }

    // keccakP takes the lanes as little-endian 32-bit words.
    private permute() {
        swap32IfBE(this.stateWords);
        keccakP(this.stateWords);
        swap32IfBE(this.stateWords);
    }
}
