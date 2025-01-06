import { AVCodecID } from "./LibavCodecId.js";
import type { Readable } from "node:stream";
export declare function demux(input: Readable): Promise<{
    video: {
        stream: Readable;
        index: number;
        codec: AVCodecID;
        width: number;
        height: number;
        framerate_num: number;
        framerate_den: number;
        extradata?: unknown;
    } | undefined;
    audio: {
        stream: Readable;
        index: number;
        codec: AVCodecID;
        sample_rate: number;
    } | undefined;
}>;
