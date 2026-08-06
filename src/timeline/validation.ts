import type { DuplicatePlacementPolicy } from "../domain/types";
import type { Marker, MarkerSet } from "./marker";
import type { ProjectionService } from "./projection";
import type { TimelineId } from "./timeline";

function validateMarkerIdsUnique(set: MarkerSet): void {
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

function validateTimelineColumnsDeclared(
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

function validateReferencePlacement(
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

function validateNoImplicitDuplicates(
	set: MarkerSet,
	policy: DuplicatePlacementPolicy,
): void {
	if (policy !== "error") {
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
						`on timeline "${timeline}". Remove duplicatePlacements: "error" to keep the ` +
						'first of them ("first") or blend them ("average") instead of failing.',
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
	// Placements are deliberately not required to be monotonic: a performance
	// that plays a repeat its counterpart skips revisits the same span, so its
	// column steps backwards at the repeat boundary.
	validateNoImplicitDuplicates(set, ctx.duplicatePlacements ?? "first");
}

function validateAnnotationTimelineReachable(
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
