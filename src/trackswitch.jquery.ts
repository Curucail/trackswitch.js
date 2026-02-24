var jqueryPlugins = $.fn as unknown as Record<string, (this: PluginCollection, options?: Partial<TrackSwitchOptions>) => PluginCollection>;
jqueryPlugins[pluginName] = function(this: PluginCollection, options?: Partial<TrackSwitchOptions>) {
    return this.each(function(this: HTMLElement) {
        if (!$(this).data('plugin_' + pluginName)) {
            $(this).data('plugin_' + pluginName, new TrackSwitchPlugin(this, options));
        }
    });
};

(jQuery as unknown as { trackSwitchInternals?: unknown }).trackSwitchInternals = {
    normalizeOptions: normalizeOptions,
    parsePresetIndices: parsePresetIndices,
    parseTrackElementConfig: parseTrackElementConfig,
    inferSourceMimeType: inferSourceMimeType,
    formatSecondsToHHMMSSmmm: formatSecondsToHHMMSSmmm,
};
