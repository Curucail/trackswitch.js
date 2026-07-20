import type {
	AlignmentConfig,
	MediaConfig,
	ResolvedAlignment,
} from "../domain/types";
import { parseMarkerCsv } from "../timeline/marker-csv";
import {
	buildProjectionService,
	computeReferenceExtent,
} from "../timeline/projection";
import {
	timelineId,
	type Timeline,
	type TimelineUnit,
} from "../timeline/timeline";
import { requestText } from "../shared/request-text";
import { validateAlignmentSet } from "../timeline/validation";

export async function buildResolvedAlignment(
	alignment: AlignmentConfig,
	media: MediaConfig,
): Promise<ResolvedAlignment> {
	const csvText = await requestText(alignment.src, "alignment CSV source");
	const timelineEntries = Object.entries(alignment.timelines);

	const timelinesRecord: Record<string, string> = {};
	timelineEntries.forEach(([timeline, column]) => {
		timelinesRecord[timeline] = column;
	});

	const markerSet = parseMarkerCsv({
		kind: "alignment",
		setId: "alignment",
		csvText,
		timelines: timelinesRecord,
	});

	const referenceTimeline = timelineId(alignment.referenceTimeline);
	const declaredTimelines = new Set(
		timelineEntries.map(([timeline]) => timelineId(timeline)),
	);

	validateAlignmentSet(markerSet, {
		declaredTimelines,
		referenceTimeline,
		duplicatePlacements: alignment.duplicatePlacements,
	});

	const outOfRange = alignment.outside ?? "error";
	const projection = buildProjectionService(
		[{ set: markerSet, outOfRange }],
		referenceTimeline,
	);
	const referenceExtent = computeReferenceExtent(markerSet, referenceTimeline);
	const timelines = new Map(
		timelineEntries.map(([id]) => {
			const timeline = timelineId(id);
			const mediaEntry = media[id];
			const unit: TimelineUnit =
				mediaEntry?.type === "musicxml" ? "measure" : "seconds";
			return [
				timeline,
				{
					id: timeline,
					unit,
					media: mediaEntry ? timeline : undefined,
				} satisfies Timeline,
			] as const;
		}),
	);

	return {
		referenceTimeline,
		timelines,
		outOfRange,
		markerSet,
		projection,
		referenceExtent,
	};
}
