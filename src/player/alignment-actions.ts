import { TrackRuntime } from '../domain/types';
import { clamp } from '../shared/math';
import { WarpingMatrixTrackSeries } from '../ui/view-renderer';
import {
    buildColumnTimeMapping,
    loadNumericCsv,
    mapTime,
    resolveAlignmentOutOfRangeMode,
    TimeMappingSeries,
} from '../shared/alignment';

interface TrackAlignmentConverter {
    referenceToTrack: TimeMappingSeries;
    trackToReference: TimeMappingSeries;
}

function buildWarpingSeries(
    runtime: TrackRuntime,
    trackIndex: number,
    columnKey: string,
    converter: TrackAlignmentConverter,
    referenceDuration: number
): WarpingMatrixTrackSeries {
    const points = converter.referenceToTrack.points.map((point: { x: number; y: number }) => {
        return {
            referenceTime: point.x,
            trackTime: point.y,
        };
    });

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
        columnKey: columnKey,
        points: points,
        trackDuration: trackDuration,
    };
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

        const referenceTimeColumn = this.resolveReferenceTimeColumn(this.alignmentConfig);
        if (!referenceTimeColumn) {
            return 'Alignment configuration requires alignment.referenceTimeColumn.';
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
        if (!availableColumns.has(referenceTimeColumn)) {
            return 'Alignment CSV is missing configured referenceTimeColumn: ' + referenceTimeColumn;
        }

        for (const [, column] of mappingByTrack) {
            if (!availableColumns.has(column)) {
                return 'Alignment CSV is missing configured column: ' + column;
            }
        }

        const referenceDuration = this.resolveReferenceDuration(parsedCsv.rows, referenceTimeColumn);
        if (typeof referenceDuration === 'string') {
            return referenceDuration;
        }

        const converters = new Map<number, TrackAlignmentConverter>();
        for (const [trackIndex, column] of mappingByTrack) {
            try {
                const referenceToTrack = buildColumnTimeMapping(parsedCsv.rows, referenceTimeColumn, column);
                const trackToReference = buildColumnTimeMapping(parsedCsv.rows, column, referenceTimeColumn);

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

        const warpingSeriesByTrack = new Map<number, WarpingMatrixTrackSeries>();
        converters.forEach((converter: TrackAlignmentConverter, trackIndex: number) => {
            const column = mappingByTrack.get(trackIndex);
            const normalizedColumn = typeof column === 'string' ? column.trim() : '';
            if (!normalizedColumn) {
                return;
            }

            const runtime = this.runtimes[trackIndex];
            if (!runtime) {
                return;
            }

            warpingSeriesByTrack.set(
                trackIndex,
                buildWarpingSeries(runtime, trackIndex, normalizedColumn, converter, referenceDuration)
            );
        });

        return {
            referenceDuration: referenceDuration,
            outOfRange: resolveAlignmentOutOfRangeMode(this.alignmentConfig.outOfRange),
            converters: converters,
            columnByTrack: new Map<number, string>(mappingByTrack),
            uniqueColumnOrder: this.collectUniqueAlignmentColumns(mappingByTrack),
            warpingSeriesByTrack: warpingSeriesByTrack,
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
                currentScoreBpm: this.sheetMusicEngine.resolveReferenceBpm(this.state.position),
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
                currentScoreBpm: this.sheetMusicEngine.resolveReferenceBpm(this.state.position),
                columnOrder: this.alignmentContext.uniqueColumnOrder,
                trackSeries: [],
            };
        }

        const referenceDuration = this.longestDuration;
        const trackSeries = this.alignmentContext.warpingSeriesByTrack.has(activeTrackIndex)
            ? [this.alignmentContext.warpingSeriesByTrack.get(activeTrackIndex) as WarpingMatrixTrackSeries]
            : [];

        return {
            enabled: true,
            syncEnabled: this.globalSyncEnabled,
            referenceDuration: this.longestDuration,
            currentReferenceTime: this.state.position,
            currentScoreBpm: this.sheetMusicEngine.resolveReferenceBpm(this.state.position),
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

export function resolveReferenceTimeColumn(ctx: any, config: any): any {
    return (function(this: any, config: any) {
        const configuredReferenceTimeColumn = typeof config.referenceTimeColumn === 'string'
            ? config.referenceTimeColumn.trim()
            : '';

        if (!configuredReferenceTimeColumn) {
            return null;
        }

        return configuredReferenceTimeColumn;
    }).call(ctx, config);
}

export function resolveReferenceDuration(ctx: any, rows: any, referenceTimeColumn: any): any {
    return (function(this: any, rows: any, referenceTimeColumn: any) {
        let maxReference = Number.NEGATIVE_INFINITY;

        rows.forEach(function(row: Record<string, unknown>) {
            const value = Number(row[referenceTimeColumn]);
            if (Number.isFinite(value) && value > maxReference) {
                maxReference = value;
            }
        });

        if (!Number.isFinite(maxReference)) {
            return 'Alignment CSV does not contain valid numeric values for referenceTimeColumn: ' + referenceTimeColumn;
        }

        return Math.max(0, maxReference);
    }).call(ctx, rows, referenceTimeColumn);
}

export function resolveAlignmentMappingsByTrack(ctx: any, config: any): any {
    return (function(this: any, _config: any) {
        const mappingByTrack = new Map<number, string>();

        for (let index = 0; index < this.runtimes.length; index += 1) {
            const rawColumn = this.runtimes[index].definition.alignment?.column;
            const column = typeof rawColumn === 'string' ? rawColumn.trim() : '';
            if (!column) {
                return 'Alignment mode requires alignment.column for every track. Missing trackIndex '
                    + index + '.';
            }

            mappingByTrack.set(index, column);
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

        if (this.effectiveSingleSoloMode && this.runtimes.length > 0) {
            return 0;
        }

        return -1;
    }).call(ctx);
}

export function getAlignmentPlaybackTrackIndex(ctx: any): any {
    return (function(this: any) {
        const activeSoloTrackIndex = this.getActiveSoloTrackIndex();
        if (activeSoloTrackIndex >= 0) {
            return activeSoloTrackIndex;
        }

        if (!this.globalSyncEnabled) {
            return -1;
        }

        for (let index = 0; index < this.runtimes.length; index += 1) {
            const runtime = this.runtimes[index];
            if (!runtime || this.syncLockedTrackIndexes.has(index)) {
                continue;
            }

            if (runtime.activeVariant === 'synced' && runtime.buffer) {
                return index;
            }
        }

        return -1;
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
