import { ElementConfigError, loadElementConfig } from "./config/element-config";
import {
	defineTrackswitchDefaultElement,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TrackswitchPlayer,
} from "./element";
import { createTrackSwitch } from "./player/factory";
import { parseNumericCsv } from "./shared/alignment";
import { ensureTrackSwitchStyles } from "./shared/styles";
import { renderIconSlotHtml } from "./ui/icons";
import {
	describeError,
	renderTrackSwitchErrorPanel,
	renderTrackSwitchLoadingPanel,
} from "./ui/render-status-panel";

defineTrackswitchDefaultElement();

export const interactiveExtensionApi = {
	createTrackSwitch,
	describeError,
	ensureTrackSwitchStyles,
	isElementConfigError: (error: unknown) => error instanceof ElementConfigError,
	loadElementConfig,
	parseNumericCsv,
	renderIconSlotHtml,
	renderTrackSwitchErrorPanel,
	renderTrackSwitchLoadingPanel,
};

const TrackSwitch = {
	TrackswitchPlayer,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	createTrackSwitch,
	defineTrackswitchDefaultElement,
	interactiveExtensionApi,
};

declare global {
	interface Window {
		TrackSwitch: typeof TrackSwitch;
	}
}

if (typeof window !== "undefined") {
	window.TrackSwitch = TrackSwitch;
}

export {
	createTrackSwitch,
	defineTrackswitchDefaultElement,
	TRACKSWITCH_DEFAULT_ELEMENT_NAME,
	TrackswitchPlayer,
};
