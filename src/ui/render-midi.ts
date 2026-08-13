import { Midi } from "@tonejs/midi";
import type {
	TrackRuntime,
	TrackSwitchMidiViewConfig,
	TrackSwitchUiState,
	WaveformPlaybackFollowMode,
} from "../domain/types";
import { applyCssOverrides } from "../shared/dom";
import {
	clampTimelineValue,
	getTimelineMaximumZoom,
	getTimelineSurfaceWidth,
	getTimelineViewportState,
	MIN_TIMELINE_ZOOM,
	positionTileCanvas,
	reflowTimelineSurface,
	refreshTimelineViewportWidth,
	resizeCanvasForCssSize,
	resolveTimelineBaseWidth,
	resolveTimelinePlaybackFollowScrollLeft,
	resolveVisibleTileWindow,
	sanitizeTimelineDuration,
	setTimelineZoomForSurface,
	updateTimelineMinimapViewport,
} from "./timeline-surface";
import type { ConfiguredViewHost, ViewRenderer } from "./view-renderer";

const MIN_MIDI_ZOOM = MIN_TIMELINE_ZOOM;
const MIDI_RANGE_PADDING = 2;
const MIN_MIDI_NOTE_WIDTH = 1;
/** Below this row height an outline would swallow the note body, so skip it. */
const MIDI_NOTE_BORDER_MIN_HEIGHT = 4;
/** A velocity bar is only legible once the note rect is at least this large. */
const MIDI_VELOCITY_BAR_MIN_HEIGHT = 8;
const MIDI_VELOCITY_BAR_MIN_WIDTH = 6;

/** How many channel colours the stylesheet declares, cycled past the last one. */
const MIDI_CHANNEL_PALETTE_SIZE = 10;

interface MidiNoteEvent {
	midi: number;
	time: number;
	duration: number;
	name: string;
	velocity: number;
	channel: number;
}

interface MidiNoteColors {
	fill: string;
	border: string;
	velocity: string;
}

export interface MidiSeekSurfaceMetadata {
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
	originalHeight: number;
	/** The configured `height`, immutable — the base a fullscreen grow restores to. */
	configuredHeight: number;
	maxZoomSeconds: number;
	baseWidth: number;
	zoom: number;
	timingNode: HTMLElement | null;
	zoomNode: HTMLElement;
	zoomMinimapNode: HTMLElement;
	zoomCanvas: HTMLCanvasElement;
	zoomViewportNode: HTMLElement;
	/** Parsed file, cached so the header is available for tick conversion. */
	midi: Midi | null;
	notes: MidiNoteEvent[];
	minMidi: number;
	maxMidi: number;
	midiDurationSeconds: number;
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
	noteColors: MidiNoteColors | null;
	/** Resolved colours per palette slot, alongside the `noteColors` cache. */
	channelColors: Map<number, MidiNoteColors>;
	lastRenderKey: string | null;
	lastMinimapKey: string | null;
	lastPlaybackKey: string | null;
	lastFollowScrollLeft: number | null;
}

interface MidiTimelineContext {
	duration: number;
	toReferenceTime(timelineTime: number): number;
	fromReferenceTime(referenceTime: number): number;
	/** See `WaveformTimelineContext.getPlaybackPosition`. */
	playbackPosition?(): number | null;
}

export type MidiTimelineContextResolver = (
	surface: MidiSeekSurfaceMetadata,
) => MidiTimelineContext | null;

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

function getMidiSurfaceWidth(surface: MidiSeekSurfaceMetadata): number {
	return getTimelineSurfaceWidth(surface);
}

function getMidiMaximumZoom(
	surface: MidiSeekSurfaceMetadata,
	durationSeconds: number,
): number {
	return getTimelineMaximumZoom(durationSeconds, surface.maxZoomSeconds);
}

function getMidiViewportState(surface: MidiSeekSurfaceMetadata): {
	startRatio: number;
	widthRatio: number;
} {
	return getTimelineViewportState(surface);
}

function updateMidiMinimapViewport(surface: MidiSeekSurfaceMetadata): void {
	updateTimelineMinimapViewport(surface);
}

