import { normalizeFeatures } from "../domain/options";
import type {
	AlignmentConfig,
	AudioMediaEntryConfig,
	ImageMediaEntryConfig,
	MarkerSetSourceConfig,
	MarkersConfig,
	MediaConfig,
	MidiMediaEntryConfig,
	MusicXmlMediaEntryConfig,
	NormalizedTrackSwitchConfig,
	PresetConfig,
	PresetsConfig,
	SynchronizedAudioSourceConfig,
	TrackDefinition,
	TrackId,
	TrackSourceDefinition,
	TrackSwitchInit,
	TrackSwitchViewConfig,
} from "../domain/types";
import { allowedUnitsForMediaType } from "../timeline/media-profile";
import type { TimelineUnit } from "../timeline/timeline";
import { normalizeViewConfig, type ViewNormalizeContext } from "./ui-elements";
import {
	assertAllowedKeys,
	keysOf,
	normalizeCssOverrides,
	toConfigRecord,
} from "./validation";

const MEDIA_REQUIRED_ERROR =
	'TrackSwitch requires at least one media entry of type "audio".';

const initAllowedKeys = keysOf<TrackSwitchInit>()([
	"$schema",
	"media",
	"alignment",
	"markers",
	"presets",
	"views",
	"features",
	"css",
] as const);
const alignmentAllowedKeys = keysOf<AlignmentConfig>()([
	"src",
	"referenceTimeline",
	"timelines",
	"outsideCoverage",
	"duplicatePlacements",
] as const);
const markerSetAllowedKeys = keysOf<MarkerSetSourceConfig>()([
	"src",
	"timeline",
	"timeCol",
	"labelCol",
] as const);
const presetAllowedKeys = keysOf<PresetConfig>()(["label", "tracks"] as const);
const audioMediaAllowedKeys = keysOf<AudioMediaEntryConfig>()([
	"type",
	"src",
	"title",
	"imageID",
	"css",
	"solo",
	"volume",
	"pan",
	"startOffsetMs",
	"endOffsetMs",
	"srcSynchronized",
	"timelineUnit",
] as const);
const midiMediaAllowedKeys = keysOf<MidiMediaEntryConfig>()([
	"type",
	"src",
	"timelineUnit",
] as const);
const musicxmlMediaAllowedKeys = keysOf<MusicXmlMediaEntryConfig>()([
	"type",
	"src",
	"timelineUnit",
] as const);
const imageMediaAllowedKeys = keysOf<ImageMediaEntryConfig>()([
	"type",
	"src",
	"timelineUnit",
] as const);
const synchronizedSourceAllowedKeys = keysOf<SynchronizedAudioSourceConfig>()([
	"src",
	"startOffsetMs",
	"endOffsetMs",
] as const);

function validateInitKeys(init: TrackSwitchInit): void {
	const initRecord = toConfigRecord(init, "init");
	assertAllowedKeys(initRecord, initAllowedKeys, "init");
}

/** `path` names the property being validated, as `media.hu33.timelineUnit`. */
function validateTimelineUnit(
	path: string,
	unit: unknown,
	mediaEntry: MediaConfig[string] | undefined,
): void {
	if (unit === undefined) {
		return;
	}

	const allowed = allowedUnitsForMediaType(mediaEntry?.type);
	if (!allowed) {
		// An unrecognized media type, which the type check below rejects on its own.
		return;
	}
	if (typeof unit !== "string" || !allowed.includes(unit as TimelineUnit)) {
		throw new Error(
			`Invalid ${path} configuration: ${JSON.stringify(unit)} is not a unit of ` +
				`media type "${mediaEntry?.type}". Allowed units: ${allowed.join(", ")}.`,
		);
	}
}

