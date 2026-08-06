import type {
	DuplicatePlacementPolicy,
	OutsideCoverageMode,
} from "../domain/types";
import { parseCsvRecords } from "./csv";

interface CsvNumericRow {
	[column: string]: number;
}

export interface ParsedNumericCsv {
	headers: string[];
	rows: CsvNumericRow[];
}

export interface TimeMappingPoint {
	x: number;
	y: number;
}

/** A stretch of the correspondence path over which the source value never decreases. */
export interface MappingRun {
	points: TimeMappingPoint[];
}

export interface TimeMappingSeries {
	runs: MappingRun[];
	/** The annotated span on the source axis, across every run. */
	extent: { start: number; end: number };
	/**
	 * The earliest placement at each end of the span, which the ends map to
	 * whatever the duplicate policy is. Where the source holds one value across
	 * several rows, that value names the whole stretch, and arriving at it means
	 * arriving at its beginning — seeking to the last measure of a score reaches
	 * the moment that measure starts sounding, not the end of its decay.
	 */
	edgeValues: { start: number; end: number };
	duplicatePlacements: DuplicatePlacementPolicy;
}

export function parseNumericCsv(csvText: string): ParsedNumericCsv {
	const parsed = parseCsvRecords(csvText, {
		emptyDataError:
			"Alignment CSV must include a header and at least one data row.",
	});

	const rows: CsvNumericRow[] = [];

	for (let lineIndex = 0; lineIndex < parsed.rows.length; lineIndex += 1) {
		const sourceRow = parsed.rows[lineIndex] || {};
		const row: CsvNumericRow = {};
		let validRow = true;

		for (let cellIndex = 0; cellIndex < parsed.headers.length; cellIndex += 1) {
			const header = parsed.headers[cellIndex];
			const parsedCell = Number(sourceRow[header]);
			if (!Number.isFinite(parsedCell)) {
				validRow = false;
				break;
			}
			row[header] = parsedCell;
		}

		if (validRow) {
			rows.push(row);
		}
	}

	if (rows.length === 0) {
		throw new Error("Alignment CSV does not contain valid numeric rows.");
	}

	return {
		headers: parsed.headers,
		rows: rows,
	};
}

/**
 * Splits the correspondence path into maximal stretches over which the source
 * value never decreases. A performance that plays a repeat its counterpart
 * skips walks the same span of the other timeline twice, so projecting *from*
 * that timeline has two answers — one run each — while projecting *to* it stays
 * a single run that steps backwards at the repeat boundary.
 */
function splitIntoRuns(points: TimeMappingPoint[]): MappingRun[] {
	const runs: MappingRun[] = [];
	let current: TimeMappingPoint[] = [points[0]];

	for (let index = 1; index < points.length; index += 1) {
		const point = points[index];
		if (point.x < current[current.length - 1].x) {
			runs.push({ points: current });
			current = [point];
			continue;
		}
		current.push(point);
	}

	runs.push({ points: current });
	return runs;
}

export function createTimeMappingSeries(
	points: TimeMappingPoint[],
	duplicatePlacements: DuplicatePlacementPolicy,
): TimeMappingSeries {
	if (!Array.isArray(points) || points.length === 0) {
		throw new Error("Time mapping series requires at least one point.");
	}

	const normalized = points
		.map((point) => ({
			x: Number(point.x),
			y: Number(point.y),
		}))
		.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

	if (normalized.length === 0) {
		throw new Error("Time mapping series requires finite numeric points.");
	}

	const runs = splitIntoRuns(normalized);
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const run of runs) {
		start = Math.min(start, run.points[0].x);
		end = Math.max(end, run.points[run.points.length - 1].x);
	}

	let startValue = Number.POSITIVE_INFINITY;
	let endValue = Number.POSITIVE_INFINITY;
	for (const point of normalized) {
		if (point.x === start) {
			startValue = Math.min(startValue, point.y);
		}
		if (point.x === end) {
			endValue = Math.min(endValue, point.y);
		}
	}

	return {
		runs,
		extent: { start, end },
		edgeValues: { start: startValue, end: endValue },
		duplicatePlacements,
	};
}

