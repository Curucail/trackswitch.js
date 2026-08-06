import type { MeasureMapPoint } from "../../shared/measure-map";
import type { SheetMusicEntryModel } from "./types";
import { sanitizePlaybackPosition } from "./types";

interface CursorSyncContext {
	lastPosition: number;
	entries: SheetMusicEntryModel[];
	rebindMeasureCursor(
		entry: SheetMusicEntryModel,
	): SheetMusicEntryModel["measureCursor"];
	ensureCurrentMeasureVisible(entry: SheetMusicEntryModel): void;
}

export function updatePosition(
	ctx: CursorSyncContext,
	referencePosition: number,
): void {
	ctx.lastPosition = sanitizePlaybackPosition(referencePosition);

	ctx.entries.forEach((entry: SheetMusicEntryModel) => {
		if (
			!entry.syncEnabled ||
			!entry.measureMap ||
			entry.measureMap.length === 0
		) {
			return;
		}

		const cursor = ctx.rebindMeasureCursor(entry);
		if (!cursor) {
			return;
		}

		const mappedMeasure = resolveMappedMeasure(
			entry.measureMap,
			ctx.lastPosition,
		);
		if (mappedMeasure === null) {
			return;
		}

		const targetMeasure = resolveAvailableMeasure(entry, mappedMeasure);
		if (targetMeasure === null || targetMeasure === entry.targetMeasure) {
			return;
		}

		moveCursorToMeasure(ctx, entry, targetMeasure);
	});
}

function resolveMappedMeasure(
	measureMap: MeasureMapPoint[],
	position: number,
): number | null {
	if (measureMap.length === 0) {
		return null;
	}

	let low = 0;
	let high = measureMap.length;

	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (measureMap[mid].start <= position) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	const index = low - 1;
	const selected = index >= 0 ? measureMap[index] : measureMap[0];
	return Math.floor(selected.measure);
}

/** Snaps a printed measure number onto one the score actually covers. */
export function resolveAvailableMeasure(
	entry: SheetMusicEntryModel,
	desiredMeasure: number,
): number | null {
	const printed = entry.measureNumbering.printed;
	if (printed.length === 0) {
		return null;
	}

	if (entry.measureNumbering.printedSet.has(desiredMeasure)) {
		return desiredMeasure;
	}

	for (let index = printed.length - 1; index >= 0; index -= 1) {
		const candidate = printed[index];
		if (candidate <= desiredMeasure) {
			return candidate;
		}
	}

	return printed[0];
}

/**
 * Drives the cursor to a printed measure number. The stepping itself runs in
 * internal numbers: they are gapless and unique, so distances are meaningful
 * and a repeated printed number cannot stall the walk.
 */
export function moveCursorToMeasure(
	ctx: CursorSyncContext,
	entry: SheetMusicEntryModel,
	targetMeasure: number,
): void {
	const cursor = ctx.rebindMeasureCursor(entry);
	if (!cursor?.reset || !cursor?.nextMeasure || !cursor?.previousMeasure) {
		return;
	}

	const targetInternal =
		entry.measureNumbering.internalByPrinted.get(targetMeasure);
	if (targetInternal === undefined) {
		return;
	}

	const measureCount = entry.measureNumbering.printedByInternal.size;
	let currentInternal = initializeCursorMeasure(entry, cursor);

	const estimatedDistance =
		currentInternal === null
			? measureCount
			: Math.abs(targetInternal - currentInternal);
	const maxSteps = Math.max(
		1,
		Math.min(measureCount + 5, estimatedDistance + 8),
	);
	currentInternal = stepCursorTowardsTarget(
		cursor,
		currentInternal,
		targetInternal,
		maxSteps,
	);

	if (currentInternal !== targetInternal) {
		currentInternal = retryCursorFromReset(entry, cursor, targetInternal);
	}

	entry.targetMeasure =
		currentInternal === null
			? targetMeasure
			: (entry.measureNumbering.printedByInternal.get(currentInternal) ??
				targetMeasure);

	ctx.ensureCurrentMeasureVisible(entry);
}

