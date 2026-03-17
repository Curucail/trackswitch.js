import {
    TrackRuntime,
    TrackSwitchFeatures,
    WaveformPlaybackFollowMode,
    WaveformSource,
} from '../domain/types';
import { sanitizeInlineStyle } from '../shared/dom';
import { formatSecondsToHHMMSSmmm } from '../shared/format';
import { clampPercent } from '../shared/math';
import { TrackTimelineProjector } from '../engine/waveform-engine';
import {
    parseWaveformSource,
    resolveFixedWaveformTrackIndex,
    resolveWaveformTrackIndices,
    serializeWaveformSource,
} from '../shared/waveform-source';

interface WaveformSeekSurfaceMetadata {
    wrapper: HTMLElement;
    scrollContainer: HTMLElement;
    overlay: HTMLElement;
    surface: HTMLElement;
    tileLayer: HTMLElement;
    seekWrap: HTMLElement;
    waveformSource: WaveformSource;
    playbackFollowMode: WaveformPlaybackFollowMode;
    originalHeight: number;
    barWidth: number;
    maxZoomSeconds: number;
    baseWidth: number;
    zoom: number;
    timingNode: HTMLElement | null;
    zoomNode: HTMLElement;
    zoomMinimapNode: HTMLElement;
    zoomCanvas: HTMLCanvasElement;
    zoomViewportNode: HTMLElement;
    zoomCanvasLastDrawKey: string | null;
    waveformColor: string | null;
    tiles: Map<number, {
        canvas: HTMLCanvasElement;
        context: CanvasRenderingContext2D | null;
        lastDrawKey: string | null;
    }>;
    normalizationPeak: number;
    normalizationCacheKey: string | null;
    alignedPlayhead: boolean;
    refHooksPath: SVGPathElement | null;
    showAlignmentPoints: boolean;
    alignmentPointsGroup: SVGGElement | null;
    alignmentPointsPaths: SVGPathElement[];
    alignmentPointsLastW: number;
    alignmentPointsLastH: number;
}

const MIN_WAVEFORM_ZOOM = 1;
const DEFAULT_MAX_WAVEFORM_ZOOM_SECONDS = 5;
const WAVEFORM_TILE_WIDTH_PX = 1024;
function buildSeekWrap(leftPercent: number, rightPercent: number): string {
    return '<div class="seekwrap" style="left: ' + leftPercent + '%; right: ' + rightPercent + '%;">'
        + '<div class="loop-region"></div>'
        + '<div class="loop-marker marker-a"></div>'
        + '<div class="loop-marker marker-b"></div>'
        + '<div class="seekhead"></div>'
        + '<svg class="seekhead-ref-hooks" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">'
        + '<g class="alignment-points-group"></g>'
        + '</svg>'
        + '</div>';
}

function setDisplay(element: Element, displayValue: string): void {
    (element as HTMLElement).style.display = displayValue;
}

function setLeftPercent(element: Element, value: number): void {
    (element as HTMLElement).style.left = value + '%';
}

function setSeekheadPosition(element: Element, value: number): void {
    (element as HTMLElement).style.left = clampPercent(value) + '%';
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

function sanitizeDuration(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }

    return value;
}

function parseWaveformBarWidth(value: string | null, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }

    return Math.max(1, Math.floor(parsed));
}

function isWaveformTrackAudible(ctx: any, runtimes: TrackRuntime[], trackIndex: number): boolean {
    const runtime = runtimes[trackIndex];
    if (!runtime || runtime.state.volume <= 0) {
        return false;
    }

    if (ctx.features.mode === 'alignment') {
        return true;
    }

    const anySolo = runtimes.some(function(entry: TrackRuntime) {
        return entry.state.solo;
    });

    if (anySolo) {
        return runtime.state.solo;
    }

    return !!ctx.features.exclusiveSolo;
}

function parseWaveformTimerEnabled(value: string | null, mode: TrackSwitchFeatures['mode']): boolean {
    if (value === null) {
        return mode === 'alignment';
    }

    return value.trim().toLowerCase() === 'true';
}

function parseWaveformAlignedPlayheadEnabled(value: string | null): boolean {
    if (value === null) {
        return false;
    }

    return value.trim().toLowerCase() === 'true';
}

function parseWaveformShowAlignmentPointsEnabled(value: string | null): boolean {
    if (value === null) {
        return false;
    }

    return value.trim().toLowerCase() === 'true';
}

function ensureAlignmentPointPaths(group: SVGGElement, paths: SVGPathElement[], count: number): void {
    while (paths.length < count) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        group.appendChild(p);
        paths.push(p);
    }
    for (let i = 0; i < paths.length; i++) {
        paths[i].style.display = i < count ? '' : 'none';
    }
}

