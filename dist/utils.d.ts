export declare function normalizeVideoCodec(codec: string): "H264" | "H265" | "VP8" | "VP9" | "AV1";
export declare const STREAMS_SIMULCAST: {
    type: string;
    rid: string;
    quality: number;
}[];
export declare enum SupportedEncryptionModes {
    AES256 = "aead_aes256_gcm_rtpsize",
    XCHACHA20 = "aead_xchacha20_poly1305_rtpsize"
}
export type SupportedVideoCodec = "H264" | "H265" | "VP8" | "VP9" | "AV1";
export declare const extensions: {
    id: number;
    len: number;
    val: number;
}[];
export declare const max_int16bit: number;
export declare const max_int32bit: number;
export declare function isFiniteNonZero(n: number | undefined): n is number;
