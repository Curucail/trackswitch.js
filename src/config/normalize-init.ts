import type {
	AlignmentConfig,
	MarkersConfig,
	MediaConfig,
	NormalizedTrackSwitchConfig,
	PresetsConfig,
	TrackDefinition,
	TrackId,
	TrackSourceDefinition,
	TrackSwitchInit,
	TrackSwitchViewConfig,
} from "../domain/types";
import {
	injectConfiguredViews,
	normalizeViewConfig,
	type ViewNormalizeContext,
} from "./ui-elements";
import { assertAllowedKeys, toConfigRecord } from "./validation";

export const MEDIA_REQUIRED_ERROR =
	"TrackSwitch requires at least one media entry of type \"audio\".";

const initAllowedKeys = [
	"media",
	"alignment",
	"markers",
	"presets",
	"views",
	"features",
] as const;
const alignmentAllowedKeys = [
	"src",
	"referenceTimeline",
	"timelines",
	"outside",
	"duplicatePlacements",
] as const;
const markerSetAllowedKeys = ["src", "timeline", "timeCol", "labelCol"] as const;
const presetAllowedKeys = ["label", "tracks"] as const;
const audioMediaAllowedKeys = [
	"type",
	"src",
	"title",
	"image",
	"style",
	"solo",
	"volume",
	"pan",
	"startOffsetMs",
	"endOffsetMs",
	"srcSynchronized",
] as const;
const midiMediaAllowedKeys = ["type", "src"] as const;
const musicxmlMediaAllowedKeys = ["type", "src"] as const;
const synchronizedSourceAllowedKeys = ["src", "timeline"] as const;

function validateInitKeys(init: TrackSwitchInit): void {
	const initRecord = toConfigRecord(init, "init");
	assertAllowedKeys(initRecord, initAllowedKeys, "init");
}

function normalizeAlignmentConfig(
	alignment: AlignmentConfig | undefined,
): AlignmentConfig | undefined {
	if (alignment === undefined) {
		return undefined;
	}

	const record = toConfigRecord(alignment, "alignment");
	assertAllowedKeys(record, alignmentAllowedKeys, "alignment");

	if (typeof alignment.src !== "string" || alignment.src.trim().length === 0) {
		throw new Error("Invalid alignment configuration: src must be a non-empty string.");
	}
	if (
		typeof alignment.referenceTimeline !== "string" ||
		alignment.referenceTimeline.trim().length === 0
	) {
		throw new Error(
			"Invalid alignment configuration: referenceTimeline must be a non-empty string.",
		);
	}
	if (
		!alignment.timelines ||
		typeof alignment.timelines !== "object" ||
		Array.isArray(alignment.timelines) ||
		Object.keys(alignment.timelines).length === 0
	) {
		throw new Error(
			"Invalid alignment configuration: timelines must be a non-empty object mapping timeline id to CSV column name.",
		);
	}
	if (!(alignment.referenceTimeline in alignment.timelines)) {
		throw new Error(
			"Invalid alignment configuration: referenceTimeline must be one of the keys in timelines.",
		);
	}
	if (
		alignment.outside !== undefined &&
		alignment.outside !== "clamp" &&
		alignment.outside !== "linear" &&
		alignment.outside !== "error"
	) {
		throw new Error(
			"Invalid alignment configuration: outside must be 'clamp', 'linear', or 'error'.",
		);
	}
	if (
		alignment.duplicatePlacements !== undefined &&
		alignment.duplicatePlacements !== "average" &&
		alignment.duplicatePlacements !== "error"
	) {
		throw new Error(
			"Invalid alignment configuration: duplicatePlacements must be 'average' or 'error'.",
		);
	}

	return { ...alignment };
}

