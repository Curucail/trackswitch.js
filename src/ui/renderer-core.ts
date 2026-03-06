import { NormalizedTrackGroupLayout, TrackRuntime } from '../domain/types';
import { escapeHtml, sanitizeInlineStyle } from '../shared/dom';
import { formatSecondsToHHMMSSmmm } from '../shared/format';
import { clampPercent } from '../shared/math';
import * as d3 from 'd3';
import { getHostIconSlot, renderIconSlotHtml, setHostIcon } from './icons';

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

function applySoloIconState(
    soloButton: HTMLElement,
    isChecked: boolean,
    isRadio: boolean,
    syncEnabled: boolean
): void {
    if (!isChecked) {
        setHostIcon(soloButton, 'circle');
        return;
    }

    if (isRadio && !syncEnabled) {
        setHostIcon(soloButton, 'circle-dot');
        return;
    }

    setHostIcon(soloButton, 'circle-check');
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

export function query(ctx: any, selector: any): any {
    return (function(this: any, selector: any) {
        return this.root.querySelector(selector);
    
    }).call(ctx, selector);
}

export function queryAll(ctx: any, selector: any): any {
    return (function(this: any, selector: any) {
        return Array.from(this.root.querySelectorAll(selector)) as HTMLElement[];
    
    }).call(ctx, selector);
}

export function initialize(ctx: any, runtimes: any): any {
    return (function(this: any, runtimes: any) {
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
            this.queryAll('.main-control .seekwrap').forEach(function(seekWrap: HTMLElement) {
                setDisplay(seekWrap, 'none');
            });
        }

        this.updateTiming(0, 0);
        this.updateVolumeIcon(1);
    
    }).call(ctx, runtimes);
}