function parseWaveformMaxZoom(value: string | null): number {
    if (value === null) {
        return DEFAULT_MAX_WAVEFORM_ZOOM_SECONDS;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return DEFAULT_MAX_WAVEFORM_ZOOM_SECONDS;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_MAX_WAVEFORM_ZOOM_SECONDS;
    }

    return parsed;
}

function parseWaveformPlaybackFollowMode(value: string | null): WaveformPlaybackFollowMode {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';

    if (normalized === 'center' || normalized === 'jump') {
        return normalized;
    }

    return 'off';
}

function clampWaveformZoom(zoom: number, maximum: number): number {
    if (!Number.isFinite(zoom)) {
        return MIN_WAVEFORM_ZOOM;
    }

    return clampTime(zoom, MIN_WAVEFORM_ZOOM, maximum);
}

function resolveWaveformColor(element: HTMLElement): string {
    return getComputedStyle(element).getPropertyValue('--waveform-color').trim() || '#ED8C01';
}

function getWaveformSurfaceWidth(surfaceMetadata: WaveformSeekSurfaceMetadata): number {
    return Math.max(1, Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom));
}

function getWaveformViewportState(
    surfaceMetadata: WaveformSeekSurfaceMetadata
): { startRatio: number; widthRatio: number } {
    const surfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
    const viewportWidth = Math.max(1, surfaceMetadata.scrollContainer.clientWidth);
    const widthRatio = clampTime(viewportWidth / surfaceWidth, 0, 1);
    const maxStartRatio = Math.max(0, 1 - widthRatio);
    const startRatio = clampTime(surfaceMetadata.scrollContainer.scrollLeft / surfaceWidth, 0, maxStartRatio);
    return {
        startRatio: startRatio,
        widthRatio: widthRatio,
    };
}

function updateWaveformMinimapViewport(surfaceMetadata: WaveformSeekSurfaceMetadata): void {
    const minimapWidth = Math.max(1, surfaceMetadata.zoomMinimapNode.clientWidth);
    const viewportState = getWaveformViewportState(surfaceMetadata);
    surfaceMetadata.zoomViewportNode.style.left = (viewportState.startRatio * minimapWidth) + 'px';
    surfaceMetadata.zoomViewportNode.style.width = Math.max(0, viewportState.widthRatio * minimapWidth) + 'px';
}

function resolveWaveformPlaybackMetrics(
    ctx: any,
    surfaceMetadata: WaveformSeekSurfaceMetadata,
    state: { position: number },
    runtimes: TrackRuntime[],
    waveformTimelineContext?: {
        enabled: boolean;
        referenceToTrackTime(trackIndex: number, referenceTime: number): number;
        getTrackDuration(trackIndex: number): number;
    }
): { position: number; duration: number } {
    let position = state.position;
    let duration = ctx.getLongestWaveformSourceDuration(runtimes, surfaceMetadata.waveformSource);
    const fixedTrackIndex = resolveFixedWaveformTrackIndex(runtimes.length, surfaceMetadata.waveformSource);

    if (
        waveformTimelineContext
        && waveformTimelineContext.enabled
        && fixedTrackIndex !== null
    ) {
        const trackDuration = sanitizeDuration(
            waveformTimelineContext.getTrackDuration(fixedTrackIndex)
        );
        if (trackDuration > 0) {
            duration = trackDuration;
            position = clampTime(
                waveformTimelineContext.referenceToTrackTime(fixedTrackIndex, state.position),
                0,
                trackDuration
            );
        } else {
            duration = 0;
            position = 0;
        }
    }

    const safeDuration = sanitizeDuration(duration);
    return {
        position: safeDuration > 0 ? clampTime(position, 0, safeDuration) : 0,
        duration: safeDuration,
    };
}

function resolvePlaybackFollowScrollLeft(
    surfaceMetadata: WaveformSeekSurfaceMetadata,
    playheadRatio: number
): number | null {
    if (surfaceMetadata.playbackFollowMode === 'off') {
        return null;
    }

    const viewportWidth = Math.max(1, surfaceMetadata.scrollContainer.clientWidth);
    const surfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
    const maxScrollLeft = Math.max(0, surfaceWidth - viewportWidth);

    if (maxScrollLeft <= 0) {
        return null;
    }

    const playheadPx = clampTime(playheadRatio, 0, 1) * surfaceWidth;
    const currentScrollLeft = clampTime(surfaceMetadata.scrollContainer.scrollLeft, 0, maxScrollLeft);
    const visibleStart = currentScrollLeft;
    const visibleEnd = currentScrollLeft + viewportWidth;

    if (surfaceMetadata.playbackFollowMode === 'center') {
        return clampTime(playheadPx - (viewportWidth / 2), 0, maxScrollLeft);
    }

    if (playheadPx < visibleStart || playheadPx > visibleEnd) {
        return clampTime(playheadPx, 0, maxScrollLeft);
    }

    return null;
}

