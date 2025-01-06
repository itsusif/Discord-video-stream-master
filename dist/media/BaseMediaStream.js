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
    async _write(frame, _, callback) {
        // Initialize start time if not set
        if (this._startTime === undefined) {
            this._startTime = performance.now();
        }
        // If paused, wait until resumed
        while (this._isPaused) {
            await setTimeout(50);
        }
        await this._waitForOtherStream();
        const { data, ptshi, pts, durationhi, duration, time_base_num, time_base_den } = frame;
        const frametime = combineLoHi(durationhi, duration) / time_base_den * time_base_num * 1000;
        const start = performance.now();
        await this._sendFrame(Buffer.from(data), frametime);
        const end = performance.now();
        this._pts = combineLoHi(ptshi, pts) / time_base_den * time_base_num * 1000;
        if (this._startPts === undefined) {
            this._startPts = this._pts;
        }
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
        // Adjust timing calculations to account for pause duration
        const adjustedTime = now - this._totalPausedTime;
        const sleep = Math.max(0, this._pts - this._startPts + frametime - (adjustedTime - this._startTime));
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
    resetPauseState() {
        this._isPaused = false;
        this._pauseStartTime = undefined;
        this._totalPausedTime = 0;
    }
}
