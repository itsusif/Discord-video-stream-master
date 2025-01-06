import type { MediaUdp } from "../voice/MediaUdp.js";
export declare class BaseMediaPacketizer {
    private _loggerRtcpSr;
    private _ssrc?;
    private _payloadType;
    private _mtu;
    private _sequence;
    private _timestamp;
    private _totalBytes;
    private _totalPackets;
    private _prevTotalPackets;
    private _lastPacketTime;
    private _srInterval;
    private _mediaUdp;
    private _extensionEnabled;
    constructor(connection: MediaUdp, payloadType: number, extensionEnabled?: boolean);
    get ssrc(): number | undefined;
    set ssrc(value: number);
    /**
     * The interval (number of packets) between 2 consecutive RTCP Sender
     * Report packets
     */
    get srInterval(): number;
    set srInterval(interval: number);
    sendFrame(frame: Buffer, frametime: number): Promise<void>;
    onFrameSent(packetsSent: number, bytesSent: number, frametime: number): Promise<void>;
    /**
     * Partitions a buffer into chunks of length this.mtu
     * @param data buffer to be partitioned
     * @returns array of chunks
     */
    partitionDataMTUSizedChunks(data: Buffer): Buffer[];
    getNewSequence(): number;
    incrementTimestamp(incrementBy: number): void;
    makeRtpHeader(isLastPacket?: boolean): Buffer;
    makeRtcpSenderReport(): Promise<Buffer>;
    /**
     * Creates a one-byte extension header
     * https://www.rfc-editor.org/rfc/rfc5285#section-4.2
     * @returns extension header
     */
    createExtensionHeader(extensions: {
        id: number;
        len: number;
        val: number;
    }[]): Buffer;
    /**
     * Creates a extension payload in one-byte format according to https://www.rfc-editor.org/rfc/rfc7941.html#section-4.1.1
     * Discord seems to send this extension on every video packet. The extension ids for Discord can be found by connecting
     * to their webrtc gateway using the webclient and the client will send an SDP offer containing it
     * @returns extension payload
     */
    createExtensionPayload(extensions: {
        id: number;
        len: number;
        val: number;
    }[]): Buffer;
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
    encryptData(plaintext: Buffer, additionalData: Buffer): Promise<[Buffer, Buffer]>;
    get mediaUdp(): MediaUdp;
    get mtu(): number;
}
