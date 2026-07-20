import type { MarkersConfig, ResolvedMarkerSet } from "../domain/types";
import { requestText } from "../shared/request-text";
import { parseMarkerCsv } from "../timeline/marker-csv";
import { markerSetId, type MarkerSet } from "../timeline/marker";
import type { ProjectionService } from "../timeline/projection";
import { timelineId, type TimelineId } from "../timeline/timeline";
import { validateAnnotationSet } from "../timeline/validation";

export async function loadMarkerSets(
	markers: MarkersConfig,
	referenceTimeline: TimelineId,
	projection: ProjectionService | null,
): Promise<Map<string, ResolvedMarkerSet>> {
	const entries = await Promise.all(
		Object.entries(markers).map(async ([setId, config]) => {
			const csvText = await requestText(config.src, `marker set "${setId}" source`);
			const timeline = config.timeline ? timelineId(config.timeline) : referenceTimeline;

			const markerSet: MarkerSet = parseMarkerCsv({
				kind: "annotation",
				setId,
				csvText,
				timeline,
				timeCol: config.timeCol,
				labelCol: config.labelCol,
			});

			if (projection) {
				validateAnnotationSet(markerSet, timeline, referenceTimeline, projection);
			}

			const resolved: ResolvedMarkerSet = {
				id: markerSetId(setId),
				timeline,
				markerSet,
			};
			return [setId, resolved] as const;
		}),
	);

	return new Map(entries);
}
