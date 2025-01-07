import { Log } from "debug-level";
import { setTimeout } from "node:timers/promises";
import { Writable } from "node:stream";
import { combineLoHi } from "./utils.js";
import type { Packet } from "@libav.js/variant-webcodecs";
import { EventEmitter } from "node:events";

export class BaseMediaStream extends Writable {
    private _pts?: number;
    private _syncTolerance = 5;
    private _loggerSend: Log;
    private _loggerSync: Log;
    private _loggerSleep: Log;
    private _isPaused: boolean = false;
    private _pauseStartTime?: number;
    private _totalPausedTime: number = 0;
    private _seekTarget?: number;
    private _emitter: EventEmitter;
    private _firstPts?: number;
    private _isBackwardSeek: boolean = false;
    private _packetBuffer: Packet[] = [];
    private _currentTime: number = 0;

    private _noSleep: boolean;
    private _startTime?: number;
    private _startPts?: number;

    public syncStream?: BaseMediaStream;
    
    constructor(type: string, noSleep = false) {
        super({ objectMode: true, highWaterMark: 0 });
        this._loggerSend = new Log(`stream:${type}:send`);
        this._loggerSync = new Log(`stream:${type}:sync`);
        this._loggerSleep = new Log(`stream:${type}:sleep`);
        this._noSleep = noSleep;
        this._emitter = new EventEmitter();
    }

    get pts(): number | undefined {
        return this._pts;
    }

    get currentTime(): number {
        return this._currentTime;
    }

    get isPaused(): boolean {
        return this._isPaused;
    }

    get syncTolerance() {
        return this._syncTolerance;
    }

    set syncTolerance(n: number) {
        if (n < 0) return;
        this._syncTolerance = n;
    }

    protected async _waitForOtherStream() {
        let i = 0;
        while (
            this.syncStream &&
            !this.syncStream.writableEnded &&
            this.syncStream.pts !== undefined &&
            this._pts !== undefined &&
            this._pts - this.syncStream.pts > this._syncTolerance
        ) {
            if (i === 0) {
                this._loggerSync.debug(
                    `Waiting for other stream (${this._pts} - ${this.syncStream._pts} > ${this._syncTolerance})`,
                );
            }
            await setTimeout(1);
            i = (i + 1) % 10;
        }
    }

    protected async _sendFrame(frame: Buffer, frametime: number): Promise<void> {
        throw new Error("Not implemented");
    }

    private _ptsToMs(packet: Packet): number {
        const { ptshi, pts, time_base_num, time_base_den } = packet;
        return combineLoHi(ptshi!, pts!) / time_base_den! * time_base_num! * 1000;
    }

    private _handleSeek(packet: Packet): boolean {
        if (this._seekTarget === undefined) return false;

        const framePts = this._ptsToMs(packet);
        
        // Initialize first PTS if not set
        if (this._firstPts === undefined) {
            this._firstPts = framePts;
        }
        
        // Calculate absolute time position
        const absoluteTime = framePts - (this._firstPts ?? 0);
        this._currentTime = absoluteTime;

        console.log(this._isBackwardSeek, absoluteTime, this._seekTarget);
        
        // Handle backward seek
        if (this._isBackwardSeek) {
            // Store packet if we haven't reached target yet
            if (absoluteTime > this._seekTarget) {
                this._packetBuffer.push(packet);
                return true;
            }
            // Found our target point, sort and prepare buffered packets
            this._isBackwardSeek = false;
            this._packetBuffer.sort((a, b) => this._ptsToMs(a) - this._ptsToMs(b));
            this._resetStreamState();
            return false;
        }

        // Handle forward seek
        if (absoluteTime < this._seekTarget) {
            return true;
        }

        this._seekTarget = undefined;
        this._resetStreamState();
        this._emitter.emit('seeked', absoluteTime);
        return false;
    }

    private _resetStreamState(): void {
        this._startTime = undefined;
        this._startPts = undefined;
        this.resetPauseState();
    }

