import type { TrackSwitchInit } from "../src/index";
import {
	TrackSwitchAlignmentInteractive,
	TrackSwitchPlayer,
	type TrackSwitchInteractiveProps,
	type TrackSwitchPlayerProps,
} from "../src/react";
import type { InteractiveTrackSwitchInit } from "../src/interactive";

const defaultInit: TrackSwitchInit = {
	ui: [
		{
			type: "trackGroup",
			trackGroup: [
				{
					title: "Track 1",
					sources: [{ src: "track-1.mp3" }],
				},
			],
		},
	],
};

void defaultInit;

const modeFeatureInit: TrackSwitchInit = {
	ui: [
		{
			type: "trackGroup",
			trackGroup: [
				{
					title: "Track 1",
					sources: [{ src: "track-1.mp3" }],
				},
			],
		},
	],
	features: {
		// @ts-expect-error features.mode is not part of the public config.
		mode: "alignment",
	},
};

void modeFeatureInit;

const reactPlayerProps: TrackSwitchPlayerProps = {
	config: defaultInit,
};

void reactPlayerProps;
void TrackSwitchPlayer({ config: defaultInit });

// @ts-expect-error React player props use config, not init.
void TrackSwitchPlayer({ init: defaultInit });

const interactiveConfig: InteractiveTrackSwitchInit = {
	workerUrl: "trackswitch-alignment-worker.js",
};

const reactInteractiveProps: TrackSwitchInteractiveProps = {
	config: interactiveConfig,
};

void reactInteractiveProps;
void TrackSwitchAlignmentInteractive({ config: interactiveConfig });

// @ts-expect-error React interactive props use config, not init.
void TrackSwitchAlignmentInteractive({ init: interactiveConfig });

// @ts-expect-error TrackSwitchMode is no longer exported from the public API.
import type { TrackSwitchMode } from "../src/index";
