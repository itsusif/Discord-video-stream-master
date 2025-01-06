import type { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";
/**
 * VP8 payload format
 *
 */
export declare class VideoPacketizerVP8 extends BaseMediaPacketizer {
    private _pictureId;
    constructor(connection: MediaUdp);
    private incrementPictureId;
    sendFrame(frame: Buffer, frametime: number): Promise<void>;
    createPacket(chunk: Buffer, isLastPacket?: boolean, isFirstPacket?: boolean): Promise<Buffer>;
    onFrameSent(packetsSent: number, bytesSent: number, frametime: number): Promise<void>;
    private makeChunk;
}
