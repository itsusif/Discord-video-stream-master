import type { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";
export declare class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection: MediaUdp);
    sendFrame(frame: Buffer, frametime: number): Promise<void>;
    createPacket(chunk: Buffer): Promise<Buffer>;
    onFrameSent(bytesSent: number, frametime: number): Promise<void>;
}
