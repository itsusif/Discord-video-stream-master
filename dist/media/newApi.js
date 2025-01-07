import ffmpeg from 'fluent-ffmpeg';
import { demux } from './LibavDemuxer.js';
import { PassThrough } from "node:stream";
import { VideoStream } from './VideoStream.js';
import { AudioStream } from './AudioStream.js';
import { isFiniteNonZero } from '../utils.js';
import { AVCodecID } from './LibavCodecId.js';
import { EventEmitter } from 'node:events';
export function prepareStream(input, options = {}) {
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
    };
    function mergeOptions(opts) {
        return {
            width: isFiniteNonZero(opts.width) ? Math.round(opts.width) : defaultOptions.width,
            height: isFiniteNonZero(opts.height) ? Math.round(opts.height) : defaultOptions.height,
            frameRate: isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
                ? opts.frameRate
                : defaultOptions.frameRate,
            videoCodec: opts.videoCodec ?? defaultOptions.videoCodec,
            bitrateVideo: isFiniteNonZero(opts.bitrateVideo) && opts.bitrateVideo > 0
                ? Math.round(opts.bitrateVideo)
                : defaultOptions.bitrateVideo,
            bitrateVideoMax: isFiniteNonZero(opts.bitrateVideoMax) && opts.bitrateVideoMax > 0
                ? Math.round(opts.bitrateVideoMax)
                : defaultOptions.bitrateVideoMax,
            bitrateAudio: isFiniteNonZero(opts.bitrateAudio) && opts.bitrateAudio > 0
                ? Math.round(opts.bitrateAudio)
                : defaultOptions.bitrateAudio,
            includeAudio: opts.includeAudio ?? defaultOptions.includeAudio,
            hardwareAcceleratedDecoding: opts.hardwareAcceleratedDecoding ?? defaultOptions.hardwareAcceleratedDecoding,
            minimizeLatency: opts.minimizeLatency ?? defaultOptions.minimizeLatency,
            h26xPreset: opts.h26xPreset ?? defaultOptions.h26xPreset,
            customHeaders: {
                ...defaultOptions.customHeaders, ...opts.customHeaders
            }
        };
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
        .addOption('-loglevel', '0');
    // input options
    const { hardwareAcceleratedDecoding, minimizeLatency, customHeaders } = mergedOptions;
    if (hardwareAcceleratedDecoding)
        command.inputOption('-hwaccel', 'auto');
    if (minimizeLatency) {
        command.addOptions([
            '-fflags nobuffer',
            '-analyzeduration 0'
        ]);
    }
    if (isHttpUrl) {
        command.inputOption('-headers', Object.entries(customHeaders).map(([k, v]) => `${k}: ${v}`).join("\r\n"));
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
    const { width, height, frameRate, bitrateVideo, bitrateVideoMax, videoCodec, h26xPreset } = mergedOptions;
    command.addOutputOption("-map 0:v");
    command.videoFilter(`scale=${width}:${height}`);
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
                .videoCodec("libsvtav1");
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
    return { command, output };
}
export class StreamController extends EventEmitter {
    constructor(streamer, udp, inputSource, options) {
        super();
        this.isDestroyed = false;
        this.currentPosition = 0;
        this.isPaused = false;
        this.totalPausedTime = 0;
        this.isSeekInProgress = false;
        this.streamer = streamer;
        this.udp = udp;
        this.inputSource = inputSource;
        this.options = options;
        this.startTime = Date.now();
    }
    getCurrentPosition() {
        if (!this.startTime)
            return 0;
        if (this.isPaused) {
            return this.currentPosition;
        }
        const now = Date.now();
        const elapsed = now - this.startTime - this.totalPausedTime;
        return elapsed;
    }
    async cleanupCurrentPlayback() {
        try {
            // Cleanup streams first
            if (this.videoStream) {
                this.videoStream.removeAllListeners();
                this.videoStream.destroy();
                this.videoStream = undefined;
            }
            if (this.audioStream) {
                this.audioStream.removeAllListeners();
                this.audioStream.destroy();
                this.audioStream = undefined;
            }
            // Cleanup command and output
            if (this.currentCommand) {
                await new Promise((resolve) => {
                    this.currentCommand?.on('end', () => resolve());
                    this.currentCommand?.on('error', () => resolve());
                    this.currentCommand?.kill('SIGKILL');
                });
                this.currentCommand = undefined;
            }
            if (this.currentOutput) {
                this.currentOutput.destroy();
                this.currentOutput = undefined;
            }
            // Small delay to ensure cleanup is complete
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        catch (error) {
            console.error('Cleanup error:', error);
        }
    }
    async startNewStream(seekTime) {
        // Create new ffmpeg command with seek if specified
        const ffmpegOptions = {
            ...this.options,
            ...(seekTime !== undefined && {
                seekInput: seekTime,
                minimizeLatency: true,
            })
        };
        const { command, output } = prepareStream(this.inputSource, ffmpegOptions);
        command.seek(seekTime);
        // Set up error handling for the command
        command.on('error', (err) => {
            if (!err.message.includes('SIGKILL')) {
                this.emit('error', err);
            }
        });
        this.currentCommand = command;
        this.currentOutput = output;
        // Setup new streams
        const { video, audio } = await demux(output);
        if (!video)
            throw new Error("No video stream found");
        await this.setupStreams(video, audio);
        return { video, audio };
    }
    async setupStreams(video, audio) {
        // Create new video stream
        const vStream = new VideoStream(this.udp, false); // noSleep = false for better sync
        video.stream.pipe(vStream);
        // Create new audio stream if available
        if (audio) {
            const aStream = new AudioStream(this.udp, false);
            audio.stream.pipe(aStream);
            vStream.syncStream = aStream;
            aStream.syncStream = vStream;
            this.setStreams(vStream, aStream);
        }
        else {
            this.setStreams(vStream);
        }
    }
    setStreams(videoStream, audioStream) {
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
    cleanupStreams() {
        if (this.videoStream) {
            this.videoStream.removeAllListeners();
            this.videoStream.destroy();
        }
        if (this.audioStream) {
            this.audioStream.removeAllListeners();
            this.audioStream.destroy();
        }
    }
    async seek(timestamp) {
        if (this.isDestroyed)
            return;
        // If a seek is in progress, store this as the next target
        if (this.isSeekInProgress) {
            this.nextSeekTarget = timestamp;
            return;
        }
        try {
            this.isSeekInProgress = true;
            this.emit('seeking', timestamp);
            // Update position tracking
            this.currentPosition = timestamp;
            this.startTime = Date.now();
            this.totalPausedTime = 0;
            this.lastPauseTime = undefined;
            // Pause playback and cleanup
            this.udp.mediaConnection.setSpeaking(false);
            await this.cleanupCurrentPlayback();
            // Start new stream
            await this.startNewStream(timestamp / 1000);
            // Resume playback
            this.udp.mediaConnection.setSpeaking(true);
            this.emit('seeked', timestamp);
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
        finally {
            this.isSeekInProgress = false;
            // Check if there's another seek waiting
            if (this.nextSeekTarget !== undefined) {
                const nextTarget = this.nextSeekTarget;
                this.nextSeekTarget = undefined;
                await this.seek(nextTarget);
            }
        }
    }
    pause() {
        if (this.isDestroyed || this.isPaused)
            return;
        this.isPaused = true;
        this.lastPauseTime = Date.now();
        this.currentPosition = this.getCurrentPosition();
        this.videoStream?.pause();
        this.audioStream?.pause();
        this.udp.mediaConnection.setSpeaking(false);
    }
    resume() {
        if (this.isDestroyed || !this.isPaused)
            return;
        this.isPaused = false;
        if (this.lastPauseTime) {
            this.totalPausedTime += Date.now() - this.lastPauseTime;
            this.lastPauseTime = undefined;
        }
        this.videoStream?.resume();
        this.audioStream?.resume();
        this.udp.mediaConnection.setSpeaking(true);
    }
    async stop() {
        if (this.isDestroyed)
            return;
        this.isDestroyed = true;
        await this.cleanupCurrentPlayback();
        this.streamer.stopStream();
        this.udp.mediaConnection.setSpeaking(false);
        this.udp.mediaConnection.setVideoStatus(false);
        this.emit('stopped');
    }
}
export async function playStream(dir, input, streamer, options = {}) {
    if (!streamer.voiceConnection) {
        throw new Error("Bot is not connected to a voice channel");
    }
    // Setup demuxer first
    const demuxResult = await demux(input);
    if (!demuxResult.video) {
        throw new Error("No video stream in media");
    }
    const videoCodecMap = {
        [AVCodecID.AV_CODEC_ID_H264]: "H264",
        [AVCodecID.AV_CODEC_ID_H265]: "H265",
        [AVCodecID.AV_CODEC_ID_VP8]: "VP8",
        [AVCodecID.AV_CODEC_ID_VP9]: "VP9",
        [AVCodecID.AV_CODEC_ID_AV1]: "AV1"
    };
    const defaultOptions = {
        type: "go-live",
        width: demuxResult.video.width,
        height: demuxResult.video.height,
        frameRate: demuxResult.video.framerate_num / demuxResult.video.framerate_den,
        rtcpSenderReportEnabled: true,
        forceChacha20Encryption: false
    };
    function mergeOptions(opts) {
        return {
            type: opts.type ?? defaultOptions.type,
            width: isFiniteNonZero(opts.width) && opts.width > 0
                ? Math.round(opts.width)
                : defaultOptions.width,
            height: isFiniteNonZero(opts.height) && opts.height > 0
                ? Math.round(opts.height)
                : defaultOptions.height,
            frameRate: Math.round(isFiniteNonZero(opts.frameRate) && opts.frameRate > 0
                ? Math.round(opts.frameRate)
                : defaultOptions.frameRate),
            rtcpSenderReportEnabled: opts.rtcpSenderReportEnabled ?? defaultOptions.rtcpSenderReportEnabled,
            forceChacha20Encryption: opts.forceChacha20Encryption ?? defaultOptions.forceChacha20Encryption
        };
    }
    const mergedOptions = mergeOptions(options);
    // Create UDP connection
    let udp;
    let stopStream;
    if (options.type === "camera") {
        udp = streamer.voiceConnection.udp;
        streamer.signalVideo(true);
        stopStream = () => streamer.signalVideo(false);
    }
    else {
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
    }
    else {
        controller.setStreams(vStream);
    }
    return controller;
}