function applyWaveformPlaybackFollowScroll(
    ctx: any,
    surfaceMetadata: WaveformSeekSurfaceMetadata,
    nextScrollLeft: number | null
): boolean {
    if (!Number.isFinite(nextScrollLeft)) {
        return false;
    }

    const surfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
    const maxScrollLeft = Math.max(0, surfaceWidth - surfaceMetadata.scrollContainer.clientWidth);
    const clampedScrollLeft = clampTime(nextScrollLeft as number, 0, maxScrollLeft);

    if (Math.abs(clampedScrollLeft - surfaceMetadata.scrollContainer.scrollLeft) < 0.000001) {
        return false;
    }

    surfaceMetadata.scrollContainer.scrollLeft = clampedScrollLeft;
    updateWaveformMinimapViewport(surfaceMetadata);
    ctx.scheduleVisibleWaveformTileRefresh();
    return true;
}

function getWaveformMaximumZoom(surfaceMetadata: WaveformSeekSurfaceMetadata, durationSeconds: number): number {
    const safeDuration = sanitizeDuration(durationSeconds);
    if (safeDuration <= 0 || surfaceMetadata.maxZoomSeconds <= 0) {
        return MIN_WAVEFORM_ZOOM;
    }

    return Math.max(MIN_WAVEFORM_ZOOM, safeDuration / surfaceMetadata.maxZoomSeconds);
}

