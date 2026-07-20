import { parseCsvRecords } from "../shared/csv";
import { createMarkerId, markerSetId, type Marker, type MarkerSet } from "./marker";
import { timelineId, type TimelineId } from "./timeline";

export interface AlignmentCsvSpec {
	kind: "alignment";
	setId: string;
	csvText: string;
	/** timeline id -> CSV column name */
	timelines: Record<string, string>;
}

export interface AnnotationCsvSpec {
	kind: "annotation";
	setId: string;
	csvText: string;
	timeline: TimelineId;
	timeCol: string;
	labelCol?: string;
}

export type MarkerCsvSpec = AlignmentCsvSpec | AnnotationCsvSpec;

export function parseMarkerCsv(spec: MarkerCsvSpec): MarkerSet {
	return spec.kind === "alignment"
		? parseAlignmentCsv(spec)
		: parseAnnotationCsv(spec);
}

function parseAlignmentCsv(spec: AlignmentCsvSpec): MarkerSet {
	const setId = markerSetId(spec.setId);
	const parsed = parseCsvRecords(spec.csvText, {
		emptyDataError: `Alignment set "${spec.setId}" must include a header and at least one data row.`,
	});

	const columnEntries = Object.entries(spec.timelines);
	for (const [timeline, column] of columnEntries) {
		if (!parsed.headers.includes(column)) {
			throw new Error(
				`Alignment set "${spec.setId}" is missing column "${column}" for timeline "${timeline}".`,
			);
		}
	}

	const markers: Marker[] = [];

	parsed.rows.forEach((row, rowIndex) => {
		const csvRow = rowIndex + 2;
		const placements = new Map<TimelineId, number>();

		for (const [timeline, column] of columnEntries) {
			const raw = row[column];
			if (raw === undefined || raw === null || raw === "") {
				continue;
			}
			const value = typeof raw === "number" ? raw : Number(raw);
			if (!Number.isFinite(value)) {
				throw new Error(
					`Alignment set "${spec.setId}" row ${csvRow} has a non-numeric value "${raw}" ` +
						`in column "${column}" (timeline "${timeline}").`,
				);
			}
			placements.set(timelineId(timeline), value);
		}

		if (placements.size === 0) {
			throw new Error(
				`Alignment set "${spec.setId}" row ${csvRow} has no numeric placements on any configured timeline.`,
			);
		}

		markers.push({
			id: createMarkerId(setId, rowIndex),
			set: setId,
			placements,
		});
	});

	return { id: setId, markerType: "alignment", markers };
}

function parseAnnotationCsv(spec: AnnotationCsvSpec): MarkerSet {
	const setId = markerSetId(spec.setId);
	const parsed = parseCsvRecords(spec.csvText, {
		emptyDataError: `Marker set "${spec.setId}" must include a header and at least one data row.`,
	});

	if (!parsed.headers.includes(spec.timeCol)) {
		throw new Error(
			`Marker set "${spec.setId}" is missing time column "${spec.timeCol}".`,
		);
	}
	if (spec.labelCol && !parsed.headers.includes(spec.labelCol)) {
		throw new Error(
			`Marker set "${spec.setId}" is missing label column "${spec.labelCol}".`,
		);
	}

	const markers: Marker[] = parsed.rows.map((row, rowIndex) => {
		const csvRow = rowIndex + 2;
		const raw = row[spec.timeCol];
		const value = typeof raw === "number" ? raw : Number(raw);

		if (raw === undefined || raw === null || raw === "" || !Number.isFinite(value)) {
			throw new Error(
				`Marker set "${spec.setId}" has a non-numeric value in column "${spec.timeCol}" at row ${csvRow}.`,
			);
		}

		const placements = new Map<TimelineId, number>([[spec.timeline, value]]);
		const label = spec.labelCol ? String(row[spec.labelCol] ?? "") : undefined;

		return {
			id: createMarkerId(setId, rowIndex),
			set: setId,
			placements,
			label,
		};
	});

	markers.sort((a, b) => {
		const left = a.placements.get(spec.timeline) ?? 0;
		const right = b.placements.get(spec.timeline) ?? 0;
		return left - right;
	});

	return { id: setId, markerType: "annotation", markers };
}
