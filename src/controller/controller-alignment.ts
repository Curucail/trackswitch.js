import {
    AlignmentOutOfRangeMode,
    LoopMarker,
    PlayerState,
    TrackAlignmentConfig,
    TrackSourceVariant,
    TrackRuntime,
    TrackSwitchConfig,
    TrackSwitchController,
    TrackSwitchEventHandler,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchFeatures,
    TrackSwitchSnapshot,
    TrackSwitchUiState,
} from '../domain/types';
import { normalizeFeatures } from '../domain/options';
import { createInitialPlayerState, playerStateReducer, PlayerAction } from '../domain/state';
import { createTrackRuntime } from '../domain/runtime';
import { AudioEngine } from '../engine/audio-engine';
import { SheetMusicEngine } from '../engine/sheet-music-engine';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import { ViewRenderer, WarpingMatrixRenderContext, WaveformTimelineContext } from '../ui/view-renderer';
import { InputBinder, InputController } from '../input/input-binder';
import { eventTargetAsElement } from '../shared/dom';
import { clamp } from '../shared/math';
import { derivePresetNames, parseStrictNonNegativeInt } from '../shared/preset';
import { ControllerPointerEvent, getSeekMetrics, isPrimaryInput } from '../shared/seek';
import {
    buildColumnTimeMapping,
    loadNumericCsv,
    mapTime,
    resolveAlignmentOutOfRangeMode,
    TimeMappingSeries,
} from '../shared/alignment';
import {
    allocateInstanceId,
    isKeyboardControllerActive,
    pauseOtherControllers,
    registerController,
    setActiveKeyboardController,
    unregisterController,
} from './controller-registry';

function closestInRoot(root: HTMLElement, target: EventTarget | null | undefined, selector: string): HTMLElement | null {
    const element = eventTargetAsElement(target ?? null);
    if (!element) {
        return null;
    }

    const matched = element.closest(selector);
    if (!matched || !root.contains(matched)) {
        return null;
    }

    return matched as HTMLElement;
}

interface TrackAlignmentConverter {
    referenceToTrack: TimeMappingSeries;
    trackToReference: TimeMappingSeries;
}

interface AlignmentContext {
    referenceDuration: number;
    outOfRange: AlignmentOutOfRangeMode;
    converters: Map<number, TrackAlignmentConverter>;
    columnByTrack: Map<number, string>;
    uniqueColumnOrder: string[];
}

interface SeekTimelineContext {
    duration: number;
    toReferenceTime(timelineTime: number): number;
    fromReferenceTime(referenceTime: number): number;
}

interface PinchZoomState {
    seekWrap: HTMLElement;
    initialDistance: number;
    initialZoom: number;
}

interface PendingWaveformTouchSeek {
    seekWrap: HTMLElement;
    startPageX: number;
    startPageY: number;
}


export function isAlignmentMode(ctx: any): any {
    return (function(this: any) {
        return this.features.mode === 'alignment';
    }).call(ctx);
}

export function hasSyncedVariant(ctx: any, runtime: any): any {
    return (function(this: any, runtime: any) {
        return !!runtime.syncedSource && !!runtime.syncedSource.buffer;
    }).call(ctx, runtime);
}

export function isTrackSyncLocked(ctx: any, trackIndex: any): any {
    return (function(this: any, trackIndex: any) {
        return this.globalSyncEnabled && this.syncLockedTrackIndexes.has(trackIndex);
    }).call(ctx, trackIndex);
}

export function setEffectiveSoloMode(ctx: any, singleSoloMode: any): any {
    return (function(this: any, singleSoloMode: any) {
        this.effectiveSingleSoloMode = singleSoloMode;

        if (!singleSoloMode || this.runtimes.length === 0) {
            return;
        }

        const previousSoloIndex = this.getActiveSoloTrackIndex();
        const targetSoloIndex = previousSoloIndex >= 0 ? previousSoloIndex : 0;

        this.runtimes.forEach(function(runtime: TrackRuntime, index: number) {
            runtime.state.solo = index === targetSoloIndex;
        });
    }).call(ctx, singleSoloMode);
}

export function toggleGlobalSync(ctx: any): any {
    return (function(this: any) {
        if (!this.isAlignmentMode()) {
            return;
        }

        const hasAnySyncedTrack = this.runtimes.some((runtime: TrackRuntime) => this.hasSyncedVariant(runtime));
        if (!hasAnySyncedTrack) {
            return;
        }

        this.applyGlobalSyncState(!this.globalSyncEnabled);
    }).call(ctx);
}

