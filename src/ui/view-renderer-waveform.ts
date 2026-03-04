import { NormalizedTrackGroupLayout, TrackRuntime, TrackSwitchFeatures, TrackSwitchUiState } from '../domain/types';
import { escapeHtml, sanitizeInlineStyle } from '../shared/dom';
import { formatSecondsToHHMMSSmmm } from '../shared/format';
import { clampPercent } from '../shared/math';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import * as d3 from 'd3';

type SvgSelection = d3.Selection<SVGSVGElement, unknown, null, undefined>;
type GroupSelection = d3.Selection<SVGGElement, unknown, null, undefined>;
type PathSelection = d3.Selection<SVGPathElement, unknown, null, undefined>;
type RectSelection = d3.Selection<SVGRectElement, unknown, null, undefined>;
type LineSelection = d3.Selection<SVGLineElement, unknown, null, undefined>;
type CircleSelection = d3.Selection<SVGCircleElement, unknown, null, undefined>;
type TextSelection = d3.Selection<SVGTextElement, unknown, null, undefined>;

export interface WaveformTimelineContext {
    enabled: boolean;
    referenceToTrackTime(trackIndex: number, referenceTime: number): number;
    getTrackDuration(trackIndex: number): number;
}

export interface SheetMusicHostConfig {
    host: HTMLElement;
    scrollContainer: HTMLElement;
    source: string;
    measureCsv: string;
    renderScale: number | null;
    followPlayback: boolean;
    cursorColor: string;
    cursorAlpha: number;
}

export interface WarpingMatrixDataPoint {
    referenceTime: number;
    trackTime: number;
}

export interface WarpingMatrixTrackSeries {
    trackIndex: number;
    columnKey: string;
    points: WarpingMatrixDataPoint[];
    trackDuration: number;
}

export interface WarpingMatrixRenderContext {
    enabled: boolean;
    syncEnabled: boolean;
    referenceDuration: number;
    currentReferenceTime: number;
    columnOrder: string[];
    trackSeries: WarpingMatrixTrackSeries[];
}

interface WaveformSeekSurfaceMetadata {
    wrapper: HTMLElement;
    scrollContainer: HTMLElement;
    overlay: HTMLElement;
    surface: HTMLElement;
    tileLayer: HTMLElement;
    seekWrap: HTMLElement;
    waveformSource: 'audible' | number;
    originalHeight: number;
    barWidth: number;
    maxZoom: number;
    baseWidth: number;
    zoom: number;
    timingNode: HTMLElement | null;
    zoomNode: HTMLElement;
    tiles: Map<number, { canvas: HTMLCanvasElement; lastDrawKey: string | null }>;
    normalizationPeak: number;
    normalizationCacheKey: string | null;
}

interface LatestWaveformRenderInput {
    waveformEngine: WaveformEngine;
    runtimes: TrackRuntime[];
    timelineDuration: number;
    trackTimelineProjector?: TrackTimelineProjector;
    waveformTimelineContext?: WaveformTimelineContext;
}

interface WarpingMatrixPathPoint {
    referenceTime: number;
    trackTime: number;
}

interface WarpingMatrixPathSeriesData {
    pointsByReferenceTime: WarpingMatrixPathPoint[];
    pointsByTrackTime: WarpingMatrixPathPoint[];
    trackDuration: number;
}

interface WarpingMatrixMatrixData {
    byColumn: Map<string, WarpingMatrixPathSeriesData>;
}

interface WarpingMatrixTempoPoint {
    trackTime: number;
    referenceTime: number;
    tempoPercent: number;
}

interface WarpingMatrixTempoData {
    byColumn: Map<string, WarpingMatrixTempoPoint[]>;
}

