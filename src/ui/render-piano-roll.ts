import { Midi } from "@tonejs/midi";
import type {
	MidiNoteRange,
	TrackRuntime,
	TrackSwitchPianoRollViewConfig,
	TrackSwitchUiState,
	WaveformPlaybackFollowMode,
} from "../domain/types";
import { applyCssOverrides } from "../shared/dom";
import { parseMidiNoteRef } from "../shared/midi-notes";
import {
	drawPianoRollKeyboard,
	type PianoRollKeyboardColors,
	resolvePianoRollKeyboardColors,
} from "./render-piano-roll-keyboard";
import {
	clampTimelineValue,
	getTimelineMaximumZoom,
	getTimelineSurfaceWidth,
	getTimelineTimeWidth,
	getTimelineViewportState,
	MIN_TIMELINE_ZOOM,
	positionTileCanvas,
	reflowTimelineSurface,
	refreshTimelineViewportWidth,
	resizeCanvasForCssSize,
	resolveTimelineBaseWidth,
	resolveTimelineDefaultZoom,
	resolveTimelinePlaybackFollowScrollLeft,
	resolveVisibleTileWindow,
	sanitizeTimelineDuration,
	setTimelineZoomForSurface,
	updateTimelineMinimapViewport,
} from "./timeline-surface";
import type { ConfiguredViewHost, ViewRenderer } from "./view-renderer";

const MIN_PIANO_ROLL_ZOOM = MIN_TIMELINE_ZOOM;
const PIANO_ROLL_RANGE_PADDING = 2;
const MIN_PIANO_ROLL_NOTE_WIDTH = 1;
/** Below this row height an outline would swallow the note body, so skip it. */
const PIANO_ROLL_NOTE_BORDER_MIN_HEIGHT = 4;
/** A velocity bar is only legible once the note rect is at least this large. */
const PIANO_ROLL_VELOCITY_BAR_MIN_HEIGHT = 8;
const PIANO_ROLL_VELOCITY_BAR_MIN_WIDTH = 6;
/** Below this a checkerboard cell reads as noise rather than as a pattern. */
const MIN_CHECKERBOARD_CELL = 6;
/** The window a keyboard roll opens on when the view names no `defaultZoom`. */
const DEFAULT_PIANO_KEYBOARD_ZOOM_SECONDS = 10;

/** How many channel colours the stylesheet declares, cycled past the last one. */
const PIANO_ROLL_CHANNEL_PALETTE_SIZE = 10;

interface MidiNoteEvent {
	midi: number;
	time: number;
	duration: number;
	name: string;
	velocity: number;
	channel: number;
}

export interface PianoRollNoteColors {
	fill: string;
	border: string;
	velocity: string;
	/** Contrast colour for a velocity bar drawn on a solid note body. */
	velocityBar: string;
}

export interface PianoRollSeekSurfaceMetadata {
	wrapper: HTMLElement;
	scrollContainer: HTMLElement;
	surface: HTMLElement;
	noteCanvas: HTMLCanvasElement;
	overlay: HTMLElement;
	seekWrap: HTMLElement;
	source: string;
	alignmentColumn: string | null;
	/** The media entry this roll draws, which is also its timeline id. */
	mediaId: string;
	playbackFollowMode: WaveformPlaybackFollowMode;
	trailingPadPx: number;
	originalHeight: number;
	/** The configured `height`, immutable — the base a fullscreen grow restores to. */
	configuredHeight: number;
	/** `maxZoom` and `defaultZoom` as configured, in the unit of this view's medium. */
	maxZoomValue: number;
	defaultZoomValue: number | null;
	/** The same two in seconds, resolved once the timeline readouts are known. */
	maxZoomSeconds: number;
	defaultZoomSeconds: number | null;
	zoomUnitsResolved: boolean;
	/** Whether `defaultZoom` has opened this surface; a user zoom is never stomped. */
	defaultZoomApplied: boolean;
	baseWidth: number;
	zoom: number;
	timingNode: HTMLElement | null;
	zoomNode: HTMLElement;
	zoomMinimapNode: HTMLElement;
	zoomCanvas: HTMLCanvasElement;
	zoomViewportNode: HTMLElement;
	/** The keyboard column, drawn beside the roll when `pianoKeyboard` is on. */
	keyboardCanvas: HTMLCanvasElement | null;
	/** Serialized sounding pitches, so the keyboard only redraws when they change. */
	lastKeyboardKey: string | null;
	/** The position the keys were last drawn for, so a reflow can repeat it. */
	lastKeyboardPosition: number;
	keyboardColors: PianoRollKeyboardColors | null;
	/** Parsed file, cached so the header is available for tick conversion. */
	midi: Midi | null;
	notes: MidiNoteEvent[];
	/** The configured pitch axis; `"automatic"` derives it from the file. */
	noteRange: "automatic" | [number, number];
	/** Whether note events carry a velocity bar, and whether velocity fades them. */
	velocityBars: boolean;
	velocityOpacity: boolean;
	minMidi: number;
	maxMidi: number;
	pianoRollDurationSeconds: number;
	/** Longest note in `notes`; lets the draw loop bound its backwards scan. */
	maxNoteDuration: number;
	/** The audio tracks each paired channel follows, from the view config. */
	channelTrackIds: Map<number, string[]>;
	/** Whether every channel in the file takes its own palette colour. */
	colorPerChannel: boolean;
	/** Palette slot of a coloured channel, by ascending channel number. */
	channelPaletteIndex: Map<number, number>;
	/** Channels currently silent, and so left out of the drawing. */
	hiddenChannels: Set<number>;
	noteColors: PianoRollNoteColors | null;
	/** Resolved colours per palette slot, alongside the `noteColors` cache. */
	channelColors: Map<number, PianoRollNoteColors>;
	lastRenderKey: string | null;
	lastMinimapKey: string | null;
	lastPlaybackKey: string | null;
	lastFollowScrollLeft: number | null;
}

interface PianoRollTimelineContext {
	duration: number;
	toReferenceTime(timelineTime: number): number;
	fromReferenceTime(referenceTime: number): number;
	/** See `WaveformTimelineContext.getPlaybackPosition`. */
	playbackPosition?(): number | null;
}

export type PianoRollTimelineContextResolver = (
	surface: PianoRollSeekSurfaceMetadata,
) => PianoRollTimelineContext | null;

function clampTime(value: number, minimum: number, maximum: number): number {
	return clampTimelineValue(value, minimum, maximum);
}

function sanitizeDuration(value: number): number {
	return sanitizeTimelineDuration(value);
}

/** The player draws the piano roll itself, so the seek surface spans it exactly. */
function buildSeekWrap(): string {
	return (
		'<div class="seekwrap">' +
		'<div class="loop-region"></div>' +
		'<div class="loop-marker marker-a"></div>' +
		'<div class="loop-marker marker-b"></div>' +
		'<div class="seekhead"></div>' +
		"</div>"
	);
}

function getPianoRollSurfaceWidth(
	surface: PianoRollSeekSurfaceMetadata,
): number {
	return getTimelineSurfaceWidth(surface);
}

