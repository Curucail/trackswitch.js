import { formatMidiNoteName, isBlackKey } from "../shared/midi-notes";
import { resizeCanvasForCssSize } from "./timeline-surface";

/**
 * The keyboard column beside a piano roll. Its near edge — the one the notes
 * fly into — carries one row per semitone, exactly the grid the roll draws on,
 * so a note bar meets its key. Its far edge carries seven equal white keys per
 * octave, with the black keys stopping short of it, which is what makes the
 * column read as a keyboard rather than as a strip of twelve equal slots.
 */

/** Share of the column the black keys reach, measured from the note edge. */
const BLACK_KEY_LENGTH_RATIO = 0.7;
/** A label needs at least this much white key to sit in. */
const LABEL_MIN_KEY_HEIGHT = 9;
const LABEL_FONT_SIZE = 9;

export interface PianoRollKeyboardColors {
	white: string;
	black: string;
	border: string;
	label: string;
	labelFont: string;
}

export interface PianoRollKeyboardOptions {
	minMidi: number;
	maxMidi: number;
	height: number;
	colors: PianoRollKeyboardColors;
	/**
	 * Sounding pitches, each with the colours lighting its key in channel order.
	 * Several colours split the key along its length, one box each.
	 */
	active: ReadonlyMap<number, string[]>;
}

export function resolvePianoRollKeyboardColors(
	canvas: HTMLCanvasElement,
): PianoRollKeyboardColors {
	const computed = getComputedStyle(canvas);
	const read = (property: string, fallback: string): string =>
		computed.getPropertyValue(property).trim() || fallback;
	return {
		white: read("--piano-roll-keyboard-white", "#ffffff"),
		black: read("--piano-roll-keyboard-black", "#222222"),
		border: read("--piano-roll-keyboard-border", "rgba(0, 0, 0, 0.35)"),
		label: read("--piano-roll-keyboard-label", "#808080"),
		labelFont: `${LABEL_FONT_SIZE}px ${read("--ts-font-ui", "sans-serif")}`,
	};
}

const SEMITONES_PER_OCTAVE = 12;
/** Position of each semitone in the white-key sequence; -1 for a black key. */
const WHITE_INDEX_IN_OCTAVE = [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6];

/**
 * Two white keys meet with no black key between them — B/C and E/F — so those
 * two boundaries are the only ones drawn out in the open, and they have to land
 * exactly on the semitone row they share or the key visibly kinks there. Every
 * other boundary hides under a black key, which swallows the step between the
 * band and the row. So the octave is cut at E/F and each half shares its
 * semitones evenly: C D E over five, F G A B over seven. The two resulting key
 * heights are 5/3 and 7/4 of a row — a 5% difference, invisible beside the
 * crinkle that forcing all seven to 12/7 would leave at every E/F.
 */
const LOWER_WHITE_KEYS = 3;
const UPPER_WHITE_KEYS = 4;
const LOWER_SEMITONES = 5;
const UPPER_SEMITONES = SEMITONES_PER_OCTAVE - LOWER_SEMITONES;

/**
 * A white key's far-side band, in semitones, anchored to its own pitch rather
 * than to whatever keys happen to be visible — spreading bands over the visible
 * range instead would drift against the semitone rows on any range that is not
 * a whole number of octaves, and a key would end up stepping clear of its row.
 */
function whiteKeyBand(midi: number): { bottom: number; top: number } {
	const octave = Math.floor(midi / SEMITONES_PER_OCTAVE);
	const index = WHITE_INDEX_IN_OCTAVE[midi - octave * SEMITONES_PER_OCTAVE];
	const inLowerHalf = index < LOWER_WHITE_KEYS;
	const height = inLowerHalf
		? LOWER_SEMITONES / LOWER_WHITE_KEYS
		: UPPER_SEMITONES / UPPER_WHITE_KEYS;
	const bottom =
		octave * SEMITONES_PER_OCTAVE +
		(inLowerHalf
			? index * height
			: LOWER_SEMITONES + (index - LOWER_WHITE_KEYS) * height);
	return { bottom, top: bottom + height };
}

/**
 * Every white key whose far-side band can reach the drawing, from the highest
 * pitch down. The band of a key is wider than its row, so the keys just past
 * each end still have to be drawn — clipped — for the column to look continuous.
 */
function collectWhiteKeys(minMidi: number, maxMidi: number): number[] {
	const whiteKeys: number[] = [];
	for (let midi = maxMidi + 2; midi >= minMidi - 2; midi -= 1) {
		if (!isBlackKey(midi)) {
			whiteKeys.push(midi);
		}
	}
	return whiteKeys;
}

/** The two horizontal boundaries a key spans: on the far edge, and on the note edge. */
interface KeyBands {
	farTop: number;
	farBottom: number;
	nearTop: number;
	nearBottom: number;
}

