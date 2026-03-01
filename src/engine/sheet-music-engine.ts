import {
    CursorType,
    GraphicalMeasure,
    OpenSheetMusicDisplay,
    PointF2D,
} from 'opensheetmusicdisplay';
import { loadMeasureMapCsv, MeasureMapPoint } from '../shared/measure-map';

export interface SheetMusicHostConfig {
    host: HTMLElement;
    scrollContainer: HTMLElement | null;
    source: string;
    measureCsv: string;
    renderScale: number | null;
    followPlayback: boolean;
    cursorColor: string;
    cursorAlpha: number;
}

interface SheetMusicEntry {
    host: HTMLElement;
    scrollContainer: HTMLElement | null;
    source: string;
    measureCsv: string;
    renderScale: number | null;
    followPlayback: boolean;
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
        cursorElement?: Element | null;
    } | null;
    measureMap: MeasureMapPoint[] | null;
    availableMeasures: number[];
    availableMeasureSet: Set<number>;
    syncEnabled: boolean;
    targetMeasure: number | null;
    clickListener: ((event: MouseEvent) => void) | null;
}

const DEFAULT_CURSOR_COLOR = '#999999';
const DEFAULT_CURSOR_ALPHA = 0.1;
const DEFAULT_GRAPHICAL_MEASURE_CLASS_NAME = 'GraphicalMeasure';
const MIN_OSMD_ZOOM = 0.05;
const MAX_OSMD_ZOOM = 8;

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

function sanitizeRenderScale(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }

    return value;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
    if (!Number.isFinite(value)) {
        return minimum;
    }

    if (value < minimum) {
        return minimum;
    }

    if (value > maximum) {
        return maximum;
    }

    return value;
}

export class SheetMusicEngine {
    private readonly onSeekReferenceTime: ((referenceTime: number) => void) | null;
    private entries: SheetMusicEntry[] = [];
    private destroyed = false;
    private lastPosition = 0;

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
                this.applyConfiguredRenderScale(entry);
                entry.osmd.render();
                this.ensureCurrentMeasureVisible(entry);
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

            entry.osmd = osmd;
            this.applyConfiguredRenderScale(entry);
            osmd.render();
            osmd.enableOrDisableCursors(true);

            const rawCursor = osmd.cursors && osmd.cursors.length > 0
                ? osmd.cursors[0]
                : osmd.cursor;
            const cursor = rawCursor as SheetMusicEntry['measureCursor'];
            if (cursor?.show) {
                cursor.show();
            }

            entry.measureCursor = cursor || null;
            this.refreshCursorElement(entry);
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

