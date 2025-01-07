import ffmpeg from 'fluent-ffmpeg';
import { demux } from './LibavDemuxer.js';
import { PassThrough, type Readable } from "node:stream";
import type { SupportedVideoCodec } from '../utils.js';
import type { MediaUdp, Streamer } from '../client/index.js';
import { VideoStream } from './VideoStream.js';
import { AudioStream } from './AudioStream.js';
import { isFiniteNonZero } from '../utils.js';
import { AVCodecID } from './LibavCodecId.js';
import { EventEmitter } from 'node:events';

export type EncoderOptions = {
    /**
     * Video width
     */
    width: number,

    /**
     * Video height
     */
    height: number,

    /**
     * Video frame rate
     */
    frameRate?: number,

    /**
     * Video codec
     */
    videoCodec: SupportedVideoCodec,

    /**
     * Video average bitrate in kbps
     */
    bitrateVideo: number,

    /**
     * Video max bitrate in kbps
     */
    bitrateVideoMax: number,

    /**
     * Audio bitrate in kbps
     */
    bitrateAudio: number,

    /**
     * Enable audio output
     */
    includeAudio: boolean,

    /**
     * Enable hardware accelerated decoding
     */
    hardwareAcceleratedDecoding: boolean,

    /**
     * Add some options to minimize latency
     */
    minimizeLatency: boolean,

    /**
     * Preset for x264 and x265
     */
    h26xPreset: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow" | "placebo",

    /**
     * Custom headers for HTTP requests
     */
    customHeaders: Record<string, string>
}