export function applyGlobalSyncState(ctx: any, syncOn: any): any {
    return (function(this: any, syncOn: any) {
        if (!this.isAlignmentMode()) {
            return;
        }

        const restartPosition = this.state.playing
            ? clamp(this.currentPlaybackReferencePosition(), 0, this.longestDuration)
            : clamp(this.state.position, 0, this.longestDuration);

        if (syncOn) {
            this.preSyncSoloTrackIndex = this.getActiveSoloTrackIndex();
            this.globalSyncEnabled = true;
            this.syncLockedTrackIndexes.clear();
            this.setEffectiveSoloMode(false);

            this.runtimes.forEach((runtime: TrackRuntime, index: number) => {
                if (this.hasSyncedVariant(runtime)) {
                    this.setRuntimeActiveVariant(runtime, 'synced');
                    runtime.state.solo = true;
                    return;
                }

                this.setRuntimeActiveVariant(runtime, 'base');
                runtime.state.solo = false;
                this.syncLockedTrackIndexes.add(index);
            });
        } else {
            this.globalSyncEnabled = false;
            this.syncLockedTrackIndexes.clear();

            this.runtimes.forEach((runtime: TrackRuntime) => {
                this.setRuntimeActiveVariant(runtime, 'base');
                runtime.state.solo = false;
            });

            this.setEffectiveSoloMode(true);

            const fallbackIndex = this.runtimes.length > 0 ? 0 : -1;
            const restoreIndex = this.preSyncSoloTrackIndex !== null
                && this.preSyncSoloTrackIndex >= 0
                && this.preSyncSoloTrackIndex < this.runtimes.length
                ? this.preSyncSoloTrackIndex
                : fallbackIndex;

            if (restoreIndex >= 0) {
                this.runtimes.forEach(function(runtime: TrackRuntime, index: number) {
                    runtime.state.solo = index === restoreIndex;
                });
            }

            this.preSyncSoloTrackIndex = null;
        }

        this.applyTrackProperties();
        this.dispatch({ type: 'set-position', position: restartPosition });

        if (this.state.playing) {
            this.stopAudio();
            this.startAudio(restartPosition);
        }

        this.updateMainControls();
    }).call(ctx, syncOn);
}

export function setRuntimeActiveVariant(ctx: any, runtime: any, variant: any): any {
    return (function(this: any, runtime: any, variant: any) {
        const source = variant === 'synced' ? runtime.syncedSource : runtime.baseSource;
        if (!source || !source.buffer) {
            return false;
        }

        runtime.activeVariant = variant;
        runtime.buffer = source.buffer;
        runtime.timing = source.timing;
        runtime.sourceIndex = source.sourceIndex;
        runtime.waveformCache.clear();
        return true;
    }).call(ctx, runtime, variant);
}

export function shouldBypassAlignmentMapping(ctx: any, trackIndex: any): any {
    return (function(this: any, trackIndex: any) {
        const runtime = this.runtimes[trackIndex];
        return !!runtime && runtime.activeVariant === 'synced' && !!runtime.syncedSource;
    }).call(ctx, trackIndex);
}

export function initializeAlignmentMode(ctx: any): any {
    return (async function(this: any) {
        const alignmentContextResult = await this.buildAlignmentContext();
        if (typeof alignmentContextResult === 'string') {
            return alignmentContextResult;
        }

        this.globalSyncEnabled = false;
        this.syncLockedTrackIndexes.clear();
        this.preSyncSoloTrackIndex = null;
        this.setEffectiveSoloMode(true);

        this.alignmentContext = alignmentContextResult;
        this.longestDuration = this.alignmentContext.referenceDuration;

        const activeTrackIndex = this.getActiveSoloTrackIndex();
        if (activeTrackIndex >= 0) {
            const mappedTrackTime = this.referenceToTrackTime(activeTrackIndex, this.state.position);
            const mappedReferenceTime = this.trackToReferenceTime(activeTrackIndex, mappedTrackTime);
            this.dispatch({
                type: 'set-position',
                position: clamp(mappedReferenceTime, 0, this.longestDuration),
            });
        }

        return null;
    }).call(ctx);
}

