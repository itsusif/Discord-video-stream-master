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
        this.seekTarget = 0;
        this.isSeekInProgress = false;
        this.isMuted = false;
        this.lastPts = 0;
        this.seekOffset = 0;
        this.isPaused = false;
        this.totalPausedTime = 0;
        this.streamer = streamer;
        this.udp = udp;
        this.inputSource = inputSource;
        this.options = options;
        this.startTime = Date.now();
    }
    setupPtsTracking(vStream) {
        const ptsHandler = () => {
            if (vStream.pts === undefined)
                return;
            // Initialize startPts if not set
            if (this.startPts === undefined) {
                this.startPts = vStream.pts;
                this.startTime = Date.now();
                this.lastPts = vStream.pts;
                return;
            }
            // Update last known PTS
            this.lastPts = vStream.pts;
            if (this.isSeekInProgress) {
                console.log(`Seeking to: ${this.nextSeekTarget}, Current: ${this.getCurrentPosition()}`);
                if (Math.abs(this.getCurrentPosition() - (this.nextSeekTarget || 0)) < 1000) {
                    this.emit('seeked', this.getCurrentPosition());
                }
            }
            // Emit position update event
            this.emit('positionUpdate', this.getCurrentPosition());
        };
        vStream.on('pts', ptsHandler);
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
    setStreams(videoStream, audioStream) {
        // Clean up old streams
        this.cleanupStreams();
        this.videoStream = videoStream;
        this.audioStream = audioStream;
        // Set up PTS tracking
        this.setupPtsTracking(videoStream);
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
        command.on('error', (err) => {
            if (!err.message.includes('SIGKILL')) {
                this.emit('error', err);
            }
        });
        this.currentCommand = command;
        this.currentOutput = output;
        const { video, audio } = await demux(output);
        if (!video)
            throw new Error("No video stream found");
        await this.setupStreams(video, audio);
        return { video, audio };
    }
    setupStreams(video, audio) {
        const vStream = new VideoStream(this.udp, false);
        video.stream.pipe(vStream);
        this.setupPtsTracking(vStream);
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
        this.isSeekInProgress = false;
    }
    mute() {
        if (this.isDestroyed || this.isMuted)
            return;
        this.isMuted = true;
        // Pause audio stream if exists
        // if (this.audioStream) {
        //     this.audioStream.pause();
        // }
        this.udp.mediaConnection.setSpeaking(false);
        this.emit('muted');
    }
    unmute() {
        if (this.isDestroyed || !this.isMuted)
            return;
        this.isMuted = false;
        // Resume audio stream if exists
        // if (this.audioStream) {
        //     this.audioStream.resume();
        // }
        this.udp.mediaConnection.setSpeaking(true);
        this.emit('unmuted');
    }
    toggleMute() {
        if (this.isMuted) {
            this.unmute();
        }
        else {
            this.mute();
        }
    }
    isMutedState() {
        return this.isMuted;
    }
    async seek(timestamp) {
        if (this.isDestroyed)
            return;
        timestamp = Math.max(0, timestamp);
        if (this.isSeekInProgress) {
            return;
        }
        try {
            this.isSeekInProgress = true;
            this.nextSeekTarget = timestamp;
            this.emit('seeking', timestamp);
            // Update seek offset
            this.seekOffset = timestamp;
            this.startPts = undefined;
            this.startTime = undefined;
            this.totalPausedTime = 0;
            // Pause playback and cleanup
            this.udp.mediaConnection.setSpeaking(false);
            await this.cleanupCurrentPlayback();
            // Start new stream with seek
            await this.startNewStream(timestamp / 1000);
            // Resume playback
            this.udp.mediaConnection.setSpeaking(true);
            this.isSeekInProgress = false;
        }
        catch (error) {
            this.isSeekInProgress = false;
            this.emit('error', error);
            throw error;
        }
    }
    getCurrentPosition() {
        if (!this.startTime || !this.startPts) {
            return this.seekOffset;
        }
        if (this.isPaused) {
            return this.lastPts - this.startPts + this.seekOffset;
        }
        const now = Date.now();
        const pausedDuration = this.totalPausedTime + (this.pauseStartTime ? (now - this.pauseStartTime) : 0);
        const elapsedTime = now - this.startTime - pausedDuration;
        const ptsDelta = this.lastPts - this.startPts;
        return Math.max(0, ptsDelta + this.seekOffset);
    }
    seekRelative(seconds) {
        return this.seek(this.getCurrentPosition() + (seconds * 1000));
    }
    pause() {
        if (this.isDestroyed || this.isPaused)
            return;
        this.isPaused = true;
        this.pauseStartTime = Date.now();
        this.videoStream?.pause();
        this.audioStream?.pause();
        this.udp.mediaConnection.setSpeaking(false);
    }
    resume() {
        if (this.isDestroyed || !this.isPaused)
            return;
        this.isPaused = false;
        if (this.pauseStartTime) {
            this.totalPausedTime += Date.now() - this.pauseStartTime;
            this.pauseStartTime = undefined;
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
