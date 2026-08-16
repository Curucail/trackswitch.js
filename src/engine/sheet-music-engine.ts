import { clampNonNegative } from "../shared/math";
import {
	moveCursorToMeasure,
	resolveAvailableMeasure,
	resolveReferenceTimeForMeasure,
	updatePosition as updateCursorPosition,
} from "./sheet-music/cursor-sync";
import {
	applyConfiguredRenderScale,
	attachMeasureMaps,
	disposeEntry,
	readHostWidth,
	rebindMeasureCursor,
	refreshCursorElement,
	renderEntry,
	renderFullScore,
	shouldRerenderOnResize,
} from "./sheet-music/entry-lifecycle";
import {
	handleHostClick,
	handleHostTouch,
	handleHostTouchMove,
	handleHostTouchStart,
} from "./sheet-music/interaction-hit-test";
import { createEmptyMeasureNumbering } from "./sheet-music/measure-numbering";
import {
	centerCurrentMeasureInViewport,
	ensureCurrentMeasureVisible,
} from "./sheet-music/scrolling";
import { loadProjectedTempoMaps } from "./sheet-music/tempo-map";
import type {
	SheetMusicEntryModel,
	SheetMusicHostConfig,
	SheetMusicMeasureMapsByAxis,
} from "./sheet-music/types";
import {
	DEFAULT_CURSOR_COLOR,
	sanitizeCursorAlpha,
	sanitizeRenderScale,
} from "./sheet-music/types";

export type { SheetMusicHostConfig } from "./sheet-music/types";

export class SheetMusicEngine {
	public readonly onSeekReferenceTime: ((referenceTime: number) => void) | null;
	public entries: SheetMusicEntryModel[] = [];
	public destroyed = false;
	public lastPosition = 0;
	public syncReferenceTimeEnabled = false;

	constructor(onSeekReferenceTime?: (referenceTime: number) => void) {
		this.onSeekReferenceTime =
			typeof onSeekReferenceTime === "function" ? onSeekReferenceTime : null;
	}

	/**
	 * Phase A — parse and render every score. Runs before the alignment is
	 * resolved so each score's printed measure numbers can supply its extent;
	 * call `attachMeasureMaps` afterwards to finish the entries.
	 */
	async initialize(hosts: SheetMusicHostConfig[]): Promise<void> {
		this.destroy();
		this.destroyed = false;

		this.entries = hosts.map((host) => {
			return {
				host: host.host,
				scrollContainer: host.scrollContainer || null,
				source: host.source,
				measureColumn: host.measureColumn,
				renderScale: sanitizeRenderScale(host.renderScale),
				followPlayback: host.followPlayback !== false,
				cursorColor: host.cursorColor || DEFAULT_CURSOR_COLOR,
				cursorAlpha: sanitizeCursorAlpha(host.cursorAlpha),
				osmd: null,
				measureCursor: null,
				syncReferenceTimeEnabled: false,
				measureMaps: {
					base: null,
					sync: null,
				},
				measureMap: null,
				projectedTempoSegmentsByAxis: {
					base: null,
					sync: null,
				},
				projectedTempoSegments: null,
				fallbackTempoBpm: null,
				measureNumbering: createEmptyMeasureNumbering(),
				syncEnabled: false,
				targetMeasure: null,
				clickListener: null,
				touchStartListener: null,
				touchMoveListener: null,
				touchListener: null,
				touchTapState: null,
				lastRenderedHostWidth: -1,
			};
		});

		await Promise.all(this.entries.map((entry) => renderEntry(this, entry)));
		this.updatePosition(this.lastPosition, this.syncReferenceTimeEnabled);
	}

	/** Printed measure numbers each rendered score covers, keyed by its media id. */
	getAvailableMeasuresByMediaId(): Map<string, number[]> {
		const byMediaId = new Map<string, number[]>();
		this.entries.forEach((entry) => {
			const mediaId = entry.measureColumn?.trim();
			if (mediaId) {
				byMediaId.set(mediaId, entry.measureNumbering.printed);
			}
		});
		return byMediaId;
	}