function normalizeMarkersConfig(
	markers: MarkersConfig | undefined,
	referenceTimeline: string | undefined,
): MarkersConfig {
	if (markers === undefined) {
		return {};
	}

	const record = toConfigRecord(markers, "markers");
	const normalized: MarkersConfig = {};

	Object.entries(record).forEach(([setId, rawSet]) => {
		const setRecord = toConfigRecord(rawSet, `markers.${setId}`);
		assertAllowedKeys(setRecord, markerSetAllowedKeys, `markers.${setId}`);
		const set = rawSet as MarkersConfig[string];

		if (typeof set.src !== "string" || set.src.trim().length === 0) {
			throw new Error(`Invalid markers.${setId} configuration: src must be a non-empty string.`);
		}
		if (typeof set.timeCol !== "string" || set.timeCol.trim().length === 0) {
			throw new Error(
				`Invalid markers.${setId} configuration: timeCol must be a non-empty string.`,
			);
		}
		if (set.labelCol !== undefined && typeof set.labelCol !== "string") {
			throw new Error(`Invalid markers.${setId} configuration: labelCol must be a string.`);
		}
		if (set.timeline !== undefined) {
			if (typeof set.timeline !== "string" || set.timeline.trim().length === 0) {
				throw new Error(
					`Invalid markers.${setId} configuration: timeline must be a non-empty string.`,
				);
			}
		} else if (referenceTimeline === undefined) {
			// Omitting timeline with no alignment block is valid: there is one timeline.
		}

		normalized[setId] = { ...set };
	});

	return normalized;
}

function normalizePresetsConfig(
	presets: PresetsConfig | undefined,
	trackIds: ReadonlySet<TrackId>,
): PresetsConfig {
	if (presets === undefined) {
		return {};
	}

	const record = toConfigRecord(presets, "presets");
	const normalized: PresetsConfig = {};

	Object.entries(record).forEach(([presetId, rawPreset]) => {
		const presetRecord = toConfigRecord(rawPreset, `presets.${presetId}`);
		assertAllowedKeys(presetRecord, presetAllowedKeys, `presets.${presetId}`);
		const preset = rawPreset as PresetsConfig[string];

		if (!Array.isArray(preset.tracks) || preset.tracks.length === 0) {
			throw new Error(
				`Invalid presets.${presetId} configuration: tracks must be a non-empty array of track ids.`,
			);
		}
		preset.tracks.forEach((trackId) => {
			if (!trackIds.has(trackId)) {
				throw new Error(
					`Invalid presets.${presetId} configuration: references unknown track id "${trackId}".`,
				);
			}
		});

		normalized[presetId] = { ...preset };
	});

	return normalized;
}

function normalizeSynchronizedSource(
	mediaId: string,
	srcSynchronized: unknown,
): TrackSourceDefinition[] | undefined {
	if (srcSynchronized === undefined) {
		return undefined;
	}

	const record = toConfigRecord(srcSynchronized, `media.${mediaId}.srcSynchronized`);
	assertAllowedKeys(
		record,
		synchronizedSourceAllowedKeys,
		`media.${mediaId}.srcSynchronized`,
	);

	const synced = srcSynchronized as { src: unknown; timeline: unknown };
	if (typeof synced.src !== "string" || synced.src.trim().length === 0) {
		throw new Error(
			`Invalid media.${mediaId}.srcSynchronized configuration: src must be a non-empty string.`,
		);
	}
	if (typeof synced.timeline !== "string" || synced.timeline.trim().length === 0) {
		throw new Error(
			`Invalid media.${mediaId}.srcSynchronized configuration: timeline must be a non-empty string.`,
		);
	}

	return [{ src: synced.src }];
}

