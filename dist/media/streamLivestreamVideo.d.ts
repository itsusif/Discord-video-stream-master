import ffmpeg from 'fluent-ffmpeg';
import { type Readable } from 'node:stream';
import type { MediaUdp } from '../client/voice/MediaUdp.js';
/**
 * @deprecated This API has a number of design issues that makes it error-prone
 * and hard to customize. Please use the new API instead.
 *
 * See https://github.com/dank074/Discord-video-stream/pull/125 for information
 * on the new API and example usage.
 */
export declare function streamLivestreamVideo(input: string | Readable, mediaUdp: MediaUdp, includeAudio?: boolean, customHeaders?: Record<string, string>): any;
export declare function getInputMetadata(input: string | Readable): Promise<ffmpeg.FfprobeData>;
export declare function inputHasAudio(metadata: ffmpeg.FfprobeData): any;
export declare function inputHasVideo(metadata: ffmpeg.FfprobeData): any;