function setMidiSurfaceWidth(
	surface: MidiSeekSurfaceMetadata,
	width?: number,
): void {
	const surfaceWidth = width ?? getMidiSurfaceWidth(surface);
	surface.surface.style.width = `${surfaceWidth}px`;
	surface.surface.style.height = `${surface.originalHeight}px`;
	surface.noteCanvas.style.height = `${surface.originalHeight}px`;
	updateMidiMinimapViewport(surface);
}

/** Resizes a surface's rendered height (fullscreen growth/restore) and redraws it. */
export function setMidiSurfaceHeight(
	ctx: ViewRenderer,
	surface: MidiSeekSurfaceMetadata,
	height: number,
): void {
	(function (
		this: ViewRenderer,
		surface: MidiSeekSurfaceMetadata,
		height: number,
	) {
		if (surface.originalHeight === height) {
			return;
		}

		surface.originalHeight = height;
		surface.surface.style.height = `${height}px`;
		surface.noteCanvas.style.height = `${height}px`;
		surface.lastRenderKey = null;
		surface.lastMinimapKey = null;
		this.refreshMidiNoteTiles();
	}).call(ctx, surface, height);
}

function setMidiZoomForSurface(
	surface: MidiSeekSurfaceMetadata,
	zoom: number,
	maximum: number,
	anchorPageX?: number,
): boolean {
	return setTimelineZoomForSurface(
		surface,
		zoom,
		maximum,
		anchorPageX,
		setMidiSurfaceWidth,
	);
}

function createMidiTimingNode(overlay: HTMLElement): HTMLElement {
	const timing = document.createElement("div");
	timing.className = "midi-timing";
	timing.textContent = "--:--:--:--- / --:--:--:---";
	overlay.appendChild(timing);
	return timing;
}

function createMidiZoomNode(overlay: HTMLElement): HTMLElement {
	const zoom = document.createElement("div");
	zoom.className = "midi-zoom";
	zoom.innerHTML =
		'<span class="midi-zoom-label">Zoom</span>' +
		'<div class="midi-zoom-minimap">' +
		'<canvas class="midi-zoom-canvas"></canvas>' +
		'<div class="midi-zoom-viewport"></div>' +
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
	return notes;
}

function applyMidiNotes(
	surface: MidiSeekSurfaceMetadata,
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

	// The range spans every note, hidden channels included, so that switching a
	// channel off leaves the pitch axis — and every remaining note — where it is.
	surface.notes = notes;
	surface.minMidi = Math.floor(minMidi) - MIDI_RANGE_PADDING;
	surface.maxMidi = Math.ceil(maxMidi) + MIDI_RANGE_PADDING;
	surface.midiDurationSeconds = durationSeconds;
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
	surface: MidiSeekSurfaceMetadata,
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
				(index % MIDI_CHANNEL_PALETTE_SIZE) + 1,
			);
		});
}

function resolveMidiNoteColors(
	surface: MidiSeekSurfaceMetadata,
): MidiNoteColors {
	if (surface.noteColors) {
		return surface.noteColors;
	}

	const computed = getComputedStyle(surface.noteCanvas);
	const read = (property: string, fallback: string): string =>
		computed.getPropertyValue(property).trim() || fallback;
	const colors: MidiNoteColors = {
		fill: read("--midi-note-fill", "rgba(0, 0, 0, 0.3)"),
		border: read("--midi-note-border", "rgba(0, 0, 0, 0.55)"),
		velocity: read("--midi-note-color", "#000"),
	};
	surface.noteColors = colors;
	return colors;
}

/**
 * The colours of one channel: its palette slot when the view pairs it with a
 * track, and the plain note colours when it does not.
 */
function resolveMidiChannelColors(
	surface: MidiSeekSurfaceMetadata,
	channel: number,
): MidiNoteColors {
	const paletteIndex = surface.channelPaletteIndex.get(channel);
	if (paletteIndex === undefined) {
		return resolveMidiNoteColors(surface);
	}

	const cached = surface.channelColors.get(paletteIndex);
	if (cached) {
		return cached;
	}

	const computed = getComputedStyle(surface.noteCanvas);
	const read = (property: string): string =>
		computed.getPropertyValue(property).trim();
	const colors: MidiNoteColors = {
		fill: read(`--midi-channel-${paletteIndex}-fill`),
		border: read(`--midi-channel-${paletteIndex}-border`),
		velocity: read(`--midi-channel-${paletteIndex}-color`),
	};
	surface.channelColors.set(paletteIndex, colors);
	return colors;
}