export function prepareStream(
    input: string | Readable,
    options: Partial<EncoderOptions> = {}
) {
    const defaultOptions = {
        // negative values = resize by aspect ratio, see https://trac.ffmpeg.org/wiki/Scaling
        width: -2,
        height: -2,
        frameRate: undefined,
        videoCodec: "H264",
        bitrateVideo: 5000,
        bitrateVideoMax: 7000,
        bitrateAudio: 128,
        includeAudio: true,
        hardwareAcceleratedDecoding: false,
        minimizeLatency: false,
        h26xPreset: "ultrafast",
        customHeaders: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            "Connection": "keep-alive",
        }
    } satisfies EncoderOptions;

    function mergeOptions(opts: Partial<EncoderOptions>) {
        return {
            width:
                isFiniteNonZero(opts.width) ? Math.round(opts.width) : defaultOptions.width,

            height:
                isFiniteNonZero(opts.height) ? Math.round(opts.height) : defaultOptions.height,

            frameRate:
                isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
                    ? opts.frameRate
                    : defaultOptions.frameRate,

            videoCodec:
                opts.videoCodec ?? defaultOptions.videoCodec,

            bitrateVideo:
                isFiniteNonZero(opts.bitrateVideo) && opts.bitrateVideo > 0
                    ? Math.round(opts.bitrateVideo)
                    : defaultOptions.bitrateVideo,

            bitrateVideoMax:
                isFiniteNonZero(opts.bitrateVideoMax) && opts.bitrateVideoMax > 0
                    ? Math.round(opts.bitrateVideoMax)
                    : defaultOptions.bitrateVideoMax,

            bitrateAudio:
                isFiniteNonZero(opts.bitrateAudio) && opts.bitrateAudio > 0
                    ? Math.round(opts.bitrateAudio)
                    : defaultOptions.bitrateAudio,

            includeAudio:
                opts.includeAudio ?? defaultOptions.includeAudio,

            hardwareAcceleratedDecoding:
                opts.hardwareAcceleratedDecoding ?? defaultOptions.hardwareAcceleratedDecoding,

            minimizeLatency:
                opts.minimizeLatency ?? defaultOptions.minimizeLatency,

            h26xPreset:
                opts.h26xPreset ?? defaultOptions.h26xPreset,

            customHeaders: {
                ...defaultOptions.customHeaders, ...opts.customHeaders
            }
        } satisfies EncoderOptions
    }

    const mergedOptions = mergeOptions(options);

    let isHttpUrl = false;
    let isHls = false;

    if (typeof input === "string") {
        isHttpUrl = input.startsWith('http') || input.startsWith('https');
        isHls = input.includes('m3u');
    }

    const output = new PassThrough();

    // command creation
    const command = ffmpeg(input)
        .addOption('-loglevel', '0')

    // input options
    const { hardwareAcceleratedDecoding, minimizeLatency, customHeaders } = mergedOptions;
    if (hardwareAcceleratedDecoding)
        command.inputOption('-hwaccel', 'auto');

    if (minimizeLatency) {
        command.addOptions([
            '-fflags nobuffer',
            '-analyzeduration 0'
        ])
    }

    if (isHttpUrl) {
        command.inputOption('-headers',
            Object.entries(customHeaders).map(([k, v]) => `${k}: ${v}`).join("\r\n")
        );
        if (!isHls) {
            command.inputOptions([
                '-reconnect 1',
                '-reconnect_at_eof 1',
                '-reconnect_streamed 1',
                '-reconnect_delay_max 4294'
            ]);
        }
    }

    // general output options
    command
        .output(output)
        .outputFormat("matroska");

    // video setup
    const {
        width, height, frameRate, bitrateVideo, bitrateVideoMax, videoCodec, h26xPreset
    } = mergedOptions;
    command.addOutputOption("-map 0:v");
    command.videoFilter(`scale=${width}:${height}`)

    if (frameRate)
        command.fpsOutput(frameRate);

    command.addOutputOption([
        "-b:v", `${bitrateVideo}k`,
        "-maxrate:v", `${bitrateVideoMax}k`,
        "-bf", "0",
        "-pix_fmt", "yuv420p",
        "-force_key_frames", "expr:gte(t,n_forced*1)"
    ]);

    switch (videoCodec) {
        case 'AV1':
            command
                .videoCodec("libsvtav1")
            break;
        case 'VP8':
            command
                .videoCodec("libvpx")
                .outputOption('-deadline', 'realtime');
            break;
        case 'VP9':
            command
                .videoCodec("libvpx-vp9")
                .outputOption('-deadline', 'realtime');
            break;
        case 'H264':
            command
                .videoCodec("libx264")
                .outputOptions([
                    '-tune zerolatency',
                    `-preset ${h26xPreset}`,
                    '-profile:v baseline',
                ]);
            break;
        case 'H265':
            command
                .videoCodec("libx265")
                .outputOptions([
                    '-tune zerolatency',
                    `-preset ${h26xPreset}`,
                    '-profile:v main',
                ]);
            break;
    }

    // audio setup
    const { includeAudio, bitrateAudio } = mergedOptions;
    if (includeAudio)
        command
            .addOutputOption("-map 0:a?")
            .audioChannels(2)
            /*
             * I don't have much surround sound material to test this with,
             * if you do and you have better settings for this, feel free to
             * contribute!
             */
            .addOutputOption("-lfe_mix_level 1")
            .audioFrequency(48000)
            .audioCodec("libopus")
            .audioBitrate(`${bitrateAudio}k`);

    command.run();
    return { command, output }
}

interface StreamInfo {
    width: number;
    height: number;
    codec: number;
    framerate_num: number;
    framerate_den: number;
}

export class StreamController extends EventEmitter {
    private currentCommand?: ffmpeg.FfmpegCommand;
    private currentOutput?: PassThrough;
    private videoStream?: VideoStream;
    private audioStream?: AudioStream;
    private udp: MediaUdp;
    private streamer: Streamer;
    private inputSource: string;
    private options: any;
    private isDestroyed: boolean = false;
    private currentPosition: number = 0;
    private startTime?: number;
    private isPaused: boolean = false;
    private totalPausedTime: number = 0;
    private lastPauseTime?: number;

    constructor(
        streamer: Streamer,
        udp: MediaUdp,
        inputSource: string,
        options: any
    ) {
        super();
        this.streamer = streamer;
        this.udp = udp;
        this.inputSource = inputSource;
        this.options = options;
    }

    getCurrentPosition(): number {
        if (!this.startTime) return 0;
        if (this.isPaused) {
            return this.currentPosition;
        }

        const now = Date.now();
        const elapsed = now - this.startTime - this.totalPausedTime;
        return elapsed;
    }

