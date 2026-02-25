import { TrackDefinition, TrackSwitchConfig, TrackSwitchFeatures } from '../../domain/types';
import { parsePresetIndices } from '../../utils/helpers';

export type LegacyOptions = Partial<TrackSwitchFeatures>;

function parseSourceOffsets(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }
    return parsed;
}

function parseTrack(trackElement: HTMLElement, trackIndex: number): TrackDefinition {
    const trackNode = $(trackElement);
    const sources: TrackDefinition['sources'] = [];

    trackNode.find('ts-source').each(function(this: HTMLElement) {
        const sourceNode = $(this);
        const src = sourceNode.attr('src');
        if (!src) {
            return;
        }

        sources.push({
            src: src,
            type: sourceNode.attr('type') || undefined,
            startOffsetMs: parseSourceOffsets(sourceNode.attr('start-offset-ms') || undefined),
            endOffsetMs: parseSourceOffsets(sourceNode.attr('end-offset-ms') || undefined),
        });
    });

    return {
        id: trackNode.attr('id') || undefined,
        title: trackNode.attr('title') || ('Track ' + (trackIndex + 1)),
        muted: trackElement.hasAttribute('mute'),
        solo: trackElement.hasAttribute('solo'),
        image: trackElement.dataset ? trackElement.dataset.img : undefined,
        style: trackNode.attr('style') || undefined,
        presets: parsePresetIndices(trackNode.attr('presets') || undefined),
        seekMarginLeft: Number(trackNode.data('seekMarginLeft')) || undefined,
        seekMarginRight: Number(trackNode.data('seekMarginRight')) || undefined,
        sources: sources,
    };
}

export function parseLegacyConfig(
    root: JQuery<HTMLElement>,
    options: LegacyOptions | undefined
): TrackSwitchConfig {
    const tracks: TrackDefinition[] = [];

    root.find('ts-track').each(function(this: HTMLElement, index: number) {
        tracks.push(parseTrack(this, index));
    });

    const presetNames = (root.attr('preset-names') || '')
        .split(',')
        .map(function(name) { return name.trim(); })
        .filter(function(name) { return name.length > 0; });

    return {
        tracks: tracks,
        presetNames: presetNames.length > 0 ? presetNames : undefined,
        features: options,
    };
}

export function isTrackSwitchConfig(value: unknown): value is TrackSwitchConfig {
    return !!value && Array.isArray((value as TrackSwitchConfig).tracks);
}
