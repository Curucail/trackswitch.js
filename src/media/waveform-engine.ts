import { waveformKernelBase64 } from "../generated/waveform-kernel";
import type {
	TrackRuntime,
	TrackTiming,
	WaveformSourceIndex,
	WaveformSummary,
} from "../types";

export type TrackTimelineProjector = (
	runtime: TrackRuntime,
	trackTimelineTimeSeconds: number,
) => number;

/** Samples one entry of a summary's finest level spans. */
const SUMMARY_BASE_SAMPLES = 16;
/** Entries of a level that one entry of the next coarser level spans. */
const SUMMARY_LEVEL_FACTOR = 4;
/**
 * Samples the kernel mixes at once — a multiple of `SUMMARY_BASE_SAMPLES`, and
 * the most a single kernel call ever handles.
 */
const SUMMARY_CHUNK_SAMPLES = 65536;
/** Main-thread time a mix build may take before it yields to the event loop. */
const MIX_BUILD_SLICE_MS = 8;
/** Built mixes kept around, so switching back to a recent selection is instant. */
const MIX_CACHE_LIMIT = 4;

/**
 * One channel's share of a signal: signal sample `i` receives
 * `gain * channel[i + offset]` wherever `i + offset` lies within
 * [`start`, `end`), and nothing elsewhere.
 *
 * The channel is fetched on every read: starting playback acquires a buffer's
 * contents, which detaches the arrays `getChannelData` handed out before.
 */
interface WaveformContribution {
	buffer: AudioBuffer;
	channel: number;
	gain: number;
	offset: number;
	start: number;
	end: number;
}

export interface WaveformRange {
	min: number;
	max: number;
}

/** The compiled waveform-kernel.wat, over views of its memory regions. */
interface WaveformKernel {
	clear(count: number): void;
	accumulate(offset: number, count: number, gain: number): void;
	reduce(count: number): void;
	/** Where a chunk is mixed. */
	accumulator: Float32Array;
	/** Where a channel is copied before it is added to the accumulator. */
	input: Float32Array;
	/** The min/max pairs `reduce` writes. */
	pairs: Float32Array;
}

let kernel: WaveformKernel | null = null;

/**
 * The kernel, compiled on first use. It is a few hundred bytes, well within
 * what browsers compile synchronously on the main thread. Every caller mixes,
 * reduces and copies out a chunk without yielding in between, so all of them
 * share one instance.
 */
function getKernel(): WaveformKernel {
	if (kernel) {
		return kernel;
	}

	const bytes = Uint8Array.from(atob(waveformKernelBase64), (character) =>
		character.charCodeAt(0),
	);
	const exports = new WebAssembly.Instance(new WebAssembly.Module(bytes))
		.exports as unknown as {
		memory: WebAssembly.Memory;
		setup(chunk: number): void;
		clear(count: number): void;
		accumulate(offset: number, count: number, gain: number): void;
		reduce(count: number): void;
	};
	const pairCount = (SUMMARY_CHUNK_SAMPLES / SUMMARY_BASE_SAMPLES) * 2;
	const pageBytes = 65536;
	exports.memory.grow(
		Math.ceil(((SUMMARY_CHUNK_SAMPLES * 2 + pairCount) * 4) / pageBytes) -
			exports.memory.buffer.byteLength / pageBytes,
	);
	exports.setup(SUMMARY_CHUNK_SAMPLES);
	const memory = exports.memory.buffer;
	kernel = {
		clear: exports.clear,
		accumulate: exports.accumulate,
		reduce: exports.reduce,
		accumulator: new Float32Array(memory, 0, SUMMARY_CHUNK_SAMPLES),
		input: new Float32Array(
			memory,
			SUMMARY_CHUNK_SAMPLES * 4,
			SUMMARY_CHUNK_SAMPLES,
		),
		pairs: new Float32Array(memory, SUMMARY_CHUNK_SAMPLES * 8, pairCount),
	};
	return kernel;
}

/**
 * Mixes `count` samples of the signal from sample `start` on — at most
 * `SUMMARY_CHUNK_SAMPLES` — into the kernel's accumulator.
 */
function mixChunk(
	waveformKernel: WaveformKernel,
	contributions: WaveformContribution[],
	start: number,
	count: number,
): void {
	waveformKernel.clear(count);
	for (const contribution of contributions) {
		const base = start + contribution.offset;
		const from = Math.max(0, contribution.start - base);
		const to = Math.min(count, contribution.end - base);
		if (to <= from) {
			continue;
		}
		const channel = contribution.buffer.getChannelData(contribution.channel);
		waveformKernel.input.set(channel.subarray(base + from, base + to));
		waveformKernel.accumulate(from, to - from, contribution.gain);
	}
}