    private async startNewStream(seekTime?: number) {
        // Create new ffmpeg command with seek if specified
        const ffmpegOptions = {
            ...this.options,
            ...(seekTime !== undefined && {
                seekInput: seekTime,
                minimizeLatency: true,  // Reduce latency for seeks
            })
        };

        const { command, output } = prepareStream(this.inputSource, ffmpegOptions);
        this.currentCommand = command;
        this.currentOutput = output;
        command.seek(seekTime);

        // Setup new streams
        const { video, audio } = await demux(output);
        if (!video) throw new Error("No video stream found");

        await this.setupStreams(video, audio);
        return { video, audio };
    }

    private async setupStreams(video: { stream: Readable } & StreamInfo, audio?: { stream: Readable }) {
        // Create new video stream
        const vStream = new VideoStream(this.udp, false);  // noSleep = false for better sync
        video.stream.pipe(vStream);

        // Create new audio stream if available
        if (audio) {
            const aStream = new AudioStream(this.udp, false);
            audio.stream.pipe(aStream);
            vStream.syncStream = aStream;
            aStream.syncStream = vStream;
            this.setStreams(vStream, aStream);
        } else {
            this.setStreams(vStream);
        }
    }

    setStreams(videoStream: VideoStream, audioStream?: AudioStream) {
        // Clean up old streams
        this.cleanupStreams();

        this.videoStream = videoStream;
        this.audioStream = audioStream;

        videoStream.on('finish', () => {
            if (!this.isDestroyed) {
                this.emit('finished');
                this.stop();
            }
        });

        videoStream.on('error', (error) => {
            if (!this.isDestroyed) {
                this.emit('error', error);
                this.stop();
            }
        });

        if (audioStream) {
            audioStream.on('error', (error) => {
                if (!this.isDestroyed) {
                    this.emit('error', error);
                    this.stop();
                }
            });
        }
    }

    private cleanupStreams() {
        if (this.videoStream) {
            this.videoStream.removeAllListeners();
            this.videoStream.destroy();
        }
        if (this.audioStream) {
            this.audioStream.removeAllListeners();
            this.audioStream.destroy();
        }
    }

