import { TrackSwitchPlayer as VueTrackSwitchPlayer } from '../src/vue';
import { getTrackswitchController, useTrackswitch } from '../src/svelte';
import type { TrackswitchPlayer } from '../src/element';
import type { TrackSwitchInit } from '../src';

const init: TrackSwitchInit = {
    ui: [
        {
            type: 'trackGroup',
            trackGroup: [
                {
                    title: 'Example',
                    sources: [{ src: 'example.mp3' }],
                },
            ],
        },
    ],
};

void VueTrackSwitchPlayer;

declare const element: TrackswitchPlayer;

const action = useTrackswitch(element, {
    init,
    onLoaded(payload) {
        payload.longestDuration.toFixed(2);
    },
    onError(payload) {
        payload.message.toUpperCase();
    },
});

action.update({ init });
const controller = getTrackswitchController(element);
controller?.pause();
action.destroy();
