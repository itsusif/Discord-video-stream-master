import sp from "sodium-plus";
import { Log } from "debug-level";
import { max_int16bit, max_int32bit } from "../../utils.js";
const { SodiumPlus, CryptographyKey } = sp;
const ntpEpoch = new Date("Jan 01 1900 GMT").getTime();
let sodium;
export class BaseMediaPacketizer {
    constructor(connection, payloadType, extensionEnabled = false) {
        this._loggerRtcpSr = new Log("packetizer:rtcp-sr");
        this._mediaUdp = connection;
        this._payloadType = payloadType;
        this._sequence = 0;
        this._timestamp = 0;
        this._totalBytes = 0;
        this._totalPackets = 0;
        this._prevTotalPackets = 0;
        this._lastPacketTime = 0;
        this._mtu = 1200;
        this._extensionEnabled = extensionEnabled;
        this._srInterval = 512; // Sane fallback value for interval
    }
    get ssrc() {
        return this._ssrc;
    }
    set ssrc(value) {
        this._ssrc = value;
        this._totalBytes = this._totalPackets = this._prevTotalPackets = 0;
    }
    /**
     * The interval (number of packets) between 2 consecutive RTCP Sender
     * Report packets
     */
    get srInterval() {
        return this._srInterval;
    }
    set srInterval(interval) {
        this._srInterval = interval;
    }
    async sendFrame(frame, frametime) {
        // override this
        this._lastPacketTime = Date.now();
    }
    async onFrameSent(packetsSent, bytesSent, frametime) {
        if (!this._mediaUdp.mediaConnection.streamOptions.rtcpSenderReportEnabled)
            return;
        this._totalPackets = this._totalPackets + packetsSent;
        this._totalBytes = (this._totalBytes + bytesSent) % max_int32bit;
        // Not using modulo here, since the number of packet sent might not be
        // exactly a multiple of the interval
        if (Math.floor(this._totalPackets / this._srInterval) - Math.floor(this._prevTotalPackets / this._srInterval) > 0) {
            const senderReport = await this.makeRtcpSenderReport();
            this._mediaUdp.sendPacket(senderReport);
            this._prevTotalPackets = this._totalPackets;
            this._loggerRtcpSr.debug({
                stats: {
                    ssrc: this._ssrc,
                    timestamp: this._timestamp,
                    totalPackets: this._totalPackets,
                    totalBytes: this._totalBytes
                }
            }, `Sent RTCP sender report for SSRC ${this._ssrc}`);
        }
    }
    /**
     * Partitions a buffer into chunks of length this.mtu
     * @param data buffer to be partitioned
     * @returns array of chunks
     */
    partitionDataMTUSizedChunks(data) {
        let i = 0;
        let len = data.length;
        const out = [];
        while (len > 0) {
            const size = Math.min(len, this._mtu);
            out.push(data.subarray(i, i + size));
            len -= size;
            i += size;
        }
        return out;
    }
    getNewSequence() {
        this._sequence = (this._sequence + 1) % max_int16bit;
        return this._sequence;
    }
    incrementTimestamp(incrementBy) {
        this._timestamp = (this._timestamp + incrementBy) % max_int32bit;
    }
    makeRtpHeader(isLastPacket = true) {
        if (!this._ssrc)
            throw new Error("SSRC is not set");
        const packetHeader = Buffer.alloc(12);
        packetHeader[0] = 2 << 6 | ((this._extensionEnabled ? 1 : 0) << 4); // set version and flags
        packetHeader[1] = this._payloadType; // set packet payload
        if (isLastPacket)
            packetHeader[1] |= 0b10000000; // mark M bit if last frame
        packetHeader.writeUIntBE(this.getNewSequence(), 2, 2);
        packetHeader.writeUIntBE(this._timestamp, 4, 4);
        packetHeader.writeUIntBE(this._ssrc, 8, 4);
        return packetHeader;
    }
    async makeRtcpSenderReport() {
        if (!this._ssrc)
            throw new Error("SSRC is not set");
        const packetHeader = Buffer.allocUnsafe(8);
        packetHeader[0] = 0x80; // RFC1889 v2, no padding, no reception report count
        packetHeader[1] = 0xc8; // Type: Sender Report (200)
        // Packet length (always 0x06 for some reason)
        packetHeader[2] = 0x00;
        packetHeader[3] = 0x06;
        packetHeader.writeUInt32BE(this._ssrc, 4);
        const senderReport = Buffer.allocUnsafe(20);
        // Convert from floating point to 32.32 fixed point
        // Convert each part separately to reduce precision loss
        const ntpTimestamp = (this._lastPacketTime - ntpEpoch) / 1000;
        const ntpTimestampMsw = Math.floor(ntpTimestamp);
        const ntpTimestampLsw = Math.round((ntpTimestamp - ntpTimestampMsw) * max_int32bit);
        senderReport.writeUInt32BE(ntpTimestampMsw, 0);
        senderReport.writeUInt32BE(ntpTimestampLsw, 4);
        senderReport.writeUInt32BE(this._timestamp, 8);
        senderReport.writeUInt32BE(this._totalPackets % max_int32bit, 12);
        senderReport.writeUInt32BE(this._totalBytes, 16);
        const [ciphertext, nonceBuffer] = await this.encryptData(senderReport, packetHeader);
        return Buffer.concat([
            packetHeader, ciphertext,
            nonceBuffer.subarray(0, 4)
        ]);
    }
    /**
     * Creates a one-byte extension header
     * https://www.rfc-editor.org/rfc/rfc5285#section-4.2
     * @returns extension header
     */
    createExtensionHeader(extensions) {
        /**
         *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
            +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
            |      defined by profile       |           length              |
            +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
        */
        const profile = Buffer.alloc(4);
        profile[0] = 0xBE;
        profile[1] = 0xDE;
        profile.writeInt16BE(extensions.length, 2); // extension count
        return profile;
    }
    /**
     * Creates a extension payload in one-byte format according to https://www.rfc-editor.org/rfc/rfc7941.html#section-4.1.1
     * Discord seems to send this extension on every video packet. The extension ids for Discord can be found by connecting
     * to their webrtc gateway using the webclient and the client will send an SDP offer containing it
     * @returns extension payload
     */
    createExtensionPayload(extensions) {
        const extensionsData = [];
        for (const ext of extensions) {
            /**
             * EXTENSION DATA - each extension payload is 32 bits
             */
            const data = Buffer.alloc(4);
            // https://webrtc.googlesource.com/src/+/refs/heads/main/docs/native-code/rtp-hdrext/playout-delay
            if (ext.id === 5) {
                /**
                 *  0 1 2 3 4 5 6 7
                    +-+-+-+-+-+-+-+-+
                    |  ID   |  len  |
                    +-+-+-+-+-+-+-+-+

                where len = actual length - 1
                */
                data[0] = (ext.id & 0b00001111) << 4;
                data[0] |= ((ext.len - 1) & 0b00001111);
                /**  Specific to type playout-delay
                 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4
                    +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
                    |       MIN delay       |       MAX delay       |
                    +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
                */
                data.writeUIntBE(ext.val, 1, 2); // not quite but its 0 anyway
            }
            extensionsData.push(data);
        }
        return Buffer.concat(extensionsData);
    }
    /**
     * Encrypt packet payload. Encrpyed Payload is determined to be
     * according to https://tools.ietf.org/html/rfc3711#section-3.1
     * and https://datatracker.ietf.org/doc/html/rfc7714#section-8.2
     *
     * Associated Data: The version V (2 bits), padding flag P (1 bit),
                       extension flag X (1 bit), Contributing Source
                       (CSRC) count CC (4 bits), marker M (1 bit),
                       Payload Type PT (7 bits), sequence number
                       (16 bits), timestamp (32 bits), SSRC (32 bits),
                       optional CSRC identifiers (32 bits each), and
                       optional RTP extension (variable length).

      Plaintext:       The RTP payload (variable length), RTP padding
                       (if used, variable length), and RTP pad count (if
                       used, 1 octet).

      Raw Data:        The optional variable-length SRTP Master Key
                       Identifier (MKI) and SRTP authentication tag
                       (whose use is NOT RECOMMENDED).  These fields are
                       appended after encryption has been performed.

        0                   1                   2                   3
        0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    A  |V=2|P|X|  CC   |M|     PT      |       sequence number         |
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    A  |                           timestamp                           |
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    A  |           synchronization source (SSRC) identifier            |
       +=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+=+
    A  |      contributing source (CSRC) identifiers (optional)        |
    A  |                               ....                            |
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    A  |                   RTP extension header (OPTIONAL)             |
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
    P  |                          payload  ...                         |
    P  |                               +-------------------------------+
    P  |                               | RTP padding   | RTP pad count |
       +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+

                P = Plaintext (to be encrypted and authenticated)
                A = Associated Data (to be authenticated only)
     * @param plaintext
     * @param nonceBuffer
     * @param additionalData
     * @returns ciphertext
     */
    encryptData(plaintext, additionalData) {
        const encryptor = this._mediaUdp.mediaConnection.transportEncryptor;
        if (!encryptor)
            throw new Error("Transport encryptor not defined. Did you forget to select protocol?");
        return encryptor.encrypt(plaintext, additionalData);
    }
    get mediaUdp() {
        return this._mediaUdp;
    }
    get mtu() {
        return this._mtu;
    }
}
