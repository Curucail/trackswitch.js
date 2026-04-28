import { createInteractiveTrackSwitch } from './interactive/interactive-factory';

const TrackSwitchInteractive = {
    createInteractiveTrackSwitch,
};

declare global {
    interface Window {
        TrackSwitchInteractive: typeof TrackSwitchInteractive;
    }
}

if (typeof window !== 'undefined') {
    window.TrackSwitchInteractive = TrackSwitchInteractive;
}

export { createInteractiveTrackSwitch };