/** The score's first internal measure number, where the cursor lands on reset. */
function firstInternalMeasure(entry: SheetMusicEntryModel): number | null {
	const firstPrinted = entry.measureNumbering.printed[0];
	if (firstPrinted === undefined) {
		return null;
	}

	return entry.measureNumbering.internalByPrinted.get(firstPrinted) ?? null;
}

function initializeCursorMeasure(
	entry: SheetMusicEntryModel,
	cursor: NonNullable<SheetMusicEntryModel["measureCursor"]>,
): number | null {
	showCursor(cursor);

	let currentMeasure = readCursorMeasure(cursor);
	if (currentMeasure !== null) {
		return currentMeasure;
	}

	cursor.reset?.();
	showCursor(cursor);

	currentMeasure = readCursorMeasure(cursor);
	return currentMeasure === null ? firstInternalMeasure(entry) : currentMeasure;
}

function retryCursorFromReset(
	entry: SheetMusicEntryModel,
	cursor: NonNullable<SheetMusicEntryModel["measureCursor"]>,
	targetMeasure: number,
): number | null {
	cursor.reset?.();
	showCursor(cursor);

	const fallbackMeasure = readCursorMeasure(cursor);
	const initialMeasure =
		fallbackMeasure === null ? firstInternalMeasure(entry) : fallbackMeasure;
	const fallbackMaxSteps = Math.max(
		1,
		entry.measureNumbering.printedByInternal.size + 5,
	);
	return stepCursorTowardsTarget(
		cursor,
		initialMeasure,
		targetMeasure,
		fallbackMaxSteps,
	);
}

function stepCursorTowardsTarget(
	cursor: NonNullable<SheetMusicEntryModel["measureCursor"]>,
	startingMeasure: number | null,
	targetMeasure: number,
	maxSteps: number,
): number | null {
	let currentMeasure = startingMeasure;
	let steps = 0;

	while (
		currentMeasure !== null &&
		currentMeasure !== targetMeasure &&
		steps < maxSteps
	) {
		moveCursorOneStep(cursor, currentMeasure, targetMeasure);

		const nextMeasure = readCursorMeasure(cursor);
		if (nextMeasure === null || nextMeasure === currentMeasure) {
			break;
		}

		currentMeasure = nextMeasure;
		steps += 1;
	}

	return currentMeasure;
}

function moveCursorOneStep(
	cursor: NonNullable<SheetMusicEntryModel["measureCursor"]>,
	currentMeasure: number,
	targetMeasure: number,
): void {
	if (currentMeasure < targetMeasure) {
		cursor.nextMeasure?.();
	} else {
		cursor.previousMeasure?.();
	}
}

function showCursor(
	cursor: NonNullable<SheetMusicEntryModel["measureCursor"]>,
): void {
	cursor.show?.();
}

/** The cursor's position as an internal measure number. */
function readCursorMeasure(
	cursor: NonNullable<SheetMusicEntryModel["measureCursor"]>,
): number | null {
	const raw = cursor.Iterator?.CurrentMeasure?.MeasureNumber;
	if (!Number.isFinite(raw)) {
		return null;
	}

	return Math.floor(raw as number);
}

export function resolveReferenceTimeForMeasure(
	measureMap: MeasureMapPoint[],
	clickedMeasure: number,
): number {
	let firstExactStart: number | null = null;
	let lastLowerStart: number | null = null;

	for (let index = 0; index < measureMap.length; index += 1) {
		const point = measureMap[index];
		const mappedMeasure = Math.floor(point.measure);

		if (mappedMeasure === clickedMeasure) {
			if (firstExactStart === null) {
				firstExactStart = point.start;
			}
			continue;
		}

		if (mappedMeasure < clickedMeasure) {
			lastLowerStart = point.start;
		}
	}

	if (firstExactStart !== null) {
		return firstExactStart;
	}

	if (lastLowerStart !== null) {
		return lastLowerStart;
	}

	return measureMap[0].start;
}
