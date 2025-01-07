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
    constructor(demuxer, udp, stopStreamFn) {
        super();
        this.demuxer = demuxer;
        this.udp = udp;
        this.stopStreamFn = stopStreamFn;
    }
    setStreams(videoStream, audioStream) {
        this.videoStream = videoStream;
        this.audioStream = audioStream;
        videoStream.on('finish', () => {
            this.emit('finished');
            this.stop();
        });
    }
    async seek(time) {
        try {
            this.emit('seeking', time);
            // Destroy current streams
            this.videoStream?.destroy();
            this.audioStream?.destroy();
            // Seek in demuxer
            await this.demuxer.seek(time);
            // Get new streams after seek
            const { video, audio } = await demux(this.demuxer);
            if (!video)
                throw new Error("No video stream after seek");
            // Create new streams
            const vStream = new VideoStream(this.udp);
            video.stream.pipe(vStream);
            if (audio) {
                const aStream = new AudioStream(this.udp);
                audio.stream.pipe(aStream);
                vStream.syncStream = aStream;
                aStream.syncStream = vStream;
                this.setStreams(vStream, aStream);
            }
            else {
                this.setStreams(vStream);
            }
            this.emit('seeked', time);
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    pause() {
        this.videoStream?.pause();
        this.audioStream?.pause();
        this.udp.mediaConnection.setSpeaking(false);
    }
    resume() {
        this.videoStream?.resume();
        this.audioStream?.resume();
        this.udp.mediaConnection.setSpeaking(true);
    }
    stop() {
        this.videoStream?.destroy();
        this.audioStream?.destroy();
        this.stopStreamFn();
        this.udp.mediaConnection.setSpeaking(false);
        this.udp.mediaConnection.setVideoStatus(false);
        this.emit('stopped');
    }
}
export async function playStream(input, streamer, options = {}) {
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
    const controller = new StreamController(demuxResult, udp, stopStream);
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
