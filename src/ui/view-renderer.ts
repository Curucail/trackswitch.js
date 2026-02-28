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

interface WaveformSeekSurfaceMetadata {
    wrapper: HTMLElement;
    surface: HTMLElement;
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D | null;
    seekWrap: HTMLElement;
    waveformSource: 'audible' | number;
    originalHeight: number;
    barWidth: number;
    baseWidth: number;
    zoom: number;
    timingNode: HTMLElement | null;
}

const MIN_WAVEFORM_ZOOM = 1;
const MAX_WAVEFORM_ZOOM = 15;

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

function clampWaveformZoom(zoom: number): number {
    if (!Number.isFinite(zoom)) {
        return MIN_WAVEFORM_ZOOM;
    }

    return clampTime(zoom, MIN_WAVEFORM_ZOOM, MAX_WAVEFORM_ZOOM);
}

export class ViewRenderer {
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly presetNames: string[];

    private originalImage = '';
    private readonly waveformSeekSurfaces: WaveformSeekSurfaceMetadata[] = [];

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

    initialize(runtimes: TrackRuntime[]): void {
        this.root.classList.add('trackswitch');

        if (!this.query('.main-control')) {
            this.root.insertAdjacentHTML('afterbegin', this.buildMainControlHtml(runtimes));
        }

        this.wrapSeekableImages();
        this.wrapWaveformCanvases();
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
            const originalHeight = canvasElement.height;

            const wrapper = document.createElement('div');
            wrapper.className = 'waveform-wrap';
            wrapper.setAttribute('style', sanitizeInlineStyle(canvasElement.getAttribute('data-waveform-style')) + '; display: block;');
            const surface = document.createElement('div');
            surface.className = 'waveform-surface';

            const parent = canvasElement.parentElement;
            if (!parent) {
                return;
            }

            parent.insertBefore(wrapper, canvasElement);
            wrapper.appendChild(surface);
            surface.appendChild(canvasElement);
            surface.insertAdjacentHTML(
                'beforeend',
                buildSeekWrap(
                    clampPercent(canvasElement.getAttribute('data-seek-margin-left')),
                    clampPercent(canvasElement.getAttribute('data-seek-margin-right'))
                )
            );

            const seekWrap = surface.querySelector('.seekwrap');
            if (seekWrap instanceof HTMLElement) {
                seekWrap.setAttribute('data-seek-surface', 'waveform');
                seekWrap.setAttribute('data-waveform-source', String(waveformSource));
                const timingNode = this.features.mode === 'alignment'
                    ? this.createWaveformTimingNode(wrapper)
                    : null;
                this.waveformSeekSurfaces.push({
                    wrapper: wrapper,
                    surface: surface,
                    canvas: canvasElement,
                    context: canvasElement.getContext('2d'),
                    seekWrap: seekWrap,
                    waveformSource: waveformSource,
                    originalHeight: originalHeight,
                    barWidth: barWidth,
                    baseWidth: this.resolveWaveformBaseWidth(wrapper, canvasElement.width),
                    zoom: MIN_WAVEFORM_ZOOM,
                    timingNode: timingNode,
                });
            }
        });
    }

    private createWaveformTimingNode(wrapper: HTMLElement): HTMLElement {
        const timing = document.createElement('div');
        timing.className = 'waveform-timing';
        timing.textContent = '--:--:--:--- / --:--:--:---';
        wrapper.appendChild(timing);
        return timing;
    }

    private resolveWaveformBaseWidth(wrapper: HTMLElement, fallback: number): number {
        const wrapperWidth = wrapper.clientWidth;
        if (Number.isFinite(wrapperWidth) && wrapperWidth > 0) {
            return Math.max(1, Math.round(wrapperWidth));
        }

        if (Number.isFinite(fallback) && fallback > 0) {
            return Math.max(1, Math.round(fallback));
        }

        return 1;
    }

    private setWaveformSurfaceWidth(surfaceMetadata: WaveformSeekSurfaceMetadata): void {
        const width = Math.max(1, Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom));
        surfaceMetadata.surface.style.width = width + 'px';
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
            const viewportCenter = surfaceMetadata.wrapper.clientWidth / 2;
            const centerRatio = previousSurfaceWidth > 0
                ? (surfaceMetadata.wrapper.scrollLeft + viewportCenter) / previousSurfaceWidth
                : 0;

            surfaceMetadata.baseWidth = this.resolveWaveformBaseWidth(surfaceMetadata.wrapper, surfaceMetadata.baseWidth);
            this.setWaveformSurfaceWidth(surfaceMetadata);

            const nextSurfaceWidth = Math.max(
                1,
                Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
            );
            const maxScrollLeft = Math.max(0, nextSurfaceWidth - surfaceMetadata.wrapper.clientWidth);
            const nextScrollLeft = (centerRatio * nextSurfaceWidth) - viewportCenter;
            surfaceMetadata.wrapper.scrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
        });
    }

    getWaveformZoom(seekWrap: HTMLElement): number | null {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return null;
        }

        return surfaceMetadata.zoom;
    }

    setWaveformZoom(seekWrap: HTMLElement, zoom: number, anchorPageX?: number): boolean {
        const surfaceMetadata = this.findWaveformSurface(seekWrap);
        if (!surfaceMetadata) {
            return false;
        }

        const nextZoom = clampWaveformZoom(zoom);
        if (Math.abs(nextZoom - surfaceMetadata.zoom) < 0.000001) {
            return false;
        }

        const previousSurfaceWidth = Math.max(
            1,
            Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
        );
        const wrapperRect = surfaceMetadata.wrapper.getBoundingClientRect();
        const wrapperWidth = Math.max(1, surfaceMetadata.wrapper.clientWidth);
        const anchorWithinWrapper = Number.isFinite(anchorPageX)
            ? clampTime((anchorPageX as number) - (wrapperRect.left + window.scrollX), 0, wrapperWidth)
            : (wrapperWidth / 2);
        const anchorRatio = previousSurfaceWidth > 0
            ? (surfaceMetadata.wrapper.scrollLeft + anchorWithinWrapper) / previousSurfaceWidth
            : 0;

        surfaceMetadata.zoom = nextZoom;
        this.setWaveformSurfaceWidth(surfaceMetadata);

        const nextSurfaceWidth = Math.max(
            1,
            Math.round(surfaceMetadata.baseWidth * surfaceMetadata.zoom)
        );
        const maxScrollLeft = Math.max(0, nextSurfaceWidth - surfaceMetadata.wrapper.clientWidth);
        const nextScrollLeft = (anchorRatio * nextSurfaceWidth) - anchorWithinWrapper;
        surfaceMetadata.wrapper.scrollLeft = clampTime(nextScrollLeft, 0, maxScrollLeft);
        return true;
    }

    drawDummyWaveforms(waveformEngine: WaveformEngine): void {
        if (!this.features.waveform || this.waveformSeekSurfaces.length === 0) {
            return;
        }

        this.reflowWaveforms();

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            const canvas = surfaceMetadata.canvas;
            const context = surfaceMetadata.context;
            const barWidth = surfaceMetadata.barWidth;
            if (!context) {
                continue;
            }

            const displayWidth = canvas.clientWidth || canvas.width;
            const originalHeight = surfaceMetadata.originalHeight || canvas.height;

            if (canvas.width !== displayWidth) {
                canvas.width = displayWidth;
            }
            if (canvas.height !== originalHeight) {
                canvas.height = originalHeight;
            }

            waveformEngine.drawPlaceholder(canvas, context, barWidth, 0.3);
        }
    }

    renderWaveforms(
        waveformEngine: WaveformEngine,
        runtimes: TrackRuntime[],
        timelineDuration: number,
        trackTimelineProjector?: TrackTimelineProjector,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        if (!this.features.waveform || this.waveformSeekSurfaces.length === 0) {
            return;
        }

        this.reflowWaveforms();

        const safeTimelineDuration = Number.isFinite(timelineDuration) && timelineDuration > 0 ? timelineDuration : 0;

        for (let i = 0; i < this.waveformSeekSurfaces.length; i += 1) {
            const surfaceMetadata = this.waveformSeekSurfaces[i];
            const canvas = surfaceMetadata.canvas;
            const context = surfaceMetadata.context;
            const barWidth = surfaceMetadata.barWidth;
            if (!context) {
                continue;
            }

            const displayWidth = canvas.clientWidth || canvas.width;
            const originalHeight = surfaceMetadata.originalHeight || canvas.height;

            if (canvas.width !== displayWidth) {
                canvas.width = displayWidth;
            }
            if (canvas.height !== originalHeight) {
                canvas.height = originalHeight;
            }

            const peakCount = Math.max(1, Math.floor(canvas.width / barWidth));
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
            const mixed = waveformEngine.calculateMixedWaveform(
                sourceRuntimes,
                peakCount,
                barWidth,
                useLocalAxis ? localTrackDuration : safeTimelineDuration,
                useLocalAxis ? undefined : trackTimelineProjector
            );

            if (!mixed) {
                waveformEngine.drawPlaceholder(canvas, context, barWidth, 0.3);
                continue;
            }

            waveformEngine.drawWaveform(canvas, context, mixed, barWidth);
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

    updateMainControls(state: TrackSwitchUiState, waveformTimelineContext?: WaveformTimelineContext): void {
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

        this.updateWaveformTiming(state, waveformTimelineContext);

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

    private updateWaveformTiming(
        state: TrackSwitchUiState,
        waveformTimelineContext?: WaveformTimelineContext
    ): void {
        this.waveformSeekSurfaces.forEach((surface) => {
            if (!surface.timingNode) {
                return;
            }

            let position = state.position;
            let duration = state.longestDuration;

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
