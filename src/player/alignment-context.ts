import type {
	AlignmentConfig,
	MediaConfig,
	ResolvedAlignment,
} from "../domain/types";
import { requestText } from "../shared/request-text";
import { createMarker, type Marker, type MarkerSet } from "../timeline/marker";
import { parseMarkerCsv } from "../timeline/marker-csv";
import {
	createIdentityProfile,
	type MediaProfile,
	nativeUnitForMediaEntry,
	resolveTimelineUnit,
} from "../timeline/media-profile";
import {
	buildProjectionService,
	computeReferenceExtent,
} from "../timeline/projection";
import {
	type Timeline,
	type TimelineExtent,
	type TimelineId,
	type TimelineUnit,
	timelineId,
} from "../timeline/timeline";
import { validateAlignmentSet } from "../timeline/validation";

/**
 * Rewrites every placement from its declared unit into the medium's native
 * coordinate, so the projection graph and everything downstream of it deal in
 * native units only.
 */
function convertPlacementsToNative(
	markerSet: MarkerSet,
	units: ReadonlyMap<TimelineId, TimelineUnit>,
	profiles: ReadonlyMap<TimelineId, MediaProfile>,
): MarkerSet {
	const converts = Array.from(units).some(([timeline, unit]) => {
		const profile = profiles.get(timeline);
		return profile !== undefined && profile.toNative(1, unit) !== 1;
	});
	if (!converts) {
		return markerSet;
	}

	const markers: Marker[] = markerSet.markers.map((marker) => {
		const placements = new Map<TimelineId, number>();
		for (const [timeline, value] of marker.placements) {
			const profile = profiles.get(timeline);
			const unit = units.get(timeline);
			placements.set(
				timeline,
				profile && unit !== undefined ? profile.toNative(value, unit) : value,
			);
		}
		return createMarker(marker.id, marker.set, placements, marker.label);
	});

	return { ...markerSet, markers };
}

/** CSV min/max for a timeline — the fallback extent when no medium backs it. */
function csvExtent(
	markerSet: MarkerSet,
	timeline: TimelineId,
): TimelineExtent | null {
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;

	for (const marker of markerSet.markers) {
		const value = marker.placements.get(timeline);
		if (value === undefined) {
			continue;
		}
		start = Math.min(start, value);
		end = Math.max(end, value);
	}

	return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

export async function buildResolvedAlignment(
	alignment: AlignmentConfig,
	media: MediaConfig,
	profiles: ReadonlyMap<TimelineId, MediaProfile> = new Map(),
): Promise<ResolvedAlignment> {
	const csvText = await requestText(alignment.src, "alignment CSV source");
	const timelineEntries = Object.entries(alignment.timelines);

	const timelinesRecord: Record<string, string> = {};
	const units = new Map<TimelineId, TimelineUnit>();
	timelineEntries.forEach(([timeline, entry]) => {
		timelinesRecord[timeline] = entry;
		units.set(timelineId(timeline), resolveTimelineUnit(media[timeline]));
	});

	const parsedSet = parseMarkerCsv({
		kind: "alignment",
		setId: "alignment",
		csvText,
		timelines: timelinesRecord,
	});
	const markerSet = convertPlacementsToNative(parsedSet, units, profiles);

	const referenceTimeline = timelineId(alignment.referenceTimeline);
	const orderedTimelines = timelineEntries.map(([timeline]) =>
		timelineId(timeline),
	);
	const declaredTimelines = new Set(orderedTimelines);

	validateAlignmentSet(markerSet, {
		declaredTimelines,
		referenceTimeline,
		duplicatePlacements: alignment.duplicatePlacements,
	});

	// Normalization resolves these; an absent value means an unnormalized config.
	const outsideCoverage = alignment.outsideCoverage;
	if (outsideCoverage === undefined) {
		throw new Error(
			"Internal error: alignment.outsideCoverage reached the player unresolved.",
		);
	}
	const duplicatePlacements = alignment.duplicatePlacements;
	if (duplicatePlacements === undefined) {
		throw new Error(
			"Internal error: alignment.duplicatePlacements reached the player unresolved.",
		);
	}
	const projection = buildProjectionService(
		[{ set: markerSet, outsideCoverage, duplicatePlacements }],
		referenceTimeline,
	);
	const referenceExtent = computeReferenceExtent(
		markerSet,
		referenceTimeline,
		profiles.get(referenceTimeline)?.extent,
	);

	const resolvedProfiles = new Map<TimelineId, MediaProfile>();
	const timelines = new Map(
		orderedTimelines.map((timeline) => {
			const mediaEntry = media[timeline];
			const profile =
				profiles.get(timeline) ??
				createIdentityProfile(
					nativeUnitForMediaEntry(mediaEntry),
					csvExtent(markerSet, timeline) ?? { start: 0, end: 0 },
				);
			resolvedProfiles.set(timeline, profile);
			return [
				timeline,
				{
					id: timeline,
					unit: units.get(timeline) ?? "seconds",
					media: mediaEntry ? timeline : undefined,
				} satisfies Timeline,
			] as const;
		}),
	);

	return {
		referenceTimeline,
		timelines,
		profiles: resolvedProfiles,
		outsideCoverage,
		markerSet,
		projection,
		referenceExtent,
	};
}