function setWaveformZoomForSurface(
    surfaceMetadata: WaveformSeekSurfaceMetadata,
    zoom: number,
    maximum: number,
    anchorPageX?: number
): boolean {
    const nextZoom = clampWaveformZoom(zoom, maximum);
    if (Math.abs(nextZoom - surfaceMetadata.zoom) < 0.000001) {
        updateWaveformMinimapViewport(surfaceMetadata);
        return false;
    }

    const previousSurfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
    const wrapperRect = surfaceMetadata.scrollContainer.getBoundingClientRect();
    const wrapperWidth = Math.max(1, surfaceMetadata.scrollContainer.clientWidth);
    const anchorWithinWrapper = Number.isFinite(anchorPageX)
        ? clampTime((anchorPageX as number) - (wrapperRect.left + window.scrollX), 0, wrapperWidth)
        : (wrapperWidth / 2);
    const anchorRatio = previousSurfaceWidth > 0
        ? (surfaceMetadata.scrollContainer.scrollLeft + anchorWithinWrapper) / previousSurfaceWidth
        : 0;

    surfaceMetadata.zoom = nextZoom;
    const nextSurfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
    surfaceMetadata.surface.style.width = nextSurfaceWidth + 'px';
    surfaceMetadata.surface.style.height = surfaceMetadata.originalHeight + 'px';
    surfaceMetadata.tileLayer.style.height = surfaceMetadata.originalHeight + 'px';

    const maxScrollLeft = Math.max(0, nextSurfaceWidth - surfaceMetadata.scrollContainer.clientWidth);
    const nextScrollLeft = (anchorRatio * nextSurfaceWidth) - anchorWithinWrapper;
    surfaceMetadata.scrollContainer.scrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
    updateWaveformMinimapViewport(surfaceMetadata);
    return true;
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
            const maxZoomSeconds = parseWaveformMaxZoom(canvasElement.getAttribute('data-waveform-max-zoom'));
            const playbackFollowMode = parseWaveformPlaybackFollowMode(
                canvasElement.getAttribute('data-waveform-playback-follow-mode')
            );
            const timerEnabled = parseWaveformTimerEnabled(
                canvasElement.getAttribute('data-waveform-timer'),
                this.features.mode
            );
            const alignedPlayhead = parseWaveformAlignedPlayheadEnabled(
                canvasElement.getAttribute('data-waveform-aligned-playhead')
            );
            const showAlignmentPoints = parseWaveformShowAlignmentPointsEnabled(
                canvasElement.getAttribute('data-waveform-show-alignment-points')
            );
            const originalHeight = canvasElement.height;

            const wrapper = document.createElement('div');
            wrapper.className = 'waveform-wrap ts-stack-section';
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
                seekWrap.setAttribute('data-waveform-source', serializeWaveformSource(waveformSource));
                const timingNode = timerEnabled
                    ? this.createWaveformTimingNode(overlay)
                    : null;
                const refHooksSvgEl = seekWrap.querySelector('.seekhead-ref-hooks');
                let refHooksPath: SVGPathElement | null = null;
                let alignmentPointsGroup: SVGGElement | null = null;
                if (refHooksSvgEl instanceof SVGSVGElement) {
                    alignmentPointsGroup = refHooksSvgEl.querySelector('.alignment-points-group') as SVGGElement | null;
                    refHooksPath = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
                    refHooksSvgEl.appendChild(refHooksPath);
                }
                const zoomNode = this.createWaveformZoomNode(overlay);
                const zoomMinimapNode = zoomNode.querySelector('.waveform-zoom-minimap');
                const zoomCanvas = zoomNode.querySelector('.waveform-zoom-canvas');
                const zoomViewportNode = zoomNode.querySelector('.waveform-zoom-viewport');
                if (
                    !(zoomMinimapNode instanceof HTMLElement)
                    || !(zoomCanvas instanceof HTMLCanvasElement)
                    || !(zoomViewportNode instanceof HTMLElement)
                ) {
                    return;
                }
                this.waveformSeekSurfaces.push({
                    wrapper: wrapper,
                    scrollContainer: scrollContainer,
                    overlay: overlay,
                    surface: surface,
                    tileLayer: tileLayer,
                    seekWrap: seekWrap,
                    waveformSource: waveformSource,
                    playbackFollowMode: playbackFollowMode,
                    originalHeight: originalHeight,
                    barWidth: barWidth,
                    maxZoomSeconds: maxZoomSeconds,
                    baseWidth: this.resolveWaveformBaseWidth(scrollContainer, canvasElement.width),
                    zoom: MIN_WAVEFORM_ZOOM,
                    timingNode: timingNode,
                    zoomNode: zoomNode,
                    zoomMinimapNode: zoomMinimapNode,
                    zoomCanvas: zoomCanvas,
                    zoomViewportNode: zoomViewportNode,
                    zoomCanvasLastDrawKey: null,
                    waveformColor: null,
                    tiles: new Map<number, {
                        canvas: HTMLCanvasElement;
                        context: CanvasRenderingContext2D | null;
                        lastDrawKey: string | null;
                    }>(),
                    normalizationPeak: 1,
                    normalizationCacheKey: null,
                    alignedPlayhead: alignedPlayhead,
                    refHooksPath: refHooksPath,
                    showAlignmentPoints: showAlignmentPoints,
                    alignmentPointsGroup: alignmentPointsGroup,
                    alignmentPointsPaths: [],
                    alignmentPointsLastW: -1,
                    alignmentPointsLastH: -1,
                });

                scrollContainer.addEventListener('scroll', () => {
                    const currentSurface = this.findWaveformSurface(seekWrap);
                    if (currentSurface) {
                        updateWaveformMinimapViewport(currentSurface);
                    }
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
        zoom.innerHTML = '<span class="waveform-zoom-label">Zoom</span>'
            + '<div class="waveform-zoom-minimap">'
            + '<canvas class="waveform-zoom-canvas"></canvas>'
            + '<div class="waveform-zoom-viewport"></div>'
            + '</div>';
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
        const width = getWaveformSurfaceWidth(surfaceMetadata);
        surfaceMetadata.surface.style.width = width + 'px';
        surfaceMetadata.surface.style.height = surfaceMetadata.originalHeight + 'px';
        surfaceMetadata.tileLayer.style.height = surfaceMetadata.originalHeight + 'px';
        updateWaveformMinimapViewport(surfaceMetadata);
    
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
                tileRecord = { canvas: tileCanvas, context: null, lastDrawKey: null };
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

            const context = tileRecord.context || tileCanvas.getContext('2d');
            if (!context) {
                continue;
            }
            tileRecord.context = context;

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
        const sourceKey = runtimes.map((runtime: TrackRuntime, index: number) => {
            const duration = runtime.buffer ? runtime.buffer.duration : 0;
            const timingDuration = runtime.timing ? runtime.timing.effectiveDuration : 0;
            const selected = sourceRuntimes.indexOf(runtime) !== -1 ? 1 : 0;
            return [
                index,
                selected,
                runtime.state.solo ? 1 : 0,
                Math.round(runtime.state.volume * 1000),
                Math.round(duration * 1000),
                Math.round(timingDuration * 1000),
            ].join(':');
        }).join('|');

        return [
            serializeWaveformSource(surfaceMetadata.waveformSource),
            useLocalAxis ? 'local' : 'reference',
            hasTimelineProjector ? 'projector' : 'identity',
            Math.round(fullDuration * 1000),
            renderBarWidth,
            Math.round(surfaceMetadata.baseWidth),
            sourceKey,
        ].join('#');
    
    }).call(ctx, surfaceMetadata, runtimes, sourceRuntimes, fullDuration, renderBarWidth, useLocalAxis, hasTimelineProjector);
}