interface WarpingPlotMargins {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

interface WarpingMatrixPlotState {
    svg: SvgSelection;
    title: TextSelection;
    xAxis: GroupSelection;
    yAxis: GroupSelection;
    xLabel: TextSelection;
    yLabel: TextSelection;
    plotRoot: GroupSelection;
    pathLayer: GroupSelection;
    clipRect: RectSelection;
    pathByColumn: Map<string, PathSelection>;
    guideDiagonal: LineSelection;
    playhead: CircleSelection;
    xScale: d3.ScaleLinear<number, number>;
    yScale: d3.ScaleLinear<number, number>;
    margins: WarpingPlotMargins;
    innerWidth: number;
    innerHeight: number;
}

interface WarpingTempoPlotState {
    svg: SvgSelection;
    title: TextSelection;
    xAxis: GroupSelection;
    yAxis: GroupSelection;
    xLabel: TextSelection;
    yLabel: TextSelection;
    plotRoot: GroupSelection;
    clipRect: RectSelection;
    path: PathSelection;
    baseline: LineSelection;
    centerLine: LineSelection;
    xScale: d3.ScaleLinear<number, number>;
    yScale: d3.ScaleLinear<number, number>;
    margins: WarpingPlotMargins;
    innerWidth: number;
    innerHeight: number;
}

interface WarpingMatrixHostMetadata {
    wrapper: HTMLElement;
    host: HTMLElement;
    matrixPanel: HTMLElement;
    matrixPlotHost: HTMLElement;
    matrixPlot: WarpingMatrixPlotState | null;
    matrixDisabledOverlay: HTMLElement;
    tempoPanel: HTMLElement;
    tempoPlotHost: HTMLElement;
    tempoPlot: WarpingTempoPlotState | null;
    tempoDisabledOverlay: HTMLElement;
    tempoControls: HTMLElement;
    tempoWindowSlider: HTMLInputElement;
    tempoWindowValueNode: HTMLElement;
    tempoYScaleSlider: HTMLInputElement;
    tempoYScaleValueNode: HTMLElement;
    matrixSeriesSignature: string | null;
    matrixDataCache: WarpingMatrixMatrixData | null;
    matrixDataCacheKey: string | null;
    tempoDataCache: WarpingMatrixTempoData | null;
    tempoDataCacheKey: string | null;
    matrixDisabled: boolean;
    matrixTrackDuration: number;
    configuredHeight: number | null;
    tempoWindowSeconds: number;
    tempoYHalfRangePercent: number;
    colorByColumn: Map<string, string>;
    activeColumnKey: string | null;
    referenceDuration: number;
    currentReferenceTime: number;
    currentTrackTime: number;
    matrixActivePointerId: number | null;
    lastSizeKey: string | null;
}

const MIN_WAVEFORM_ZOOM = 1;
const DEFAULT_MAX_WAVEFORM_ZOOM = 20;
const WAVEFORM_TILE_WIDTH_PX = 1024;
const WARPING_MATRIX_PRIMARY_COLOR = '#ED8C01';
const DEFAULT_WARPING_MATRIX_PATH_STROKE_WIDTH = 3;
const DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_WINDOW_SECONDS = 60;
const WARPING_MATRIX_LOCAL_TEMPO_SLOPE_HALF_WINDOW_POINTS = 1;
const WARPING_MATRIX_TEMPO_WINDOW_MIN_SECONDS = 10;
const WARPING_MATRIX_TEMPO_WINDOW_MAX_SECONDS = 180;
const WARPING_MATRIX_TEMPO_WINDOW_STEP_SECONDS = 0.5;
const WARPING_MATRIX_TEMPO_Y_RANGE_MIN_PERCENT = 150;
const WARPING_MATRIX_TEMPO_Y_RANGE_MAX_PERCENT = 500;
const WARPING_MATRIX_TEMPO_Y_RANGE_STEP_PERCENT = 1;
const DEFAULT_WARPING_MATRIX_TEMPO_Y_HALF_RANGE_PERCENT = 250;

function buildSeekWrap(leftPercent: number, rightPercent: number): string {
    return '<div class="seekwrap" style="left: ' + leftPercent + '%; right: ' + rightPercent + '%;">'
        + '<div class="loop-region"></div>'
        + '<div class="loop-marker marker-a"></div>'
        + '<div class="loop-marker marker-b"></div>'
        + '<div class="seekhead"></div>'
        + '</div>';
}

function setDisplay(element: Element, displayValue: string): void {
    (element as HTMLElement).style.display = displayValue;
}

function setLeftPercent(element: Element, value: number): void {
    (element as HTMLElement).style.left = value + '%';
}

function setWidthPercent(element: Element, value: number): void {
    (element as HTMLElement).style.width = value + '%';
}

function clampTime(value: number, minimum: number, maximum: number): number {
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

function sanitizeVolume(value: number): number {
    if (!Number.isFinite(value)) {
        return 1;
    }

    return clampTime(value, 0, 1);
}

function sanitizePan(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return clampTime(value, -1, 1);
}

function sanitizeDuration(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return value;
}

function resolveWarpingMatrixTrackDuration(trackDuration: number, fallbackDuration: number): number {
    const normalizedTrackDuration = sanitizeDuration(trackDuration);
    if (normalizedTrackDuration > 0) {
        return normalizedTrackDuration;
    }

    const normalizedFallbackDuration = sanitizeDuration(fallbackDuration);
    if (normalizedFallbackDuration > 0) {
        return normalizedFallbackDuration;
    }

    return 0.001;
}

function resolveWarpingMatrixSeriesMaxTrackTime(
    points: WarpingMatrixDataPoint[],
    fallbackDuration: number
): number {
    let maxTrackTime = Number.NEGATIVE_INFINITY;
    points.forEach((point) => {
        if (Number.isFinite(point.trackTime) && point.trackTime > maxTrackTime) {
            maxTrackTime = point.trackTime;
        }
    });

    if (Number.isFinite(maxTrackTime) && maxTrackTime > 0) {
        return maxTrackTime;
    }

    return resolveWarpingMatrixTrackDuration(0, fallbackDuration);
}

function parseWaveformBarWidth(value: string | null, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }

    return Math.max(1, Math.floor(parsed));
}

function parseWaveformSource(value: string | null): 'audible' | number {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || raw === 'audible') {
        return 'audible';
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 'audible';
    }

    return Math.floor(parsed);
}

function parseWaveformTimerEnabled(value: string | null, mode: TrackSwitchFeatures['mode']): boolean {
    if (value === null) {
        return mode === 'alignment';
    }

    return value.trim().toLowerCase() === 'true';
}

function parseWaveformMaxZoom(value: string | null): number {
    if (value === null) {
        return DEFAULT_MAX_WAVEFORM_ZOOM;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return DEFAULT_MAX_WAVEFORM_ZOOM;
    }

    if (trimmed.endsWith('%')) {
        const percent = Number(trimmed.slice(0, -1).trim());
        if (Number.isFinite(percent) && percent >= 100) {
            return percent / 100;
        }

        return DEFAULT_MAX_WAVEFORM_ZOOM;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < MIN_WAVEFORM_ZOOM) {
        return DEFAULT_MAX_WAVEFORM_ZOOM;
    }

    return parsed;
}

function parseSheetMusicString(value: string | null): string {
    return typeof value === 'string' ? value.trim() : '';
}

function parseSheetMusicCursorColor(value: string | null): string {
    const raw = parseSheetMusicString(value);
    return raw || '#999999';
}

function parseSheetMusicCursorAlpha(value: string | null): number {
    if (value === null) {
        return 0.1;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0.1;
    }

    if (parsed < 0) {
        return 0;
    }

    if (parsed > 1) {
        return 1;
    }

    return parsed;
}

