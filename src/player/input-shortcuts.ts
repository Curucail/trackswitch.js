const SHORTCUT_HELP_BLOCKED_KEYS = new Set([
    ' ',
    'Spacebar',
    'Space',
    'Escape',
    'Esc',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'r',
    'R',
    'a',
    'A',
    'b',
    'B',
    'l',
    'L',
    'c',
    'C',
]);

const SHORTCUT_HELP_BLOCKED_CODES = new Set([
    'KeyR',
    'KeyA',
    'KeyB',
    'KeyL',
    'KeyC',
]);

const KEYBOARD_SHORTCUT_HANDLERS: Record<string, (controller: any, event: any) => boolean> = {
    ' ': function(controller: any) {
        controller.togglePlay();
        return true;
    },
    Spacebar: function(controller: any) {
        controller.togglePlay();
        return true;
    },
    Space: function(controller: any) {
        controller.togglePlay();
        return true;
    },
    Escape: function(controller: any) {
        controller.stop();
        return true;
    },
    Esc: function(controller: any) {
        controller.stop();
        return true;
    },
    ArrowLeft: function(controller: any, event: any) {
        controller.seekRelative(event.shiftKey ? -5 : -2);
        return true;
    },
    ArrowRight: function(controller: any, event: any) {
        controller.seekRelative(event.shiftKey ? 5 : 2);
        return true;
    },
    ArrowUp: function(controller: any) {
        if (!controller.features.globalVolume) {
            return false;
        }
        controller.setVolume(controller.state.volume + 0.1);
        return true;
    },
    ArrowDown: function(controller: any) {
        if (!controller.features.globalVolume) {
            return false;
        }
        controller.setVolume(controller.state.volume - 0.1);
        return true;
    },
    Home: function(controller: any) {
        controller.seekTo(0);
        return true;
    },
    r: function(controller: any) {
        controller.dispatch({ type: 'toggle-repeat' });
        controller.updateMainControls();
        return true;
    },
    R: function(controller: any) {
        controller.dispatch({ type: 'toggle-repeat' });
        controller.updateMainControls();
        return true;
    },
    KeyR: function(controller: any) {
        controller.dispatch({ type: 'toggle-repeat' });
        controller.updateMainControls();
        return true;
    },
    a: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('A');
        return true;
    },
    A: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('A');
        return true;
    },
    KeyA: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('A');
        return true;
    },
    b: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('B');
        return true;
    },
    B: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('B');
        return true;
    },
    KeyB: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.setLoopPoint('B');
        return true;
    },
    l: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.toggleLoop();
        return true;
    },
    L: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.toggleLoop();
        return true;
    },
    KeyL: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.toggleLoop();
        return true;
    },
    c: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.clearLoop();
        return true;
    },
    C: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.clearLoop();
        return true;
    },
    KeyC: function(controller: any) {
        if (!controller.features.looping) {
            return false;
        }
        controller.clearLoop();
        return true;
    },
};

export function isShortcutHelpToggleKey(event: { key?: string; code?: string }): boolean {
    return event.key === 'F1' || event.code === 'F1';
}

function isShortcutSuppressedWhileHelpOpen(
    key: string,
    code: string,
    trackIndex: number | null
): boolean {
    if (trackIndex !== null) {
        return true;
    }

    return SHORTCUT_HELP_BLOCKED_KEYS.has(key) || SHORTCUT_HELP_BLOCKED_CODES.has(code);
}

export function handleShortcutHelpKeyboard(
    controller: any,
    event: any,
    key: string,
    code: string,
    trackIndex: number | null
): boolean {
    if (!controller.shortcutHelpOpen) {
        return false;
    }

    if (key === 'Escape' || key === 'Esc') {
        event.preventDefault();
        controller.closeShortcutHelp();
        event.stopPropagation();
        return true;
    }

    if (isShortcutSuppressedWhileHelpOpen(key, code, trackIndex)) {
        event.preventDefault();
        event.stopPropagation();
    }

    return true;
}

export function handleTrackKeyboardSelection(
    controller: any,
    event: any,
    trackIndex: number | null
): boolean {
    if (trackIndex === null || trackIndex >= controller.runtimes.length) {
        return false;
    }

    event.preventDefault();
    controller.toggleSolo(trackIndex, controller.effectiveSingleSoloMode);
    event.stopPropagation();
    return true;
}

export function handleGlobalKeyboardShortcut(controller: any, event: any, key: string): boolean {
    const handler = KEYBOARD_SHORTCUT_HANDLERS[key];
    if (!handler) {
        return false;
    }

    const handled = handler(controller, event);
    if (!handled) {
        return false;
    }

    event.preventDefault();
    return true;
}

export function getKeyboardTrackIndex(event: any): number | null {
    const key = event.key;
    const code = event.code;

    if (key === '0' || code === 'Digit0' || code === 'Numpad0') {
        return 9;
    }

    if (key && key >= '1' && key <= '9') {
        return Number(key) - 1;
    }

    if (code && code >= 'Digit1' && code <= 'Digit9') {
        return Number(code.slice(-1)) - 1;
    }

    if (code && code >= 'Numpad1' && code <= 'Numpad9') {
        return Number(code.slice(-1)) - 1;
    }

    return null;
}
