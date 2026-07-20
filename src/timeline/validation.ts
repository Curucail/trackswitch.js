import type { AlignmentOutOfRangeMode } from "../domain/types";
import type { Marker, MarkerSet } from "./marker";
import type { ProjectionService } from "./projection";
import type { TimelineId } from "./timeline";

export type DuplicatePlacementPolicy = "average" | "error";

export function resolveOutOfRangeMode(
	mode: AlignmentOutOfRangeMode | undefined,
): AlignmentOutOfRangeMode {
	return mode ?? "error";
}

export function validateMarkerIdsUnique(set: MarkerSet): void {
	const seen = new Set<string>();
	for (const marker of set.markers) {
		if (seen.has(marker.id)) {
			throw new Error(
				`Marker set "${set.id}" has duplicate marker id "${marker.id}".`,
			);
		}
		seen.add(marker.id);
	}
}

export function validateTimelineColumnsDeclared(
	setLabel: string,
	referencedTimelines: Iterable<TimelineId>,
	declaredTimelines: ReadonlySet<TimelineId>,
): void {
	for (const timeline of referencedTimelines) {
		if (!declaredTimelines.has(timeline)) {
			throw new Error(
				`${setLabel} references timeline "${timeline}", which is not declared in media or alignment.timelines.`,
			);
		}
	}
}

export function validateReferencePlacement(
	set: MarkerSet,
	referenceTimeline: TimelineId,
): void {
	set.markers.forEach((marker: Marker, rowIndex: number) => {
		if (!marker.placements.has(referenceTimeline)) {
			const csvRow = rowIndex + 2;
			throw new Error(
				`Marker set "${set.id}" row ${csvRow} has no placement on the reference timeline "${referenceTimeline}".`,
			);
		}
	});
}

export function validateMonotonicPlacements(set: MarkerSet): void {
	const previous = new Map<TimelineId, { value: number; rowIndex: number }>();

	set.markers.forEach((marker, rowIndex) => {
		for (const [timeline, value] of marker.placements) {
			const prior = previous.get(timeline);
			if (prior && value < prior.value) {
				const csvRow = rowIndex + 2;
				const priorCsvRow = prior.rowIndex + 2;
				throw new Error(
					`Marker set "${set.id}", row ${csvRow} maps timeline "${timeline}" to ${value}, ` +
						`behind row ${priorCsvRow}'s value ${prior.value}; timeline placements must be monotonic.`,
				);
			}
			previous.set(timeline, { value, rowIndex });
		}
	});
}

export function validateNoImplicitDuplicates(
	set: MarkerSet,
	policy: DuplicatePlacementPolicy,
): void {
	if (policy === "average") {
		return;
	}

	const seenPerTimeline = new Map<TimelineId, Set<number>>();

	set.markers.forEach((marker, rowIndex) => {
		for (const [timeline, value] of marker.placements) {
			let seenValues = seenPerTimeline.get(timeline);
			if (!seenValues) {
				seenValues = new Set();
				seenPerTimeline.set(timeline, seenValues);
			}
			if (seenValues.has(value)) {
				const csvRow = rowIndex + 2;
				throw new Error(
					`Marker set "${set.id}" row ${csvRow} duplicates an existing placement (${value}) ` +
						`on timeline "${timeline}". Set duplicatePlacements: "average" on the alignment ` +
						"set to average duplicates instead of failing.",
				);
			}
			seenValues.add(value);
		}
	});
}

export interface AlignmentValidationContext {
	declaredTimelines: ReadonlySet<TimelineId>;
	referenceTimeline: TimelineId;
	duplicatePlacements?: DuplicatePlacementPolicy;
}

export function validateAlignmentSet(
	set: MarkerSet,
	ctx: AlignmentValidationContext,
): void {
	const referencedTimelines = new Set<TimelineId>();
	for (const marker of set.markers) {
		for (const timeline of marker.placements.keys()) {
			referencedTimelines.add(timeline);
		}
	}

	validateMarkerIdsUnique(set);
	validateTimelineColumnsDeclared(
		`Alignment set "${set.id}"`,
		referencedTimelines,
		ctx.declaredTimelines,
	);
	validateReferencePlacement(set, ctx.referenceTimeline);
	validateMonotonicPlacements(set);
	validateNoImplicitDuplicates(set, ctx.duplicatePlacements ?? "error");
}

export function validateAnnotationTimelineReachable(
	setLabel: string,
	timeline: TimelineId,
	referenceTimeline: TimelineId,
	projection: ProjectionService,
): void {
	if (timeline === referenceTimeline) {
		return;
	}
	if (!projection.canProject(timeline, referenceTimeline)) {
		throw new Error(
			`${setLabel} is authored on timeline "${timeline}", which has no alignment mapping ` +
				`to the reference timeline "${referenceTimeline}".`,
		);
	}
}

export function validateAnnotationSet(
	set: MarkerSet,
	timeline: TimelineId,
	referenceTimeline: TimelineId,
	projection: ProjectionService,
): void {
	validateMarkerIdsUnique(set);
	validateAnnotationTimelineReachable(
		`Marker set "${set.id}"`,
		timeline,
		referenceTimeline,
		projection,
	);
}

/** Omitting `timeline` resolves to the reference timeline (meaningless with no alignment block). */
export function resolveAnnotationTimeline(
	explicit: TimelineId | undefined,
	referenceTimeline: TimelineId,
): TimelineId {
	return explicit ?? referenceTimeline;
}
