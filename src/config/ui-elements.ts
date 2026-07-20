import type {
	MarkerLayerConfig,
	MediaConfig,
	MediaId,
	TrackId,
	TrackSwitchImageViewConfig,
	TrackSwitchMidiViewConfig,
	TrackSwitchPerTrackImageViewConfig,
	TrackSwitchSheetMusicViewConfig,
	TrackSwitchTextAlign,
	TrackSwitchTextViewConfig,
	TrackSwitchTrackListViewConfig,
	TrackSwitchViewConfig,
	TrackSwitchWarpingMatrixViewConfig,
	TrackSwitchWaveformViewConfig,
	WaveformPlaybackFollowMode,
	WaveformSourceIndex,
} from "../domain/types";
import { setMarkerLayersAttribute } from "../shared/marker-display";
import { clampPercent } from "../shared/math";
import { serializeWaveformSource } from "../shared/waveform-source";
import {
	assertAllowedKeys,
	normalizeOptionalBoolean,
	normalizePositiveFiniteNumber,
	normalizePositiveInteger,
	toConfigRecord,
} from "./validation";

const uiImageAllowedKeys = [
	"type",
	"src",
	"seekable",
	"style",
	"seekMarginLeft",
	"seekMarginRight",
	"markerLayers",
] as const;
const uiPerTrackImageAllowedKeys = [
	"type",
	"seekable",
	"style",
	"seekMarginLeft",
	"seekMarginRight",
	"markerLayers",
] as const;
const uiWaveformAllowedKeys = [
	"type",
	"sourceTracks",
	"height",
	"waveformBarWidth",
	"maxZoom",
	"playbackFollowMode",
	"timer",
	"alignedPlayhead",
	"markerLayers",
	"style",
	"seekMarginLeft",
	"seekMarginRight",
] as const;
const uiMidiAllowedKeys = [
	"type",
	"mediaID",
	"height",
	"maxZoom",
	"playbackFollowMode",
	"timer",
	"markerLayers",
	"style",
	"seekMarginLeft",
	"seekMarginRight",
] as const;
const uiTrackListAllowedKeys = ["type", "tracks", "rowHeight"] as const;
const uiSheetMusicAllowedKeys = [
	"type",
	"mediaID",
	"maxWidth",
	"maxHeight",
	"renderScale",
	"followPlayback",
	"style",
	"cursorColor",
	"cursorAlpha",
] as const;
const uiWarpingMatrixAllowedKeys = [
	"type",
	"x",
	"y",
	"style",
	"height",
	"tempoSmoothingSeconds",
] as const;
const uiTextAllowedKeys = [
	"type",
	"text",
	"bold",
	"italic",
	"fontSize",
	"align",
	"style",
] as const;
const markerLayerAllowedKeys = ["set", "color", "line", "foldToReference"] as const;

const uiAllowedKeysByType: Record<string, readonly string[]> = {
	image: uiImageAllowedKeys,
	perTrackImage: uiPerTrackImageAllowedKeys,
	waveform: uiWaveformAllowedKeys,
	midi: uiMidiAllowedKeys,
	trackList: uiTrackListAllowedKeys,
	sheetMusic: uiSheetMusicAllowedKeys,
	warpingMatrix: uiWarpingMatrixAllowedKeys,
	text: uiTextAllowedKeys,
};

/** Everything a view needs to resolve id references against the data half of the config. */
export interface ViewNormalizeContext {
	media: MediaConfig;
	trackIds: TrackId[];
	markerSetIds: ReadonlySet<string>;
	hasAlignment: boolean;
	alignmentTimelines: ReadonlySet<string>;
}

function toMarginString(value: number | undefined): string {
	return String(clampPercent(value));
}

function toCanvasSize(value: number | undefined, fallback: number): number {
	if (!Number.isFinite(value) || !value) {
		return fallback;
	}

	return Math.max(1, Math.round(value));
}

