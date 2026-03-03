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
    private warpingClipPathCounter = 0;
    private readonly warpingMatrixTempoControlState = new WeakMap<
        HTMLElement,
        { windowSeconds: number; yHalfRangePercent: number }
    >();

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

    private getWarpingMatrixPathStrokeWidth(): number {
        return DEFAULT_WARPING_MATRIX_PATH_STROKE_WIDTH;
    }

    private getWarpingMatrixLocalTempoWindowSeconds(host: WarpingMatrixHostMetadata): number {
        return normalizeTempoWindowSeconds(host.tempoWindowSeconds);
    }

    private getWarpingMatrixLocalTempoSlopeHalfWindowPoints(): number {
        return WARPING_MATRIX_LOCAL_TEMPO_SLOPE_HALF_WINDOW_POINTS;
    }

    private getWarpingMatrixTempoYHalfRangePercent(host: WarpingMatrixHostMetadata): number {
        return normalizeTempoYHalfRangePercent(host.tempoYHalfRangePercent);
    }

    private updateWarpingMatrixTempoControlLabels(host: WarpingMatrixHostMetadata): void {
        host.tempoWindowValueNode.textContent = this.getWarpingMatrixLocalTempoWindowSeconds(host).toFixed(1) + 's';
        host.tempoYScaleValueNode.textContent = '±' + Math.round(this.getWarpingMatrixTempoYHalfRangePercent(host)) + '%';
    }

    private persistWarpingMatrixTempoControls(host: WarpingMatrixHostMetadata): void {
        this.warpingMatrixTempoControlState.set(host.host, {
            windowSeconds: this.getWarpingMatrixLocalTempoWindowSeconds(host),
            yHalfRangePercent: this.getWarpingMatrixTempoYHalfRangePercent(host),
        });
    }

    private getWarpingMatrixSquarePlotSize(plot: WarpingMatrixPlotState): number {
        return Math.max(1, Math.min(plot.innerWidth, plot.innerHeight));
    }

    private resolveWarpingMatrixColumnColor(_columnKey: string, _columnOrder: string[]): string {
        return WARPING_MATRIX_PRIMARY_COLOR;
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
            hostElement.style.removeProperty('height');

            hostElement.classList.add('warping-matrix-host');
            hostElement.textContent = '';

            const matrixPanel = document.createElement('div');
            matrixPanel.className = 'warping-matrix-panel warping-matrix-panel-main';
            hostElement.appendChild(matrixPanel);

            const matrixPlotHost = document.createElement('div');
            matrixPlotHost.className = 'warping-plot-host warping-plot-host-main';
            matrixPanel.appendChild(matrixPlotHost);

            const matrixDisabledOverlay = document.createElement('div');
            matrixDisabledOverlay.className = 'warping-matrix-disabled-overlay';
            matrixDisabledOverlay.textContent = 'SYNC mode';
            matrixPanel.appendChild(matrixDisabledOverlay);

            const tempoPanel = document.createElement('div');
            tempoPanel.className = 'warping-matrix-panel warping-matrix-panel-tempo';
            hostElement.appendChild(tempoPanel);

            const tempoPlotHost = document.createElement('div');
            tempoPlotHost.className = 'warping-plot-host warping-plot-host-tempo';
            tempoPanel.appendChild(tempoPlotHost);

            const tempoControls = document.createElement('div');
            tempoControls.className = 'warping-tempo-controls';

            const windowControl = document.createElement('label');
            windowControl.className = 'warping-tempo-control';
            const windowLabel = document.createElement('span');
            windowLabel.className = 'warping-tempo-control-label';
            windowLabel.textContent = 'Window (s)';
            const tempoWindowSlider = document.createElement('input');
            tempoWindowSlider.className = 'warping-tempo-slider';
            tempoWindowSlider.type = 'range';
            tempoWindowSlider.min = String(WARPING_MATRIX_TEMPO_WINDOW_MIN_SECONDS);
            tempoWindowSlider.max = String(WARPING_MATRIX_TEMPO_WINDOW_MAX_SECONDS);
            tempoWindowSlider.step = String(WARPING_MATRIX_TEMPO_WINDOW_STEP_SECONDS);
            const tempoWindowValueNode = document.createElement('span');
            tempoWindowValueNode.className = 'warping-tempo-value';
            windowControl.appendChild(windowLabel);
            windowControl.appendChild(tempoWindowSlider);
            windowControl.appendChild(tempoWindowValueNode);

            const yScaleControl = document.createElement('label');
            yScaleControl.className = 'warping-tempo-control';
            const yScaleLabel = document.createElement('span');
            yScaleLabel.className = 'warping-tempo-control-label';
            yScaleLabel.textContent = 'Y scale (±%)';
            const tempoYScaleSlider = document.createElement('input');
            tempoYScaleSlider.className = 'warping-tempo-slider';
            tempoYScaleSlider.type = 'range';
            tempoYScaleSlider.min = String(WARPING_MATRIX_TEMPO_Y_RANGE_MIN_PERCENT);
            tempoYScaleSlider.max = String(WARPING_MATRIX_TEMPO_Y_RANGE_MAX_PERCENT);
            tempoYScaleSlider.step = String(WARPING_MATRIX_TEMPO_Y_RANGE_STEP_PERCENT);
            const tempoYScaleValueNode = document.createElement('span');
            tempoYScaleValueNode.className = 'warping-tempo-value';
            yScaleControl.appendChild(yScaleLabel);
            yScaleControl.appendChild(tempoYScaleSlider);
            yScaleControl.appendChild(tempoYScaleValueNode);

            tempoControls.appendChild(windowControl);
            tempoControls.appendChild(yScaleControl);
            tempoPanel.appendChild(tempoControls);

            const tempoDisabledOverlay = document.createElement('div');
            tempoDisabledOverlay.className = 'warping-matrix-disabled-overlay';
            tempoDisabledOverlay.textContent = 'SYNC mode';
            tempoPanel.appendChild(tempoDisabledOverlay);

            const persistedTempoControls = this.warpingMatrixTempoControlState.get(hostElement);
            const initialTempoWindowSeconds = normalizeTempoWindowSeconds(
                persistedTempoControls ? persistedTempoControls.windowSeconds : DEFAULT_WARPING_MATRIX_LOCAL_TEMPO_WINDOW_SECONDS
            );
            const initialTempoYHalfRangePercent = normalizeTempoYHalfRangePercent(
                persistedTempoControls ? persistedTempoControls.yHalfRangePercent : DEFAULT_WARPING_MATRIX_TEMPO_Y_HALF_RANGE_PERCENT
            );
            tempoWindowSlider.value = String(initialTempoWindowSeconds);
            tempoYScaleSlider.value = String(initialTempoYHalfRangePercent);

            const metadata: WarpingMatrixHostMetadata = {
                wrapper: wrapper,
                host: hostElement,
                matrixPanel: matrixPanel,
                matrixPlotHost: matrixPlotHost,
                matrixPlot: null,
                matrixDisabledOverlay: matrixDisabledOverlay,
                tempoPanel: tempoPanel,
                tempoPlotHost: tempoPlotHost,
                tempoPlot: null,
                tempoDisabledOverlay: tempoDisabledOverlay,
                tempoControls: tempoControls,
                tempoWindowSlider: tempoWindowSlider,
                tempoWindowValueNode: tempoWindowValueNode,
                tempoYScaleSlider: tempoYScaleSlider,
                tempoYScaleValueNode: tempoYScaleValueNode,
                matrixSeriesSignature: null,
                matrixDataCache: null,
                matrixDataCacheKey: null,
                tempoDataCache: null,
                tempoDataCacheKey: null,
                matrixDisabled: false,
                matrixTrackDuration: 1,
                configuredHeight: configuredHeight,
                tempoWindowSeconds: initialTempoWindowSeconds,
                tempoYHalfRangePercent: initialTempoYHalfRangePercent,
                colorByColumn: new Map<string, string>(),
                activeColumnKey: null,
                referenceDuration: 0,
                currentReferenceTime: 0,
                currentTrackTime: 0,
                matrixActivePointerId: null,
                lastSizeKey: null,
            };
            this.updateWarpingMatrixTempoControlLabels(metadata);
            this.persistWarpingMatrixTempoControls(metadata);

            const stopTempoControlPropagation = (event: Event) => {
                event.stopPropagation();
            };
            const tempoControlEvents: Array<keyof HTMLElementEventMap> = [
                'pointerdown',
                'pointermove',
                'pointerup',
                'pointercancel',
                'mousedown',
                'mousemove',
                'mouseup',
                'touchstart',
                'touchmove',
                'touchend',
                'touchcancel',
                'wheel',
            ];
            tempoControlEvents.forEach((eventName) => {
                tempoControls.addEventListener(eventName, stopTempoControlPropagation as EventListener, { passive: false });
            });

            tempoWindowSlider.addEventListener('input', () => {
                metadata.tempoWindowSeconds = normalizeTempoWindowSeconds(Number(tempoWindowSlider.value));
                tempoWindowSlider.value = String(metadata.tempoWindowSeconds);
                this.updateWarpingMatrixTempoControlLabels(metadata);
                this.persistWarpingMatrixTempoControls(metadata);
                this.renderWarpingMatrixTempoPlot(metadata);
            });
            tempoYScaleSlider.addEventListener('input', () => {
                metadata.tempoYHalfRangePercent = normalizeTempoYHalfRangePercent(Number(tempoYScaleSlider.value));
                tempoYScaleSlider.value = String(metadata.tempoYHalfRangePercent);
                this.updateWarpingMatrixTempoControlLabels(metadata);
                this.persistWarpingMatrixTempoControls(metadata);
                this.renderWarpingMatrixTempoPlot(metadata);
            });

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
            tempoPlotHost.addEventListener('wheel', (event) => {
                this.onWarpingTempoWheel(metadata, event);
            }, { passive: false });

            this.warpingMatrixHosts.push(metadata);
        });
    }

    private createWarpingMatrixPlotState(
        plotHost: HTMLElement,
        width: number,
        height: number
    ): WarpingMatrixPlotState {
        plotHost.textContent = '';

        const margins: WarpingPlotMargins = {
            top: 32,
            right: 16,
            bottom: 40,
            left: 52,
        };
        const innerWidth = Math.max(1, width - margins.left - margins.right);
        const innerHeight = Math.max(1, height - margins.top - margins.bottom);
        const clipId = 'warping-matrix-clip-' + this.warpingClipPathCounter;
        this.warpingClipPathCounter += 1;

        const svg = d3.select(plotHost)
            .append('svg')
            .attr('class', 'warping-plot-svg')
            .attr('width', width)
            .attr('height', height);

        const defs = svg.append('defs');
        const clipRect = defs
            .append('clipPath')
            .attr('id', clipId)
            .append('rect');

        const title = svg
            .append('text')
            .attr('class', 'warping-plot-title')
            .attr('text-anchor', 'middle')
            .text('Warping Path');

        const xAxis = svg
            .append('g')
            .attr('class', 'warping-plot-axis warping-plot-axis-x');
        const yAxis = svg
            .append('g')
            .attr('class', 'warping-plot-axis warping-plot-axis-y');

        const xLabel = svg
            .append('text')
            .attr('class', 'warping-plot-axis-label')
            .attr('text-anchor', 'middle')
            .text('Reference time (s)');
        const yLabel = svg
            .append('text')
            .attr('class', 'warping-plot-axis-label')
            .attr('text-anchor', 'middle')
            .text('Track time (s)');

        const plotRoot = svg
            .append('g')
            .attr('transform', 'translate(' + margins.left + ',' + margins.top + ')')
            .attr('clip-path', 'url(#' + clipId + ')');
        const pathLayer = plotRoot.append('g');

        const guideDiagonal = plotRoot
            .append('line')
            .attr('class', 'warping-guide-line');
        const playhead = plotRoot
            .append('circle')
            .attr('class', 'warping-playhead-dot')
            .attr('r', 4);

        const state: WarpingMatrixPlotState = {
            svg: svg,
            title: title,
            xAxis: xAxis,
            yAxis: yAxis,
            xLabel: xLabel,
            yLabel: yLabel,
            plotRoot: plotRoot,
            pathLayer: pathLayer,
            clipRect: clipRect,
            pathByColumn: new Map<string, PathSelection>(),
            guideDiagonal: guideDiagonal,
            playhead: playhead,
            xScale: d3.scaleLinear(),
            yScale: d3.scaleLinear(),
            margins: margins,
            innerWidth: innerWidth,
            innerHeight: innerHeight,
        };

        this.applyWarpingMatrixPlotDimensions(state, width, height);
        return state;
    }

    private createWarpingTempoPlotState(
        plotHost: HTMLElement,
        width: number,
        height: number
    ): WarpingTempoPlotState {
        plotHost.textContent = '';

        const margins: WarpingPlotMargins = {
            top: 32,
            right: 16,
            bottom: 40,
            left: 52,
        };
        const innerWidth = Math.max(1, width - margins.left - margins.right);
        const innerHeight = Math.max(1, height - margins.top - margins.bottom);
        const clipId = 'warping-tempo-clip-' + this.warpingClipPathCounter;
        this.warpingClipPathCounter += 1;

        const svg = d3.select(plotHost)
            .append('svg')
            .attr('class', 'warping-plot-svg')
            .attr('width', width)
            .attr('height', height);

        const defs = svg.append('defs');
        const clipRect = defs
            .append('clipPath')
            .attr('id', clipId)
            .append('rect');

        const title = svg
            .append('text')
            .attr('class', 'warping-plot-title')
            .attr('text-anchor', 'middle')
            .text('Tempo Deviation');

        const xAxis = svg
            .append('g')
            .attr('class', 'warping-plot-axis warping-plot-axis-x');
        const yAxis = svg
            .append('g')
            .attr('class', 'warping-plot-axis warping-plot-axis-y');

        const xLabel = svg
            .append('text')
            .attr('class', 'warping-plot-axis-label')
            .attr('text-anchor', 'middle')
            .text('Track time (s)');
        const yLabel = svg
            .append('text')
            .attr('class', 'warping-plot-axis-label')
            .attr('text-anchor', 'middle')
            .text('Tempo (%)');

        const plotRoot = svg
            .append('g')
            .attr('transform', 'translate(' + margins.left + ',' + margins.top + ')')
            .attr('clip-path', 'url(#' + clipId + ')');

        const baseline = plotRoot
            .append('line')
            .attr('class', 'warping-tempo-reference-line');
        const path = plotRoot
            .append('path')
            .attr('class', 'warping-tempo-line');
        const centerLine = plotRoot
            .append('line')
            .attr('class', 'warping-tempo-center-line');

        const state: WarpingTempoPlotState = {
            svg: svg,
            title: title,
            xAxis: xAxis,
            yAxis: yAxis,
            xLabel: xLabel,
            yLabel: yLabel,
            plotRoot: plotRoot,
            clipRect: clipRect,
            path: path,
            baseline: baseline,
            centerLine: centerLine,
            xScale: d3.scaleLinear(),
            yScale: d3.scaleLinear(),
            margins: margins,
            innerWidth: innerWidth,
            innerHeight: innerHeight,
        };

        this.applyWarpingTempoPlotDimensions(state, width, height);
        return state;
    }

    private applyWarpingMatrixPlotDimensions(
        plot: WarpingMatrixPlotState,
        width: number,
        height: number
    ): void {
        plot.innerWidth = Math.max(1, width - plot.margins.left - plot.margins.right);
        plot.innerHeight = Math.max(1, height - plot.margins.top - plot.margins.bottom);

        plot.svg
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', '0 0 ' + width + ' ' + height);
        plot.clipRect
            .attr('width', plot.innerWidth)
            .attr('height', plot.innerHeight);
        plot.plotRoot.attr('transform', 'translate(' + plot.margins.left + ',' + plot.margins.top + ')');
        plot.title
            .attr('x', width / 2)
            .attr('y', 20);
        plot.xAxis.attr('transform', 'translate(' + plot.margins.left + ',' + (plot.margins.top + plot.innerHeight) + ')');
        plot.yAxis.attr('transform', 'translate(' + plot.margins.left + ',' + plot.margins.top + ')');
        plot.xLabel
            .attr('x', plot.margins.left + (plot.innerWidth / 2))
            .attr('y', height - 8);
        plot.yLabel
            .attr('x', 0)
            .attr('y', 0)
            .attr('transform', 'translate(14,' + (plot.margins.top + (plot.innerHeight / 2)) + ') rotate(-90)');
    }

    private applyWarpingTempoPlotDimensions(
        plot: WarpingTempoPlotState,
        width: number,
        height: number
    ): void {
        plot.innerWidth = Math.max(1, width - plot.margins.left - plot.margins.right);
        plot.innerHeight = Math.max(1, height - plot.margins.top - plot.margins.bottom);

        plot.svg
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', '0 0 ' + width + ' ' + height);
        plot.clipRect
            .attr('width', plot.innerWidth)
            .attr('height', plot.innerHeight);
        plot.plotRoot.attr('transform', 'translate(' + plot.margins.left + ',' + plot.margins.top + ')');
        plot.title
            .attr('x', width / 2)
            .attr('y', 20);
        plot.xAxis.attr('transform', 'translate(' + plot.margins.left + ',' + (plot.margins.top + plot.innerHeight) + ')');
        plot.yAxis.attr('transform', 'translate(' + plot.margins.left + ',' + plot.margins.top + ')');
        plot.xLabel
            .attr('x', plot.margins.left + (plot.innerWidth / 2))
            .attr('y', height - 8);
        plot.yLabel
            .attr('x', 0)
            .attr('y', 0)
            .attr('transform', 'translate(14,' + (plot.margins.top + (plot.innerHeight / 2)) + ') rotate(-90)');
    }

    private isPointerInsidePlotArea(
        plotHost: HTMLElement,
        margins: WarpingPlotMargins,
        innerWidth: number,
        innerHeight: number,
        clientX: number,
        clientY: number
    ): boolean {
        const rect = plotHost.getBoundingClientRect();
        const pointerX = clientX - rect.left - margins.left;
        const pointerY = clientY - rect.top - margins.top;
        return pointerX >= 0 && pointerX <= innerWidth && pointerY >= 0 && pointerY <= innerHeight;
    }

    private onWarpingMatrixPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        if (!this.onWarpingMatrixSeek || !host.matrixPlot || host.matrixDisabled || event.button !== 0) {
            return;
        }

        const squareSize = this.getWarpingMatrixSquarePlotSize(host.matrixPlot);
        if (!this.isPointerInsidePlotArea(
            host.matrixPlotHost,
            host.matrixPlot.margins,
            squareSize,
            squareSize,
            event.clientX,
            event.clientY
        )) {
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

    private seekWarpingMatrixFromPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        if (!this.onWarpingMatrixSeek || !host.matrixPlot) {
            return;
        }

        const squareSize = this.getWarpingMatrixSquarePlotSize(host.matrixPlot);
        const rect = host.matrixPlotHost.getBoundingClientRect();
        const pointerX = clampTime(
            clientX - rect.left - host.matrixPlot.margins.left,
            0,
            squareSize
        );
        const referenceTime = host.matrixPlot.xScale.invert(pointerX);
        this.onWarpingMatrixSeek(clampTime(referenceTime, 0, Math.max(0.001, host.referenceDuration)));
    }

    private onWarpingTempoPointerDown(host: WarpingMatrixHostMetadata, event: PointerEvent): void {
        if (!this.onWarpingMatrixSeek || !host.tempoPlot || host.matrixDisabled || event.button !== 0) {
            return;
        }

        if (!this.isPointerInsidePlotArea(
            host.tempoPlotHost,
            host.tempoPlot.margins,
            host.tempoPlot.innerWidth,
            host.tempoPlot.innerHeight,
            event.clientX,
            event.clientY
        )) {
            return;
        }

        this.seekWarpingMatrixFromTempoPointerX(host, event.clientX);
        event.preventDefault();
    }

    private onWarpingTempoWheel(host: WarpingMatrixHostMetadata, event: WheelEvent): void {
        if (host.matrixDisabled) {
            return;
        }

        if (!Number.isFinite(event.deltaY) || event.deltaY === 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const currentWindow = this.getWarpingMatrixLocalTempoWindowSeconds(host);
        const zoomFactor = Math.exp(event.deltaY * 0.002);
        const nextWindow = normalizeTempoWindowSeconds(currentWindow * zoomFactor);
        if (Math.abs(nextWindow - currentWindow) < 0.0001) {
            return;
        }

        host.tempoWindowSeconds = nextWindow;
        host.tempoWindowSlider.value = String(nextWindow);
        this.updateWarpingMatrixTempoControlLabels(host);
        this.persistWarpingMatrixTempoControls(host);
        this.renderWarpingMatrixTempoPlot(host);
    }

    private seekWarpingMatrixFromTempoPointerX(host: WarpingMatrixHostMetadata, clientX: number): void {
        if (!this.onWarpingMatrixSeek || !host.tempoPlot) {
            return;
        }

        const primarySeries = this.getPrimaryWarpingSeriesData(host);
        if (!primarySeries || primarySeries.pointsByTrackTime.length === 0) {
            return;
        }

        const rect = host.tempoPlotHost.getBoundingClientRect();
        const pointerX = clampTime(
            clientX - rect.left - host.tempoPlot.margins.left,
            0,
            host.tempoPlot.innerWidth
        );
        const trackTime = host.tempoPlot.xScale.invert(pointerX);
        const referenceTime = this.interpolateWarpingReferenceTime(primarySeries.pointsByTrackTime, trackTime);
        this.onWarpingMatrixSeek(clampTime(referenceTime, 0, Math.max(0.001, host.referenceDuration)));
    }

    private getPrimaryWarpingSeriesData(host: WarpingMatrixHostMetadata): WarpingMatrixPathSeriesData | null {
        if (!host.matrixDataCache || !host.activeColumnKey) {
            return null;
        }

        return host.matrixDataCache.byColumn.get(host.activeColumnKey) || null;
    }

    private getPrimaryTempoSeries(host: WarpingMatrixHostMetadata): WarpingMatrixTempoPoint[] {
        if (!host.tempoDataCache || !host.activeColumnKey) {
            return [];
        }

        return host.tempoDataCache.byColumn.get(host.activeColumnKey) || [];
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
        const pathStrokeWidth = this.getWarpingMatrixPathStrokeWidth();
        host.matrixDisabled = context.syncEnabled;
        host.host.classList.toggle('warping-matrix-sync-disabled', host.matrixDisabled);
        host.matrixDisabledOverlay.style.display = host.matrixDisabled ? 'flex' : 'none';
        host.tempoDisabledOverlay.style.display = host.matrixDisabled ? 'flex' : 'none';
        host.tempoWindowSeconds = normalizeTempoWindowSeconds(Number(host.tempoWindowSlider.value));
        host.tempoYHalfRangePercent = normalizeTempoYHalfRangePercent(Number(host.tempoYScaleSlider.value));
        if (host.tempoWindowSlider.value !== String(host.tempoWindowSeconds)) {
            host.tempoWindowSlider.value = String(host.tempoWindowSeconds);
        }
        if (host.tempoYScaleSlider.value !== String(host.tempoYHalfRangePercent)) {
            host.tempoYScaleSlider.value = String(host.tempoYHalfRangePercent);
        }
        host.tempoWindowSlider.disabled = host.matrixDisabled;
        host.tempoYScaleSlider.disabled = host.matrixDisabled;
        this.updateWarpingMatrixTempoControlLabels(host);
        this.persistWarpingMatrixTempoControls(host);

        const renderedHeight = host.configuredHeight ?? Math.max(180, host.matrixPanel.clientHeight || 220);
        const fallbackHostWidth = Math.max(460, Math.round(host.host.clientWidth || host.wrapper.clientWidth || 720));
        const computedHostStyle = window.getComputedStyle(host.host);
        const resolvedGap = Number.parseFloat(computedHostStyle.columnGap || computedHostStyle.gap || '12');
        const panelGap = Number.isFinite(resolvedGap) ? Math.max(0, resolvedGap) : 12;
        const isStackedLayout = window.matchMedia('(max-width: 900px)').matches;

        let matrixRenderedWidth = 0;
        let tempoRenderedWidth = 0;
        if (isStackedLayout) {
            host.matrixPanel.style.flex = '1 1 auto';
            host.matrixPanel.style.width = '100%';
            host.tempoPanel.style.flex = '1 1 auto';
            host.tempoPanel.style.width = '100%';
            matrixRenderedWidth = Math.max(220, Math.round(host.matrixPanel.clientWidth || fallbackHostWidth));
            tempoRenderedWidth = Math.max(220, Math.round(host.tempoPanel.clientWidth || fallbackHostWidth));
        } else {
            // Keep the left panel roughly square relative to height and let the tempo panel absorb the rest.
            const desiredMatrixWidth = Math.max(220, Math.round(renderedHeight - 4));
            const maxMatrixWidth = Math.max(220, Math.round((fallbackHostWidth - panelGap) * 0.6));
            const minTempoWidth = 220;
            const matrixWidthByRemainingSpace = Math.max(220, Math.round(fallbackHostWidth - panelGap - minTempoWidth));
            matrixRenderedWidth = Math.min(desiredMatrixWidth, maxMatrixWidth, matrixWidthByRemainingSpace);

            host.matrixPanel.style.flex = '0 0 ' + matrixRenderedWidth + 'px';
            host.matrixPanel.style.width = matrixRenderedWidth + 'px';
            host.tempoPanel.style.flex = '1 1 auto';
            host.tempoPanel.style.width = 'auto';

            const fallbackTempoWidth = Math.max(220, Math.round(fallbackHostWidth - panelGap - matrixRenderedWidth));
            tempoRenderedWidth = Math.max(220, Math.round(host.tempoPanel.clientWidth || fallbackTempoWidth));
        }
        host.matrixPanel.style.height = renderedHeight + 'px';
        host.tempoPanel.style.height = renderedHeight + 'px';

        const measuredMatrixPlotWidth = Math.max(1, Math.round(host.matrixPlotHost.clientWidth || matrixRenderedWidth));
        const measuredMatrixPlotHeight = Math.max(1, Math.round(host.matrixPlotHost.clientHeight || renderedHeight));
        const measuredTempoPlotWidth = Math.max(1, Math.round(host.tempoPlotHost.clientWidth || tempoRenderedWidth));
        const measuredTempoPlotHeight = Math.max(1, Math.round(host.tempoPlotHost.clientHeight || renderedHeight));

        const sizeKey = [
            measuredMatrixPlotWidth,
            measuredMatrixPlotHeight,
            measuredTempoPlotWidth,
            measuredTempoPlotHeight,
        ].join(':');
        const sizeChanged = host.lastSizeKey !== sizeKey;
        host.lastSizeKey = sizeKey;

        host.colorByColumn.clear();
        const normalizedColumnOrder = context.columnOrder.length > 0
            ? context.columnOrder
            : context.trackSeries.map((series) => series.columnKey);
        normalizedColumnOrder.forEach((columnKey) => {
            host.colorByColumn.set(
                columnKey,
                this.resolveWarpingMatrixColumnColor(columnKey, normalizedColumnOrder)
            );
        });
        context.trackSeries.forEach((series) => {
            if (host.colorByColumn.has(series.columnKey)) {
                return;
            }

            host.colorByColumn.set(
                series.columnKey,
                this.resolveWarpingMatrixColumnColor(series.columnKey, normalizedColumnOrder)
            );
        });

        const matrixPrimarySeries = context.trackSeries.length > 0 ? context.trackSeries[0] : null;
        host.activeColumnKey = matrixPrimarySeries ? matrixPrimarySeries.columnKey : null;
        host.matrixTrackDuration = matrixPrimarySeries
            ? Math.max(
                resolveWarpingMatrixTrackDuration(matrixPrimarySeries.trackDuration, referenceDuration),
                resolveWarpingMatrixSeriesMaxTrackTime(matrixPrimarySeries.points, referenceDuration)
            )
            : Math.max(1, referenceDuration);

        const matrixSeriesSignature = context.trackSeries.map((series) => {
            return [
                series.columnKey,
                host.colorByColumn.get(series.columnKey) || WARPING_MATRIX_PRIMARY_COLOR,
                series.trackIndex,
            ].join(':');
        }).join('|') + '#' + pathStrokeWidth;

        if (!host.matrixPlot) {
            host.matrixPlot = this.createWarpingMatrixPlotState(
                host.matrixPlotHost,
                measuredMatrixPlotWidth,
                measuredMatrixPlotHeight
            );
        } else if (sizeChanged) {
            this.applyWarpingMatrixPlotDimensions(host.matrixPlot, measuredMatrixPlotWidth, measuredMatrixPlotHeight);
        }

        if (!host.tempoPlot) {
            host.tempoPlot = this.createWarpingTempoPlotState(
                host.tempoPlotHost,
                measuredTempoPlotWidth,
                measuredTempoPlotHeight
            );
        } else if (sizeChanged) {
            this.applyWarpingTempoPlotDimensions(host.tempoPlot, measuredTempoPlotWidth, measuredTempoPlotHeight);
        }
        host.matrixSeriesSignature = matrixSeriesSignature;

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

        const localTempoSlopeHalfWindowPoints = this.getWarpingMatrixLocalTempoSlopeHalfWindowPoints();
        const tempoDataCacheKey = matrixDataCacheKey + '#w' + localTempoSlopeHalfWindowPoints;
        if (host.tempoDataCacheKey !== tempoDataCacheKey) {
            host.tempoDataCache = this.buildWarpingTempoData(context.trackSeries, localTempoSlopeHalfWindowPoints);
            host.tempoDataCacheKey = tempoDataCacheKey;
        }

        const primarySeriesData = this.getPrimaryWarpingSeriesData(host);
        host.currentTrackTime = primarySeriesData
            ? clampTime(
                this.interpolateWarpingTrackTime(primarySeriesData.pointsByReferenceTime, host.currentReferenceTime),
                0,
                Math.max(0.001, primarySeriesData.trackDuration)
            )
            : 0;

        this.renderWarpingMatrixPathPlot(host, pathStrokeWidth);
        this.renderWarpingMatrixTempoPlot(host);
    }

    private renderWarpingMatrixPathPlot(host: WarpingMatrixHostMetadata, pathStrokeWidth: number): void {
        if (!host.matrixPlot) {
            return;
        }

        const plot = host.matrixPlot;
        const referenceDuration = Math.max(0.001, host.referenceDuration);
        const trackDuration = Math.max(0.001, host.matrixTrackDuration);
        const squareSize = this.getWarpingMatrixSquarePlotSize(plot);

        plot.xScale
            .domain([0, referenceDuration])
            .range([0, squareSize]);
        plot.yScale
            .domain([0, trackDuration])
            .range([squareSize, 0]);

        plot.clipRect
            .attr('width', squareSize)
            .attr('height', squareSize);
        plot.xAxis.attr('transform', 'translate(' + plot.margins.left + ',' + (plot.margins.top + squareSize) + ')');
        plot.yAxis.attr('transform', 'translate(' + plot.margins.left + ',' + plot.margins.top + ')');
        plot.xLabel
            .attr('x', plot.margins.left + (squareSize / 2));
        plot.yLabel
            .attr('transform', 'translate(14,' + (plot.margins.top + (squareSize / 2)) + ') rotate(-90)');

        const xTickCount = Math.max(2, Math.round(squareSize / 90));
        const yTickCount = Math.max(2, Math.round(squareSize / 60));
        plot.xAxis.call(d3.axisBottom(plot.xScale).ticks(xTickCount));
        plot.yAxis.call(d3.axisLeft(plot.yScale).ticks(yTickCount));

        const line = d3.line<WarpingMatrixPathPoint>()
            .defined((point) => {
                return Number.isFinite(point.referenceTime) && Number.isFinite(point.trackTime);
            })
            .x((point) => plot.xScale(point.referenceTime))
            .y((point) => plot.yScale(point.trackTime));

        const availableColumns = new Set<string>();
        if (host.matrixDataCache) {
            host.matrixDataCache.byColumn.forEach((seriesData, columnKey) => {
                availableColumns.add(columnKey);
                let path = plot.pathByColumn.get(columnKey);
                if (!path) {
                    path = plot.pathLayer
                        .append('path')
                        .attr('class', 'warping-path-line');
                    plot.pathByColumn.set(columnKey, path);
                }

                path
                    .attr('stroke', host.colorByColumn.get(columnKey) || WARPING_MATRIX_PRIMARY_COLOR)
                    .attr('stroke-width', pathStrokeWidth)
                    .attr('d', line(seriesData.pointsByReferenceTime) || null);
            });
        }

        Array.from(plot.pathByColumn.keys()).forEach((columnKey) => {
            if (availableColumns.has(columnKey)) {
                return;
            }

            const stalePath = plot.pathByColumn.get(columnKey);
            stalePath?.remove();
            plot.pathByColumn.delete(columnKey);
        });

        const xDomain = plot.xScale.domain();
        const yDomain = plot.yScale.domain();
        const xMin = Math.min(xDomain[0], xDomain[1]);
        const xMax = Math.max(xDomain[0], xDomain[1]);
        const yMin = Math.min(yDomain[0], yDomain[1]);
        const yMax = Math.max(yDomain[0], yDomain[1]);
        const diagonalStart = Math.max(xMin, yMin);
        const diagonalEnd = Math.min(xMax, yMax);
        if (diagonalEnd <= diagonalStart) {
            plot.guideDiagonal.style('display', 'none');
        } else {
            plot.guideDiagonal
                .style('display', null)
                .attr('x1', plot.xScale(diagonalStart))
                .attr('y1', plot.yScale(diagonalStart))
                .attr('x2', plot.xScale(diagonalEnd))
                .attr('y2', plot.yScale(diagonalEnd));
        }

        const primarySeriesData = this.getPrimaryWarpingSeriesData(host);
        if (!primarySeriesData || primarySeriesData.pointsByReferenceTime.length === 0) {
            plot.playhead.style('display', 'none');
            return;
        }

        const playheadReferenceTime = clampTime(host.currentReferenceTime, 0, referenceDuration);
        const playheadTrackTime = clampTime(
            this.interpolateWarpingTrackTime(primarySeriesData.pointsByReferenceTime, playheadReferenceTime),
            0,
            Math.max(0.001, primarySeriesData.trackDuration)
        );
        const playheadColor = host.activeColumnKey
            ? (host.colorByColumn.get(host.activeColumnKey) || WARPING_MATRIX_PRIMARY_COLOR)
            : WARPING_MATRIX_PRIMARY_COLOR;
        plot.playhead
            .style('display', null)
            .attr('fill', playheadColor)
            .attr('cx', plot.xScale(playheadReferenceTime))
            .attr('cy', plot.yScale(playheadTrackTime))
            .raise();
    }

    private renderWarpingMatrixTempoPlot(host: WarpingMatrixHostMetadata): void {
        if (!host.tempoPlot) {
            return;
        }

        const tempoPlot = host.tempoPlot;
        const primarySeriesData = this.getPrimaryWarpingSeriesData(host);
        const tempoSeries = this.getPrimaryTempoSeries(host);
        const trackDuration = primarySeriesData ? Math.max(0.001, primarySeriesData.trackDuration) : 0.001;
        const windowSeconds = this.getWarpingMatrixLocalTempoWindowSeconds(host);
        const xDomain = this.resolveCenteredWarpingWindow(host.currentTrackTime, windowSeconds, trackDuration);
        const tempoYHalfRangePercent = this.getWarpingMatrixTempoYHalfRangePercent(host);

        tempoPlot.xScale
            .domain(xDomain)
            .range([0, tempoPlot.innerWidth]);

        const yDomain: [number, number] = [100 - tempoYHalfRangePercent, 100 + tempoYHalfRangePercent];
        tempoPlot.yScale
            .domain(yDomain)
            .range([tempoPlot.innerHeight, 0]);

        const xTickCount = Math.max(2, Math.round(tempoPlot.innerWidth / 90));
        const yTickCount = Math.max(5, Math.round(tempoPlot.innerHeight / 35));
        tempoPlot.xAxis.call(d3.axisBottom(tempoPlot.xScale).ticks(xTickCount));
        tempoPlot.yAxis.call(
            d3.axisLeft(tempoPlot.yScale)
                .ticks(yTickCount)
                .tickFormat((tickValue) => {
                    const numericTick = Number(tickValue);
                    if (!Number.isFinite(numericTick) || numericTick < 0) {
                        return '';
                    }

                    return String(Math.round(numericTick));
                })
        );

        const tempoLine = d3.line<WarpingMatrixTempoPoint>()
            .defined((point) => {
                return Number.isFinite(point.trackTime)
                    && Number.isFinite(point.tempoPercent)
                    && point.trackTime >= xDomain[0]
                    && point.trackTime <= xDomain[1];
            })
            .x((point) => tempoPlot.xScale(point.trackTime))
            .y((point) => tempoPlot.yScale(point.tempoPercent));

        const activeColor = host.activeColumnKey
            ? (host.colorByColumn.get(host.activeColumnKey) || WARPING_MATRIX_PRIMARY_COLOR)
            : WARPING_MATRIX_PRIMARY_COLOR;
        tempoPlot.path
            .attr('stroke', activeColor)
            .attr('d', tempoLine(tempoSeries) || null);

        const baselineY = tempoPlot.yScale(100);
        tempoPlot.baseline
            .attr('x1', 0)
            .attr('x2', tempoPlot.innerWidth)
            .attr('y1', baselineY)
            .attr('y2', baselineY);

        const centerX = tempoPlot.xScale((xDomain[0] + xDomain[1]) / 2);
        tempoPlot.centerLine
            .attr('x1', centerX)
            .attr('x2', centerX)
            .attr('y1', 0)
            .attr('y2', tempoPlot.innerHeight)
            .raise();
    }

    private resolveCenteredWarpingWindow(
        center: number,
        windowSeconds: number,
        _maxTime: number
    ): [number, number] {
        const safeCenter = Number.isFinite(center) ? center : 0;
        const halfWindow = Math.max(0.0005, windowSeconds / 2);
        return [safeCenter - halfWindow, safeCenter + halfWindow];
    }

    private buildWarpingMatrixData(
        trackSeries: WarpingMatrixTrackSeries[],
        referenceDuration: number
    ): WarpingMatrixMatrixData {
        const byColumn = new Map<string, WarpingMatrixPathSeriesData>();

        trackSeries.forEach((series) => {
            const trackDuration = Math.max(
                resolveWarpingMatrixTrackDuration(series.trackDuration, referenceDuration),
                resolveWarpingMatrixSeriesMaxTrackTime(series.points, referenceDuration)
            );

            const pointsByReferenceTime = series.points
                .map((point) => {
                    return {
                        referenceTime: clampTime(point.referenceTime, 0, referenceDuration),
                        trackTime: clampTime(point.trackTime, 0, trackDuration),
                    };
                })
                .filter((point) => {
                    return Number.isFinite(point.referenceTime) && Number.isFinite(point.trackTime);
                })
                .sort((left, right) => {
                    if (left.referenceTime === right.referenceTime) {
                        return left.trackTime - right.trackTime;
                    }

                    return left.referenceTime - right.referenceTime;
                });

            if (pointsByReferenceTime.length === 0) {
                pointsByReferenceTime.push(
                    { referenceTime: 0, trackTime: 0 },
                    { referenceTime: referenceDuration, trackTime: trackDuration }
                );
            } else {
                const firstPoint = pointsByReferenceTime[0];
                if (firstPoint.referenceTime > 0) {
                    pointsByReferenceTime.unshift({
                        referenceTime: 0,
                        trackTime: this.interpolateWarpingTrackTime(pointsByReferenceTime, 0),
                    });
                }

                const lastPoint = pointsByReferenceTime[pointsByReferenceTime.length - 1];
                if (lastPoint.referenceTime < referenceDuration) {
                    pointsByReferenceTime.push({
                        referenceTime: referenceDuration,
                        trackTime: this.interpolateWarpingTrackTime(pointsByReferenceTime, referenceDuration),
                    });
                }
            }

            const pointsByTrackTime = pointsByReferenceTime.slice().sort((left, right) => {
                if (left.trackTime === right.trackTime) {
                    return left.referenceTime - right.referenceTime;
                }

                return left.trackTime - right.trackTime;
            });

            byColumn.set(series.columnKey, {
                pointsByReferenceTime: pointsByReferenceTime,
                pointsByTrackTime: pointsByTrackTime,
                trackDuration: trackDuration,
            });
        });

        return { byColumn };
    }

    private buildWarpingTempoData(
        trackSeries: WarpingMatrixTrackSeries[],
        halfWindowPoints: number
    ): WarpingMatrixTempoData {
        const byColumn = new Map<string, WarpingMatrixTempoPoint[]>();
        const normalizedHalfWindow = Math.max(1, Math.round(halfWindowPoints));

        trackSeries.forEach((series) => {
            const points = series.points
                .filter((point) => {
                    return Number.isFinite(point.referenceTime) && Number.isFinite(point.trackTime);
                })
                .map((point) => {
                    return {
                        referenceTime: point.referenceTime,
                        trackTime: point.trackTime,
                    };
                })
                .sort((left, right) => left.referenceTime - right.referenceTime);

            if (points.length < (normalizedHalfWindow * 2) + 1) {
                byColumn.set(series.columnKey, []);
                return;
            }

            const tempoPoints: WarpingMatrixTempoPoint[] = [];
            for (let index = normalizedHalfWindow; index < points.length - normalizedHalfWindow; index += 1) {
                const left = points[index - normalizedHalfWindow];
                const right = points[index + normalizedHalfWindow];
                const center = points[index];

                const referenceDelta = right.referenceTime - left.referenceTime;
                const trackDelta = right.trackTime - left.trackTime;
                if (!Number.isFinite(referenceDelta) || !Number.isFinite(trackDelta) || referenceDelta <= 0) {
                    continue;
                }

                const tempoPercent = (trackDelta / referenceDelta) * 100;
                if (!Number.isFinite(tempoPercent)) {
                    continue;
                }

                tempoPoints.push({
                    trackTime: center.trackTime,
                    referenceTime: center.referenceTime,
                    tempoPercent: tempoPercent,
                });
            }

            tempoPoints.sort((left, right) => {
                if (left.trackTime === right.trackTime) {
                    return left.referenceTime - right.referenceTime;
                }

                return left.trackTime - right.trackTime;
            });
            byColumn.set(series.columnKey, tempoPoints);
        });

        return { byColumn };
    }

    private interpolateWarpingTrackTime(points: WarpingMatrixPathPoint[], referenceTime: number): number {
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

    private interpolateWarpingReferenceTime(pointsByTrackTime: WarpingMatrixPathPoint[], trackTime: number): number {
        if (!Array.isArray(pointsByTrackTime) || pointsByTrackTime.length === 0) {
            return 0;
        }

        if (pointsByTrackTime.length === 1) {
            return pointsByTrackTime[0].referenceTime;
        }

        const first = pointsByTrackTime[0];
        const last = pointsByTrackTime[pointsByTrackTime.length - 1];

        if (trackTime <= first.trackTime) {
            return first.referenceTime;
        }

        if (trackTime >= last.trackTime) {
            return last.referenceTime;
        }

        let leftIndex = 0;
        let rightIndex = pointsByTrackTime.length - 1;

        while (leftIndex <= rightIndex) {
            const middleIndex = Math.floor((leftIndex + rightIndex) / 2);
            const middle = pointsByTrackTime[middleIndex];

            if (middle.trackTime === trackTime) {
                return middle.referenceTime;
            }

            if (middle.trackTime < trackTime) {
                leftIndex = middleIndex + 1;
            } else {
                rightIndex = middleIndex - 1;
            }
        }

        const rightPoint = pointsByTrackTime[Math.min(pointsByTrackTime.length - 1, leftIndex)];
        const leftPoint = pointsByTrackTime[Math.max(0, leftIndex - 1)];
        const range = rightPoint.trackTime - leftPoint.trackTime;
        if (!Number.isFinite(range) || range <= 0) {
            return leftPoint.referenceTime;
        }

        const ratio = (trackTime - leftPoint.trackTime) / range;
        return leftPoint.referenceTime + ((rightPoint.referenceTime - leftPoint.referenceTime) * ratio);
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
