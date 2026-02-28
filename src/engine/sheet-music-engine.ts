import {
    CursorType,
    OpenSheetMusicDisplay,
} from 'opensheetmusicdisplay';
import { loadMeasureMapCsv, MeasureMapPoint } from '../shared/measure-map';

export interface SheetMusicHostConfig {
    host: HTMLElement;
    source: string;
    measureCsv: string;
    cursorColor: string;
    cursorAlpha: number;
}

interface SheetMusicEntry {
    host: HTMLElement;
    source: string;
    measureCsv: string;
    cursorColor: string;
    cursorAlpha: number;
    osmd: OpenSheetMusicDisplay | null;
    measureCursor: {
        reset?: () => void;
        show?: () => void;
        nextMeasure?: () => void;
        previousMeasure?: () => void;
        Iterator?: {
            CurrentMeasure?: {
                MeasureNumber?: number;
            };
        };
    } | null;
    measureMap: MeasureMapPoint[] | null;
    availableMeasures: number[];
    availableMeasureSet: Set<number>;
    syncEnabled: boolean;
    targetMeasure: number | null;
}

const DEFAULT_CURSOR_COLOR = '#999999';
const DEFAULT_CURSOR_ALPHA = 0.1;

function sanitizeCursorAlpha(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_CURSOR_ALPHA;
    }

    if (value < 0) {
        return 0;
    }

    if (value > 1) {
        return 1;
    }

    return value;
}

function sanitizePlaybackPosition(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return 0;
    }

    return value;
}

export class SheetMusicEngine {
    private entries: SheetMusicEntry[] = [];
    private destroyed = false;
    private lastPosition = 0;

    async initialize(hosts: SheetMusicHostConfig[]): Promise<void> {
        this.destroy();
        this.destroyed = false;

        this.entries = hosts.map((host) => {
            return {
                host: host.host,
                source: host.source,
                measureCsv: host.measureCsv,
                cursorColor: host.cursorColor || DEFAULT_CURSOR_COLOR,
                cursorAlpha: sanitizeCursorAlpha(host.cursorAlpha),
                osmd: null,
                measureCursor: null,
                measureMap: null,
                availableMeasures: [],
                availableMeasureSet: new Set<number>(),
                syncEnabled: false,
                targetMeasure: null,
            };
        });

        await Promise.all(this.entries.map((entry) => this.initializeEntry(entry)));
        this.updatePosition(this.lastPosition);
    }

    updatePosition(referencePosition: number): void {
        this.lastPosition = sanitizePlaybackPosition(referencePosition);

        this.entries.forEach((entry) => {
            if (!entry.syncEnabled || !entry.measureMap || entry.measureMap.length === 0) {
                return;
            }

            const mappedMeasure = this.resolveMappedMeasure(entry.measureMap, this.lastPosition);
            if (mappedMeasure === null) {
                return;
            }

            const targetMeasure = this.resolveAvailableMeasure(entry, mappedMeasure);
            if (targetMeasure === null || targetMeasure === entry.targetMeasure) {
                return;
            }

            this.moveCursorToMeasure(entry, targetMeasure);
        });
    }

    resize(): void {
        this.entries.forEach((entry) => {
            if (!entry.osmd) {
                return;
            }

            try {
                entry.osmd.render();
            } catch (error) {
                console.warn(
                    '[trackswitch] Failed to re-render sheet music on resize for source:',
                    entry.source,
                    error
                );
            }
        });

        this.updatePosition(this.lastPosition);
    }

    destroy(): void {
        this.destroyed = true;
        this.entries.forEach((entry) => {
            this.disposeEntry(entry);
        });
        this.entries = [];
    }