function normalizeWaveformBarWidth(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
		return 1;
	}

	return Math.max(1, Math.floor(value));
}

function normalizeWaveformMaxZoom(value: unknown): number {
	if (value === undefined) {
		return 5;
	}

	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(
			"Invalid waveform configuration: maxZoom must be a finite number of seconds.",
		);
	}

	if (value <= 0) {
		return 0;
	}

	return value;
}

function normalizeWaveformPlaybackFollowMode(
	value: unknown,
): WaveformPlaybackFollowMode {
	if (value === "center" || value === "jump") {
		return value;
	}

	return "off";
}

function validateSeekMargins(
	config: { seekMarginLeft?: number; seekMarginRight?: number },
	label: string,
): void {
	const left = clampPercent(config.seekMarginLeft);
	const right = clampPercent(config.seekMarginRight);

	if (left + right >= 100) {
		throw new Error(
			"Invalid " +
				label +
				" configuration: seekMarginLeft + seekMarginRight must be less than 100.",
		);
	}
}

function isValidCssColor(color: string): boolean {
	return typeof CSS !== "undefined" ? CSS.supports("color", color) : true;
}

function normalizeMarkerLayers(
	layers: MarkerLayerConfig[] | undefined,
	label: string,
	ctx: ViewNormalizeContext,
): MarkerLayerConfig[] | undefined {
	if (layers === undefined) {
		return undefined;
	}

	if (!Array.isArray(layers)) {
		throw new Error(`Invalid ${label} configuration: markerLayers must be an array.`);
	}

	return layers.map((layer) => {
		const record = toConfigRecord(layer, `${label}.markerLayers`);
		assertAllowedKeys(record, markerLayerAllowedKeys, `${label}.markerLayers`);

		if (typeof layer.set !== "string" || layer.set.trim().length === 0) {
			throw new Error(
				`Invalid ${label}.markerLayers configuration: set must name a marker set id.`,
			);
		}

		const isAlignmentSet = layer.set === "alignment";
		if (isAlignmentSet && !ctx.hasAlignment) {
			throw new Error(
				`Invalid ${label}.markerLayers configuration: no alignment block is configured, ` +
					'so the implicit "alignment" marker set does not exist.',
			);
		}
		if (!isAlignmentSet && !ctx.markerSetIds.has(layer.set)) {
			throw new Error(
				`Invalid ${label}.markerLayers configuration: unknown marker set "${layer.set}".`,
			);
		}

		if (layer.color !== undefined) {
			if (typeof layer.color !== "string" || !isValidCssColor(layer.color)) {
				throw new Error(
					`Invalid ${label}.markerLayers configuration: color is not a valid CSS color.`,
				);
			}
		}

		if (
			layer.line !== undefined &&
			layer.line !== "solid" &&
			layer.line !== "dashed"
		) {
			throw new Error(
				`Invalid ${label}.markerLayers configuration: line must be 'solid' or 'dashed'.`,
			);
		}

		return {
			set: layer.set,
			color: layer.color,
			line: layer.line ?? "dashed",
			foldToReference: !!layer.foldToReference,
		};
	});
}

function resolveTrackIndex(ctx: ViewNormalizeContext, trackId: TrackId): number {
	return ctx.trackIds.indexOf(trackId);
}

