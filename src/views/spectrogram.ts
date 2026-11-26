import {
	levelPowers,
	resolveFrequencyRange,
	SpectrogramFrames,
	type SpectrogramSettings,
	toFrequencyScale,
} from "../media/spectrogram";
import type { WaveformMixReader } from "../media/waveform-engine";
import { formatMidiNoteName } from "../shared/midi-notes";
import type { TrackSwitchSpectrogramViewConfig } from "../types";
import {
	getSpectrogramRenderer,
	type Rgb,
	type SpectrogramColumnCache,
	type SpectrogramLanePlacement,
	type SpectrogramRenderer,
} from "./spectrogram-gl";
import { resizeCanvasForCssSize } from "./surface";

/**
 * Main-thread time one redraw spends composing columns. Whatever is left is
 * composed over the next frames, so scrolling and playback stay smooth while
 * a zoomed-out view fills in.
 */
const COMPOSE_BUDGET_MS = 12;
/** Closest two axis labels may sit, in CSS pixels. */
const MIN_TICK_SPACING = 16;
/**
 * Height kept free of labels at the top of every lane, in CSS pixels: the
 * zoom badge and a stereo lane's channel label sit there.
 */
const TICK_TOP_CLEARANCE = 30;
/** Height kept free of labels at the bottom of every lane, in CSS pixels. */
const TICK_BOTTOM_CLEARANCE = 6;

export interface SpectrogramSurfaceState {
	settings: SpectrogramSettings;
	/** The analysis frames of each lane, which the tile and minimap share. */
	frames: SpectrogramFrames[];
	/** The tile's columns, per lane. */
	tileCaches: SpectrogramColumnCache[];
	/** The minimap's columns, per lane. */
	minimapCaches: SpectrogramColumnCache[];
	axisNodes: HTMLElement[];
	axisKey: string | null;
}

export function createSpectrogramSurfaceState(
	config: TrackSwitchSpectrogramViewConfig,
	laneCount: number,
	overlay: HTMLElement,
): SpectrogramSurfaceState {
	const [minFrequency, maxFrequency] = config.frequencyRange as [
		number,
		number,
	];
	const axisNodes = Array.from({ length: laneCount }, (_value, lane) => {
		const node = document.createElement("div");
		node.className = "spectrogram-axis";
		node.style.top = `${(lane * 100) / laneCount}%`;
		node.style.height = `${100 / laneCount}%`;
		overlay.appendChild(node);
		return node;
	});
	return {
		settings: {
			frequencyScale: config.frequencyScale ?? "linear",
			axisLabels: config.axisLabels ?? "hz",
			minFrequency,
			maxFrequency,
			amplitude: config.amplitude ?? "log1p",
			dynamicRange: config.dynamicRange ?? 80,
			gamma: config.gamma ?? 10000,
			fftSize: config.fftSize ?? 4096,
			window: config.window ?? "hann",
			hopSize: config.hopSize ?? (config.fftSize ?? 4096) / 2,
		},
		frames: [],
		tileCaches: [],
		minimapCaches: [],
		axisNodes,
		axisKey: null,
	};
}

/** The settings a draw key needs to tell two renderings apart. */
export function getSpectrogramSettingsKey(
	state: SpectrogramSurfaceState,
): string {
	return Object.values(state.settings).join(":");
}

export interface SpectrogramColors {
	background: string;
	color: string;
	divider: string;
}

export function resolveSpectrogramColors(
	element: HTMLElement,
): SpectrogramColors {
	const style = getComputedStyle(element);
	return {
		background: style.getPropertyValue("--spectrogram-background").trim(),
		color: style.getPropertyValue("--spectrogram-color").trim(),
		divider: style.getPropertyValue("--waveform-lane-divider-color").trim(),
	};
}

let colorProbe: CanvasRenderingContext2D | null = null;

const parsedColors = new Map<string, Rgb>();

/** A CSS colour as its sRGB channels, read back from a canvas pixel. */
function parseCssColor(color: string): Rgb {
	let parsed = parsedColors.get(color);
	if (parsed) {
		return parsed;
	}
	if (!colorProbe) {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		colorProbe = canvas.getContext("2d", { willReadFrequently: true });
	}
	const context = colorProbe as CanvasRenderingContext2D;
	context.clearRect(0, 0, 1, 1);
	context.fillStyle = color;
	context.fillRect(0, 0, 1, 1);
	const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
	parsed = [red, green, blue];
	parsedColors.set(color, parsed);
	return parsed;
}

