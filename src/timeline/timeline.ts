import { formatSecondsToHHMMSSmmm } from "../shared/format";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * A timeline id doubles as a media id when the timeline is backed by a
 * media entry (audio, MIDI, score) — see Timeline.media.
 */
export type TimelineId = Brand<string, "TimelineId">;

export function timelineId(value: string): TimelineId {
	return value as TimelineId;
}

/** Stand-in reference timeline id used when no `alignment` block exists (exactly one timeline). */
export const IMPLICIT_REFERENCE_TIMELINE: TimelineId = timelineId("$reference");

/**
 * The timeline the player's position, loop points and runtime markers use.
 * Alignment mode always uses its canonical reference timeline; ordinary
 * playback uses the single implicit timeline.
 */
export function playerTimeline(
	alignment: { referenceTimeline: TimelineId } | null | undefined,
): TimelineId {
	return alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
}

/**
 * The unit a timeline's alignment column is authored in. Each medium has one
 * native unit it plays back in (audio and MIDI: seconds, a score: measures, an
 * image: percent of its width); the others are declared alternatives that are
 * converted to the native unit when the alignment is parsed — see
 * `src/timeline/media-profile.ts`.
 */
export type TimelineUnit =
	| "seconds"
	| "samples"
	| "ticks"
	| "measures"
	| "percent"
	| "pixels";

export interface Timeline {
	readonly id: TimelineId;
	readonly unit: TimelineUnit;
	readonly media?: TimelineId;
}

/** A span on one timeline, in that timeline's native coordinate. */
export interface TimelineExtent {
	readonly start: number;
	readonly end: number;
}

export function formatTimelineValue(unit: TimelineUnit, value: number): string {
	if (unit === "seconds") {
		return formatSecondsToHHMMSSmmm(value);
	}
	if (unit === "measures") {
		return `measure ${formatWholeOrTwoDecimals(value)}`;
	}
	if (unit === "ticks") {
		return `${Math.round(value)} MIDI ticks`;
	}
	if (unit === "samples" || unit === "pixels") {
		return `${Math.round(value)} ${unit}`;
	}
	return `${formatWholeOrTwoDecimals(value)}%`;
}

/** A timer's two halves, rendered as "position / duration". */
export interface TimelineValuePair {
	position: string;
	duration: string;
}

/**
 * A timer names its unit once for the pair rather than on both halves, so it
 * reads "measure 5 / 55" and "300 / 400 samples" instead of repeating itself.
 */
export function formatTimelineValuePair(
	unit: TimelineUnit,
	position: number,
	duration: number,
): TimelineValuePair {
	if (unit === "seconds") {
		return {
			position: formatSecondsToHHMMSSmmm(position),
			duration: formatSecondsToHHMMSSmmm(duration),
		};
	}
	if (unit === "measures") {
		return {
			position: `measure ${formatWholeOrTwoDecimals(position)}`,
			duration: formatWholeOrTwoDecimals(duration),
		};
	}
	if (unit === "ticks") {
		return {
			position: String(Math.round(position)),
			duration: `${Math.round(duration)} MIDI ticks`,
		};
	}
	if (unit === "samples" || unit === "pixels") {
		return {
			position: String(Math.round(position)),
			duration: `${Math.round(duration)} ${unit}`,
		};
	}
	return {
		position: formatWholeOrTwoDecimals(position),
		duration: `${formatWholeOrTwoDecimals(duration)}%`,
	};
}

function formatWholeOrTwoDecimals(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