export function buildMainControlHtml(ctx: any, runtimes: any): any {
    return (function(this: any, runtimes: any) {
        let presetDropdownHtml = '';
        if (this.features.presets && this.presetNames.length >= 2) {
            presetDropdownHtml += '<li class="preset-selector-wrap"><select class="preset-selector" title="Select Preset">';
            for (let i = 0; i < this.presetNames.length; i += 1) {
                presetDropdownHtml += '<option value="' + i + '"' + (i === 0 ? ' selected' : '') + '>'
                    + escapeHtml(this.presetNames[i]) + '</option>';
            }
            presetDropdownHtml += '</select></li>';
        }

        return '<div class="overlay"><span class="activate">Activate'
            + renderIconSlotHtml('power-off')
            + '</span>'
            + '<p id="overlaytext"></p>'
            + '<p id="overlayinfo">'
            + '<span class="info">Info' + renderIconSlotHtml('circle-info') + '</span>'
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
            + '<li class="playpause button" title="Play/Pause (Spacebar)">Play'
            + renderIconSlotHtml('play')
            + '</li>'
            + '<li class="stop button" title="Stop (Esc)">Stop'
            + renderIconSlotHtml('stop')
            + '</li>'
            + '<li class="repeat button" title="Repeat (R)">Repeat'
            + renderIconSlotHtml('rotate-right')
            + '</li>'
            + (this.shouldRenderGlobalSync(runtimes)
                ? '<li class="sync-global button" title="Use synchronized version">SYNC</li>'
                : '')
            + '</ul>'
            + '</li>'
            + (this.features.globalVolume
                ? '<li class="volume"><div class="volume-control"><i class="volume-icon">'
                    + renderIconSlotHtml('volume-high')
                    + '</i>'
                    + '<input type="range" class="volume-slider" min="0" max="100" value="100"></div></li>'
                : '')
            + (this.features.looping
                ? '<li class="loop-group"><ul class="loop-controls">'
                    + '<li class="loop-a button" title="Set Loop Point A (A)">Loop A</li>'
                    + '<li class="loop-b button" title="Set Loop Point B (B)">Loop B</li>'
                    + '<li class="loop-toggle button" title="Toggle Loop On/Off (L)">Loop'
                    + renderIconSlotHtml('repeat')
                    + '</li>'
                    + '<li class="loop-clear button" title="Clear Loop Points (C)">Clear'
                    + renderIconSlotHtml('xmark')
                    + '</li>'
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
    
    }).call(ctx, runtimes);
}

export function shouldRenderGlobalSync(ctx: any, runtimes: any): any {
    return (function(this: any, runtimes: any) {
        if (this.features.mode !== 'alignment') {
            return false;
        }

        return runtimes.some(function(runtime: TrackRuntime) {
            const sources = runtime.definition.alignment?.synchronizedSources;
            return Array.isArray(sources) && sources.length > 0;
        });
    
    }).call(ctx, runtimes);
}

export function buildTrackRow(ctx: any, runtime: any, index: any): any {
    return (function(this: any, runtime: any, index: any) {
        const tabviewClass = this.features.tabView ? ' tabs' : '';
        const radioSoloClass = this.features.exclusiveSolo ? ' radio' : '';
        const wholeSoloClass = this.features.exclusiveSolo ? ' solo' : '';

        const track = document.createElement('li');
        track.className = 'track' + tabviewClass + wholeSoloClass;
        track.setAttribute('style', sanitizeInlineStyle(runtime.definition.style || ''));
        track.setAttribute('data-track-index', String(index));

        const errorIndicator = document.createElement('span');
        errorIndicator.className = 'track-error-indicator';
        errorIndicator.innerHTML = renderIconSlotHtml('triangle-exclamation')
            + '<span class="track-error-text">ERROR</span>';
        track.appendChild(errorIndicator);

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
        solo.insertAdjacentHTML('beforeend', renderIconSlotHtml('circle'));
        controls.appendChild(solo);

        track.appendChild(controls);

        if (this.features.trackMixControls) {
            const mixControls = document.createElement('div');
            mixControls.className = 'track-mix-controls';

            const volumeControl = document.createElement('div');
            volumeControl.className = 'track-volume-control';

            const volumeIcon = document.createElement('i');
            volumeIcon.className = 'volume-icon track-volume-icon';
            volumeIcon.innerHTML = renderIconSlotHtml('volume-high');

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
    
    }).call(ctx, runtime, index);
}

export function renderTrackList(ctx: any, runtimes: any): any {
    return (function(this: any, runtimes: any) {
        this.queryAll('.track_list').forEach(function(existing: HTMLElement) {
            existing.remove();
        });

        if (this.trackGroups.length === 0) {
            const list = document.createElement('ul');
            list.className = 'track_list';

            runtimes.forEach((runtime: TrackRuntime, index: number) => {
                list.appendChild(this.buildTrackRow(runtime, index));
            });

            this.root.appendChild(list);
            return;
        }

        this.trackGroups.forEach((group: NormalizedTrackGroupLayout) => {
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
    
    }).call(ctx, runtimes);
}

export function wrapSeekableImages(ctx: any): any {
    return (function(this: any) {
        const candidates = this.queryAll('.seekable');

        candidates.forEach((candidate: HTMLElement) => {
            if (!(candidate instanceof HTMLImageElement)) {
                return;
            }

            if (candidate.parentElement?.classList.contains('seekable-img-wrap')) {
                return;
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
    
    }).call(ctx);
}

export function wrapSheetMusicContainers(ctx: any): any {
    return (function(this: any) {
        this.sheetMusicHosts.length = 0;

        const hosts = this.root.querySelectorAll('.sheetmusic');
        hosts.forEach((hostElement: Element) => {
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
    
    }).call(ctx);
}

export function getPreparedSheetMusicHosts(ctx: any): any {
    return (function(this: any) {
        return this.sheetMusicHosts.map((entry: SheetMusicHostConfig) => {
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
    
    }).call(ctx);
}

export function updateMainControls(ctx: any, state: any, runtimes: any, waveformTimelineContext: any, warpingMatrixContext: any): any {
    return (function(this: any, state: any, runtimes: any, waveformTimelineContext: any, warpingMatrixContext: any) {
        this.root.classList.toggle('sync-enabled', state.syncEnabled);

        this.queryAll('.playpause').forEach((element: HTMLElement) => {
            element.classList.toggle('checked', state.playing);
            setHostIcon(element, state.playing ? 'pause' : 'play');
        });

        this.queryAll('.repeat').forEach(function(element: HTMLElement) {
            element.classList.toggle('checked', state.repeat);
        });

        this.queryAll('.sync-global').forEach(function(element: HTMLElement) {
            element.classList.toggle('checked', state.syncEnabled);
            element.classList.toggle('disabled', !state.syncAvailable);
        });

        const seekWraps = this.queryAll('.seekwrap');
        seekWraps.forEach((seekWrap: HTMLElement) => {
            this.updateSeekWrapVisuals(seekWrap, state.position, state.longestDuration, state.loop);
        });

        this.applyFixedWaveformLocalSeekVisuals(state, waveformTimelineContext);

        if (this.features.timer) {
            this.updateTiming(state.position, state.longestDuration);
        }

        this.updateWaveformTiming(state, runtimes, waveformTimelineContext);
        this.updateWaveformZoomIndicators();
        this.warpingMatrixHosts.forEach((host: WarpingMatrixHostMetadata) => {
            this.updateWarpingMatrix(host, warpingMatrixContext);
        });

        if (!this.features.looping) {
            return;
        }

        this.queryAll('.loop-a').forEach(function(element: HTMLElement) {
            element.classList.toggle('checked', state.loop.pointA !== null);
            element.classList.toggle('active', state.loop.enabled);
        });

        this.queryAll('.loop-b').forEach(function(element: HTMLElement) {
            element.classList.toggle('checked', state.loop.pointB !== null);
            element.classList.toggle('active', state.loop.enabled);
        });

        this.queryAll('.loop-toggle').forEach(function(element: HTMLElement) {
            element.classList.toggle('checked', state.loop.enabled);
        });

    
    }).call(ctx, state, runtimes, waveformTimelineContext, warpingMatrixContext);
}

export function updateTrackControls(
    ctx: any,
    runtimes: any,
    syncLockedTrackIndexes: any,
    effectiveSingleSoloMode: any,
    panSupported: any,
    syncEnabled: any
): any {
    return (function(
        this: any,
        runtimes: any,
        syncLockedTrackIndexes: any,
        effectiveSingleSoloMode: any,
        panSupported: any,
        syncEnabled: any
    ) {
        runtimes.forEach((runtime: TrackRuntime, index: number) => {
            const row = this.query('.track[data-track-index="' + index + '"]');
            if (!row) {
                return;
            }

            const solo = row.querySelector('.solo');
            const isLocked = !!syncLockedTrackIndexes && syncLockedTrackIndexes.has(index);

            row.classList.toggle('solo', effectiveSingleSoloMode);

            if (solo instanceof HTMLElement) {
                solo.classList.toggle('checked', runtime.state.solo);
                solo.classList.toggle('disabled', isLocked);
                solo.classList.toggle('radio', effectiveSingleSoloMode);
                applySoloIconState(
                    solo,
                    runtime.state.solo,
                    effectiveSingleSoloMode,
                    !!syncEnabled
                );
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
    
    }).call(ctx, runtimes, syncLockedTrackIndexes, effectiveSingleSoloMode, panSupported, syncEnabled);
}

export function switchPosterImage(ctx: any, runtimes: any): any {
    return (function(this: any, runtimes: any) {
        let soloCount = 0;
        let imageSrc: string | null = null;
        const switchTargets = this.queryAll('img[data-per-track-image="true"]');

        runtimes.forEach(function(runtime: TrackRuntime) {
            if (runtime.state.solo) {
                soloCount += 1;
                const configuredImage = typeof runtime.definition.image === 'string'
                    ? runtime.definition.image.trim()
                    : '';
                if (configuredImage) {
                    imageSrc = configuredImage;
                }
            }
        });

        if (switchTargets.length === 0) {
            return;
        }

        switchTargets.forEach((element: HTMLElement) => {
            if (!(element instanceof HTMLImageElement)) {
                return;
            }

            const nextSrc = soloCount === 1 && imageSrc
                ? imageSrc
                : null;
            const container = element.parentElement?.classList.contains('seekable-img-wrap')
                ? element.parentElement
                : element;

            if (!nextSrc) {
                setDisplay(container, 'none');
                setDisplay(element, 'none');
                return;
            }

            setDisplay(container, '');
            setDisplay(element, '');

            const currentSrc = element.getAttribute('data-per-track-current-src');
            if (currentSrc !== nextSrc) {
                element.src = nextSrc;
                element.setAttribute('data-per-track-current-src', nextSrc);
            }
        });
    
    }).call(ctx, runtimes);
}

export function setVolumeSlider(ctx: any, volumeZeroToOne: any): any {
    return (function(this: any, volumeZeroToOne: any) {
        const slider = this.query('.main-control .volume-slider');
        if (!slider || !(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(volumeZeroToOne * 100));
        this.updateVolumeIcon(volumeZeroToOne);
    
    }).call(ctx, volumeZeroToOne);
}

export function setTrackVolumeSlider(ctx: any, trackIndex: any, volumeZeroToOne: any): any {
    return (function(this: any, trackIndex: any, volumeZeroToOne: any) {
        const row = this.query('.track[data-track-index="' + trackIndex + '"]');
        if (!row) {
            return;
        }

        const slider = row.querySelector('.track-volume-slider');
        if (!(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(sanitizeVolume(volumeZeroToOne) * 100));
    
    }).call(ctx, trackIndex, volumeZeroToOne);
}

export function setTrackPanSlider(ctx: any, trackIndex: any, panMinusOneToOne: any): any {
    return (function(this: any, trackIndex: any, panMinusOneToOne: any) {
        const row = this.query('.track[data-track-index="' + trackIndex + '"]');
        if (!row) {
            return;
        }

        const slider = row.querySelector('.track-pan-slider');
        if (!(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(sanitizePan(panMinusOneToOne) * 100));
    
    }).call(ctx, trackIndex, panMinusOneToOne);
}

export function updateVolumeIcon(ctx: any, volumeZeroToOne: any): any {
    return (function(this: any, volumeZeroToOne: any) {
        this.queryAll('.main-control .volume-control .volume-icon').forEach((icon: HTMLElement) => {
            this.applyVolumeIconState(icon, volumeZeroToOne);
        });
    
    }).call(ctx, volumeZeroToOne);
}

export function applyVolumeIconState(ctx: any, icon: any, volumeZeroToOne: any): any {
    return (function(this: any, icon: any, volumeZeroToOne: any) {
        const volume = sanitizeVolume(volumeZeroToOne);
        if (volume === 0) {
            setHostIcon(icon, 'volume-xmark');
        } else if (volume <= (1 / 3)) {
            setHostIcon(icon, 'volume-low');
        } else if (volume <= (2 / 3)) {
            setHostIcon(icon, 'volume');
        } else {
            setHostIcon(icon, 'volume-high');
        }
    
    }).call(ctx, icon, volumeZeroToOne);
}

export function setOverlayLoading(ctx: any, isLoading: any): any {
    return (function(this: any, isLoading: any) {
        this.queryAll('.overlay .activate').forEach(function(activate: HTMLElement) {
            activate.classList.toggle('loading', isLoading);
            setHostIcon(activate, isLoading ? 'spinner' : 'power-off');

            const iconSlot = getHostIconSlot(activate);
            if (iconSlot) {
                iconSlot.classList.toggle('is-spinning', isLoading);
            }
        });

        this.queryAll('.overlay').forEach(function(overlay: HTMLElement) {
            overlay.classList.toggle('loading', isLoading);
        });
    
    }).call(ctx, isLoading);
}

export function showOverlayInfoText(ctx: any): any {
    return (function(this: any) {
        this.queryAll('.overlay .info').forEach(function(info: HTMLElement) {
            setDisplay(info, 'none');
        });

        this.queryAll('.overlay .text').forEach(function(text: HTMLElement) {
            setDisplay(text, 'block');
        });
    
    }).call(ctx);
}

export function hideOverlayOnLoaded(ctx: any): any {
    return (function(this: any) {
        this.queryAll('.overlay').forEach(function(overlay: HTMLElement) {
            overlay.remove();
        });
    
    }).call(ctx);
}

export function showError(ctx: any, message: any, runtimes: any): any {
    return (function(this: any, message: any, runtimes: any) {
        this.root.classList.add('error');

        this.queryAll('.overlay .activate').forEach(function(activate: HTMLElement) {
            activate.classList.remove('loading');
            setHostIcon(activate, 'exclamation');

            const iconSlot = getHostIconSlot(activate);
            if (iconSlot) {
                iconSlot.classList.remove('is-spinning');
            }
        });

        const overlayText = this.query('#overlaytext');
        if (overlayText) {
            overlayText.textContent = message;
        }

        runtimes.forEach((runtime: TrackRuntime, index: number) => {
            if (!runtime.errored) {
                return;
            }

            const row = this.query('.track[data-track-index="' + index + '"]');
            if (row) {
                row.classList.add('error');
            }
        });
    
    }).call(ctx, message, runtimes);
}

export function destroy(ctx: any): any {
    return (function(this: any) {
        this.queryAll('.main-control').forEach(function(mainControl: HTMLElement) {
            mainControl.remove();
        });

        this.queryAll('.track_list').forEach(function(trackList: HTMLElement) {
            trackList.remove();
        });

        this.sheetMusicHosts.length = 0;
        this.warpingMatrixHosts.length = 0;
    
    }).call(ctx);
}

export function getPresetCount(ctx: any): any {
    return (function(this: any) {
        return this.presetNames.length;
    
    }).call(ctx);
}

export function updateTiming(ctx: any, position: any, longestDuration: any): any {
    return (function(this: any, position: any, longestDuration: any) {
        this.queryAll('.timing .time').forEach(function(node: HTMLElement) {
            node.textContent = formatSecondsToHHMMSSmmm(position);
        });

        this.queryAll('.timing .length').forEach(function(node: HTMLElement) {
            node.textContent = formatSecondsToHHMMSSmmm(longestDuration);
        });
    
    }).call(ctx, position, longestDuration);
}