    async seek(timestamp: number) {
        if (this.isDestroyed) return;

        try {
            this.emit('seeking', timestamp);

            // Update current position
            this.currentPosition = timestamp;
            this.startTime = Date.now();
            this.totalPausedTime = 0;
            this.lastPauseTime = undefined;

            // Pause current playback
            this.udp.mediaConnection.setSpeaking(false);

            // Clean up existing streams
            this.cleanupStreams();
            this.currentCommand?.kill('SIGKILL');
            this.currentOutput?.destroy();

            // Start new stream with seek
            await this.startNewStream(timestamp / 1000); // Convert to seconds

            // Resume playback
            this.udp.mediaConnection.setSpeaking(true);

            this.emit('seeked', timestamp);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    pause() {
        if (this.isDestroyed || this.isPaused) return;
        this.isPaused = true;
        this.lastPauseTime = Date.now();
        this.currentPosition = this.getCurrentPosition();
        this.videoStream?.pause();
        this.audioStream?.pause();
        this.udp.mediaConnection.setSpeaking(false);
    }

    resume() {
        if (this.isDestroyed || !this.isPaused) return;
        this.isPaused = false;
        if (this.lastPauseTime) {
            this.totalPausedTime += Date.now() - this.lastPauseTime;
            this.lastPauseTime = undefined;
        }
        this.videoStream?.resume();
        this.audioStream?.resume();
        this.udp.mediaConnection.setSpeaking(true);
    }

    stop() {
        if (this.isDestroyed) return;
        this.isDestroyed = true;

        this.cleanupStreams();
        this.currentCommand?.kill('SIGKILL');
        this.currentOutput?.destroy();

        this.streamer.stopStream();
        this.udp.mediaConnection.setSpeaking(false);
        this.udp.mediaConnection.setVideoStatus(false);

        this.emit('stopped');
    }
}

export type PlayStreamOptions = {
    /**
     * Set stream type as "Go Live" or camera stream
     */
    type: "go-live" | "camera",

    /**
     * Override video width sent to Discord.
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    width: number,

    /**
     * Override video height sent to Discord.
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    height: number,

    /**
     * Override video frame rate sent to Discord.
     * DO NOT SPECIFY UNLESS YOU KNOW WHAT YOU'RE DOING!
     */
    frameRate: number,

    /**
     * Enable RTCP Sender Report for synchronization
     */
    rtcpSenderReportEnabled: boolean,

    /**
     * Force the use of ChaCha20 encryption. Faster on CPUs without AES-NI
     */
    forceChacha20Encryption: boolean
}

export async function playStream(
    dir: string,
    input: Readable,
    streamer: Streamer,
    options: Partial<PlayStreamOptions> = {}
): Promise<StreamController> {
    if (!streamer.voiceConnection) {
        throw new Error("Bot is not connected to a voice channel");
    }

    // Setup demuxer first
    const demuxResult = await demux(input);
    if (!demuxResult.video) {
        throw new Error("No video stream in media");
    }

    const videoCodecMap: Record<number, SupportedVideoCodec> = {
        [AVCodecID.AV_CODEC_ID_H264]: "H264",
        [AVCodecID.AV_CODEC_ID_H265]: "H265",
        [AVCodecID.AV_CODEC_ID_VP8]: "VP8",
        [AVCodecID.AV_CODEC_ID_VP9]: "VP9",
        [AVCodecID.AV_CODEC_ID_AV1]: "AV1"
    }

    const defaultOptions = {
        type: "go-live",
        width: demuxResult.video.width,
        height: demuxResult.video.height,
        frameRate: demuxResult.video.framerate_num / demuxResult.video.framerate_den,
        rtcpSenderReportEnabled: true,
        forceChacha20Encryption: false
    } satisfies PlayStreamOptions;

    function mergeOptions(opts: Partial<PlayStreamOptions>) {
        return {
            type:
                opts.type ?? defaultOptions.type,

            width:
                isFiniteNonZero(opts.width) && opts.width > 0
                    ? Math.round(opts.width)
                    : defaultOptions.width,

            height:
                isFiniteNonZero(opts.height) && opts.height > 0
                    ? Math.round(opts.height)
                    : defaultOptions.height,

            frameRate: Math.round(
                isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
                    ? Math.round(opts.frameRate)
                    : defaultOptions.frameRate
            ),

            rtcpSenderReportEnabled:
                opts.rtcpSenderReportEnabled ?? defaultOptions.rtcpSenderReportEnabled,

            forceChacha20Encryption:
                opts.forceChacha20Encryption ?? defaultOptions.forceChacha20Encryption
        } satisfies PlayStreamOptions
    }

    const mergedOptions = mergeOptions(options);

    // Create UDP connection
    let udp: MediaUdp;
    let stopStream: () => void;

    if (options.type === "camera") {
        udp = streamer.voiceConnection.udp;
        streamer.signalVideo(true);
        stopStream = () => streamer.signalVideo(false);
    } else {
        udp = await streamer.createStream();
        stopStream = () => streamer.stopStream();
    }

    // Setup media connection
    udp.mediaConnection.streamOptions = {
        width: mergedOptions.width,
        height: mergedOptions.height,
        videoCodec: videoCodecMap[demuxResult.video.codec],
        fps: mergedOptions.frameRate,
        rtcpSenderReportEnabled: mergedOptions.rtcpSenderReportEnabled,
        forceChacha20Encryption: mergedOptions.forceChacha20Encryption
    };

    await udp.mediaConnection.setProtocols();
    udp.updatePacketizer();
    udp.mediaConnection.setSpeaking(true);
    udp.mediaConnection.setVideoStatus(true);

    // Create controller and streams
    const controller = new StreamController(streamer, udp, dir, options);
    const vStream = new VideoStream(udp);
    demuxResult.video.stream.pipe(vStream);

    if (demuxResult.audio) {
        const aStream = new AudioStream(udp);
        demuxResult.audio.stream.pipe(aStream);
        vStream.syncStream = aStream;
        aStream.syncStream = vStream;
        controller.setStreams(vStream, aStream);
    } else {
        controller.setStreams(vStream);
    }

    return controller;
}