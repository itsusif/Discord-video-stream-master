import LibAV from "@libav.js/variant-webcodecs";
export function combineLoHi(hi, lo) {
    return LibAV.i64tof64(lo, hi);
}
