import { config, icon, type IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
    faCircle,
    faCircleCheck,
    faCircleDot,
} from '@fortawesome/free-regular-svg-icons';
import {
    faCircleInfo,
    faExclamation,
    faPause,
    faPlay,
    faPowerOff,
    faRepeat,
    faRotateRight,
    faSpinner,
    faStop,
    faTriangleExclamation,
    faVolumeHigh,
    faVolumeLow,
    faVolumeOff,
    faVolumeXmark,
    faXmark,
} from '@fortawesome/free-solid-svg-icons';

export type TrackSwitchIconName =
    | 'play'
    | 'pause'
    | 'stop'
    | 'repeat'
    | 'rotate-right'
    | 'xmark'
    | 'power-off'
    | 'spinner'
    | 'exclamation'
    | 'circle-info'
    | 'triangle-exclamation'
    | 'circle'
    | 'circle-check'
    | 'circle-dot'
    | 'volume-xmark'
    | 'volume-off'
    | 'volume-low'
    | 'volume-high';

const ICON_DEFINITION_BY_NAME: Record<TrackSwitchIconName, IconDefinition> = {
    play: faPlay,
    pause: faPause,
    stop: faStop,
    repeat: faRepeat,
    'rotate-right': faRotateRight,
    xmark: faXmark,
    'power-off': faPowerOff,
    spinner: faSpinner,
    exclamation: faExclamation,
    'circle-info': faCircleInfo,
    'triangle-exclamation': faTriangleExclamation,
    circle: faCircle,
    'circle-check': faCircleCheck,
    'circle-dot': faCircleDot,
    'volume-xmark': faVolumeXmark,
    'volume-off': faVolumeOff,
    'volume-low': faVolumeLow,
    'volume-high': faVolumeHigh,
};

config.autoAddCss = false;

function normalizeSvgMarkup(svgMarkup: string): string {
    let normalized = svgMarkup
        .replace(/\sdata-prefix="[^"]*"/g, '')
        .replace(/\sdata-icon="[^"]*"/g, '')
        .replace(/\sclass="[^"]*"/, ' class="ts-icon-svg"');

    if (!/\sclass="/.test(normalized)) {
        normalized = normalized.replace('<svg', '<svg class="ts-icon-svg"');
    }

    return normalized;
}

function renderIconSvgMarkup(iconDefinition: IconDefinition): string {
    return normalizeSvgMarkup(icon(iconDefinition).html.join(''));
}

const ICON_SVG_BY_NAME: Record<TrackSwitchIconName, string> = {
    play: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.play),
    pause: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.pause),
    stop: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.stop),
    repeat: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.repeat),
    'rotate-right': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['rotate-right']),
    xmark: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.xmark),
    'power-off': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['power-off']),
    spinner: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.spinner),
    exclamation: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.exclamation),
    'circle-info': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['circle-info']),
    'triangle-exclamation': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['triangle-exclamation']),
    circle: renderIconSvgMarkup(ICON_DEFINITION_BY_NAME.circle),
    'circle-check': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['circle-check']),
    'circle-dot': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['circle-dot']),
    'volume-xmark': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['volume-xmark']),
    'volume-off': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['volume-off']),
    'volume-low': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['volume-low']),
    'volume-high': renderIconSvgMarkup(ICON_DEFINITION_BY_NAME['volume-high']),
};

export function renderIconSlotHtml(iconName: TrackSwitchIconName, extraClassName = ''): string {
    const className = extraClassName ? 'ts-icon-slot ' + extraClassName : 'ts-icon-slot';
    return '<span class="' + className + '" data-icon="' + iconName + '" aria-hidden="true">'
        + ICON_SVG_BY_NAME[iconName]
        + '</span>';
}

export function getHostIconSlot(host: HTMLElement): HTMLElement | null {
    const slot = host.querySelector('.ts-icon-slot');
    return slot instanceof HTMLElement ? slot : null;
}

export function setIconSlot(slot: HTMLElement, iconName: TrackSwitchIconName): void {
    if (slot.getAttribute('data-icon') === iconName) {
        return;
    }

    slot.setAttribute('data-icon', iconName);
    slot.innerHTML = ICON_SVG_BY_NAME[iconName];
}

export function setHostIcon(host: HTMLElement, iconName: TrackSwitchIconName): void {
    let slot = getHostIconSlot(host);
    if (!slot) {
        slot = host.ownerDocument.createElement('span');
        slot.className = 'ts-icon-slot';
        slot.setAttribute('aria-hidden', 'true');
        host.prepend(slot);
    }

    setIconSlot(slot, iconName);
}
