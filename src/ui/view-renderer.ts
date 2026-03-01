import { TrackRuntime, TrackSwitchFeatures, TrackSwitchUiState } from '../domain/types';
import { escapeHtml, sanitizeInlineStyle } from '../shared/dom';
import { formatSecondsToHHMMSSmmm } from '../shared/format';
import { clampPercent } from '../shared/math';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';

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

const MIN_WAVEFORM_ZOOM = 1;
const DEFAULT_MAX_WAVEFORM_ZOOM = 20;
const WAVEFORM_TILE_WIDTH_PX = 1024;

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

function clampWaveformZoom(zoom: number, maximum: number): number {
    if (!Number.isFinite(zoom)) {
        return MIN_WAVEFORM_ZOOM;
    }

    return clampTime(zoom, MIN_WAVEFORM_ZOOM, maximum);
}

export class ViewRenderer {
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly presetNames: string[];

    private originalImage = '';
    private readonly waveformSeekSurfaces: WaveformSeekSurfaceMetadata[] = [];
    private readonly sheetMusicHosts: SheetMusicHostConfig[] = [];
    private waveformTileRefreshFrameId: number | null = null;
    private latestWaveformRenderInput: LatestWaveformRenderInput | null = null;

    constructor(root: HTMLElement, features: TrackSwitchFeatures, presetNames: string[]) {
        this.root = root;
        this.features = features;
        this.presetNames = presetNames;
    }

    private query(selector: string): HTMLElement | null {
        return this.root.querySelector(selector);
    }

    private queryAll(selector: string): HTMLElement[] {
        return Array.from(this.root.querySelectorAll(selector)) as HTMLElement[];
    }

    private getCanvasPixelRatio(): number {
        const ratio = window.devicePixelRatio;
        if (!Number.isFinite(ratio) || ratio < 1) {
            return 1;
        }

        return ratio;
    }

    initialize(runtimes: TrackRuntime[]): void {
        this.root.classList.add('trackswitch');

        if (!this.query('.main-control')) {
            this.root.insertAdjacentHTML('afterbegin', this.buildMainControlHtml(runtimes));
        }

        this.wrapSeekableImages();
        this.wrapWaveformCanvases();
        this.wrapSheetMusicContainers();
        this.reflowWaveforms();
        this.renderTrackList(runtimes);

        if (this.query('.seekable:not(.seekable-img-wrap > .seekable)')) {
            this.queryAll('.main-control .seekwrap').forEach(function(seekWrap) {
                setDisplay(seekWrap, 'none');
            });
        }

        this.updateTiming(0, 0);
        this.updateVolumeIcon(1);
    }

    private buildMainControlHtml(runtimes: TrackRuntime[]): string {
        let presetDropdownHtml = '';
        if (this.features.presets && this.presetNames.length >= 2) {
            presetDropdownHtml += '<li class="preset-selector-wrap"><select class="preset-selector" title="Select Preset">';
            for (let i = 0; i < this.presetNames.length; i += 1) {
                presetDropdownHtml += '<option value="' + i + '"' + (i === 0 ? ' selected' : '') + '>'
                    + escapeHtml(this.presetNames[i]) + '</option>';
            }
            presetDropdownHtml += '</select></li>';
        }

        return '<div class="overlay"><span class="activate">Activate</span>'
            + '<p id="overlaytext"></p>'
            + '<p id="overlayinfo">'
            + '<span class="info">Info</span>'
            + '<span class="text">'
            + '<strong>trackswitch.js</strong> - open source multitrack audio player<br />'
            + '<a href="https://github.com/audiolabs/trackswitch.js">https://github.com/audiolabs/trackswitch.js</a>'
            + '</span>'
            + '</p>'
            + '</div>'
            + '<div class="main-control">'
            + '<ul class="control">'
            + '<li class="playback-group">'
            + '<ul class="playback-controls">'
            + '<li class="playpause button" title="Play/Pause (Spacebar)">Play</li>'
            + '<li class="stop button" title="Stop (Esc)">Stop</li>'
            + '<li class="repeat button" title="Repeat (R)">Repeat</li>'
            + (this.shouldRenderGlobalSync(runtimes)
                ? '<li class="sync-global button" title="Use synchronized version">SYNC</li>'
                : '')
            + '</ul>'
            + '</li>'
            + (this.features.globalvolume
                ? '<li class="volume"><div class="volume-control"><i class="fa-volume-up volume-icon"></i>'
                    + '<input type="range" class="volume-slider" min="0" max="100" value="100"></div></li>'
                : '')
            + (this.features.looping
                ? '<li class="loop-group"><ul class="loop-controls">'
                    + '<li class="loop-a button" title="Set Loop Point A (A)">Loop A</li>'
                    + '<li class="loop-b button" title="Set Loop Point B (B)">Loop B</li>'
                    + '<li class="loop-toggle button" title="Toggle Loop On/Off (L)">Loop</li>'
                    + '<li class="loop-clear button" title="Clear Loop Points (C)">Clear</li>'
                    + '</ul></li>'
                : '')
            + presetDropdownHtml
            + (this.features.timer
                ? '<li class="timing"><span class="time">--:--:--:---</span> / <span class="length">--:--:--:---</span></li>'
                : '')
            + (this.features.seekbar
                ? '<li class="seekwrap">'
                    + '<div class="seekbar">'
                    + '<div class="loop-region"></div>'
                    + '<div class="loop-marker marker-a"></div>'
                    + '<div class="loop-marker marker-b"></div>'
                    + '<div class="seekhead"></div>'
                    + '</div>'
                    + '</li>'
                : '')
            + '</ul>'
            + '</div>';
    }