function parseSheetMusicMaxHeight(value: string | null): number | null {
    if (value === null) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return null;
    }

    return Math.max(1, Math.round(parsed));
}

function parseSheetMusicMaxWidth(value: string | null): number | null {
    if (value === null) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return null;
    }

    return Math.max(1, Math.round(parsed));
}

function parseSheetMusicRenderScale(value: string | null): number | null {
    if (value === null) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return parsed;
}

function parseSheetMusicFollowPlayback(value: string | null): boolean {
    if (value === null) {
        return true;
    }

    return parseSheetMusicString(value).toLowerCase() !== 'false';
}

function parseWarpingMatrixHeight(value: string | null): number | null {
    if (value === null) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return null;
    }

    return Math.max(1, Math.round(parsed));
}

function normalizeTempoWindowSeconds(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_WINDOW_SECONDS;
    }

    return clampTime(
        Math.round(value / WARPING_MATRIX_TEMPO_WINDOW_STEP_SECONDS) * WARPING_MATRIX_TEMPO_WINDOW_STEP_SECONDS,
        WARPING_MATRIX_TEMPO_WINDOW_MIN_SECONDS,
        WARPING_MATRIX_TEMPO_WINDOW_MAX_SECONDS
    );
}

function normalizeTempoYHalfRangePercent(value: number): number {
    if (!Number.isFinite(value)) {
        return DEFAULT_WARPING_MATRIX_TEMPO_Y_HALF_RANGE_PERCENT;
    }

    return clampTime(
        Math.round(value / WARPING_MATRIX_TEMPO_Y_RANGE_STEP_PERCENT) * WARPING_MATRIX_TEMPO_Y_RANGE_STEP_PERCENT,
        WARPING_MATRIX_TEMPO_Y_RANGE_MIN_PERCENT,
        WARPING_MATRIX_TEMPO_Y_RANGE_MAX_PERCENT
    );
}

function clampWaveformZoom(zoom: number, maximum: number): number {
    if (!Number.isFinite(zoom)) {
        return MIN_WAVEFORM_ZOOM;
    }

    return clampTime(zoom, MIN_WAVEFORM_ZOOM, maximum);
}

export function getCanvasPixelRatio(ctx: any): any {
    return (function(this: any) {
        const ratio = window.devicePixelRatio;
        if (!Number.isFinite(ratio) || ratio < 1) {
            return 1;
        }

        return ratio;
    
    }).call(ctx);
}

export function wrapWaveformCanvases(ctx: any): any {
    return (function(this: any) {
        if (!this.features.waveform) {
            return;
        }

        const canvases = this.root.querySelectorAll('canvas.waveform');
        canvases.forEach((canvasElement: Element) => {
            if (!(canvasElement instanceof HTMLCanvasElement)) {
                return;
            }

            if (canvasElement.closest('.waveform-wrap')) {
                return;
            }

            const waveformSource = parseWaveformSource(canvasElement.getAttribute('data-waveform-source'));
            const barWidth = parseWaveformBarWidth(canvasElement.getAttribute('data-waveform-bar-width'), 1);
            const maxZoom = parseWaveformMaxZoom(canvasElement.getAttribute('data-waveform-max-zoom'));
            const timerEnabled = parseWaveformTimerEnabled(
                canvasElement.getAttribute('data-waveform-timer'),
                this.features.mode
            );
            const originalHeight = canvasElement.height;

            const wrapper = document.createElement('div');
            wrapper.className = 'waveform-wrap';
            wrapper.setAttribute('style', sanitizeInlineStyle(canvasElement.getAttribute('data-waveform-style')) + '; display: block;');
            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'waveform-scroll';
            const overlay = document.createElement('div');
            overlay.className = 'waveform-overlay';
            const surface = document.createElement('div');
            surface.className = 'waveform-surface';

            const parent = canvasElement.parentElement;
            if (!parent) {
                return;
            }

            parent.insertBefore(wrapper, canvasElement);
            wrapper.appendChild(scrollContainer);
            wrapper.appendChild(overlay);
            scrollContainer.appendChild(surface);
            surface.insertAdjacentHTML(
                'beforeend',
                buildSeekWrap(
                    clampPercent(canvasElement.getAttribute('data-seek-margin-left')),
                    clampPercent(canvasElement.getAttribute('data-seek-margin-right'))
                )
            );

            const tileLayer = document.createElement('div');
            tileLayer.className = 'waveform-tile-layer';
            const seekWrap = surface.querySelector('.seekwrap');
            if (seekWrap instanceof HTMLElement) {
                surface.insertBefore(tileLayer, seekWrap);
            } else {
                surface.appendChild(tileLayer);
            }

            surface.style.height = originalHeight + 'px';
            scrollContainer.style.height = originalHeight + 'px';
            canvasElement.remove();

            if (seekWrap instanceof HTMLElement) {
                seekWrap.setAttribute('data-seek-surface', 'waveform');
                seekWrap.setAttribute('data-waveform-source', String(waveformSource));
                const timingNode = timerEnabled
                    ? this.createWaveformTimingNode(overlay)
                    : null;
                const zoomNode = this.createWaveformZoomNode(overlay);
                this.waveformSeekSurfaces.push({
                    wrapper: wrapper,
                    scrollContainer: scrollContainer,
                    overlay: overlay,
                    surface: surface,
                    tileLayer: tileLayer,
                    seekWrap: seekWrap,
                    waveformSource: waveformSource,
                    originalHeight: originalHeight,
                    barWidth: barWidth,
                    maxZoom: maxZoom,
                    baseWidth: this.resolveWaveformBaseWidth(scrollContainer, canvasElement.width),
                    zoom: MIN_WAVEFORM_ZOOM,
                    timingNode: timingNode,
                    zoomNode: zoomNode,
                    tiles: new Map<number, { canvas: HTMLCanvasElement; lastDrawKey: string | null }>(),
                    normalizationPeak: 1,
                    normalizationCacheKey: null,
                });

                scrollContainer.addEventListener('scroll', () => {
                    this.scheduleVisibleWaveformTileRefresh();
                }, { passive: true });
            }
        });
    
    }).call(ctx);
}