function resolveSourceTracksIndex(
	sourceTracks: TrackId[] | "audible" | undefined,
	ctx: ViewNormalizeContext,
	label: string,
): WaveformSourceIndex {
	if (sourceTracks === undefined || sourceTracks === "audible") {
		if (ctx.hasAlignment && sourceTracks === undefined) {
			throw new Error(
				`Invalid ${label} configuration: sourceTracks is required (naming exactly one track) ` +
					"when an alignment block is configured.",
			);
		}
		if (ctx.hasAlignment && sourceTracks === "audible") {
			throw new Error(
				`Invalid ${label} configuration: sourceTracks: 'audible' is not allowed when an ` +
					"alignment block is configured — name exactly one track.",
			);
		}
		return "audible";
	}

	if (!Array.isArray(sourceTracks) || sourceTracks.length === 0) {
		throw new Error(
			`Invalid ${label} configuration: sourceTracks must be 'audible' or a non-empty array of track ids.`,
		);
	}

	if (ctx.hasAlignment && sourceTracks.length > 1) {
		throw new Error(
			`Invalid ${label} configuration: sourceTracks may name only one track when an alignment ` +
				"block is configured — overlaying multiple waveforms is only coherent when they share a timeline.",
		);
	}

	const indices = sourceTracks.map((trackId) => {
		const index = resolveTrackIndex(ctx, trackId);
		if (index < 0) {
			throw new Error(
				`Invalid ${label} configuration: sourceTracks references unknown track id "${trackId}".`,
			);
		}
		return index;
	});

	return indices.length === 1 ? indices[0] : indices;
}

