import type { TrackRuntime } from "../domain/types";
import { clamp } from "../shared/math";
import type { WarpingMatrixDataPoint, WarpingMatrixRenderContext } from "../ui/view-renderer";
import { timelineId } from "../timeline/timeline";
import { buildResolvedAlignment } from "./alignment-context";

export function isAlignmentMode(ctx: any): boolean {
	return !!ctx.alignment;
}

export function hasSyncedVariant(ctx: any, runtime: any): boolean {
	void ctx;
	return !!runtime.syncedSource && !!runtime.syncedSource.buffer;
}

export function isTrackSyncLocked(ctx: any, trackIndex: any): boolean {
	return ctx.globalSyncEnabled && ctx.syncLockedTrackIndexes.has(trackIndex);
}

export function setEffectiveSoloMode(ctx: any, singleSoloMode: boolean): void {
	ctx.effectiveSingleSoloMode = singleSoloMode;

	if (!singleSoloMode || ctx.runtimes.length === 0) {
		return;
	}

	const previousSoloIndex = ctx.getActiveSoloTrackIndex();
	const targetSoloIndex = previousSoloIndex >= 0 ? previousSoloIndex : 0;

	ctx.runtimes.forEach((runtime: TrackRuntime, index: number) => {
		runtime.state.solo = index === targetSoloIndex;
	});
}

export function toggleGlobalSync(ctx: any): void {
	if (!ctx.isAlignmentMode() || !ctx.isGlobalSyncAvailable()) {
		return;
	}

	ctx.applyGlobalSyncState(!ctx.globalSyncEnabled);
}

/**
 * Selecting the synchronized source only changes which timeline a track's audio clock
 * belongs to (its clock already runs at reference speed) — there is no separate
 * reference axis to remap, so loop points and position are untouched.
 */
export function applyGlobalSyncState(ctx: any, syncOn: boolean): void {
	if (!ctx.isAlignmentMode()) {
		return;
	}

	if (syncOn && !ctx.isGlobalSyncAvailable()) {
		return;
	}

	if (syncOn) {
		ctx.preSyncSoloTrackIndex = ctx.getActiveSoloTrackIndex();
		ctx.globalSyncEnabled = true;
		ctx.syncLockedTrackIndexes.clear();
		ctx.setEffectiveSoloMode(false);

		ctx.runtimes.forEach((runtime: TrackRuntime, index: number) => {
			if (ctx.hasSyncedVariant(runtime)) {
				ctx.setRuntimeActiveVariant(runtime, "synced");
				runtime.state.solo = true;
				return;
			}

			ctx.setRuntimeActiveVariant(runtime, "base");
			runtime.state.solo = false;
			ctx.syncLockedTrackIndexes.add(index);
		});
	} else {
		ctx.globalSyncEnabled = false;
		ctx.syncLockedTrackIndexes.clear();

		ctx.runtimes.forEach((runtime: TrackRuntime) => {
			ctx.setRuntimeActiveVariant(runtime, "base");
			runtime.state.solo = false;
		});

		ctx.setEffectiveSoloMode(true);

		const fallbackIndex = ctx.runtimes.length > 0 ? 0 : -1;
		const restoreIndex =
			ctx.preSyncSoloTrackIndex !== null &&
			ctx.preSyncSoloTrackIndex >= 0 &&
			ctx.preSyncSoloTrackIndex < ctx.runtimes.length
				? ctx.preSyncSoloTrackIndex
				: fallbackIndex;

		if (restoreIndex >= 0) {
			ctx.runtimes.forEach((runtime: TrackRuntime, index: number) => {
				runtime.state.solo = index === restoreIndex;
			});
		}

		ctx.preSyncSoloTrackIndex = null;
	}

	ctx.applyTrackProperties();

	if (ctx.state.playing) {
		ctx.stopAudio();
		ctx.startAudio(ctx.state.position);
	}

	ctx.updateMainControls();
}

export function setRuntimeActiveVariant(ctx: any, runtime: any, variant: any): boolean {
	void ctx;
	const source = variant === "synced" ? runtime.syncedSource : runtime.baseSource;
	if (!source?.buffer) {
		return false;
	}

	runtime.activeVariant = variant;
	runtime.buffer = source.buffer;
	runtime.timing = source.timing;
	runtime.sourceIndex = source.sourceIndex;
	runtime.waveformSummary = source.waveformSummary;
	return true;
}

export function shouldBypassAlignmentMapping(ctx: any, trackIndex: any): boolean {
	const runtime = ctx.runtimes[trackIndex];
	return !!runtime && runtime.activeVariant === "synced" && !!runtime.syncedSource;
}