export function createWaveformTimingNode(ctx: any, overlay: any): any {
    return (function(this: any, overlay: any) {
        const timing = document.createElement('div');
        timing.className = 'waveform-timing';
        timing.textContent = '--:--:--:--- / --:--:--:---';
        overlay.appendChild(timing);
        return timing;
    
    }).call(ctx, overlay);
}

export function createWaveformZoomNode(ctx: any, overlay: any): any {
    return (function(this: any, overlay: any) {
        const zoom = document.createElement('div');
        zoom.className = 'waveform-zoom';
        zoom.textContent = 'Zoom: 100%';
        zoom.style.display = 'none';
        overlay.appendChild(zoom);
        return zoom;
    
    }).call(ctx, overlay);
}

export function resolveWaveformBaseWidth(ctx: any, scrollContainer: any, fallback: any): any {
    return (function(this: any, scrollContainer: any, fallback: any) {
        const scrollWidth = scrollContainer.clientWidth;
        if (Number.isFinite(scrollWidth) && scrollWidth > 0) {
            return Math.max(1, Math.round(scrollWidth));
        }

        if (Number.isFinite(fallback) && fallback > 0) {
            return Math.max(1, Math.round(fallback));
        }

        return 1;
    
    }).call(ctx, scrollContainer, fallback);
}

export function setWaveformSurfaceWidth(ctx: any, surfaceMetadata: any): any {
    return (function(this: any, surfaceMetadata: any) {
        const width = Math.max(1, Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom));
        surfaceMetadata.surface.style.width = width + 'px';
        surfaceMetadata.surface.style.height = surfaceMetadata.originalHeight + 'px';
        surfaceMetadata.tileLayer.style.height = surfaceMetadata.originalHeight + 'px';
    
    }).call(ctx, surfaceMetadata);
}

export function forEachVisibleWaveformTile(ctx: any, surfaceMetadata: any, pixelRatio: any, callback: any): any {
    return (function(this: any, surfaceMetadata: any, pixelRatio: any, callback: any) {
        const surfaceWidth = Math.max(1, Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom));
        const viewportWidth = Math.max(1, surfaceMetadata.scrollContainer.clientWidth);
        const scrollLeft = clampTime(surfaceMetadata.scrollContainer.scrollLeft, 0, Math.max(0, surfaceWidth - viewportWidth));
        const bufferPx = viewportWidth;
        const visibleStart = Math.max(0, scrollLeft - bufferPx);
        const visibleEnd = Math.min(surfaceWidth, scrollLeft + viewportWidth + bufferPx);
        const tileWidth = WAVEFORM_TILE_WIDTH_PX;
        const firstTile = Math.max(0, Math.floor(visibleStart / tileWidth));
        const lastTile = Math.max(firstTile, Math.floor(Math.max(0, visibleEnd - 1) / tileWidth));

        const needed = new Set<number>();
        for (let tileIndex = firstTile; tileIndex <= lastTile; tileIndex += 1) {
            const tileStartPx = tileIndex * tileWidth;
            if (tileStartPx >= surfaceWidth) {
                break;
            }

            const tileCssWidth = Math.max(1, Math.min(tileWidth, surfaceWidth - tileStartPx));
            let tileRecord = surfaceMetadata.tiles.get(tileIndex);
            let isNew = false;
            if (!tileRecord) {
                const tileCanvas = document.createElement('canvas');
                tileCanvas.className = 'waveform waveform-tile';
                tileCanvas.style.position = 'absolute';
                tileCanvas.style.top = '0';
                tileCanvas.style.display = 'block';
                surfaceMetadata.tileLayer.appendChild(tileCanvas);
                tileRecord = { canvas: tileCanvas, lastDrawKey: null };
                surfaceMetadata.tiles.set(tileIndex, tileRecord);
                isNew = true;
            }

            const tileCanvas = tileRecord.canvas;

            tileCanvas.style.left = tileStartPx + 'px';
            tileCanvas.style.width = tileCssWidth + 'px';
            tileCanvas.style.height = surfaceMetadata.originalHeight + 'px';

            const renderWidth = Math.max(1, Math.round(tileCssWidth * pixelRatio));
            const renderHeight = Math.max(1, Math.round(surfaceMetadata.originalHeight * pixelRatio));
            if (tileCanvas.width !== renderWidth) {
                tileCanvas.width = renderWidth;
            }
            if (tileCanvas.height !== renderHeight) {
                tileCanvas.height = renderHeight;
            }

            const context = tileCanvas.getContext('2d');
            if (!context) {
                continue;
            }

            const renderBarWidth = Math.max(1, Math.round(surfaceMetadata.barWidth * pixelRatio));
            callback({
                tileIndex,
                tileStartPx,
                tileCssWidth,
                surfaceWidth,
                canvas: tileCanvas,
                context,
                renderBarWidth,
                isNew,
                record: tileRecord,
            });
            needed.add(tileIndex);
        }

        const existingTileIndexes = Array.from(surfaceMetadata.tiles.keys()) as number[];
        existingTileIndexes.forEach((tileIndex: number) => {
            if (needed.has(tileIndex)) {
                return;
            }

            const tileRecord = surfaceMetadata.tiles.get(tileIndex);
            if (tileRecord) {
                tileRecord.canvas.remove();
            }
            surfaceMetadata.tiles.delete(tileIndex);
        });
    
    }).call(ctx, surfaceMetadata, pixelRatio, callback);
}