/** The stretch of surface the MIDI file itself occupies, without the trailing pad. */
function getPianoRollTimeWidth(surface: PianoRollSeekSurfaceMetadata): number {
	return getTimelineTimeWidth(surface);
}

function getPianoRollMaximumZoom(
	surface: PianoRollSeekSurfaceMetadata,
	durationSeconds: number,
): number {
	return getTimelineMaximumZoom(durationSeconds, surface.maxZoomSeconds);
}

function getPianoRollViewportState(surface: PianoRollSeekSurfaceMetadata): {
	startRatio: number;
	widthRatio: number;
} {
	return getTimelineViewportState(surface);
}

function updatePianoRollMinimapViewport(
	surface: PianoRollSeekSurfaceMetadata,
): void {
	updateTimelineMinimapViewport(surface);
}

function setPianoRollSurfaceWidth(
	surface: PianoRollSeekSurfaceMetadata,
	width?: number,
): void {
	const surfaceWidth = width ?? getPianoRollSurfaceWidth(surface);
	surface.surface.style.width = `${surfaceWidth}px`;
	surface.surface.style.height = `${surface.originalHeight}px`;
	surface.noteCanvas.style.height = `${surface.originalHeight}px`;
	// The seek surface covers the file, not the pad past its end, so a seek
	// ratio, a loop marker and a marker layer all still land on the right time.
	surface.seekWrap.style.width = `${getPianoRollTimeWidth(surface)}px`;
	updatePianoRollMinimapViewport(surface);
}

/** Resizes a surface's rendered height (fullscreen growth/restore) and redraws it. */
export function setPianoRollSurfaceHeight(
	ctx: ViewRenderer,
	surface: PianoRollSeekSurfaceMetadata,
	height: number,
): void {
	(function (
		this: ViewRenderer,
		surface: PianoRollSeekSurfaceMetadata,
		height: number,
	) {
		if (surface.originalHeight === height) {
			return;
		}

		surface.originalHeight = height;
		surface.surface.style.height = `${height}px`;
		surface.noteCanvas.style.height = `${height}px`;
		if (surface.keyboardCanvas) {
			surface.keyboardCanvas.style.height = `${height}px`;
			surface.lastKeyboardKey = null;
		}
		surface.lastRenderKey = null;
		surface.lastMinimapKey = null;
		this.refreshPianoRollNoteTiles();
	}).call(ctx, surface, height);
}

function setPianoRollZoomForSurface(
	surface: PianoRollSeekSurfaceMetadata,
	zoom: number,
	maximum: number,
	anchorPageX?: number,
): boolean {
	return setTimelineZoomForSurface(
		surface,
		zoom,
		maximum,
		anchorPageX,
		setPianoRollSurfaceWidth,
	);
}

function createPianoRollTimingNode(overlay: HTMLElement): HTMLElement {
	const timing = document.createElement("div");
	timing.className = "piano-roll-timing";
	timing.textContent = "--:--:--:--- / --:--:--:---";
	overlay.appendChild(timing);
	return timing;
}

function createPianoRollZoomNode(overlay: HTMLElement): HTMLElement {
	const zoom = document.createElement("div");
	zoom.className = "piano-roll-zoom";
	zoom.innerHTML =
		'<span class="piano-roll-zoom-label">Zoom</span>' +
		'<div class="piano-roll-zoom-minimap">' +
		'<canvas class="piano-roll-zoom-canvas"></canvas>' +
		'<div class="piano-roll-zoom-viewport"></div>' +
		"</div>";
	zoom.style.display = "none";
	overlay.appendChild(zoom);
	return zoom;
}

function flattenMidiNotes(midi: Midi, source: string): MidiNoteEvent[] {
	const notes: MidiNoteEvent[] = [];
	for (const track of midi.tracks) {
		for (const note of track.notes) {
			notes.push({
				midi: note.midi,
				time: note.time,
				duration: note.duration,
				name: note.name,
				velocity: note.velocity,
				// A note carries no channel of its own; it belongs to its track.
				channel: track.channel,
			});
		}
	}

	if (notes.length === 0) {
		throw new Error(`MIDI file contains no note events: ${source}`);
	}

	notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
	applyRetriggers(notes);
	return notes;
}

/**
 * A second note-on for a pitch already sounding on the same channel is a
 * re-trigger: the note that was running ends there. The parser pairs note-ons
 * with note-offs first-in-first-out, which would otherwise leave two notes
 * overlapping on one row — a shape the drawing reserves for two channels
 * sounding the same pitch at once.
 */
function applyRetriggers(notes: MidiNoteEvent[]): void {
	const sounding = new Map<number, MidiNoteEvent>();
	for (const note of notes) {
		const voice = note.channel * 128 + note.midi;
		const previous = sounding.get(voice);
		if (previous && previous.time + previous.duration > note.time) {
			previous.duration = Math.max(0, note.time - previous.time);
		}
		sounding.set(voice, note);
	}
}

function applyMidiNotes(
	surface: PianoRollSeekSurfaceMetadata,
	notes: MidiNoteEvent[],
): void {
	let minMidi = Number.POSITIVE_INFINITY;
	let maxMidi = Number.NEGATIVE_INFINITY;
	let durationSeconds = 0;
	let maxNoteDuration = 0;
	for (const note of notes) {
		minMidi = Math.min(minMidi, note.midi);
		maxMidi = Math.max(maxMidi, note.midi);
		durationSeconds = Math.max(durationSeconds, note.time + note.duration);
		maxNoteDuration = Math.max(maxNoteDuration, note.duration);
	}

	// An automatic range spans every note, hidden channels included, so that
	// switching a channel off leaves the pitch axis — and every remaining note —
	// where it is. A configured one stands as written.
	surface.notes = notes;
	if (surface.noteRange === "automatic") {
		surface.minMidi = Math.floor(minMidi) - PIANO_ROLL_RANGE_PADDING;
		surface.maxMidi = Math.ceil(maxMidi) + PIANO_ROLL_RANGE_PADDING;
	} else {
		[surface.minMidi, surface.maxMidi] = surface.noteRange;
	}
	surface.pianoRollDurationSeconds = durationSeconds;
	surface.maxNoteDuration = maxNoteDuration;
	assignChannelPalette(surface, notes);
	surface.lastRenderKey = null;
	surface.lastMinimapKey = null;
}

/**
 * Hands out palette slots by ascending channel number, once the file's own
 * channels are known. With `colorPerChannel` on, every channel the file uses
 * gets a slot — paired with a track or not — so the block is a pure
 * audibility pairing and coloring no longer depends on it. Off, no channel
 * gets a slot and every note falls back to the plain, unpaired colour.
 */
function assignChannelPalette(
	surface: PianoRollSeekSurfaceMetadata,
	notes: MidiNoteEvent[],
): void {
	surface.channelPaletteIndex.clear();
	surface.channelColors.clear();
	if (!surface.colorPerChannel) {
		return;
	}

	const channels = new Set<number>(surface.channelTrackIds.keys());
	for (const note of notes) {
		channels.add(note.channel);
	}

	[...channels]
		.sort((a, b) => a - b)
		.forEach((channel, index) => {
			surface.channelPaletteIndex.set(
				channel,
				(index % PIANO_ROLL_CHANNEL_PALETTE_SIZE) + 1,
			);
		});
}

