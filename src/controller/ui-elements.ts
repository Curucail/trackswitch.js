import {
    TrackSwitchImageConfig,
    TrackSwitchSheetMusicConfig,
    TrackSwitchUiConfig,
    TrackSwitchUiElement,
    TrackSwitchWaveformConfig,
    TrackSwitchTrackGroupUiElement,
} from '../domain/types';
import { clampPercent } from '../shared/math';

function toMarginString(value: number | undefined): string {
    return String(clampPercent(value));
}

function toCanvasSize(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value) || !value) {
        return fallback;
    }

    return Math.max(1, Math.round(value));
}

function normalizeWaveformBarWidth(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return 1;
    }

    return Math.max(1, Math.floor(value));
}

function normalizeWaveformMaxZoom(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 1) {
            return undefined;
        }

        return value;
    }

    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    if (trimmed.endsWith('%')) {
        const percent = Number(trimmed.slice(0, -1).trim());
        if (!Number.isFinite(percent) || percent < 100) {
            return undefined;
        }

        return percent / 100;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return undefined;
    }

    return parsed;
}

function normalizeWaveformSource(value: 'audible' | number | undefined): 'audible' | number {
    if (value === 'audible' || value === undefined) {
        return 'audible';
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 'audible';
    }

    return Math.floor(value);
}

function normalizeWaveformTimer(value: boolean | undefined): boolean | undefined {
    if (value === undefined) {
        return undefined;
    }

    return typeof value === 'boolean' ? value : undefined;
}

function normalizeWaveformConfig<T extends TrackSwitchWaveformConfig>(waveform: T): T {
    return {
        ...waveform,
        waveformBarWidth: normalizeWaveformBarWidth(waveform.waveformBarWidth),
        maxZoom: normalizeWaveformMaxZoom(waveform.maxZoom),
        waveformSource: normalizeWaveformSource(waveform.waveformSource),
        timer: normalizeWaveformTimer(waveform.timer),
    };
}

function normalizeCursorAlpha(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0.1;
    }

    if (value < 0) {
        return 0;
    }

    if (value > 1) {
        return 1;
    }

    return value;
}

function normalizeSheetMusicDimension(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return undefined;
    }

    return Math.max(1, Math.round(value));
}

function normalizeSheetMusicRenderScale(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }

    return value;
}

function normalizeSheetMusicFollowPlayback(value: boolean | undefined): boolean {
    if (value === undefined) {
        return true;
    }

    return typeof value === 'boolean' ? value : true;
}

function normalizeSheetMusicConfig<T extends TrackSwitchSheetMusicConfig>(sheetmusic: T): T {
    const normalizedMaxWidth = normalizeSheetMusicDimension(
        sheetmusic.maxWidth !== undefined ? sheetmusic.maxWidth : sheetmusic.width
    );

    return {
        ...sheetmusic,
        maxWidth: normalizedMaxWidth,
        width: normalizeSheetMusicDimension(sheetmusic.width),
        maxHeight: normalizeSheetMusicDimension(sheetmusic.maxHeight),
        renderScale: normalizeSheetMusicRenderScale(sheetmusic.renderScale),
        followPlayback: normalizeSheetMusicFollowPlayback(sheetmusic.followPlayback),
        cursorAlpha: normalizeCursorAlpha(sheetmusic.cursorAlpha),
    };
}

function normalizeTrackGroupConfig<T extends TrackSwitchTrackGroupUiElement>(group: T): T {
    const normalizedTracks = Array.isArray(group.trackGroup)
        ? group.trackGroup.map(function(track) {
            return {
                ...track,
                sources: Array.isArray(track.sources) ? track.sources.map(function(source) {
                    return { ...source };
                }) : track.sources,
                alignment: track.alignment
                    ? {
                        ...track.alignment,
                        synchronizedSources: Array.isArray(track.alignment.synchronizedSources)
                            ? track.alignment.synchronizedSources.map(function(source) {
                                return { ...source };
                            })
                            : track.alignment.synchronizedSources,
                        sources: Array.isArray(track.alignment.sources)
                            ? track.alignment.sources.map(function(source) {
                                return { ...source };
                            })
                            : track.alignment.sources,
                    }
                    : track.alignment,
            };
        })
        : group.trackGroup;

    return {
        ...group,
        trackGroup: normalizedTracks,
    };
}

export function normalizeUiElement(element: TrackSwitchUiElement): TrackSwitchUiElement {
    if (element.type === 'waveform') {
        return normalizeWaveformConfig(element);
    }

    if (element.type === 'sheetmusic') {
        return normalizeSheetMusicConfig(element);
    }

    if (element.type === 'trackGroup') {
        return normalizeTrackGroupConfig(element);
    }

    return element;
}