/** The y this run gives for a value known to lie inside its span. */
function mapWithinRun(
	run: MappingRun,
	value: number,
	duplicatePlacements: DuplicatePlacementPolicy,
	preferredValue?: number,
): number {
	const points = run.points;
	// The first index whose x reaches `value`, so an exact hit lands on the
	// earliest of any points sharing that x — what "first" selects.
	const rightIndex = firstIndexGreaterOrEqual(points, value);
	const right = points[rightIndex];

	if (right.x === value) {
		if (Number.isFinite(preferredValue)) {
			let closest = right.y;
			let closestDistance = Math.abs(right.y - (preferredValue as number));
			for (
				let index = rightIndex + 1;
				index < points.length && points[index].x === value;
				index += 1
			) {
				const distance = Math.abs(points[index].y - (preferredValue as number));
				if (distance < closestDistance) {
					closest = points[index].y;
					closestDistance = distance;
				}
			}
			return closest;
		}
		if (duplicatePlacements !== "average") {
			return right.y;
		}
		let total = 0;
		let count = 0;
		for (
			let index = rightIndex;
			index < points.length && points[index].x === value;
			index += 1
		) {
			total += points[index].y;
			count += 1;
		}
		return total / count;
	}

	if (rightIndex === 0) {
		return right.y;
	}

	return interpolate(points[rightIndex - 1], right, value);
}

export function mapTime(
	series: TimeMappingSeries,
	time: number,
	outsideCoverage: OutsideCoverageMode,
	preferredValue?: number,
): number {
	const runs = series.runs;
	if (runs.length === 0 || !Number.isFinite(time)) {
		return 0;
	}

	// The ends of the span answer with the first placement there rather than the
	// middle of a held value, so arriving at a held value arrives at the start of
	// the stretch it names and playback runs through the rest of it.
	if (time === series.extent.start && !Number.isFinite(preferredValue)) {
		return series.edgeValues.start;
	}
	if (time === series.extent.end && !Number.isFinite(preferredValue)) {
		return series.edgeValues.end;
	}

	const candidates: number[] = [];
	for (const run of runs) {
		const points = run.points;
		if (time < points[0].x || time > points[points.length - 1].x) {
			continue;
		}
		candidates.push(
			mapWithinRun(run, time, series.duplicatePlacements, preferredValue),
		);
	}

	if (candidates.length === 1) {
		return candidates[0];
	}

	if (candidates.length > 1) {
		if (Number.isFinite(preferredValue)) {
			return candidates.reduce((closest, candidate) =>
				Math.abs(candidate - (preferredValue as number)) <
				Math.abs(closest - (preferredValue as number))
					? candidate
					: closest,
			);
		}
		if (series.duplicatePlacements !== "average") {
			// Runs are in CSV order, so the earliest one is "the first in the list".
			return candidates[0];
		}
		let total = 0;
		for (const candidate of candidates) {
			total += candidate;
		}
		return total / candidates.length;
	}

	const extent = series.extent;
	if (outsideCoverage === "error") {
		throw new Error(
			`Value ${time} is outside the mapped coverage [${extent.start}, ${extent.end}].`,
		);
	}

	const firstRun = runs[0].points;
	const lastRun = runs[runs.length - 1].points;

	if (time < extent.start) {
		if (outsideCoverage === "hold") {
			return firstRun[0].y;
		}
		return extrapolateFromStart(firstRun, time);
	}

	if (outsideCoverage === "hold") {
		return lastRun[lastRun.length - 1].y;
	}
	return extrapolateFromEnd(lastRun, time);
}

function firstIndexGreaterOrEqual(
	points: TimeMappingPoint[],
	value: number,
): number {
	let low = 0;
	let high = points.length - 1;

	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (points[mid].x < value) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	return low;
}

function extrapolateFromStart(
	points: TimeMappingPoint[],
	time: number,
): number {
	const first = points[0];
	const next = findDistinct(points, 0, 1);
	if (!next) {
		return first.y;
	}

	return interpolate(first, next, time);
}

function extrapolateFromEnd(points: TimeMappingPoint[], time: number): number {
	const last = points[points.length - 1];
	const previous = findDistinct(points, points.length - 1, -1);
	if (!previous) {
		return last.y;
	}

	return interpolate(previous, last, time);
}

function findDistinct(
	points: TimeMappingPoint[],
	startIndex: number,
	direction: 1 | -1,
): TimeMappingPoint | null {
	const anchor = points[startIndex];
	let index = startIndex + direction;

	while (index >= 0 && index < points.length) {
		const candidate = points[index];
		if (candidate.x !== anchor.x) {
			return candidate;
		}
		index += direction;
	}

	return null;
}

function interpolate(
	a: TimeMappingPoint,
	b: TimeMappingPoint,
	x: number,
): number {
	const deltaX = b.x - a.x;
	if (deltaX === 0) {
		return (a.y + b.y) / 2;
	}

	const t = (x - a.x) / deltaX;
	return a.y + t * (b.y - a.y);
}