export function scheduleVisibleWaveformTileRefresh(ctx: any): any {
    return (function(this: any) {
        if (this.waveformTileRefreshFrameId !== null) {
            return;
        }

        this.waveformTileRefreshFrameId = requestAnimationFrame(() => {
            this.waveformTileRefreshFrameId = null;
            this.refreshVisibleWaveformTilesFromLatestInput();
        });
    
    }).call(ctx);
}

export function refreshVisibleWaveformTilesFromLatestInput(ctx: any): any {
    return (function(this: any) {
        const latestInput = this.latestWaveformRenderInput;
        if (!latestInput) {
            return;
        }

        this.renderWaveformsInternal(
            latestInput.waveformEngine,
            latestInput.runtimes,
            latestInput.timelineDuration,
            latestInput.trackTimelineProjector,
            latestInput.waveformTimelineContext,
            false,
            false
        );
    
    }).call(ctx);
}

export function computeNormalizationPeak(ctx: any, waveformEngine: any, sourceRuntimes: any, renderBarWidth: any, duration: any, baseProjector: any, baseWidth: any): any {
    return (function(this: any, waveformEngine: any, sourceRuntimes: any, renderBarWidth: any, duration: any, baseProjector: any, baseWidth: any) {
        if (!Number.isFinite(duration) || duration <= 0 || sourceRuntimes.length === 0) {
            return 1;
        }

        const normalizationPeakCount = Math.max(256, Math.min(4096, Math.round(baseWidth)));
        const mixed = waveformEngine.calculateMixedWaveform(
            sourceRuntimes,
            normalizationPeakCount,
            renderBarWidth,
            duration,
            baseProjector
        );
        if (!mixed || mixed.length === 0) {
            return 1;
        }

        let maxPeak = 0;
        for (let index = 0; index < mixed.length; index += 1) {
            if (mixed[index] > maxPeak) {
                maxPeak = mixed[index];
            }
        }

        return maxPeak > 0 ? maxPeak : 1;
    
    }).call(ctx, waveformEngine, sourceRuntimes, renderBarWidth, duration, baseProjector, baseWidth);
}

export function buildWaveformNormalizationCacheKey(ctx: any, surfaceMetadata: any, runtimes: any, sourceRuntimes: any, fullDuration: any, renderBarWidth: any, useLocalAxis: any, hasTimelineProjector: any): any {
    return (function(this: any, surfaceMetadata: any, runtimes: any, sourceRuntimes: any, fullDuration: any, renderBarWidth: any, useLocalAxis: any, hasTimelineProjector: any) {
        const sourceKey = surfaceMetadata.waveformSource === 'audible'
            ? runtimes.map((runtime: TrackRuntime, index: number) => {
                const duration = runtime.buffer ? runtime.buffer.duration : 0;
                const timingDuration = runtime.timing ? runtime.timing.effectiveDuration : 0;
                return [
                    index,
                    runtime.state.solo ? 1 : 0,
                    Math.round(duration * 1000),
                    Math.round(timingDuration * 1000),
                ].join(':');
            }).join('|')
            : sourceRuntimes.map((runtime: TrackRuntime, index: number) => {
                const duration = runtime.buffer ? runtime.buffer.duration : 0;
                const timingDuration = runtime.timing ? runtime.timing.effectiveDuration : 0;
                return [
                    index,
                    Math.round(duration * 1000),
                    Math.round(timingDuration * 1000),
                ].join(':');
            }).join('|');

        return [
            String(surfaceMetadata.waveformSource),
            useLocalAxis ? 'local' : 'reference',
            hasTimelineProjector ? 'projector' : 'identity',
            Math.round(fullDuration * 1000),
            renderBarWidth,
            Math.round(surfaceMetadata.baseWidth),
            sourceKey,
        ].join('#');
    
    }).call(ctx, surfaceMetadata, runtimes, sourceRuntimes, fullDuration, renderBarWidth, useLocalAxis, hasTimelineProjector);
}

export function findWaveformSurface(ctx: any, seekWrap: any): any {
    return (function(this: any, seekWrap: any) {
        if (!seekWrap) {
            return null;
        }

        for (let index = 0; index < this.waveformSeekSurfaces.length; index += 1) {
            const entry = this.waveformSeekSurfaces[index];
            if (entry.seekWrap === seekWrap) {
                return entry;
            }
        }

        return null;
    
    }).call(ctx, seekWrap);
}

export function reflowWaveforms(ctx: any): any {
    return (function(this: any) {
        this.waveformSeekSurfaces.forEach((surfaceMetadata: WaveformSeekSurfaceMetadata) => {
            const previousSurfaceWidth = Math.max(
                1,
                Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
            );
            const viewportCenter = surfaceMetadata.scrollContainer.clientWidth / 2;
            const centerRatio = previousSurfaceWidth > 0
                ? (surfaceMetadata.scrollContainer.scrollLeft + viewportCenter) / previousSurfaceWidth
                : 0;

            surfaceMetadata.baseWidth = this.resolveWaveformBaseWidth(
                surfaceMetadata.scrollContainer,
                surfaceMetadata.baseWidth
            );
            this.setWaveformSurfaceWidth(surfaceMetadata);

            const nextSurfaceWidth = Math.max(
                1,
                Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
            );
            const maxScrollLeft = Math.max(0, nextSurfaceWidth - surfaceMetadata.scrollContainer.clientWidth);
            const nextScrollLeft = (centerRatio * nextSurfaceWidth) - viewportCenter;
            surfaceMetadata.scrollContainer.scrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
        });
    
    }).call(ctx);
}