function renderWaveformMinimap(
    surfaceMetadata: WaveformSeekSurfaceMetadata,
    waveformEngine: any,
    sourceRuntimes: TrackRuntime[],
    fullDuration: number,
    baseProjector: TrackTimelineProjector,
    normalizationPeak: number,
    normalizationCacheKey: string,
    pixelRatio: number
): void {
    if (surfaceMetadata.zoom <= (MIN_WAVEFORM_ZOOM + 0.000001)) {
        return;
    }

    const waveformColor = surfaceMetadata.waveformColor || resolveWaveformColor(surfaceMetadata.surface);
    surfaceMetadata.waveformColor = waveformColor;

    const cssWidth = Math.max(1, Math.round(surfaceMetadata.zoomMinimapNode.clientWidth));
    const cssHeight = Math.max(1, Math.round(surfaceMetadata.zoomMinimapNode.clientHeight));
    const renderWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
    const renderHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
    const canvas = surfaceMetadata.zoomCanvas;
    if (canvas.width !== renderWidth) {
        canvas.width = renderWidth;
    }
    if (canvas.height !== renderHeight) {
        canvas.height = renderHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) {
        return;
    }

    const drawKey = [
        normalizationCacheKey,
        'minimap',
        renderWidth,
        renderHeight,
    ].join('#');
    if (surfaceMetadata.zoomCanvasLastDrawKey === drawKey) {
        return;
    }

    if (fullDuration <= 0) {
        waveformEngine.drawPlaceholder(canvas, context, 1, 0.2, waveformColor);
        surfaceMetadata.zoomCanvasLastDrawKey = drawKey;
        return;
    }

    const mixed = waveformEngine.calculateMixedWaveform(
        sourceRuntimes,
        renderWidth,
        1,
        fullDuration,
        baseProjector
    );
    if (!mixed) {
        waveformEngine.drawPlaceholder(canvas, context, 1, 0.2, waveformColor);
        surfaceMetadata.zoomCanvasLastDrawKey = drawKey;
        return;
    }

    waveformEngine.drawWaveform(canvas, context, mixed, 1, normalizationPeak, waveformColor);
    surfaceMetadata.zoomCanvasLastDrawKey = drawKey;
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
            const previousSurfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
            const viewportCenter = surfaceMetadata.scrollContainer.clientWidth / 2;
            const centerRatio = previousSurfaceWidth > 0
                ? (surfaceMetadata.scrollContainer.scrollLeft + viewportCenter) / previousSurfaceWidth
                : 0;

            surfaceMetadata.baseWidth = this.resolveWaveformBaseWidth(
                surfaceMetadata.scrollContainer,
                surfaceMetadata.baseWidth
            );
            this.setWaveformSurfaceWidth(surfaceMetadata);

            const nextSurfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
            const maxScrollLeft = Math.max(0, nextSurfaceWidth - surfaceMetadata.scrollContainer.clientWidth);
            const nextScrollLeft = (centerRatio * nextSurfaceWidth) - viewportCenter;
            surfaceMetadata.scrollContainer.scrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
            updateWaveformMinimapViewport(surfaceMetadata);
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

export function isWaveformZoomEnabled(ctx: any, seekWrap: any, durationSeconds: any): any {
    return (function(this: any, seekWrap: any, durationSeconds: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        return getWaveformMaximumZoom(surfaceMetadata, durationSeconds) > MIN_WAVEFORM_ZOOM;
    
    }).call(ctx, seekWrap, durationSeconds);
}

export function getWaveformMinimapViewport(ctx: any, seekWrap: any): any {
    return (function(this: any, seekWrap: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return null;
        }

        return getWaveformViewportState(surfaceMetadata);
    
    }).call(ctx, seekWrap);
}