export function buildAlignmentContext(ctx: any): any {
    return (async function(this: any) {
        if (!this.alignmentConfig) {
            return 'Alignment mode requires init.alignment configuration.';
        }

        if (!this.alignmentConfig.csv || typeof this.alignmentConfig.csv !== 'string') {
            return 'Alignment configuration requires a non-empty alignment.csv URL.';
        }

        const mappingByTrack = this.resolveAlignmentMappingsByTrack(this.alignmentConfig);
        if (typeof mappingByTrack === 'string') {
            return mappingByTrack;
        }

        const referenceColumn = this.resolveReferenceColumn(this.alignmentConfig);
        if (!referenceColumn) {
            return 'Alignment configuration requires alignment.referenceTimeColumn (or legacy alignment.referenceColumn).';
        }

        let parsedCsv;
        try {
            parsedCsv = await loadNumericCsv(this.alignmentConfig.csv);
        } catch (error) {
            return error instanceof Error
                ? error.message
                : 'Failed to load alignment CSV.';
        }

        const availableColumns = new Set(parsedCsv.headers);
        if (!availableColumns.has(referenceColumn)) {
            return 'Alignment CSV is missing configured referenceTimeColumn: ' + referenceColumn;
        }

        for (const [, column] of mappingByTrack) {
            if (!availableColumns.has(column)) {
                return 'Alignment CSV is missing configured column: ' + column;
            }
        }

        const referenceDuration = this.resolveReferenceDuration(parsedCsv.rows, referenceColumn);
        if (typeof referenceDuration === 'string') {
            return referenceDuration;
        }

        const converters = new Map<number, TrackAlignmentConverter>();
        for (const [trackIndex, column] of mappingByTrack) {
            try {
                const referenceToTrack = buildColumnTimeMapping(parsedCsv.rows, referenceColumn, column);
                const trackToReference = buildColumnTimeMapping(parsedCsv.rows, column, referenceColumn);

                converters.set(trackIndex, {
                    referenceToTrack: referenceToTrack,
                    trackToReference: trackToReference,
                });
            } catch (error) {
                return error instanceof Error
                    ? error.message
                    : 'Failed to build alignment mappings.';
            }
        }

        return {
            referenceDuration: referenceDuration,
            outOfRange: resolveAlignmentOutOfRangeMode(this.alignmentConfig.outOfRange),
            converters: converters,
            columnByTrack: new Map<number, string>(mappingByTrack),
            uniqueColumnOrder: this.collectUniqueAlignmentColumns(mappingByTrack),
        };
    }).call(ctx);
}

export function collectUniqueAlignmentColumns(ctx: any, mappingByTrack: any): any {
    return (function(this: any, mappingByTrack: any) {
        const seenColumns = new Set<string>();
        const uniqueColumns: string[] = [];

        for (const [, rawColumn] of mappingByTrack) {
            const column = String(rawColumn || '').trim();
            if (!column || seenColumns.has(column)) {
                continue;
            }

            seenColumns.add(column);
            uniqueColumns.push(column);
        }

        return uniqueColumns;
    }).call(ctx, mappingByTrack);
}