	/**
	 * Phase B — bind the alignment-derived measure maps rendered scores were
	 * waiting for. `buildMaps` receives each entry's measure column.
	 */
	async attachMeasureMaps(
		buildMaps: (
			measureColumn: string,
			source: string,
		) => Promise<SheetMusicMeasureMapsByAxis>,
	): Promise<void> {
		await Promise.all(
			this.entries.map((entry) => {
				const measureColumn = entry.measureColumn?.trim() ?? "";
				const maps = measureColumn
					? buildMaps(measureColumn, entry.source)
					: Promise.resolve({ base: null, sync: null });
				return attachMeasureMaps(this, entry, maps);
			}),
		);
		this.updatePosition(this.lastPosition, this.syncReferenceTimeEnabled);
	}

	updatePosition(
		referencePosition: number,
		syncReferenceTimeEnabled = this.syncReferenceTimeEnabled,
		isTimelineCovered?: (mediaId: string) => boolean,
	): void {
		this.applyReferenceTimeline(syncReferenceTimeEnabled);
		updateCursorPosition(this, clampNonNegative(referencePosition));

		if (!isTimelineCovered) {
			return;
		}
		// The cursor holds at its boundary measure where the alignment stops
		// covering the score; mark it so the freeze reads as intentional.
		this.entries.forEach((entry) => {
			const mediaId = entry.measureColumn?.trim();
			entry.host.classList.toggle(
				"ts-out-of-coverage",
				Boolean(mediaId) && !isTimelineCovered(mediaId as string),
			);
		});
	}

	resize(): void {
		let hasRerenderedEntry = false;

		this.entries.forEach((entry) => {
			if (!entry.osmd) {
				return;
			}

			if (!shouldRerenderOnResize(entry)) {
				return;
			}

			try {
				applyConfiguredRenderScale(entry);
				renderFullScore(entry);
				entry.lastRenderedHostWidth = readHostWidth(entry.host);
				rebindMeasureCursor(entry);
				refreshCursorElement(entry);
				ensureCurrentMeasureVisible(this, entry);
				hasRerenderedEntry = true;
			} catch (error) {
				console.warn(
					"[trackswitch] Failed to re-render sheet music on resize for source:",
					entry.source,
					error,
				);
			}
		});

		if (hasRerenderedEntry) {
			this.updatePosition(this.lastPosition, this.syncReferenceTimeEnabled);
		}
	}

	destroy(): void {
		this.destroyed = true;
		this.entries.forEach((entry) => {
			disposeEntry(entry);
		});
		this.entries = [];
	}

	public handleHostClick(entry: SheetMusicEntryModel, event: MouseEvent): void {
		handleHostClick(this, entry, event);
	}

	public handleHostTouchStart(
		entry: SheetMusicEntryModel,
		event: TouchEvent,
	): void {
		handleHostTouchStart(this, entry, event);
	}

	public handleHostTouchMove(
		entry: SheetMusicEntryModel,
		event: TouchEvent,
	): void {
		handleHostTouchMove(this, entry, event);
	}

	public handleHostTouch(entry: SheetMusicEntryModel, event: TouchEvent): void {
		handleHostTouch(this, entry, event);
	}

	public refreshCursorElement(entry: SheetMusicEntryModel): void {
		refreshCursorElement(entry);
	}

	public ensureCurrentMeasureVisible(entry: SheetMusicEntryModel): void {
		ensureCurrentMeasureVisible(this, entry);
	}

	public centerCurrentMeasureInViewport(entry: SheetMusicEntryModel): void {
		centerCurrentMeasureInViewport(this, entry);
	}

	public resolveAvailableMeasure(
		entry: SheetMusicEntryModel,
		desiredMeasure: number,
	): number | null {
		return resolveAvailableMeasure(entry, desiredMeasure);
	}

	public moveCursorToMeasure(
		entry: SheetMusicEntryModel,
		targetMeasure: number,
	): void {
		moveCursorToMeasure(this, entry, targetMeasure);
	}

	public rebindMeasureCursor(entry: SheetMusicEntryModel) {
		return rebindMeasureCursor(entry);
	}

