import type { TimelineId } from "./timeline";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MarkerSetId = Brand<string, "MarkerSetId">;

export function markerSetId(value: string): MarkerSetId {
	return value as MarkerSetId;
}

/**
 * Determines behaviour, never appears in config:
 * - alignment: dense correspondence rows, feeds the projection graph, never rendered as DOM.
 * - annotation: sparse authored markers, eligible for rendering/seeking/navigation/snapping.
 * - runtime: ephemeral, player-created ($playhead, $loop:a, $loop:b), same projection path as CSV markers.
 */
export type MarkerType = "alignment" | "annotation" | "runtime";

export interface Marker {
	readonly id: string;
	readonly set: MarkerSetId;
	readonly placements: ReadonlyMap<TimelineId, number>;
	readonly label?: string;
}

export interface MarkerSet {
	readonly id: MarkerSetId;
	readonly markerType: MarkerType;
	readonly markers: Marker[];
}

export function markerPlacement(
	marker: Marker,
	timeline: TimelineId,
): number | null {
	const value = marker.placements.get(timeline);
	return value === undefined ? null : value;
}

export function createMarkerId(setId: MarkerSetId, rowIndex: number): string {
	return `${setId}:${rowIndex}`;
}

export function createMarker(
	id: string,
	set: MarkerSetId,
	placements: ReadonlyMap<TimelineId, number>,
	label?: string,
): Marker {
	return { id, set, placements, label };
}

/** Immutable update — used to move runtime markers (playhead, loop points) each frame. */
export function withPlacement(
	marker: Marker,
	timeline: TimelineId,
	value: number,
): Marker {
	const next = new Map(marker.placements);
	next.set(timeline, value);
	return { ...marker, placements: next };
}
