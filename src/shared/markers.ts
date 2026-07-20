import Papa from "papaparse";
import type {
	TrackMarker,
	TrackMarkerConfig,
	TrackRuntime,
} from "../domain/types";
import { requestText } from "./request-text";

interface RawMarkerRow {
	[column: string]: unknown;
}

interface PendingMarker {
	rowIndex: number;
	time: number;
	label: string;
}

function formatMarkerCsvErrors(
	errors: Array<{ message: string; row?: number }>,
): string {
	return errors
		.map((error) => {
			const rowSuffix =
				typeof error.row === "number" ? ` (row ${error.row})` : "";
			return error.message + rowSuffix;
		})
		.join("; ");
}

function markerSourceLabel(
	trackIndex: number,
	trackTitle: string | undefined,
): string {
	const title = typeof trackTitle === "string" ? trackTitle.trim() : "";
	return title
		? `track ${trackIndex + 1} (${title})`
		: `track ${trackIndex + 1}`;
}

export function parseTrackMarkers(
	csvText: string,
	config: TrackMarkerConfig,
	trackIndex: number,
	trackTitle: string | undefined,
	trackDuration: number,
): TrackMarker[] {
	const sourceLabel = markerSourceLabel(trackIndex, trackTitle);
	const parsed = Papa.parse<RawMarkerRow>(
		String(csvText || "").replace(/^\uFEFF/, ""),
		{
			delimiter: "",
			header: true,
			dynamicTyping: false,
			skipEmptyLines: "greedy",
			transformHeader: (header) => header.trim(),
		},
	);

	if (parsed.errors.length > 0) {
		throw new Error(
			`Marker CSV for ${sourceLabel} could not be parsed: ${formatMarkerCsvErrors(parsed.errors)}`,
		);
	}

	const headers = Array.isArray(parsed.meta.fields)
		? parsed.meta.fields.map((field) => String(field ?? "").trim())
		: [];
	if (headers.length === 0 || parsed.data.length === 0) {
		throw new Error(
			`Marker CSV for ${sourceLabel} must include a header and at least one data row.`,
		);
	}

	if (!headers.includes(config.timeColumn)) {
		throw new Error(
			`Marker CSV for ${sourceLabel} is missing time column "${config.timeColumn}".`,
		);
	}
	if (config.labelColumn && !headers.includes(config.labelColumn)) {
		throw new Error(
			`Marker CSV for ${sourceLabel} is missing label column "${config.labelColumn}".`,
		);
	}

	const pending: PendingMarker[] = parsed.data.map((row, rowIndex) => {
		const rawTime = row[config.timeColumn];
		const normalizedTime = String(rawTime ?? "").trim();
		const time =
			normalizedTime.length > 0 ? Number(normalizedTime) : Number.NaN;
		const csvRow = rowIndex + 2;

		if (!Number.isFinite(time)) {
			throw new Error(
				`Marker CSV for ${sourceLabel} has a non-numeric timestamp in column "${config.timeColumn}" at row ${csvRow}.`,
			);
		}
		if (time < 0 || time > trackDuration) {
			throw new Error(
				`Marker CSV for ${sourceLabel} has timestamp ${time} outside the playable range 0-${trackDuration} seconds at row ${csvRow}.`,
			);
		}

		return {
			rowIndex: rowIndex,
			time: time,
			label: config.labelColumn ? String(row[config.labelColumn] ?? "") : "",
		};
	});

	pending.sort((left, right) => {
		if (left.time === right.time) {
			return left.rowIndex - right.rowIndex;
		}
		return left.time - right.time;
	});

	return pending.map((marker, index) => ({
		id: index + 1,
		trackIndex: trackIndex,
		time: marker.time,
		label: config.labelColumn ? marker.label : String(index + 1),
	}));
}

export async function loadRuntimeMarkers(
	runtimes: TrackRuntime[],
	signal?: AbortSignal,
): Promise<void> {
	await Promise.all(
		runtimes.map(async (runtime, trackIndex) => {
			const config = runtime.definition.markers;
			if (!config) {
				runtime.markers = [];
				return;
			}

			const duration = runtime.baseSource.timing?.effectiveDuration;
			if (!Number.isFinite(duration) || (duration as number) <= 0) {
				throw new Error(
					`Marker CSV for track ${trackIndex + 1} cannot be validated because the track has no playable duration.`,
				);
			}

			const csvText = await requestText(
				config.csv,
				"marker CSV source",
				signal,
			);
			runtime.markers = parseTrackMarkers(
				csvText,
				config,
				trackIndex,
				runtime.definition.title,
				duration as number,
			);
		}),
	);
}
