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

export type TimelineUnit =
	| "seconds"
	| "measure"
	| "beat"
	| { label: string; precision?: number };

export interface Timeline {
	readonly id: TimelineId;
	readonly unit: TimelineUnit;
	readonly media?: TimelineId;
}

export interface ReferenceExtent {
	readonly start: number;
	readonly end: number;
}

export function isSecondsUnit(unit: TimelineUnit): boolean {
	return unit === "seconds";
}

export function timelineUnitLabel(unit: TimelineUnit): string {
	if (typeof unit === "string") {
		return unit;
	}
	return unit.label;
}

export function formatTimelineValue(unit: TimelineUnit, value: number): string {
	if (unit === "seconds") {
		return formatSecondsToHHMMSSmmm(value);
	}
	if (unit === "measure") {
		return `m. ${formatWholeOrTwoDecimals(value)}`;
	}
	if (unit === "beat") {
		return `beat ${formatWholeOrTwoDecimals(value)}`;
	}
	const precision = unit.precision ?? 2;
	return `${value.toFixed(precision)} ${unit.label}`;
}

function formatWholeOrTwoDecimals(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
