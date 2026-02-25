import { createTrackSwitch } from './core/track-switch-controller';
import { registerLegacyJQueryAdapter } from './adapters/legacy-jquery/register';
import { normalizeFeatures, defaultFeatures } from './domain/options';
import { createInitialPlayerState, playerStateReducer } from './domain/state';
import { WaveformEngine } from './engine/waveform-engine';
import {
    inferSourceMimeType,
    formatSecondsToHHMMSSmmm,
    parsePresetIndices,
} from './utils/helpers';

export { createTrackSwitch };
export { registerLegacyJQueryAdapter };
export { normalizeFeatures, defaultFeatures };
export { createInitialPlayerState, playerStateReducer };
export { WaveformEngine };
export { inferSourceMimeType, formatSecondsToHHMMSSmmm, parsePresetIndices };

export type {
    LoopMarker,
    PlayerState,
    TrackDefinition,
    TrackRuntime,
    TrackSourceDefinition,
    TrackState,
    TrackSwitchConfig,
    TrackSwitchController,
    TrackSwitchEventMap,
    TrackSwitchEventName,
    TrackSwitchFeatures,
    TrackSwitchSnapshot,
} from './domain/types';

const maybeJQuery = (globalThis as unknown as { jQuery?: JQueryStatic; $?: JQueryStatic }).jQuery
    || (globalThis as unknown as { $?: JQueryStatic }).$;

if (maybeJQuery && typeof maybeJQuery.fn === 'object') {
    registerLegacyJQueryAdapter(maybeJQuery);
}