function resolvePianoRollNoteColors(
	surface: PianoRollSeekSurfaceMetadata,
): PianoRollNoteColors {
	if (surface.noteColors) {
		return surface.noteColors;
	}

	const computed = getComputedStyle(surface.noteCanvas);
	const read = (property: string, fallback: string): string =>
		computed.getPropertyValue(property).trim() || fallback;
	const colors: PianoRollNoteColors = {
		fill: read("--piano-roll-note-fill", "rgba(0, 0, 0, 0.3)"),
		border: read("--piano-roll-note-border", "rgba(0, 0, 0, 0.55)"),
		velocity: read("--piano-roll-note-color", "#000"),
		velocityBar: read("--piano-roll-velocity-bar", "rgba(255, 255, 255, 0.85)"),
	};
	surface.noteColors = colors;
	return colors;
}

/**
 * The colours of one channel: its palette slot when the view pairs it with a
 * track, and the plain note colours when it does not.
 */
function resolvePianoRollChannelColors(
	surface: PianoRollSeekSurfaceMetadata,
	channel: number,
): PianoRollNoteColors {
	const paletteIndex = surface.channelPaletteIndex.get(channel);
	if (paletteIndex === undefined) {
		return resolvePianoRollNoteColors(surface);
	}

	const cached = surface.channelColors.get(paletteIndex);
	if (cached) {
		return cached;
	}

	const computed = getComputedStyle(surface.noteCanvas);
	const read = (property: string): string =>
		computed.getPropertyValue(property).trim();
	const colors: PianoRollNoteColors = {
		fill: read(`--piano-roll-channel-${paletteIndex}-fill`),
		border: read(`--piano-roll-channel-${paletteIndex}-border`),
		velocity: read(`--piano-roll-channel-${paletteIndex}-color`),
		velocityBar: read("--piano-roll-velocity-bar"),
	};
	surface.channelColors.set(paletteIndex, colors);
	return colors;
}

/** A draw key ingredient, so hiding a channel invalidates the memoized render. */
function hiddenChannelsKey(surface: PianoRollSeekSurfaceMetadata): string {
	return [...surface.hiddenChannels].sort((a, b) => a - b).join(",");
}

/**
 * Notes are solid unless the view asks for velocity to fade them, in which case
 * the softest note still keeps a third of its opacity.
 */
function resolveNoteAlpha(
	surface: PianoRollSeekSurfaceMetadata,
	note: MidiNoteEvent,
): number {
	return surface.velocityOpacity
		? 0.35 + clampTime(note.velocity, 0, 1) * 0.55
		: 1;
}

/**
 * The body colour of a note. Fading by velocity draws on the soft channel
 * colour, which is translucent by design; drawing solid takes the full one, so
 * "no velocity" really means one flat block of the channel's colour.
 */
function resolveNoteFill(
	surface: PianoRollSeekSurfaceMetadata,
	channel: number,
): string {
	const colors = resolvePianoRollChannelColors(surface, channel);
	return surface.velocityOpacity ? colors.fill : colors.velocity;
}

/**
 * Index of the first note that can still overlap `startTime`. Notes are sorted
 * by start time, so anything beginning more than `maxNoteDuration` earlier has
 * certainly ended before the window opens.
 */
function findFirstVisibleNoteIndex(
	notes: MidiNoteEvent[],
	startTime: number,
): number {
	let low = 0;
	let high = notes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (notes[middle].time < startTime) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
}

function renderPianoRollMinimap(
	surface: PianoRollSeekSurfaceMetadata,
	durationSeconds: number,
): void {
	const width = Math.max(1, surface.zoomMinimapNode.clientWidth);
	const height = Math.max(1, surface.zoomMinimapNode.clientHeight);
	const drawKey = [
		Math.round(width),
		Math.round(height),
		Math.round(durationSeconds * 1000),
		surface.notes.length,
		surface.minMidi,
		surface.maxMidi,
		hiddenChannelsKey(surface),
		Math.max(1, window.devicePixelRatio || 1),
	].join("#");
	if (surface.lastMinimapKey === drawKey) {
		updatePianoRollMinimapViewport(surface);
		return;
	}

	const context = resizeCanvasForCssSize(surface.zoomCanvas, width, height);
	if (!context) {
		return;
	}

	const safeDuration = sanitizeDuration(durationSeconds);
	const range = Math.max(1, surface.maxMidi - surface.minMidi + 1);
	for (const note of surface.notes) {
		if (safeDuration <= 0 || surface.hiddenChannels.has(note.channel)) {
			continue;
		}

		context.fillStyle = resolvePianoRollChannelColors(
			surface,
			note.channel,
		).velocity;
		const x = (note.time / safeDuration) * width;
		const w = Math.max(1, (note.duration / safeDuration) * width);
		const y = ((surface.maxMidi - note.midi) / range) * height;
		const h = Math.max(1, height / range);
		context.globalAlpha = resolveNoteAlpha(surface, note);
		context.fillRect(x, y, w, h);
	}
	context.globalAlpha = 1;
	surface.lastMinimapKey = drawKey;
	updatePianoRollMinimapViewport(surface);
}

/**
 * Draws the notes onto a single viewport-sized canvas that slides over the
 * virtual surface, mirroring the waveform tile layer. Only the notes intersecting
 * the buffered window are visited, so the cost tracks the viewport rather than
 * the size of the MIDI file.
 */