    private shouldRenderGlobalSync(runtimes: TrackRuntime[]): boolean {
        if (this.features.mode !== 'alignment') {
            return false;
        }

        return runtimes.some(function(runtime) {
            const sources = runtime.definition.alignment?.sources;
            return Array.isArray(sources) && sources.length > 0;
        });
    }

    private renderTrackList(runtimes: TrackRuntime[]): void {
        this.queryAll('.track_list').forEach(function(existing) {
            existing.remove();
        });

        const list = document.createElement('ul');
        list.className = 'track_list';

        runtimes.forEach((runtime, index) => {
            const tabviewClass = this.features.tabview ? ' tabs' : '';
            const radioSoloClass = this.features.radiosolo ? ' radio' : '';
            const wholeSoloClass = this.features.onlyradiosolo ? ' solo' : '';

            const track = document.createElement('li');
            track.className = 'track' + tabviewClass + wholeSoloClass;
            track.setAttribute('style', sanitizeInlineStyle(runtime.definition.style || ''));
            track.append(document.createTextNode(runtime.definition.title || 'Track ' + (index + 1)));

            const controls = document.createElement('ul');
            controls.className = 'control';

            if (this.features.mute) {
                const mute = document.createElement('li');
                mute.className = 'mute button';
                mute.title = 'Mute';
                mute.textContent = 'Mute';
                controls.appendChild(mute);
            }

            if (this.features.solo) {
                const solo = document.createElement('li');
                solo.className = 'solo button' + radioSoloClass;
                solo.title = 'Solo';
                solo.textContent = 'Solo';
                controls.appendChild(solo);
            }

            track.appendChild(controls);
            list.appendChild(track);
        });

        this.root.appendChild(list);
    }

