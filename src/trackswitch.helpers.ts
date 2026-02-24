function sanitizeInlineStyle(styleValue: unknown): string {
    const style = typeof styleValue === 'string' ? styleValue.trim() : '';
    if (!style) {
        return '';
    }

    return style
        .replace(/url\s*\(/gi, '')
        .replace(/[<>]/g, '');
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clampPercent(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(100, parsed));
}

function parseStrictNonNegativeInt(value: string): number {
    return /^\d+$/.test(value) ? Number(value) : NaN;
}

function buildPresetConfig(element: JQuery<HTMLElement>): PresetConfig {
    const presetNamesAttr = element.attr('preset-names') as string | undefined;
    let maxPresetIndex = -1;

    element.find('ts-track').each(function() {
        const presets = parsePresetIndices($(this).attr('presets'));
        presets.forEach(function(preset) {
            if (preset > maxPresetIndex) {
                maxPresetIndex = preset;
            }
        });
    });

    const presetCount = Math.max(maxPresetIndex + 1, 0);
    const userNames = presetNamesAttr?.split(',').map(function(name) { return name.trim(); }) ?? [];
    const presetNames = Array.from({ length: presetCount }, function(_, presetIndex) {
        return userNames[presetIndex] || 'Preset ' + presetIndex;
    });

    return {
        presetNames: presetNames,
        presetCount: presetCount,
    };
}

function parsePresetIndices(presetsAttr: string | undefined): number[] {
    if (!presetsAttr) {
        return [];
    }

    return presetsAttr
        .split(',')
        .map(function(preset) { return parseStrictNonNegativeInt(preset.trim()); })
        .filter(function(preset) { return Number.isFinite(preset) && preset >= 0; });
}

function parseTrackElementConfig(element: JQuery<HTMLElement>): TrackElementConfig {
    return {
        presetsForTrack: parsePresetIndices(element.attr('presets')),
        seekMarginLeft: clampPercent(element.data('seekMarginLeft')),
        seekMarginRight: clampPercent(element.data('seekMarginRight')),
    };
}

function getPointerPageX(event: TrackSwitchEvent): number | null {
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

function ensurePositiveWidth(width: number | undefined): number {
    if (typeof width !== 'number' || !Number.isFinite(width) || width < 1) {
        return 1;
    }
    return width;
}

function getSeekMetrics(
    seekingElement: JQuery<HTMLElement> | null,
    event: TrackSwitchEvent,
    longestDuration: number
): { posXRel: number; seekWidth: number; posXRelLimited: number; timePerc: number; time: number } | null {
    if (!seekingElement || seekingElement.length === 0) {
        return null;
    }

    const pageX = getPointerPageX(event);
    if (pageX === null) {
        return null;
    }

    const offset = seekingElement.offset();
    if (!offset) {
        return null;
    }

    const posXRel = pageX - offset.left;
    const seekWidth = ensurePositiveWidth(seekingElement.width());
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

function inferSourceMimeType(
    sourceUrl: string,
    sourceType: string | undefined,
    mimeTypeTable: Record<string, string>
): string {
    if (sourceType) {
        return sourceType + ';';
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

function formatSecondsToHHMMSSmmm(seconds: number): string {
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