/** A draw key ingredient, so hiding a channel invalidates the memoized render. */
function hiddenChannelsKey(surface: MidiSeekSurfaceMetadata): string {
	return [...surface.hiddenChannels].sort((a, b) => a - b).join(",");
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

function renderMidiMinimap(
	surface: MidiSeekSurfaceMetadata,
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
		updateMidiMinimapViewport(surface);
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

		context.fillStyle = resolveMidiChannelColors(
			surface,
			note.channel,
		).velocity;
		const x = (note.time / safeDuration) * width;
		const w = Math.max(1, (note.duration / safeDuration) * width);
		const y = ((surface.maxMidi - note.midi) / range) * height;
		const h = Math.max(1, height / range);
		context.globalAlpha = 0.35 + clampTime(note.velocity, 0, 1) * 0.55;
		context.fillRect(x, y, w, h);
	}
	context.globalAlpha = 1;
	surface.lastMinimapKey = drawKey;
	updateMidiMinimapViewport(surface);
}

/**
 * Draws the notes onto a single viewport-sized canvas that slides over the
 * virtual surface, mirroring the waveform tile layer. Only the notes intersecting
 * the buffered window are visited, so the cost tracks the viewport rather than
 * the size of the MIDI file.
 */
function renderMidiNotes(
	surface: MidiSeekSurfaceMetadata,
	durationSeconds: number,
): void {
	const height = surface.originalHeight;
	const safeDuration = sanitizeDuration(durationSeconds);
	const tileWindow = resolveVisibleTileWindow(surface, height);
	positionTileCanvas(surface.noteCanvas, tileWindow);

	const { tileStartPx, tileCssWidth, tileCssHeight, surfaceWidth } = tileWindow;
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
	const pixelsPerSecond = surfaceWidth / safeDuration;
	const visibleStartTime = tileStartPx / pixelsPerSecond;
	const visibleEndTime = (tileStartPx + tileCssWidth) / pixelsPerSecond;
	const drawBorder = rowHeight >= MIDI_NOTE_BORDER_MIN_HEIGHT;
	const drawVelocityBar = noteHeight >= MIDI_VELOCITY_BAR_MIN_HEIGHT;

	context.lineWidth = 1;

	const notes = surface.notes;
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

		const colors = resolveMidiChannelColors(surface, note.channel);
		const left = note.time * pixelsPerSecond;
		const width = Math.max(
			MIN_MIDI_NOTE_WIDTH,
			note.duration * pixelsPerSecond,
		);
		const top = (surface.maxMidi - note.midi) * rowHeight + 1;
		const velocity = clampTime(note.velocity, 0, 1);

		context.globalAlpha = 0.35 + velocity * 0.55;
		context.fillStyle = colors.fill;
		context.fillRect(left, top, width, noteHeight);
		if (drawBorder) {
			context.strokeStyle = colors.border;
			context.strokeRect(left + 0.5, top + 0.5, width - 1, noteHeight - 1);
		}

		if (drawVelocityBar && width >= MIDI_VELOCITY_BAR_MIN_WIDTH) {
			const barWidth = Math.max(1, (width - 6) * velocity);
			context.globalAlpha = 1;
			context.fillStyle = colors.velocity;
			context.fillRect(left + 3, top + noteHeight - 5, barWidth, 3);
		}
	}
	context.globalAlpha = 1;
}

function resolvePlaybackFollowScrollLeft(
	surface: MidiSeekSurfaceMetadata,
	playheadRatio: number,
): number | null {
	return resolveTimelinePlaybackFollowScrollLeft(surface, playheadRatio);
}

function resolveMidiTimelineDuration(
	surface: MidiSeekSurfaceMetadata,
	playerDuration: number,
	useMidiLocalTimeline: boolean,
): number {
	return useMidiLocalTimeline
		? sanitizeDuration(surface.midiDurationSeconds)
		: sanitizeDuration(playerDuration);
}

