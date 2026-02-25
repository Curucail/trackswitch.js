import { TrackDefinition } from '../domain/types';
import { clampPercent, parsePresetIndices } from '../utils/helpers';

function parseOptionalNumber(rawValue: string | null): number | undefined {
    if (rawValue === null || rawValue.trim() === '') {
        return undefined;
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    return parsed;
}

function parseTrackSource(sourceElement: Element): TrackDefinition['sources'][number] | null {
    const src = sourceElement.getAttribute('src');
    if (!src) {
        return null;
    }

    return {
        src: src,
        type: sourceElement.getAttribute('type') || undefined,
        startOffsetMs: parseOptionalNumber(sourceElement.getAttribute('start-offset-ms')),
        endOffsetMs: parseOptionalNumber(sourceElement.getAttribute('end-offset-ms')),
    };
}

export function parseTrackSwitchMarkup(root: HTMLElement): TrackDefinition[] {
    const tracks: TrackDefinition[] = [];

    const trackElements = root.querySelectorAll('ts-track');
    trackElements.forEach(function(trackElement, index) {
        const sources: TrackDefinition['sources'] = [];

        const sourceElements = trackElement.querySelectorAll('ts-source');
        sourceElements.forEach(function(sourceElement) {
            const parsedSource = parseTrackSource(sourceElement);
            if (parsedSource) {
                sources.push(parsedSource);
            }
        });

        tracks.push({
            id: trackElement.getAttribute('id') || undefined,
            title: trackElement.getAttribute('title') || 'Track ' + (index + 1),
            muted: trackElement.hasAttribute('mute'),
            solo: trackElement.hasAttribute('solo'),
            image: trackElement.getAttribute('data-img') || undefined,
            style: trackElement.getAttribute('style') || undefined,
            presets: parsePresetIndices(trackElement.getAttribute('presets') || undefined),
            seekMarginLeft: clampPercent(trackElement.getAttribute('data-seek-margin-left')),
            seekMarginRight: clampPercent(trackElement.getAttribute('data-seek-margin-right')),
            sources: sources,
        });
    });

    return tracks;
}

export function parsePresetNamesFromMarkup(root: HTMLElement): string[] {
    const rawNames = root.getAttribute('preset-names');
    if (!rawNames) {
        return [];
    }

    return rawNames
        .split(',')
        .map(function(name) {
            return name.trim();
        })
        .filter(function(name) {
            return name.length > 0;
        });
}
