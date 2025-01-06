import { Log } from "debug-level";
import { setTimeout } from "node:timers/promises";
import { Writable } from "node:stream";
import { combineLoHi } from "./utils.js";
export class BaseMediaStream extends Writable {
    constructor(type, noSleep = false) {
        super({ objectMode: true, highWaterMark: 0 });
        this._syncTolerance = 5;
        this._isPaused = false;
        this._totalPausedTime = 0;
        this._loggerSend = new Log(`stream:${type}:send`);
        this._loggerSync = new Log(`stream:${type}:sync`);
        this._loggerSleep = new Log(`stream:${type}:sleep`);
        this._noSleep = noSleep;
    }
    get pts() {
        return this._pts;
    }
    get isPaused() {
        return this._isPaused;
    }
    get syncTolerance() {
        return this._syncTolerance;
    }
    set syncTolerance(n) {
        if (n < 0)
            return;
        this._syncTolerance = n;
    }
    async _waitForOtherStream() {
        let i = 0;
        while (this.syncStream &&
            !this.syncStream.writableEnded &&
            this.syncStream.pts !== undefined &&
            this._pts !== undefined &&
            this._pts - this.syncStream.pts > this._syncTolerance) {
            if (i === 0) {
                this._loggerSync.debug(`Waiting for other stream (${this._pts} - ${this.syncStream._pts} > ${this._syncTolerance})`);
            }
            await setTimeout(1);
            i = (i + 1) % 10;
        }
    }
    async _sendFrame(frame, frametime) {
        throw new Error("Not implemented");
    }
    _shouldDropFrame(framePts) {
        if (!this._seekTargetPts)
            return false;
        return framePts < this._seekTargetPts;
    }
    async _write(frame, _, callback) {
        this._currentPacket = frame;
        const { data, ptshi, pts, durationhi, duration, time_base_num, time_base_den } = frame;
        // Calculate PTS in milliseconds
        const framePts = combineLoHi(ptshi, pts) / time_base_den * time_base_num * 1000;
        const frametime = combineLoHi(durationhi, duration) / time_base_den * time_base_num * 1000;
        // Handle seeking
        if (this._shouldDropFrame(framePts)) {
            callback(null);
            return;
        }
        // Initialize timing on first non-dropped frame
        if (this._startTime === undefined || this._seekTime !== undefined) {
            this._startTime = performance.now();
            this._startPts = framePts;
            this._baseTime = this._startTime;
            if (this._seekTime !== undefined) {
                this._baseTime -= this._seekTime;
                this._seekTime = undefined;
                this._seekTargetPts = undefined;
            }
        }
        // Handle pause
        while (this._isPaused) {
            await setTimeout(50);
        }
        await this._waitForOtherStream();
        const start = performance.now();
        await this._sendFrame(Buffer.from(data), frametime);
        const end = performance.now();
        this._pts = framePts;
        const sendTime = end - start;
        const ratio = sendTime / frametime;
        this._loggerSend.debug({
            stats: {
                pts: this._pts,
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
        const adjustedBase = this._baseTime ?? this._startTime ?? now;
        const sleep = Math.max(0, this._pts - (this._startPts ?? 0) - (adjustedNow - adjustedBase));
        this._loggerSleep.debug(`Sleeping for ${sleep}ms`);
        if (this._noSleep) {
            callback(null);
        }
        else {
            setTimeout(sleep).then(() => callback(null));
        }
    }
    _destroy(error, callback) {
        super._destroy(error, callback);
        this.syncStream = undefined;
    }
    pause() {
        if (!this._isPaused) {
            this._isPaused = true;
            this._pauseStartTime = performance.now();
            this._loggerSend.debug('Stream paused');
        }
        return this;
    }
    resume() {
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
    /**
     * Seek to a specific timestamp in milliseconds
     * @param targetMs Target timestamp in milliseconds
     */
    seek(targetMs) {
        if (targetMs < 0)
            return this;
        this._loggerSend.debug(`Seeking to ${targetMs}ms`);
        this._seekTime = targetMs;
        this._seekTargetPts = targetMs;
        this._startTime = undefined;
        this._startPts = undefined;
        this._baseTime = undefined;
        // Reset pause state when seeking
        this.resetPauseState();
        return this;
    }
    resetPauseState() {
        this._isPaused = false;
        this._pauseStartTime = undefined;
        this._totalPausedTime = 0;
    }
    getCurrentPacket() {
        return this._currentPacket;
    }
}