function normalizeAlignmentTimelines(
	timelines: AlignmentConfig["timelines"],
): AlignmentConfig["timelines"] {
	const record = toConfigRecord(timelines, "alignment.timelines");
	const normalized: AlignmentConfig["timelines"] = {};

	Object.entries(record).forEach(([timelineId, rawEntry]) => {
		if (typeof rawEntry !== "string" || rawEntry.trim().length === 0) {
			throw new Error(
				`Invalid alignment.timelines.${timelineId} configuration: must be a non-empty ` +
					"CSV column name. A column's unit belongs to its medium, as media.timelineUnit.",
			);
		}
		normalized[timelineId] = rawEntry;
	});

	return normalized;
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
		throw new Error(
			"Invalid alignment configuration: src must be a non-empty string.",
		);
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
	const timelines = normalizeAlignmentTimelines(alignment.timelines);
	if (
		alignment.outsideCoverage !== undefined &&
		alignment.outsideCoverage !== "hold" &&
		alignment.outsideCoverage !== "extrapolate" &&
		alignment.outsideCoverage !== "error"
	) {
		throw new Error(
			"Invalid alignment configuration: outsideCoverage must be 'hold', 'extrapolate', or 'error'.",
		);
	}
	if (
		alignment.duplicatePlacements !== undefined &&
		alignment.duplicatePlacements !== "first" &&
		alignment.duplicatePlacements !== "average" &&
		alignment.duplicatePlacements !== "error"
	) {
		throw new Error(
			"Invalid alignment configuration: duplicatePlacements must be 'first', 'average', or 'error'.",
		);
	}

	return {
		...alignment,
		timelines,
		outsideCoverage: alignment.outsideCoverage ?? "error",
		duplicatePlacements: alignment.duplicatePlacements ?? "first",
	};
}

/**
 * Exclusivity lives on each `trackList`, so a track only has a defined solo mode
 * once some list claims it. A track no list mentions would be audible with no way
 * to reach it.
 */
function assertEveryTrackIsListed(
	views: TrackSwitchViewConfig[],
	trackIds: TrackId[],
): void {
	const listed = new Set<TrackId>();
	views.forEach((view) => {
		if (view.type === "trackList") {
			view.tracks.forEach((trackId) => {
				listed.add(trackId);
			});
		}
	});

	const orphans = trackIds.filter((trackId) => !listed.has(trackId));
	if (orphans.length > 0) {
		throw new Error(
			"Invalid views configuration: every track must appear in a trackList view. " +
				`Unlisted track ids: ${orphans.join(", ")}.`,
		);
	}
}

/**
 * Alignment places each timeline at its own audible position, so tracks of two
 * timelines sounding together would sit at different moments of the piece. The
 * player therefore selects one timeline at a time, and a list decides what it
 * contributes to that choice: a list with a `soloGroup` offers each of its tracks
 * as a timeline of its own, a list without one *is* one timeline whose tracks mix
 * freely — which only holds if they all share one alignment column and the same
 * offsets, so that they really are one recording taken apart.
 *
 * That single selection also spans the whole player, so several `soloGroup`
 * numbers would be one selection wearing different names. Sync mode is what makes
 * different timelines audible together, by running their time-stretched sources on
 * a shared clock.
 */
function assertAlignedTrackListSelections(
	views: TrackSwitchViewConfig[],
	alignment: AlignmentConfig,
	media: MediaConfig,
): void {
	const soloGroups = new Set<number>();

	views.forEach((view) => {
		if (view.type !== "trackList") {
			return;
		}

		if (view.soloGroup === undefined) {
			assertSharedAlignmentTimeline(view.tracks, alignment, media);
			return;
		}

		soloGroups.add(view.soloGroup);
	});

	if (soloGroups.size > 1) {
		throw new Error(
			"Invalid trackList configuration: alignment selects one timeline at a time across the " +
				"whole player, so its trackList views share a single selection. Give them one " +
				`soloGroup number instead of ${[...soloGroups].sort().join(", ")}.`,
		);
	}
}

/**
 * A `perTrackImage` surface shows the image of the one audible track, so the whole
 * player has to resolve to a single selection: every list belongs to a selection,
 * and they all belong to the same one.
 */
