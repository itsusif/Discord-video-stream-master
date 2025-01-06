import { Writable } from "node:stream";
import type { Packet } from "@libav.js/variant-webcodecs";
export declare class BaseMediaStream extends Writable {
    private _pts?;
    private _syncTolerance;
    private _loggerSend;
    private _loggerSync;
    private _loggerSleep;
    private _isPaused;
    private _pauseStartTime?;
    private _totalPausedTime;
    private _seekTime?;
    private _seekTargetPts?;
    private _noSleep;
    private _startTime?;
    private _startPts?;
    private _baseTime?;
    private _currentPacket?;
    syncStream?: BaseMediaStream;
    constructor(type: string, noSleep?: boolean);
    get pts(): number | undefined;
    get isPaused(): boolean;
    get syncTolerance(): number;
    set syncTolerance(n: number);
    protected _waitForOtherStream(): Promise<void>;
    protected _sendFrame(frame: Buffer, frametime: number): Promise<void>;
    private _shouldDropFrame;
    _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void): Promise<void>;
    _destroy(error: Error | null, callback: (error?: Error | null) => void): void;
    pause(): this;
    resume(): this;
    /**
     * Seek to a specific timestamp in milliseconds
     * @param targetMs Target timestamp in milliseconds
     */
    seek(targetMs: number): this;
    resetPauseState(): void;
    getCurrentPacket(): Packet | undefined;
}
