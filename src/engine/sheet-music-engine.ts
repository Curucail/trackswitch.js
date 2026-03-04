import { applyConfiguredRenderScale, disposeEntry, initializeEntry, readHostWidth, rebindMeasureCursor, refreshCursorElement, shouldRerenderOnResize } from './sheet-music/entry-lifecycle';
import { moveCursorToMeasure, resolveAvailableMeasure, resolveReferenceTimeForMeasure, updatePosition as updateCursorPosition } from './sheet-music/cursor-sync';
import { handleHostClick, handleHostTouch, handleHostTouchMove, handleHostTouchStart } from './sheet-music/interaction-hit-test';
import { centerCurrentMeasureInViewport, ensureCurrentMeasureVisible } from './sheet-music/scrolling';
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
                measureCsv: host.measureCsv,
                renderScale: sanitizeRenderScale(host.renderScale),
                followPlayback: host.followPlayback !== false,
                cursorColor: host.cursorColor || DEFAULT_CURSOR_COLOR,
                cursorAlpha: sanitizeCursorAlpha(host.cursorAlpha),
                osmd: null,
                measureCursor: null,
                measureMap: null,
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
}