function assertSinglePerTrackImageSelection(
	views: TrackSwitchViewConfig[],
): void {
	const soloGroups = new Set<number | undefined>();
	views.forEach((view) => {
		if (view.type === "trackList") {
			soloGroups.add(view.soloGroup);
		}
	});

	if (soloGroups.size === 1 && !soloGroups.has(undefined)) {
		return;
	}

	throw new Error(
		"Invalid configuration: perTrackImage shows the image of the one audible track, so every " +
			"trackList view must declare the same soloGroup.",
	);
}

/** The alignment column plus the trims that place a track's audio on it. */
function alignmentPlacement(
	trackId: TrackId,
	alignment: AlignmentConfig,
	media: MediaConfig,
): string {
	const entry = alignment.timelines[trackId];
	if (entry === undefined) {
		throw new Error(
			`Invalid trackList configuration: track "${trackId}" sits in a trackList without a ` +
				"soloGroup, which makes its tracks sound together, so every one of them needs an " +
				"alignment.timelines entry naming the timeline they share.",
		);
	}

	const mediaEntry = media[trackId] as AudioMediaEntryConfig;

	return [
		entry,
		String(mediaEntry.timelineUnit ?? ""),
		String(mediaEntry.startOffsetMs ?? 0),
		String(mediaEntry.endOffsetMs ?? 0),
	].join("|");
}