function getColumnCache(
	renderer: SpectrogramRenderer,
	caches: SpectrogramColumnCache[],
	lane: number,
	key: string,
	geometryKey: string,
	rows: number,
): SpectrogramColumnCache {
	let cache = caches[lane];
	if (cache?.renderer !== renderer || cache.geometryKey !== geometryKey) {
		cache?.renderer.deleteCache(cache);
		cache = renderer.createCache(key, geometryKey, rows);
		caches[lane] = cache;
	} else if (cache.key !== key) {
		cache.key = key;
		renderer.expireColumns(cache);
	}
	return cache;
}

/** Frees what the columns in `caches` hold on the GPU. */
export function disposeSpectrogramColumns(
	caches: SpectrogramColumnCache[],
): void {
	caches.forEach((cache) => {
		cache.renderer.deleteCache(cache);
	});
	caches.length = 0;
}

/** The frames of `reader` for one lane, kept for as long as it reads the same. */
function getLaneFrames(
	state: SpectrogramSurfaceState,
	lane: number,
	reader: WaveformMixReader,
): SpectrogramFrames {
	let frames = state.frames[lane];
	if (frames?.key !== SpectrogramFrames.keyFor(reader, state.settings)) {
		frames = new SpectrogramFrames(reader, state.settings);
		state.frames[lane] = frames;
	}
	return frames;
}

/** Display intensity from 0 to 255 of a power, as the settings compress it. */
function powerToIntensity(
	power: number,
	settings: SpectrogramSettings,
): number {
	let intensity: number;
	if (settings.amplitude === "db") {
		intensity =
			power > 0
				? (10 * Math.log10(power) + settings.dynamicRange) /
					settings.dynamicRange
				: 0;
	} else {
		intensity =
			Math.log1p(settings.gamma * Math.sqrt(power)) /
			Math.log1p(settings.gamma);
	}
	return Math.round(Math.min(1, Math.max(0, intensity)) * 255);
}

const intensityMaps = new Map<string, Uint8Array>();

/** Display intensity per level, as the settings compress it. */
function getIntensityMap(settings: SpectrogramSettings): Uint8Array {
	const key = [settings.amplitude, settings.dynamicRange, settings.gamma].join(
		":",
	);
	let map = intensityMaps.get(key);
	if (!map) {
		map = Uint8Array.from(levelPowers, (power) =>
			powerToIntensity(power, settings),
		);
		intensityMaps.set(key, map);
	}
	return map;
}

/**
 * Writes the column of the surface that spans samples [`from`, `to`) to `out`:
 * the mean power of the frames centred within it, or the frame nearest its
 * middle when it is narrower than a hop.
 */
function composeColumn(
	frames: SpectrogramFrames,
	from: number,
	to: number,
	settings: SpectrogramSettings,
	sums: Float64Array,
	out: Uint8Array,
): void {
	const hop = frames.hopSize;
	let first = Math.ceil(from / hop);
	let last = Math.ceil(to / hop) - 1;
	if (last < first) {
		first = Math.round((from + to) / 2 / hop);
		last = first;
	}

	const rows = out.length;
	if (first === last) {
		const levels = frames.frameRows(first, rows);
		const intensities = getIntensityMap(settings);
		for (let row = 0; row < rows; row += 1) {
			out[row] = intensities[levels[row]];
		}
		return;
	}

	sums.fill(0, 0, rows);
	for (let frame = first; frame <= last; frame += 1) {
		const levels = frames.frameRows(frame, rows);
		for (let row = 0; row < rows; row += 1) {
			sums[row] += levelPowers[levels[row]];
		}
	}
	for (let row = 0; row < rows; row += 1) {
		out[row] = powerToIntensity(sums[row] / (last - first + 1), settings);
	}
}

/** A stretch of the surface a spectrogram canvas shows. */
export interface SpectrogramDrawRange {
	/** Surface column the canvas's first column is; a column is a CSS pixel. */
	firstColumn: number;
	/** Seconds of the surface's timeline one column spans. */
	secondsPerColumn: number;
	/** Columns, from the canvas's left edge, that hold audio. */
	drawColumns: number;
	/** Columns, from the left edge, analysed before the others. */
	priorityStart: number;
	priorityEnd: number;
}

