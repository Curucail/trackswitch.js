import { NormalizedTrackGroupLayout, TrackRuntime, TrackSwitchFeatures, TrackSwitchUiState } from '../domain/types';
import { escapeHtml, sanitizeInlineStyle } from '../shared/dom';
import { formatSecondsToHHMMSSmmm } from '../shared/format';
import { clampPercent } from '../shared/math';
import { TrackTimelineProjector, WaveformEngine } from '../engine/waveform-engine';
import uPlot from 'uplot';

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

interface WarpingMatrixTempoProfile {
    referenceTimes: number[];
    trackTimes: number[];
    segmentDeviations: number[];
    knotDeviations: number[];
    maxAbsDeviation: number;
}

interface WarpingMatrixMatrixData {
    x: number[];
    yByColumn: Map<string, number[]>;
}

interface WarpingMatrixTempoWindowData {
    x: number[];
    y: number[];
}

interface WarpingMatrixHostMetadata {
    wrapper: HTMLElement;
    host: HTMLElement;
    matrixPanel: HTMLElement;
    matrixPlotHost: HTMLElement;
    matrixPlot: uPlot | null;
    matrixSeriesSignature: string | null;
    matrixDataCache: WarpingMatrixMatrixData | null;
    matrixDataCacheKey: string | null;
    tempoPanel: HTMLElement;
    tempoPlotHost: HTMLElement;
    tempoPlot: uPlot | null;
    tempoSeriesColumnKey: string | null;
    tempoDisabledOverlay: HTMLElement;
    tempoDisabled: boolean;
    configuredHeight: number | null;
    configuredPathStrokeWidth: number | null;
    configuredLocalTempoWindowSeconds: number | null;
    configuredLocalTempoInterpolation: 'step' | 'linear' | null;
    tempoProfileByColumn: Map<string, WarpingMatrixTempoProfile>;
    tempoProfileCacheKey: string | null;
    colorByColumn: Map<string, string>;
    tempoWindowStart: number;
    tempoWindowEnd: number;
    tempoMaxAbsDeviation: number;
    tempoActiveSeriesPoints: WarpingMatrixDataPoint[];
    tempoActiveTrackDuration: number;
    referenceDuration: number;
    currentReferenceTime: number;
    matrixActivePointerId: number | null;
    lastSizeKey: string | null;
}

const MIN_WAVEFORM_ZOOM = 1;
const DEFAULT_MAX_WAVEFORM_ZOOM = 20;
const WAVEFORM_TILE_WIDTH_PX = 1024;
const WARPING_MATRIX_FIXED_COLORS = [
    '#ED8C01',
    '#1F77B4',
    '#2CA02C',
    '#D62728',
    '#9467BD',
    '#17BECF',
    '#8C564B',
    '#E377C2',
    '#BCBD22',
    '#FF7F0E',
];
const WARPING_MATRIX_OVERFLOW_COLOR = '#555555';
const DEFAULT_WARPING_MATRIX_PATH_STROKE_WIDTH = 3;
const DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_WINDOW_SECONDS = 10;
const DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_INTERPOLATION: 'step' | 'linear' = 'step';

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

function parseWarpingMatrixPathStrokeWidth(value: string | null): number | null {
    if (value === null) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return Math.max(0.5, parsed);
}

