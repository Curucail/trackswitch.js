import { TrackSwitchFeatures } from '../domain/types';
import { eventTargetAsElement } from '../shared/dom';
import { ControllerPointerEvent } from '../shared/seek';

export interface InputController {
    eventNamespace: string;
    presetCount: number;
    setKeyboardActive(): void;
    onOverlayActivate(event: ControllerPointerEvent): void;
    onOverlayInfo(event: ControllerPointerEvent): void;
    onPlayPause(event: ControllerPointerEvent): void;
    onStop(event: ControllerPointerEvent): void;
    onRepeat(event: ControllerPointerEvent): void;
    onSeekStart(event: ControllerPointerEvent): void;
    onSeekMove(event: ControllerPointerEvent): void;
    onSeekEnd(event: ControllerPointerEvent): void;
    onMute(event: ControllerPointerEvent): void;
    onSolo(event: ControllerPointerEvent): void;
    onAlignmentSync(event: ControllerPointerEvent): void;
    onVolume(event: ControllerPointerEvent): void;
    onPreset(event: ControllerPointerEvent): void;
    onPresetScroll(event: ControllerPointerEvent): void;
    onWaveformZoomWheel(event: ControllerPointerEvent): void;
    onSetLoopA(event: ControllerPointerEvent): void;
    onSetLoopB(event: ControllerPointerEvent): void;
    onToggleLoop(event: ControllerPointerEvent): void;
    onClearLoop(event: ControllerPointerEvent): void;
    onMarkerDragStart(event: ControllerPointerEvent): void;
    onKeyboard(event: ControllerPointerEvent): void;
    onResize(): void;
}

function eventToPointerEvent(event: Event): ControllerPointerEvent {
    const mouseEvent = event as MouseEvent;
    const keyboardEvent = event as KeyboardEvent;
    const touchEvent = event as TouchEvent;

    let pageX: number | undefined;
    let pageY: number | undefined;
    if (typeof mouseEvent.pageX === 'number') {
        pageX = mouseEvent.pageX;
        pageY = typeof mouseEvent.pageY === 'number' ? mouseEvent.pageY : undefined;
    } else if (touchEvent.touches && touchEvent.touches.length > 0) {
        pageX = touchEvent.touches[0].pageX;
        pageY = touchEvent.touches[0].pageY;
    } else if (touchEvent.changedTouches && touchEvent.changedTouches.length > 0) {
        pageX = touchEvent.changedTouches[0].pageX;
        pageY = touchEvent.changedTouches[0].pageY;
    }

    let which = (mouseEvent as unknown as { which?: number }).which;
    if (which === undefined && typeof mouseEvent.button === 'number') {
        if (mouseEvent.button === 0) {
            which = 1;
        } else if (mouseEvent.button === 1) {
            which = 2;
        } else if (mouseEvent.button === 2) {
            which = 3;
        }
    }

    return {
        type: event.type,
        which: which,
        pageX: pageX,
        pageY: pageY,
        key: keyboardEvent.key,
        code: keyboardEvent.code,
        shiftKey: keyboardEvent.shiftKey,
        target: event.target,
        originalEvent: event as Event & {
            deltaY?: number;
            touches?: ArrayLike<{ pageX: number; pageY: number }>;
            changedTouches?: ArrayLike<{ pageX: number; pageY: number }>;
        },
        preventDefault: function() {
            event.preventDefault();
        },
        stopPropagation: function() {
            event.stopPropagation();
        },
    };
}

export class InputBinder {
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly controller: InputController;
    private readonly unbinders: Array<() => void> = [];

    constructor(root: HTMLElement, features: TrackSwitchFeatures, controller: InputController) {
        this.root = root;
        this.features = features;
        this.controller = controller;
    }

    private addListener(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): void {
        target.addEventListener(type, listener, options);
        this.unbinders.push(function() {
            target.removeEventListener(type, listener, options);
        });
    }