export function getWaveformZoom(ctx: any, seekWrap: any): any {
    return (function(this: any, seekWrap: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return null;
        }

        return surfaceMetadata.zoom;
    
    }).call(ctx, seekWrap);
}

export function isWaveformZoomEnabled(ctx: any, seekWrap: any): any {
    return (function(this: any, seekWrap: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        return surfaceMetadata.maxZoom > MIN_WAVEFORM_ZOOM;
    
    }).call(ctx, seekWrap);
}

export function setWaveformZoom(ctx: any, seekWrap: any, zoom: any, anchorPageX: any): any {
    return (function(this: any, seekWrap: any, zoom: any, anchorPageX: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        const nextZoom = clampWaveformZoom(zoom, surfaceMetadata.maxZoom);
        if (Math.abs(nextZoom - surfaceMetadata.zoom) < 0.000001) {
            return false;
        }

        const previousSurfaceWidth = Math.max(
            1,
            Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
        );
        const wrapperRect = surfaceMetadata.scrollContainer.getBoundingClientRect();
        const wrapperWidth = Math.max(1, surfaceMetadata.scrollContainer.clientWidth);
        const anchorWithinWrapper = Number.isFinite(anchorPageX)
            ? clampTime((anchorPageX as number) - (wrapperRect.left + window.scrollX), 0, wrapperWidth)
            : (wrapperWidth / 2);
        const anchorRatio = previousSurfaceWidth > 0
            ? (surfaceMetadata.scrollContainer.scrollLeft + anchorWithinWrapper) / previousSurfaceWidth
            : 0;

        surfaceMetadata.zoom = nextZoom;
        this.setWaveformSurfaceWidth(surfaceMetadata);

        const nextSurfaceWidth = Math.max(
            1,
            Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
        );
        const maxScrollLeft = Math.max(0, nextSurfaceWidth - surfaceMetadata.scrollContainer.clientWidth);
        const nextScrollLeft = (anchorRatio * nextSurfaceWidth) - anchorWithinWrapper;
        surfaceMetadata.scrollContainer.scrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
        return true;
    
    }).call(ctx, seekWrap, zoom, anchorPageX);
}

export function drawDummyWaveforms(ctx: any, waveformEngine: any): any {
    return (function(this: any, waveformEngine: any) {
        if (!this.features.waveform || this.waveformSeekSurfaces.length === 0) {
            return;
        }

        this.reflowWaveforms();

        const pixelRatio = this.getCanvasPixelRatio();

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            this.forEachVisibleWaveformTile(surfaceMetadata, pixelRatio, (tile: {
                canvas: HTMLCanvasElement;
                context: CanvasRenderingContext2D;
                renderBarWidth: number;
            }) => {
                waveformEngine.drawPlaceholder(tile.canvas, tile.context, tile.renderBarWidth, 0.3);
            });
        }
    
    }).call(ctx, waveformEngine);
}

export function renderWaveforms(ctx: any, waveformEngine: any, runtimes: any, timelineDuration: any, trackTimelineProjector: any, waveformTimelineContext: any): any {
    return (function(this: any, waveformEngine: any, runtimes: any, timelineDuration: any, trackTimelineProjector: any, waveformTimelineContext: any) {
        this.latestWaveformRenderInput = {
            waveformEngine,
            runtimes,
            timelineDuration,
            trackTimelineProjector,
            waveformTimelineContext,
        };

        this.renderWaveformsInternal(
            waveformEngine,
            runtimes,
            timelineDuration,
            trackTimelineProjector,
            waveformTimelineContext,
            true
        );
    
    }).call(ctx, waveformEngine, runtimes, timelineDuration, trackTimelineProjector, waveformTimelineContext);
}

