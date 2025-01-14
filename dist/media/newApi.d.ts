import { PassThrough, type Readable } from "node:stream";
import type { SupportedVideoCodec } from '../utils.js';
import type { MediaUdp, Streamer } from '../client/index.js';
import { VideoStream } from './VideoStream.js';
import { AudioStream } from './AudioStream.js';
import { EventEmitter } from 'node:events';
export type EncoderOptions = {
    /**
     * Video width
     */
    width: number;
    /**
     * Video height
     */
    height: number;
    /**
     * Video frame rate
     */
    frameRate?: number;
    /**
     * Video codec
     */
    videoCodec: SupportedVideoCodec;
    /**
     * Video average bitrate in kbps
     */
    bitrateVideo: number;
    /**
     * Video max bitrate in kbps
     */
    bitrateVideoMax: number;
    /**
     * Audio bitrate in kbps
     */
    bitrateAudio: number;
    /**
     * Enable audio output
     */
    includeAudio: boolean;
    /**
     * Enable hardware accelerated decoding
     */
    hardwareAcceleratedDecoding: boolean;
    /**
     * Add some options to minimize latency
     */
    minimizeLatency: boolean;
    /**
     * Preset for x264 and x265
     */
    h26xPreset: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow" | "placebo";
    /**
     * Custom headers for HTTP requests
     */
    customHeaders: Record<string, string>;
};
export declare function prepareStream(input: string | Readable, options?: Partial<EncoderOptions>): {
    command: any;
    output: PassThrough;
};
export declare class StreamController extends EventEmitter {
    private currentCommand?;
    private currentOutput?;
    videoStream?: VideoStream;
    audioStream?: AudioStream;
    private udp;
    private streamer;
    private inputSource;
    private options;
    private isDestroyed;
    private seekTarget;
    private isSeekInProgress;
    private nextSeekTarget?;
    private isMuted;
    private originalVolume?;
    private startPts?;
    private lastPts;
    private startTime?;
    private seekOffset;
    private isPaused;
    private pauseStartTime?;
    private totalPausedTime;
    constructor(streamer: Streamer, udp: MediaUdp, inputSource: string, options: any);
    setOptions(options: any): void;
    private setupPtsTracking;
    private cleanupStreams;
    setStreams(videoStream: VideoStream, audioStream?: AudioStream): void;
    private cleanupCurrentPlayback;
    private startNewStream;
    private setupStreams;
    mute(): void;
    unmute(): void;
    toggleMute(): void;
    isMutedState(): boolean;
    seek(timestamp: number): Promise<void>;
    getCurrentPosition(): number;
    seekRelative(seconds: number): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): Promise<void>;
}
export type PlayStreamOptions = {
    /**
     * Set stream type as "Go Live" or camera stream
     */
    type: "go-live" | "camera";
    /**
     * Override video width sent to Discord.
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    width: number;
    /**
     * Override video height sent to Discord.
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    height: number;
    /**
     * Override video frame rate sent to Discord.
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    frameRate: number;
    /**
     * Enable RTCP Sender Report for synchronization
     */
    rtcpSenderReportEnabled: boolean;
    /**
     * Force the use of ChaCha20 encryption. Faster on CPUs without AES-NI
     */
    forceChacha20Encryption: boolean;
};
export declare function playStream(dir: string, input: Readable, streamer: Streamer, options?: Partial<PlayStreamOptions>): Promise<StreamController>;
