import { parseCsvRecords } from "../shared/csv";
import { requestText } from "../shared/request-text";
import type { MarkerSequenceType, MarkersConfig, MediaConfig } from "../types";
import type { Alignment } from "./alignment";
import {
	IMPLICIT_REFERENCE_TIMELINE,
	type MediaProfile,
	referenceNativeValue,
	resolveImplicitTimelineUnit,
	type TimelineId,
	timelineId,
} from "./timeline";

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MarkerSequenceId = Brand<string, "MarkerSequenceId">;

export function markerSequenceId(value: string): MarkerSequenceId {
	return value as MarkerSequenceId;
}

/**
 * A discrete position on one timeline — the model's `m ∈ T_i`. A marker lives on
 * exactly one timeline; correspondence with a marker on another timeline is an
 * alignment's business, never a property of the marker itself.
 */
export interface Marker {
	readonly id: string;
	readonly sequence: MarkerSequenceId;
	readonly timeline: TimelineId;
	readonly position: number;
	/** The annotation function `α_M(m) = l`; absent for an unlabelled marker. */
	readonly label?: string;
	/** Reachable by navigation but never drawn — the bounding markers of a sequence. */
	readonly hidden?: boolean;
}

/**
 * Semantically related markers in timeline order — the model's
 * `M_p = (m_1, …, m_N)`. Every marker of a sequence belongs to the sequence's
 * timeline; one timeline may carry any number of sequences.
 *
 * `annotation` sequences are authored (beats, measures, structure) and are
 * rendered, navigated and snapped to. `runtime` sequences are the player's own
 * (playhead, loop points) and travel through the same projection path.
 */
export interface MarkerSequence {
	readonly id: MarkerSequenceId;
	readonly timeline: TimelineId;
	readonly kind: "annotation" | "runtime";
	readonly type: MarkerSequenceType;
	readonly colors?: Readonly<Record<string, string>>;
	readonly hasLabels: boolean;
	readonly markers: readonly Marker[];
}

export function createMarker(
	id: string,
	sequence: MarkerSequenceId,
	timeline: TimelineId,
	position: number,
	label?: string,
): Marker {
	return { id, sequence, timeline, position, label };
}

/** The marker's position read on `timeline`, or null when it belongs elsewhere. */
export function markerPosition(
	marker: Marker,
	timeline: TimelineId,
): number | null {
	return marker.timeline === timeline ? marker.position : null;
}

// ═══════════ authored sequences ═══════════

interface MarkerCsvSpec {
	sequenceId: string;
	csvText: string;
	timeline: TimelineId;
	timeCol: string;
	labelCol?: string;
}

/**
 * A marker CSV's time column is authored in the unit of the timeline the
 * sequence belongs to — the same unit that timeline's alignment column and
 * readout use.
 */
function parseMarkerCsv(spec: MarkerCsvSpec): Marker[] {
	const sequence = markerSequenceId(spec.sequenceId);
	const parsed = parseCsvRecords(spec.csvText, {
		emptyDataError: `Marker sequence "${spec.sequenceId}" must include a header and at least one data row.`,
	});

	if (!parsed.headers.includes(spec.timeCol)) {
		throw new Error(
			`Marker sequence "${spec.sequenceId}" is missing time column "${spec.timeCol}".`,
		);
	}
	if (spec.labelCol && !parsed.headers.includes(spec.labelCol)) {
		throw new Error(
			`Marker sequence "${spec.sequenceId}" is missing label column "${spec.labelCol}".`,
		);
	}

	const markers = parsed.rows.map((row, rowIndex) => {
		const raw = row[spec.timeCol];
		const value = typeof raw === "number" ? raw : Number(raw);

		if (
			raw === undefined ||
			raw === null ||
			raw === "" ||
			!Number.isFinite(value)
		) {
			throw new Error(
				`Marker sequence "${spec.sequenceId}" has a non-numeric value in column "${spec.timeCol}" at row ${rowIndex + 2}.`,
			);
		}

		return createMarker(
			String(rowIndex + 1),
			sequence,
			spec.timeline,
			value,
			spec.labelCol ? String(row[spec.labelCol] ?? "") : undefined,
		);
	});

	// A sequence is ordered: `m_n < m_{n+1}` is what intra-timeline navigation
	// steps along.
	return markers.sort((left, right) => left.position - right.position);
}