function resolveMidiTimelinePosition(
	surface: MidiSeekSurfaceMetadata,
	playerPosition: number,
	playerDuration: number,
	useMidiLocalTimeline: boolean,
): number {
	const duration = resolveMidiTimelineDuration(
		surface,
		playerDuration,
		useMidiLocalTimeline,
	);
	if (duration <= 0) {
		return 0;
	}

	return clampTime(playerPosition, 0, duration);
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

export function wrapMidiCanvases(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.midiSeekSurfaces.length = 0;

		const canvases = this.root.querySelectorAll("canvas.midi");
		canvases.forEach((canvasElement: Element) => {
			if (!(canvasElement instanceof HTMLCanvasElement)) {
				return;
			}

			if (canvasElement.closest(".midi-wrap")) {
				return;
			}

			const definition: ConfiguredViewHost =
				this.getConfiguredViewHost(canvasElement);
			if (definition.view.type !== "midi") return;
			const config = definition.view as TrackSwitchMidiViewConfig;
			const source = definition.source;
			if (!source) return;

			const wrapper = document.createElement("div");
			wrapper.className = "midi-wrap ts-stack-section";
			applyCssOverrides(wrapper, config.css);

			const scrollContainer = document.createElement("div");
			scrollContainer.className = "midi-scroll";

			const surface = document.createElement("div");
			surface.className = "midi-surface";

			// One viewport-sized canvas slides over the virtual MIDI surface, so the
			// note count no longer drives the DOM node count.
			const noteCanvas = document.createElement("canvas");
			noteCanvas.className = "midi-note-layer";

			const overlay = document.createElement("div");
			overlay.className = "midi-overlay";

			const parent = canvasElement.parentElement;
			if (!parent) {
				return;
			}

			parent.insertBefore(wrapper, canvasElement);
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
			seekWrap.setAttribute("data-seek-surface", "midi");

			const channelTrackIds = resolveChannelTrackIds(
				config.channelToTrackIDMap,
			);

			const originalHeight = Math.max(1, canvasElement.height);
			surface.style.height = `${originalHeight}px`;
			noteCanvas.style.height = `${originalHeight}px`;

			// Same default as a waveform: an aligned player runs every surface on its
			// own local clock, which is only readable with the timer on.
			const timerEnabled = config.timer ?? this.isAlignmentMode();
			const timingNode = timerEnabled ? createMidiTimingNode(overlay) : null;
			const zoomNode = createMidiZoomNode(overlay);
			const zoomMinimapNode = zoomNode.querySelector(".midi-zoom-minimap");
			const zoomCanvas = zoomNode.querySelector(".midi-zoom-canvas");
			const zoomViewportNode = zoomNode.querySelector(".midi-zoom-viewport");
			if (
				!(zoomMinimapNode instanceof HTMLElement) ||
				!(zoomCanvas instanceof HTMLCanvasElement) ||
				!(zoomViewportNode instanceof HTMLElement)
			) {
				return;
			}

			const metadata: MidiSeekSurfaceMetadata = {
				wrapper,
				scrollContainer,
				surface,
				noteCanvas,
				overlay,
				seekWrap,
				source,
				alignmentColumn: definition.alignmentTimeline?.trim() || null,
				mediaId: config.mediaID,
				playbackFollowMode: config.playbackFollowMode ?? "center",
				originalHeight,
				configuredHeight: originalHeight,
				maxZoomSeconds: config.maxZoom ?? 5,
				baseWidth: this.resolveMidiBaseWidth(
					scrollContainer,
					canvasElement.width,
				),
				zoom: MIN_MIDI_ZOOM,
				timingNode,
				zoomNode,
				zoomMinimapNode,
				zoomCanvas,
				zoomViewportNode,
				midi: null,
				notes: [],
				minMidi: 0,
				maxMidi: 0,
				midiDurationSeconds: 0,
				maxNoteDuration: 0,
				channelTrackIds,
				colorPerChannel: config.colorPerChannel ?? true,
				channelPaletteIndex: new Map<number, number>(),
				hiddenChannels: new Set<number>(),
				noteColors: null,
				channelColors: new Map<number, MidiNoteColors>(),
				lastRenderKey: null,
				lastMinimapKey: null,
				lastPlaybackKey: null,
				lastFollowScrollLeft: null,
			};
			this.midiSeekSurfaces.push(metadata);

			scrollContainer.addEventListener(
				"scroll",
				() => {
					// Scroll handlers run after layout, so refreshing the cached width
					// here is free and keeps the per-frame paths off the layout path.
					refreshTimelineViewportWidth(metadata);
					updateMidiMinimapViewport(metadata);
					this.scheduleMidiNoteRefresh();
				},
				{ passive: true },
			);
		});
	}).call(ctx);
}