function renderPianoRollNotes(
	surface: PianoRollSeekSurfaceMetadata,
	durationSeconds: number,
): void {
	const height = surface.originalHeight;
	const safeDuration = sanitizeDuration(durationSeconds);
	const tileWindow = resolveVisibleTileWindow(surface, height);
	positionTileCanvas(surface.noteCanvas, tileWindow);

	const { tileStartPx, tileCssWidth, tileCssHeight, surfaceWidth } = tileWindow;
	const timeWidth = getPianoRollTimeWidth(surface);
	const renderKey = [
		tileStartPx,
		tileCssWidth,
		tileCssHeight,
		surfaceWidth,
		Math.round(safeDuration * 1000),
		surface.notes.length,
		surface.minMidi,
		surface.maxMidi,
		hiddenChannelsKey(surface),
		surface.velocityBars ? "1" : "0",
		surface.velocityOpacity ? "1" : "0",
		Math.max(1, window.devicePixelRatio || 1),
	].join("#");
	if (surface.lastRenderKey === renderKey) {
		return;
	}

	const context = resizeCanvasForCssSize(
		surface.noteCanvas,
		tileCssWidth,
		tileCssHeight,
	);
	if (!context) {
		return;
	}

	surface.lastRenderKey = renderKey;
	if (safeDuration <= 0 || surfaceWidth <= 0) {
		return;
	}

	// Draw in surface coordinates; the canvas only covers [tileStartPx, +width).
	context.translate(-tileStartPx, 0);

	const range = Math.max(1, surface.maxMidi - surface.minMidi + 1);
	const rowHeight = height / range;
	const noteHeight = Math.max(3, rowHeight - 2);
	const pixelsPerSecond = timeWidth / safeDuration;
	const visibleStartTime = tileStartPx / pixelsPerSecond;
	const visibleEndTime = (tileStartPx + tileCssWidth) / pixelsPerSecond;
	const drawBorder = rowHeight >= PIANO_ROLL_NOTE_BORDER_MIN_HEIGHT;
	const drawVelocityBar =
		surface.velocityBars && noteHeight >= PIANO_ROLL_VELOCITY_BAR_MIN_HEIGHT;

	context.lineWidth = 1;

	const visible = collectVisibleNotes(
		surface,
		visibleStartTime,
		visibleEndTime,
	);
	const geometry: NoteGeometry = { pixelsPerSecond, rowHeight, noteHeight };

	// Solid bodies first, then the checkerboard over the stretches where two or
	// more channels sound one pitch, then the per-note decorations on top.
	for (const note of visible) {
		const { left, width, top } = resolveNoteRect(surface, note, geometry);
		context.globalAlpha = resolveNoteAlpha(surface, note);
		context.fillStyle = resolveNoteFill(surface, note.channel);
		context.fillRect(left, top, width, noteHeight);
	}

	drawOverlapCheckerboards(context, surface, visible, geometry);

	context.globalAlpha = 1;
	for (const note of visible) {
		const { left, width, top } = resolveNoteRect(surface, note, geometry);
		const colors = resolvePianoRollChannelColors(surface, note.channel);
		if (drawBorder) {
			context.strokeStyle = colors.border;
			context.strokeRect(left + 0.5, top + 0.5, width - 1, noteHeight - 1);
		}

		if (drawVelocityBar && width >= PIANO_ROLL_VELOCITY_BAR_MIN_WIDTH) {
			const barWidth = Math.max(
				1,
				(width - 6) * clampTime(note.velocity, 0, 1),
			);
			// On a faded body the full channel colour reads as the bar; on a solid
			// one only the contrast colour does.
			context.fillStyle = surface.velocityOpacity
				? colors.velocity
				: resolvePianoRollNoteColors(surface).velocityBar;
			context.fillRect(left + 3, top + noteHeight - 5, barWidth, 3);
		}
	}
}

interface NoteGeometry {
	pixelsPerSecond: number;
	rowHeight: number;
	noteHeight: number;
}

interface NoteRect {
	left: number;
	width: number;
	top: number;
}

function resolveNoteRect(
	surface: PianoRollSeekSurfaceMetadata,
	note: MidiNoteEvent,
	geometry: NoteGeometry,
): NoteRect {
	return {
		left: note.time * geometry.pixelsPerSecond,
		width: Math.max(
			MIN_PIANO_ROLL_NOTE_WIDTH,
			note.duration * geometry.pixelsPerSecond,
		),
		top: (surface.maxMidi - note.midi) * geometry.rowHeight + 1,
	};
}

/**
 * The audible notes touching the drawn window, in file order. The binary search
 * and the early break keep the cost on the viewport rather than the file.
 */
function collectVisibleNotes(
	surface: PianoRollSeekSurfaceMetadata,
	visibleStartTime: number,
	visibleEndTime: number,
): MidiNoteEvent[] {
	const notes = surface.notes;
	const visible: MidiNoteEvent[] = [];
	const startIndex = findFirstVisibleNoteIndex(
		notes,
		visibleStartTime - surface.maxNoteDuration,
	);
	for (let index = startIndex; index < notes.length; index += 1) {
		const note = notes[index];
		if (note.time > visibleEndTime) {
			break;
		}

		if (
			note.time + note.duration < visibleStartTime ||
			surface.hiddenChannels.has(note.channel)
		) {
			continue;
		}

		visible.push(note);
	}

	return visible;
}

/**
 * Where several channels sound one pitch at the same time, their colours share
 * the stretch as a checkerboard: one row per channel, square-ish cells, and the
 * colours rotating by one row from column to column. Solid notes would otherwise
 * simply cover one another.
 */
function drawOverlapCheckerboards(
	context: CanvasRenderingContext2D,
	surface: PianoRollSeekSurfaceMetadata,
	visible: MidiNoteEvent[],
	geometry: NoteGeometry,
): void {
	const byPitch = new Map<number, MidiNoteEvent[]>();
	for (const note of visible) {
		const pitch = byPitch.get(note.midi);
		if (pitch) {
			pitch.push(note);
		} else {
			byPitch.set(note.midi, [note]);
		}
	}

	const { pixelsPerSecond, rowHeight, noteHeight } = geometry;
	for (const [midi, pitchNotes] of byPitch) {
		if (pitchNotes.length < 2) {
			continue;
		}

		const top = (surface.maxMidi - midi) * rowHeight + 1;
		for (const segment of resolveOverlapSegments(pitchNotes)) {
			const channels = segment.notes.map((note) => note.channel);
			const rows = channels.length;
			const left = segment.start * pixelsPerSecond;
			const width = Math.max(
				MIN_PIANO_ROLL_NOTE_WIDTH,
				(segment.end - segment.start) * pixelsPerSecond,
			);
			const rowPixels = noteHeight / rows;
			const cellWidth = Math.max(MIN_CHECKERBOARD_CELL, rowPixels * 2);
			const columns = Math.max(1, Math.ceil(width / cellWidth));
			for (let column = 0; column < columns; column += 1) {
				const cellLeft = left + column * cellWidth;
				const cellRight = Math.min(left + width, cellLeft + cellWidth);
				for (let row = 0; row < rows; row += 1) {
					const note = segment.notes[(row + column) % rows];
					context.globalAlpha = resolveNoteAlpha(surface, note);
					context.fillStyle = resolveNoteFill(surface, note.channel);
					context.fillRect(
						cellLeft,
						top + row * rowPixels,
						cellRight - cellLeft,
						rowPixels,
					);
				}
			}
		}
	}
}

interface OverlapSegment {
	start: number;
	end: number;
	/** The notes sounding across the whole segment, by ascending channel. */
	notes: MidiNoteEvent[];
}

/**
 * Sweeps one pitch row for the stretches covered by more than one note. The
 * parser's re-trigger pass has already removed same-channel overlaps, so every
 * segment this returns is several channels at once.
 */
function resolveOverlapSegments(notes: MidiNoteEvent[]): OverlapSegment[] {
	const boundaries = new Set<number>();
	for (const note of notes) {
		boundaries.add(note.time);
		boundaries.add(note.time + note.duration);
	}

	const sorted = [...boundaries].sort((a, b) => a - b);
	const segments: OverlapSegment[] = [];
	for (let index = 0; index + 1 < sorted.length; index += 1) {
		const start = sorted[index];
		const end = sorted[index + 1];
		if (end <= start) {
			continue;
		}

		const middle = (start + end) / 2;
		const active = notes
			.filter(
				(note) => note.time <= middle && note.time + note.duration > middle,
			)
			.sort((a, b) => a.channel - b.channel);
		if (active.length < 2) {
			continue;
		}

		const previous = segments[segments.length - 1];
		if (
			previous &&
			previous.end === start &&
			sameNotes(previous.notes, active)
		) {
			previous.end = end;
			continue;
		}

		segments.push({ start, end, notes: active });
	}

	return segments;
}