    private wrapSeekableImages(): void {
        const candidates = this.queryAll('.seekable');

        candidates.forEach((candidate) => {
            if (!(candidate instanceof HTMLImageElement)) {
                return;
            }

            if (candidate.parentElement?.classList.contains('seekable-img-wrap')) {
                return;
            }

            if (!this.originalImage) {
                this.originalImage = candidate.src;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'seekable-img-wrap';
            wrapper.setAttribute('style', sanitizeInlineStyle(candidate.getAttribute('data-style')) + '; display: block;');

            const parent = candidate.parentElement;
            if (!parent) {
                return;
            }

            parent.insertBefore(wrapper, candidate);
            wrapper.appendChild(candidate);
            wrapper.insertAdjacentHTML(
                'beforeend',
                buildSeekWrap(
                    clampPercent(candidate.getAttribute('data-seek-margin-left')),
                    clampPercent(candidate.getAttribute('data-seek-margin-right'))
                )
            );
        });
    }

    private wrapWaveformCanvases(): void {
        if (!this.features.waveform) {
            return;
        }

        const canvases = this.root.querySelectorAll('canvas.waveform');
        canvases.forEach((canvasElement) => {
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
    }

    private wrapSheetMusicContainers(): void {
        this.sheetMusicHosts.length = 0;

        const hosts = this.root.querySelectorAll('.sheetmusic');
        hosts.forEach((hostElement) => {
            if (!(hostElement instanceof HTMLElement)) {
                return;
            }

            let wrapper: HTMLElement | null = hostElement.closest('.sheetmusic-wrap') as HTMLElement | null;
            let scrollContainer: HTMLElement | null = null;

            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'sheetmusic-wrap';
                wrapper.setAttribute(
                    'style',
                    sanitizeInlineStyle(hostElement.getAttribute('data-sheetmusic-style')) + '; display: block;'
                );

                scrollContainer = document.createElement('div');
                scrollContainer.className = 'sheetmusic-scroll';

                const parent = hostElement.parentElement;
                if (!parent) {
                    return;
                }

                parent.insertBefore(wrapper, hostElement);
                wrapper.appendChild(scrollContainer);
                scrollContainer.appendChild(hostElement);
            } else {
                scrollContainer = wrapper.querySelector('.sheetmusic-scroll');
            }

            if (!(wrapper instanceof HTMLElement) || !(scrollContainer instanceof HTMLElement)) {
                return;
            }

            const maxWidth = parseSheetMusicMaxWidth(
                hostElement.getAttribute('data-sheetmusic-max-width')
                ?? hostElement.getAttribute('data-sheetmusic-width')
            );
            if (maxWidth !== null) {
                wrapper.style.width = '100%';
                wrapper.style.maxWidth = maxWidth + 'px';
                wrapper.style.marginLeft = 'auto';
                wrapper.style.marginRight = 'auto';
                wrapper.setAttribute('data-sheetmusic-max-width-applied', 'true');
            } else if (wrapper.getAttribute('data-sheetmusic-max-width-applied') === 'true') {
                wrapper.style.removeProperty('width');
                wrapper.style.removeProperty('max-width');
                wrapper.style.removeProperty('margin-left');
                wrapper.style.removeProperty('margin-right');
                wrapper.removeAttribute('data-sheetmusic-max-width-applied');
            }

            const maxHeight = parseSheetMusicMaxHeight(hostElement.getAttribute('data-sheetmusic-max-height'));
            if (maxHeight !== null) {
                scrollContainer.style.maxHeight = maxHeight + 'px';
                wrapper.classList.add('sheetmusic-scrollable');
            } else {
                scrollContainer.style.removeProperty('max-height');
                wrapper.classList.remove('sheetmusic-scrollable');
            }

            const source = parseSheetMusicString(hostElement.getAttribute('data-sheetmusic-src'));
            const measureCsv = parseSheetMusicString(hostElement.getAttribute('data-sheetmusic-measure-csv'));
            if (!source || !measureCsv) {
                return;
            }

            this.sheetMusicHosts.push({
                host: hostElement,
                scrollContainer: scrollContainer,
                source: source,
                measureCsv: measureCsv,
                renderScale: parseSheetMusicRenderScale(hostElement.getAttribute('data-sheetmusic-render-scale')),
                followPlayback: parseSheetMusicFollowPlayback(hostElement.getAttribute('data-sheetmusic-follow-playback')),
                cursorColor: parseSheetMusicCursorColor(hostElement.getAttribute('data-sheetmusic-cursor-color')),
                cursorAlpha: parseSheetMusicCursorAlpha(hostElement.getAttribute('data-sheetmusic-cursor-alpha')),
            });
        });
    }

    getPreparedSheetMusicHosts(): SheetMusicHostConfig[] {
        return this.sheetMusicHosts.map((entry) => {
            return {
                host: entry.host,
                scrollContainer: entry.scrollContainer,
                source: entry.source,
                measureCsv: entry.measureCsv,
                renderScale: entry.renderScale,
                followPlayback: entry.followPlayback,
                cursorColor: entry.cursorColor,
                cursorAlpha: entry.cursorAlpha,
            };
        });
    }

    private createWaveformTimingNode(overlay: HTMLElement): HTMLElement {
        const timing = document.createElement('div');
        timing.className = 'waveform-timing';
        timing.textContent = '--:--:--:--- / --:--:--:---';
        overlay.appendChild(timing);
        return timing;
    }

    private createWaveformZoomNode(overlay: HTMLElement): HTMLElement {
        const zoom = document.createElement('div');
        zoom.className = 'waveform-zoom';
        zoom.textContent = 'Zoom: 100%';
        zoom.style.display = 'none';
        overlay.appendChild(zoom);
        return zoom;
    }

    private resolveWaveformBaseWidth(scrollContainer: HTMLElement, fallback: number): number {
        const scrollWidth = scrollContainer.clientWidth;
        if (Number.isFinite(scrollWidth) && scrollWidth > 0) {
            return Math.max(1, Math.round(scrollWidth));
        }

        if (Number.isFinite(fallback) && fallback > 0) {
            return Math.max(1, Math.round(fallback));
        }

        return 1;
    }

    private setWaveformSurfaceWidth(surfaceMetadata: WaveformSeekSurfaceMetadata): void {
        const width = Math.max(1, Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom));
        surfaceMetadata.surface.style.width = width + 'px';
        surfaceMetadata.surface.style.height = surfaceMetadata.originalHeight + 'px';
        surfaceMetadata.tileLayer.style.height = surfaceMetadata.originalHeight + 'px';
    }

    private forEachVisibleWaveformTile(
        surfaceMetadata: WaveformSeekSurfaceMetadata,
        pixelRatio: number,
        callback: (tile: {
            tileIndex: number;
            tileStartPx: number;
            tileCssWidth: number;
            surfaceWidth: number;
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
            renderBarWidth: number;
            isNew: boolean;
            record: { canvas: HTMLCanvasElement; lastDrawKey: string | null };
        }) => void
    ): void {
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

        Array.from(surfaceMetadata.tiles.keys()).forEach((tileIndex) => {
            if (needed.has(tileIndex)) {
                return;
            }

            const tileRecord = surfaceMetadata.tiles.get(tileIndex);
            if (tileRecord) {
                tileRecord.canvas.remove();
            }
            surfaceMetadata.tiles.delete(tileIndex);
        });
    }

    private scheduleVisibleWaveformTileRefresh(): void {
        if (this.waveformTileRefreshFrameId !== null) {
            return;
        }

        this.waveformTileRefreshFrameId = requestAnimationFrame(() => {
            this.waveformTileRefreshFrameId = null;
            this.refreshVisibleWaveformTilesFromLatestInput();
        });
    }

    private refreshVisibleWaveformTilesFromLatestInput(): void {
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
    }

    private computeNormalizationPeak(
        waveformEngine: WaveformEngine,
        sourceRuntimes: TrackRuntime[],
        renderBarWidth: number,
        duration: number,
        baseProjector: TrackTimelineProjector,
        baseWidth: number
    ): number {
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
    }

    private buildWaveformNormalizationCacheKey(
        surfaceMetadata: WaveformSeekSurfaceMetadata,
        runtimes: TrackRuntime[],
        sourceRuntimes: TrackRuntime[],
        fullDuration: number,
        renderBarWidth: number,
        useLocalAxis: boolean,
        hasTimelineProjector: boolean
    ): string {
        const sourceKey = surfaceMetadata.waveformSource === 'audible'
            ? runtimes.map((runtime, index) => {
                const duration = runtime.buffer ? runtime.buffer.duration : 0;
                const timingDuration = runtime.timing ? runtime.timing.effectiveDuration : 0;
                return [
                    index,
                    runtime.state.mute ? 1 : 0,
                    runtime.state.solo ? 1 : 0,
                    Math.round(duration * 1000),
                    Math.round(timingDuration * 1000),
                ].join(':');
            }).join('|')
            : sourceRuntimes.map((runtime, index) => {
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
    }

    private findWaveformSurface(
        seekWrap: HTMLElement | null
    ): WaveformSeekSurfaceMetadata | null {
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
    }

    reflowWaveforms(): void {
        this.waveformSeekSurfaces.forEach((surfaceMetadata) => {
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
    }

    getWaveformZoom(seekWrap: HTMLElement): number | null {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return null;
        }

        return surfaceMetadata.zoom;
    }

    isWaveformZoomEnabled(seekWrap: HTMLElement): boolean {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        return surfaceMetadata.maxZoom > MIN_WAVEFORM_ZOOM;
    }

    setWaveformZoom(seekWrap: HTMLElement, zoom: number, anchorPageX?: number): boolean {
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
    }

    drawDummyWaveforms(waveformEngine: WaveformEngine): void {
        if (!this.features.waveform || this.waveformSeekSurfaces.length === 0) {
            return;
        }

        this.reflowWaveforms();

        const pixelRatio = this.getCanvasPixelRatio();

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            this.forEachVisibleWaveformTile(surfaceMetadata, pixelRatio, (tile) => {
                waveformEngine.drawPlaceholder(tile.canvas, tile.context, tile.renderBarWidth, 0.3);
            });
        }
    }

    renderWaveforms(
        waveformEngine: WaveformEngine,
        runtimes: TrackRuntime[],
        timelineDuration: number,
        trackTimelineProjector?: TrackTimelineProjector,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
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
    }

    private renderWaveformsInternal(
        waveformEngine: WaveformEngine,
        runtimes: TrackRuntime[],
        timelineDuration: number,
        trackTimelineProjector?: TrackTimelineProjector,
        waveformTimelineContext?: WaveformTimelineContext,
        performReflow = true,
        forceRedrawVisibleTiles = true
    ): void {
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

            this.forEachVisibleWaveformTile(surfaceMetadata, pixelRatio, (tile) => {
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
    }

    private getWaveformSourceRuntimes(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): TrackRuntime[] {
        const trackIndex = this.resolveWaveformTrackIndex(runtimes, waveformSource);
        if (trackIndex === null) {
            return runtimes;
        }

        const selected = runtimes[trackIndex];

        return [{
            ...selected,
            state: {
                mute: false,
                solo: false,
            },
        }];
    }

    private resolveWaveformTrackIndex(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): number | null {
        if (waveformSource === 'audible') {
            return null;
        }

        if (!Number.isFinite(waveformSource) || waveformSource < 0 || waveformSource >= runtimes.length) {
            return null;
        }

        return Math.floor(waveformSource);
    }

    updateMainControls(state: TrackSwitchUiState, runtimes: TrackRuntime[], waveformTimelineContext?: WaveformTimelineContext): void {
        this.root.classList.toggle('sync-enabled', state.syncEnabled);

        this.queryAll('.playpause').forEach(function(element) {
            element.classList.toggle('checked', state.playing);
        });

        this.queryAll('.repeat').forEach(function(element) {
            element.classList.toggle('checked', state.repeat);
        });

        this.queryAll('.sync-global').forEach(function(element) {
            element.classList.toggle('checked', state.syncEnabled);
            element.classList.toggle('disabled', !state.syncAvailable);
        });

        const seekWraps = this.queryAll('.seekwrap');
        seekWraps.forEach((seekWrap) => {
            this.updateSeekWrapVisuals(seekWrap, state.position, state.longestDuration, state.loop);
        });

        this.applyFixedWaveformLocalSeekVisuals(state, waveformTimelineContext);

        if (this.features.timer) {
            this.updateTiming(state.position, state.longestDuration);
        }

        this.updateWaveformTiming(state, runtimes, waveformTimelineContext);
        this.updateWaveformZoomIndicators();

        if (!this.features.looping) {
            return;
        }

        this.queryAll('.loop-a').forEach(function(element) {
            element.classList.toggle('checked', state.loop.pointA !== null);
            element.classList.toggle('active', state.loop.enabled);
        });

        this.queryAll('.loop-b').forEach(function(element) {
            element.classList.toggle('checked', state.loop.pointB !== null);
            element.classList.toggle('active', state.loop.enabled);
        });

        this.queryAll('.loop-toggle').forEach(function(element) {
            element.classList.toggle('checked', state.loop.enabled);
        });

    }

    private updateWaveformZoomIndicators(): void {
        this.waveformSeekSurfaces.forEach((surface) => {
            const zoomPercent = Math.round(clampWaveformZoom(surface.zoom, surface.maxZoom) * 100);
            if (zoomPercent === 100) {
                surface.zoomNode.style.display = 'none';
                return;
            }

            surface.zoomNode.textContent = 'Zoom: ' + zoomPercent + '%';
            surface.zoomNode.style.display = 'block';
        });
    }

    private applyFixedWaveformLocalSeekVisuals(
        state: TrackSwitchUiState,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        if (!waveformTimelineContext || !waveformTimelineContext.enabled) {
            return;
        }

        this.waveformSeekSurfaces.forEach((surface) => {
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
    }

    private getLongestWaveformSourceDuration(
        runtimes: TrackRuntime[],
        waveformSource: 'audible' | number
    ): number {
        const getRuntimeDuration = (runtime: TrackRuntime): number => {
            return runtime.timing
                ? runtime.timing.effectiveDuration
                : (runtime.buffer ? runtime.buffer.duration : 0);
        };

        if (waveformSource === 'audible') {
            // For audible source, find longest among all tracks
            let longest = 0;
            runtimes.forEach(function(runtime) {
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
    }

    private updateWaveformTiming(
        state: TrackSwitchUiState,
        runtimes: TrackRuntime[],
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        this.waveformSeekSurfaces.forEach((surface) => {
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
    }

    private updateSeekWrapVisuals(
        seekWrap: Element,
        position: number,
        duration: number,
        loop: { pointA: number | null; pointB: number | null; enabled: boolean }
    ): void {
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
    }

    updateTrackControls(
        runtimes: TrackRuntime[],
        syncLockedTrackIndexes?: ReadonlySet<number>,
        effectiveOnlyRadioSolo = this.features.onlyradiosolo
    ): void {
        runtimes.forEach((runtime, index) => {
            const row = this.query('.track_list li.track:nth-child(' + (index + 1) + ')');
            if (!row) {
                return;
            }

            const mute = row.querySelector('.mute');
            const solo = row.querySelector('.solo');
            const isLocked = !!syncLockedTrackIndexes && syncLockedTrackIndexes.has(index);

            row.classList.toggle('solo', effectiveOnlyRadioSolo);

            if (mute) {
                mute.classList.toggle('checked', runtime.state.mute);
                mute.classList.toggle('disabled', isLocked);
            }

            if (solo) {
                solo.classList.toggle('checked', runtime.state.solo);
                solo.classList.toggle('disabled', isLocked);
                solo.classList.toggle('radio', effectiveOnlyRadioSolo);
            }
        });
    }

    switchPosterImage(runtimes: TrackRuntime[]): void {
        let soloCount = 0;
        let imageSrc: string | undefined;

        runtimes.forEach(function(runtime) {
            if (runtime.state.solo) {
                soloCount += 1;
                imageSrc = runtime.definition.image;
            }
        });

        if (soloCount !== 1 || !imageSrc) {
            imageSrc = this.originalImage;
        }

        if (!imageSrc) {
            return;
        }

        this.queryAll('.seekable').forEach(function(element) {
            if (element instanceof HTMLImageElement) {
                element.src = imageSrc as string;
            }
        });
    }

    setVolumeSlider(volumeZeroToOne: number): void {
        const slider = this.query('.volume-slider');
        if (!slider || !(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(volumeZeroToOne * 100));
        this.updateVolumeIcon(volumeZeroToOne);
    }

    updateVolumeIcon(volumeZeroToOne: number): void {
        this.queryAll('.volume-control .volume-icon').forEach(function(icon) {
            icon.classList.remove('fa-volume-off', 'fa-volume-down', 'fa-volume-up');

            if (volumeZeroToOne === 0) {
                icon.classList.add('fa-volume-off');
            } else if (volumeZeroToOne < 0.5) {
                icon.classList.add('fa-volume-down');
            } else {
                icon.classList.add('fa-volume-up');
            }
        });
    }

    setOverlayLoading(isLoading: boolean): void {
        this.queryAll('.overlay .activate').forEach(function(activate) {
            activate.classList.toggle('fa-spin', isLoading);
            activate.classList.toggle('loading', isLoading);
        });

        this.queryAll('.overlay').forEach(function(overlay) {
            overlay.classList.toggle('loading', isLoading);
        });
    }

    showOverlayInfoText(): void {
        this.queryAll('.overlay .info').forEach(function(info) {
            setDisplay(info, 'none');
        });

        this.queryAll('.overlay .text').forEach(function(text) {
            setDisplay(text, 'block');
        });
    }

    hideOverlayOnLoaded(): void {
        this.queryAll('.overlay').forEach(function(overlay) {
            overlay.remove();
        });
    }

    showError(message: string, runtimes: TrackRuntime[]): void {
        this.root.classList.add('error');

        this.queryAll('.overlay .activate').forEach(function(activate) {
            activate.classList.remove('fa-spin', 'loading');
        });

        const overlayText = this.query('#overlaytext');
        if (overlayText) {
            overlayText.textContent = message;
        }

        runtimes.forEach((runtime, index) => {
            if (!runtime.errored) {
                return;
            }

            const row = this.query('.track_list > li:nth-child(' + (index + 1) + ')');
            if (row) {
                row.classList.add('error');
            }
        });
    }

    destroy(): void {
        this.queryAll('.main-control').forEach(function(mainControl) {
            mainControl.remove();
        });

        this.queryAll('.track_list').forEach(function(trackList) {
            trackList.remove();
        });

        this.sheetMusicHosts.length = 0;
    }

    getPresetCount(): number {
        return this.presetNames.length;
    }

    updateTiming(position: number, longestDuration: number): void {
        this.queryAll('.timing .time').forEach(function(node) {
            node.textContent = formatSecondsToHHMMSSmmm(position);
        });

        this.queryAll('.timing .length').forEach(function(node) {
            node.textContent = formatSecondsToHHMMSSmmm(longestDuration);
        });
    }
}