export function resolveMidiBaseWidth(
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

export function reflowMidiDisplays(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.midiSeekSurfaces.forEach((surface: MidiSeekSurfaceMetadata) => {
			// Theme variables may have changed along with the layout.
			surface.noteColors = null;
			surface.channelColors.clear();
			reflowTimelineSurface(surface, setMidiSurfaceWidth);
		});
	}).call(ctx);
}

/**
 * Fetch and decode every MIDI source. Split out of rendering so that
 * `midiDurationSeconds` and the parsed header — which the alignment needs for
 * extents and tick conversion — are available before the alignment resolves.
 * The parsed file is cached on the surface so nothing is fetched twice.
 */
export async function loadMidiSources(ctx: ViewRenderer): Promise<void> {
	const surfaces = ctx.midiSeekSurfaces;
	if (surfaces.length === 0) {
		return;
	}

	await Promise.all(
		surfaces.map(async (surface) => {
			if (surface.midi) {
				return;
			}
			surface.wrapper.classList.add("midi-loading");
			const midi = await Midi.fromUrl(surface.source);
			surface.midi = midi;
			applyMidiNotes(surface, flattenMidiNotes(midi, surface.source));
			surface.wrapper.classList.remove("midi-loading");
		}),
	);
}

/** Parsed MIDI files keyed by source url, for reuse by the media profiler. */
export function getLoadedMidiBySource(ctx: ViewRenderer): Map<string, Midi> {
	const bySource = new Map<string, Midi>();
	ctx.midiSeekSurfaces.forEach((surface) => {
		if (surface.midi) {
			bySource.set(surface.source, surface.midi);
		}
	});
	return bySource;
}

export async function initializeMidiDisplays(
	ctx: ViewRenderer,
	timelineDuration: number,
	useMidiLocalTimeline = false,
): Promise<void> {
	const surfaces = ctx.midiSeekSurfaces;
	if (surfaces.length === 0) {
		return;
	}

	await loadMidiSources(ctx);
	ctx.renderMidiDisplays(timelineDuration, useMidiLocalTimeline);
}

export function renderMidiDisplays(
	ctx: ViewRenderer,
	timelineDuration: number,
	useMidiLocalTimeline = false,
): void {
	(function (
		this: ViewRenderer,
		timelineDuration: number,
		useMidiLocalTimeline: boolean,
	) {
		if (this.midiSeekSurfaces.length === 0) {
			return;
		}

		this.latestMidiRenderInput = { timelineDuration, useMidiLocalTimeline };
		this.reflowMidiDisplays();
		this.midiSeekSurfaces.forEach((surface: MidiSeekSurfaceMetadata) => {
			const surfaceDuration = resolveMidiTimelineDuration(
				surface,
				timelineDuration,
				useMidiLocalTimeline,
			);
			setMidiZoomForSurface(
				surface,
				surface.zoom,
				getMidiMaximumZoom(surface, surfaceDuration),
			);
			renderMidiNotes(surface, surfaceDuration);
			renderMidiMinimap(surface, surfaceDuration);
		});
		this.updateMidiZoomIndicators();
	}).call(ctx, timelineDuration, useMidiLocalTimeline);
}

/**
 * Redraws the sliding note canvases from the inputs of the last full render.
 * Unlike `renderMidiDisplays` this touches no layout and never writes
 * `scrollLeft`, so it is safe to run from scroll and zoom handlers.
 */
