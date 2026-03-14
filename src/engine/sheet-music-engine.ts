import { applyConfiguredRenderScale, disposeEntry, initializeEntry, readHostWidth, rebindMeasureCursor, refreshCursorElement, shouldRerenderOnResize } from './sheet-music/entry-lifecycle';
import { moveCursorToMeasure, resolveAvailableMeasure, resolveReferenceTimeForMeasure, updatePosition as updateCursorPosition } from './sheet-music/cursor-sync';
import { handleHostClick, handleHostTouch, handleHostTouchMove, handleHostTouchStart } from './sheet-music/interaction-hit-test';
import { centerCurrentMeasureInViewport, ensureCurrentMeasureVisible } from './sheet-music/scrolling';
import { loadProjectedTempoMap } from './sheet-music/tempo-map';
import {
    DEFAULT_CURSOR_COLOR,
    sanitizeCursorAlpha,
    sanitizePlaybackPosition,
    sanitizeRenderScale,
} from './sheet-music/types';
import type { SheetMusicEntryModel, SheetMusicHostConfig } from './sheet-music/types';

export type { SheetMusicHostConfig } from './sheet-music/types';

export class SheetMusicEngine {
    public readonly onSeekReferenceTime: ((referenceTime: number) => void) | null;
    public entries: SheetMusicEntryModel[] = [];
    public destroyed = false;
    public lastPosition = 0;

    constructor(onSeekReferenceTime?: (referenceTime: number) => void) {
        this.onSeekReferenceTime = typeof onSeekReferenceTime === 'function'
            ? onSeekReferenceTime
            : null;
    }

    async initialize(hosts: SheetMusicHostConfig[]): Promise<void> {
        this.destroy();
        this.destroyed = false;

        this.entries = hosts.map((host) => {
            return {
                host: host.host,
                scrollContainer: host.scrollContainer || null,
                source: host.source,
                measureMapPromise: host.measureMapPromise,
                renderScale: sanitizeRenderScale(host.renderScale),
                followPlayback: host.followPlayback !== false,
                cursorColor: host.cursorColor || DEFAULT_CURSOR_COLOR,
                cursorAlpha: sanitizeCursorAlpha(host.cursorAlpha),
                osmd: null,
                measureCursor: null,
                measureMap: null,
                projectedTempoSegments: null,
                fallbackTempoBpm: null,
                availableMeasures: [],
                availableMeasureSet: new Set<number>(),
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

        await Promise.all(this.entries.map((entry) => initializeEntry(this, entry)));
        this.updatePosition(this.lastPosition);
    }

    updatePosition(referencePosition: number): void {
        updateCursorPosition(this, sanitizePlaybackPosition(referencePosition));
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
                entry.osmd.render();
                entry.lastRenderedHostWidth = readHostWidth(entry.host);
                rebindMeasureCursor(entry);
                refreshCursorElement(entry);
                ensureCurrentMeasureVisible(this, entry);
                hasRerenderedEntry = true;
            } catch (error) {
                console.warn(
                    '[trackswitch] Failed to re-render sheet music on resize for source:',
                    entry.source,
                    error
                );
            }
        });

        if (hasRerenderedEntry) {
            this.updatePosition(this.lastPosition);
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

    public handleHostTouchStart(entry: SheetMusicEntryModel, event: TouchEvent): void {
        handleHostTouchStart(this, entry, event);
    }

    public handleHostTouchMove(entry: SheetMusicEntryModel, event: TouchEvent): void {
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

    public resolveAvailableMeasure(entry: SheetMusicEntryModel, desiredMeasure: number): number | null {
        return resolveAvailableMeasure(entry, desiredMeasure);
    }

    public moveCursorToMeasure(entry: SheetMusicEntryModel, targetMeasure: number): void {
        moveCursorToMeasure(this, entry, targetMeasure);
    }

    public rebindMeasureCursor(entry: SheetMusicEntryModel) {
        return rebindMeasureCursor(entry);
    }

    public resolveReferenceTimeForMeasure(measureMap: Array<{ measure: number; start: number }>, clickedMeasure: number): number {
        return resolveReferenceTimeForMeasure(measureMap, clickedMeasure);
    }

    public resolveReferenceBpm(referenceTime: number): number | null {
        const sanitizedReferenceTime = sanitizePlaybackPosition(referenceTime);

        for (let index = 0; index < this.entries.length; index += 1) {
            const entry = this.entries[index];
            const resolved = resolveEntryReferenceBpm(entry, sanitizedReferenceTime);
            if (resolved !== null) {
                return resolved;
            }
        }

        return null;
    }

    public async loadTempoMap(entry: SheetMusicEntryModel): Promise<void> {
        if (!entry.osmd) {
            entry.fallbackTempoBpm = null;
            entry.projectedTempoSegments = null;
            return;
        }

        try {
            const { fallbackTempoBpm, projectedSegments } = await loadProjectedTempoMap(entry.source, entry.measureMap);
            if (this.destroyed) {
                return;
            }

            entry.fallbackTempoBpm = fallbackTempoBpm;
            entry.projectedTempoSegments = projectedSegments;
        } catch (error) {
            entry.fallbackTempoBpm = resolveOsmdFallbackTempo(entry);
            entry.projectedTempoSegments = null;
            console.warn(
                '[trackswitch] Failed to load score tempo map:',
                entry.source,
                error
            );
        }
    }
}

function resolveEntryReferenceBpm(entry: SheetMusicEntryModel, referenceTime: number): number | null {
    const projectedSegments = entry.projectedTempoSegments || [];
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

    if (Number.isFinite(entry.fallbackTempoBpm) && (entry.fallbackTempoBpm as number) > 0) {
        return entry.fallbackTempoBpm;
    }

    return resolveOsmdFallbackTempo(entry);
}

function resolveOsmdFallbackTempo(entry: SheetMusicEntryModel): number | null {
    const sheet = entry.osmd?.Sheet as any;
    if (!sheet) {
        return null;
    }

    const expressionsTempo = typeof sheet.getExpressionsStartTempoInBPM === 'function'
        ? Number(sheet.getExpressionsStartTempoInBPM())
        : Number.NaN;
    if (Number.isFinite(expressionsTempo) && expressionsTempo > 0) {
        return expressionsTempo;
    }

    const defaultTempo = Number(sheet.DefaultStartTempoInBpm);
    if (Number.isFinite(defaultTempo) && defaultTempo > 0) {
        return defaultTempo;
    }

    return null;
}