function sameNotes(left: MidiNoteEvent[], right: MidiNoteEvent[]): boolean {
	return (
		left.length === right.length &&
		left.every((note, index) => note === right[index])
	);
}

function resolvePlaybackFollowScrollLeft(
	surface: PianoRollSeekSurfaceMetadata,
	playheadRatio: number,
): number | null {
	return resolveTimelinePlaybackFollowScrollLeft(surface, playheadRatio);
}

function resolvePianoRollTimelineDuration(
	surface: PianoRollSeekSurfaceMetadata,
	playerDuration: number,
	usePianoRollLocalTimeline: boolean,
): number {
	return usePianoRollLocalTimeline
		? sanitizeDuration(surface.pianoRollDurationSeconds)
		: sanitizeDuration(playerDuration);
}

function resolvePianoRollTimelinePosition(
	surface: PianoRollSeekSurfaceMetadata,
	playerPosition: number,
	playerDuration: number,
	usePianoRollLocalTimeline: boolean,
): number {
	const duration = resolvePianoRollTimelineDuration(
		surface,
		playerDuration,
		usePianoRollLocalTimeline,
	);
	if (duration <= 0) {
		return 0;
	}

	return clampTime(playerPosition, 0, duration);
}

/**
 * The configured pitch axis as note numbers. Configuration normalization has
 * already resolved and ordered the pair; anything it let through that does not
 * parse falls back to the automatic axis rather than to a broken one.
 */
function resolveConfiguredNoteRange(
	noteRange: MidiNoteRange | undefined,
): "automatic" | [number, number] {
	if (!noteRange || noteRange === "automatic") {
		return "automatic";
	}

	const low = parseMidiNoteRef(noteRange[0]);
	const high = parseMidiNoteRef(noteRange[1]);
	if (low === null || high === null || low === high) {
		return "automatic";
	}

	return low < high ? [low, high] : [high, low];
}

/**
 * Turns the configured zoom spans into seconds. `maxZoom` and `defaultZoom` are
 * written in the unit the medium declares, which is only known once the timeline
 * readouts are in place — after the layout that built this surface.
 */
function resolvePianoRollZoomUnits(
	ctx: ViewRenderer,
	surface: PianoRollSeekSurfaceMetadata,
): void {
	if (surface.zoomUnitsResolved) {
		return;
	}

	surface.zoomUnitsResolved = true;
	surface.maxZoomSeconds = ctx.resolveLocalSpanSeconds(
		surface.mediaId,
		surface.maxZoomValue,
	);
	surface.defaultZoomSeconds =
		surface.defaultZoomValue === null
			? // A keyboard roll opens on a phrase rather than on the whole file.
				surface.keyboardCanvas
				? DEFAULT_PIANO_KEYBOARD_ZOOM_SECONDS
				: null
			: ctx.resolveLocalSpanSeconds(surface.mediaId, surface.defaultZoomValue);
}

/** Reads the `channelToTrackIDMap` block of a view into a channel → tracks lookup. */
function resolveChannelTrackIds(
	channelToTrackIDMap: Record<string, string | string[]> | undefined,
): Map<number, string[]> {
	const channelTrackIds = new Map<number, string[]>();
	if (!channelToTrackIDMap) {
		return channelTrackIds;
	}

	for (const [key, trackIds] of Object.entries(channelToTrackIDMap)) {
		channelTrackIds.set(
			Number(key),
			Array.isArray(trackIds) ? trackIds : [trackIds],
		);
	}

	return channelTrackIds;
}

export function wrapPianoRollCanvases(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.pianoRollSeekSurfaces.length = 0;

		const canvases = this.root.querySelectorAll("canvas.piano-roll");
		canvases.forEach((canvasElement: Element) => {
			if (!(canvasElement instanceof HTMLCanvasElement)) {
				return;
			}

			if (canvasElement.closest(".piano-roll-wrap")) {
				return;
			}

			const definition: ConfiguredViewHost =
				this.getConfiguredViewHost(canvasElement);
			if (definition.view.type !== "pianoRoll") return;
			const config = definition.view as TrackSwitchPianoRollViewConfig;
			const source = definition.source;
			if (!source) return;

			const wrapper = document.createElement("div");
			wrapper.className = "piano-roll-wrap ts-stack-section";
			applyCssOverrides(wrapper, config.css);

			const scrollContainer = document.createElement("div");
			scrollContainer.className = "piano-roll-scroll";

			const surface = document.createElement("div");
			surface.className = "piano-roll-surface";

			// One viewport-sized canvas slides over the virtual piano-roll surface, so the
			// note count no longer drives the DOM node count.
			const noteCanvas = document.createElement("canvas");
			noteCanvas.className = "piano-roll-note-layer";

			const overlay = document.createElement("div");
			overlay.className = "piano-roll-overlay";

			const parent = canvasElement.parentElement;
			if (!parent) {
				return;
			}

			// The keyboard is a column beside the scroller rather than part of the
			// scrolled surface, so the notes travel into keys that stay put.
			const pianoKeyboard = config.pianoKeyboard === true;
			let keyboardCanvas: HTMLCanvasElement | null = null;
			if (pianoKeyboard) {
				wrapper.classList.add("piano-roll-has-keyboard");
				keyboardCanvas = document.createElement("canvas");
				keyboardCanvas.className = "piano-roll-keyboard";
			}

			parent.insertBefore(wrapper, canvasElement);
			if (keyboardCanvas) {
				wrapper.appendChild(keyboardCanvas);
			}
			wrapper.appendChild(scrollContainer);
			scrollContainer.appendChild(surface);
			surface.appendChild(noteCanvas);
			surface.insertAdjacentHTML("beforeend", buildSeekWrap());
			wrapper.appendChild(overlay);
			canvasElement.remove();

			const seekWrap = surface.querySelector(".seekwrap");
			if (!(seekWrap instanceof HTMLElement)) {
				return;
			}
			this.registerSeekMarkerLayers(seekWrap, config.markerLayers);
			this.registerSeekTimeline(
				seekWrap,
				definition.alignmentTimeline?.trim() || null,
			);
			seekWrap.setAttribute("data-seek-surface", "piano-roll");

			const channelTrackIds = resolveChannelTrackIds(
				config.channelToTrackIDMap,
			);

			const originalHeight = Math.max(1, canvasElement.height);
			surface.style.height = `${originalHeight}px`;
			noteCanvas.style.height = `${originalHeight}px`;
			if (keyboardCanvas) {
				keyboardCanvas.style.height = `${originalHeight}px`;
			}

			// Same default as a waveform: an aligned player runs every surface on its
			// own local clock, which is only readable with the timer on.
			const timerEnabled = config.timer ?? this.isAlignmentMode();
			const timingNode = timerEnabled
				? createPianoRollTimingNode(overlay)
				: null;
			const zoomNode = createPianoRollZoomNode(overlay);
			const zoomMinimapNode = zoomNode.querySelector(
				".piano-roll-zoom-minimap",
			);
			const zoomCanvas = zoomNode.querySelector(".piano-roll-zoom-canvas");
			const zoomViewportNode = zoomNode.querySelector(
				".piano-roll-zoom-viewport",
			);
			if (
				!(zoomMinimapNode instanceof HTMLElement) ||
				!(zoomCanvas instanceof HTMLCanvasElement) ||
				!(zoomViewportNode instanceof HTMLElement)
			) {
				return;
			}

			const metadata: PianoRollSeekSurfaceMetadata = {
				wrapper,
				scrollContainer,
				surface,
				noteCanvas,
				overlay,
				seekWrap,
				source,
				alignmentColumn: definition.alignmentTimeline?.trim() || null,
				mediaId: config.mediaID,
				playbackFollowMode:
					config.playbackFollowMode ??
					(pianoKeyboard ? "pinnedLeft" : "center"),
				trailingPadPx: 0,
				originalHeight,
				configuredHeight: originalHeight,
				maxZoomValue: config.maxZoom ?? 5,
				defaultZoomValue: config.defaultZoom ?? null,
				maxZoomSeconds: config.maxZoom ?? 5,
				defaultZoomSeconds: null,
				zoomUnitsResolved: false,
				defaultZoomApplied: false,
				baseWidth: this.resolvePianoRollBaseWidth(
					scrollContainer,
					canvasElement.width,
				),
				zoom: MIN_PIANO_ROLL_ZOOM,
				timingNode,
				zoomNode,
				zoomMinimapNode,
				zoomCanvas,
				zoomViewportNode,
				keyboardCanvas,
				lastKeyboardKey: null,
				lastKeyboardPosition: 0,
				keyboardColors: null,
				midi: null,
				notes: [],
				noteRange: resolveConfiguredNoteRange(config.noteRange),
				velocityBars: config.velocityBars === true,
				velocityOpacity: config.velocityOpacity === true,
				minMidi: 0,
				maxMidi: 0,
				pianoRollDurationSeconds: 0,
				maxNoteDuration: 0,
				channelTrackIds,
				colorPerChannel: config.colorPerChannel ?? true,
				channelPaletteIndex: new Map<number, number>(),
				hiddenChannels: new Set<number>(),
				noteColors: null,
				channelColors: new Map<number, PianoRollNoteColors>(),
				lastRenderKey: null,
				lastMinimapKey: null,
				lastPlaybackKey: null,
				lastFollowScrollLeft: null,
			};
			this.pianoRollSeekSurfaces.push(metadata);

			scrollContainer.addEventListener(
				"scroll",
				() => {
					// Scroll handlers run after layout, so refreshing the cached width
					// here is free and keeps the per-frame paths off the layout path.
					refreshTimelineViewportWidth(metadata);
					updatePianoRollMinimapViewport(metadata);
					this.schedulePianoRollNoteRefresh();
				},
				{ passive: true },
			);
		});
	}).call(ctx);
}

