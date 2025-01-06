import sp from "sodium-plus";
import { webcrypto } from "node:crypto";
import { max_int32bit } from "../../utils.js";
const { SodiumPlus } = sp;
export class AES256TransportEncryptor {
    constructor(secretKey) {
        this._nonce = 0;
        this._secretKey = webcrypto.subtle.importKey("raw", secretKey, {
            name: "AES-GCM",
            length: 32
        }, false, ["encrypt"]);
    }
    async encrypt(plaintext, additionalData) {
        const nonceBuffer = Buffer.alloc(12);
        nonceBuffer.writeUInt32BE(this._nonce);
        this._nonce = (this._nonce + 1) % max_int32bit;
        const ciphertext = Buffer.from(await webcrypto.subtle.encrypt({
            name: "AES-GCM",
            iv: nonceBuffer,
            additionalData,
        }, await this._secretKey, plaintext));
        return [ciphertext, nonceBuffer];
    }
}
export class Chacha20TransportEncryptor {
    constructor(secretKey) {
        this._nonce = 0;
        this._secretKey = new sp.CryptographyKey(secretKey);
    }
    async encrypt(plaintext, additionalData) {
        const nonceBuffer = Buffer.alloc(24);
        nonceBuffer.writeUInt32BE(this._nonce);
        this._nonce = (this._nonce + 1) % max_int32bit;
        const ciphertext = await Chacha20TransportEncryptor.sodium
            .then(s => s.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, nonceBuffer, this._secretKey, additionalData));
        return [ciphertext, nonceBuffer];
    }
}
Chacha20TransportEncryptor.sodium = SodiumPlus.auto();