export function getWarpingMatrixContext(ctx: any): any {
    return (function(this: any) {
        if (!this.isAlignmentMode()) {
            return undefined;
        }

        if (!this.alignmentContext) {
            return {
                enabled: true,
                syncEnabled: this.globalSyncEnabled,
                referenceDuration: this.longestDuration,
                currentReferenceTime: this.state.position,
                columnOrder: [],
                trackSeries: [],
            };
        }

        const activeTrackIndex = this.getActiveSoloTrackIndex();
        if (activeTrackIndex < 0) {
            return {
                enabled: true,
                syncEnabled: this.globalSyncEnabled,
                referenceDuration: this.longestDuration,
                currentReferenceTime: this.state.position,
                columnOrder: this.alignmentContext.uniqueColumnOrder,
                trackSeries: [],
            };
        }

        const trackIndexes = [activeTrackIndex];
        const seenColumns = new Set<string>();
        const referenceDuration = this.longestDuration;
        const trackSeries = trackIndexes.map((trackIndex) => {
            const column = this.alignmentContext?.columnByTrack.get(trackIndex);
            const normalizedColumn = typeof column === 'string' ? column.trim() : '';
            if (!normalizedColumn || seenColumns.has(normalizedColumn)) {
                return null;
            }

            const converter = this.alignmentContext?.converters.get(trackIndex);
            if (!converter) {
                return null;
            }

            seenColumns.add(normalizedColumn);
            const points = converter.referenceToTrack.points.map((point: { x: number; y: number }) => {
                return {
                    referenceTime: point.x,
                    trackTime: point.y,
                };
            });
            const runtime = this.runtimes[trackIndex];
            let trackDuration = runtime.baseSource.timing
                ? runtime.baseSource.timing.effectiveDuration
                : (runtime.baseSource.buffer ? runtime.baseSource.buffer.duration : 0);
            let maxMappedTrackTime = Number.NEGATIVE_INFINITY;
            points.forEach((point: { trackTime: number }) => {
                if (Number.isFinite(point.trackTime) && point.trackTime > maxMappedTrackTime) {
                    maxMappedTrackTime = point.trackTime;
                }
            });
            const resolvedMappedDuration = Number.isFinite(maxMappedTrackTime) && maxMappedTrackTime > 0
                ? maxMappedTrackTime
                : referenceDuration;
            if (!Number.isFinite(trackDuration) || trackDuration <= 0) {
                trackDuration = resolvedMappedDuration;
            } else {
                trackDuration = Math.max(trackDuration, resolvedMappedDuration);
            }

            return {
                trackIndex: trackIndex,
                columnKey: normalizedColumn,
                points: points,
                trackDuration: trackDuration,
            };
        }).filter((entry): entry is NonNullable<typeof entry> => {
            return !!entry && entry.points.length > 0;
        });

        return {
            enabled: true,
            syncEnabled: this.globalSyncEnabled,
            referenceDuration: this.longestDuration,
            currentReferenceTime: this.state.position,
            columnOrder: this.alignmentContext.uniqueColumnOrder,
            trackSeries: trackSeries,
        };
    }).call(ctx);
}

export function getAudibleTrackIndexesForWarpingMatrix(ctx: any): any {
    return (function(this: any) {
        const selected = this.runtimes.map((runtime: TrackRuntime, index: number) => {
            return runtime.state.solo ? index : -1;
        }).filter((index: number) => {
            return index >= 0;
        });

        if (selected.length > 0) {
            return selected;
        }

        return this.runtimes.map(function(_: TrackRuntime, index: number) {
            return index;
        });
    }).call(ctx);
}

export function resolveReferenceColumn(ctx: any, config: any): any {
    return (function(this: any, config: any) {
        const configuredReferenceColumn = typeof config.referenceTimeColumn === 'string'
            ? config.referenceTimeColumn.trim()
            : (typeof config.referenceColumn === 'string' ? config.referenceColumn.trim() : '');

        if (!configuredReferenceColumn) {
            return null;
        }

        return configuredReferenceColumn;
    }).call(ctx, config);
}

export function resolveReferenceDuration(ctx: any, rows: any, referenceColumn: any): any {
    return (function(this: any, rows: any, referenceColumn: any) {
        let maxReference = Number.NEGATIVE_INFINITY;

        rows.forEach(function(row: Record<string, unknown>) {
            const value = Number(row[referenceColumn]);
            if (Number.isFinite(value) && value > maxReference) {
                maxReference = value;
            }
        });

        if (!Number.isFinite(maxReference)) {
            return 'Alignment CSV does not contain valid numeric values for referenceTimeColumn: ' + referenceColumn;
        }

        return Math.max(0, maxReference);
    }).call(ctx, rows, referenceColumn);
}

export function resolveAlignmentMappingsByTrack(ctx: any, config: any): any {
    return (function(this: any, config: any) {
        const hasAnyTrackColumn = this.runtimes.some(function(runtime: TrackRuntime) {
            return runtime.definition.alignment
                && Object.prototype.hasOwnProperty.call(runtime.definition.alignment, 'column');
        });

        if (!hasAnyTrackColumn) {
            return this.validateAndBuildLegacyAlignmentMappings(config);
        }

        const mappingByTrack = new Map<number, string>();

        for (let index = 0; index < this.runtimes.length; index += 1) {
            const rawColumn = this.runtimes[index].definition.alignment?.column;
            const column = typeof rawColumn === 'string' ? rawColumn.trim() : '';
            if (!column) {
                return 'Per-track alignment columns are enabled, so every track requires alignment.column. Missing trackIndex '
                    + index + '.';
            }

            mappingByTrack.set(index, column);
        }

        return mappingByTrack;
    }).call(ctx, config);
}