export function setWaveformMinimapViewportStart(ctx: any, seekWrap: any, startRatio: any): any {
    return (function(this: any, seekWrap: any, startRatio: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        const viewportState = getWaveformViewportState(surfaceMetadata);
        const surfaceWidth = getWaveformSurfaceWidth(surfaceMetadata);
        const maxStartRatio = Math.max(0, 1 - viewportState.widthRatio);
        const nextStartRatio = clampTime(startRatio, 0, maxStartRatio);
        const nextScrollLeft = nextStartRatio * surfaceWidth;
        const maxScrollLeft = Math.max(0, surfaceWidth - surfaceMetadata.scrollContainer.clientWidth);
        const clampedScrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
        if (Math.abs(clampedScrollLeft - surfaceMetadata.scrollContainer.scrollLeft) < 0.000001) {
            updateWaveformMinimapViewport(surfaceMetadata);
            return false;
        }

        surfaceMetadata.scrollContainer.scrollLeft = clampedScrollLeft;
        updateWaveformMinimapViewport(surfaceMetadata);
        this.scheduleVisibleWaveformTileRefresh();
        return true;
    
    }).call(ctx, seekWrap, startRatio);
}

export function setWaveformZoom(ctx: any, seekWrap: any, zoom: any, durationSeconds: any, anchorPageX: any): any {
    return (function(this: any, seekWrap: any, zoom: any, durationSeconds: any, anchorPageX: any) {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        return setWaveformZoomForSurface(
            surfaceMetadata,
            zoom,
            getWaveformMaximumZoom(surfaceMetadata, durationSeconds),
            anchorPageX
        );
    
    }).call(ctx, seekWrap, zoom, durationSeconds, anchorPageX);
}

export function drawDummyWaveforms(ctx: any, waveformEngine: any): any {
    return (function(this: any, waveformEngine: any) {
        if (this.waveformSeekSurfaces.length === 0) {
            return;
        }

        this.reflowWaveforms();

        const pixelRatio = this.getCanvasPixelRatio();

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            surfaceMetadata.waveformColor = resolveWaveformColor(surfaceMetadata.surface);
            this.forEachVisibleWaveformTile(surfaceMetadata, pixelRatio, (tile: {
                canvas: HTMLCanvasElement;
                context: CanvasRenderingContext2D;
                renderBarWidth: number;
            }) => {
                waveformEngine.drawPlaceholder(
                    tile.canvas,
                    tile.context,
                    tile.renderBarWidth,
                    0.3,
                    surfaceMetadata.waveformColor || undefined
                );
            });
            if (surfaceMetadata.zoom > MIN_WAVEFORM_ZOOM) {
                renderWaveformMinimap(
                    surfaceMetadata,
                    waveformEngine,
                    [],
                    0,
                    (_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds,
                    1,
                    'placeholder',
                    pixelRatio
                );
            }
        }
        this.updateWaveformZoomIndicators();
    
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
        if (this.waveformSeekSurfaces.length === 0) {
            return;
        }

        if (performReflow) {
            this.reflowWaveforms();
        }

        const pixelRatio = this.getCanvasPixelRatio();
        const safeTimelineDuration = Number.isFinite(timelineDuration) && timelineDuration > 0 ? timelineDuration : 0;

        let longestTrackDuration = 0;
        if (waveformTimelineContext && waveformTimelineContext.enabled) {
            for (let ti = 0; ti < waveformTimelineContext.getTrackCount(); ti++) {
                const d = sanitizeDuration(waveformTimelineContext.getTrackDuration(ti));
                if (d > longestTrackDuration) longestTrackDuration = d;
            }
        }

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            surfaceMetadata.waveformColor = resolveWaveformColor(surfaceMetadata.surface);
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
            const fullDuration = useLocalAxis
                ? (longestTrackDuration > 0 ? longestTrackDuration : localTrackDuration)
                : safeTimelineDuration;
            const baseProjector: TrackTimelineProjector = useLocalAxis
                ? ((_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds)
                : (trackTimelineProjector || ((_runtime, trackTimelineTimeSeconds) => trackTimelineTimeSeconds));
            setWaveformZoomForSurface(
                surfaceMetadata,
                surfaceMetadata.zoom,
                getWaveformMaximumZoom(surfaceMetadata, fullDuration)
            );

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
                    waveformEngine.drawPlaceholder(
                        tile.canvas,
                        tile.context,
                        tile.renderBarWidth,
                        0.3,
                        surfaceMetadata.waveformColor || undefined
                    );
                    tile.record.lastDrawKey = tileDrawKey;
                    return;
                }

                const tileStartTime = fullDuration * (tile.tileStartPx / tile.surfaceWidth);
                const tileDuration = fullDuration * (tile.tileCssWidth / tile.surfaceWidth);
                if (!Number.isFinite(tileDuration) || tileDuration <= 0) {
                    waveformEngine.drawPlaceholder(
                        tile.canvas,
                        tile.context,
                        tile.renderBarWidth,
                        0.3,
                        surfaceMetadata.waveformColor || undefined
                    );
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
                    waveformEngine.drawPlaceholder(
                        tile.canvas,
                        tile.context,
                        tile.renderBarWidth,
                        0.3,
                        surfaceMetadata.waveformColor || undefined
                    );
                    tile.record.lastDrawKey = tileDrawKey;
                    return;
                }

                waveformEngine.drawWaveform(
                    tile.canvas,
                    tile.context,
                    mixed,
                    tile.renderBarWidth,
                    normalizationPeak,
                    surfaceMetadata.waveformColor || undefined
                );
                tile.record.lastDrawKey = tileDrawKey;
            });
            renderWaveformMinimap(
                surfaceMetadata,
                waveformEngine,
                sourceRuntimes,
                fullDuration,
                baseProjector,
                normalizationPeak,
                normalizationCacheKey,
                pixelRatio
            );
        }
        this.updateWaveformZoomIndicators();
    
    }).call(ctx, waveformEngine, runtimes, timelineDuration, trackTimelineProjector, waveformTimelineContext, performReflow, forceRedrawVisibleTiles);
}

