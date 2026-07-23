import type { MarkersConfig, ResolvedMarkerSet } from "../domain/types";
import { requestText } from "../shared/request-text";
import { createMarker, type MarkerSet, markerSetId } from "../timeline/marker";
import { parseMarkerCsv } from "../timeline/marker-csv";
import type { ProjectionService } from "../timeline/projection";
import { type TimelineId, timelineId } from "../timeline/timeline";
import { validateAnnotationSet } from "../timeline/validation";

export async function loadMarkerSets(
	markers: MarkersConfig,
	referenceTimeline: TimelineId,
	projection: ProjectionService | null,
	referenceEnd: number,
): Promise<Map<string, ResolvedMarkerSet>> {
	const entries = await Promise.all(
		Object.entries(markers).map(async ([setId, config]) => {
			const csvText = await requestText(
				config.src,
				`marker set "${setId}" source`,
			);
			const timeline = config.timeline
				? timelineId(config.timeline)
				: referenceTimeline;

			const parsedMarkerSet = parseMarkerCsv({
				kind: "annotation",
				setId,
				csvText,
				timeline,
				timeCol: config.timeCol,
				labelCol: config.labelCol,
			});
			const authoredMarkerCount = parsedMarkerSet.markers.length;
			const markerSet: MarkerSet = {
				...parsedMarkerSet,
				markers: [
					{
						...createMarker(
							"0",
							parsedMarkerSet.id,
							new Map([[referenceTimeline, 0]]),
						),
						hidden: true,
					},
					...parsedMarkerSet.markers,
					{
						...createMarker(
							String(authoredMarkerCount + 1),
							parsedMarkerSet.id,
							new Map([[referenceTimeline, referenceEnd]]),
						),
						hidden: true,
					},
				],
			};

			if (projection) {
				validateAnnotationSet(
					markerSet,
					timeline,
					referenceTimeline,
					projection,
				);
			}

			const resolved: ResolvedMarkerSet = {
				id: markerSetId(setId),
				timeline,
				hasLabels: typeof config.labelCol === "string",
				markerSet,
			};
			return [setId, resolved] as const;
		}),
	);

	return new Map(entries);
}