	public resolveReferenceTimeForMeasure(
		measureMap: Array<{ measure: number; start: number }>,
		clickedMeasure: number,
	): number {
		return resolveReferenceTimeForMeasure(measureMap, clickedMeasure);
	}

	public applyReferenceTimeline(syncReferenceTimeEnabled: boolean): void {
		if (
			this.syncReferenceTimeEnabled === syncReferenceTimeEnabled &&
			this.entries.every(
				(entry) => entry.syncReferenceTimeEnabled === syncReferenceTimeEnabled,
			)
		) {
			return;
		}

		this.syncReferenceTimeEnabled = syncReferenceTimeEnabled;
		this.entries.forEach((entry) => {
			entry.syncReferenceTimeEnabled = syncReferenceTimeEnabled;
			entry.measureMap = syncReferenceTimeEnabled
				? entry.measureMaps.sync
				: entry.measureMaps.base;
			entry.projectedTempoSegments = syncReferenceTimeEnabled
				? entry.projectedTempoSegmentsByAxis.sync
				: entry.projectedTempoSegmentsByAxis.base;
			entry.syncEnabled = Boolean(
				entry.osmd &&
					entry.measureMap &&
					entry.measureMap.length > 0 &&
					entry.measureNumbering.printed.length > 0 &&
					entry.measureCursor,
			);
			entry.targetMeasure = null;
		});
	}

	public resolveReferenceBpm(
		referenceTime: number,
		syncReferenceTimeEnabled = this.syncReferenceTimeEnabled,
	): number | null {
		const sanitizedReferenceTime = clampNonNegative(referenceTime);

		for (let index = 0; index < this.entries.length; index += 1) {
			const entry = this.entries[index];
			const resolved = resolveEntryReferenceBpm(
				entry,
				sanitizedReferenceTime,
				syncReferenceTimeEnabled,
			);
			if (resolved !== null) {
				return resolved;
			}
		}

		return null;
	}

	public async loadTempoMap(entry: SheetMusicEntryModel): Promise<void> {
		if (!entry.osmd) {
			entry.fallbackTempoBpm = null;
			entry.projectedTempoSegmentsByAxis = {
				base: null,
				sync: null,
			};
			entry.projectedTempoSegments = null;
			return;
		}

		try {
			const { fallbackTempoBpm, projectedSegmentsByAxis } =
				await loadProjectedTempoMaps(entry.source, entry.measureMaps);
			if (this.destroyed) {
				return;
			}

			entry.fallbackTempoBpm = fallbackTempoBpm;
			entry.projectedTempoSegmentsByAxis = projectedSegmentsByAxis;
			entry.projectedTempoSegments = entry.syncReferenceTimeEnabled
				? projectedSegmentsByAxis.sync
				: projectedSegmentsByAxis.base;
		} catch (error) {
			entry.fallbackTempoBpm = null;
			entry.projectedTempoSegmentsByAxis = {
				base: null,
				sync: null,
			};
			entry.projectedTempoSegments = null;
			console.warn(
				"[trackswitch] Failed to load score tempo map:",
				entry.source,
				error,
			);
		}
	}
}

function resolveEntryReferenceBpm(
	entry: SheetMusicEntryModel,
	referenceTime: number,
	syncReferenceTimeEnabled: boolean,
): number | null {
	const projectedSegments = syncReferenceTimeEnabled
		? entry.projectedTempoSegmentsByAxis.sync || []
		: entry.projectedTempoSegmentsByAxis.base || [];
	if (projectedSegments.length > 0) {
		let resolvedBpm = projectedSegments[0].bpm;
		for (let index = 0; index < projectedSegments.length; index += 1) {
			const segment = projectedSegments[index];
			if (segment.referenceStartTime > referenceTime) {
				break;
			}

			resolvedBpm = segment.bpm;
		}

		return Number.isFinite(resolvedBpm) && resolvedBpm > 0 ? resolvedBpm : null;
	}

	if (
		Number.isFinite(entry.fallbackTempoBpm) &&
		(entry.fallbackTempoBpm as number) > 0
	) {
		return entry.fallbackTempoBpm;
	}

	return null;
}
