import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";
import { CodecPayloadType } from "../voice/BaseMediaConnection.js";
export class AudioPacketizer extends BaseMediaPacketizer {
    constructor(connection) {
        super(connection, CodecPayloadType.opus.payload_type);
        this.srInterval = 5 * 1000 / 20; // ~5 seconds for 20ms frame time
    }
    async sendFrame(frame, frametime) {
        super.sendFrame(frame, frametime);
        const packet = await this.createPacket(frame);
        this.mediaUdp.sendPacket(packet);
        this.onFrameSent(packet.length, frametime);
    }
    async createPacket(chunk) {
        const header = this.makeRtpHeader();
        const [ciphertext, nonceBuffer] = await this.encryptData(chunk, header);
        return Buffer.concat([header, ciphertext, nonceBuffer.subarray(0, 4)]);
    }
    async onFrameSent(bytesSent, frametime) {
        await super.onFrameSent(1, bytesSent, frametime);
        this.incrementTimestamp(frametime * (48000 / 1000));
    }
}
