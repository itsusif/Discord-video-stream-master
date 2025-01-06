import { extensions, max_int16bit } from "../../utils.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";
import { CodecPayloadType } from "../voice/BaseMediaConnection.js";
/**
 * VP8 payload format
 *
 */
export class VideoPacketizerVP8 extends BaseMediaPacketizer {
    constructor(connection) {
        super(connection, CodecPayloadType.VP8.payload_type, true);
        this._pictureId = 0;
        this.srInterval = 5 * connection.mediaConnection.streamOptions.fps * 3; // ~5 seconds, assuming ~3 packets per frame
    }
    incrementPictureId() {
        this._pictureId = (this._pictureId + 1) % max_int16bit;
    }
    async sendFrame(frame, frametime) {
        super.sendFrame(frame, frametime);
        const data = this.partitionDataMTUSizedChunks(frame);
        let bytesSent = 0;
        const encryptedPackets = data.map((chunk, i) => this.createPacket(chunk, i === (data.length - 1), i === 0));
        for (const packet of await Promise.all(encryptedPackets)) {
            this.mediaUdp.sendPacket(packet);
            bytesSent += packet.length;
        }
        await this.onFrameSent(data.length, bytesSent, frametime);
    }
    async createPacket(chunk, isLastPacket = true, isFirstPacket = true) {
        if (chunk.length > this.mtu)
            throw Error('error packetizing video frame: frame is larger than mtu');
        const packetHeader = Buffer.concat([this.makeRtpHeader(isLastPacket), this.createExtensionHeader(extensions)]);
        const packetData = Buffer.concat([this.createExtensionPayload(extensions), this.makeChunk(chunk, isFirstPacket)]);
        // nonce buffer used for encryption. 4 bytes are appended to end of packet
        const [ciphertext, nonceBuffer] = await this.encryptData(packetData, packetHeader);
        return Buffer.concat([packetHeader, ciphertext, nonceBuffer.subarray(0, 4)]);
    }
    async onFrameSent(packetsSent, bytesSent, frametime) {
        await super.onFrameSent(packetsSent, bytesSent, frametime);
        // video RTP packet timestamp incremental value = 90,000Hz / fps
        this.incrementTimestamp(90000 / 1000 * frametime);
        this.incrementPictureId();
    }
    makeChunk(frameData, isFirstPacket) {
        // vp8 payload descriptor
        const payloadDescriptorBuf = Buffer.alloc(2);
        payloadDescriptorBuf[0] = 0x80;
        payloadDescriptorBuf[1] = 0x80;
        if (isFirstPacket) {
            payloadDescriptorBuf[0] |= 0b00010000; // mark S bit, indicates start of frame
        }
        // vp8 pictureid payload extension
        const pictureIdBuf = Buffer.alloc(2);
        pictureIdBuf.writeUIntBE(this._pictureId, 0, 2);
        pictureIdBuf[0] |= 0b10000000;
        return Buffer.concat([payloadDescriptorBuf, pictureIdBuf, frameData]);
    }
}