/** Fills `out[0, count)` with the signal from sample `start` on. */
function readContributions(
	contributions: WaveformContribution[],
	start: number,
	out: Float32Array,
	count: number,
): void {
	const waveformKernel = getKernel();
	for (let done = 0; done < count; done += SUMMARY_CHUNK_SAMPLES) {
		const chunk = Math.min(SUMMARY_CHUNK_SAMPLES, count - done);
		mixChunk(waveformKernel, contributions, start + done, chunk);
		out.set(waveformKernel.accumulator.subarray(0, chunk), done);
	}
}

function coarsenSummaryLevel(level: Float32Array): Float32Array {
	const entryCount = level.length / 2;
	const coarse = new Float32Array(
		Math.ceil(entryCount / SUMMARY_LEVEL_FACTOR) * 2,
	);
	for (let entry = 0; entry < entryCount; entry += SUMMARY_LEVEL_FACTOR) {
		const end = Math.min(entryCount, entry + SUMMARY_LEVEL_FACTOR);
		let min = level[entry * 2];
		let max = level[entry * 2 + 1];
		for (let child = entry + 1; child < end; child += 1) {
			if (level[child * 2] < min) {
				min = level[child * 2];
			}
			if (level[child * 2 + 1] > max) {
				max = level[child * 2 + 1];
			}
		}
		const target = (entry / SUMMARY_LEVEL_FACTOR) * 2;
		coarse[target] = min;
		coarse[target + 1] = max;
	}
	return coarse;
}

/**
 * Summarizes `sampleCount` samples of a signal, yielding after every chunk so
 * a caller can spread the work over several turns of the event loop.
 */
function* summarize(
	sampleRate: number,
	sampleCount: number,
	contributions: WaveformContribution[],
): Generator<void, WaveformSummary, void> {
	const base = new Float32Array(
		Math.ceil(sampleCount / SUMMARY_BASE_SAMPLES) * 2,
	);
	const waveformKernel = getKernel();
	for (let start = 0; start < sampleCount; start += SUMMARY_CHUNK_SAMPLES) {
		const count = Math.min(SUMMARY_CHUNK_SAMPLES, sampleCount - start);
		mixChunk(waveformKernel, contributions, start, count);
		waveformKernel.reduce(count);
		base.set(
			waveformKernel.pairs.subarray(
				0,
				Math.ceil(count / SUMMARY_BASE_SAMPLES) * 2,
			),
			(start / SUMMARY_BASE_SAMPLES) * 2,
		);
		yield;
	}

	const levels: Float32Array[] = [base];
	while (levels[levels.length - 1].length > 2) {
		levels.push(coarsenSummaryLevel(levels[levels.length - 1]));
	}
	const top = levels[levels.length - 1];
	return {
		sampleRate,
		sampleCount,
		levels,
		peak: top.length > 0 ? Math.max(-top[0], top[1]) : 0,
	};
}

/**
 * Writes the envelope of samples [`start`, `end`) to `out`, exact up to the
 * finest level's entry at either edge. False when the range holds no sample.
 */
function querySummary(
	summary: WaveformSummary,
	start: number,
	end: number,
	out: WaveformRange,
): boolean {
	let low = Math.max(0, Math.floor(start / SUMMARY_BASE_SAMPLES));
	let high = Math.min(
		summary.levels[0].length / 2,
		Math.ceil(end / SUMMARY_BASE_SAMPLES),
	);
	if (high <= low) {
		return false;
	}

	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	const take = (level: Float32Array, entry: number): void => {
		if (level[entry * 2] < min) {
			min = level[entry * 2];
		}
		if (level[entry * 2 + 1] > max) {
			max = level[entry * 2 + 1];
		}
	};
	// Entries that do not fill a whole entry of the next level are read here;
	// the aligned rest is handed up a level, where it costs a quarter as much.
	for (let levelIndex = 0; low < high; levelIndex += 1) {
		const level = summary.levels[levelIndex];
		if (levelIndex === summary.levels.length - 1) {
			for (let entry = low; entry < high; entry += 1) {
				take(level, entry);
			}
			break;
		}
		while (low < high && low % SUMMARY_LEVEL_FACTOR !== 0) {
			take(level, low);
			low += 1;
		}
		while (high > low && high % SUMMARY_LEVEL_FACTOR !== 0) {
			high -= 1;
			take(level, high);
		}
		low /= SUMMARY_LEVEL_FACTOR;
		high /= SUMMARY_LEVEL_FACTOR;
	}

	out.min = min;
	out.max = max;
	return true;
}

