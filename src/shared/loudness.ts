/**
 * Loudness normalization gain for a decoded track.
 *
 * Measures integrated loudness per ITU-R BS.1770-4 (the algorithm behind LUFS
 * and EBU R128): a two-stage K-weighting filter, split into overlapping 400ms
 * blocks, with absolute (-70 LUFS) and relative (-10 LU) gating to discount
 * silence and quiet passages from skewing the result. The filter coefficients
 * below are the standard's fixed 48kHz design, applied directly against the
 * buffer's native sample rate rather than resampling first — for the common
 * 44.1/48kHz case the resulting corner-frequency shift is negligible, and this
 * is a convenience normalization rather than a certified loudness meter.
 */

const TARGET_INTEGRATED_LOUDNESS_LUFS = -14;

interface Biquad {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
}

const PRE_FILTER: Biquad = {
	b0: 1.53512485958697,
	b1: -2.69169618940638,
	b2: 1.19839281085285,
	a1: -1.69065929318241,
	a2: 0.73248077421585,
};

const RLB_FILTER: Biquad = {
	b0: 1.0,
	b1: -2.0,
	b2: 1.0,
	a1: -1.99004745483398,
	a2: 0.99007225036621,
};

const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_LU = 10;

function applyBiquad(samples: Float32Array, coef: Biquad): Float32Array {
	const out = new Float32Array(samples.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;

	for (let i = 0; i < samples.length; i += 1) {
		const x0 = samples[i];
		const y0 =
			coef.b0 * x0 + coef.b1 * x1 + coef.b2 * x2 - coef.a1 * y1 - coef.a2 * y2;
		out[i] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}

	return out;
}

function meanSquareAcrossChannels(
	channels: Float32Array[],
	start: number,
	end: number,
): number {
	let sum = 0;

	channels.forEach((channel) => {
		let channelSum = 0;
		for (let i = start; i < end; i += 1) {
			channelSum += channel[i] * channel[i];
		}
		sum += channelSum / (end - start);
	});

	return sum;
}

function loudnessFromPower(power: number): number {
	return power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity;
}

function average(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Integrated loudness in LUFS, or -Infinity for silent/empty audio. */
function measureIntegratedLoudnessLufs(buffer: AudioBuffer): number {
	if (buffer.numberOfChannels === 0 || buffer.length === 0) {
		return -Infinity;
	}

	const kWeightedChannels: Float32Array[] = [];
	for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
		kWeightedChannels.push(
			applyBiquad(
				applyBiquad(buffer.getChannelData(ch), PRE_FILTER),
				RLB_FILTER,
			),
		);
	}

	const sampleCount = kWeightedChannels[0].length;
	const blockSize = Math.max(1, Math.round(BLOCK_SECONDS * buffer.sampleRate));
	const hopSize = Math.max(1, Math.round(HOP_SECONDS * buffer.sampleRate));

	if (sampleCount < blockSize) {
		return loudnessFromPower(
			meanSquareAcrossChannels(kWeightedChannels, 0, sampleCount),
		);
	}

	const blockPowers: number[] = [];
	for (let start = 0; start + blockSize <= sampleCount; start += hopSize) {
		blockPowers.push(
			meanSquareAcrossChannels(kWeightedChannels, start, start + blockSize),
		);
	}

	const absoluteGated = blockPowers.filter(
		(power) => loudnessFromPower(power) >= ABSOLUTE_GATE_LUFS,
	);
	if (absoluteGated.length === 0) {
		return -Infinity;
	}

	const ungatedAveragePower = average(absoluteGated);
	const relativeThresholdPower =
		ungatedAveragePower * 10 ** (-RELATIVE_GATE_OFFSET_LU / 10);

	const relativeGated = absoluteGated.filter(
		(power) => power >= relativeThresholdPower,
	);

	return loudnessFromPower(
		relativeGated.length > 0 ? average(relativeGated) : ungatedAveragePower,
	);
}

function measureSamplePeak(buffer: AudioBuffer): number {
	let peak = 0;

	for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < data.length; i += 1) {
			const abs = Math.abs(data[i]);
			if (abs > peak) {
				peak = abs;
			}
		}
	}

	return peak;
}

/**
 * Linear gain to bring `buffer` to `targetLufs`, capped so the loudest sample
 * never exceeds full scale.
 */
export function computeLoudnessNormalizationGain(
	buffer: AudioBuffer,
	targetLufs: number = TARGET_INTEGRATED_LOUDNESS_LUFS,
): number {
	const measuredLufs = measureIntegratedLoudnessLufs(buffer);
	if (!Number.isFinite(measuredLufs)) {
		return 1;
	}

	let gain = 10 ** ((targetLufs - measuredLufs) / 20);

	const peak = measureSamplePeak(buffer);
	if (peak > 0) {
		gain = Math.min(gain, 1 / peak);
	}

	return Number.isFinite(gain) && gain > 0 ? gain : 1;
}