    async _write(frame: Packet, _: BufferEncoding, callback: (error?: Error | null) => void) {
        try {
            this.emit('pts', this._pts);
            // Handle buffered packets from backward seek
            if (this._packetBuffer.length > 0 && !this._isBackwardSeek) {
                const packet = this._packetBuffer.shift();
                if (packet) {
                    await this._processPacket(packet);
                }
            }

            // Process current frame if not seeking backward or if at target
            if (!this._handleSeek(frame)) {
                await this._processPacket(frame);
            }

            callback(null);
        } catch (error) {
            callback(error as Error);
        }
    }

    private async _processPacket(packet: Packet): Promise<void> {
        const { data, durationhi, duration, time_base_num, time_base_den } = packet;
        const framePts = this._ptsToMs(packet);

        if (this._startTime === undefined) {
            this._startTime = performance.now();
            this._startPts = framePts;
        }

        while (this._isPaused) {
            await setTimeout(50);
        }

        await this._waitForOtherStream();

        const frametime = combineLoHi(durationhi!, duration!) / time_base_den! * time_base_num! * 1000;
        const start = performance.now();
        
        await this._sendFrame(Buffer.from(data), frametime);
        
        const end = performance.now();
        this._pts = framePts;
        this._currentTime = framePts - (this._firstPts ?? 0);

        const sendTime = end - start;
        const ratio = sendTime / frametime;

        // Logging...
        this._loggerSend.debug({
            stats: {
                pts: this._pts,
                currentTime: this._currentTime,
                frame_size: data.length,
                duration: sendTime,
                frametime
            }
        }, `Frame sent in ${sendTime.toFixed(2)}ms (${(ratio * 100).toFixed(2)}% frametime)`);

        if (ratio > 1) {
            this._loggerSend.warn({
                frame_size: data.length,
                duration: sendTime,
                frametime
            }, `Frame takes too long to send (${(ratio * 100).toFixed(2)}% frametime)`);
        }

        const now = performance.now();
        const adjustedNow = now - this._totalPausedTime;
        const sleep = Math.max(0, this._pts - (this._startPts ?? 0) - (adjustedNow - this._startTime!));
        
        this._loggerSleep.debug(`Sleeping for ${sleep}ms`);
        
        if (this._noSleep) {
            return;
        }
        
        await setTimeout(sleep);
    }

    _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        super._destroy(error, callback);
        this.syncStream = undefined;
        this._emitter.removeAllListeners();
        this._packetBuffer = [];
    }

    pause(): this {
        if (!this._isPaused) {
            this._isPaused = true;
            this._pauseStartTime = performance.now();
            this._loggerSend.debug('Stream paused');
        }
        return this;
    }

    resume(): this {
        if (this._isPaused) {
            this._isPaused = false;
            if (this._pauseStartTime) {
                this._totalPausedTime += performance.now() - this._pauseStartTime;
                this._pauseStartTime = undefined;
            }
            this._loggerSend.debug('Stream resumed');
        }
        return this;
    }

    seek(targetMs: number): this {
        if (targetMs < 0) return this;
        console.log(targetMs);
        
        
        this._loggerSend.debug(`Seeking to ${targetMs}ms`);
        this._emitter.emit('seeking', targetMs);
        
        // Determine seek direction
        this._isBackwardSeek = targetMs < this._currentTime;
        this._seekTarget = targetMs;
        
        // Clear packet buffer on new seek
        this._packetBuffer = [];
        
        if (this._isBackwardSeek) {
            this._loggerSend.debug('Performing backward seek');
        } else {
            this._loggerSend.debug('Performing forward seek');
        }
        
        return this;
    }

    onn(event: 'seeking' | 'seeked', listener: (timestamp: number) => void): this {
        this._emitter.on(event, listener);
        return this;
    }

    off(event: 'seeking' | 'seeked', listener: (timestamp: number) => void): this {
        this._emitter.off(event, listener);
        return this;
    }

    resetPauseState(): void {
        this._isPaused = false;
        this._pauseStartTime = undefined;
        this._totalPausedTime = 0;
    }
}