export function validateAndBuildLegacyAlignmentMappings(ctx: any, config: any): any {
    return (function(this: any, config: any) {
        if (!Array.isArray(config.mappings) || config.mappings.length === 0) {
            return 'Alignment configuration requires alignment.mappings with one entry per track.';
        }

        if (config.mappings.length !== this.runtimes.length) {
            return 'Alignment mappings must include exactly one mapping per track.';
        }

        const mappingByTrack = new Map<number, string>();

        for (const entry of config.mappings) {
            if (!entry || !Number.isInteger(entry.trackIndex)) {
                return 'Alignment mapping entries require an integer trackIndex.';
            }

            if (entry.trackIndex < 0 || entry.trackIndex >= this.runtimes.length) {
                return 'Alignment mapping trackIndex is out of range: ' + entry.trackIndex;
            }

            const column = typeof entry.column === 'string' ? entry.column.trim() : '';
            if (!column) {
                return 'Alignment mapping entries require a non-empty column name.';
            }

            if (mappingByTrack.has(entry.trackIndex)) {
                return 'Alignment mappings contain duplicate trackIndex: ' + entry.trackIndex;
            }

            mappingByTrack.set(entry.trackIndex, column);
        }

        for (let index = 0; index < this.runtimes.length; index += 1) {
            if (!mappingByTrack.has(index)) {
                return 'Alignment mappings must cover all tracks. Missing trackIndex ' + index + '.';
            }
        }

        return mappingByTrack;
    }).call(ctx, config);
}

export function getActiveSoloTrackIndex(ctx: any): any {
    return (function(this: any) {
        for (let index = 0; index < this.runtimes.length; index += 1) {
            if (this.runtimes[index].state.solo) {
                return index;
            }
        }

        return this.runtimes.length > 0 ? 0 : -1;
    }).call(ctx);
}

export function currentPlaybackReferencePosition(ctx: any): any {
    return (function(this: any) {
        const rawPlaybackPosition = this.audioEngine.currentTime - this.state.startTime;
        if (
            this.features.mode !== 'alignment'
            || !this.alignmentContext
            || this.alignmentPlaybackTrackIndex === null
        ) {
            return rawPlaybackPosition;
        }

        return this.trackToReferenceTime(this.alignmentPlaybackTrackIndex, rawPlaybackPosition);
    }).call(ctx);
}

export function referenceToTrackTime(ctx: any, trackIndex: any, referenceTime: any): any {
    return (function(this: any, trackIndex: any, referenceTime: any) {
        if (!this.alignmentContext) {
            return referenceTime;
        }

        if (this.shouldBypassAlignmentMapping(trackIndex)) {
            return referenceTime;
        }

        const converter = this.alignmentContext.converters.get(trackIndex);
        if (!converter) {
            return referenceTime;
        }

        return mapTime(converter.referenceToTrack, referenceTime, this.alignmentContext.outOfRange);
    }).call(ctx, trackIndex, referenceTime);
}

export function trackToReferenceTime(ctx: any, trackIndex: any, trackTime: any): any {
    return (function(this: any, trackIndex: any, trackTime: any) {
        if (!this.alignmentContext) {
            return trackTime;
        }

        if (this.shouldBypassAlignmentMapping(trackIndex)) {
            return trackTime;
        }

        const converter = this.alignmentContext.converters.get(trackIndex);
        if (!converter) {
            return trackTime;
        }

        return mapTime(converter.trackToReference, trackTime, 'linear');
    }).call(ctx, trackIndex, trackTime);
}

export function handleAlignmentTrackSwitch(ctx: any, nextActiveTrackIndex: any): any {
    return (function(this: any, nextActiveTrackIndex: any) {
        if (!this.alignmentContext || nextActiveTrackIndex < 0) {
            return;
        }

        const referenceAtSwitch = this.state.playing
            ? this.currentPlaybackReferencePosition()
            : this.state.position;
        const mappedTrackTime = this.referenceToTrackTime(nextActiveTrackIndex, referenceAtSwitch);
        const mappedReferenceTime = clamp(
            this.trackToReferenceTime(nextActiveTrackIndex, mappedTrackTime),
            0,
            this.longestDuration
        );

        if (this.state.playing) {
            this.stopAudio();
            this.dispatch({ type: 'set-position', position: mappedReferenceTime });
            this.startAudio(mappedReferenceTime);
        } else {
            this.dispatch({ type: 'set-position', position: mappedReferenceTime });
        }

        this.updateMainControls();
    }).call(ctx, nextActiveTrackIndex);
}