    private addDelegatedListener(
        type: string,
        selector: string,
        callback: (event: ControllerPointerEvent, matchedElement: Element) => void,
        target?: EventTarget,
        options?: AddEventListenerOptions
    ): void {
        const eventTarget = target || this.root;

        const listener = (event: Event) => {
            const eventElement = eventTargetAsElement(event.target);
            if (!eventElement) {
                return;
            }

            const matched = eventElement.closest(selector);
            if (!matched) {
                return;
            }

            if (eventTarget === this.root && !this.root.contains(matched)) {
                return;
            }

            callback(eventToPointerEvent(event), matched);
        };

        this.addListener(eventTarget, type, listener as EventListener, options);
    }

    bind(): void {
        this.addDelegatedListener('click', '.overlay .activate', (event) => {
            this.controller.onOverlayActivate(event);
        });

        this.addDelegatedListener('touchstart', '.overlay #overlayinfo .info', (event) => {
            this.controller.onOverlayInfo(event);
        });
        this.addDelegatedListener('mousedown', '.overlay #overlayinfo .info', (event) => {
            this.controller.onOverlayInfo(event);
        });

        const activateKeyboard = () => {
            this.controller.setKeyboardActive();
        };
        this.addListener(this.root, 'touchstart', activateKeyboard as EventListener);
        this.addListener(this.root, 'mousedown', activateKeyboard as EventListener);

        this.addDelegatedListener('touchstart', '.playpause', (event) => {
            this.controller.onPlayPause(event);
        });
        this.addDelegatedListener('mousedown', '.playpause', (event) => {
            this.controller.onPlayPause(event);
        });

        this.addDelegatedListener('touchstart', '.stop', (event) => {
            this.controller.onStop(event);
        });
        this.addDelegatedListener('mousedown', '.stop', (event) => {
            this.controller.onStop(event);
        });

        this.addDelegatedListener('touchstart', '.repeat', (event) => {
            this.controller.onRepeat(event);
        });
        this.addDelegatedListener('mousedown', '.repeat', (event) => {
            this.controller.onRepeat(event);
        });

        this.addDelegatedListener('touchstart', '.seekwrap', (event) => {
            this.controller.onSeekStart(event);
        });
        this.addDelegatedListener('mousedown', '.seekwrap', (event) => {
            this.controller.onSeekStart(event);
        });

        this.addListener(window, 'touchmove', (event) => {
            this.controller.onSeekMove(eventToPointerEvent(event));
        }, { passive: false });
        this.addListener(window, 'mousemove', (event) => {
            this.controller.onSeekMove(eventToPointerEvent(event));
        });

        this.addListener(window, 'touchend', (event) => {
            this.controller.onSeekEnd(eventToPointerEvent(event));
        }, { passive: false });
        this.addListener(window, 'touchcancel', (event) => {
            this.controller.onSeekEnd(eventToPointerEvent(event));
        }, { passive: false });
        this.addListener(window, 'mouseup', (event) => {
            this.controller.onSeekEnd(eventToPointerEvent(event));
        });

        this.addDelegatedListener('touchstart', '.mute', (event) => {
            this.controller.onMute(event);
        });
        this.addDelegatedListener('mousedown', '.mute', (event) => {
            this.controller.onMute(event);
        });

        this.addDelegatedListener('touchstart', '.solo', (event) => {
            this.controller.onSolo(event);
        });
        this.addDelegatedListener('mousedown', '.solo', (event) => {
            this.controller.onSolo(event);
        });

        this.addDelegatedListener('touchstart', '.sync-global', (event) => {
            this.controller.onAlignmentSync(event);
        });
        this.addDelegatedListener('mousedown', '.sync-global', (event) => {
            this.controller.onAlignmentSync(event);
        });

        if (this.features.globalvolume) {
            this.addDelegatedListener('input', '.volume-slider', (event) => {
                this.controller.onVolume(event);
            });

            const stopPropagationOnVolume = (event: Event) => {
                const eventElement = eventTargetAsElement(event.target);
                if (!eventElement) {
                    return;
                }
                const matched = eventElement.closest('.volume-control');
                if (matched && this.root.contains(matched)) {
                    event.stopPropagation();
                }
            };

            this.addListener(this.root, 'touchstart', stopPropagationOnVolume as EventListener, { passive: false });
            this.addListener(this.root, 'touchmove', stopPropagationOnVolume as EventListener, { passive: false });
            this.addListener(this.root, 'touchend', stopPropagationOnVolume as EventListener, { passive: false });
            this.addListener(this.root, 'mousedown', stopPropagationOnVolume as EventListener);
            this.addListener(this.root, 'mousemove', stopPropagationOnVolume as EventListener);
            this.addListener(this.root, 'mouseup', stopPropagationOnVolume as EventListener);
        }

        if (this.features.presets && this.controller.presetCount >= 2) {
            this.addDelegatedListener('change', '.preset-selector', (event) => {
                this.controller.onPreset(event);
            });

            this.addDelegatedListener(
                'wheel',
                '.preset-selector',
                (event) => {
                    this.controller.onPresetScroll(event);
                },
                undefined,
                { passive: false }
            );

            const stopPresetPropagation = (event: Event) => {
                const eventElement = eventTargetAsElement(event.target);
                if (!eventElement) {
                    return;
                }

                const matched = eventElement.closest('.preset-selector, .preset-selector-wrap');
                if (matched && this.root.contains(matched)) {
                    event.stopPropagation();
                }
            };

            this.addListener(this.root, 'touchstart', stopPresetPropagation as EventListener, { passive: false });
            this.addListener(this.root, 'touchend', stopPresetPropagation as EventListener, { passive: false });
            this.addListener(this.root, 'mousedown', stopPresetPropagation as EventListener);
            this.addListener(this.root, 'mouseup', stopPresetPropagation as EventListener);
            this.addListener(this.root, 'click', stopPresetPropagation as EventListener);
        }

        if (this.features.looping) {
            this.addDelegatedListener('touchstart', '.loop-a', (event) => {
                this.controller.onSetLoopA(event);
            });
            this.addDelegatedListener('mousedown', '.loop-a', (event) => {
                this.controller.onSetLoopA(event);
            });

            this.addDelegatedListener('touchstart', '.loop-b', (event) => {
                this.controller.onSetLoopB(event);
            });
            this.addDelegatedListener('mousedown', '.loop-b', (event) => {
                this.controller.onSetLoopB(event);
            });

            this.addDelegatedListener('touchstart', '.loop-toggle', (event) => {
                this.controller.onToggleLoop(event);
            });
            this.addDelegatedListener('mousedown', '.loop-toggle', (event) => {
                this.controller.onToggleLoop(event);
            });

            this.addDelegatedListener('touchstart', '.loop-clear', (event) => {
                this.controller.onClearLoop(event);
            });
            this.addDelegatedListener('mousedown', '.loop-clear', (event) => {
                this.controller.onClearLoop(event);
            });

            this.addDelegatedListener('touchstart', '.loop-marker', (event) => {
                this.controller.onMarkerDragStart(event);
            });
            this.addDelegatedListener('mousedown', '.loop-marker', (event) => {
                this.controller.onMarkerDragStart(event);
            });

            this.addDelegatedListener('contextmenu', '.seekwrap', (event) => {
                event.preventDefault();
            });
        }

        if (this.features.keyboard) {
            this.addListener(window, 'keydown', (event) => {
                this.controller.onKeyboard(eventToPointerEvent(event));
            });
        }

        const hasSheetMusicUi = !!this.root.querySelector('.sheetmusic, .sheetmusic-wrap');

        if (this.features.waveform) {
            if (this.features.waveformzoom) {
                this.addDelegatedListener(
                    'wheel',
                    '.waveform-wrap',
                    (event) => {
                        this.controller.onWaveformZoomWheel(event);
                    },
                    undefined,
                    { passive: false }
                );
            }

        }

        if (this.features.waveform || hasSheetMusicUi) {
            this.addListener(window, 'resize', () => {
                this.controller.onResize();
            });
        }
    }

    unbind(): void {
        while (this.unbinders.length > 0) {
            const unbind = this.unbinders.pop();
            if (unbind) {
                unbind();
            }
        }
    }
}