export function resolvePianoRollBaseWidth(
	ctx: ViewRenderer,
	scrollContainer: HTMLElement,
	fallback: number,
): number {
	return function (
		this: ViewRenderer,
		scrollContainer: HTMLElement,
		fallback: number,
	) {
		return resolveTimelineBaseWidth(scrollContainer, fallback);
	}.call(ctx, scrollContainer, fallback);
}

export function reflowPianoRollDisplays(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.pianoRollSeekSurfaces.forEach(
			(surface: PianoRollSeekSurfaceMetadata) => {
				// Theme variables may have changed along with the layout.
				surface.noteColors = null;
				surface.keyboardColors = null;
				surface.lastKeyboardKey = null;
				surface.channelColors.clear();
				reflowTimelineSurface(surface, setPianoRollSurfaceWidth);
			},
		);
	}).call(ctx);
}

/**
 * Fetch and decode every MIDI source. Split out of rendering so that
 * `pianoRollDurationSeconds` and the parsed header — which the alignment needs for
 * extents and tick conversion — are available before the alignment resolves.
 * The parsed file is cached on the surface so nothing is fetched twice.
 */
export async function loadMidiSources(ctx: ViewRenderer): Promise<void> {
	const surfaces = ctx.pianoRollSeekSurfaces;
	if (surfaces.length === 0) {
		return;
	}

	await Promise.all(
		surfaces.map(async (surface) => {
			if (surface.midi) {
				return;
			}
			surface.wrapper.classList.add("piano-roll-loading");
			const midi = await Midi.fromUrl(surface.source);
			surface.midi = midi;
			applyMidiNotes(surface, flattenMidiNotes(midi, surface.source));
			surface.wrapper.classList.remove("piano-roll-loading");
		}),
	);
}

/** Parsed MIDI files keyed by source url, for reuse by the media profiler. */
export function getLoadedMidiBySource(ctx: ViewRenderer): Map<string, Midi> {
	const bySource = new Map<string, Midi>();
	ctx.pianoRollSeekSurfaces.forEach((surface) => {
		if (surface.midi) {
			bySource.set(surface.source, surface.midi);
		}
	});
	return bySource;
}

export async function initializePianoRollDisplays(
	ctx: ViewRenderer,
	timelineDuration: number,
	usePianoRollLocalTimeline = false,
): Promise<void> {
	const surfaces = ctx.pianoRollSeekSurfaces;
	if (surfaces.length === 0) {
		return;
	}

	await loadMidiSources(ctx);
	ctx.renderPianoRollDisplays(timelineDuration, usePianoRollLocalTimeline);
}

export function renderPianoRollDisplays(
	ctx: ViewRenderer,
	timelineDuration: number,
	usePianoRollLocalTimeline = false,
): void {
	(function (
		this: ViewRenderer,
		timelineDuration: number,
		usePianoRollLocalTimeline: boolean,
	) {
		if (this.pianoRollSeekSurfaces.length === 0) {
			return;
		}

		this.latestPianoRollRenderInput = {
			timelineDuration,
			usePianoRollLocalTimeline,
		};
		this.reflowPianoRollDisplays();
		this.pianoRollSeekSurfaces.forEach(
			(surface: PianoRollSeekSurfaceMetadata) => {
				const surfaceDuration = resolvePianoRollTimelineDuration(
					surface,
					timelineDuration,
					usePianoRollLocalTimeline,
				);
				resolvePianoRollZoomUnits(this, surface);
				const maximumZoom = getPianoRollMaximumZoom(surface, surfaceDuration);
				// `defaultZoom` only ever opens the surface: once it has, a reflow or a
				// hot reload leaves whatever zoom the listener is on.
				let targetZoom = surface.zoom;
				if (!surface.defaultZoomApplied && surfaceDuration > 0) {
					surface.defaultZoomApplied = true;
					targetZoom = resolveTimelineDefaultZoom(
						surfaceDuration,
						surface.defaultZoomSeconds,
						maximumZoom,
					);
				}
				setPianoRollZoomForSurface(surface, targetZoom, maximumZoom);
				renderPianoRollNotes(surface, surfaceDuration);
				renderPianoRollMinimap(surface, surfaceDuration);
				refreshPianoRollKeyboard(surface, surface.lastKeyboardPosition);
			},
		);
		this.updatePianoRollZoomIndicators();
	}).call(ctx, timelineDuration, usePianoRollLocalTimeline);
}

