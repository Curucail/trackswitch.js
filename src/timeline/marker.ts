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
	readonly hidden?: boolean;
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

export const RUNTIME_MARKER_SET_ID = markerSetId("$runtime");
export const PLAYHEAD_MARKER_ID = "$playhead";
export const LOOP_A_MARKER_ID = "$loop:a";
export const LOOP_B_MARKER_ID = "$loop:b";

/**
 * The player-owned markers. Playback code still exposes numeric positions through
 * the public snapshot API, but these markers are the canonical projection/display
 * representation and travel through the same graph as authored markers.
 */
export interface RuntimeMarkerSet {
	readonly set: MarkerSet;
	readonly playhead: Marker;
	readonly loopA: Marker | null;
	readonly loopB: Marker | null;
}

export function createRuntimeMarkerSet(
	referenceTimeline: TimelineId,
	position = 0,
): RuntimeMarkerSet {
	const playhead = createMarker(
		PLAYHEAD_MARKER_ID,
		RUNTIME_MARKER_SET_ID,
		new Map([[referenceTimeline, position]]),
		"Playhead",
	);
	return {
		set: {
			id: RUNTIME_MARKER_SET_ID,
			markerType: "runtime",
			markers: [playhead],
		},
		playhead,
		loopA: null,
		loopB: null,
	};
}

export function moveRuntimeMarker(
	state: RuntimeMarkerSet,
	marker: "playhead" | "loopA" | "loopB",
	referenceTimeline: TimelineId,
	value: number | null,
): RuntimeMarkerSet {
	const id =
		marker === "playhead"
			? PLAYHEAD_MARKER_ID
			: marker === "loopA"
				? LOOP_A_MARKER_ID
				: LOOP_B_MARKER_ID;
	const label =
		marker === "playhead"
			? "Playhead"
			: marker === "loopA"
				? "Loop A"
				: "Loop B";
	const current = state[marker];
	const next =
		value === null
			? null
			: current
				? withPlacement(current, referenceTimeline, value)
				: createMarker(
						id,
						RUNTIME_MARKER_SET_ID,
						new Map([[referenceTimeline, value]]),
						label,
					);
	const updated = { ...state, [marker]: next } as RuntimeMarkerSet;
	return {
		...updated,
		set: {
			...state.set,
			markers: [updated.playhead, updated.loopA, updated.loopB].filter(
				(entry): entry is Marker => entry !== null,
			),
		},
	};
}