/**
 * A marker CSV is authored in the unit of its timeline, so entries convert into
 * the native coordinate the player runs on, exactly as alignment anchors do.
 *
 * Without an alignment every medium shares the implicit timeline, whose unit is
 * the one the player reads out; there the conversion is that readout's inverse,
 * so a marker lands where the timer says it should.
 */
function buildNativeConverter(
	alignment: Alignment | null,
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
	const profile = implicit
		? profiles.get(timelineId(implicit.mediaId))
		: undefined;
	if (!implicit || !profile) {
		return (_timeline, value) => value;
	}

	return (_timeline, value) =>
		referenceNativeValue(profile, value, implicit.unit);
}

/**
 * Hidden markers at both ends of the timeline, so stepping backwards from the
 * first authored marker reaches the start of the medium and stepping forwards
 * past the last one reaches its end.
 */
function boundingMarkers(
	sequence: MarkerSequenceId,
	timeline: TimelineId,
	alignment: Alignment | null,
	playerEnd: number,
	markerCount: number,
): { first: Marker | null; last: Marker | null } {
	const toLocal = (referenceValue: number): number | null => {
		if (!alignment || timeline === alignment.referenceTimeline) {
			return referenceValue;
		}
		const { projection, referenceTimeline, outsideCoverage } = alignment;
		if (projection.isCovered(referenceTimeline, timeline, referenceValue)) {
			return projection.project(referenceValue, referenceTimeline, timeline);
		}
		// Outside the annotated span, only "error" leaves the bound unresolved:
		// `project` would throw there, and dropping the bound reproduces the
		// prior behaviour of leaving the sequence's final segment open. "hold"
		// and "extrapolate" both have a well-defined answer for this value.
		return outsideCoverage === "error"
			? null
			: projection.project(referenceValue, referenceTimeline, timeline);
	};

	const start = toLocal(0);
	const end = toLocal(playerEnd);
	const hide = (marker: Marker): Marker => ({ ...marker, hidden: true });

	return {
		first:
			start === null
				? null
				: hide(createMarker("0", sequence, timeline, start)),
		last:
			end === null
				? null
				: hide(createMarker(String(markerCount + 1), sequence, timeline, end)),
	};
}

function assertReachable(
	sequence: MarkerSequence,
	alignment: Alignment | null,
): void {
	if (!alignment || sequence.timeline === alignment.referenceTimeline) {
		return;
	}
	if (
		!alignment.projection.canProject(
			sequence.timeline,
			alignment.referenceTimeline,
		)
	) {
		throw new Error(
			`Marker sequence "${sequence.id}" is authored on timeline "${sequence.timeline}", which has no ` +
				`alignment mapping to the reference timeline "${alignment.referenceTimeline}".`,
		);
	}
}