export function getWaveformSourceRuntimes(ctx: any, runtimes: any, waveformSource: any): any {
    return (function(this: any, runtimes: any, waveformSource: any) {
        return resolveWaveformTrackIndices(runtimes.length, waveformSource)
            .filter((trackIndex: number) => isWaveformTrackAudible(this, runtimes, trackIndex))
            .map((trackIndex: number) => runtimes[trackIndex]);
    
    }).call(ctx, runtimes, waveformSource);
}

export function resolveWaveformTrackIndex(ctx: any, runtimes: any, waveformSource: any): any {
    return (function(this: any, runtimes: any, waveformSource: any) {
        return resolveFixedWaveformTrackIndex(runtimes.length, waveformSource);
    
    }).call(ctx, runtimes, waveformSource);
}

export function updateWaveformZoomIndicators(ctx: any): any {
    return (function(this: any) {
        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            if (surface.zoom <= (MIN_WAVEFORM_ZOOM + 0.000001)) {
                surface.zoomNode.style.display = 'none';
                return;
            }

            updateWaveformMinimapViewport(surface);
            surface.zoomNode.style.display = 'flex';
        });
    
    }).call(ctx);
}

export function applyFixedWaveformLocalSeekVisuals(ctx: any, state: any, waveformTimelineContext: any): any {
    return (function(this: any, state: any, waveformTimelineContext: any) {
        if (!waveformTimelineContext || !waveformTimelineContext.enabled) {
            this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
                surface.seekWrap.classList.remove('aligned-playhead');
                if (surface.refHooksPath) surface.refHooksPath.setAttribute('d', '');
                if (surface.alignmentPointsGroup) {
                    ensureAlignmentPointPaths(surface.alignmentPointsGroup, surface.alignmentPointsPaths, 0);
                }
            });
            return;
        }

        let longestTrackDuration = 0;
        for (let ti = 0; ti < waveformTimelineContext.getTrackCount(); ti++) {
            const d = sanitizeDuration(waveformTimelineContext.getTrackDuration(ti));
            if (d > longestTrackDuration) longestTrackDuration = d;
        }

        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            const trackIndex = typeof surface.waveformSource === 'number'
                ? surface.waveformSource
                : null;
            if (trackIndex === null) {
                return;
            }

            const trackDuration = sanitizeDuration(waveformTimelineContext.getTrackDuration(trackIndex));
            if (trackDuration <= 0) {
                return;
            }

            const seekDuration = longestTrackDuration > 0 ? longestTrackDuration : trackDuration;

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

            this.updateSeekWrapVisuals(surface.seekWrap, localPosition, seekDuration, {
                pointA: orderedPointA,
                pointB: orderedPointB,
                enabled: state.loop.enabled,
            });

            const needsDimensions = (surface.refHooksPath && surface.alignedPlayhead && seekDuration > 0)
                || (surface.alignmentPointsGroup && surface.showAlignmentPoints && seekDuration > 0);
            const w = needsDimensions ? surface.seekWrap.offsetWidth : 0;
            const h = needsDimensions ? surface.seekWrap.offsetHeight : 0;

            if (surface.refHooksPath) {
                if (surface.alignedPlayhead && seekDuration > 0) {
                    surface.seekWrap.classList.add('aligned-playhead');
                    const localPx = (localPosition / seekDuration) * w;
                    const refPx = (state.position / seekDuration) * w;
                    const vertExtentRaw = parseFloat(getComputedStyle(surface.seekWrap).getPropertyValue('--seekhead-vertical-extent').trim());
                    const vertExtent = Number.isFinite(vertExtentRaw) ? Math.max(0, Math.min(0.5, vertExtentRaw)) : 0.35;
                    const segTop = h * (0.5 - vertExtent);
                    const segBot = h * (0.5 + vertExtent);
                    surface.refHooksPath.setAttribute(
                        'd',
                        `M ${refPx} 0 L ${localPx} ${segTop} L ${localPx} ${segBot} L ${refPx} ${h}`
                    );
                } else {
                    surface.seekWrap.classList.remove('aligned-playhead');
                    surface.refHooksPath.setAttribute('d', '');
                }
            }

            if (surface.alignmentPointsGroup) {
                if (surface.showAlignmentPoints && seekDuration > 0) {
                    const points = waveformTimelineContext.getTrackAlignmentPoints(trackIndex);
                    if (w !== surface.alignmentPointsLastW || h !== surface.alignmentPointsLastH) {
                        const vertExtentRaw = parseFloat(
                            getComputedStyle(surface.seekWrap).getPropertyValue('--seekhead-vertical-extent').trim()
                        );
                        const vertExtent = Number.isFinite(vertExtentRaw) ? Math.max(0, Math.min(0.5, vertExtentRaw)) : 0.35;
                        const segTop = h * (0.5 - vertExtent);
                        const segBot = h * (0.5 + vertExtent);

                        ensureAlignmentPointPaths(surface.alignmentPointsGroup, surface.alignmentPointsPaths, points.length);

                        for (let pi = 0; pi < points.length; pi++) {
                            const pt = points[pi];
                            const trackPx = (pt.trackTime / seekDuration) * w;
                            const refPx = (pt.referenceTime / seekDuration) * w;
                            surface.alignmentPointsPaths[pi].setAttribute(
                                'd',
                                `M ${refPx} 0 L ${trackPx} ${segTop} L ${trackPx} ${segBot} L ${refPx} ${h}`
                            );
                        }

                        surface.alignmentPointsLastW = w;
                        surface.alignmentPointsLastH = h;
                    }
                } else {
                    ensureAlignmentPointPaths(surface.alignmentPointsGroup, surface.alignmentPointsPaths, 0);
                    surface.alignmentPointsLastW = -1;
                    surface.alignmentPointsLastH = -1;
                }
            }
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

        const sourceRuntimes = this.getWaveformSourceRuntimes(runtimes, waveformSource);
        let longest = 0;
        sourceRuntimes.forEach(function(runtime: TrackRuntime) {
            const duration = getRuntimeDuration(runtime);
            if (duration > longest) {
                longest = duration;
            }
        });

        return longest;
    
    }).call(ctx, runtimes, waveformSource);
}