/**
 * The far band (7 keys/octave) and the near row (12 keys/octave) rarely line
 * up, so every white key is a step rather than a rectangle: a tall slab out to
 * `blackStart` at the far band's height, then a one-row tongue reaching the
 * near edge, flush with the black keys beside it. The two heights meet on a
 * vertical segment at `blackStart`, so the key is drawn from horizontals and
 * verticals only — no diagonal, which is what a real keyboard looks like.
 * How far the step juts either way differs per key, exactly as the notches
 * between the black keys of a piano do.
 */
function traceWhiteKey(
	context: CanvasRenderingContext2D,
	bands: KeyBands,
	blackStart: number,
	width: number,
): void {
	const { farTop, farBottom, nearTop, nearBottom } = bands;
	context.beginPath();
	context.moveTo(0, farTop);
	context.lineTo(blackStart, farTop);
	context.lineTo(blackStart, nearTop);
	context.lineTo(width, nearTop);
	context.lineTo(width, nearBottom);
	context.lineTo(blackStart, nearBottom);
	context.lineTo(blackStart, farBottom);
	context.lineTo(0, farBottom);
	context.closePath();
}

/** Fills a box with the colours of everything sounding on it, side by side. */
function fillActiveBoxes(
	context: CanvasRenderingContext2D,
	colors: string[],
	left: number,
	top: number,
	width: number,
	height: number,
): void {
	const boxWidth = width / colors.length;
	colors.forEach((color, index) => {
		context.fillStyle = color;
		context.fillRect(left + index * boxWidth, top, boxWidth, height);
	});
}

export function drawPianoRollKeyboard(
	canvas: HTMLCanvasElement,
	options: PianoRollKeyboardOptions,
): void {
	const width = Math.max(1, canvas.clientWidth);
	const height = Math.max(1, options.height);
	const context = resizeCanvasForCssSize(canvas, width, height);
	if (!context) {
		return;
	}

	const { minMidi, maxMidi, colors, active } = options;
	const range = Math.max(1, maxMidi - minMidi + 1);
	const rowHeight = height / range;
	const blackStart = width * (1 - BLACK_KEY_LENGTH_RATIO);
	const whiteKeys = collectWhiteKeys(minMidi, maxMidi);
	// The pitch axis in canvas coordinates, in semitones rather than in rows, so
	// the far-side bands — 12 rows to every 7 keys — can be placed on it.
	const semitoneY = (semitone: number): number =>
		(maxMidi + 1 - semitone) * rowHeight;
	const nearTop = (midi: number): number => semitoneY(midi + 1);

	context.lineWidth = 1;
	context.strokeStyle = colors.border;
	context.textBaseline = "middle";
	context.font = colors.labelFont;

	whiteKeys.forEach((midi) => {
		const band = whiteKeyBand(midi);
		const bands: KeyBands = {
			farTop: semitoneY(band.top),
			farBottom: semitoneY(band.bottom),
			nearTop: nearTop(midi),
			nearBottom: nearTop(midi) + rowHeight,
		};
		traceWhiteKey(context, bands, blackStart, width);
		context.fillStyle = colors.white;
		context.fill();

		const activeColors = active.get(midi);
		if (activeColors && activeColors.length > 0) {
			context.save();
			context.clip();
			fillActiveBoxes(
				context,
				activeColors,
				0,
				Math.min(bands.farTop, bands.nearTop),
				width,
				Math.max(bands.farBottom, bands.nearBottom) -
					Math.min(bands.farTop, bands.nearTop),
			);
			context.restore();
		}

		context.stroke();

		if (
			midi % SEMITONES_PER_OCTAVE === 0 &&
			bands.farBottom - bands.farTop >= LABEL_MIN_KEY_HEIGHT
		) {
			context.fillStyle = colors.label;
			context.fillText(
				formatMidiNoteName(midi),
				3,
				(bands.farTop + bands.farBottom) / 2,
			);
		}
	});

	// Black keys last: they overlap the white keys they sit between, and are
	// short, so the far half of the column stays a plain seven-key octave.
	for (let midi = maxMidi; midi >= minMidi; midi -= 1) {
		if (!isBlackKey(midi)) {
			continue;
		}

		const top = nearTop(midi);
		context.fillStyle = colors.black;
		context.fillRect(blackStart, top, width - blackStart, rowHeight);

		const activeColors = active.get(midi);
		if (activeColors && activeColors.length > 0) {
			fillActiveBoxes(
				context,
				activeColors,
				blackStart,
				top,
				width - blackStart,
				rowHeight,
			);
		}

		context.strokeRect(
			blackStart,
			top + 0.5,
			width - blackStart,
			rowHeight - 1,
		);
	}
}