export async function initializeAlignmentMode(ctx: any): Promise<string | null> {
	if (!ctx.alignmentConfig) {
		return "Sync mode requires init.alignment configuration.";
	}

	try {
		ctx.alignment = await buildResolvedAlignment(ctx.alignmentConfig);
	} catch (error) {
		return error instanceof Error ? error.message : "Failed to build alignment mappings.";
	}

	ctx.globalSyncEnabled = false;
	ctx.syncLockedTrackIndexes.clear();
	ctx.preSyncSoloTrackIndex = null;
	ctx.setEffectiveSoloMode(true);
	ctx.longestDuration = ctx.alignment.referenceExtent.end;

	const activeTrackIndex = ctx.getActiveSoloTrackIndex();
	if (activeTrackIndex >= 0) {
		const mappedTrackTime = ctx.referenceToTrackTime(activeTrackIndex, ctx.state.position);
		const mappedReferenceTime = ctx.trackToReferenceTime(activeTrackIndex, mappedTrackTime);
		ctx.dispatch({
			type: "set-position",
			position: clamp(mappedReferenceTime, 0, ctx.longestDuration),
		});
	}

	return null;
}

export function getTrackAlignmentPoints(
	ctx: any,
	trackIndex: number,
): Array<{ referenceTime: number; trackTime: number }> {
	if (!ctx.alignment) {
		return [];
	}

	const runtime = ctx.runtimes[trackIndex];
	if (!runtime) {
		return [];
	}

	const trackTimeline = timelineId(runtime.definition.id);
	const reference = ctx.alignment.referenceTimeline;
	const points: Array<{ referenceTime: number; trackTime: number }> = [];

	for (const marker of ctx.alignment.markerSet.markers) {
		const referenceValue = marker.placements.get(reference);
		const trackValue = marker.placements.get(trackTimeline);
		if (referenceValue !== undefined && trackValue !== undefined) {
			points.push({ referenceTime: referenceValue, trackTime: trackValue });
		}
	}

	return points;
}

export function getWarpingMatrixContext(ctx: any): WarpingMatrixRenderContext | undefined {
	const view = ctx.warpingMatrixView;
	if (!ctx.isAlignmentMode() || !view || !ctx.alignment) {
		return undefined;
	}

	const xIndex = ctx.runtimes.findIndex(
		(runtime: TrackRuntime) => runtime.definition.id === view.x,
	);
	const yIndex = ctx.runtimes.findIndex(
		(runtime: TrackRuntime) => runtime.definition.id === view.y,
	);
	if (xIndex < 0 || yIndex < 0) {
		return undefined;
	}

	const xTimeline = timelineId(view.x);
	const yTimeline = timelineId(view.y);

	const points: WarpingMatrixDataPoint[] = [];
	for (const marker of ctx.alignment.markerSet.markers) {
		const x = marker.placements.get(xTimeline);
		const y = marker.placements.get(yTimeline);
		if (x !== undefined && y !== undefined) {
			points.push({ referenceTime: x, trackTime: y });
		}
	}
	points.sort(
		(a: WarpingMatrixDataPoint, b: WarpingMatrixDataPoint) =>
			a.referenceTime - b.referenceTime,
	);

	const runtimeDuration = (ctx.constructor as any).getRuntimeDuration;
	const xDuration = Number(runtimeDuration(ctx.runtimes[xIndex])) || 0;
	const yDuration = Number(runtimeDuration(ctx.runtimes[yIndex])) || 0;
	const referenceDuration = Math.max(
		xDuration,
		...points.map((point) => point.referenceTime),
		0,
	);
	const trackDuration = Math.max(yDuration, ...points.map((point) => point.trackTime), 0);

	const currentReferenceTime = clamp(
		ctx.alignment.projection.canProject(ctx.alignment.referenceTimeline, xTimeline)
			? ctx.alignment.projection.project(
					ctx.state.position,
					ctx.alignment.referenceTimeline,
					xTimeline,
				)
			: ctx.state.position,
		0,
		referenceDuration,
	);

	const currentScoreBpm = ctx.sheetMusicEngine.resolveReferenceBpm(
		ctx.state.position,
		false,
	);

	return {
		enabled: true,
		syncEnabled: ctx.globalSyncEnabled,
		referenceDuration: referenceDuration,
		currentReferenceTime: currentReferenceTime,
		currentScoreBpm: currentScoreBpm,
		columnOrder: [view.y],
		trackSeries: [
			{ trackIndex: yIndex, columnKey: view.y, points, trackDuration },
		],
	};
}

