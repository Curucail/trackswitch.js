const defaults: Readonly<TrackSwitchOptions> = {
    mute: true,
    solo: true,
    globalsolo: true,
    globalvolume: false,
    repeat: false,
    radiosolo: false,
    onlyradiosolo: false,
    tabview: false,
    iosunmute: true,
    keyboard: true,
    looping: false,
    seekbar: true,
    waveform: true,
    waveformBarWidth: 1,
};

function normalizeOptions(options: TrackSwitchOptions): TrackSwitchOptions {
    if (!options.mute && !options.solo) {
        console.error('Cannot disable both solo and mute, reactivating solo');
        options.solo = true;
    }

    if (options.onlyradiosolo) {
        options.mute = false;
        options.radiosolo = true;
    }

    if (!Number.isFinite(options.waveformBarWidth) || options.waveformBarWidth < 1) {
        options.waveformBarWidth = 1;
    }

    return options;
}