/**
 * A mono signal on a timeline, sampled at `sampleRate`: one track's channels
 * averaged, or a mix of several tracks at their gains. A view reads its
 * envelope from the summary when one screen pixel spans many samples, and the
 * samples themselves when it spans few.
 */
export class WaveformSignal {
	private static nextId = 0;

	/** Tells signals apart in a view's redraw bookkeeping. */
	readonly id = WaveformSignal.nextId++;

	constructor(
		readonly key: string,
		readonly sampleRate: number,
		/** The signal samples that hold audio; everything outside is silent. */
		readonly start: number,
		readonly end: number,
		/** The largest absolute sample value. */
		readonly peak: number,
		private readonly summary: WaveformSummary,
		/** The summary sample signal sample 0 corresponds to. */
		private readonly summaryOffset: number,
		private readonly contributions: WaveformContribution[],
	) {}

	/** See `querySummary`; samples outside the audio are left out. */
	envelope(start: number, end: number, out: WaveformRange): boolean {
		const from = Math.max(start, this.start);
		const to = Math.min(end, this.end);
		return (
			to > from &&
			querySummary(
				this.summary,
				from + this.summaryOffset,
				to + this.summaryOffset,
				out,
			)
		);
	}

	/** Fills `out[0, count)` with the samples from `start` on. */
	read(start: number, out: Float32Array, count: number): void {
		readContributions(this.contributions, start, out, count);
	}
}

interface MixJob {
	key: string;
	build: Generator<void, WaveformSummary, void>;
	finish(summary: WaveformSummary): WaveformSignal;
	/** The views waiting for this mix, each with what to call once it is built. */
	subscribers: Map<object, () => void>;
}

/** Tells summaries apart in mix keys. */
const summaryIds = new WeakMap<WaveformSummary, number>();
let nextSummaryId = 0;

function getSummaryId(summary: WaveformSummary): number {
	let id = summaryIds.get(summary);
	if (id === undefined) {
		id = nextSummaryId;
		nextSummaryId += 1;
		summaryIds.set(summary, id);
	}
	return id;
}

/** One contribution per channel of `buffer`, which together average them. */
function getBufferContributions(
	buffer: AudioBuffer,
	gain: number,
	span: { offset: number; start: number; end: number },
): WaveformContribution[] {
	return Array.from({ length: buffer.numberOfChannels }, (_value, channel) => ({
		buffer,
		channel,
		gain: gain / buffer.numberOfChannels,
		offset: span.offset,
		start: span.start,
		end: span.end,
	}));
}

/**
 * Where a track's audio lies, in samples: `offset` takes a sample of the
 * track's timeline to its buffer, and [`start`, `end`) is the part of the
 * buffer the timing plays.
 */
function resolveTrackSampleSpan(
	buffer: AudioBuffer,
	timing: TrackTiming,
): { offset: number; start: number; end: number } {
	const rate = buffer.sampleRate;
	const start = Math.max(0, Math.round(timing.trimStart * rate));
	return {
		offset: Math.round((timing.trimStart - timing.padStart) * rate),
		start,
		end: Math.min(
			buffer.length,
			Math.round((timing.trimStart + timing.audioDuration) * rate),
		),
	};
}

export class WaveformEngine {
	private readonly trackSignals = new WeakMap<
		WaveformSummary,
		WaveformSignal
	>();
	/** Built mixes by key, least recently used first. */
	private readonly mixes = new Map<string, WaveformSignal>();
	private readonly mixJobs = new Map<string, MixJob>();
	private readonly mixSubscriptions = new WeakMap<object, MixJob>();
	/** The signal each requester was last handed. */
	private readonly deliveredSignals = new WeakMap<object, WaveformSignal>();
	private mixJobTimer: ReturnType<typeof setTimeout> | null = null;

	/** Summarizes the average of a buffer's channels. */
	createSummary(buffer: AudioBuffer): WaveformSummary {
		const build = summarize(
			buffer.sampleRate,
			buffer.length,
			getBufferContributions(buffer, 1, {
				offset: 0,
				start: 0,
				end: buffer.length,
			}),
		);
		for (;;) {
			const step = build.next();
			if (step.done) {
				return step.value;
			}
		}
	}

