import { TrackSwitchConfig, TrackSwitchController, TrackSwitchFeatures } from '../../domain/types';
import { createTrackSwitch } from '../../core/track-switch-controller';
import { parseLegacyConfig, isTrackSwitchConfig, LegacyOptions } from './parser';
import { requireJQuery } from '../../utils/jquery';

type LegacyCommand = 'destroy' | 'load' | 'play' | 'pause' | 'stop';
type AdapterInput = LegacyOptions | TrackSwitchConfig | LegacyCommand | undefined;

interface JQueryPluginMap {
    [name: string]: (this: JQuery<HTMLElement>, options?: AdapterInput) => JQuery<HTMLElement>;
}

function runCommand(controller: TrackSwitchController, command: LegacyCommand): void {
    switch (command) {
        case 'destroy':
            controller.destroy();
            break;
        case 'load':
            void controller.load();
            break;
        case 'play':
            controller.play();
            break;
        case 'pause':
            controller.pause();
            break;
        case 'stop':
            controller.stop();
            break;
    }
}

export function registerLegacyJQueryAdapter(jquery?: JQueryStatic): void {
    const $ = jquery || requireJQuery();

    const pluginMap = $.fn as unknown as JQueryPluginMap;

    pluginMap.trackSwitch = function(this: JQuery<HTMLElement>, options?: AdapterInput) {
        return this.each(function(this: HTMLElement) {
            const element = $(this);
            const existing = element.data('plugin_trackSwitch') as TrackSwitchController | undefined;

            if (typeof options === 'string') {
                if (existing) {
                    runCommand(existing, options);
                }
                return;
            }

            if (existing) {
                return;
            }

            const config = isTrackSwitchConfig(options)
                ? options
                : parseLegacyConfig(element, options as Partial<TrackSwitchFeatures> | undefined);

            const controller = createTrackSwitch(this, config);

            element.data('plugin_trackSwitch', controller);
            element.data('trackSwitchController', controller);
        });
    };
}

export type { LegacyOptions };
