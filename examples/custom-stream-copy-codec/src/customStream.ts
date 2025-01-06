import {
    AudioStream,
    H264NalSplitter,
    MediaUdp,
    VideoStream,
} from "@dank074/discord-video-stream";
import { Readable } from "node:stream";
import ffmpeg from "fluent-ffmpeg";
import prism from "prism-media";
import { StreamOutput } from "@dank074/fluent-ffmpeg-multistream-ts";

export let customFfmpegCommand: ffmpeg.FfmpegCommand;

export function customStreamVideo(
    input: string | Readable,
    mediaUdp: MediaUdp,
    includeAudio = true,
) {
    return new Promise<string>((resolve, reject) => {
        const streamOpts = mediaUdp.mediaConnection.streamOptions;

        const videoStream: VideoStream = new VideoStream(
            mediaUdp,
            streamOpts.fps
        );

        const videoOutput = new H264NalSplitter();

        const headers: map = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.3",
            Connection: "keep-alive",
        };

        let isHttpUrl = false;
        let isHls = false;

        if (typeof input === "string") {
            isHttpUrl = input.startsWith("http") || input.startsWith("https");
            isHls = input.includes("m3u");
        }

        try {
            customFfmpegCommand = ffmpeg(input)
                .addOption("-loglevel", "0")
                .addOption("-fflags", "nobuffer")
                .addOption("-analyzeduration", "0")
                .on("end", () => {
                    customFfmpegCommand = undefined;
                    resolve("video ended");
                })
                .on("error", (err, stdout, stderr) => {
                    customFfmpegCommand = undefined;
                    reject("cannot play video " + err.message);
                })
                .on("stderr", console.error);

            customFfmpegCommand
                .output(StreamOutput(videoOutput).url, { end: false })
                .noAudio()
                .videoCodec("copy")
                .format("h264")
                .outputOptions(["-bsf:v h264_metadata=aud=insert"]);

            videoOutput.pipe(videoStream, { end: false });

            if (includeAudio) {
                const audioStream: AudioStream = new AudioStream(mediaUdp);

                // make opus stream
                const opus = new prism.opus.Encoder({
                    channels: 2,
                    rate: 48000,
                    frameSize: 960,
                });

                customFfmpegCommand
                    .output(StreamOutput(opus).url, { end: false })
                    .noVideo()
                    .audioChannels(2)
                    .audioFrequency(48000)
                    //.audioBitrate('128k')
                    .format("s16le");

                opus.pipe(audioStream, { end: false });
            }

            if (streamOpts.hardwareAcceleratedDecoding)
                customFfmpegCommand.inputOption("-hwaccel", "auto");

            if (isHttpUrl) {
                customFfmpegCommand.inputOption(
                    "-headers",
                    Object.keys(headers)
                        .map((key) => key + ": " + headers[key])
                        .join("\r\n")
                );
                if (!isHls) {
                    customFfmpegCommand.inputOptions([
                        "-reconnect 1",
                        "-reconnect_at_eof 1",
                        "-reconnect_streamed 1",
                        "-reconnect_delay_max 4294",
                    ]);
                }
            }

            customFfmpegCommand.run();
        } catch (e) {
            //audioStream.end();
            //videoStream.end();
            customFfmpegCommand = undefined;
            reject("cannot play video " + e.message);
        }
    });
}

type map = {
    [key: string]: string;
};
