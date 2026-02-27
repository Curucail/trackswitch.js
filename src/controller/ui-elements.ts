import {
    TrackSwitchImageConfig,
    TrackSwitchUiConfig,
    TrackSwitchUiElement,
    TrackSwitchWaveformConfig,
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

function normalizeWaveformSource(value: 'audible' | number | undefined): 'audible' | number {
    if (value === 'audible' || value === undefined) {
        return 'audible';
    }

    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return 'audible';
    }

    return Math.floor(value);
}

function normalizeWaveformConfig<T extends TrackSwitchWaveformConfig>(waveform: T): T {
    return {
        ...waveform,
        waveformBarWidth: normalizeWaveformBarWidth(waveform.waveformBarWidth),
        waveformSource: normalizeWaveformSource(waveform.waveformSource),
    };
}

export function normalizeUiElement(element: TrackSwitchUiElement): TrackSwitchUiElement {
    if (element.type === 'waveform') {
        return normalizeWaveformConfig(element);
    }

    return element;
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

    uiElements.forEach(function(entry) {
        if (entry.type === 'image') {
            injectImage(root, entry);
            return;
        }

        if (entry.type === 'waveform') {
            injectWaveform(root, entry);
        }
    });
}