export function renderWaveformsInternal(ctx: any, waveformEngine: any, runtimes: any, timelineDuration: any, trackTimelineProjector: any, waveformTimelineContext: any, performReflow: any, forceRedrawVisibleTiles: any): any {
    return (function(this: any, waveformEngine: any, runtimes: any, timelineDuration: any, trackTimelineProjector: any, waveformTimelineContext: any, performReflow: any, forceRedrawVisibleTiles: any) {
        if (!this.features.waveform || this.waveformSeekSurfaces.length === 0) {
            return;
        }

        if (performReflow) {
            this.reflowWaveforms();
        }

        const pixelRatio = this.getCanvasPixelRatio();
        const safeTimelineDuration = Number.isFinite(timelineDuration) && timelineDuration > 0 ? timelineDuration : 0;

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            const waveformSource = surfaceMetadata.waveformSource;
            const sourceRuntimes = this.getWaveformSourceRuntimes(runtimes, waveformSource);
            const fixedWaveformTrackIndex = this.resolveWaveformTrackIndex(runtimes, waveformSource);
            const localTrackDuration = fixedWaveformTrackIndex === null || !waveformTimelineContext
                ? 0
                : sanitizeDuration(waveformTimelineContext.getTrackDuration(fixedWaveformTrackIndex));
            const useLocalAxis = !!waveformTimelineContext
                && waveformTimelineContext.enabled
                && fixedWaveformTrackIndex !== null
                && localTrackDuration > 0;
            const fullDuration = useLocalAxis ? localTrackDuration : safeTimelineDuration;
            const baseProjector: TrackTimelineProjector = useLocalAxis
                ? ((_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds)
                : (trackTimelineProjector || ((_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds));

            const surfaceRenderBarWidth = Math.max(1, Math.round(surfaceMetadata.barWidth * pixelRatio));
            const normalizationCacheKey = this.buildWaveformNormalizationCacheKey(
                surfaceMetadata,
                runtimes,
                sourceRuntimes,
                fullDuration,
                surfaceRenderBarWidth,
                useLocalAxis,
                !useLocalAxis && !!trackTimelineProjector
            );

            if (surfaceMetadata.normalizationCacheKey !== normalizationCacheKey) {
                surfaceMetadata.normalizationPeak = this.computeNormalizationPeak(
                    waveformEngine,
                    sourceRuntimes,
                    surfaceRenderBarWidth,
                    fullDuration,
                    baseProjector,
                    surfaceMetadata.baseWidth
                );
                surfaceMetadata.normalizationCacheKey = normalizationCacheKey;
            }

            const normalizationPeak = surfaceMetadata.normalizationPeak;

            this.forEachVisibleWaveformTile(surfaceMetadata, pixelRatio, (tile: {
                tileStartPx: number;
                tileCssWidth: number;
                surfaceWidth: number;
                canvas: HTMLCanvasElement;
                context: CanvasRenderingContext2D;
                renderBarWidth: number;
                isNew: boolean;
                record: { lastDrawKey: string | null };
            }) => {
                const tileDrawKey = [
                    normalizationCacheKey,
                    Math.round(tile.tileStartPx),
                    Math.round(tile.tileCssWidth),
                    tile.canvas.width,
                    tile.canvas.height,
                    tile.renderBarWidth,
                ].join('#');

                if (!forceRedrawVisibleTiles && !tile.isNew && tile.record.lastDrawKey === tileDrawKey) {
                    return;
                }

                const peakCount = Math.max(1, Math.floor(tile.canvas.width / tile.renderBarWidth));
                if (fullDuration <= 0) {
                    waveformEngine.drawPlaceholder(tile.canvas, tile.context, tile.renderBarWidth, 0.3);
                    tile.record.lastDrawKey = tileDrawKey;
                    return;
                }

                const tileStartTime = fullDuration * (tile.tileStartPx / tile.surfaceWidth);
                const tileDuration = fullDuration * (tile.tileCssWidth / tile.surfaceWidth);
                if (!Number.isFinite(tileDuration) || tileDuration <= 0) {
                    waveformEngine.drawPlaceholder(tile.canvas, tile.context, tile.renderBarWidth, 0.3);
                    tile.record.lastDrawKey = tileDrawKey;
                    return;
                }

                const tileProjector: TrackTimelineProjector = (runtime, trackTimelineTimeSeconds) => {
                    const mapped = baseProjector(runtime, trackTimelineTimeSeconds);
                    if (!Number.isFinite(mapped)) {
                        return NaN;
                    }
                    return mapped - tileStartTime;
                };

                const mixed = waveformEngine.calculateMixedWaveform(
                    sourceRuntimes,
                    peakCount,
                    tile.renderBarWidth,
                    tileDuration,
                    tileProjector
                );

                if (!mixed) {
                    waveformEngine.drawPlaceholder(tile.canvas, tile.context, tile.renderBarWidth, 0.3);
                    tile.record.lastDrawKey = tileDrawKey;
                    return;
                }

                waveformEngine.drawWaveform(
                    tile.canvas,
                    tile.context,
                    mixed,
                    tile.renderBarWidth,
                    normalizationPeak
                );
                tile.record.lastDrawKey = tileDrawKey;
            });
        }
    
    }).call(ctx, waveformEngine, runtimes, timelineDuration, trackTimelineProjector, waveformTimelineContext, performReflow, forceRedrawVisibleTiles);
}

export function getWaveformSourceRuntimes(ctx: any, runtimes: any, waveformSource: any): any {
    return (function(this: any, runtimes: any, waveformSource: any) {
        const trackIndex = this.resolveWaveformTrackIndex(runtimes, waveformSource);
        if (trackIndex === null) {
            return runtimes;
        }

        const selected = runtimes[trackIndex];

        return [{
            ...selected,
            state: {
                solo: false,
                volume: selected.state.volume,
                pan: selected.state.pan,
            },
        }];
    
    }).call(ctx, runtimes, waveformSource);
}

export function resolveWaveformTrackIndex(ctx: any, runtimes: any, waveformSource: any): any {
    return (function(this: any, runtimes: any, waveformSource: any) {
        if (waveformSource === 'audible') {
            return null;
        }

        if (!Number.isFinite(waveformSource) || waveformSource < 0 || waveformSource >= runtimes.length) {
            return null;
        }

        return Math.floor(waveformSource);
    
    }).call(ctx, runtimes, waveformSource);
}

export function updateWaveformZoomIndicators(ctx: any): any {
    return (function(this: any) {
        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            const zoomPercent = Math.round(clampWaveformZoom(surface.zoom, surface.maxZoom) * 100);
            if (zoomPercent === 100) {
                surface.zoomNode.style.display = 'none';
                return;
            }

            surface.zoomNode.textContent = 'Zoom: ' + zoomPercent + '%';
            surface.zoomNode.style.display = 'block';
        });
    
    }).call(ctx);
}

export function applyFixedWaveformLocalSeekVisuals(ctx: any, state: any, waveformTimelineContext: any): any {
    return (function(this: any, state: any, waveformTimelineContext: any) {
        if (!waveformTimelineContext || !waveformTimelineContext.enabled) {
            return;
        }

        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            if (surface.waveformSource === 'audible') {
                return;
            }

            const trackIndex = surface.waveformSource;
            const trackDuration = sanitizeDuration(waveformTimelineContext.getTrackDuration(trackIndex));
            if (trackDuration <= 0) {
                return;
            }

            const localPosition = clampTime(
                waveformTimelineContext.referenceToTrackTime(trackIndex, state.position),
                0,
                trackDuration
            );
            const localPointA = state.loop.pointA === null
                ? null
                : clampTime(waveformTimelineContext.referenceToTrackTime(trackIndex, state.loop.pointA), 0, trackDuration);
            const localPointB = state.loop.pointB === null
                ? null
                : clampTime(waveformTimelineContext.referenceToTrackTime(trackIndex, state.loop.pointB), 0, trackDuration);

            let orderedPointA = localPointA;
            let orderedPointB = localPointB;
            if (orderedPointA !== null && orderedPointB !== null && orderedPointA > orderedPointB) {
                const previousA = orderedPointA;
                orderedPointA = orderedPointB;
                orderedPointB = previousA;
            }

            this.updateSeekWrapVisuals(surface.seekWrap, localPosition, trackDuration, {
                pointA: orderedPointA,
                pointB: orderedPointB,
                enabled: state.loop.enabled,
            });
        });
    
    }).call(ctx, state, waveformTimelineContext);
}

