import type { BaseMediaPacketizer } from '../packet/BaseMediaPacketizer.js';
import type { BaseMediaConnection } from './BaseMediaConnection.js';
export declare class MediaUdp {
    private _mediaConnection;
    private _socket;
    private _ready;
    private _audioPacketizer?;
    private _videoPacketizer?;
    private _ip?;
    private _port?;
    constructor(voiceConnection: BaseMediaConnection);
    get audioPacketizer(): BaseMediaPacketizer | undefined;
    get videoPacketizer(): BaseMediaPacketizer | undefined;
    get mediaConnection(): BaseMediaConnection;
    get ip(): string | undefined;
    get port(): number | undefined;
    sendAudioFrame(frame: Buffer, frametime: number): Promise<void>;
    sendVideoFrame(frame: Buffer, frametime: number): Promise<void>;
    updatePacketizer(): void;
    sendPacket(packet: Buffer): Promise<void>;
    handleIncoming(buf: unknown): void;
    get ready(): boolean;
    set ready(val: boolean);
    stop(): void;
    createUdp(): Promise<void>;
}