/**
 * Draws one lane per reader stacked top to bottom, one column per CSS pixel
 * and one row per device pixel. Columns are taken from `caches` where they
 * were composed before; the rest are composed until `deadline`, after which
 * the ones still missing show what the mix before showed there, or nothing.
 * Returns whether every column was drawn from the current mix.
 */
export function drawSpectrogram(
	canvas: HTMLCanvasElement,
	cssWidth: number,
	cssHeight: number,
	readers: WaveformMixReader[] | null,
	range: SpectrogramDrawRange,
	state: SpectrogramSurfaceState,
	caches: SpectrogramColumnCache[],
	colors: SpectrogramColors,
	deadline: number,
): boolean {
	const context = resizeCanvasForCssSize(canvas, cssWidth, cssHeight);
	if (!context) {
		return true;
	}

	context.setTransform(1, 0, 0, 1, 0, 0);
	context.fillStyle = colors.background;
	context.fillRect(0, 0, canvas.width, canvas.height);
	if (!readers || readers.length === 0 || range.secondsPerColumn <= 0) {
		return true;
	}

	const columns = Math.max(1, Math.round(cssWidth));
	const drawColumns = Math.min(
		columns,
		Math.max(0, Math.round(range.drawColumns)),
	);
	const rows = canvas.height;
	const renderer = getSpectrogramRenderer();
	const settingsKey = getSpectrogramSettingsKey(state);

	const lanes = readers.map((reader, lane) => {
		const top = Math.round((rows * lane) / readers.length);
		const laneRows = Math.round((rows * (lane + 1)) / readers.length) - top;
		const frames = getLaneFrames(state, lane, reader);
		const cache = getColumnCache(
			renderer,
			caches,
			lane,
			frames.key,
			[settingsKey, reader.sampleRate, range.secondsPerColumn, laneRows].join(
				"#",
			),
			laneRows,
		);
		renderer.pruneColumns(
			cache,
			range.firstColumn - columns,
			range.firstColumn + 2 * columns,
		);
		return {
			top,
			cache,
			frames,
			samplesPerColumn: range.secondsPerColumn * reader.sampleRate,
			values: new Uint8Array(laneRows),
		} satisfies SpectrogramLanePlacement & Record<string, unknown>;
	});

	const order: number[] = [];
	const priorityStart = Math.max(0, Math.floor(range.priorityStart));
	const priorityEnd = Math.min(drawColumns, Math.ceil(range.priorityEnd));
	for (let column = priorityStart; column < priorityEnd; column += 1) {
		order.push(column);
	}
	for (let column = 0; column < drawColumns; column += 1) {
		if (column < priorityStart || column >= priorityEnd) {
			order.push(column);
		}
	}

	const sums = new Float64Array(rows);
	let complete = true;
	for (const column of order) {
		const index = range.firstColumn + column;
		for (const lane of lanes) {
			if (renderer.hasColumn(lane.cache, index)) {
				continue;
			}
			if (performance.now() >= deadline) {
				complete = false;
				continue;
			}
			composeColumn(
				lane.frames,
				index * lane.samplesPerColumn,
				(index + 1) * lane.samplesPerColumn,
				state.settings,
				sums,
				lane.values,
			);
			renderer.setColumn(lane.cache, index, lane.values);
		}
	}

	const drawing = renderer.draw(
		columns,
		rows,
		lanes,
		range.firstColumn,
		drawColumns,
		parseCssColor(colors.background),
		parseCssColor(colors.color),
	);
	context.imageSmoothingEnabled = false;
	context.drawImage(drawing, 0, 0, columns, rows, 0, 0, canvas.width, rows);

	context.fillStyle = colors.divider;
	const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
	for (let lane = 1; lane < readers.length; lane += 1) {
		context.fillRect(
			0,
			Math.round((rows * lane) / readers.length - pixelRatio / 2),
			canvas.width,
			Math.max(1, Math.round(pixelRatio)),
		);
	}
	return complete;
}

/** The deadline of one redraw's columns, from now. */
export function getSpectrogramDeadline(): number {
	return performance.now() + COMPOSE_BUDGET_MS;
}

/** A spectrogram with nothing to show yet: its background. */
export function renderSpectrogramPlaceholder(
	canvas: HTMLCanvasElement,
	cssWidth: number,
	cssHeight: number,
	colors: SpectrogramColors,
): void {
	const context = resizeCanvasForCssSize(canvas, cssWidth, cssHeight);
	if (!context) {
		return;
	}
	context.fillStyle = colors.background;
	context.fillRect(0, 0, cssWidth, cssHeight);
}