export function getLongestWaveformSourceDuration(ctx: any, runtimes: any, waveformSource: any): any {
    return (function(this: any, runtimes: any, waveformSource: any) {
        const getRuntimeDuration = (runtime: TrackRuntime): number => {
            return runtime.timing
                ? runtime.timing.effectiveDuration
                : (runtime.buffer ? runtime.buffer.duration : 0);
        };

        if (waveformSource === 'audible') {
            // For audible source, find longest among all tracks
            let longest = 0;
            runtimes.forEach(function(runtime: TrackRuntime) {
                const duration = getRuntimeDuration(runtime);
                if (duration > longest) {
                    longest = duration;
                }
            });
            return longest;
        } else {
            // For fixed track source, return that track's duration
            const trackIndex = Math.floor(waveformSource);
            if (trackIndex >= 0 && trackIndex < runtimes.length) {
                return getRuntimeDuration(runtimes[trackIndex]);
            }
            return 0;
        }
    
    }).call(ctx, runtimes, waveformSource);
}

export function updateWaveformTiming(ctx: any, state: any, runtimes: any, waveformTimelineContext: any): any {
    return (function(this: any, state: any, runtimes: any, waveformTimelineContext: any) {
        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            if (!surface.timingNode) {
                return;
            }

            let position = state.position;
            let duration = this.getLongestWaveformSourceDuration(runtimes, surface.waveformSource);

            if (
                waveformTimelineContext
                && waveformTimelineContext.enabled
                && surface.waveformSource !== 'audible'
            ) {
                const trackDuration = sanitizeDuration(
                    waveformTimelineContext.getTrackDuration(surface.waveformSource)
                );
                if (trackDuration > 0) {
                    duration = trackDuration;
                    position = clampTime(
                        waveformTimelineContext.referenceToTrackTime(surface.waveformSource, state.position),
                        0,
                        trackDuration
                    );
                } else {
                    duration = 0;
                    position = 0;
                }
            }

            const safeDuration = sanitizeDuration(duration);
            const safePosition = safeDuration > 0
                ? clampTime(position, 0, safeDuration)
                : 0;
            surface.timingNode.textContent = formatSecondsToHHMMSSmmm(safePosition)
                + ' / '
                + formatSecondsToHHMMSSmmm(safeDuration);
        });
    
    }).call(ctx, state, runtimes, waveformTimelineContext);
}

export function updateSeekWrapVisuals(ctx: any, seekWrap: any, position: any, duration: any, loop: any): any {
    return (function(this: any, seekWrap: any, position: any, duration: any, loop: any) {
        const safeDuration = sanitizeDuration(duration);
        const safePosition = safeDuration > 0
            ? clampTime(position, 0, safeDuration)
            : 0;
        const seekhead = seekWrap.querySelector('.seekhead');
        if (seekhead) {
            const seekPercent = safeDuration > 0
                ? clampPercent((safePosition / safeDuration) * 100)
                : 0;
            setLeftPercent(seekhead, seekPercent);
        }

        if (!this.features.looping) {
            return;
        }

        const markerA = seekWrap.querySelector('.loop-marker.marker-a');
        if (markerA && loop.pointA !== null && safeDuration > 0) {
            const pointAPerc = clampPercent((clampTime(loop.pointA, 0, safeDuration) / safeDuration) * 100);
            setLeftPercent(markerA, pointAPerc);
            setDisplay(markerA, 'block');
        } else if (markerA) {
            setDisplay(markerA, 'none');
        }

        const markerB = seekWrap.querySelector('.loop-marker.marker-b');
        if (markerB && loop.pointB !== null && safeDuration > 0) {
            const pointBPerc = clampPercent((clampTime(loop.pointB, 0, safeDuration) / safeDuration) * 100);
            setLeftPercent(markerB, pointBPerc);
            setDisplay(markerB, 'block');
        } else if (markerB) {
            setDisplay(markerB, 'none');
        }

        const loopRegion = seekWrap.querySelector('.loop-region');
        if (
            loopRegion
            && loop.pointA !== null
            && loop.pointB !== null
            && safeDuration > 0
        ) {
            const orderedPointA = Math.min(loop.pointA, loop.pointB);
            const orderedPointB = Math.max(loop.pointA, loop.pointB);
            const pointAPerc = clampPercent((clampTime(orderedPointA, 0, safeDuration) / safeDuration) * 100);
            const pointBPerc = clampPercent((clampTime(orderedPointB, 0, safeDuration) / safeDuration) * 100);

            setLeftPercent(loopRegion, pointAPerc);
            setWidthPercent(loopRegion, Math.max(0, pointBPerc - pointAPerc));
            setDisplay(loopRegion, 'block');
            loopRegion.classList.toggle('active', loop.enabled);
        } else if (loopRegion) {
            setDisplay(loopRegion, 'none');
            loopRegion.classList.remove('active');
        }
    
    }).call(ctx, seekWrap, position, duration, loop);
}