        if (entry.osmd) {
            const clickListener = (event: MouseEvent) => {
                this.handleHostClick(entry, event);
            };
            entry.clickListener = clickListener;
            entry.host.addEventListener('click', clickListener);
        }
    }

    private applyConfiguredRenderScale(entry: SheetMusicEntry): void {
        if (!entry.osmd) {
            return;
        }

        if (entry.renderScale === null) {
            entry.osmd.Zoom = 1;
            return;
        }

        entry.osmd.Zoom = Math.max(
            MIN_OSMD_ZOOM,
            Math.min(MAX_OSMD_ZOOM, entry.renderScale)
        );
    }

    private refreshCursorElement(entry: SheetMusicEntry): void {
        const cursor = entry.measureCursor;
        if (!cursor) {
            return;
        }

        if (cursor.cursorElement instanceof Element) {
            return;
        }

        const hostCursor = entry.host.querySelector('[id^="osmdCursor"]');
        if (hostCursor instanceof Element) {
            cursor.cursorElement = hostCursor;
        }
    }

    private ensureCurrentMeasureVisible(entry: SheetMusicEntry): void {
        if (!entry.followPlayback || !entry.syncEnabled || !entry.scrollContainer) {
            return;
        }

        const cursor = entry.measureCursor;
        if (!cursor) {
            return;
        }

        this.refreshCursorElement(entry);
        if (!(cursor.cursorElement instanceof Element)) {
            return;
        }

        const scrollContainer = entry.scrollContainer;
        const clientHeight = scrollContainer.clientHeight;
        const maxScrollTop = scrollContainer.scrollHeight - clientHeight;
        if (!Number.isFinite(maxScrollTop) || maxScrollTop <= 1 || clientHeight <= 0) {
            return;
        }

        const cursorRect = cursor.cursorElement.getBoundingClientRect();
        const viewportRect = scrollContainer.getBoundingClientRect();

        if (
            !Number.isFinite(cursorRect.top)
            || !Number.isFinite(cursorRect.bottom)
            || !Number.isFinite(viewportRect.top)
            || !Number.isFinite(viewportRect.bottom)
        ) {
            return;
        }

        const viewportTop = scrollContainer.scrollTop;
        const viewportBottom = viewportTop + clientHeight;
        const cursorTop = viewportTop + (cursorRect.top - viewportRect.top);
        const cursorBottom = viewportTop + (cursorRect.bottom - viewportRect.top);
        const padding = clampNumber(Math.round(clientHeight * 0.12), 8, 24);
        const visibleTop = viewportTop + padding;
        const visibleBottom = viewportBottom - padding;

        const cursorCenter = cursorTop + ((cursorBottom - cursorTop) / 2);
        let nextScrollTop = viewportTop;
        if (cursorTop < visibleTop) {
            nextScrollTop = cursorCenter;
        } else if (cursorBottom > visibleBottom) {
            nextScrollTop = cursorCenter;
        } else {
            return;
        }

        const clampedScrollTop = clampNumber(nextScrollTop, 0, maxScrollTop);
        if (Math.abs(clampedScrollTop - viewportTop) < 0.5) {
            return;
        }

        scrollContainer.scrollTop = clampedScrollTop;
    }

    private disposeEntry(entry: SheetMusicEntry): void {
        if (entry.clickListener) {
            entry.host.removeEventListener('click', entry.clickListener);
            entry.clickListener = null;
        }

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

    private handleHostClick(entry: SheetMusicEntry, event: MouseEvent): void {
        if (!this.onSeekReferenceTime || !entry.measureMap || entry.measureMap.length === 0) {
            return;
        }

        const clickedMeasure = this.resolveClickedMeasure(entry, event);
        if (clickedMeasure === null) {
            return;
        }

        const referenceTime = this.resolveReferenceTimeForMeasure(entry.measureMap, clickedMeasure);
        if (!Number.isFinite(referenceTime)) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        this.onSeekReferenceTime(Math.max(0, referenceTime));
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

        this.ensureCurrentMeasureVisible(entry);
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

    private resolveClickedMeasure(entry: SheetMusicEntry, event: MouseEvent): number | null {
        const graphicSheet = entry.osmd?.GraphicSheet as {
            domToSvg?: (point: PointF2D) => PointF2D;
            svgToOsmd?: (point: PointF2D) => PointF2D;
            GetNearestObject?: (point: PointF2D, className: string) => unknown;
            GetNearestStaffEntry?: (point: PointF2D) => unknown;
            MeasureList?: unknown;
        } | undefined;
        if (!graphicSheet) {
            return null;
        }

        const runtimeMeasureClassName = this.resolveGraphicalMeasureClassName();

        const attemptFromPoint = (x: number | undefined, y: number | undefined): number | null => {
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return null;
            }

            try {
                const domPoint = new PointF2D(x as number, y as number);
                const svgPoint = typeof graphicSheet.domToSvg === 'function'
                    ? graphicSheet.domToSvg(domPoint)
                    : domPoint;
                const osmdPoint = typeof graphicSheet.svgToOsmd === 'function'
                    ? graphicSheet.svgToOsmd(svgPoint)
                    : svgPoint;
                const nearestMeasure = this.findNearestMeasureObject(
                    graphicSheet,
                    osmdPoint,
                    runtimeMeasureClassName
                );
                const fromNearestMeasure = this.extractMeasureNumber(nearestMeasure);
                if (fromNearestMeasure !== null) {
                    return fromNearestMeasure;
                }

                const nearestStaffEntry = typeof graphicSheet.GetNearestStaffEntry === 'function'
                    ? graphicSheet.GetNearestStaffEntry(osmdPoint)
                    : null;
                const fromNearestStaffEntry = this.extractMeasureNumber(
                    this.extractParentMeasureFromStaffEntry(nearestStaffEntry)
                );
                if (fromNearestStaffEntry !== null) {
                    return fromNearestStaffEntry;
                }

                return this.resolveMeasureFromMeasureList(graphicSheet.MeasureList, osmdPoint);
            } catch (_error) {
                return null;
            }
        };

        return attemptFromPoint(event.clientX, event.clientY)
            ?? attemptFromPoint(event.pageX, event.pageY);
    }

    private resolveGraphicalMeasureClassName(): string {
        const className = typeof GraphicalMeasure === 'function'
            ? String(GraphicalMeasure.name || '')
            : '';
        return className || DEFAULT_GRAPHICAL_MEASURE_CLASS_NAME;
    }

    private findNearestMeasureObject(
        graphicSheet: {
            GetNearestObject?: (point: PointF2D, className: string) => unknown;
        },
        point: PointF2D,
        runtimeMeasureClassName: string
    ): unknown {
        if (typeof graphicSheet.GetNearestObject !== 'function') {
            return null;
        }

        const classNames = [runtimeMeasureClassName, DEFAULT_GRAPHICAL_MEASURE_CLASS_NAME]
            .filter((className, index, all) => Boolean(className) && all.indexOf(className) === index);

        for (let index = 0; index < classNames.length; index += 1) {
            const candidate = graphicSheet.GetNearestObject(point, classNames[index]);
            if (candidate) {
                return candidate;
            }
        }

        return null;
    }

    private extractParentMeasureFromStaffEntry(staffEntry: unknown): unknown {
        if (!staffEntry || typeof staffEntry !== 'object') {
            return null;
        }

        const candidate = staffEntry as {
            parentMeasure?: unknown;
            ParentMeasure?: unknown;
        };

        return candidate.parentMeasure ?? candidate.ParentMeasure ?? null;
    }

    private resolveMeasureFromMeasureList(measureListRaw: unknown, point: PointF2D): number | null {
        if (!Array.isArray(measureListRaw)) {
            return null;
        }

        let bestMeasure: unknown = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let columnIndex = 0; columnIndex < measureListRaw.length; columnIndex += 1) {
            const column = measureListRaw[columnIndex];
            if (!Array.isArray(column)) {
                continue;
            }

            for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
                const measure = column[rowIndex];
                const boundingBox = this.extractMeasureBoundingBox(measure);
                if (!boundingBox) {
                    continue;
                }

                if (typeof boundingBox.pointLiesInsideBorders === 'function') {
                    try {
                        if (boundingBox.pointLiesInsideBorders(point)) {
                            const exactMatch = this.extractMeasureNumber(measure);
                            if (exactMatch !== null) {
                                return exactMatch;
                            }
                        }
                    } catch (_error) {
                        // Ignore malformed bounding boxes and continue scanning.
                    }
                }

                const center = this.extractBoundingBoxCenter(boundingBox);
                if (!center) {
                    continue;
                }

                const dx = center.x - point.x;
                const dy = center.y - point.y;
                const distance = (dx * dx) + (dy * dy);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMeasure = measure;
                }
            }
        }

        return this.extractMeasureNumber(bestMeasure);
    }

    private extractMeasureBoundingBox(measure: unknown): {
        pointLiesInsideBorders?: (position: PointF2D) => boolean;
        Center?: unknown;
        center?: unknown;
    } | null {
        if (!measure || typeof measure !== 'object') {
            return null;
        }

        const candidate = measure as {
            PositionAndShape?: unknown;
            positionAndShape?: unknown;
        };

        const box = candidate.PositionAndShape ?? candidate.positionAndShape;
        if (!box || typeof box !== 'object') {
            return null;
        }

        return box as {
            pointLiesInsideBorders?: (position: PointF2D) => boolean;
            Center?: unknown;
            center?: unknown;
        };
    }

    private extractBoundingBoxCenter(box: { Center?: unknown; center?: unknown }): PointF2D | null {
        const centerCandidate = box.Center ?? box.center;
        if (!centerCandidate || typeof centerCandidate !== 'object') {
            return null;
        }

        const pointCandidate = centerCandidate as { x?: number; y?: number };
        if (!Number.isFinite(pointCandidate.x) || !Number.isFinite(pointCandidate.y)) {
            return null;
        }

        return new PointF2D(pointCandidate.x as number, pointCandidate.y as number);
    }

    private extractMeasureNumber(measureObject: unknown): number | null {
        if (!measureObject || typeof measureObject !== 'object') {
            return null;
        }

        const candidate = measureObject as {
            ParentSourceMeasure?: { MeasureNumber?: number };
            parentSourceMeasure?: { MeasureNumber?: number };
            MeasureNumber?: number;
            measureNumber?: number;
        };

        const rawValues: Array<number | undefined> = [
            candidate.ParentSourceMeasure?.MeasureNumber,
            candidate.parentSourceMeasure?.MeasureNumber,
            candidate.MeasureNumber,
            candidate.measureNumber,
        ];

        for (let index = 0; index < rawValues.length; index += 1) {
            const raw = rawValues[index];
            if (Number.isFinite(raw)) {
                return Math.floor(raw as number);
            }
        }

        return null;
    }

    private resolveReferenceTimeForMeasure(measureMap: MeasureMapPoint[], clickedMeasure: number): number {
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
}
