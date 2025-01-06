import { VoiceConnection } from "./voice/VoiceConnection.js";
import type { Client } from 'discord.js-selfbot-v13';
import type { MediaUdp } from "./voice/MediaUdp.js";
import type { StreamOptions } from "./voice/index.js";
export declare class Streamer {
    private _voiceConnection?;
    private _client;
    private _gatewayEmitter;
    constructor(client: Client);
    get client(): Client;
    get voiceConnection(): VoiceConnection | undefined;
    sendOpcode(code: number, data: unknown): void;
    joinVoice(guild_id: string, channel_id: string, options?: Partial<StreamOptions>): Promise<MediaUdp>;
    createStream(options?: Partial<StreamOptions>): Promise<MediaUdp>;
    stopStream(): void;
    leaveVoice(): void;
    signalVideo(video_enabled: boolean): void;
    signalStream(): void;
    signalStopStream(): void;
    signalLeaveVoice(): void;
}