export async function loadMarkerSequences(
	markers: MarkersConfig,
	alignment: Alignment | null,
	media: MediaConfig,
	profiles: ReadonlyMap<TimelineId, MediaProfile>,
	/** Reference-timeline extent the hidden bounding markers are pinned to. */
	playerEnd: number,
): Promise<Map<string, MarkerSequence>> {
	const referenceTimeline =
		alignment?.referenceTimeline ?? IMPLICIT_REFERENCE_TIMELINE;
	const toNative = buildNativeConverter(alignment, media, profiles);

	const csvTextBySrc = new Map<string, Promise<string>>();
	const loadCsvText = (src: string, sequenceId: string): Promise<string> => {
		let pending = csvTextBySrc.get(src);
		if (!pending) {
			pending = requestText(src, `marker sequence "${sequenceId}" source`);
			csvTextBySrc.set(src, pending);
		}
		return pending;
	};

	const entries = await Promise.all(
		Object.entries(markers).map(async ([sequenceId, config]) => {
			const csvText = await loadCsvText(config.src, sequenceId);
			const timeline = config.timeline
				? timelineId(config.timeline)
				: referenceTimeline;
			const id = markerSequenceId(sequenceId);

			const authored = parseMarkerCsv({
				sequenceId,
				csvText,
				timeline,
				timeCol: config.timeCol,
				labelCol: config.labelCol,
			}).map((marker) => ({
				...marker,
				position: toNative(timeline, marker.position),
			}));

			const bounds = boundingMarkers(
				id,
				timeline,
				alignment,
				playerEnd,
				authored.length,
			);
			const sequence: MarkerSequence = {
				id,
				timeline,
				kind: "annotation",
				type: config.type,
				colors: config.colors,
				hasLabels: typeof config.labelCol === "string",
				markers: [
					...(bounds.first ? [bounds.first] : []),
					...authored,
					...(bounds.last ? [bounds.last] : []),
				],
			};

			assertReachable(sequence, alignment);
			return [sequenceId, sequence] as const;
		}),
	);

	return new Map(entries);
}

// ═══════════ the player's own markers ═══════════

const RUNTIME_SEQUENCE_ID = markerSequenceId("$runtime");
const PLAYHEAD_MARKER_ID = "$playhead";
const LOOP_A_MARKER_ID = "$loop:a";
const LOOP_B_MARKER_ID = "$loop:b";

/**
 * The player-owned markers. Playback code still exposes numeric positions
 * through the public snapshot API, but these markers are the canonical
 * projection/display representation and travel through the same graph as
 * authored markers.
 */
export interface RuntimeMarkers {
	readonly sequence: MarkerSequence;
	readonly playhead: Marker;
	readonly loopA: Marker | null;
	readonly loopB: Marker | null;
}

const RUNTIME_MARKER_LABELS = {
	playhead: ["Playhead", PLAYHEAD_MARKER_ID],
	loopA: ["Loop A", LOOP_A_MARKER_ID],
	loopB: ["Loop B", LOOP_B_MARKER_ID],
} as const;

function runtimeSequence(
	timeline: TimelineId,
	markers: readonly Marker[],
): MarkerSequence {
	return {
		id: RUNTIME_SEQUENCE_ID,
		timeline,
		kind: "runtime",
		type: "points",
		hasLabels: true,
		markers,
	};
}

export function createRuntimeMarkers(
	referenceTimeline: TimelineId,
	position = 0,
): RuntimeMarkers {
	const playhead = createMarker(
		PLAYHEAD_MARKER_ID,
		RUNTIME_SEQUENCE_ID,
		referenceTimeline,
		position,
		"Playhead",
	);
	return {
		sequence: runtimeSequence(referenceTimeline, [playhead]),
		playhead,
		loopA: null,
		loopB: null,
	};
}

export function moveRuntimeMarker(
	state: RuntimeMarkers,
	marker: "playhead" | "loopA" | "loopB",
	referenceTimeline: TimelineId,
	value: number | null,
): RuntimeMarkers {
	const [label, id] = RUNTIME_MARKER_LABELS[marker];
	const next =
		value === null
			? null
			: createMarker(id, RUNTIME_SEQUENCE_ID, referenceTimeline, value, label);
	const updated = { ...state, [marker]: next } as RuntimeMarkers;
	return {
		...updated,
		sequence: runtimeSequence(
			referenceTimeline,
			[updated.playhead, updated.loopA, updated.loopB].filter(
				(entry): entry is Marker => entry !== null,
			),
		),
	};
}
