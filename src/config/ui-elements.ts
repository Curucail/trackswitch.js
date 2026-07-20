import type {
	MarkerLayerConfig,
	MediaConfig,
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
	WaveformTimeAxis,
} from "../domain/types";
import { clampPercent } from "../shared/math";
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
	"timeAxis",
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
const markerLayerAllowedKeys = [
	"set",
	"color",
	"line",
	"foldToReference",
] as const;

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

function normalizeWaveformTimeAxis(value: unknown): WaveformTimeAxis {
	if (value === undefined || value === "shared") {
		return "shared";
	}
	if (value === "individual") {
		return "individual";
	}
	throw new Error(
		"Invalid waveform configuration: timeAxis must be 'shared' or 'individual'.",
	);
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
		throw new Error(
			`Invalid ${label} configuration: markerLayers must be an array.`,
		);
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

function resolveTrackIndex(
	ctx: ViewNormalizeContext,
	trackId: TrackId,
): number {
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
		throw new Error(
			"Invalid image configuration: src must be a non-empty string.",
		);
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
		markerLayers: normalizeMarkerLayers(
			image.markerLayers,
			"perTrackImage",
			ctx,
		),
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
		timeAxis: normalizeWaveformTimeAxis(waveform.timeAxis),
		timer: normalizeOptionalBoolean(waveform.timer),
		alignedPlayhead: normalizeOptionalBoolean(waveform.alignedPlayhead),
		markerLayers: normalizeMarkerLayers(waveform.markerLayers, "waveform", ctx),
	};

	const waveformSource = resolveSourceTracksIndex(
		normalized.sourceTracks,
		ctx,
		"waveform",
	);
	if (normalized.timeAxis === "individual") {
		if (!ctx.hasAlignment) {
			throw new Error(
				"Invalid waveform configuration: timeAxis 'individual' requires an alignment block.",
			);
		}
		if (typeof waveformSource !== "number") {
			throw new Error(
				"Invalid waveform configuration: timeAxis 'individual' requires exactly one source track.",
			);
		}
	}
	validateSeekMargins(normalized, "waveform");
	return normalized;
}

function normalizeMidiConfig(
	midi: TrackSwitchMidiViewConfig,
	ctx: ViewNormalizeContext,
): TrackSwitchMidiViewConfig {
	if (typeof midi.mediaID !== "string" || midi.mediaID.trim().length === 0) {
		throw new Error(
			"Invalid midi configuration: mediaID must be a non-empty string.",
		);
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
		playbackFollowMode: normalizeWaveformPlaybackFollowMode(
			midi.playbackFollowMode,
		),
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
		throw new Error(
			"Invalid warpingMatrix configuration: x and y must differ.",
		);
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
