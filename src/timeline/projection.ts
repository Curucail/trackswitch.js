import type {
	DuplicatePlacementPolicy,
	OutsideCoverageMode,
} from "../domain/types";
import {
	createTimeMappingSeries,
	mapTime,
	type TimeMappingPoint,
	type TimeMappingSeries,
} from "../shared/alignment";
import { type Marker, type MarkerSet, markerPlacement } from "./marker";
import type { TimelineExtent, TimelineId } from "./timeline";

export interface ProjectionService {
	project(
		value: number,
		from: TimelineId,
		to: TimelineId,
		preferredValue?: number,
	): number;
	projectMarker(marker: Marker, to: TimelineId): number | null;
	canProject(from: TimelineId, to: TimelineId): boolean;
	/**
	 * The span of `from` over which a mapping to `to` is actually annotated, in
	 * `from` coordinates — null when there is no path. Outside it a projection
	 * is an assumption rather than data, which is what `outsideCoverage`
	 * arbitrates; under "extrapolate" the span is unbounded.
	 */
	coverage(from: TimelineId, to: TimelineId): TimelineExtent | null;
	/** Whether projecting `value` from `from` to `to` stays inside that span. */
	isCovered(from: TimelineId, to: TimelineId, value: number): boolean;
}

export interface AlignmentSetInput {
	set: MarkerSet;
	outsideCoverage: OutsideCoverageMode;
	duplicatePlacements: DuplicatePlacementPolicy;
}

const EDGE_SEPARATOR = " ";

function edgeKey(from: TimelineId, to: TimelineId): string {
	return `${from}${EDGE_SEPARATOR}${to}`;
}

export function buildProjectionService(
	alignmentSets: readonly AlignmentSetInput[],
	referenceTimeline: TimelineId,
): ProjectionService {
	const edges = new Map<string, TimeMappingSeries>();
	const modes = new Map<string, OutsideCoverageMode>();

	for (const { set, outsideCoverage, duplicatePlacements } of alignmentSets) {
		const pointsByPair = new Map<
			string,
			{ from: TimelineId; to: TimelineId; points: TimeMappingPoint[] }
		>();

		for (const marker of set.markers) {
			const timelines = Array.from(marker.placements.keys());
			for (const from of timelines) {
				for (const to of timelines) {
					if (from === to) {
						continue;
					}
					const x = marker.placements.get(from) as number;
					const y = marker.placements.get(to) as number;
					const key = edgeKey(from, to);
					let bucket = pointsByPair.get(key);
					if (!bucket) {
						bucket = { from, to, points: [] };
						pointsByPair.set(key, bucket);
					}
					bucket.points.push({ x, y });
				}
			}
		}

		for (const { from, to, points } of pointsByPair.values()) {
			const key = edgeKey(from, to);
			edges.set(key, createTimeMappingSeries(points, duplicatePlacements));
			modes.set(key, outsideCoverage);
		}
	}

	function directProject(
		value: number,
		from: TimelineId,
		to: TimelineId,
		preferredValue?: number,
	): number | null {
		if (from === to) {
			return value;
		}
		const series = edges.get(edgeKey(from, to));
		if (!series) {
			return null;
		}
		const mode = modes.get(edgeKey(from, to)) ?? "error";
		return mapTime(series, value, mode, preferredValue);
	}

	function canProject(from: TimelineId, to: TimelineId): boolean {
		if (from === to) {
			return true;
		}
		if (edges.has(edgeKey(from, to))) {
			return true;
		}
		return (
			edges.has(edgeKey(from, referenceTimeline)) &&
			edges.has(edgeKey(referenceTimeline, to))
		);
	}

	function project(
		value: number,
		from: TimelineId,
		to: TimelineId,
		preferredValue?: number,
	): number {
		const direct = directProject(value, from, to, preferredValue);
		if (direct !== null) {
			return direct;
		}

		const viaReference = directProject(value, from, referenceTimeline);
		if (viaReference === null) {
			throw new Error(
				`No alignment path from timeline "${from}" to the reference timeline "${referenceTimeline}".`,
			);
		}

		const result = directProject(
			viaReference,
			referenceTimeline,
			to,
			preferredValue,
		);
		if (result === null) {
			throw new Error(
				`No alignment path from the reference timeline "${referenceTimeline}" to timeline "${to}".`,
			);
		}

		return result;
	}

	const UNBOUNDED: TimelineExtent = {
		start: Number.NEGATIVE_INFINITY,
		end: Number.POSITIVE_INFINITY,
	};

	function edgeCoverage(
		from: TimelineId,
		to: TimelineId,
	): TimelineExtent | null {
		const key = edgeKey(from, to);
		const series = edges.get(key);
		if (!series) {
			return null;
		}
		if (modes.get(key) === "extrapolate") {
			return UNBOUNDED;
		}
		return { start: series.extent.start, end: series.extent.end };
	}

	function coverage(from: TimelineId, to: TimelineId): TimelineExtent | null {
		if (from === to) {
			return UNBOUNDED;
		}
		const direct = edgeCoverage(from, to);
		if (direct) {
			return direct;
		}
		return edgeCoverage(from, referenceTimeline);
	}

	function isCovered(from: TimelineId, to: TimelineId, value: number): boolean {
		const span = coverage(from, to);
		if (!span) {
			return false;
		}
		if (value < span.start || value > span.end) {
			return false;
		}
		if (from === to || edges.has(edgeKey(from, to))) {
			return true;
		}

		// Routed via the reference: the second hop has its own annotated span.
		const viaReference = directProject(value, from, referenceTimeline);
		if (viaReference === null) {
			return false;
		}
		const secondHop = edgeCoverage(referenceTimeline, to);
		return (
			!!secondHop &&
			viaReference >= secondHop.start &&
			viaReference <= secondHop.end
		);
	}

	function projectMarker(marker: Marker, to: TimelineId): number | null {
		const direct = markerPlacement(marker, to);
		if (direct !== null) {
			return direct;
		}

		for (const [from, value] of marker.placements) {
			if (canProject(from, to)) {
				return project(value, from, to);
			}
		}

		return null;
	}

	return { project, projectMarker, canProject, coverage, isCovered };
}

/**
 * The playable reference extent. A medium-backed reference uses that medium's
 * native extent so trimming and padding affect the player duration. An abstract
 * reference falls back to the alignment set's coverage.
 */
export function computeReferenceExtent(
	set: MarkerSet,
	referenceTimeline: TimelineId,
	mediaExtent?: TimelineExtent,
): TimelineExtent {
	if (mediaExtent) {
		return { ...mediaExtent };
	}

	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;

	for (const marker of set.markers) {
		const value = marker.placements.get(referenceTimeline);
		if (value === undefined) {
			continue;
		}
		if (value < start) {
			start = value;
		}
		if (value > end) {
			end = value;
		}
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new Error(
			`Alignment set "${set.id}" has no placements on the reference timeline "${referenceTimeline}".`,
		);
	}

	return { start, end };
}