    private async initializeEntry(entry: SheetMusicEntry): Promise<void> {
        entry.host.classList.remove('sheetmusic-error', 'sheetmusic-ready', 'sheetmusic-map-error');
        entry.host.classList.add('sheetmusic-loading');

        const measureMapPromise = loadMeasureMapCsv(entry.measureCsv)
            .then((points) => {
                entry.measureMap = points;
                entry.host.classList.remove('sheetmusic-map-error');
                return points;
            })
            .catch((error) => {
                entry.measureMap = null;
                entry.host.classList.add('sheetmusic-map-error');
                console.warn(
                    '[trackswitch] Failed to load sheet-music measure map:',
                    entry.measureCsv,
                    error
                );
                return null;
            });

        try {
            const osmd = new OpenSheetMusicDisplay(entry.host, {
                backend: 'svg',
                cursorsOptions: [{
                    type: CursorType.CurrentArea,
                    color: entry.cursorColor,
                    alpha: entry.cursorAlpha,
                    follow: false,
                }],
            });

            await osmd.load(entry.source);
            if (this.destroyed) {
                return;
            }

            osmd.render();
            osmd.enableOrDisableCursors(true);

            const rawCursor = osmd.cursors && osmd.cursors.length > 0
                ? osmd.cursors[0]
                : osmd.cursor;
            const cursor = rawCursor as SheetMusicEntry['measureCursor'];
            if (cursor?.show) {
                cursor.show();
            }

            entry.osmd = osmd;
            entry.measureCursor = cursor || null;
            entry.availableMeasures = this.collectAvailableMeasures(osmd);
            entry.availableMeasureSet = new Set(entry.availableMeasures);

            if (entry.availableMeasures.length === 0) {
                console.warn(
                    '[trackswitch] Sheet music rendered but no score measures were detected for source:',
                    entry.source
                );
            }
        } catch (error) {
            entry.osmd = null;
            entry.measureCursor = null;
            entry.availableMeasures = [];
            entry.availableMeasureSet = new Set<number>();
            entry.host.classList.add('sheetmusic-error');
            console.warn(
                '[trackswitch] Failed to load or render sheet music source:',
                entry.source,
                error
            );
        }

        await measureMapPromise;

        entry.syncEnabled = Boolean(
            entry.osmd
            && entry.measureMap
            && entry.measureMap.length > 0
            && entry.availableMeasures.length > 0
            && entry.measureCursor
        );
        entry.targetMeasure = null;

        entry.host.classList.remove('sheetmusic-loading');
        entry.host.classList.toggle('sheetmusic-ready', Boolean(entry.osmd));
        entry.host.classList.toggle('sheetmusic-error', !entry.osmd);
    }

    private disposeEntry(entry: SheetMusicEntry): void {
        const osmd = entry.osmd;
        if (!osmd) {
            return;
        }

        try {
            osmd.enableOrDisableCursors(false);
        } catch (error) {
            console.warn('[trackswitch] Failed to disable sheet-music cursor.', error);
        }

        try {
            osmd.AutoResizeEnabled = false;
        } catch (error) {
            console.warn('[trackswitch] Failed to disable sheet-music auto-resize.', error);
        }

        try {
            osmd.clear();
        } catch (error) {
            console.warn('[trackswitch] Failed to clear sheet-music renderer.', error);
        }

        entry.osmd = null;
        entry.measureCursor = null;
        entry.syncEnabled = false;
    }

    private resolveMappedMeasure(measureMap: MeasureMapPoint[], position: number): number | null {
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

    private resolveAvailableMeasure(entry: SheetMusicEntry, desiredMeasure: number): number | null {
        if (entry.availableMeasures.length === 0) {
            return null;
        }

        if (entry.availableMeasureSet.has(desiredMeasure)) {
            return desiredMeasure;
        }

        for (let index = entry.availableMeasures.length - 1; index >= 0; index -= 1) {
            const candidate = entry.availableMeasures[index];
            if (candidate <= desiredMeasure) {
                return candidate;
            }
        }

        return entry.availableMeasures[0];
    }

    private moveCursorToMeasure(entry: SheetMusicEntry, targetMeasure: number): void {
        const cursor = entry.measureCursor;
        if (!cursor?.reset || !cursor?.nextMeasure || !cursor?.previousMeasure) {
            return;
        }

        cursor.reset();
        if (cursor.show) {
            cursor.show();
        }

        const maxSteps = Math.max(1, entry.availableMeasures.length + 5);
        let currentMeasure = this.readCursorMeasure(cursor);
        if (currentMeasure === null) {
            currentMeasure = entry.availableMeasures[0] ?? null;
        }

        let steps = 0;
        while (
            currentMeasure !== null
            && currentMeasure !== targetMeasure
            && steps < maxSteps
        ) {
            if (currentMeasure < targetMeasure) {
                cursor.nextMeasure();
            } else {
                cursor.previousMeasure();
            }

            const nextMeasure = this.readCursorMeasure(cursor);
            if (nextMeasure === null || nextMeasure === currentMeasure) {
                break;
            }

            currentMeasure = nextMeasure;
            steps += 1;
        }

        entry.targetMeasure = this.resolveAvailableMeasure(
            entry,
            currentMeasure === null ? targetMeasure : currentMeasure
        );
    }

    private readCursorMeasure(cursor: NonNullable<SheetMusicEntry['measureCursor']>): number | null {
        const raw = cursor.Iterator?.CurrentMeasure?.MeasureNumber;
        if (!Number.isFinite(raw)) {
            return null;
        }

        return Math.floor(raw as number);
    }

    private collectAvailableMeasures(osmd: OpenSheetMusicDisplay): number[] {
        const sourceMeasures = osmd.Sheet?.SourceMeasures;
        if (!Array.isArray(sourceMeasures)) {
            return [];
        }

        const unique = new Set<number>();
        sourceMeasures.forEach((measure) => {
            const rawMeasureNumber = measure?.MeasureNumber;
            const parsedMeasureNumber = Number(rawMeasureNumber);
            if (!Number.isFinite(parsedMeasureNumber)) {
                return;
            }
            unique.add(Math.floor(parsedMeasureNumber));
        });

        return Array.from(unique).sort(function(a, b) {
            return a - b;
        });
    }
}