export function getAudibleTrackIndexesForWarpingMatrix(ctx: any): number[] {
	const selected = ctx.runtimes
		.map((runtime: TrackRuntime, index: number) => (runtime.state.solo ? index : -1))
		.filter((index: number) => index >= 0);

	if (selected.length > 0) {
		return selected;
	}

	return ctx.runtimes.map((_runtime: TrackRuntime, index: number) => index);
}

export function getActiveSoloTrackIndex(ctx: any): number {
	for (let index = 0; index < ctx.runtimes.length; index += 1) {
		if (ctx.runtimes[index].state.solo) {
			return index;
		}
	}

	if (ctx.effectiveSingleSoloMode && ctx.runtimes.length > 0) {
		return 0;
	}

	return -1;
}

export function isSyncReferenceAxisActive(ctx: any): boolean {
	void ctx;
	return false;
}

export function isGlobalSyncAvailable(ctx: any): boolean {
	if (!ctx.isAlignmentMode()) {
		return false;
	}

	return ctx.runtimes.some((runtime: TrackRuntime) => ctx.hasSyncedVariant(runtime));
}

export function getAlignmentPlaybackTrackIndex(ctx: any): number {
	const activeSoloTrackIndex = ctx.getActiveSoloTrackIndex();
	if (activeSoloTrackIndex >= 0) {
		return activeSoloTrackIndex;
	}

	if (!ctx.globalSyncEnabled) {
		return -1;
	}

	for (let index = 0; index < ctx.runtimes.length; index += 1) {
		const runtime = ctx.runtimes[index];
		if (!runtime || ctx.syncLockedTrackIndexes.has(index)) {
			continue;
		}

		if (runtime.activeVariant === "synced" && runtime.buffer) {
			return index;
		}
	}

	return -1;
}

export function currentPlaybackReferencePosition(ctx: any): number {
	const rawPlaybackPosition = ctx.audioEngine.currentTime - ctx.state.startTime;
	if (!ctx.isAlignmentMode() || ctx.alignmentPlaybackTrackIndex === null) {
		return rawPlaybackPosition;
	}

	return ctx.trackToReferenceTime(ctx.alignmentPlaybackTrackIndex, rawPlaybackPosition);
}

export function referenceToTrackTime(
	ctx: any,
	trackIndex: number,
	referenceTime: number,
): number {
	if (!ctx.alignment) {
		return referenceTime;
	}
	if (ctx.shouldBypassAlignmentMapping(trackIndex)) {
		return referenceTime;
	}

	const runtime = ctx.runtimes[trackIndex];
	if (!runtime) {
		return referenceTime;
	}

	const trackTimeline = timelineId(runtime.definition.id);
	if (!ctx.alignment.projection.canProject(ctx.alignment.referenceTimeline, trackTimeline)) {
		return referenceTime;
	}

	return ctx.alignment.projection.project(
		referenceTime,
		ctx.alignment.referenceTimeline,
		trackTimeline,
	);
}

export function trackToReferenceTime(ctx: any, trackIndex: number, trackTime: number): number {
	if (!ctx.alignment) {
		return trackTime;
	}
	if (ctx.shouldBypassAlignmentMapping(trackIndex)) {
		return trackTime;
	}

	const runtime = ctx.runtimes[trackIndex];
	if (!runtime) {
		return trackTime;
	}

	const trackTimeline = timelineId(runtime.definition.id);
	if (!ctx.alignment.projection.canProject(trackTimeline, ctx.alignment.referenceTimeline)) {
		return trackTime;
	}

	return ctx.alignment.projection.project(
		trackTime,
		trackTimeline,
		ctx.alignment.referenceTimeline,
	);
}

export function handleAlignmentTrackSwitch(ctx: any, nextActiveTrackIndex: number): void {
	if (!ctx.alignment || nextActiveTrackIndex < 0) {
		return;
	}

	const referenceAtSwitch = ctx.state.playing
		? ctx.currentPlaybackReferencePosition()
		: ctx.state.position;
	const mappedTrackTime = ctx.referenceToTrackTime(nextActiveTrackIndex, referenceAtSwitch);
	const mappedReferenceTime = clamp(
		ctx.trackToReferenceTime(nextActiveTrackIndex, mappedTrackTime),
		0,
		ctx.longestDuration,
	);

	if (ctx.state.playing) {
		ctx.stopAudio();
		ctx.dispatch({ type: "set-position", position: mappedReferenceTime });
		ctx.startAudio(mappedReferenceTime);
	} else {
		ctx.dispatch({ type: "set-position", position: mappedReferenceTime });
	}

	ctx.updateMainControls();
}