export function updateWaveformTiming(ctx: any, state: any, runtimes: any, waveformTimelineContext: any): any {
    return (function(this: any, state: any, runtimes: any, waveformTimelineContext: any) {
        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            if (!surface.timingNode) {
                return;
            }

            const playbackMetrics = resolveWaveformPlaybackMetrics(
                this,
                surface,
                state,
                runtimes,
                waveformTimelineContext
            );
            surface.timingNode.textContent = formatSecondsToHHMMSSmmm(playbackMetrics.position)
                + ' / '
                + formatSecondsToHHMMSSmmm(playbackMetrics.duration);
        });
    
    }).call(ctx, state, runtimes, waveformTimelineContext);
}

export function updateWaveformPlaybackFollow(
    ctx: any,
    state: any,
    runtimes: any,
    waveformTimelineContext: any,
    suppressFollow: any
): any {
    return (function(this: any, state: any, runtimes: any, waveformTimelineContext: any, suppressFollow: any) {
        if (suppressFollow) {
            return;
        }

        this.waveformSeekSurfaces.forEach((surface: WaveformSeekSurfaceMetadata) => {
            if (surface.playbackFollowMode === 'off') {
                return;
            }

            const playbackMetrics = resolveWaveformPlaybackMetrics(
                this,
                surface,
                state,
                runtimes,
                waveformTimelineContext
            );
            if (playbackMetrics.duration <= 0) {
                return;
            }

            applyWaveformPlaybackFollowScroll(
                this,
                surface,
                resolvePlaybackFollowScrollLeft(
                    surface,
                    playbackMetrics.position / playbackMetrics.duration
                )
            );
        });
    }).call(ctx, state, runtimes, waveformTimelineContext, suppressFollow);
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
            setSeekheadPosition(seekhead, seekPercent);
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
