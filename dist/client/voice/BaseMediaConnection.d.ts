import { MediaUdp } from "./MediaUdp.js";
import { type TransportEncryptor } from "../encryptor/TransportEncryptor.js";
import { SupportedEncryptionModes, type SupportedVideoCodec } from "../../utils.js";
import type { ReadyMessage, SelectProtocolAck } from "./VoiceMessageTypes.js";
import WebSocket from 'ws';
import EventEmitter from "node:events";
type VoiceConnectionStatus = {
    hasSession: boolean;
    hasToken: boolean;
    started: boolean;
    resuming: boolean;
};
type WebRtcParameters = {
    address: string;
    port: number;
    audioSsrc: number;
    videoSsrc: number;
    rtxSsrc: number;
    supportedEncryptionModes: SupportedEncryptionModes[];
};
export declare const CodecPayloadType: {
    opus: {
        name: string;
        type: string;
        priority: number;
        payload_type: number;
    };
    H264: {
        name: string;
        type: string;
        priority: number;
        payload_type: number;
        rtx_payload_type: number;
        encode: boolean;
        decode: boolean;
    };
    H265: {
        name: string;
        type: string;
        priority: number;
        payload_type: number;
        rtx_payload_type: number;
        encode: boolean;
        decode: boolean;
    };
    VP8: {
        name: string;
        type: string;
        priority: number;
        payload_type: number;
        rtx_payload_type: number;
        encode: boolean;
        decode: boolean;
    };
    VP9: {
        name: string;
        type: string;
        priority: number;
        payload_type: number;
        rtx_payload_type: number;
        encode: boolean;
        decode: boolean;
    };
    AV1: {
        name: string;
        type: string;
        priority: number;
        payload_type: number;
        rtx_payload_type: number;
        encode: boolean;
        decode: boolean;
    };
};
export interface StreamOptions {
    /**
     * Video output width
     */
    width: number;
    /**
     * Video output height
     */
    height: number;
    /**
     * Video output frames per second
     */
    fps: number;
    /**
     * Video output bitrate in kbps
     */
    bitrateKbps: number;
    maxBitrateKbps: number;
    /**
     * Enables hardware accelerated video decoding. Enabling this option might result in an exception
     * being thrown by Ffmpeg process if your system does not support hardware acceleration
     */
    hardwareAcceleratedDecoding: boolean;
    /**
     * Output video codec. **Only** supports H264, H265, and VP8 currently
     */
    videoCodec: SupportedVideoCodec;
    /**
     * Enables sending RTCP sender reports. Helps the receiver synchronize the audio/video frames, except in some weird
     * cases which is why you can disable it
     */
    rtcpSenderReportEnabled: boolean;
    /**
     * Encoding preset for H264 or H265. The faster it is, the lower the quality
     */
    h26xPreset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
    /**
     * Adds ffmpeg params to minimize latency and start outputting video as fast as possible.
     * Might create lag in video output in some rare cases
     */
    minimizeLatency: boolean;
    /**
     * ChaCha20-Poly1305 Encryption is faster than AES-256-GCM, except when using AES-NI
     */
    forceChacha20Encryption: boolean;
}
export declare abstract class BaseMediaConnection extends EventEmitter {
    private interval;
    udp: MediaUdp;
    guildId: string;
    channelId: string;
    botId: string;
    ws: WebSocket | null;
    ready: (udp: MediaUdp) => void;
    status: VoiceConnectionStatus;
    server: string | null;
    token: string | null;
    session_id: string | null;
    webRtcParams: WebRtcParameters | null;
    private _streamOptions;
    private _transportEncryptor?;
    constructor(guildId: string, botId: string, channelId: string, options: Partial<StreamOptions>, callback: (udp: MediaUdp) => void);
    abstract get serverId(): string | null;
    get streamOptions(): StreamOptions;
    set streamOptions(options: Partial<StreamOptions>);
    get transportEncryptor(): TransportEncryptor | undefined;
    stop(): void;
    setSession(session_id: string): void;
    setTokens(server: string, token: string): void;
    start(): void;
    handleReady(d: ReadyMessage): void;
    handleProtocolAck(d: SelectProtocolAck): void;
    setupEvents(): void;
    setupHeartbeat(interval: number): void;
    sendOpcode(code: number, data: unknown): void;
    identify(): void;
    resume(): void;
    setProtocols(): Promise<void>;
    setVideoStatus(bool: boolean): void;
    setSpeaking(speaking: boolean): void;
    sendVoice(): Promise<void>;
}
export {};