function parseWarpingMatrixLocalTempoWindowSeconds(value: string | null): number | null {
    if (value === null) {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return Math.max(0.1, parsed);
}

function parseWarpingMatrixLocalTempoInterpolation(value: string | null): 'step' | 'linear' | null {
    if (value === null) {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'linear') {
        return 'linear';
    }

    if (normalized === 'step') {
        return 'step';
    }

    return null;
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
    private readonly trackGroups: NormalizedTrackGroupLayout[];

    private originalImage = '';
    private readonly waveformSeekSurfaces: WaveformSeekSurfaceMetadata[] = [];
    private readonly sheetMusicHosts: SheetMusicHostConfig[] = [];
    private readonly warpingMatrixHosts: WarpingMatrixHostMetadata[] = [];
    private waveformTileRefreshFrameId: number | null = null;
    private latestWaveformRenderInput: LatestWaveformRenderInput | null = null;
    private readonly onWarpingMatrixSeek?: (referenceTime: number) => void;

    constructor(
        root: HTMLElement,
        features: TrackSwitchFeatures,
        presetNames: string[],
        trackGroups: NormalizedTrackGroupLayout[] = [],
        onWarpingMatrixSeek?: (referenceTime: number) => void
    ) {
        this.root = root;
        this.features = features;
        this.presetNames = presetNames;
        this.trackGroups = trackGroups;
        this.onWarpingMatrixSeek = onWarpingMatrixSeek;
    }

    private query(selector: string): HTMLElement | null {
        return this.root.querySelector(selector);
    }

    private queryAll(selector: string): HTMLElement[] {
        return Array.from(this.root.querySelectorAll(selector)) as HTMLElement[];
    }

    private getFixedWarpingMatrixColor(columnKey: string, columnOrder: string[]): string {
        const normalizedColumnKey = String(columnKey || '').trim();
        const paletteIndex = Math.max(0, columnOrder.indexOf(normalizedColumnKey));
        if (paletteIndex < WARPING_MATRIX_FIXED_COLORS.length) {
            return WARPING_MATRIX_FIXED_COLORS[paletteIndex];
        }

        return WARPING_MATRIX_OVERFLOW_COLOR;
    }

    private getWarpingMatrixPathStrokeWidth(host: WarpingMatrixHostMetadata): number {
        return host.configuredPathStrokeWidth ?? DEFAULT_WARPING_MATRIX_PATH_STROKE_WIDTH;
    }

    private getWarpingMatrixLocalTempoWindowSeconds(host: WarpingMatrixHostMetadata): number {
        return host.configuredLocalTempoWindowSeconds ?? DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_WINDOW_SECONDS;
    }

    private getWarpingMatrixLocalTempoInterpolation(host: WarpingMatrixHostMetadata): 'step' | 'linear' {
        return host.configuredLocalTempoInterpolation ?? DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_INTERPOLATION;
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
        this.wrapWarpingMatrixContainers();
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
            + (this.features.globalVolume
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
            + (this.features.seekBar
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
            const sources = runtime.definition.alignment?.synchronizedSources
                || runtime.definition.alignment?.sources;
            return Array.isArray(sources) && sources.length > 0;
        });
    }

    private buildTrackRow(runtime: TrackRuntime, index: number): HTMLElement {
        const tabviewClass = this.features.tabView ? ' tabs' : '';
        const radioSoloClass = this.features.radiosolo ? ' radio' : '';
        const wholeSoloClass = this.features.radiosolo ? ' solo' : '';

        const track = document.createElement('li');
        track.className = 'track' + tabviewClass + wholeSoloClass;
        track.setAttribute('style', sanitizeInlineStyle(runtime.definition.style || ''));
        track.setAttribute('data-track-index', String(index));
        const title = document.createElement('span');
        title.className = 'track-title';
        title.textContent = runtime.definition.title || 'Track ' + (index + 1);
        track.appendChild(title);

        const controls = document.createElement('ul');
        controls.className = 'control';

        const solo = document.createElement('li');
        solo.className = 'solo button' + radioSoloClass;
        solo.title = 'Solo';
        solo.textContent = 'Solo';
        controls.appendChild(solo);

        track.appendChild(controls);

        if (this.features.trackMixControls) {
            const mixControls = document.createElement('div');
            mixControls.className = 'track-mix-controls';

            const volumeControl = document.createElement('div');
            volumeControl.className = 'track-volume-control';

            const volumeIcon = document.createElement('i');
            volumeIcon.className = 'volume-icon track-volume-icon fa-volume-up';

            const volumeSlider = document.createElement('input');
            volumeSlider.className = 'track-volume-slider mix-slider';
            volumeSlider.type = 'range';
            volumeSlider.min = '0';
            volumeSlider.max = '100';
            volumeSlider.value = String(Math.round(sanitizeVolume(runtime.state.volume) * 100));

            volumeControl.appendChild(volumeIcon);
            volumeControl.appendChild(volumeSlider);

            const panControl = document.createElement('div');
            panControl.className = 'track-pan-control';

            const panLabel = document.createElement('span');
            panLabel.className = 'track-pan-label';
            panLabel.textContent = 'L/R';

            const panSlider = document.createElement('input');
            panSlider.className = 'track-pan-slider mix-slider';
            panSlider.type = 'range';
            panSlider.min = '-100';
            panSlider.max = '100';
            panSlider.value = String(Math.round(sanitizePan(runtime.state.pan) * 100));

            panControl.appendChild(panLabel);
            panControl.appendChild(panSlider);

            mixControls.appendChild(volumeControl);
            mixControls.appendChild(panControl);
            track.appendChild(mixControls);
        }

        return track;
    }

    private renderTrackList(runtimes: TrackRuntime[]): void {
        this.queryAll('.track_list').forEach(function(existing) {
            existing.remove();
        });

        if (this.trackGroups.length === 0) {
            const list = document.createElement('ul');
            list.className = 'track_list';

            runtimes.forEach((runtime, index) => {
                list.appendChild(this.buildTrackRow(runtime, index));
            });

            this.root.appendChild(list);
            return;
        }

        this.trackGroups.forEach((group) => {
            const list = document.createElement('ul');
            list.className = 'track_list';
            list.setAttribute('data-track-group-index', String(group.groupIndex));

            for (let offset = 0; offset < group.trackCount; offset += 1) {
                const trackIndex = group.startTrackIndex + offset;
                const runtime = runtimes[trackIndex];
                if (!runtime) {
                    continue;
                }

                list.appendChild(this.buildTrackRow(runtime, trackIndex));
            }

            const container = this.query('.track-group[data-track-group-index="' + group.groupIndex + '"]');
            if (container) {
                container.appendChild(list);
                return;
            }

            this.root.appendChild(list);
        });
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
                scrollContainer.style.height = maxHeight + 'px';
                scrollContainer.style.minHeight = maxHeight + 'px';
                wrapper.classList.add('sheetmusic-scrollable');
            } else {
                scrollContainer.style.removeProperty('max-height');
                scrollContainer.style.removeProperty('height');
                scrollContainer.style.removeProperty('min-height');
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

    private wrapWarpingMatrixContainers(): void {
        this.warpingMatrixHosts.length = 0;

        const hosts = this.root.querySelectorAll('.warping-matrix');
        hosts.forEach((hostElement) => {
            if (!(hostElement instanceof HTMLElement)) {
                return;
            }

            let wrapper: HTMLElement | null = hostElement.closest('.warping-matrix-wrap') as HTMLElement | null;
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.className = 'warping-matrix-wrap';
                wrapper.setAttribute(
                    'style',
                    sanitizeInlineStyle(hostElement.getAttribute('data-warping-matrix-style')) + '; display: block;'
                );

                const parent = hostElement.parentElement;
                if (!parent) {
                    return;
                }

                parent.insertBefore(wrapper, hostElement);
                wrapper.appendChild(hostElement);
            }

            const configuredHeight = parseWarpingMatrixHeight(hostElement.getAttribute('data-warping-matrix-height'));
            const configuredPathStrokeWidth = parseWarpingMatrixPathStrokeWidth(
                hostElement.getAttribute('data-warping-matrix-path-stroke-width')
            );
            const configuredLocalTempoWindowSeconds = parseWarpingMatrixLocalTempoWindowSeconds(
                hostElement.getAttribute('data-warping-matrix-local-tempo-window-seconds')
            );
            const configuredLocalTempoInterpolation = parseWarpingMatrixLocalTempoInterpolation(
                hostElement.getAttribute('data-warping-matrix-local-tempo-interpolation')
            );
            hostElement.style.removeProperty('height');

            hostElement.classList.add('warping-matrix-host');
            hostElement.textContent = '';

            const matrixPanel = document.createElement('div');
            matrixPanel.className = 'warping-matrix-panel warping-matrix-panel-main';
            hostElement.appendChild(matrixPanel);

            const tempoPanel = document.createElement('div');
            tempoPanel.className = 'warping-matrix-panel warping-matrix-panel-tempo';
            hostElement.appendChild(tempoPanel);

            const matrixPlotHost = document.createElement('div');
            matrixPlotHost.className = 'warping-plot-host warping-plot-host-main';
            matrixPanel.appendChild(matrixPlotHost);

            const tempoPlotHost = document.createElement('div');
            tempoPlotHost.className = 'warping-plot-host warping-plot-host-tempo';
            tempoPanel.appendChild(tempoPlotHost);

            const tempoDisabledOverlay = document.createElement('div');
            tempoDisabledOverlay.className = 'warping-tempo-disabled-overlay';
            tempoDisabledOverlay.textContent = 'SYNC mode';
            tempoPanel.appendChild(tempoDisabledOverlay);

            const metadata: WarpingMatrixHostMetadata = {
                wrapper: wrapper,
                host: hostElement,
                matrixPanel: matrixPanel,
                matrixPlotHost: matrixPlotHost,
                matrixPlot: null,
                matrixSeriesSignature: null,
                matrixDataCache: null,
                matrixDataCacheKey: null,
                tempoPanel: tempoPanel,
                tempoPlotHost: tempoPlotHost,
                tempoPlot: null,
                tempoSeriesColumnKey: null,
                tempoDisabledOverlay: tempoDisabledOverlay,
                tempoDisabled: false,
                configuredHeight: configuredHeight,
                configuredPathStrokeWidth: configuredPathStrokeWidth,
                configuredLocalTempoWindowSeconds: configuredLocalTempoWindowSeconds,
                configuredLocalTempoInterpolation: configuredLocalTempoInterpolation,
                tempoProfileByColumn: new Map<string, WarpingMatrixTempoProfile>(),
                tempoProfileCacheKey: null,
                colorByColumn: new Map<string, string>(),
                tempoWindowStart: 0,
                tempoWindowEnd: 0,
                tempoMaxAbsDeviation: 1,
                tempoActiveSeriesPoints: [],
                tempoActiveTrackDuration: 0,
                referenceDuration: 0,
                currentReferenceTime: 0,
                matrixActivePointerId: null,
                lastSizeKey: null,
            };

            matrixPlotHost.addEventListener('pointerdown', (event) => {
                this.onWarpingMatrixPointerDown(metadata, event);
            });
            matrixPlotHost.addEventListener('pointermove', (event) => {
                this.onWarpingMatrixPointerMove(metadata, event);
            });
            matrixPlotHost.addEventListener('pointerup', (event) => {
                this.onWarpingMatrixPointerUp(metadata, event);
            });
            matrixPlotHost.addEventListener('pointercancel', (event) => {
                this.onWarpingMatrixPointerUp(metadata, event);
            });
            tempoPlotHost.addEventListener('pointerdown', (event) => {
                this.onWarpingTempoPointerDown(metadata, event);
            });

            this.warpingMatrixHosts.push(metadata);
        });
    }

    private createWarpingMatrixPlot(
        host: WarpingMatrixHostMetadata,
        width: number,
        height: number,
        pathStrokeWidth: number,
        referenceDuration: number,
        series: Array<{ columnKey: string; color: string }>
    ): uPlot {
        host.matrixPlot?.destroy();
        host.matrixPlotHost.textContent = '';

        const options: uPlot.Options = {
            width: width,
            height: height,
            title: 'Warping Path',
            legend: {
                show: false,
            },
            cursor: {
                show: false,
                points: {
                    show: false,
                },
                drag: {
                    x: false,
                    y: false,
                    setScale: false,
                },
            },
            scales: {
                x: {
                    time: false,
                    auto: false,
                    range: [0, Math.max(0.001, referenceDuration)],
                },
                y: {
                    time: false,
                    auto: false,
                    range: [0, 1],
                },
            },
            axes: [
                {
                    stroke: '#666666',
                    grid: { show: false },
                    label: 'Reference time',
                },
                {
                    stroke: '#666666',
                    grid: { show: false },
                    label: 'Track time',
                    values: (): string[] => [],
                },
            ],
            series: [
                {},
                ...series.map((entry) => {
                    return {
                        label: entry.columnKey,
                        stroke: entry.color,
                        width: pathStrokeWidth,
                        points: {
                            show: false,
                        },
                    };
                }),
            ],
            hooks: {
                draw: [
                    (plot) => {
                        const left = plot.bbox.left;
                        const right = plot.bbox.left + plot.bbox.width;
                        const top = plot.bbox.top;
                        const bottom = plot.bbox.top + plot.bbox.height;
                        const playheadX = plot.valToPos(
                            clampTime(host.currentReferenceTime, 0, Math.max(0.001, host.referenceDuration)),
                            'x'
                        );

                        const context = plot.ctx;
                        context.save();
                        context.lineWidth = Math.max(1, pathStrokeWidth * 0.7);

                        context.strokeStyle = '#888888';
                        context.setLineDash([6, 4]);
                        context.beginPath();
                        context.moveTo(left, bottom);
                        context.lineTo(right, top);
                        context.stroke();

                        context.strokeStyle = '#777777';
                        context.setLineDash([5, 5]);
                        context.beginPath();
                        context.moveTo(playheadX, top);
                        context.lineTo(playheadX, bottom);
                        context.stroke();

                        context.restore();
                    },
                ],
            },
        };

        const initialData = [
            [],
            ...series.map(() => []),
        ] as unknown as uPlot.AlignedData;

        return new uPlot(options, initialData, host.matrixPlotHost);
    }

    private createWarpingTempoPlot(
        host: WarpingMatrixHostMetadata,
        width: number,
        height: number,
        pathStrokeWidth: number
    ): uPlot {
        host.tempoPlot?.destroy();
        host.tempoPlotHost.textContent = '';

        const options: uPlot.Options = {
            width: width,
            height: height,
            title: 'Local Tempo Deviation',
            legend: {
                show: false,
            },
            cursor: {
                show: false,
                points: {
                    show: false,
                },
                drag: {
                    x: false,
                    y: false,
                    setScale: false,
                },
            },
            scales: {
                x: {
                    time: false,
                    auto: false,
                    range: [0, 1],
                },
                y: {
                    time: false,
                    auto: false,
                    range: [-1, 1],
                },
            },
            axes: [
                {
                    stroke: '#666666',
                    grid: { show: false },
                    label: 'Track time',
                },
                {
                    stroke: '#666666',
                    grid: { show: false },
                    label: 'Local tempo deviation (%)',
                },
            ],
            series: [
                {},
                {
                    label: 'tempo',
                    stroke: '#ED8C01',
                    width: pathStrokeWidth,
                    points: {
                        show: false,
                    },
                },
            ],
            hooks: {
                draw: [
                    (plot) => {
                        const left = plot.bbox.left;
                        const right = plot.bbox.left + plot.bbox.width;
                        const top = plot.bbox.top;
                        const bottom = plot.bbox.top + plot.bbox.height;
                        const centerX = left + (plot.bbox.width / 2);
                        const zeroY = plot.valToPos(0, 'y');

                        const context = plot.ctx;
                        context.save();
                        context.lineWidth = Math.max(1, pathStrokeWidth * 0.7);

                        context.strokeStyle = '#888888';
                        context.setLineDash([6, 4]);
                        context.beginPath();
                        context.moveTo(left, zeroY);
                        context.lineTo(right, zeroY);
                        context.stroke();

                        context.strokeStyle = '#777777';
                        context.setLineDash([5, 5]);
                        context.beginPath();
                        context.moveTo(centerX, top);
                        context.lineTo(centerX, bottom);
                        context.stroke();

                        context.restore();
                    },
                ],
            },
        };

        return new uPlot(options, [[0, 1], [NaN, NaN]] as unknown as uPlot.AlignedData, host.tempoPlotHost);
    }

    private isPointerInsidePlotArea(
        plot: uPlot,
        plotHost: HTMLElement,
        clientX: number,
        clientY: number
    ): boolean {
        const rect = plotHost.getBoundingClientRect();
        const pointerX = clientX - rect.left;
        const pointerY = clientY - rect.top;
        const left = plot.bbox.left;
        const right = plot.bbox.left + plot.bbox.width;
        const top = plot.bbox.top;
        const bottom = plot.bbox.top + plot.bbox.height;
        return pointerX >= left && pointerX <= right && pointerY >= top && pointerY <= bottom;
    }

    private onWarpingMatrixPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        if (!this.onWarpingMatrixSeek || !host.matrixPlot || event.button !== 0) {
            return;
        }

        if (!this.isPointerInsidePlotArea(host.matrixPlot, host.matrixPlotHost, event.clientX, event.clientY)) {
            return;
        }

        host.matrixActivePointerId = event.pointerId;
        host.matrixPlotHost.setPointerCapture(event.pointerId);
        this.seekWarpingMatrixFromPointerX(host, event.clientX);
        event.preventDefault();
    }

    private onWarpingMatrixPointerMove(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        if (!this.onWarpingMatrixSeek || !host.matrixPlot) {
            return;
        }

        if (host.matrixActivePointerId === null || host.matrixActivePointerId !== event.pointerId) {
            return;
        }

        this.seekWarpingMatrixFromPointerX(host, event.clientX);
        event.preventDefault();
    }

    private onWarpingMatrixPointerUp(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        if (!host.matrixPlot) {
            return;
        }

        if (host.matrixActivePointerId === null || host.matrixActivePointerId !== event.pointerId) {
            return;
        }

        this.seekWarpingMatrixFromPointerX(host, event.clientX);
        host.matrixActivePointerId = null;
        if (host.matrixPlotHost.hasPointerCapture(event.pointerId)) {
            host.matrixPlotHost.releasePointerCapture(event.pointerId);
        }
        event.preventDefault();
    }

    private onWarpingTempoPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        if (
            !this.onWarpingMatrixSeek
            || !host.tempoPlot
            || host.tempoDisabled
            || event.button !== 0
        ) {
            return;
        }

        if (!this.isPointerInsidePlotArea(host.tempoPlot, host.tempoPlotHost, event.clientX, event.clientY)) {
            return;
        }

        this.seekWarpingTempoFromPointerX(host, event.clientX);
        event.preventDefault();
    }

    private seekWarpingMatrixFromPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        if (!this.onWarpingMatrixSeek || !host.matrixPlot) {
            return;
        }

        const rect = host.matrixPlotHost.getBoundingClientRect();
        const left = host.matrixPlot.bbox.left;
        const right = host.matrixPlot.bbox.left + host.matrixPlot.bbox.width;
        const pointerX = clampTime(clientX - rect.left, left, right);
        const referenceTime = host.matrixPlot.posToVal(pointerX, 'x');
        this.onWarpingMatrixSeek(clampTime(referenceTime, 0, Math.max(0.001, host.referenceDuration)));
    }

    private seekWarpingTempoFromPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        if (
            !this.onWarpingMatrixSeek
            || !host.tempoPlot
            || !Array.isArray(host.tempoActiveSeriesPoints)
            || host.tempoActiveSeriesPoints.length === 0
        ) {
            return;
        }

        const rect = host.tempoPlotHost.getBoundingClientRect();
        const left = host.tempoPlot.bbox.left;
        const right = host.tempoPlot.bbox.left + host.tempoPlot.bbox.width;
        const pointerX = clampTime(clientX - rect.left, left, right);
        const trackTime = host.tempoPlot.posToVal(pointerX, 'x');
        const referenceTime = this.interpolateWarpingReferenceTime(host.tempoActiveSeriesPoints, trackTime);
        this.onWarpingMatrixSeek(clampTime(referenceTime, 0, Math.max(0.001, host.referenceDuration)));
    }

    private updateWarpingMatrix(
        host: WarpingMatrixHostMetadata,
        context: WarpingMatrixRenderContext | undefined
    ): void {
        if (!context || !context.enabled) {
            host.wrapper.style.display = 'none';
            return;
        }

        host.wrapper.style.display = 'block';
        const referenceDuration = Math.max(0.001, sanitizeDuration(context.referenceDuration));
        host.referenceDuration = referenceDuration;
        host.currentReferenceTime = clampTime(context.currentReferenceTime, 0, referenceDuration);
        const pathStrokeWidth = this.getWarpingMatrixPathStrokeWidth(host);
        const localTempoInterpolation = this.getWarpingMatrixLocalTempoInterpolation(host);
        const tempoSeries = context.trackSeries.length > 0 ? context.trackSeries[0] : null;
        host.tempoDisabled = context.syncEnabled || !tempoSeries;
        host.host.classList.toggle('warping-matrix-tempo-disabled', host.tempoDisabled);
        host.tempoDisabledOverlay.style.display = host.tempoDisabled ? 'flex' : 'none';

        const renderedHeight = host.configuredHeight ?? Math.max(180, host.matrixPanel.clientHeight || 220);
        const fallbackWidth = Math.max(220, Math.round(host.host.clientWidth || host.wrapper.clientWidth || 720));
        const matrixRenderedWidth = Math.max(220, Math.round(host.matrixPanel.clientWidth || (fallbackWidth / 2)));
        const tempoRenderedWidth = Math.max(220, Math.round(host.tempoPanel.clientWidth || (fallbackWidth / 2)));
        host.matrixPanel.style.height = renderedHeight + 'px';
        host.tempoPanel.style.height = renderedHeight + 'px';

        const sizeKey = [matrixRenderedWidth, tempoRenderedWidth, renderedHeight].join(':');
        const sizeChanged = host.lastSizeKey !== sizeKey;
        host.lastSizeKey = sizeKey;

        host.colorByColumn.clear();
        context.trackSeries.forEach((series) => {
            host.colorByColumn.set(
                series.columnKey,
                this.getFixedWarpingMatrixColor(series.columnKey, context.columnOrder)
            );
        });

        const matrixSeriesSignature = context.trackSeries.map((series) => {
            return [
                series.columnKey,
                host.colorByColumn.get(series.columnKey) || WARPING_MATRIX_FIXED_COLORS[0],
                series.trackIndex,
            ].join(':');
        }).join('|') + '#' + pathStrokeWidth;

        if (!host.matrixPlot || host.matrixSeriesSignature !== matrixSeriesSignature) {
            host.matrixPlot = this.createWarpingMatrixPlot(
                host,
                matrixRenderedWidth,
                renderedHeight,
                pathStrokeWidth,
                referenceDuration,
                context.trackSeries.map((series) => {
                    return {
                        columnKey: series.columnKey,
                        color: host.colorByColumn.get(series.columnKey) || WARPING_MATRIX_FIXED_COLORS[0],
                    };
                })
            );
            host.matrixSeriesSignature = matrixSeriesSignature;
        } else if (sizeChanged) {
            host.matrixPlot.setSize({ width: matrixRenderedWidth, height: renderedHeight });
        }

        const matrixDataCacheKey = context.trackSeries.map((series) => {
            const lastPoint = series.points.length > 0
                ? series.points[series.points.length - 1]
                : null;
            const seriesTrackDuration = resolveWarpingMatrixTrackDuration(series.trackDuration, referenceDuration);
            return [
                series.trackIndex,
                series.points.length,
                lastPoint ? Math.round(lastPoint.referenceTime * 1000) : 0,
                lastPoint ? Math.round(lastPoint.trackTime * 1000) : 0,
                Math.round(seriesTrackDuration * 1000),
            ].join(':');
        }).join('|') + '#' + Math.round(referenceDuration * 1000);

        if (host.matrixDataCacheKey !== matrixDataCacheKey) {
            host.matrixDataCache = this.buildWarpingMatrixData(context.trackSeries, referenceDuration);
            host.matrixDataCacheKey = matrixDataCacheKey;
        }

        if (host.matrixPlot) {
            const matrixDataArrays = host.matrixDataCache && host.matrixDataCache.x.length > 0
                ? [
                    host.matrixDataCache.x,
                    ...context.trackSeries.map((series) => {
                        return host.matrixDataCache?.yByColumn.get(series.columnKey) || [];
                    }),
                ]
                : [
                    [0, referenceDuration],
                    ...context.trackSeries.map(() => [NaN, NaN]),
                ];
            host.matrixPlot.setData(matrixDataArrays as unknown as uPlot.AlignedData, false);
            host.matrixPlot.setScale('x', { min: 0, max: referenceDuration });
            host.matrixPlot.setScale('y', { min: 0, max: 1 });
            host.matrixPlot.redraw();
        }

        if (!host.tempoPlot) {
            host.tempoPlot = this.createWarpingTempoPlot(host, tempoRenderedWidth, renderedHeight, pathStrokeWidth);
        } else if (sizeChanged) {
            host.tempoPlot.setSize({ width: tempoRenderedWidth, height: renderedHeight });
        }

        if (!host.tempoPlot) {
            return;
        }

        if (!tempoSeries) {
            host.tempoActiveSeriesPoints = [];
            host.tempoActiveTrackDuration = 0;
            host.tempoWindowStart = 0;
            host.tempoWindowEnd = 1;
            host.tempoSeriesColumnKey = null;
            host.tempoProfileCacheKey = null;
            host.tempoProfileByColumn.clear();
            host.tempoMaxAbsDeviation = 1;
            host.tempoPlot.setScale('x', { min: 0, max: 1 });
            host.tempoPlot.setScale('y', { min: -1, max: 1 });
            host.tempoPlot.setData([[0, 1], [NaN, NaN]] as unknown as uPlot.AlignedData, false);
            return;
        }

        host.tempoActiveSeriesPoints = tempoSeries.points;
        host.tempoActiveTrackDuration = resolveWarpingMatrixTrackDuration(tempoSeries.trackDuration, referenceDuration);
        const currentTempoTrackTime = this.interpolateWarpingTrackTime(tempoSeries.points, host.currentReferenceTime);
        const configuredLocalTempoWindowSeconds = this.getWarpingMatrixLocalTempoWindowSeconds(host);
        const tempoWindowDuration = Math.min(
            host.tempoActiveTrackDuration,
            Math.max(0.1, configuredLocalTempoWindowSeconds)
        );
        if (tempoWindowDuration >= host.tempoActiveTrackDuration) {
            host.tempoWindowStart = 0;
            host.tempoWindowEnd = host.tempoActiveTrackDuration;
        } else {
            const halfWindow = tempoWindowDuration / 2;
            const centeredStart = currentTempoTrackTime - halfWindow;
            host.tempoWindowStart = clampTime(
                centeredStart,
                0,
                host.tempoActiveTrackDuration - tempoWindowDuration
            );
            host.tempoWindowEnd = host.tempoWindowStart + tempoWindowDuration;
        }
        if (!(host.tempoWindowEnd > host.tempoWindowStart)) {
            host.tempoWindowStart = 0;
            host.tempoWindowEnd = Math.max(1, host.tempoActiveTrackDuration);
        }

        const tempoSeriesCacheKey = [
            tempoSeries.trackIndex,
            tempoSeries.columnKey,
            tempoSeries.points.length,
            Math.round(host.tempoActiveTrackDuration * 1000),
            localTempoInterpolation,
        ].join(':');

        if (host.tempoProfileCacheKey !== tempoSeriesCacheKey || host.tempoSeriesColumnKey !== tempoSeries.columnKey) {
            host.tempoProfileByColumn.clear();
            const profile = this.buildWarpingTempoProfile(tempoSeries.points);
            if (profile) {
                host.tempoProfileByColumn.set(tempoSeries.columnKey, profile);
                host.tempoMaxAbsDeviation = Math.max(1, profile.maxAbsDeviation * 1.1);
            } else {
                host.tempoMaxAbsDeviation = 1;
            }
            host.tempoSeriesColumnKey = tempoSeries.columnKey;
            host.tempoProfileCacheKey = tempoSeriesCacheKey;
        }

        (host.tempoPlot as unknown as { setSeries: (index: number, options: unknown) => void }).setSeries(1, {
            stroke: host.colorByColumn.get(tempoSeries.columnKey) || WARPING_MATRIX_FIXED_COLORS[0],
            width: pathStrokeWidth,
        });
        host.tempoPlot.setScale('x', { min: host.tempoWindowStart, max: host.tempoWindowEnd });
        host.tempoPlot.setScale('y', { min: -host.tempoMaxAbsDeviation, max: host.tempoMaxAbsDeviation });

        const tempoProfile = host.tempoProfileByColumn.get(tempoSeries.columnKey) || null;
        if (!tempoProfile) {
            host.tempoPlot.setData(
                [[host.tempoWindowStart, host.tempoWindowEnd], [NaN, NaN]] as unknown as uPlot.AlignedData,
                false
            );
            return;
        }

        const windowData = this.buildWarpingTempoWindowData(
            tempoProfile,
            localTempoInterpolation,
            host.tempoWindowStart,
            host.tempoWindowEnd,
            host.tempoDisabled
        );
        host.tempoPlot.setData([windowData.x, windowData.y] as unknown as uPlot.AlignedData, false);
    }

    private buildWarpingMatrixData(
        trackSeries: WarpingMatrixTrackSeries[],
        referenceDuration: number
    ): WarpingMatrixMatrixData {
        const uniqueX = new Set<number>();
        uniqueX.add(0);
        uniqueX.add(referenceDuration);

        trackSeries.forEach((series) => {
            series.points.forEach((point) => {
                if (!Number.isFinite(point.referenceTime)) {
                    return;
                }
                uniqueX.add(clampTime(point.referenceTime, 0, referenceDuration));
            });
        });

        const x = Array.from(uniqueX.values()).sort((left, right) => left - right);
        const yByColumn = new Map<string, number[]>();

        trackSeries.forEach((series) => {
            const trackDuration = resolveWarpingMatrixTrackDuration(series.trackDuration, referenceDuration);
            const yValues = x.map((referenceTime) => {
                const trackTime = this.interpolateWarpingTrackTime(series.points, referenceTime);
                return clampTime(trackTime / Math.max(0.001, trackDuration), 0, 1);
            });
            yByColumn.set(series.columnKey, yValues);
        });

        return { x, yByColumn };
    }

    private buildWarpingTempoWindowData(
        profile: WarpingMatrixTempoProfile,
        interpolation: 'step' | 'linear',
        windowStart: number,
        windowEnd: number,
        hideCurve: boolean
    ): WarpingMatrixTempoWindowData {
        if (!(windowEnd > windowStart)) {
            return {
                x: [windowStart, windowStart + 0.001],
                y: [NaN, NaN],
            };
        }

        const points: Array<{ trackTime: number; deviationPercent: number }> = [];

        if (interpolation === 'linear') {
            points.push({
                trackTime: windowStart,
                deviationPercent: this.evaluateWarpingTempoDeviationLinear(profile, windowStart),
            });

            profile.trackTimes.forEach((trackTime) => {
                if (trackTime <= windowStart || trackTime >= windowEnd) {
                    return;
                }
                points.push({
                    trackTime: trackTime,
                    deviationPercent: this.evaluateWarpingTempoDeviationLinear(profile, trackTime),
                });
            });

            points.push({
                trackTime: windowEnd,
                deviationPercent: this.evaluateWarpingTempoDeviationLinear(profile, windowEnd),
            });
        } else {
            let currentDeviation = this.evaluateWarpingTempoDeviationStep(profile, windowStart);
            points.push({
                trackTime: windowStart,
                deviationPercent: currentDeviation,
            });

            const segmentDeviations = profile.segmentDeviations;
            if (segmentDeviations.length > 0) {
                profile.trackTimes.forEach((trackTime, trackTimeIndex) => {
                    if (trackTime <= windowStart || trackTime >= windowEnd) {
                        return;
                    }

                    points.push({
                        trackTime: trackTime,
                        deviationPercent: currentDeviation,
                    });

                    const nextDeviation = segmentDeviations[
                        Math.min(segmentDeviations.length - 1, Math.max(0, trackTimeIndex))
                    ];
                    if (nextDeviation !== currentDeviation) {
                        points.push({
                            trackTime: trackTime,
                            deviationPercent: nextDeviation,
                        });
                    }

                    currentDeviation = nextDeviation;
                });
            }

            points.push({
                trackTime: windowEnd,
                deviationPercent: currentDeviation,
            });
        }

        const x: number[] = [];
        const y: number[] = [];
        points.forEach((point) => {
            if (!Number.isFinite(point.trackTime) || !Number.isFinite(point.deviationPercent)) {
                return;
            }

            x.push(point.trackTime);
            y.push(hideCurve ? NaN : point.deviationPercent);
        });

        if (x.length === 0) {
            return {
                x: [windowStart, windowEnd],
                y: [NaN, NaN],
            };
        }

        if (x.length === 1) {
            x.push(windowEnd);
            y.push(hideCurve ? NaN : y[0]);
        }

        return { x, y };
    }

    private interpolateWarpingTrackTime(points: WarpingMatrixDataPoint[], referenceTime: number): number {
        if (!Array.isArray(points) || points.length === 0) {
            return 0;
        }

        if (points.length === 1) {
            return points[0].trackTime;
        }

        const first = points[0];
        const last = points[points.length - 1];

        if (referenceTime <= first.referenceTime) {
            return first.trackTime;
        }

        if (referenceTime >= last.referenceTime) {
            return last.trackTime;
        }

        let leftIndex = 0;
        let rightIndex = points.length - 1;

        while (leftIndex <= rightIndex) {
            const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
            const middle = points[middleIndex];

            if (middle.referenceTime === referenceTime) {
                return middle.trackTime;
            }

            if (middle.referenceTime < referenceTime) {
                leftIndex = middleIndex + 1;
            } else {
                rightIndex = middleIndex - 1;
            }
        }

        const rightPoint = points[Math.min(points.length - 1, leftIndex)];
        const leftPoint = points[Math.max(0, leftIndex - 1)];
        const range = rightPoint.referenceTime - leftPoint.referenceTime;
        if (!Number.isFinite(range) || range <= 0) {
            return leftPoint.trackTime;
        }

        const ratio = (referenceTime - leftPoint.referenceTime) / range;
        return leftPoint.trackTime + ((rightPoint.trackTime - leftPoint.trackTime) * ratio);
    }

    private interpolateWarpingReferenceTime(points: WarpingMatrixDataPoint[], trackTime: number): number {
        if (!Array.isArray(points) || points.length === 0) {
            return 0;
        }

        if (points.length === 1) {
            return points[0].referenceTime;
        }

        const first = points[0];
        const last = points[points.length - 1];

        if (trackTime <= first.trackTime) {
            return first.referenceTime;
        }

        if (trackTime >= last.trackTime) {
            return last.referenceTime;
        }

        let leftIndex = 0;
        let rightIndex = points.length - 1;

        while (leftIndex <= rightIndex) {
            const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
            const middle = points[middleIndex];

            if (middle.trackTime === trackTime) {
                return middle.referenceTime;
            }

            if (middle.trackTime < trackTime) {
                leftIndex = middleIndex + 1;
            } else {
                rightIndex = middleIndex - 1;
            }
        }

        const rightPoint = points[Math.min(points.length - 1, leftIndex)];
        const leftPoint = points[Math.max(0, leftIndex - 1)];
        const range = rightPoint.trackTime - leftPoint.trackTime;
        if (!Number.isFinite(range) || range <= 0) {
            return leftPoint.referenceTime;
        }

        const ratio = (trackTime - leftPoint.trackTime) / range;
        return leftPoint.referenceTime + ((rightPoint.referenceTime - leftPoint.referenceTime) * ratio);
    }

    private buildWarpingTempoProfile(points: WarpingMatrixDataPoint[]): WarpingMatrixTempoProfile | null {
        const collapsed = this.collapseWarpingPointsByReference(points);
        if (collapsed.length === 0) {
            return null;
        }

        const referenceTimes = collapsed.map((point) => point.referenceTime);
        const trackTimes = collapsed.map((point) => point.trackTime);
        const segmentDeviations: number[] = [];
        for (let index = 0; index < collapsed.length - 1; index += 1) {
            const left = collapsed[index];
            const right = collapsed[index + 1];
            const deltaReference = right.referenceTime - left.referenceTime;
            if (!Number.isFinite(deltaReference) || deltaReference <= 0) {
                continue;
            }

            const slope = (right.trackTime - left.trackTime) / deltaReference;
            if (!Number.isFinite(slope)) {
                continue;
            }

            segmentDeviations.push((slope - 1) * 100);
        }

        const normalizedSegmentDeviations = segmentDeviations.length > 0
            ? segmentDeviations
            : [0];
        const knotDeviations: number[] = [];

        if (referenceTimes.length <= 1) {
            knotDeviations.push(normalizedSegmentDeviations[0]);
        } else {
            knotDeviations.push(normalizedSegmentDeviations[0]);
            for (let index = 1; index < referenceTimes.length - 1; index += 1) {
                const leftDeviation = normalizedSegmentDeviations[Math.max(0, index - 1)];
                const rightDeviation = normalizedSegmentDeviations[
                    Math.min(normalizedSegmentDeviations.length - 1, index)
                ];
                const leftSpan = referenceTimes[index] - referenceTimes[index - 1];
                const rightSpan = referenceTimes[index + 1] - referenceTimes[index];
                if (leftSpan > 0 && rightSpan > 0) {
                    knotDeviations.push(
                        (leftDeviation * rightSpan + rightDeviation * leftSpan) / (leftSpan + rightSpan)
                    );
                } else {
                    knotDeviations.push((leftDeviation + rightDeviation) / 2);
                }
            }
            knotDeviations.push(normalizedSegmentDeviations[normalizedSegmentDeviations.length - 1]);
        }

        let maxAbsDeviation = 0;
        normalizedSegmentDeviations.forEach((value) => {
            const absValue = Math.abs(value);
            if (Number.isFinite(absValue) && absValue > maxAbsDeviation) {
                maxAbsDeviation = absValue;
            }
        });
        knotDeviations.forEach((value) => {
            const absValue = Math.abs(value);
            if (Number.isFinite(absValue) && absValue > maxAbsDeviation) {
                maxAbsDeviation = absValue;
            }
        });

        return {
            referenceTimes: referenceTimes,
            trackTimes: trackTimes,
            segmentDeviations: normalizedSegmentDeviations,
            knotDeviations: knotDeviations,
            maxAbsDeviation: maxAbsDeviation,
        };
    }

    private collapseWarpingPointsByReference(points: WarpingMatrixDataPoint[]): WarpingMatrixDataPoint[] {
        if (!Array.isArray(points) || points.length === 0) {
            return [];
        }

        const firstValidIndex = points.findIndex((point) => {
            return Number.isFinite(point.referenceTime) && Number.isFinite(point.trackTime);
        });
        if (firstValidIndex < 0) {
            return [];
        }

        const collapsed: WarpingMatrixDataPoint[] = [];
        let activeReference = Number(points[firstValidIndex].referenceTime);
        let trackTimeSum = Number(points[firstValidIndex].trackTime);
        let count = 1;

        for (let index = firstValidIndex + 1; index < points.length; index += 1) {
            const point = points[index];
            const referenceTime = Number(point.referenceTime);
            const trackTime = Number(point.trackTime);
            if (!Number.isFinite(referenceTime) || !Number.isFinite(trackTime)) {
                continue;
            }

            if (referenceTime === activeReference) {
                trackTimeSum += trackTime;
                count += 1;
                continue;
            }

            collapsed.push({
                referenceTime: activeReference,
                trackTime: trackTimeSum / count,
            });
            activeReference = referenceTime;
            trackTimeSum = trackTime;
            count = 1;
        }

        collapsed.push({
            referenceTime: activeReference,
            trackTime: trackTimeSum / count,
        });

        return collapsed;
    }

    private firstIndexGreaterOrEqual(values: number[], value: number): number {
        if (values.length === 0) {
            return 0;
        }

        let low = 0;
        let high = values.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (values[middle] < value) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return low;
    }

    private evaluateWarpingTempoDeviation(
        profile: WarpingMatrixTempoProfile,
        interpolation: 'step' | 'linear',
        referenceTime: number
    ): number {
        return interpolation === 'linear'
            ? this.evaluateWarpingTempoDeviationLinear(profile, referenceTime)
            : this.evaluateWarpingTempoDeviationStep(profile, referenceTime);
    }

    private evaluateWarpingTempoDeviationStep(profile: WarpingMatrixTempoProfile, referenceTime: number): number {
        const trackTimes = profile.trackTimes;
        const segmentDeviations = profile.segmentDeviations;
        if (trackTimes.length === 0 || segmentDeviations.length === 0) {
            return 0;
        }

        if (trackTimes.length === 1) {
            return segmentDeviations[0];
        }

        const firstReference = trackTimes[0];
        const lastReference = trackTimes[trackTimes.length - 1];
        if (referenceTime <= firstReference) {
            return segmentDeviations[0];
        }

        if (referenceTime >= lastReference) {
            return segmentDeviations[segmentDeviations.length - 1];
        }

        const rightIndex = this.firstIndexGreaterOrEqual(trackTimes, referenceTime);
        const segmentIndex = Math.max(0, Math.min(segmentDeviations.length - 1, rightIndex - 1));
        return segmentDeviations[segmentIndex];
    }

    private evaluateWarpingTempoDeviationLinear(profile: WarpingMatrixTempoProfile, referenceTime: number): number {
        const trackTimes = profile.trackTimes;
        const knotDeviations = profile.knotDeviations;
        if (trackTimes.length === 0 || knotDeviations.length === 0) {
            return 0;
        }

        if (trackTimes.length === 1) {
            return knotDeviations[0];
        }

        const firstReference = trackTimes[0];
        const lastReference = trackTimes[trackTimes.length - 1];
        if (referenceTime <= firstReference) {
            return knotDeviations[0];
        }

        if (referenceTime >= lastReference) {
            return knotDeviations[knotDeviations.length - 1];
        }

        const rightIndex = this.firstIndexGreaterOrEqual(trackTimes, referenceTime);
        const leftIndex = Math.max(0, rightIndex - 1);
        const rightReference = trackTimes[rightIndex];
        const leftReference = trackTimes[leftIndex];
        if (rightReference === leftReference) {
            return knotDeviations[leftIndex];
        }

        if (rightReference === referenceTime) {
            return knotDeviations[rightIndex];
        }

        const ratio = (referenceTime - leftReference) / (rightReference - leftReference);
        return knotDeviations[leftIndex] + ratio * (knotDeviations[rightIndex] - knotDeviations[leftIndex]);
    }

    private buildWarpingTempoPathData(
        profile: WarpingMatrixTempoProfile,
        interpolation: 'step' | 'linear',
        windowStart: number,
        windowEnd: number,
        toX: (referenceTime: number) => number,
        toY: (deviationPercent: number) => number
    ): string {
        if (windowEnd <= windowStart) {
            return '';
        }

        const points: Array<{ referenceTime: number; deviationPercent: number }> = [];
        if (interpolation === 'linear') {
            points.push({
                referenceTime: windowStart,
                deviationPercent: this.evaluateWarpingTempoDeviationLinear(profile, windowStart),
            });
            profile.trackTimes.forEach((referenceTime) => {
                if (referenceTime <= windowStart || referenceTime >= windowEnd) {
                    return;
                }

                points.push({
                    referenceTime: referenceTime,
                    deviationPercent: this.evaluateWarpingTempoDeviationLinear(profile, referenceTime),
                });
            });
            points.push({
                referenceTime: windowEnd,
                deviationPercent: this.evaluateWarpingTempoDeviationLinear(profile, windowEnd),
            });
        } else {
            let currentDeviation = this.evaluateWarpingTempoDeviationStep(profile, windowStart);
            points.push({
                referenceTime: windowStart,
                deviationPercent: currentDeviation,
            });

            const segmentDeviations = profile.segmentDeviations;
            if (segmentDeviations.length > 0) {
                profile.trackTimes.forEach((referenceTime, referenceIndex) => {
                    if (referenceTime <= windowStart || referenceTime >= windowEnd) {
                        return;
                    }

                    points.push({
                        referenceTime: referenceTime,
                        deviationPercent: currentDeviation,
                    });

                    const nextDeviation = segmentDeviations[
                        Math.min(segmentDeviations.length - 1, Math.max(0, referenceIndex))
                    ];
                    if (nextDeviation !== currentDeviation) {
                        points.push({
                            referenceTime: referenceTime,
                            deviationPercent: nextDeviation,
                        });
                    }
                    currentDeviation = nextDeviation;
                });
            }

            points.push({
                referenceTime: windowEnd,
                deviationPercent: currentDeviation,
            });
        }

        if (points.length === 0) {
            return '';
        }

        let pathData = '';
        points.forEach((point, index) => {
            const x = toX(point.referenceTime);
            const y = toY(point.deviationPercent);
            pathData += (index === 0 ? 'M ' : ' L ') + x + ' ' + y;
        });
        return pathData;
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
                solo: false,
                volume: selected.state.volume,
                pan: selected.state.pan,
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

    updateMainControls(
        state: TrackSwitchUiState,
        runtimes: TrackRuntime[],
        waveformTimelineContext?: WaveformTimelineContext,
        warpingMatrixContext?: WarpingMatrixRenderContext
    ): void {
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
        this.warpingMatrixHosts.forEach((host) => {
            this.updateWarpingMatrix(host, warpingMatrixContext);
        });

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
        effectiveSingleSoloMode = this.features.radiosolo,
        panSupported = true
    ): void {
        runtimes.forEach((runtime, index) => {
            const row = this.query('.track[data-track-index="' + index + '"]');
            if (!row) {
                return;
            }

            const solo = row.querySelector('.solo');
            const isLocked = !!syncLockedTrackIndexes && syncLockedTrackIndexes.has(index);

            row.classList.toggle('solo', effectiveSingleSoloMode);

            if (solo) {
                solo.classList.toggle('checked', runtime.state.solo);
                solo.classList.toggle('disabled', isLocked);
                solo.classList.toggle('radio', effectiveSingleSoloMode);
            }

            if (!this.features.trackMixControls) {
                return;
            }

            this.setTrackVolumeSlider(index, runtime.state.volume);
            this.setTrackPanSlider(index, panSupported ? runtime.state.pan : 0);

            const trackVolumeSlider = row.querySelector('.track-volume-slider');
            if (trackVolumeSlider instanceof HTMLInputElement) {
                trackVolumeSlider.disabled = isLocked;
            }

            const trackPanSlider = row.querySelector('.track-pan-slider');
            if (trackPanSlider instanceof HTMLInputElement) {
                trackPanSlider.disabled = isLocked || !panSupported;
            }

            const trackVolumeIcon = row.querySelector('.track-volume-icon');
            if (trackVolumeIcon instanceof HTMLElement) {
                this.applyVolumeIconState(trackVolumeIcon, runtime.state.volume);
            }

            const trackMixControls = row.querySelector('.track-mix-controls');
            if (trackMixControls) {
                trackMixControls.classList.toggle('disabled', isLocked);
            }

            const trackPanControl = row.querySelector('.track-pan-control');
            if (trackPanControl) {
                trackPanControl.classList.toggle('disabled', isLocked || !panSupported);
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
        const slider = this.query('.main-control .volume-slider');
        if (!slider || !(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(volumeZeroToOne * 100));
        this.updateVolumeIcon(volumeZeroToOne);
    }

    setTrackVolumeSlider(trackIndex: number, volumeZeroToOne: number): void {
        const row = this.query('.track[data-track-index="' + trackIndex + '"]');
        if (!row) {
            return;
        }

        const slider = row.querySelector('.track-volume-slider');
        if (!(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(sanitizeVolume(volumeZeroToOne) * 100));
    }

    setTrackPanSlider(trackIndex: number, panMinusOneToOne: number): void {
        const row = this.query('.track[data-track-index="' + trackIndex + '"]');
        if (!row) {
            return;
        }

        const slider = row.querySelector('.track-pan-slider');
        if (!(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(sanitizePan(panMinusOneToOne) * 100));
    }

    updateVolumeIcon(volumeZeroToOne: number): void {
        this.queryAll('.main-control .volume-control .volume-icon').forEach((icon) => {
            this.applyVolumeIconState(icon, volumeZeroToOne);
        });
    }

    private applyVolumeIconState(icon: HTMLElement, volumeZeroToOne: number): void {
        icon.classList.remove('fa-volume-off', 'fa-volume-down', 'fa-volume-up');

        const volume = sanitizeVolume(volumeZeroToOne);
        if (volume === 0) {
            icon.classList.add('fa-volume-off');
        } else if (volume < 0.5) {
            icon.classList.add('fa-volume-down');
        } else {
            icon.classList.add('fa-volume-up');
        }
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

            const row = this.query('.track[data-track-index="' + index + '"]');
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
        this.warpingMatrixHosts.length = 0;
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
