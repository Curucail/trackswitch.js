import { createTrackSwitch, type TrackSwitchInit } from 'trackswitch';

const root = document.createElement('div');

const init: TrackSwitchInit = {
    ui: [
        {
            type: 'trackGroup',
            trackGroup: [
                {
                    title: 'Track 1',
                    sources: [{ src: 'track1.mp3' }],
                },
            ],
        },
    ],
};

createTrackSwitch(root, init);
