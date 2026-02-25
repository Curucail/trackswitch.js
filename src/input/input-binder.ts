import { TrackSwitchFeatures } from '../domain/types';
import { ControllerPointerEvent } from '../utils/helpers';

export interface InputController {
    eventNamespace: string;
    presetCount: number;
    setKeyboardActive(): void;
    onOverlayActivate(event: ControllerPointerEvent): void;
    onOverlayInfo(_event: ControllerPointerEvent): void;
    onPlayPause(event: ControllerPointerEvent): void;
    onStop(event: ControllerPointerEvent): void;
    onRepeat(event: ControllerPointerEvent): void;
    onSeekStart(event: ControllerPointerEvent): void;
    onSeekMove(event: ControllerPointerEvent): void;
    onSeekEnd(event: ControllerPointerEvent): void;
    onMute(event: ControllerPointerEvent): void;
    onSolo(event: ControllerPointerEvent): void;
    onVolume(event: ControllerPointerEvent): void;
    onPreset(event: ControllerPointerEvent): void;
    onPresetScroll(event: ControllerPointerEvent): void;
    onSetLoopA(event: ControllerPointerEvent): void;
    onSetLoopB(event: ControllerPointerEvent): void;
    onToggleLoop(event: ControllerPointerEvent): void;
    onClearLoop(event: ControllerPointerEvent): void;
    onMarkerDragStart(event: ControllerPointerEvent): void;
    onKeyboard(event: ControllerPointerEvent): void;
    onResize(): void;
}

export class InputBinder {
    private readonly root: JQuery<HTMLElement>;
    private readonly features: TrackSwitchFeatures;
    private readonly controller: InputController;

    constructor(root: JQuery<HTMLElement>, features: TrackSwitchFeatures, controller: InputController) {
        this.root = root;
        this.features = features;
        this.controller = controller;
    }

    bind(): void {
        const ns = this.controller.eventNamespace;

        if (this.features.looping) {
            this.root.on('contextmenu' + ns, '.seekwrap', function(event) {
                event.preventDefault();
                return false;
            });
        }

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.overlay .activate', (event) => {
            this.controller.onOverlayActivate(event as unknown as ControllerPointerEvent);
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.overlay #overlayinfo .info', (event) => {
            this.controller.onOverlayInfo(event as unknown as ControllerPointerEvent);
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, () => {
            this.controller.setKeyboardActive();
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.playpause', (event) => {
            this.controller.onPlayPause(event as unknown as ControllerPointerEvent);
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.stop', (event) => {
            this.controller.onStop(event as unknown as ControllerPointerEvent);
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.repeat', (event) => {
            this.controller.onRepeat(event as unknown as ControllerPointerEvent);
        });

        this.root.on('mousedown' + ns + ' touchstart' + ns, '.seekwrap', (event) => {
            this.controller.onSeekStart(event as unknown as ControllerPointerEvent);
        });

        $(window).on('mousemove' + ns + ' touchmove' + ns, (event) => {
            this.controller.onSeekMove(event as unknown as ControllerPointerEvent);
        });

        $(window).on('mouseup' + ns + ' touchend' + ns + ' touchcancel' + ns, (event) => {
            this.controller.onSeekEnd(event as unknown as ControllerPointerEvent);
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.mute', (event) => {
            this.controller.onMute(event as unknown as ControllerPointerEvent);
        });

        this.root.on('touchstart' + ns + ' mousedown' + ns, '.solo', (event) => {
            this.controller.onSolo(event as unknown as ControllerPointerEvent);
        });

        if (this.features.globalvolume) {
            this.root.on('input' + ns, '.volume-slider', (event) => {
                this.controller.onVolume(event as unknown as ControllerPointerEvent);
            });

            this.root.on(
                'mousedown' + ns + ' touchstart' + ns + ' mousemove' + ns + ' touchmove' + ns + ' mouseup' + ns + ' touchend' + ns,
                '.volume-control',
                function(event) {
                    event.stopPropagation();
                }
            );
        }

        if (this.controller.presetCount >= 2) {
            this.root.on('change' + ns + ' preset:reapply' + ns, '.preset-selector', (event) => {
                this.controller.onPreset(event as unknown as ControllerPointerEvent);
            });

            this.root.on('wheel' + ns, '.preset-selector', (event) => {
                this.controller.onPresetScroll(event as unknown as ControllerPointerEvent);
            });

            this.root.on(
                'mousedown' + ns + ' touchstart' + ns + ' mouseup' + ns + ' touchend' + ns + ' click' + ns,
                '.preset-selector, .preset-selector-wrap',
                function(event) {
                    event.stopPropagation();
                }
            );
        }

        if (this.features.looping) {
            this.root.on('touchstart' + ns + ' mousedown' + ns, '.loop-a', (event) => {
                this.controller.onSetLoopA(event as unknown as ControllerPointerEvent);
            });
            this.root.on('touchstart' + ns + ' mousedown' + ns, '.loop-b', (event) => {
                this.controller.onSetLoopB(event as unknown as ControllerPointerEvent);
            });
            this.root.on('touchstart' + ns + ' mousedown' + ns, '.loop-toggle', (event) => {
                this.controller.onToggleLoop(event as unknown as ControllerPointerEvent);
            });
            this.root.on('touchstart' + ns + ' mousedown' + ns, '.loop-clear', (event) => {
                this.controller.onClearLoop(event as unknown as ControllerPointerEvent);
            });
            this.root.on('mousedown' + ns + ' touchstart' + ns, '.loop-marker', (event) => {
                this.controller.onMarkerDragStart(event as unknown as ControllerPointerEvent);
            });
        }

        if (this.features.keyboard) {
            $(window).on('keydown' + ns, (event) => {
                this.controller.onKeyboard(event as unknown as ControllerPointerEvent);
            });
        }

        if (this.features.waveform) {
            $(window).on('resize' + ns, () => {
                this.controller.onResize();
            });
        }
    }

    unbind(): void {
        const ns = this.controller.eventNamespace;
        this.root.off(ns);
        $(window).off(ns);
    }
}
