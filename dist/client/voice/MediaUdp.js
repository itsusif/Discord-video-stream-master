import udpCon from 'node:dgram';
import { isIPv4 } from 'node:net';
import { AudioPacketizer } from '../packet/AudioPacketizer.js';
import { VideoPacketizerH264, VideoPacketizerH265 } from '../packet/VideoPacketizerAnnexB.js';
import { VideoPacketizerVP8 } from '../packet/VideoPacketizerVP8.js';
import { normalizeVideoCodec } from '../../utils.js';
// credit to discord.js
function parseLocalPacket(message) {
    const packet = Buffer.from(message);
    const ip = packet.subarray(8, packet.indexOf(0, 8)).toString('utf8');
    if (!isIPv4(ip)) {
        throw new Error('Malformed IP address');
    }
    const port = packet.readUInt16BE(packet.length - 2);
    return { ip, port };
}
export class MediaUdp {
    constructor(voiceConnection) {
        this._socket = null;
        this._ready = false;
        this._mediaConnection = voiceConnection;
    }
    get audioPacketizer() {
        return this._audioPacketizer;
    }
    get videoPacketizer() {
        // This will never be undefined anyway, so it's safe
        return this._videoPacketizer;
    }
    get mediaConnection() {
        return this._mediaConnection;
    }
    get ip() {
        return this._ip;
    }
    get port() {
        return this._port;
    }
    async sendAudioFrame(frame, frametime) {
        if (!this.ready)
            return;
        await this.audioPacketizer?.sendFrame(frame, frametime);
    }
    async sendVideoFrame(frame, frametime) {
        if (!this.ready)
            return;
        await this.videoPacketizer?.sendFrame(frame, frametime);
    }
    updatePacketizer() {
        if (!this.mediaConnection.webRtcParams)
            throw new Error("WebRTC connection not ready");
        const { audioSsrc, videoSsrc } = this.mediaConnection.webRtcParams;
        this._audioPacketizer = new AudioPacketizer(this);
        this._audioPacketizer.ssrc = audioSsrc;
        const videoCodec = normalizeVideoCodec(this.mediaConnection.streamOptions.videoCodec);
        switch (videoCodec) {
            case "H264":
                this._videoPacketizer = new VideoPacketizerH264(this);
                break;
            case "H265":
                this._videoPacketizer = new VideoPacketizerH265(this);
                break;
            case "VP8":
                this._videoPacketizer = new VideoPacketizerVP8(this);
                break;
            default:
                throw new Error(`Packetizer not implemented for ${videoCodec}`);
        }
        this._videoPacketizer.ssrc = videoSsrc;
    }
    sendPacket(packet) {
        if (!this.mediaConnection.webRtcParams)
            throw new Error("WebRTC connection not ready");
        const { address, port } = this.mediaConnection.webRtcParams;
        return new Promise((resolve, reject) => {
            try {
                this._socket?.send(packet, 0, packet.length, port, address, (error, bytes) => {
                    if (error) {
                        console.log("ERROR", error);
                        reject(error);
                    }
                    resolve();
                });
            }
            catch (e) {
                reject(e);
            }
        });
    }
    handleIncoming(buf) {
        //console.log("RECEIVED PACKET", buf);
    }
    get ready() {
        return this._ready;
    }
    set ready(val) {
        this._ready = val;
    }
    stop() {
        try {
            this.ready = false;
            this._socket?.disconnect();
        }
        catch (e) { }
    }
    createUdp() {
        if (!this.mediaConnection.webRtcParams)
            throw new Error("WebRTC connection not ready");
        const { audioSsrc, address, port } = this.mediaConnection.webRtcParams;
        return new Promise((resolve, reject) => {
            this._socket = udpCon.createSocket('udp4');
            this._socket.on('error', (error) => {
                console.error("Error connecting to media udp server", error);
                reject(error);
            });
            this._socket.once('message', (message) => {
                if (message.readUInt16BE(0) !== 2) {
                    reject('wrong handshake packet for udp');
                }
                try {
                    const packet = parseLocalPacket(message);
                    this._ip = packet.ip;
                    this._port = packet.port;
                    this._ready = true;
                }
                catch (e) {
                    reject(e);
                }
                resolve();
                this._socket?.on('message', this.handleIncoming);
            });
            const blank = Buffer.alloc(74);
            blank.writeUInt16BE(1, 0);
            blank.writeUInt16BE(70, 2);
            blank.writeUInt32BE(audioSsrc, 4);
            this._socket.send(blank, 0, blank.length, port, address, (error, bytes) => {
                if (error) {
                    reject(error);
                }
            });
        });
    }
}