export function refreshMidiNoteTiles(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		const latestInput = this.latestMidiRenderInput;
		if (!latestInput || this.midiSeekSurfaces.length === 0) {
			return;
		}

		this.midiSeekSurfaces.forEach((surface: MidiSeekSurfaceMetadata) => {
			const surfaceDuration = resolveMidiTimelineDuration(
				surface,
				latestInput.timelineDuration,
				latestInput.useMidiLocalTimeline,
			);
			renderMidiNotes(surface, surfaceDuration);
			renderMidiMinimap(surface, surfaceDuration);
		});
	}).call(ctx);
}

/**
 * Points every paired channel at the current solo state. A channel paired with
 * several tracks (e.g. every track of a `soloGroup`) stays visible as long as
 * any one of them is audible. The draw keys carry the hidden set, so a refresh
 * that changes nothing costs a key comparison.
 */
export function updateMidiChannelVisibility(
	ctx: ViewRenderer,
	runtimes: TrackRuntime[],
): void {
	(function (this: ViewRenderer) {
		if (this.midiSeekSurfaces.length === 0) {
			return;
		}

		const indexByTrackId = new Map<string, number>();
		runtimes.forEach((runtime, index) => {
			indexByTrackId.set(runtime.definition.id, index);
		});

		this.midiSeekSurfaces.forEach((surface: MidiSeekSurfaceMetadata) => {
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
		});

		this.scheduleMidiNoteRefresh();
	}).call(ctx);
}

/**
 * The colours a track carries in the piano roll, for the views that repeat
 * the channel code outside it — one per channel paired with the track, in
 * ascending channel order. Null when no roll colours a channel paired with
 * this track (no pairing, or `colorPerChannel` is off).
 */
export function resolveMidiTrackChannelColors(
	ctx: ViewRenderer,
	trackId: string,
): string[] | null {
	for (const surface of ctx.midiSeekSurfaces) {
		const channels = [...surface.channelTrackIds]
			.filter(([, pairedTrackIds]) => pairedTrackIds.includes(trackId))
			.map(([channel]) => channel)
			.sort((a, b) => a - b)
			.filter((channel) => surface.channelPaletteIndex.has(channel));

		if (channels.length > 0) {
			return channels.map(
				(channel) => resolveMidiChannelColors(surface, channel).velocity,
			);
		}
	}

	return null;
}

export function scheduleMidiNoteRefresh(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		if (this.midiNoteRefreshFrameId !== null) {
			return;
		}

		this.midiNoteRefreshFrameId = requestAnimationFrame(() => {
			this.midiNoteRefreshFrameId = null;
			this.refreshMidiNoteTiles();
		});
	}).call(ctx);
}

export function updateMidiPlaybackState(
	ctx: ViewRenderer,
	state: TrackSwitchUiState,
	suppressPlaybackFollow: boolean,
	useMidiLocalTimeline = false,
	timelineContextResolver?: MidiTimelineContextResolver,
): void {
	(function (
		this: ViewRenderer,
		state: TrackSwitchUiState,
		suppressPlaybackFollow: boolean,
		useMidiLocalTimeline: boolean,
		timelineContextResolver?: MidiTimelineContextResolver,
	) {
		this.midiSeekSurfaces.forEach((surface: MidiSeekSurfaceMetadata) => {
			const timelineContext = timelineContextResolver
				? timelineContextResolver(surface)
				: null;
			const safeDuration = timelineContext
				? sanitizeDuration(timelineContext.duration)
				: resolveMidiTimelineDuration(
						surface,
						state.longestDuration,
						useMidiLocalTimeline,
					);
			const position = timelineContext
				? clampTime(
						timelineContext.playbackPosition?.() ??
							timelineContext.fromReferenceTime(state.position),
						0,
						safeDuration,
					)
				: resolveMidiTimelinePosition(
						surface,
						state.position,
						state.longestDuration,
						useMidiLocalTimeline,
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

			this.updateSeekWrapVisuals(surface.seekWrap, position, safeDuration, {
				pointA: loopPointA,
				pointB: loopPointB,
				enabled: state.loop?.enabled === true,
			});

			if (surface.timingNode) {
				// A MIDI surface always shows its own file's clock, so it reads out
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
		});
	}).call(
		ctx,
		state,
		suppressPlaybackFollow,
		useMidiLocalTimeline,
		timelineContextResolver,
	);
}

export function updateMidiZoomIndicators(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		this.midiSeekSurfaces.forEach((surface: MidiSeekSurfaceMetadata) => {
			if (surface.zoom <= MIN_MIDI_ZOOM + 0.000001) {
				surface.zoomNode.style.display = "none";
				return;
			}

			updateMidiMinimapViewport(surface);
			surface.zoomNode.style.display = "flex";
		});
	}).call(ctx);
}

