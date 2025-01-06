import { BaseMediaConnection } from './BaseMediaConnection.js';
export class VoiceConnection extends BaseMediaConnection {
    get serverId() {
        return this.guildId;
    }
    stop() {
        super.stop();
        this.streamConnection?.stop();
    }
}