function injectTrackGroup(root: HTMLElement, trackGroupIndex: number): void {
    const container = document.createElement('div');
    container.className = 'track-group';
    container.setAttribute('data-track-group-index', String(trackGroupIndex));
    root.appendChild(container);
}

function injectImage(root: HTMLElement, image: TrackSwitchImageConfig): void {
    const imageElement = document.createElement('img');
    imageElement.src = image.src;

    if (image.seekable) {
        imageElement.classList.add('seekable');
    }

    if (typeof image.style === 'string') {
        imageElement.setAttribute('data-style', image.style);
    }

    if (typeof image.seekMarginLeft === 'number') {
        imageElement.setAttribute('data-seek-margin-left', toMarginString(image.seekMarginLeft));
    }

    if (typeof image.seekMarginRight === 'number') {
        imageElement.setAttribute('data-seek-margin-right', toMarginString(image.seekMarginRight));
    }

    root.appendChild(imageElement);
}

function injectWaveform(root: HTMLElement, waveform: TrackSwitchWaveformConfig): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'waveform';
    canvas.width = toCanvasSize(waveform.width, 1200);
    canvas.height = toCanvasSize(waveform.height, 150);
    canvas.setAttribute('data-waveform-bar-width', String(normalizeWaveformBarWidth(waveform.waveformBarWidth)));
    canvas.setAttribute('data-waveform-source', String(normalizeWaveformSource(waveform.waveformSource)));

    const maxZoom = normalizeWaveformMaxZoom(waveform.maxZoom);
    if (maxZoom !== undefined) {
        canvas.setAttribute('data-waveform-max-zoom', String(maxZoom));
    }

    if (typeof waveform.timer === 'boolean') {
        canvas.setAttribute('data-waveform-timer', String(waveform.timer));
    }

    if (typeof waveform.style === 'string') {
        canvas.setAttribute('data-waveform-style', waveform.style);
    }

    if (typeof waveform.seekMarginLeft === 'number') {
        canvas.setAttribute('data-seek-margin-left', toMarginString(waveform.seekMarginLeft));
    }

    if (typeof waveform.seekMarginRight === 'number') {
        canvas.setAttribute('data-seek-margin-right', toMarginString(waveform.seekMarginRight));
    }

    root.appendChild(canvas);
}

function injectSheetMusic(root: HTMLElement, sheetmusic: TrackSwitchSheetMusicConfig): void {
    const container = document.createElement('div');
    container.className = 'sheetmusic';
    container.setAttribute('data-sheetmusic-src', String(sheetmusic.src || ''));
    container.setAttribute('data-sheetmusic-measure-csv', String(sheetmusic.measureCsv || ''));
    container.setAttribute(
        'data-sheetmusic-follow-playback',
        String(normalizeSheetMusicFollowPlayback(sheetmusic.followPlayback))
    );
    container.setAttribute('data-sheetmusic-cursor-alpha', String(normalizeCursorAlpha(sheetmusic.cursorAlpha)));

    const maxWidth = normalizeSheetMusicDimension(
        sheetmusic.maxWidth !== undefined ? sheetmusic.maxWidth : sheetmusic.width
    );
    if (maxWidth !== undefined) {
        container.setAttribute('data-sheetmusic-max-width', String(maxWidth));
    }

    const maxHeight = normalizeSheetMusicDimension(sheetmusic.maxHeight);
    if (maxHeight !== undefined) {
        container.setAttribute('data-sheetmusic-max-height', String(maxHeight));
    }

    const renderScale = normalizeSheetMusicRenderScale(sheetmusic.renderScale);
    if (renderScale !== undefined) {
        container.setAttribute('data-sheetmusic-render-scale', String(renderScale));
    }

    if (typeof sheetmusic.style === 'string') {
        container.setAttribute('data-sheetmusic-style', sheetmusic.style);
    }

    if (typeof sheetmusic.cursorColor === 'string') {
        container.setAttribute('data-sheetmusic-cursor-color', sheetmusic.cursorColor);
    }

    root.appendChild(container);
}

export function injectConfiguredUiElements(root: HTMLElement, uiElements: TrackSwitchUiConfig | undefined): void {
    if (!uiElements) {
        return;
    }

    const seekableCount = uiElements.filter(function(entry) {
        return entry.type === 'image' && Boolean(entry.seekable);
    }).length;

    if (seekableCount > 1) {
        throw new Error('TrackSwitch UI config supports at most one seekable image.');
    }

    let trackGroupIndex = 0;
    uiElements.forEach(function(entry) {
        if (entry.type === 'trackGroup') {
            injectTrackGroup(root, trackGroupIndex);
            trackGroupIndex += 1;
            return;
        }

        if (entry.type === 'image') {
            injectImage(root, entry);
            return;
        }

        if (entry.type === 'waveform') {
            injectWaveform(root, entry);
            return;
        }

        if (entry.type === 'sheetmusic') {
            injectSheetMusic(root, entry);
        }
    });
}