function normalizeImageConfig(
	image: TrackSwitchImageViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchImageViewConfig {
	if (typeof image.src !== "string" || image.src.trim().length === 0) {
		throw new Error("Invalid image configuration: src must be a non-empty string.");
	}
	validateSeekMargins(image, "image");
	return {
		...image,
		markerLayers: normalizeMarkerLayers(image.markerLayers, "image", ctx),
	};
}

function normalizePerTrackImageConfig(
	image: TrackSwitchPerTrackImageViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchPerTrackImageViewConfig {
	validateSeekMargins(image, "perTrackImage");
	return {
		...image,
		markerLayers: normalizeMarkerLayers(image.markerLayers, "perTrackImage", ctx),
	};
}

function normalizeWaveformConfig(
	waveform: TrackSwitchWaveformViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchWaveformViewConfig {
	const normalized: TrackSwitchWaveformViewConfig = {
		...waveform,
		waveformBarWidth: normalizeWaveformBarWidth(waveform.waveformBarWidth),
		maxZoom: normalizeWaveformMaxZoom(waveform.maxZoom),
		playbackFollowMode: normalizeWaveformPlaybackFollowMode(
			waveform.playbackFollowMode,
		),
		timer: normalizeOptionalBoolean(waveform.timer),
		alignedPlayhead: normalizeOptionalBoolean(waveform.alignedPlayhead),
		markerLayers: normalizeMarkerLayers(waveform.markerLayers, "waveform", ctx),
	};

	// Validated for the side effect of rejecting bad sourceTracks shapes/references.
	resolveSourceTracksIndex(normalized.sourceTracks, ctx, "waveform");
	validateSeekMargins(normalized, "waveform");
	return normalized;
}

function normalizeMidiConfig(
	midi: TrackSwitchMidiViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchMidiViewConfig {
	if (typeof midi.mediaID !== "string" || midi.mediaID.trim().length === 0) {
		throw new Error("Invalid midi configuration: mediaID must be a non-empty string.");
	}
	const entry = ctx.media[midi.mediaID];
	if (!entry || entry.type !== "midi") {
		throw new Error(
			`Invalid midi configuration: mediaID "${midi.mediaID}" is not declared as type "midi" in media.`,
		);
	}

	const normalized: TrackSwitchMidiViewConfig = {
		...midi,
		height: toCanvasSize(midi.height, 180),
		maxZoom: normalizeWaveformMaxZoom(midi.maxZoom),
		playbackFollowMode: normalizeWaveformPlaybackFollowMode(midi.playbackFollowMode),
		timer: normalizeOptionalBoolean(midi.timer),
		markerLayers: normalizeMarkerLayers(midi.markerLayers, "midi", ctx),
	};

	validateSeekMargins(normalized, "midi");
	return normalized;
}

function normalizeCursorAlpha(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return 0.4;
	}
	if (value < 0) {
		return 0;
	}
	if (value > 1) {
		return 1;
	}
	return value;
}

function normalizeSheetMusicConfig(
	sheetmusic: TrackSwitchSheetMusicViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchSheetMusicViewConfig {
	if (
		typeof sheetmusic.mediaID !== "string" ||
		sheetmusic.mediaID.trim().length === 0
	) {
		throw new Error(
			"Invalid sheetMusic configuration: mediaID must be a non-empty string.",
		);
	}
	const entry = ctx.media[sheetmusic.mediaID];
	if (!entry || entry.type !== "musicxml") {
		throw new Error(
			`Invalid sheetMusic configuration: mediaID "${sheetmusic.mediaID}" is not declared as ` +
				'type "musicxml" in media.',
		);
	}

	return {
		...sheetmusic,
		maxWidth: normalizePositiveInteger(sheetmusic.maxWidth) ?? 1000,
		maxHeight: normalizePositiveInteger(sheetmusic.maxHeight) ?? 380,
		renderScale: normalizePositiveFiniteNumber(sheetmusic.renderScale) ?? 0.7,
		followPlayback:
			typeof sheetmusic.followPlayback === "boolean"
				? sheetmusic.followPlayback
				: true,
		cursorAlpha: normalizeCursorAlpha(sheetmusic.cursorAlpha),
	};
}

function normalizeWarpingMatrixConfig(
	warpingMatrix: TrackSwitchWarpingMatrixViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchWarpingMatrixViewConfig {
	if (!ctx.hasAlignment) {
		throw new Error(
			"Invalid warpingMatrix configuration: requires an alignment block.",
		);
	}
	if (resolveTrackIndex(ctx, warpingMatrix.x) < 0) {
		throw new Error(
			`Invalid warpingMatrix configuration: x references unknown track id "${warpingMatrix.x}".`,
		);
	}
	if (resolveTrackIndex(ctx, warpingMatrix.y) < 0) {
		throw new Error(
			`Invalid warpingMatrix configuration: y references unknown track id "${warpingMatrix.y}".`,
		);
	}
	if (warpingMatrix.x === warpingMatrix.y) {
		throw new Error("Invalid warpingMatrix configuration: x and y must differ.");
	}
	if (!ctx.alignmentTimelines.has(warpingMatrix.x)) {
		throw new Error(
			`Invalid warpingMatrix configuration: x "${warpingMatrix.x}" has no alignment timeline mapping.`,
		);
	}
	if (!ctx.alignmentTimelines.has(warpingMatrix.y)) {
		throw new Error(
			`Invalid warpingMatrix configuration: y "${warpingMatrix.y}" has no alignment timeline mapping.`,
		);
	}

	return {
		...warpingMatrix,
		height: normalizePositiveInteger(warpingMatrix.height),
		tempoSmoothingSeconds: normalizePositiveFiniteNumber(
			warpingMatrix.tempoSmoothingSeconds,
		),
	};
}

function normalizeTextAlign(value: unknown): TrackSwitchTextAlign {
	if (value === "left" || value === "right") {
		return value;
	}
	return "center";
}

function normalizeTextFontSize(value: unknown): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.max(1, Math.round(value));
}

function normalizeTextConfig(
	text: TrackSwitchTextViewConfig,
): TrackSwitchTextViewConfig {
	if (typeof text.text !== "string") {
		throw new Error("Invalid text configuration: text must be a string.");
	}

	return {
		...text,
		bold: normalizeOptionalBoolean(text.bold),
		italic: normalizeOptionalBoolean(text.italic),
		fontSize: normalizeTextFontSize(text.fontSize),
		align: normalizeTextAlign(text.align),
	};
}

function normalizeTrackListConfig(
	trackList: TrackSwitchTrackListViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchTrackListViewConfig {
	if (!Array.isArray(trackList.tracks) || trackList.tracks.length === 0) {
		throw new Error(
			"Invalid trackList configuration: tracks must be a non-empty array of track ids.",
		);
	}

	trackList.tracks.forEach((trackId) => {
		if (resolveTrackIndex(ctx, trackId) < 0) {
			throw new Error(
				`Invalid trackList configuration: references unknown track id "${trackId}".`,
			);
		}
	});

	return {
		...trackList,
		rowHeight: normalizePositiveInteger(trackList.rowHeight),
	};
}

export function normalizeViewConfig(
	view: TrackSwitchViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchViewConfig {
	const viewRecord = toConfigRecord(view, "view");
	const viewType = viewRecord.type;
	if (typeof viewType !== "string") {
		throw new Error("Invalid view: missing type.");
	}

	const allowedViewKeys = uiAllowedKeysByType[viewType];
	if (!allowedViewKeys) {
		throw new Error(`Invalid view type: ${viewType}`);
	}
	assertAllowedKeys(viewRecord, allowedViewKeys, `view.${viewType}`);

	switch (view.type) {
		case "waveform":
			return normalizeWaveformConfig(view, ctx);
		case "midi":
			return normalizeMidiConfig(view, ctx);
		case "sheetMusic":
			return normalizeSheetMusicConfig(view, ctx);
		case "warpingMatrix":
			return normalizeWarpingMatrixConfig(view, ctx);
		case "text":
			return normalizeTextConfig(view);
		case "trackList":
			return normalizeTrackListConfig(view, ctx);
		case "image":
			return normalizeImageConfig(view, ctx);
		case "perTrackImage":
			return normalizePerTrackImageConfig(view, ctx);
		default:
			throw new Error(`Invalid view type: ${viewType}`);
	}
}

// ═══════════ DOM injection (legacy attribute-driven rendering bridge) ═══════════

function injectWarpingMatrix(
	root: HTMLElement,
	warpingMatrix: TrackSwitchWarpingMatrixViewConfig,
): void {
	const container = document.createElement("div");
	container.className = "warping-matrix";

	if (typeof warpingMatrix.style === "string") {
		container.setAttribute("data-warping-matrix-style", warpingMatrix.style);
	}
	if (warpingMatrix.height !== undefined) {
		container.setAttribute(
			"data-warping-matrix-height",
			String(warpingMatrix.height),
		);
	}
	if (warpingMatrix.tempoSmoothingSeconds !== undefined) {
		container.setAttribute(
			"data-warping-matrix-tempo-smoothing-seconds",
			String(warpingMatrix.tempoSmoothingSeconds),
		);
	}
	container.setAttribute("data-warping-matrix-x", warpingMatrix.x);
	container.setAttribute("data-warping-matrix-y", warpingMatrix.y);

	root.appendChild(container);
}

function injectTrackList(root: HTMLElement, groupIndex: number): void {
	const container = document.createElement("div");
	container.className = "track-group ts-stack-section";
	container.setAttribute("data-track-group-index", String(groupIndex));
	root.appendChild(container);
}

function injectText(root: HTMLElement, text: TrackSwitchTextViewConfig): void {
	const container = document.createElement("div");
	container.className = "ts-text";
	container.textContent = text.text;
	container.setAttribute("data-ts-text-align", text.align || "center");

	if (text.bold === true) {
		container.setAttribute("data-ts-text-bold", "true");
	}
	if (text.italic === true) {
		container.setAttribute("data-ts-text-italic", "true");
	}
	if (text.fontSize !== undefined) {
		container.setAttribute("data-ts-text-font-size", String(text.fontSize));
	}
	if (typeof text.style === "string") {
		container.setAttribute("data-ts-text-style", text.style);
	}

	root.appendChild(container);
}

function injectImage(
	root: HTMLElement,
	image: TrackSwitchImageViewConfig,
): void {
	const imageElement = createImageElement(image);
	imageElement.src = image.src;
	root.appendChild(imageElement);
}

function injectPerTrackImage(
	root: HTMLElement,
	image: TrackSwitchPerTrackImageViewConfig,
): void {
	const imageElement = createImageElement(image);
	imageElement.classList.add("per-track-image");
	imageElement.setAttribute("data-per-track-image", "true");
	imageElement.style.display = "none";
	root.appendChild(imageElement);
}

function createImageElement(
	image: Pick<
		TrackSwitchImageViewConfig,
		"seekable" | "style" | "seekMarginLeft" | "seekMarginRight" | "markerLayers"
	>,
): HTMLImageElement {
	const imageElement = document.createElement("img");

	if (image.seekable) {
		imageElement.classList.add("seekable");
	}
	setMarkerLayersAttribute(imageElement, image.markerLayers);

	if (typeof image.style === "string") {
		imageElement.setAttribute("data-style", image.style);
	}
	if (typeof image.seekMarginLeft === "number") {
		imageElement.setAttribute(
			"data-seek-margin-left",
			toMarginString(image.seekMarginLeft),
		);
	}
	if (typeof image.seekMarginRight === "number") {
		imageElement.setAttribute(
			"data-seek-margin-right",
			toMarginString(image.seekMarginRight),
		);
	}

	return imageElement;
}

function injectWaveform(
	root: HTMLElement,
	waveform: TrackSwitchWaveformViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const sourceIndex = resolveSourceTracksIndex(
		waveform.sourceTracks,
		ctx,
		"waveform",
	);
	const isIndividualAxis = ctx.hasAlignment;
	const showAlignmentPoints = !!waveform.markerLayers?.some(
		(layer) => layer.set === "alignment" && layer.foldToReference,
	);

	const canvas = document.createElement("canvas");
	canvas.className = "waveform";
	canvas.width = 1200;
	canvas.height = toCanvasSize(waveform.height, 150);
	canvas.setAttribute("data-waveform-bar-width", String(waveform.waveformBarWidth));
	canvas.setAttribute("data-waveform-source", serializeWaveformSource(sourceIndex));
	canvas.setAttribute("data-waveform-max-zoom", String(waveform.maxZoom));
	canvas.setAttribute(
		"data-waveform-playback-follow-mode",
		waveform.playbackFollowMode || "off",
	);
	canvas.setAttribute(
		"data-waveform-time-axis",
		isIndividualAxis ? "individual" : "shared",
	);
	setMarkerLayersAttribute(canvas, waveform.markerLayers);

	if (typeof waveform.timer === "boolean") {
		canvas.setAttribute("data-waveform-timer", String(waveform.timer));
	}
	if (typeof waveform.alignedPlayhead === "boolean") {
		canvas.setAttribute(
			"data-waveform-aligned-playhead",
			String(waveform.alignedPlayhead),
		);
	}
	canvas.setAttribute(
		"data-waveform-show-alignment-points",
		String(showAlignmentPoints),
	);
	if (typeof waveform.style === "string") {
		canvas.setAttribute("data-waveform-style", waveform.style);
	}
	if (typeof waveform.seekMarginLeft === "number") {
		canvas.setAttribute(
			"data-seek-margin-left",
			toMarginString(waveform.seekMarginLeft),
		);
	}
	if (typeof waveform.seekMarginRight === "number") {
		canvas.setAttribute(
			"data-seek-margin-right",
			toMarginString(waveform.seekMarginRight),
		);
	}

	root.appendChild(canvas);
}

function resolveAlignmentTimelineAttribute(
	mediaID: MediaId,
	ctx: ViewNormalizeContext,
): string {
	return ctx.hasAlignment && ctx.alignmentTimelines.has(mediaID) ? mediaID : "";
}

function injectMidi(
	root: HTMLElement,
	midi: TrackSwitchMidiViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const entry = ctx.media[midi.mediaID];
	const canvas = document.createElement("canvas");
	canvas.className = "midi";
	canvas.width = 1200;
	canvas.height = toCanvasSize(midi.height, 180);
	canvas.setAttribute("data-midi-src", entry && "src" in entry ? entry.src : "");
	canvas.setAttribute("data-midi-max-zoom", String(midi.maxZoom));
	canvas.setAttribute(
		"data-midi-alignment-column",
		resolveAlignmentTimelineAttribute(midi.mediaID, ctx),
	);
	canvas.setAttribute(
		"data-midi-playback-follow-mode",
		midi.playbackFollowMode || "off",
	);
	setMarkerLayersAttribute(canvas, midi.markerLayers);

	if (typeof midi.timer === "boolean") {
		canvas.setAttribute("data-midi-timer", String(midi.timer));
	}
	if (typeof midi.style === "string") {
		canvas.setAttribute("data-midi-style", midi.style);
	}
	if (typeof midi.seekMarginLeft === "number") {
		canvas.setAttribute(
			"data-seek-margin-left",
			toMarginString(midi.seekMarginLeft),
		);
	}
	if (typeof midi.seekMarginRight === "number") {
		canvas.setAttribute(
			"data-seek-margin-right",
			toMarginString(midi.seekMarginRight),
		);
	}

	root.appendChild(canvas);
}

function injectSheetMusic(
	root: HTMLElement,
	sheetmusic: TrackSwitchSheetMusicViewConfig,
	ctx: ViewNormalizeContext,
): void {
	const entry = ctx.media[sheetmusic.mediaID];
	const container = document.createElement("div");
	container.className = "sheetmusic";
	container.setAttribute(
		"data-sheetmusic-src",
		entry && "src" in entry ? entry.src : "",
	);
	container.setAttribute(
		"data-sheetmusic-measure-column",
		resolveAlignmentTimelineAttribute(sheetmusic.mediaID, ctx),
	);
	container.setAttribute(
		"data-sheetmusic-follow-playback",
		String(sheetmusic.followPlayback),
	);
	container.setAttribute(
		"data-sheetmusic-cursor-alpha",
		String(sheetmusic.cursorAlpha),
	);

	if (sheetmusic.maxWidth !== undefined) {
		container.setAttribute("data-sheetmusic-max-width", String(sheetmusic.maxWidth));
	}
	if (sheetmusic.maxHeight !== undefined) {
		container.setAttribute(
			"data-sheetmusic-max-height",
			String(sheetmusic.maxHeight),
		);
	}
	if (sheetmusic.renderScale !== undefined) {
		container.setAttribute(
			"data-sheetmusic-render-scale",
			String(sheetmusic.renderScale),
		);
	}
	if (typeof sheetmusic.style === "string") {
		container.setAttribute("data-sheetmusic-style", sheetmusic.style);
	}
	if (typeof sheetmusic.cursorColor === "string") {
		container.setAttribute("data-sheetmusic-cursor-color", sheetmusic.cursorColor);
	}

	root.appendChild(container);
}

export function injectConfiguredViews(
	root: HTMLElement,
	views: TrackSwitchViewConfig[],
	ctx: ViewNormalizeContext,
): void {
	let trackGroupIndex = 0;
	views.forEach((entry) => {
		if (entry.type === "trackList") {
			injectTrackList(root, trackGroupIndex);
			trackGroupIndex += 1;
			return;
		}
		if (entry.type === "image") {
			injectImage(root, entry);
			return;
		}
		if (entry.type === "text") {
			injectText(root, entry);
			return;
		}
		if (entry.type === "perTrackImage") {
			injectPerTrackImage(root, entry);
			return;
		}
		if (entry.type === "waveform") {
			injectWaveform(root, entry, ctx);
			return;
		}
		if (entry.type === "midi") {
			injectMidi(root, entry, ctx);
			return;
		}
		if (entry.type === "sheetMusic") {
			injectSheetMusic(root, entry, ctx);
			return;
		}
		if (entry.type === "warpingMatrix") {
			injectWarpingMatrix(root, entry);
			return;
		}
		throw new Error(
			`Invalid view type: ${String((entry as { type?: unknown }).type)}`,
		);
	});
}