interface AxisTick {
	frequency: number;
	label: string;
	/** Lower comes first when ticks compete for space. */
	priority: number;
}

function formatHertz(frequency: number): string {
	return frequency >= 1000
		? `${String(Number((frequency / 1000).toFixed(2)))} kHz`
		: `${String(Number(frequency.toFixed(1)))} Hz`;
}

/** Round frequencies from 1 Hz to 100 kHz, the rounder ones first. */
function buildHertzTicks(
	settings: SpectrogramSettings,
	low: number,
	high: number,
	laneHeight: number,
): AxisTick[] {
	const ticks: AxisTick[] = [];
	if (settings.frequencyScale === "linear") {
		// Evenly spaced, as far apart as the labels need.
		const rough = ((high - low) * MIN_TICK_SPACING * 2) / laneHeight;
		const magnitude = 10 ** Math.floor(Math.log10(rough));
		const step =
			[1, 2, 5, 10]
				.map((factor) => factor * magnitude)
				.find((value) => value >= rough) ?? 10 * magnitude;
		for (
			let frequency = Math.ceil(low / step) * step;
			frequency <= high;
			frequency += step
		) {
			ticks.push({ frequency, label: formatHertz(frequency), priority: 0 });
		}
		return ticks;
	}

	for (let exponent = 0; exponent <= 5; exponent += 1) {
		const decade = 10 ** exponent;
		[1, 5, 2].forEach((factor, priority) => {
			const frequency = factor * decade;
			if (frequency >= low && frequency <= high) {
				ticks.push({ frequency, label: formatHertz(frequency), priority });
			}
		});
	}
	return ticks;
}

/** The C of every octave, the ones of every other octave first. */
function buildMidiTicks(low: number, high: number): AxisTick[] {
	const ticks: AxisTick[] = [];
	for (let midi = 0; midi <= 132; midi += 12) {
		const frequency = 440 * 2 ** ((midi - 69) / 12);
		if (frequency >= low && frequency <= high) {
			ticks.push({
				frequency,
				label: formatMidiNoteName(midi),
				priority: (midi / 12) % 2,
			});
		}
	}
	return ticks;
}

/**
 * Labels the frequency axis of every lane, keeping only labels far enough
 * apart to read. Rebuilt whenever the lane height or the sample rate changes.
 */
export function updateSpectrogramAxis(
	state: SpectrogramSurfaceState,
	height: number,
	sampleRate: number,
): void {
	const laneHeight = height / Math.max(1, state.axisNodes.length);
	const key = [getSpectrogramSettingsKey(state), laneHeight, sampleRate].join(
		"#",
	);
	if (state.axisKey === key) {
		return;
	}
	state.axisKey = key;

	const { settings } = state;
	const range =
		sampleRate > 0 ? resolveFrequencyRange(settings, sampleRate) : null;
	const ticks: Array<AxisTick & { y: number }> = [];
	if (range) {
		const scale = settings.frequencyScale;
		const low = toFrequencyScale(scale, range.low);
		const high = toFrequencyScale(scale, range.high);
		const candidates =
			settings.axisLabels === "midi"
				? buildMidiTicks(range.low, range.high)
				: buildHertzTicks(settings, range.low, range.high, laneHeight);
		candidates
			.map((tick) => ({
				...tick,
				// From the bottom of the lane, in CSS pixels.
				y:
					((toFrequencyScale(scale, tick.frequency) - low) / (high - low)) *
					laneHeight,
			}))
			.filter(
				(tick) =>
					tick.y >= TICK_BOTTOM_CLEARANCE &&
					tick.y <= laneHeight - TICK_TOP_CLEARANCE,
			)
			.sort((a, b) => a.priority - b.priority || a.frequency - b.frequency)
			.forEach((tick) => {
				if (
					ticks.every((kept) => Math.abs(kept.y - tick.y) >= MIN_TICK_SPACING)
				) {
					ticks.push(tick);
				}
			});
		ticks.sort((a, b) => a.frequency - b.frequency);
	}

	state.axisNodes.forEach((axis) => {
		axis.replaceChildren(
			...ticks.map((tick) => {
				const node = document.createElement("div");
				node.className = "spectrogram-axis-tick";
				node.style.bottom = `${(tick.y / laneHeight) * 100}%`;
				node.textContent = tick.label;
				return node;
			}),
		);
	});
}