export function findMidiSurface(
	ctx: ViewRenderer,
	seekWrap: HTMLElement | null,
): MidiSeekSurfaceMetadata | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement | null) {
		if (!seekWrap) {
			return null;
		}

		for (const surface of this.midiSeekSurfaces) {
			if (surface.seekWrap === seekWrap) {
				return surface;
			}
		}

		return null;
	}.call(ctx, seekWrap);
}

export function getMidiZoom(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
): number | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement) {
		const surface = this.findMidiSurface(seekWrap);
		return surface ? surface.zoom : null;
	}.call(ctx, seekWrap);
}

export function isMidiZoomEnabled(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	durationSeconds: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		durationSeconds: number,
	) {
		const surface = this.findMidiSurface(seekWrap);
		return surface
			? getMidiMaximumZoom(surface, durationSeconds) > MIN_MIDI_ZOOM
			: false;
	}.call(ctx, seekWrap, durationSeconds);
}

export function setMidiZoom(
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
		const surface = this.findMidiSurface(seekWrap);
		if (!surface) {
			return false;
		}

		const changed = setMidiZoomForSurface(
			surface,
			zoom,
			getMidiMaximumZoom(surface, durationSeconds),
			anchorPageX,
		);
		if (changed) {
			// Geometry is applied synchronously above so the anchor stays under the
			// cursor; the redraw is coalesced to one per frame.
			this.latestMidiRenderInput = {
				timelineDuration: durationSeconds,
				useMidiLocalTimeline: false,
			};
			this.updateMidiZoomIndicators();
			this.scheduleMidiNoteRefresh();
		}
		return changed;
	}.call(ctx, seekWrap, zoom, durationSeconds, anchorPageX);
}

export function getMidiMinimapViewport(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
): { startRatio: number; widthRatio: number } | null {
	return function (this: ViewRenderer, seekWrap: HTMLElement) {
		const surface = this.findMidiSurface(seekWrap);
		return surface ? getMidiViewportState(surface) : null;
	}.call(ctx, seekWrap);
}

export function setMidiMinimapViewportStart(
	ctx: ViewRenderer,
	seekWrap: HTMLElement,
	startRatio: number,
): boolean {
	return function (
		this: ViewRenderer,
		seekWrap: HTMLElement,
		startRatio: number,
	) {
		const surface = this.findMidiSurface(seekWrap);
		if (!surface) {
			return false;
		}

		const viewportState = getMidiViewportState(surface);
		const surfaceWidth = getMidiSurfaceWidth(surface);
		const maxStartRatio = Math.max(0, 1 - viewportState.widthRatio);
		const nextStartRatio = clampTime(startRatio, 0, maxStartRatio);
		const nextScrollLeft = nextStartRatio * surfaceWidth;
		const maxScrollLeft = Math.max(
			0,
			surfaceWidth - surface.scrollContainer.clientWidth,
		);
		const clampedScrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
		if (
			Math.abs(clampedScrollLeft - surface.scrollContainer.scrollLeft) <
			0.000001
		) {
			updateMidiMinimapViewport(surface);
			return false;
		}

		surface.scrollContainer.scrollLeft = clampedScrollLeft;
		updateMidiMinimapViewport(surface);
		return true;
	}.call(ctx, seekWrap, startRatio);
}

export function destroyMidiDisplays(ctx: ViewRenderer): void {
	(function (this: ViewRenderer) {
		if (this.midiNoteRefreshFrameId !== null) {
			cancelAnimationFrame(this.midiNoteRefreshFrameId);
			this.midiNoteRefreshFrameId = null;
		}
		this.latestMidiRenderInput = null;
		this.midiSeekSurfaces.length = 0;
	}).call(ctx);
}
