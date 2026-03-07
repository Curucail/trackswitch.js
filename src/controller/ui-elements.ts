import {
    TrackDefinitionAlignment,
    TrackSourceDefinition,
    TrackSwitchImageConfig,
    TrackSwitchPerTrackImageConfig,
    TrackSwitchSheetMusicConfig,
    TrackSwitchUiConfig,
    TrackSwitchUiElement,
    TrackSwitchWaveformConfig,
    TrackSwitchTrackGroupUiElement,
    TrackSwitchWarpingMatrixConfig,
} from '../domain/types';
import { clampPercent } from '../shared/math';
import { assertAllowedKeys, toConfigRecord } from './config-validation';

const uiImageAllowedKeys = ['type', 'src', 'seekable', 'style', 'seekMarginLeft', 'seekMarginRight'] as const;
const uiPerTrackImageAllowedKeys = ['type', 'seekable', 'style', 'seekMarginLeft', 'seekMarginRight'] as const;
const uiWaveformAllowedKeys = [
    'type',
    'width',
    'height',
    'waveformBarWidth',
    'maxZoom',
    'waveformSource',
    'timer',
    'style',
    'seekMarginLeft',
    'seekMarginRight',
] as const;
const uiTrackGroupAllowedKeys = ['type', 'rowHeight', 'trackGroup'] as const;
const uiSheetMusicAllowedKeys = [
    'type',
    'src',
    'measureCsv',
    'maxWidth',
    'maxHeight',
    'renderScale',
    'followPlayback',
    'style',
    'cursorColor',
    'cursorAlpha',
] as const;
const uiWarpingMatrixAllowedKeys = ['type', 'style', 'height'] as const;

const trackAllowedKeys = [
    'title',
    'solo',
    'volume',
    'pan',
    'image',
    'style',
    'presets',
    'seekMarginLeft',
    'seekMarginRight',
    'sources',
    'alignment',
] as const;

const trackAlignmentAllowedKeys = ['column', 'synchronizedSources'] as const;
const sourceAllowedKeys = ['src', 'type', 'startOffsetMs', 'endOffsetMs'] as const;

const uiAllowedKeysByType: Record<string, readonly string[]> = {
    image: uiImageAllowedKeys,
    perTrackImage: uiPerTrackImageAllowedKeys,
    waveform: uiWaveformAllowedKeys,
    trackGroup: uiTrackGroupAllowedKeys,
    sheetMusic: uiSheetMusicAllowedKeys,
    warpingMatrix: uiWarpingMatrixAllowedKeys,
};

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

function normalizeWaveformMaxZoom(value: unknown): number {
    if (value === undefined) {
        return 5;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid ui.waveform configuration: maxZoom must be a finite number of seconds.');
    }

    if (value <= 0) {
        return 0;
    }

    return value;
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

function validateSeekMargins(
    config: { seekMarginLeft?: number; seekMarginRight?: number },
    label: string
): void {
    const left = clampPercent(config.seekMarginLeft);
    const right = clampPercent(config.seekMarginRight);

    if (left + right >= 100) {
        throw new Error(
            'Invalid '
            + label
            + ' configuration: seekMarginLeft + seekMarginRight must be less than 100.'
        );
    }
}

function normalizeWaveformConfig<T extends TrackSwitchWaveformConfig>(waveform: T): T {
    const normalized = {
        ...waveform,
        waveformBarWidth: normalizeWaveformBarWidth(waveform.waveformBarWidth),
        maxZoom: normalizeWaveformMaxZoom(waveform.maxZoom),
        waveformSource: normalizeWaveformSource(waveform.waveformSource),
        timer: normalizeWaveformTimer(waveform.timer),
    };

    validateSeekMargins(normalized, 'ui.waveform');
    return normalized;
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
    const normalizedMaxWidth = normalizeSheetMusicDimension(sheetmusic.maxWidth);

    return {
        ...sheetmusic,
        maxWidth: normalizedMaxWidth,
        maxHeight: normalizeSheetMusicDimension(sheetmusic.maxHeight),
        renderScale: normalizeSheetMusicRenderScale(sheetmusic.renderScale),
        followPlayback: normalizeSheetMusicFollowPlayback(sheetmusic.followPlayback),
        cursorAlpha: normalizeCursorAlpha(sheetmusic.cursorAlpha),
    };
}

function normalizeWarpingMatrixHeight(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return undefined;
    }

    return Math.max(1, Math.round(value));
}

function normalizeWarpingMatrixConfig<T extends TrackSwitchWarpingMatrixConfig>(warpingMatrix: T): T {
    return {
        ...warpingMatrix,
        height: normalizeWarpingMatrixHeight(warpingMatrix.height),
    };
}

function normalizeSourceConfig(source: TrackSourceDefinition): TrackSourceDefinition {
    const sourceRecord = toConfigRecord(source, 'source');
    assertAllowedKeys(sourceRecord, sourceAllowedKeys, 'source');
    return { ...source };
}

