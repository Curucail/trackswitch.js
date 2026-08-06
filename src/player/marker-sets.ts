import type {
	MarkersConfig,
	MediaConfig,
	ResolvedAlignment,
	ResolvedMarkerSet,
} from "../domain/types";
import { requestText } from "../shared/request-text";
import { createMarker, type MarkerSet, markerSetId } from "../timeline/marker";
import { parseMarkerCsv } from "../timeline/marker-csv";
import {
	type MediaProfile,
	referenceNativeValue,
	resolveImplicitTimelineUnit,
} from "../timeline/media-profile";
import {
	IMPLICIT_REFERENCE_TIMELINE,
	type TimelineId,
	timelineId,
} from "../timeline/timeline";
import { validateAnnotationSet } from "../timeline/validation";

/**
 * A marker CSV's time column is authored in the unit of the timeline the set
 * belongs to — the same unit that timeline's alignment column and readout use —
 * so entries convert into the native coordinate the player runs on, exactly as
 * alignment placements do.
 *
 * Without an alignment every medium shares the implicit timeline, whose unit is
 * the one the player reads out; there the conversion is that readout's inverse,
 * so a marker lands where the timer says it should.
 */
function buildNativeConverter(
	alignment: ResolvedAlignment | null,
	media: MediaConfig,
	profiles: ReadonlyMap<TimelineId, MediaProfile>,
): (timeline: TimelineId, value: number) => number {
	if (alignment) {
		return (timeline, value) => {
			const unit = alignment.timelines.get(timeline)?.unit;
			const profile = profiles.get(timeline);
			return unit && profile ? profile.toNative(value, unit) : value;
		};
	}

	const implicit = resolveImplicitTimelineUnit(media);
	if (!implicit) {
		return (_timeline, value) => value;
	}

	const profile = profiles.get(timelineId(implicit.mediaId));
	if (!profile) {
		return (_timeline, value) => value;
	}

	return (_timeline, value) =>
		referenceNativeValue(profile, value, implicit.unit);
}

export async function loadMarkerSets(
	markers: MarkersConfig,
	alignment: ResolvedAlignment | null,
	media: MediaConfig,
	profiles: ReadonlyMap<TimelineId, MediaProfile>,
	/** Reference-timeline extent the hidden bounding markers are pinned to. */
	playerEnd: number,
): Promise<Map<string, ResolvedMarkerSet>> {
	const referenceTimeline =
		alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
	const projection = alignment?.projection ?? null;
	const toNative = buildNativeConverter(alignment, media, profiles);

	const csvTextBySrc = new Map<string, Promise<string>>();
	const loadCsvText = (src: string, setId: string): Promise<string> => {
		let pending = csvTextBySrc.get(src);
		if (!pending) {
			pending = requestText(src, `marker set "${setId}" source`);
			csvTextBySrc.set(src, pending);
		}
		return pending;
	};

	const entries = await Promise.all(
		Object.entries(markers).map(async ([setId, config]) => {
			const csvText = await loadCsvText(config.src, setId);
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
			const authoredMarkers = parsedMarkerSet.markers.map((marker) => {
				const value = marker.placements.get(timeline);
				if (value === undefined) {
					return marker;
				}
				return {
					...marker,
					placements: new Map([[timeline, toNative(timeline, value)]]),
				};
			});
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
					...authoredMarkers,
					{
						...createMarker(
							String(authoredMarkers.length + 1),
							parsedMarkerSet.id,
							new Map([[referenceTimeline, playerEnd]]),
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
