import { MediaUdp, Streamer, getInputMetadata, inputHasAudio } from "@dank074/discord-video-stream";
import config from "./config.json" with {type: "json"};
import { Client, StageChannel } from "discord.js-selfbot-v13";
import { customFfmpegCommand, customStreamVideo } from "./customStream.js";

const streamer = new Streamer(new Client());

// ready event
streamer.client.on("ready", () => {
    console.log(`--- ${streamer.client.user.tag} is ready ---`);
});

// message event
streamer.client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (!config.acceptedAuthors.includes(msg.author.id)) return;

    if (!msg.content) return;

    if (msg.content.startsWith(`$play-live`)) {
        const args = msg.content.split(" ");
        if (args.length < 2) return;

        const url = args[1];

        if (!url) return;

        const channel = msg.author.voice.channel;

        if(!channel) return;

        console.log(`Attempting to join voice channel ${msg.guildId}/${channel.id}`);
        await streamer.joinVoice(msg.guildId, channel.id);

        if(channel instanceof StageChannel)
        {
            await streamer.client.user.voice.setSuppressed(false);
        }

        const streamUdpConn = await streamer.createStream();

        await playVideo(url, streamUdpConn);

        streamer.stopStream();
        return;
    } else if (msg.content.startsWith("$disconnect")) {
        customFfmpegCommand?.kill("SIGINT");

        streamer.leaveVoice();
    }
});

// login
streamer.client.login(config.token);

// custom code to make it copy the video stream. First we need to get the fps and resolution of existing stream
async function playVideo(video: string, udpConn: MediaUdp) {
    let includeAudio = true;

    try {
        const metadata = await getInputMetadata(video);
        console.log(metadata)
        const videoStream = metadata.streams.find( (value) => value.codec_type === 'video' && value.codec_name === "h264" && value.pix_fmt === 'yuv420p')
        
        if(!videoStream) {
            console.log("Unable to copy the codec: No suitable stream found")
            return;
        }
        console.log('copying h264 video directly to output')
        const fps = parseInt(videoStream.avg_frame_rate.split('/')[0])/parseInt(videoStream.avg_frame_rate.split('/')[1])
        const width = videoStream.width
        const height = videoStream.height
        console.log({fps, width, height, "profile": videoStream.profile})
        udpConn.mediaConnection.streamOptions = { fps, width, height }
        includeAudio = inputHasAudio(metadata);
    } catch(e) {
        console.log(e);
        return;
    }

    console.log("Started playing video");

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);
    try {
        const res = await customStreamVideo(video, udpConn, includeAudio);

        console.log("Finished playing video " + res);
    } catch (e) {
        console.log(e);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
    customFfmpegCommand?.kill("SIGINT");
}