function normalizeTrackAlignmentConfig(
    alignment: TrackDefinitionAlignment | undefined
): TrackDefinitionAlignment | undefined {
    if (!alignment) {
        return alignment;
    }

    const alignmentRecord = toConfigRecord(alignment, 'track alignment');
    assertAllowedKeys(alignmentRecord, trackAlignmentAllowedKeys, 'track alignment');

    return {
        ...alignment,
        synchronizedSources: Array.isArray(alignment.synchronizedSources)
            ? alignment.synchronizedSources.map(function(source) {
                return normalizeSourceConfig(source);
            })
            : alignment.synchronizedSources,
    };
}

function normalizeTrackGroupConfig<T extends TrackSwitchTrackGroupUiElement>(group: T): T {
    const normalizeTrackGroupRowHeight = function(value: number | undefined): number | undefined {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
            return undefined;
        }

        return Math.max(1, Math.round(value));
    };

    const normalizedTracks = Array.isArray(group.trackGroup)
        ? group.trackGroup.map(function(track) {
            const trackRecord = toConfigRecord(track, 'track');
            assertAllowedKeys(trackRecord, trackAllowedKeys, 'track');

            return {
                ...track,
                sources: Array.isArray(track.sources) ? track.sources.map(function(source) {
                    return normalizeSourceConfig(source);
                }) : track.sources,
                alignment: normalizeTrackAlignmentConfig(track.alignment),
            };
        })
        : group.trackGroup;

    return {
        ...group,
        rowHeight: normalizeTrackGroupRowHeight(group.rowHeight),
        trackGroup: normalizedTracks,
    };
}

export function normalizeUiElement(element: TrackSwitchUiElement): TrackSwitchUiElement {
    const elementRecord = toConfigRecord(element, 'ui element');
    const elementType = elementRecord.type;
    if (typeof elementType !== 'string') {
        throw new Error('Invalid ui element type.');
    }

    const allowedElementKeys = uiAllowedKeysByType[elementType];
    if (!allowedElementKeys) {
        throw new Error('Invalid ui element type: ' + elementType);
    }
    assertAllowedKeys(elementRecord, allowedElementKeys, 'ui.' + elementType);

    if (element.type === 'waveform') {
        return normalizeWaveformConfig(element);
    }

    if (element.type === 'sheetMusic') {
        return normalizeSheetMusicConfig(element);
    }

    if (element.type === 'warpingMatrix') {
        return normalizeWarpingMatrixConfig(element);
    }

    if (element.type === 'trackGroup') {
        return normalizeTrackGroupConfig(element);
    }

    if (element.type === 'image') {
        if (element.seekable) {
            validateSeekMargins(element, 'ui.image');
        }
        return element;
    }

    if (element.type === 'perTrackImage') {
        if (element.seekable) {
            validateSeekMargins(element, 'ui.perTrackImage');
        }
        return element;
    }

    throw new Error('Invalid ui element type: ' + elementType);
}

function injectWarpingMatrix(root: HTMLElement, warpingMatrix: TrackSwitchWarpingMatrixConfig): void {
    const container = document.createElement('div');
    container.className = 'warping-matrix';

    if (typeof warpingMatrix.style === 'string') {
        container.setAttribute('data-warping-matrix-style', warpingMatrix.style);
    }

    const normalizedHeight = normalizeWarpingMatrixHeight(warpingMatrix.height);
    if (normalizedHeight !== undefined) {
        container.setAttribute('data-warping-matrix-height', String(normalizedHeight));
    }

    root.appendChild(container);
}

function injectTrackGroup(root: HTMLElement, trackGroupIndex: number): void {
    const container = document.createElement('div');
    container.className = 'track-group ts-stack-section';
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

function injectPerTrackImage(root: HTMLElement, image: TrackSwitchPerTrackImageConfig): void {
    const imageElement = document.createElement('img');
    imageElement.classList.add('per-track-image');
    imageElement.setAttribute('data-per-track-image', 'true');
    imageElement.style.display = 'none';

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
    canvas.setAttribute('data-waveform-max-zoom', String(normalizeWaveformMaxZoom(waveform.maxZoom)));

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

    const maxWidth = normalizeSheetMusicDimension(sheetmusic.maxWidth);
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

        if (entry.type === 'perTrackImage') {
            injectPerTrackImage(root, entry);
            return;
        }

        if (entry.type === 'waveform') {
            injectWaveform(root, entry);
            return;
        }

        if (entry.type === 'sheetMusic') {
            injectSheetMusic(root, entry);
            return;
        }

        if (entry.type === 'warpingMatrix') {
            injectWarpingMatrix(root, entry);
            return;
        }

        throw new Error('Invalid ui element type: ' + String((entry as { type?: unknown }).type));
    });
}
