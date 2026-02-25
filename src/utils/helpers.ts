import { TrackDefinition, TrackSourceDefinition, TrackSwitchConfig, TrackTiming } from '../domain/types';

export interface ControllerPointerEvent {
    type: string;
    which?: number;
    pageX?: number;
    key?: string;
    code?: string;
    shiftKey?: boolean;
    target?: EventTarget | null;
    originalEvent?: Event & {
        deltaY?: number;
        touches?: ArrayLike<{ pageX: number }>;
    };
    preventDefault(): void;
    stopPropagation(): void;
}

export function sanitizeInlineStyle(styleValue: unknown): string {
    const style = typeof styleValue === 'string' ? styleValue.trim() : '';
    if (!style) {
        return '';
    }

    return style
        .replace(/url\s*\(/gi, '')
        .replace(/[<>]/g, '');
}

export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function clampPercent(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(100, parsed));
}

export function parseStrictNonNegativeInt(value: string): number {
    return /^\d+$/.test(value) ? Number(value) : NaN;
}

export function parsePresetIndices(presetsAttr: string | undefined): number[] {
    if (!presetsAttr) {
        return [];
    }

    return presetsAttr
        .split(',')
        .map(function(preset) { return parseStrictNonNegativeInt(preset.trim()); })
        .filter(function(preset) { return Number.isFinite(preset) && preset >= 0; });
}

export function inferSourceMimeType(
    sourceUrl: string,
    sourceType: string | undefined,
    mimeTypeTable: Record<string, string>
): string {
    if (sourceType) {
        return sourceType.endsWith(';') ? sourceType : sourceType + ';';
    }

    const withoutHash = sourceUrl.split('#')[0];
    const cleanUrl = withoutHash.split('?')[0];
    const extIndex = cleanUrl.lastIndexOf('.');
    const ext = extIndex >= 0 ? cleanUrl.slice(extIndex).toLowerCase() : '';

    if (!ext) {
        return '';
    }

    if (mimeTypeTable[ext]) {
        return mimeTypeTable[ext];
    }

    return 'audio/' + ext.slice(1) + ';';
}

export function formatSecondsToHHMMSSmmm(seconds: number): string {
    const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
    const totalSeconds = Math.floor(totalMilliseconds / 1000);
    const h = Math.floor(totalSeconds / 3600) % 24;
    const m = Math.floor(totalSeconds / 60) % 60;
    const sec = totalSeconds % 60;
    const mil = totalMilliseconds % 1000;

    const hh = h < 10 ? '0' + h : String(h);
    const mm = m < 10 ? '0' + m : String(m);
    const ss = sec < 10 ? '0' + sec : String(sec);
    const mmm = mil < 10 ? '00' + mil : mil < 100 ? '0' + mil : String(mil);

    return hh + ':' + mm + ':' + ss + ':' + mmm;
}

function getPointerPageX(event: ControllerPointerEvent): number | null {
    if (event.type.indexOf('mouse') >= 0) {
        return typeof event.pageX === 'number' ? event.pageX : null;
    }

    const touchEvent = event.originalEvent;
    const touches = touchEvent?.touches;
    if (touches && touches.length > 0) {
        const firstTouch = touches[0];
        return typeof firstTouch?.pageX === 'number' ? firstTouch.pageX : null;
    }

    return null;
}

function ensurePositiveWidth(width: number): number {
    if (!Number.isFinite(width) || width < 1) {
        return 1;
    }
    return width;
}

export function getSeekMetrics(
    seekingElement: HTMLElement | null,
    event: ControllerPointerEvent,
    longestDuration: number
): { posXRel: number; seekWidth: number; posXRelLimited: number; timePerc: number; time: number } | null {
    if (!seekingElement) {
        return null;
    }

    const pageX = getPointerPageX(event);
    if (pageX === null) {
        return null;
    }

    const rect = seekingElement.getBoundingClientRect();
    const offsetLeft = rect.left + window.scrollX;

    const posXRel = pageX - offsetLeft;
    const seekWidth = ensurePositiveWidth(rect.width || seekingElement.clientWidth || 0);
    const posXRelLimited = posXRel < 0 ? 0 : posXRel > seekWidth ? seekWidth : posXRel;
    const timePerc = (posXRelLimited / seekWidth) * 100;
    const time = longestDuration * (timePerc / 100);

    return {
        posXRel: posXRel,
        seekWidth: seekWidth,
        posXRelLimited: posXRelLimited,
        timePerc: timePerc,
        time: time,
    };
}

export function calculateTrackTiming(source: TrackSourceDefinition, bufferDuration: number): TrackTiming {
    const startOffsetMs = Number(source.startOffsetMs ?? 0);
    const endOffsetMs = Number(source.endOffsetMs ?? 0);

    const startOffset = Number.isFinite(startOffsetMs) ? startOffsetMs / 1000 : 0;
    const endOffset = Number.isFinite(endOffsetMs) ? endOffsetMs / 1000 : 0;

    const trimStart = startOffset > 0 ? startOffset : 0;
    const padStart = startOffset < 0 ? -startOffset : 0;
    const trimEnd = endOffset > 0 ? endOffset : 0;
    const padEnd = endOffset < 0 ? -endOffset : 0;

    let audioDuration = bufferDuration - trimStart - trimEnd;
    audioDuration = audioDuration > 0 ? audioDuration : 0;

    return {
        trimStart: trimStart,
        padStart: padStart,
        audioDuration: audioDuration,
        effectiveDuration: padStart + audioDuration + padEnd,
    };
}

export function derivePresetNames(config: Pick<TrackSwitchConfig, 'tracks' | 'presetNames'>): string[] {
    let maxPresetIndex = -1;

    config.tracks.forEach(function(track: TrackDefinition) {
        (track.presets ?? []).forEach(function(index: number) {
            if (index > maxPresetIndex) {
                maxPresetIndex = index;
            }
        });
    });

    const presetCount = Math.max(0, maxPresetIndex + 1);
    const providedNames = (config.presetNames ?? []).map(function(name) {
        return String(name).trim();
    });

    return Array.from({ length: presetCount }, function(_, index) {
        return providedNames[index] || 'Preset ' + index;
    });
}

export function isPrimaryInput(event: ControllerPointerEvent): boolean {
    return event.type === 'touchstart' || (event.type === 'mousedown' && event.which === 1);
}

export function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.max(min, Math.min(max, value));
}

export function eventTargetAsElement(target: EventTarget | null | undefined): Element | null {
    if (!target || typeof target !== 'object') {
        return null;
    }

    const candidate = target as { nodeType?: unknown };
    return candidate.nodeType === 1 ? target as Element : null;
}