function normalizeMediaConfig(media: MediaConfig | undefined): {
	media: MediaConfig;
	tracks: TrackDefinition[];
} {
	if (!media || typeof media !== "object" || Array.isArray(media)) {
		throw new Error("Invalid init configuration: media must be an object.");
	}

	const normalizedMedia: MediaConfig = {};
	const tracks: TrackDefinition[] = [];

	Object.entries(media).forEach(([mediaId, rawEntry]) => {
		const entryRecord = toConfigRecord(rawEntry, `media.${mediaId}`);
		const type = entryRecord.type;

		if (type === "audio") {
			assertAllowedKeys(entryRecord, audioMediaAllowedKeys, `media.${mediaId}`);
			const entry = rawEntry as Extract<MediaConfig[string], { type: "audio" }>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(`Invalid media.${mediaId} configuration: src must be a non-empty string.`);
			}

			normalizedMedia[mediaId] = { ...entry };
			tracks.push({
				id: mediaId,
				title: entry.title,
				image: entry.image,
				style: entry.style,
				solo: entry.solo,
				volume: entry.volume,
				pan: entry.pan,
				sources: [
					{
						src: entry.src,
						startOffsetMs: entry.startOffsetMs,
						endOffsetMs: entry.endOffsetMs,
					},
				],
				syncedSources: normalizeSynchronizedSource(mediaId, entry.srcSynchronized),
			});
			return;
		}

		if (type === "midi") {
			assertAllowedKeys(entryRecord, midiMediaAllowedKeys, `media.${mediaId}`);
			const entry = rawEntry as Extract<MediaConfig[string], { type: "midi" }>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(`Invalid media.${mediaId} configuration: src must be a non-empty string.`);
			}
			normalizedMedia[mediaId] = { ...entry };
			return;
		}

		if (type === "musicxml") {
			assertAllowedKeys(entryRecord, musicxmlMediaAllowedKeys, `media.${mediaId}`);
			const entry = rawEntry as Extract<MediaConfig[string], { type: "musicxml" }>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(`Invalid media.${mediaId} configuration: src must be a non-empty string.`);
			}
			normalizedMedia[mediaId] = { ...entry };
			return;
		}

		throw new Error(
			`Invalid media.${mediaId} configuration: type must be "audio", "midi", or "musicxml".`,
		);
	});

	return { media: normalizedMedia, tracks };
}

export function normalizeTrackSwitchConfig(
	init: TrackSwitchInit,
): NormalizedTrackSwitchConfig {
	validateInitKeys(init);

	const { media, tracks } = normalizeMediaConfig(init.media);
	if (tracks.length === 0) {
		throw new Error(MEDIA_REQUIRED_ERROR);
	}

	const alignment = normalizeAlignmentConfig(init.alignment);
	const markers = normalizeMarkersConfig(init.markers, alignment?.referenceTimeline);
	const trackIdSet = new Set(tracks.map((track) => track.id));
	const presets = normalizePresetsConfig(init.presets, trackIdSet);

	const viewCtx: ViewNormalizeContext = {
		media,
		trackIds: tracks.map((track) => track.id),
		markerSetIds: new Set(Object.keys(markers)),
		hasAlignment: !!alignment,
		alignmentTimelines: new Set(alignment ? Object.keys(alignment.timelines) : []),
	};

	if (!Array.isArray(init.views) || init.views.length === 0) {
		throw new Error("Invalid init configuration: views must be a non-empty array.");
	}

	const views: TrackSwitchViewConfig[] = init.views.map((view) =>
		normalizeViewConfig(view, viewCtx),
	);

	return {
		tracks,
		media,
		alignment,
		markers,
		presets,
		features: init.features,
		views,
	};
}

export function normalizeInit(
	root: HTMLElement,
	init: TrackSwitchInit,
): NormalizedTrackSwitchConfig {
	const normalized = normalizeTrackSwitchConfig(init);
	const viewCtx: ViewNormalizeContext = {
		media: normalized.media,
		trackIds: normalized.tracks.map((track) => track.id),
		markerSetIds: new Set(Object.keys(normalized.markers)),
		hasAlignment: !!normalized.alignment,
		alignmentTimelines: new Set(
			normalized.alignment ? Object.keys(normalized.alignment.timelines) : [],
		),
	};
	injectConfiguredViews(root, normalized.views, viewCtx);
	return normalized;
}