	/**
	 * One track's signal on its own timeline, which starts `padStart` before
	 * the audio does.
	 */
	getTrackSignal(runtime: TrackRuntime): WaveformSignal | null {
		const { buffer, timing, waveformSummary: summary } = runtime;
		if (!buffer || !timing || !summary) {
			return null;
		}

		const span = resolveTrackSampleSpan(buffer, timing);
		const key = [getSummaryId(summary), span.offset, span.start, span.end].join(
			":",
		);
		const cached = this.trackSignals.get(summary);
		if (cached?.key === key) {
			return cached;
		}

		const range: WaveformRange = { min: 0, max: 0 };
		const peak = querySummary(summary, span.start, span.end, range)
			? Math.max(-range.min, range.max)
			: 0;
		const signal = new WaveformSignal(
			key,
			buffer.sampleRate,
			span.start - span.offset,
			span.end - span.offset,
			peak,
			summary,
			span.offset,
			getBufferContributions(buffer, 1, span),
		);
		this.trackSignals.set(summary, signal);
		return signal;
	}

	/**
	 * What `runtimes` sound like together on a shared timeline of `duration`
	 * seconds: one track's own signal, or the sample-exact mix of several at
	 * their volumes — null with nothing to show. A mix is summarized in the
	 * background: until it is built, the requester keeps the signal it was last
	 * handed, and `onReady` fires once the mix is in. Each `requester` waits for
	 * one mix at a time, and a mix nobody waits for any more is abandoned.
	 */
	getSignal(
		requester: object,
		runtimes: TrackRuntime[],
		duration: number,
		onReady: () => void,
	): WaveformSignal | null {
		const signal = this.resolveSignal(requester, runtimes, duration, onReady);
		if (signal) {
			this.deliveredSignals.set(requester, signal);
			return signal;
		}
		return this.mixSubscriptions.has(requester)
			? (this.deliveredSignals.get(requester) ?? null)
			: null;
	}

	private resolveSignal(
		requester: object,
		runtimes: TrackRuntime[],
		duration: number,
		onReady: () => void,
	): WaveformSignal | null {
		const sources = runtimes.filter(
			(runtime) => runtime.buffer && runtime.timing && runtime.waveformSummary,
		);
		if (sources.length <= 1) {
			this.unsubscribeMix(requester);
			return sources.length === 1 ? this.getTrackSignal(sources[0]) : null;
		}

		const rate = (sources[0].buffer as AudioBuffer).sampleRate;
		const sampleCount = Math.ceil(duration * rate);
		// A view scales the mix to its own peak, so only relative gains matter.
		const gains = sources.map(
			(runtime) => runtime.state.volume * runtime.loudnessGain,
		);
		const loudest = Math.max(...gains);
		const parts = sources.map((runtime, index) => {
			const buffer = runtime.buffer as AudioBuffer;
			return {
				buffer,
				span: resolveTrackSampleSpan(buffer, runtime.timing as TrackTiming),
				gain: Math.round((gains[index] / loudest) * 1000) / 1000,
				summaryId: getSummaryId(runtime.waveformSummary as WaveformSummary),
			};
		});
		const key = [
			sampleCount,
			...parts.map((part) =>
				[
					part.summaryId,
					part.span.offset,
					part.span.start,
					part.span.end,
					part.gain,
				].join(":"),
			),
		].join("|");

		const cached = this.mixes.get(key);
		if (cached) {
			this.unsubscribeMix(requester);
			this.mixes.delete(key);
			this.mixes.set(key, cached);
			return cached;
		}

		const subscribed = this.mixSubscriptions.get(requester);
		if (subscribed?.key === key) {
			subscribed.subscribers.set(requester, onReady);
			return null;
		}
		this.unsubscribeMix(requester);

		let job = this.mixJobs.get(key);
		if (!job) {
			// Every buffer is decoded at the AudioContext's rate, so a sample of
			// the shared timeline is a sample of each track.
			const contributions: WaveformContribution[] = [];
			parts.forEach((part) => {
				contributions.push(
					...getBufferContributions(part.buffer, part.gain, part.span),
				);
			});
			job = {
				key,
				build: summarize(rate, sampleCount, contributions),
				finish: (summary) =>
					new WaveformSignal(
						key,
						rate,
						0,
						sampleCount,
						summary.peak,
						summary,
						0,
						contributions,
					),
				subscribers: new Map(),
			};
			this.mixJobs.set(key, job);
		}
		job.subscribers.set(requester, onReady);
		this.mixSubscriptions.set(requester, job);
		this.scheduleMixJobs();
		return null;
	}