/**
 * Redraws the sliding note canvases from the inputs of the last full render.
 * Unlike `renderPianoRollDisplays` this touches no layout and never writes
 * `scrollLeft`, so it is safe to run from scroll and zoom handlers.
 */
export function refreshPianoRollNoteTiles(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		const latestInput = this.latestPianoRollRenderInput;
		if (!latestInput || this.pianoRollSeekSurfaces.length === 0) {
			return;
		}

		this.pianoRollSeekSurfaces.forEach(
			(surface: PianoRollSeekSurfaceMetadata) => {
				const surfaceDuration = resolvePianoRollTimelineDuration(
					surface,
					latestInput.timelineDuration,
					latestInput.usePianoRollLocalTimeline,
				);
				renderPianoRollNotes(surface, surfaceDuration);
				renderPianoRollMinimap(surface, surfaceDuration);
			},
		);
	}).call(ctx);
}

/**
 * Points every paired channel at the current solo state. A channel paired with
 * several tracks (e.g. every track of a `soloGroup`) stays visible as long as
 * any one of them is audible. The draw keys carry the hidden set, so a refresh
 * that changes nothing costs a key comparison.
 */
export function updatePianoRollChannelVisibility(
	ctx: ViewRenderer,
	runtimes: TrackRuntime[],
): void {
	(function (this: ViewRenderer) {
		if (this.pianoRollSeekSurfaces.length === 0) {
			return;
		}

		const indexByTrackId = new Map<string, number>();
		runtimes.forEach((runtime, index) => {
			indexByTrackId.set(runtime.definition.id, index);
		});

		this.pianoRollSeekSurfaces.forEach(
			(surface: PianoRollSeekSurfaceMetadata) => {
				surface.hiddenChannels.clear();
				surface.channelTrackIds.forEach((trackIds, channel) => {
					const audible = trackIds.some((trackId) => {
						const trackIndex = indexByTrackId.get(trackId);
						return trackIndex !== undefined && this.isTrackAudible(trackIndex);
					});
					if (!audible) {
						surface.hiddenChannels.add(channel);
					}
				});
			},
		);

		this.schedulePianoRollNoteRefresh();
	}).call(ctx);
}

/**
 * The colours a track carries in the piano roll, for the views that repeat
 * the channel code outside it — one per channel paired with the track, in
 * ascending channel order. Null when no roll colours a channel paired with
 * this track (no pairing, or `colorPerChannel` is off).
 */
export function resolvePianoRollTrackChannelColors(
	ctx: ViewRenderer,
	trackId: string,
): string[] | null {
	for (const surface of ctx.pianoRollSeekSurfaces) {
		const channels = [...surface.channelTrackIds]
			.filter(([, pairedTrackIds]) => pairedTrackIds.includes(trackId))
			.map(([channel]) => channel)
			.sort((a, b) => a - b)
			.filter((channel) => surface.channelPaletteIndex.has(channel));

		if (channels.length > 0) {
			return channels.map(
				(channel) => resolvePianoRollChannelColors(surface, channel).velocity,
			);
		}
	}

	return null;
}

export function schedulePianoRollNoteRefresh(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		if (this.pianoRollNoteRefreshFrameId !== null) {
			return;
		}

		this.pianoRollNoteRefreshFrameId = requestAnimationFrame(() => {
			this.pianoRollNoteRefreshFrameId = null;
			this.refreshPianoRollNoteTiles();
		});
	}).call(ctx);
}

export function updatePianoRollPlaybackState(
	ctx: ViewRenderer,
	state: TrackSwitchUiState,
	suppressPlaybackFollow: boolean,
	usePianoRollLocalTimeline = false,
	timelineContextResolver?: PianoRollTimelineContextResolver,
): void {
	(function (
		this: ViewRenderer,
		state: TrackSwitchUiState,
		suppressPlaybackFollow: boolean,
		usePianoRollLocalTimeline: boolean,
		timelineContextResolver?: PianoRollTimelineContextResolver,
	) {
		this.pianoRollSeekSurfaces.forEach(
			(surface: PianoRollSeekSurfaceMetadata) => {
				const timelineContext = timelineContextResolver
					? timelineContextResolver(surface)
					: null;
				const safeDuration = timelineContext
					? sanitizeDuration(timelineContext.duration)
					: resolvePianoRollTimelineDuration(
							surface,
							state.longestDuration,
							usePianoRollLocalTimeline,
						);
				const position = timelineContext
					? clampTime(
							timelineContext.playbackPosition?.() ??
								timelineContext.fromReferenceTime(state.position),
							0,
							safeDuration,
						)
					: resolvePianoRollTimelinePosition(
							surface,
							state.position,
							state.longestDuration,
							usePianoRollLocalTimeline,
						);
				const loopPointA =
					state.loop?.pointA === null || state.loop?.pointA === undefined
						? null
						: timelineContext
							? clampTime(
									timelineContext.fromReferenceTime(state.loop.pointA),
									0,
									safeDuration,
								)
							: clampTime(state.loop.pointA, 0, safeDuration);
				const loopPointB =
					state.loop?.pointB === null || state.loop?.pointB === undefined
						? null
						: timelineContext
							? clampTime(
									timelineContext.fromReferenceTime(state.loop.pointB),
									0,
									safeDuration,
								)
							: clampTime(state.loop.pointB, 0, safeDuration);
				// This runs on every 16 ms playback tick, so bail out early when nothing
				// observable changed since the previous one.
				const playbackKey = [
					Math.round(position * 1000),
					Math.round(safeDuration * 1000),
					loopPointA === null ? "-" : Math.round(loopPointA * 1000),
					loopPointB === null ? "-" : Math.round(loopPointB * 1000),
					state.loop?.enabled === true ? "1" : "0",
					suppressPlaybackFollow ? "1" : "0",
				].join("#");
				if (surface.lastPlaybackKey === playbackKey) {
					return;
				}
				surface.lastPlaybackKey = playbackKey;

				refreshPianoRollKeyboard(surface, position);

				this.updateSeekWrapVisuals(surface.seekWrap, position, safeDuration, {
					pointA: loopPointA,
					pointB: loopPointB,
					enabled: state.loop?.enabled === true,
				});

				if (surface.timingNode) {
					// A piano-roll surface always shows its own file's clock, so it reads out
					// in the unit its own alignment column was declared in.
					const timeline = surface.mediaId;
					surface.timingNode.textContent = this.formatLocalTimelinePair(
						timeline,
						position,
						safeDuration,
					);
				}

				if (!suppressPlaybackFollow && safeDuration > 0) {
					const scrollLeft = resolvePlaybackFollowScrollLeft(
						surface,
						position / safeDuration,
					);
					// Writing scrollLeft and then reading layout back would force a
					// synchronous reflow every tick. The native scroll event already
					// refreshes the minimap viewport and the note tiles.
					if (
						Number.isFinite(scrollLeft) &&
						scrollLeft !== surface.lastFollowScrollLeft
					) {
						surface.lastFollowScrollLeft = scrollLeft as number;
						surface.scrollContainer.scrollLeft = scrollLeft as number;
					}
				}
			},
		);
	}).call(
		ctx,
		state,
		suppressPlaybackFollow,
		usePianoRollLocalTimeline,
		timelineContextResolver,
	);
}

