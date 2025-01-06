import type { MediaUdp } from "../voice/MediaUdp.js";
import { BaseMediaPacketizer } from "./BaseMediaPacketizer.js";
import { type AnnexBHelpers } from "../processing/AnnexBHelper.js";
/**
 * Annex B format
 *
 * Packetizer for Annex B NAL. This method does NOT support aggregation packets
 * where multiple NALs are sent as a single RTP payload. The supported payload
 * type is Single NAL Unit Packet and Fragmentation Unit A (FU-A). The headers
 * produced correspond to packetization-mode=1.

         RTP Payload Format for H.264 Video:
         https://tools.ietf.org/html/rfc6184

         RTP Payload Format for HEVC Video:
         https://tools.ietf.org/html/rfc7798
         
         FFmpeg H264/HEVC RTP packetisation code:
         https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/rtpenc_h264_hevc.c
         
         When the payload size is less than or equal to max RTP payload, send as
         Single NAL Unit Packet:
         https://tools.ietf.org/html/rfc6184#section-5.6
         https://tools.ietf.org/html/rfc7798#section-4.4.1
         
         0                   1                   2                   3
         0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         |F|NRI|  Type   |                                               |
         +-+-+-+-+-+-+-+-+                                               |
         |                                                               |
         |               Bytes 2..n of a single NAL unit                 |
         |                                                               |
         |                               +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         |                               :...OPTIONAL RTP padding        |
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         
         Type = 24 for STAP-A (NOTE: this is the type of the RTP header
         and NOT the NAL type).
         
         When the payload size is greater than max RTP payload, send as
         Fragmentation Unit A (FU-A):
         https://tools.ietf.org/html/rfc6184#section-5.8
              0                   1                   2                   3
         0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         | FU indicator  |   FU header   |                               |
         +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
         |   Fragmentation Unit (FU) Payload
         |
         ...
 */
declare class VideoPacketizerAnnexB extends BaseMediaPacketizer {
    private _nalFunctions;
    constructor(connection: MediaUdp, payloadType: number, nalFunctions: AnnexBHelpers);
    /**
     * Sends packets after partitioning the video frame into
     * MTU-sized chunks
     * @param frame Annex B video frame
     */
    sendFrame(frame: Buffer, frametime: number): Promise<void>;
    protected makeFragmentationUnitHeader(isFirstPacket: boolean, isLastPacket: boolean, naluHeader: Buffer): Buffer;
    onFrameSent(packetsSent: number, bytesSent: number, frametime: number): Promise<void>;
}
export declare class VideoPacketizerH264 extends VideoPacketizerAnnexB {
    constructor(connection: MediaUdp);
    /**
     * The FU indicator octet has the following format:
        
            +---------------+
            |0|1|2|3|4|5|6|7|
            +-+-+-+-+-+-+-+-+
            |F|NRI|  Type   |
            +---------------+
            
            F and NRI bits come from the NAL being transmitted.
            Type = 28 for FU-A (NOTE: this is the type of the H264 RTP header
            and NOT the NAL type).
            
            The FU header has the following format:
            
            +---------------+
            |0|1|2|3|4|5|6|7|
            +-+-+-+-+-+-+-+-+
            |S|E|R|  Type   |
            +---------------+
            
            S: Set to 1 for the start of the NAL FU (i.e. first packet in frame).
            E: Set to 1 for the end of the NAL FU (i.e. the last packet in the frame).
            R: Reserved bit must be 0.
            Type: The NAL unit payload type, comes from NAL packet (NOTE: this IS the type of the NAL message).
 * @param isFirstPacket
 * @param isLastPacket
 * @param naluHeader
 * @returns FU-A packets
 */
    protected makeFragmentationUnitHeader(isFirstPacket: boolean, isLastPacket: boolean, naluHeader: Buffer): Buffer;
}
export declare class VideoPacketizerH265 extends VideoPacketizerAnnexB {
    constructor(connection: MediaUdp);
    /**
     * The FU indicator octet has the following format:

            +---------------+---------------+
            |0|1|2|3|4|5|6|7|0|1|2|3|4|5|6|7|
            +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
            |F|   Type    |  LayerId  | TID |
            +-------------+-----------------+
            
            All other fields except Type come from the NAL being transmitted.
            Type = 49 for FU-A (NOTE: this is the type of the H265 RTP header
            and NOT the NAL type).
            
            The FU header has the following format:
            
            +---------------+
            |0|1|2|3|4|5|6|7|
            +-+-+-+-+-+-+-+-+
            |S|E|    Type   |
            +---------------+
            
            S: Set to 1 for the start of the NAL FU (i.e. first packet in frame).
            E: Set to 1 for the end of the NAL FU (i.e. the last packet in the frame).
            Type: The NAL unit payload type, comes from NAL packet (NOTE: this IS the type of the NAL message).
 * @param isFirstPacket
 * @param isLastPacket
 * @param naluHeader
 * @returns FU-A packets
 */
    protected makeFragmentationUnitHeader(isFirstPacket: boolean, isLastPacket: boolean, naluHeader: Buffer): Buffer;
}
export {};