	private unsubscribeMix(requester: object): void {
		const job = this.mixSubscriptions.get(requester);
		if (!job) {
			return;
		}

		this.mixSubscriptions.delete(requester);
		job.subscribers.delete(requester);
		if (job.subscribers.size === 0) {
			this.mixJobs.delete(job.key);
		}
	}

	private scheduleMixJobs(): void {
		if (this.mixJobTimer !== null) {
			return;
		}

		this.mixJobTimer = setTimeout(() => {
			this.mixJobTimer = null;
			this.runMixJobs();
		}, 0);
	}

	private runMixJobs(): void {
		const sliceEnd = performance.now() + MIX_BUILD_SLICE_MS;
		for (const job of this.mixJobs.values()) {
			let step = job.build.next();
			while (!step.done && performance.now() < sliceEnd) {
				step = job.build.next();
			}
			if (!step.done) {
				break;
			}

			this.mixJobs.delete(job.key);
			this.mixes.set(job.key, job.finish(step.value));
			while (this.mixes.size > MIX_CACHE_LIMIT) {
				this.mixes.delete(this.mixes.keys().next().value as string);
			}
			job.subscribers.forEach((onReady, requester) => {
				this.mixSubscriptions.delete(requester);
				onReady();
			});
			if (performance.now() >= sliceEnd) {
				break;
			}
		}

		if (this.mixJobs.size > 0) {
			this.scheduleMixJobs();
		}
	}
}

function resolveFixedWaveformTrackIndex(
	runtimesLength: number,
	waveformSource: WaveformSourceIndex,
): number | null {
	if (waveformSource === "audible" || Array.isArray(waveformSource)) {
		return null;
	}

	return waveformSource >= 0 && waveformSource < runtimesLength
		? waveformSource
		: null;
}

export function resolveWaveformTrackIndices(
	runtimesLength: number,
	waveformSource: WaveformSourceIndex,
): number[] {
	if (waveformSource === "audible") {
		return Array.from({ length: runtimesLength }, (_value, index) => index);
	}

	if (Array.isArray(waveformSource)) {
		return waveformSource.filter(
			(trackIndex) => trackIndex >= 0 && trackIndex < runtimesLength,
		);
	}

	return waveformSource >= 0 && waveformSource < runtimesLength
		? [waveformSource]
		: [];
}

/**
 * `isExclusiveSoloTrack` answers, per track, whether its `trackList` permits only
 * one audible track — such a track still counts as audible while nothing at all is
 * soloed, because that list always resolves to one of its rows.
 */
export function isWaveformTrackAudible(
	runtimes: TrackRuntime[],
	trackIndex: number,
	waveformSource: WaveformSourceIndex,
	isAlignmentMode: boolean,
	isExclusiveSoloTrack: (trackIndex: number) => boolean,
): boolean {
	const runtime = runtimes[trackIndex];
	if (!runtime || runtime.state.volume <= 0) {
		return false;
	}

	if (isAlignmentMode) {
		// Fixed/array sources always show their bound track(s) regardless of solo
		// (e.g. two side-by-side comparison waveforms). Only the dynamic "audible"
		// source follows solo.
		return waveformSource === "audible" ? runtime.state.solo : true;
	}

	const anySolo = runtimes.some((entry) => entry.state.solo);
	if (anySolo) {
		return runtime.state.solo;
	}

	return isExclusiveSoloTrack(trackIndex);
}

/**
 * The single track index a surface's "audible" source currently resolves to —
 * used to bind peak rendering, seeking, marker projection, and playhead
 * position to that track's own local timeline instead of the flat,
 * projector-warped reference timeline. A fixed source always resolves to its
 * own index. An "audible" source resolves to the first soloed track — under
 * alignment everything audible at once lives on that track's timeline.
 */
export function resolveAudibleWaveformTrackIndex(
	runtimes: TrackRuntime[],
	waveformSource: WaveformSourceIndex,
	isAlignmentMode: boolean,
	isExclusiveSoloTrack: (trackIndex: number) => boolean,
): number | null {
	const fixedTrackIndex = resolveFixedWaveformTrackIndex(
		runtimes.length,
		waveformSource,
	);
	if (fixedTrackIndex !== null) {
		return fixedTrackIndex;
	}
	if (waveformSource !== "audible") {
		return null;
	}

	const audibleIndex = resolveWaveformTrackIndices(
		runtimes.length,
		waveformSource,
	).find((trackIndex) =>
		isWaveformTrackAudible(
			runtimes,
			trackIndex,
			waveformSource,
			isAlignmentMode,
			isExclusiveSoloTrack,
		),
	);
	return audibleIndex ?? null;
}
