interface PresetConfig {
    presetNames: string[];
    presetCount: number;
}

interface TrackElementConfig {
    presetsForTrack: number[];
    seekMarginLeft: number;
    seekMarginRight: number;
}

interface TrackSwitchOptions {
    mute: boolean;
    solo: boolean;
    globalsolo: boolean;
    globalvolume: boolean;
    repeat: boolean;
    radiosolo: boolean;
    onlyradiosolo: boolean;
    tabview: boolean;
    iosunmute: boolean;
    keyboard: boolean;
    looping: boolean;
    seekbar: boolean;
    waveform: boolean;
    waveformBarWidth: number;
}

interface TrackProperty {
    mute: boolean;
    solo: boolean;
    success: boolean;
    error: boolean;
    presetsForTrack: number[];
}

interface TrackTiming {
    trimStart: number;
    padStart: number;
    audioDuration: number;
    effectiveDuration: number;
}

type LoopMarker = 'A' | 'B' | null;
type TrackSwitchEvent = {
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
};

type PluginCollection = JQuery<HTMLElement>;

function audioContextCheck(): AudioContext | null {
    return typeof AudioContext !== 'undefined' ? new AudioContext() : null;
}
const audioContext = audioContextCheck();

const pluginName = 'trackSwitch';
let pluginInstanceCounter = 0;
let activeKeyboardInstanceId: number | null = null;

function setActiveKeyboardInstance(instanceId: number | null): void {
    activeKeyboardInstanceId = instanceId;
}

function isKeyboardInstanceActive(instanceId: number): boolean {
    return activeKeyboardInstanceId === instanceId;
}