/**
 * The pitches sounding at `position`, each with the colours of the channels
 * playing it, by ascending channel. A pitch two channels hold at once lights its
 * key with both.
 */
function collectSoundingPitches(
	surface: PianoRollSeekSurfaceMetadata,
	position: number,
): Map<number, string[]> {
	const sounding = new Map<number, number[]>();
	const notes = surface.notes;
	const startIndex = findFirstVisibleNoteIndex(
		notes,
		position - surface.maxNoteDuration,
	);
	for (let index = startIndex; index < notes.length; index += 1) {
		const note = notes[index];
		if (note.time > position) {
			break;
		}

		if (
			note.time + note.duration <= position ||
			surface.hiddenChannels.has(note.channel)
		) {
			continue;
		}

		const channels = sounding.get(note.midi);
		if (channels) {
			if (!channels.includes(note.channel)) {
				channels.push(note.channel);
			}
		} else {
			sounding.set(note.midi, [note.channel]);
		}
	}

	const colors = new Map<number, string[]>();
	sounding.forEach((channels, midi) => {
		colors.set(
			midi,
			channels
				.sort((a, b) => a - b)
				.map(
					(channel) => resolvePianoRollChannelColors(surface, channel).velocity,
				),
		);
	});
	return colors;
}

/** Redraws the keyboard column, but only when what it shows has changed. */
function refreshPianoRollKeyboard(
	surface: PianoRollSeekSurfaceMetadata,
	position: number,
): void {
	const canvas = surface.keyboardCanvas;
	if (!canvas) {
		return;
	}

	surface.lastKeyboardPosition = position;
	const active = collectSoundingPitches(surface, position);
	const drawKey = [
		surface.minMidi,
		surface.maxMidi,
		surface.originalHeight,
		canvas.clientWidth,
		Math.max(1, window.devicePixelRatio || 1),
		[...active]
			.sort((a, b) => a[0] - b[0])
			.map(([midi, colors]) => `${midi}:${colors.join("|")}`)
			.join(","),
	].join("#");
	if (surface.lastKeyboardKey === drawKey) {
		return;
	}

	surface.lastKeyboardKey = drawKey;
	if (!surface.keyboardColors) {
		surface.keyboardColors = resolvePianoRollKeyboardColors(canvas);
	}

	drawPianoRollKeyboard(canvas, {
		minMidi: surface.minMidi,
		maxMidi: surface.maxMidi,
		height: surface.originalHeight,
		colors: surface.keyboardColors,
		active,
	});
}

export function updatePianoRollZoomIndicators(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.pianoRollSeekSurfaces.forEach(
			(surface: PianoRollSeekSurfaceMetadata) => {
				if (surface.zoom <= MIN_PIANO_ROLL_ZOOM + 0.000001) {
					surface.zoomNode.style.display = "none";
					return;
				}

				updatePianoRollMinimapViewport(surface);
				surface.zoomNode.style.display = "flex";
			},
		);
	}).call(ctx);
}

export function findPianoRollSurface(
	ctx: ViewRenderer,
	seekWrap: HTMLElement | null,
): PianoRollSeekSurfaceMetadata | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement | null) {
		if (!seekWrap) {
			return null;
		}

		for (const surface of this.pianoRollSeekSurfaces) {
			if (surface.seekWrap === seekWrap) {
				return surface;
			}
		}

		return null;
	}.call(ctx, seekWrap);
}

export function getPianoRollZoom(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
): number | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement) {
		const surface = this.findPianoRollSurface(seekWrap);
		return surface ? surface.zoom : null;
	}.call(ctx, seekWrap);
}

export function isPianoRollZoomEnabled(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	durationSeconds: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		durationSeconds: number,
	) {
		const surface = this.findPianoRollSurface(seekWrap);
		return surface
			? getPianoRollMaximumZoom(surface, durationSeconds) > MIN_PIANO_ROLL_ZOOM
			: false;
	}.call(ctx, seekWrap, durationSeconds);
}

export function setPianoRollZoom(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	zoom: number,
	durationSeconds: number,
	anchorPageX?: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		zoom: number,
		durationSeconds: number,
		anchorPageX?: number,
	) {
		const surface = this.findPianoRollSurface(seekWrap);
		if (!surface) {
			return false;
		}

		const changed = setPianoRollZoomForSurface(
			surface,
			zoom,
			getPianoRollMaximumZoom(surface, durationSeconds),
			anchorPageX,
		);
		if (changed) {
			// Geometry is applied synchronously above so the anchor stays under the
			// cursor; the redraw is coalesced to one per frame.
			this.latestPianoRollRenderInput = {
				timelineDuration: durationSeconds,
				usePianoRollLocalTimeline: false,
			};
			this.updatePianoRollZoomIndicators();
			this.schedulePianoRollNoteRefresh();
		}
		return changed;
	}.call(ctx, seekWrap, zoom, durationSeconds, anchorPageX);
}

export function getPianoRollMinimapViewport(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
): { startRatio: number; widthRatio: number } | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement) {
		const surface = this.findPianoRollSurface(seekWrap);
		return surface ? getPianoRollViewportState(surface) : null;
	}.call(ctx, seekWrap);
}

export function setPianoRollMinimapViewportStart(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	startRatio: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		startRatio: number,
	) {
		const surface = this.findPianoRollSurface(seekWrap);
		if (!surface) {
			return false;
		}

		const viewportState = getPianoRollViewportState(surface);
		const maxStartRatio = Math.max(0, 1 - viewportState.widthRatio);
		const nextStartRatio = clampTime(startRatio, 0, maxStartRatio);
		// The minimap shows the file, so a ratio on it is a ratio of the time
		// width; the scroll it maps to is bounded by the padded surface.
		const nextScrollLeft = nextStartRatio * getPianoRollTimeWidth(surface);
		const maxScrollLeft = Math.max(
			0,
			getPianoRollSurfaceWidth(surface) - surface.scrollContainer.clientWidth,
		);
		const clampedScrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
		if (
			Math.abs(clampedScrollLeft - surface.scrollContainer.scrollLeft) <
			0.000001
		) {
			updatePianoRollMinimapViewport(surface);
			return false;
		}

		surface.scrollContainer.scrollLeft = clampedScrollLeft;
		updatePianoRollMinimapViewport(surface);
		return true;
	}.call(ctx, seekWrap, startRatio);
}

export function destroyPianoRollDisplays(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		if (this.pianoRollNoteRefreshFrameId !== null) {
			cancelAnimationFrame(this.pianoRollNoteRefreshFrameId);
			this.pianoRollNoteRefreshFrameId = null;
		}
		this.latestPianoRollRenderInput = null;
		this.pianoRollSeekSurfaces.length = 0;
	}).call(ctx);
}