function assertSharedAlignmentTimeline(
	trackIds: TrackId[],
	alignment: AlignmentConfig,
	media: MediaConfig,
): void {
	const placements = trackIds.map((trackId) =>
		alignmentPlacement(trackId, alignment, media),
	);
	const [first] = placements;
	const divergentIndex = placements.findIndex(
		(placement) => placement !== first,
	);
	if (divergentIndex < 0) {
		return;
	}

	throw new Error(
		"Invalid trackList configuration: a trackList without a soloGroup plays " +
			"its tracks together, so under alignment they must live on one timeline. Tracks " +
			`"${trackIds[0]}" and "${trackIds[divergentIndex]}" differ in their alignment ` +
			"column, its unit, or their startOffsetMs/endOffsetMs.",
	);
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
			throw new Error(
				`Invalid markers.${setId} configuration: src must be a non-empty string.`,
			);
		}
		if (typeof set.timeCol !== "string" || set.timeCol.trim().length === 0) {
			throw new Error(
				`Invalid markers.${setId} configuration: timeCol must be a non-empty string.`,
			);
		}
		if (
			set.labelCol !== undefined &&
			(typeof set.labelCol !== "string" || set.labelCol.trim().length === 0)
		) {
			throw new Error(
				`Invalid markers.${setId} configuration: labelCol must be a non-empty string.`,
			);
		}
		if (set.timeline !== undefined) {
			if (
				typeof set.timeline !== "string" ||
				set.timeline.trim().length === 0
			) {
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

	const record = toConfigRecord(
		srcSynchronized,
		`media.${mediaId}.srcSynchronized`,
	);
	assertAllowedKeys(
		record,
		synchronizedSourceAllowedKeys,
		`media.${mediaId}.srcSynchronized`,
	);

	const synced = srcSynchronized as SynchronizedAudioSourceConfig & {
		src: unknown;
	};
	if (typeof synced.src !== "string" || synced.src.trim().length === 0) {
		throw new Error(
			`Invalid media.${mediaId}.srcSynchronized configuration: src must be a non-empty string.`,
		);
	}
	return [
		{
			src: synced.src,
			startOffsetMs: synced.startOffsetMs,
			endOffsetMs: synced.endOffsetMs,
		},
	];
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
		validateTimelineUnit(
			`media.${mediaId}.timelineUnit`,
			entryRecord.timelineUnit,
			rawEntry as MediaConfig[string],
		);

		if (type === "audio") {
			assertAllowedKeys(entryRecord, audioMediaAllowedKeys, `media.${mediaId}`);
			const entry = rawEntry as Extract<MediaConfig[string], { type: "audio" }>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(
					`Invalid media.${mediaId} configuration: src must be a non-empty string.`,
				);
			}

			const css = normalizeCssOverrides(entry.css, `media.${mediaId}`);
			normalizedMedia[mediaId] = { ...entry, css };
			tracks.push({
				id: mediaId,
				title: entry.title,
				imageID: entry.imageID,
				css,
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
				syncedSources: normalizeSynchronizedSource(
					mediaId,
					entry.srcSynchronized,
				),
			});
			return;
		}

		if (type === "midi") {
			assertAllowedKeys(entryRecord, midiMediaAllowedKeys, `media.${mediaId}`);
			const entry = rawEntry as Extract<MediaConfig[string], { type: "midi" }>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(
					`Invalid media.${mediaId} configuration: src must be a non-empty string.`,
				);
			}
			normalizedMedia[mediaId] = { ...entry };
			return;
		}

		if (type === "musicxml") {
			assertAllowedKeys(
				entryRecord,
				musicxmlMediaAllowedKeys,
				`media.${mediaId}`,
			);
			const entry = rawEntry as Extract<
				MediaConfig[string],
				{ type: "musicxml" }
			>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(
					`Invalid media.${mediaId} configuration: src must be a non-empty string.`,
				);
			}
			normalizedMedia[mediaId] = { ...entry };
			return;
		}

		if (type === "image") {
			assertAllowedKeys(entryRecord, imageMediaAllowedKeys, `media.${mediaId}`);
			const entry = rawEntry as Extract<MediaConfig[string], { type: "image" }>;
			if (typeof entry.src !== "string" || entry.src.trim().length === 0) {
				throw new Error(
					`Invalid media.${mediaId} configuration: src must be a non-empty string.`,
				);
			}
			normalizedMedia[mediaId] = { ...entry };
			return;
		}

		throw new Error(
			`Invalid media.${mediaId} configuration: type must be "audio", "midi", "musicxml", or "image".`,
		);
	});

	// Resolved after the pass, so a track may name an image entry declared below it.
	tracks.forEach((track) => {
		if (track.imageID === undefined) {
			return;
		}
		const referenced = normalizedMedia[track.imageID];
		if (referenced?.type !== "image") {
			throw new Error(
				`Invalid media.${track.id} configuration: imageID "${track.imageID}" must name a media entry of type "image".`,
			);
		}
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
	const markers = normalizeMarkersConfig(
		init.markers,
		alignment?.referenceTimeline,
	);
	const trackIdSet = new Set(tracks.map((track) => track.id));
	const presets = normalizePresetsConfig(init.presets, trackIdSet);

	const viewCtx: ViewNormalizeContext = {
		media,
		trackIds: tracks.map((track) => track.id),
		markerSetIds: new Set(Object.keys(markers)),
		hasAlignment: !!alignment,
		alignmentTimelines: new Set(
			alignment ? Object.keys(alignment.timelines) : [],
		),
	};

	if (!Array.isArray(init.views) || init.views.length === 0) {
		throw new Error(
			"Invalid init configuration: views must be a non-empty array.",
		);
	}

	const views: TrackSwitchViewConfig[] = init.views.map((view) =>
		normalizeViewConfig(view, viewCtx),
	);
	if (views.filter((view) => view.type === "navigationBar").length > 1) {
		throw new Error(
			"Invalid views configuration: only one navigationBar view is allowed.",
		);
	}

	assertEveryTrackIsListed(views, viewCtx.trackIds);
	if (alignment) {
		assertAlignedTrackListSelections(views, alignment, media);
	}

	if (views.some((view) => view.type === "perTrackImage")) {
		assertSinglePerTrackImageSelection(views);
	}

	const features = normalizeFeatures(init.features);

	return {
		tracks,
		media,
		alignment,
		markers,
		presets,
		features,
		views,
		css: normalizeCssOverrides(init.css, "init"),
	};
}
