class TrackSwitchPlugin {
    element: JQuery<HTMLElement>;
    options: TrackSwitchOptions;
    _defaults: Readonly<TrackSwitchOptions>;
    _name: string;
    instanceId: number;
    eventNamespace: string;
    isLoaded: boolean;
    isLoading: boolean;
    isDestroyed: boolean;

    numberOfTracks: number;
    longestDuration: number;
    playing: boolean;
    repeat: boolean;
    startTime: number;
    position: number;
    timerMonitorPosition: ReturnType<typeof setInterval> | null;
    currentlySeeking: boolean;
    seekingElement: JQuery<HTMLElement> | null;
    masterVolume: number;
    iOSPlaybackUnlocked: boolean;

    loopPointA: number | null;
    loopPointB: number | null;
    loopEnabled: boolean;
    rightClickDragging: boolean;
    loopDragStart: number | null;
    draggingMarker: LoopMarker;
    loopMinDistance: number;

    presetNames: string[];
    presetCount: number;
    originalImage: string;

    trackProperties: TrackProperty[];
    trackSources: Array<JQuery<HTMLElement>>;
    trackGainNode: Array<GainNode>;
    trackBuffer: Array<AudioBuffer | null>;
    trackTiming: Array<TrackTiming>;
    activeAudioSources: Array<AudioBufferSourceNode | null>;

    waveformCanvas: HTMLCanvasElement[];
    waveformData: Array<Float32Array | null>;
    waveformContext: Array<CanvasRenderingContext2D | null>;
    waveformOriginalHeight: number[];
    resizeDebounceTimer: ReturnType<typeof setTimeout> | null;

    gainNodeVolume: GainNode | null;
    gainNodeMaster: GainNode | null;

    constructor(element: Element, options: Partial<TrackSwitchOptions> = {}) {
        this.element = $(element) as JQuery<HTMLElement>;
        this.options = normalizeOptions($.extend({}, defaults, options));

        this._defaults = defaults;
        this._name = pluginName;
        this.instanceId = pluginInstanceCounter++;
        this.eventNamespace = '.trackswitch.' + this.instanceId;
        this.isLoaded = false;
        this.isLoading = false;
        this.isDestroyed = false;

        // Properties for the overall player
        this.numberOfTracks = 0;
        this.longestDuration = 0;
        this.playing = false;
        this.repeat = this.options.repeat;
        this.startTime = 0;
        this.position = 0;
        this.timerMonitorPosition = null;
        this.currentlySeeking = false;
        this.seekingElement = null;
        this.masterVolume = 1.0;
        this.iOSPlaybackUnlocked = false;

        // A/B Loop properties
        this.loopPointA = null;  // Time in seconds, or null if not set
        this.loopPointB = null;  // Time in seconds, or null if not set
        this.loopEnabled = false; // Whether A/B loop is active
        this.rightClickDragging = false; // Tracks right-click drag state for loop selection
        this.loopDragStart = null; // Stores starting position during right-drag
        this.draggingMarker = null; // Tracks which marker is being dragged ('A', 'B', or null)
        this.loopMinDistance = 0.1; // Minimum distance between loop points (0.1 seconds)

        // Preset configuration properties
        this.presetNames = [];
        this.presetCount = 0;
        this.originalImage = '';

        // Properties and data for each track in coherent arrays
        this.trackProperties = [];
        this.trackSources = [];
        this.trackGainNode = [];
        this.trackBuffer = [];
        this.trackTiming = [];
        this.activeAudioSources = [];

        // Waveform visualization properties
        this.waveformCanvas = [];
        this.waveformData = [];
        this.waveformContext = [];
        this.waveformOriginalHeight = [];
        this.resizeDebounceTimer = null;

        this.gainNodeVolume = null;
        this.gainNodeMaster = null;

        // Skip gain node creation if WebAudioAPI could not load.
        if (audioContext) {
            // Volume gain node (user-controlled, between master and destination)
            this.gainNodeVolume = audioContext.createGain();
            this.gainNodeVolume.gain.value = this.options.globalvolume ? this.masterVolume : 1.0;
            this.gainNodeVolume.connect(audioContext.destination);

            // Master output gain node setup (used for fade ramps)
            this.gainNodeMaster = audioContext.createGain();
            this.gainNodeMaster.gain.value = 0.0; // Start at 0.0 to allow fade in
            this.gainNodeMaster.connect(this.gainNodeVolume);
        }

        this.init();
    }
}

interface TrackSwitchPlugin {
    init(): boolean | void;
    destroy(): void;
    canUseAudioGraph(): boolean;
    sourceFailed(currentTrack: number, currentSource: number, errorType: string): void;
    decodeAudio(request: XMLHttpRequest, currentTrack: number, currentSource: number): void;
    makeRequest(currentTrack: number, currentSource: number): void;
    prepareRequest(currentTrack: number, currentSource: number): void;
    load(event: TrackSwitchEvent): boolean | void;
    findLongest(): void;
    trackStatusChanged(): void;
    loaded(): void;
    errored(): void;
    unbindEvents(): void;
    bindEvents(): void;
    valid_click(event: TrackSwitchEvent): boolean;
    isIOSDevice(): boolean;
    unlockIOSPlayback(): void;
    secondsToHHMMSSmmm(seconds: number): string;
    calculateTrackTiming(sourceElement: HTMLElement | JQuery<HTMLElement>, bufferDuration: number): TrackTiming;
    updateMainControls(): void;
    monitorPosition(context: TrackSwitchPlugin): void;
    stopAudio(): void;
    startAudio(newPos?: number, duration?: number): void;
    pause(): void;
    other_instances(): PluginCollection;
    pause_others(): void;
    seekRelative(seconds: number): void;
    adjustVolume(delta: number): void;
    handleKeyboardEvent(event: TrackSwitchEvent): boolean | void;
    event_playpause(event: TrackSwitchEvent): boolean | void;
    event_stop(event: TrackSwitchEvent): boolean | void;
    event_repeat(event: TrackSwitchEvent): boolean | void;
    event_setLoopA(event: TrackSwitchEvent): boolean | void;
    event_setLoopB(event: TrackSwitchEvent): boolean | void;
    event_toggleLoop(event: TrackSwitchEvent): boolean | void;
    event_clearLoop(event: TrackSwitchEvent): boolean | void;
    seek(event: TrackSwitchEvent): void;
    event_seekStart(event: TrackSwitchEvent): boolean | void;
    event_seekMove(event: TrackSwitchEvent): boolean | void;
    event_seekEnd(event: TrackSwitchEvent): boolean | void;
    event_markerDragStart(event: TrackSwitchEvent): boolean | void;
    _index_from_target(target: EventTarget | null): number;
    event_solo(event: TrackSwitchEvent): boolean | void;
    event_mute(event: TrackSwitchEvent): boolean | void;
    event_preset(event: TrackSwitchEvent): void;
    event_preset_scroll(event: TrackSwitchEvent): void;
    switch_image(): void;
    calculateWaveformPeaks(buffer: AudioBuffer, width: number): Float32Array;
    drawWaveform(canvasIndex: number, peaks: Float32Array): void;
    drawDummyWaveform(canvasIndex: number): void;
    drawDummyWaveforms(): void;
    generateWaveforms(): void;
    calculateMixedWaveform(): Float32Array | null;
    switchWaveform(): void;
    handleWaveformResize(): void;
    apply_track_properties(): void;
    event_volume(event: TrackSwitchEvent): void;
    deselect(index?: number): void;
}


// Initialize Plugin
// Add markup for play controls
// Bind overlay click events
TrackSwitchPlugin.prototype.init = function() {

    var that = this;

    // Add class for default CSS stylesheet
    this.element.addClass("jquery-trackswitch");

    // Parse preset configuration early so we can conditionally include preset dropdown
    var presetConfig = buildPresetConfig(this.element);
    this.presetNames = presetConfig.presetNames;
    this.presetCount = presetConfig.presetCount;

    if(this.element.find(".main-control").length === 0) {
        // Build preset dropdown HTML (only if presetCount >= 2)
        var presetDropdownHtml = '';
        if (this.presetCount >= 2) {
            presetDropdownHtml = '<li class="preset-selector-wrap">' +
                '<select class="preset-selector" title="Select Preset">';
            for (var p = 0; p < this.presetNames.length; p++) {
                presetDropdownHtml += '<option value="' + p + '"' + (p === 0 ? ' selected' : '') + '>' +
                    escapeHtml(this.presetNames[p]) + '</option>';
            }
            presetDropdownHtml += '</select></li>';
        }

        this.element.prepend(
            '<div class="overlay"><span class="activate">Activate</span>' +
                '<p id="overlaytext"></p>' +
                '<p id="overlayinfo">' +
                    '<span class="info">Info</span>' +
                    '<span class="text">' +
                        '<strong>trackswitch.js</strong> - open source multitrack audio player<br />' +
                        '<a href="https://github.com/audiolabs/trackswitch.js">https://github.com/audiolabs/trackswitch.js</a>' +
                    '</span>' +
                '</p>' +
            '</div>' +
            '<div class="main-control">' +
                '<ul class="control">' +
                    '<li class="playback-group">' +
                        '<ul class="playback-controls">' +
                            '<li class="playpause button" title="Play/Pause (Spacebar)">Play</li>' +
                            '<li class="stop button" title="Stop (Esc)">Stop</li>' +
                            '<li class="repeat button" title="Repeat (R)">Repeat</li>' +
                        '</ul>' +
                    '</li>' +
                    (that.options.globalvolume ? '<li class="volume">' +
                        '<div class="volume-control">' +
                            '<i class="fa-volume-up volume-icon"></i>' +
                            '<input type="range" class="volume-slider" min="0" max="100" value="100">' +
                        '</div>' +
                    '</li>' : '') +
                    (that.options.looping ? '<li class="loop-group">' +
                        '<ul class="loop-controls">' +
                            '<li class="loop-a button" title="Set Loop Point A (A)">Loop A</li>' +
                            '<li class="loop-b button" title="Set Loop Point B (B)">Loop B</li>' +
                            '<li class="loop-toggle button" title="Toggle Loop On/Off (L)">Loop</li>' +
                            '<li class="loop-clear button" title="Clear Loop Points (C)">Clear</li>' +
                        '</ul>' +
                    '</li>' : '') +
                    presetDropdownHtml +
                    '<li class="timing">' +
                        '<span class="time">' +
                            '--:--:--:---' +
                        '</span>' +
                        ' / ' +
                        '<span class="length">' +
                            '--:--:--:---' +
                        '</span>' +
                    '</li>' +
                    (that.options.seekbar ? '<li class="seekwrap">' +
                        '<div class="seekbar">' +
                            '<div class="loop-region"></div>' +
                            '<div class="loop-marker marker-a"></div>' +
                            '<div class="loop-marker marker-b"></div>' +
                            '<div class="seekhead"></div>' +
                        '</div>' +
                    '</li>' : '') +
                '</ul>' +
            '</div>'
        );
    }

    // Remove the playhead in `.main-control` when there is one or more seekable images
    if (this.element.find('.seekable:not(.seekable-img-wrap > .seekable)').length > 0) {
        this.element.find('.main-control .seekwrap').hide();
    }

    // Wrap any seekable poster images in seekable markup
    this.element.find('.seekable:not(.seekable-img-wrap > .seekable)').each(function(this: HTMLElement) {

        // Save a copy of the original image src to reset image to
        var imageElement = this as HTMLImageElement;
        that.originalImage = imageElement.src;

        const wrappedImage = $(imageElement) as JQuery<HTMLImageElement>;
        wrappedImage.wrap('<div class="seekable-img-wrap"></div>');
        wrappedImage.parent('.seekable-img-wrap').attr('style', sanitizeInlineStyle(wrappedImage.data("style")) + '; display: block;');

        var trackElementConfig = parseTrackElementConfig(wrappedImage as JQuery<HTMLElement>);

        wrappedImage.after(
            '<div class="seekwrap" style=" ' +
            'left: ' + trackElementConfig.seekMarginLeft + '%; ' +
            'right: ' + trackElementConfig.seekMarginRight + '%;">' +
                '<div class="loop-region"></div>' +
                '<div class="loop-marker marker-a"></div>' +
                '<div class="loop-marker marker-b"></div>' +
                '<div class="seekhead"></div>' +
            '</div>'
        );

    });

    // Wrap any waveform canvases in seekable markup (similar to seekable images)
    if (this.options.waveform) {
        this.element.find('canvas.waveform:not(.waveform-wrap > canvas.waveform)').each(function(this: HTMLElement) {
            var canvasElement = this as HTMLCanvasElement;

            // Store canvas reference and original height
            that.waveformCanvas.push(canvasElement);
            that.waveformContext.push(canvasElement.getContext('2d'));
            that.waveformOriginalHeight.push(canvasElement.height); // Store the original height attribute

            // Apply custom styling from data attribute
            const wrappedCanvas = $(canvasElement) as JQuery<HTMLCanvasElement>;
            wrappedCanvas.wrap('<div class="waveform-wrap"></div>');
            wrappedCanvas.parent('.waveform-wrap').attr('style', sanitizeInlineStyle(wrappedCanvas.data("waveformStyle")) + '; display: block;');

            wrappedCanvas.after(
                '<div class="seekwrap" style=" ' +
                'left: ' + clampPercent(wrappedCanvas.data("seekMarginLeft")) + '%; ' +
                'right: ' + clampPercent(wrappedCanvas.data("seekMarginRight")) + '%;">' +
                    '<div class="loop-region"></div>' +
                    '<div class="loop-marker marker-a"></div>' +
                    '<div class="loop-marker marker-b"></div>' +
                    '<div class="seekhead"></div>' +
                '</div>'
            );

        });

        // Draw dummy waveforms on all canvases before audio loads
        this.drawDummyWaveforms();
    }

    // Prevent context menu on seekbar for right-click loop selection (only if looping is enabled)
    if (this.options.looping) {
    this.element.on('contextmenu' + this.eventNamespace, '.seekwrap', function(e) {
            e.preventDefault();
            return false;
        });
    }

    this.element.on('touchstart' + this.eventNamespace + ' mousedown' + this.eventNamespace, '.overlay .activate', $.proxy(this.load, this));
    this.element.on('touchstart' + this.eventNamespace + ' mousedown' + this.eventNamespace, '.overlay #overlayinfo .info', $.proxy(function() {
        this.element.find('.overlay .info').hide();
        this.element.find('.overlay .text').show();
    }, this));
    this.element.one('loaded' + this.eventNamespace, $.proxy(this.loaded, this));
    this.element.one('errored' + this.eventNamespace, $.proxy(this.errored, this));

    var tracklist = $('<ul class="track_list"></ul>');

    this.numberOfTracks = this.element.find('ts-track').length;

    if (this.numberOfTracks > 0) {

        this.element.find('ts-track').each(function(i) {

            var trackElementConfig = parseTrackElementConfig($(this) as JQuery<HTMLElement>);
            var presetsForTrack = trackElementConfig.presetsForTrack;

            that.trackProperties[i] = {
                mute: this.hasAttribute('mute'),  // <ts-track title="Track" mute>
                solo: this.hasAttribute('solo'),  // <ts-track title="Track" solo>
                success: false,
                error: false,
                presetsForTrack: presetsForTrack  // Array of preset indices this track belongs to
            };

            // Append classes to '.track' depending on options (for styling and click binding)
            var tabview = that.options.tabview ? " tabs" : ""; // For styling into tab view
            var radiosolo = that.options.radiosolo ? " radio" : ""; // For styling the (radio)solo button
            var wholesolo = that.options.onlyradiosolo ? " solo" : ""; // For making whole track clickable

            var $track = $('<li class="track' + tabview + wholesolo + '"></li>');
            $track.attr('style', sanitizeInlineStyle($(this).attr('style') || ''));
            $track.append(document.createTextNode(String($(this).attr('title') || "Track " + (i+1))));

            var $control = $('<ul class="control"></ul>');
            if (that.options.mute) {
                $control.append('<li class="mute button" title="Mute">Mute</li>');
            }
            if (that.options.solo) {
                $control.append('<li class="solo button' + radiosolo + '" title="Solo">Solo</li>');
            }
            $track.append($control);
            tracklist.append($track);

        });

        this.element.append(tracklist);

        // If radiosolo (or onlyradiosolo) selected, start with one track soloed
        if(this.options.radiosolo) {
            this.trackProperties[0].solo = true;
            this.apply_track_properties();
        }

        this.updateMainControls();

        // Throw a player error if the WebAudioAPI could not load.
        if (!audioContext) {
            this.element.trigger("errored");
            this.element.find("#overlaytext").text("Web Audio API is not supported in your browser. Please consider upgrading.");
            return false;
        }

    } else {

        this.element.trigger("errored");
        // With no text, as the player will be too small to show it anyway

    }

};


// Remove player elements etc
TrackSwitchPlugin.prototype.destroy = function() {
    if (this.isDestroyed) {
        return;
    }
    this.isDestroyed = true;

    if (this.playing) {
        this.stopAudio();
    }

    if (this.timerMonitorPosition) {
        clearInterval(this.timerMonitorPosition);
        this.timerMonitorPosition = null;
    }
    if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
        this.resizeDebounceTimer = null;
    }

    this.unbindEvents();

    this.element.find(".main-control").remove();
    this.element.find(".track_list").remove();
    this.gainNodeMaster?.disconnect();
    this.gainNodeVolume?.disconnect();
    if (isKeyboardInstanceActive(this.instanceId)) {
        setActiveKeyboardInstance(null);
    }
    this.element.removeData('plugin_' + pluginName);
};

TrackSwitchPlugin.prototype.canUseAudioGraph = function() {
    return !!(audioContext && this.gainNodeMaster && this.gainNodeVolume);
};


// In case of source error, request next source if there is one, else fire a track error
TrackSwitchPlugin.prototype.sourceFailed = function(currentTrack, currentSource, errorType) {
    if (this.isDestroyed) {
        return;
    }

    // Request next source for this track if it exists, else throw error
    if (this.trackSources[currentTrack][currentSource+1] !== undefined) {
        this.prepareRequest(currentTrack, currentSource+1);
    } else {
        this.trackProperties[currentTrack].error = true;
        this.trackStatusChanged();
    }

}


// On sucessful audio file request, decode it into an audiobuffer
// Create and connect gain nodes for this track
TrackSwitchPlugin.prototype.decodeAudio = function(request, currentTrack, currentSource) {
    if (!this.canUseAudioGraph() || !audioContext || !this.gainNodeMaster) {
        this.sourceFailed(currentTrack, currentSource, "Web Audio unavailable");
        return;
    }

    var that = this;
    var audioData = request.response;

    // Looks like promise-based syntax (commented below) isn't supported on mobile yet...
    // audioContext.decodeAudioData(audioData).then(function(decodedData) {
    audioContext.decodeAudioData(audioData, function(decodedData) {

        that.trackGainNode[currentTrack] = audioContext.createGain();
        that.trackGainNode[currentTrack].connect(that.gainNodeMaster as GainNode);
        that.trackBuffer[currentTrack] = decodedData;
        that.trackTiming[currentTrack] = that.calculateTrackTiming(that.trackSources[currentTrack][currentSource], decodedData.duration);

        // Fire a success if the decoding works and allow the player to proceed
        that.trackProperties[currentTrack].success = true;
        that.trackStatusChanged();

    }, function(e) {
        that.sourceFailed(currentTrack, currentSource, "Error Decoding File Type");
    });

}


// Make and listen to XMLHttpRequest for each source of a track as needed
TrackSwitchPlugin.prototype.makeRequest = function(currentTrack, currentSource) {

    var that = this;

    var audioURL = $(this.trackSources[currentTrack][currentSource]).attr('src');
    if (!audioURL) {
        this.sourceFailed(currentTrack, currentSource, "No Source URL");
        return;
    }
    var request = new XMLHttpRequest();
    request.open('GET', audioURL, true);
    request.responseType = 'arraybuffer';

    request.onreadystatechange = function() {

        if (request.readyState === 4) { // If request complete...
            if (request.status === 200) { // ...with status success
                that.decodeAudio(request, currentTrack, currentSource);
            } else { // ...with error
                that.sourceFailed(currentTrack, currentSource, "404 - File Not Found");
            }
        }

    }

    request.send();

}


// Check if there is a source to request for the given track
TrackSwitchPlugin.prototype.prepareRequest = function(currentTrack, currentSource) {

    if (this.trackSources[currentTrack][currentSource] !== undefined) {
        this.makeRequest(currentTrack, currentSource)
    } else {
        this.sourceFailed(currentTrack, currentSource, "No Source Found");
    }

}


// On player load/activate, find the audio tracks and sources and filter out ones we can't play
// Then being the process of making requests for the files, starting with the first source of the first track
TrackSwitchPlugin.prototype.load = function(event) {
    if (this.isDestroyed) {
        return false;
    }

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();
    if (this.isLoaded || this.isLoading) {
        event.stopPropagation();
        return false;
    }
    this.isLoading = true;
    setActiveKeyboardInstance(this.instanceId);

    this.unlockIOSPlayback();

    var that = this;

    this.element.find(".overlay span.activate").addClass("fa-spin loading");

    if (this.numberOfTracks > 0) {
        this.trackSources = [];
        this.trackBuffer = [];
        this.trackTiming = [];
        this.trackGainNode = [];
        this.activeAudioSources = [];
        this.trackProperties.forEach(function(trackProperty) {
            trackProperty.success = false;
            trackProperty.error = false;
        });

        var audioElement = document.createElement('audio');

        var mimeTypeTable: Record<string, string> = {
            ".aac"  : "audio/aac;",
            ".aif"  : "audio/aiff;",
            ".aiff" : "audio/aiff;",
            ".au"   : "audio/basic;",
            ".flac" : "audio/flac;",
            ".mp1"  : "audio/mpeg;",
            ".mp2"  : "audio/mpeg;",
            ".mp3"  : "audio/mpeg;",
            ".mpg"  : "audio/mpeg;",
            ".mpeg" : "audio/mpeg;",
            ".m4a"  : "audio/mp4;",
            ".mp4"  : "audio/mp4;",
            ".oga"  : "audio/ogg;",
            ".ogg"  : "audio/ogg;",
            ".wav"  : "audio/wav;",
            ".webm" : "audio/webm;"
        }

        this.element.find('ts-track').each(function(i) {

            const validSources: HTMLElement[] = [];
            $(this).find('ts-source').each(function() {
                const source = $(this);
                const sourceType = source.attr('type');
                const sourceUrl = source.attr('src');

                if (!sourceUrl) {
                    return;
                }

                const mime = inferSourceMimeType(sourceUrl, sourceType, mimeTypeTable);
                const canPlay = !!(audioElement.canPlayType && audioElement.canPlayType(mime).replace(/no/, ''));

                if (canPlay) {
                    validSources.push(this);
                }
            });

            that.trackSources[i] = $(validSources) as JQuery<HTMLElement>;

        });

    } else {
        this.isLoading = false;
        this.element.trigger('errored');
        this.element.find('#overlaytext').text('No tracks available.');
    }

    // Request the first source of all tracks at once
    for (var i=0; i<this.trackSources.length; i++) {
        this.prepareRequest(i,0);
    }

    event.stopPropagation();
    return false;

};


// As the audio file requests come back, save the longest audio file
// This lets us link all tracks time, timing calculations and onEnd to the longest
TrackSwitchPlugin.prototype.findLongest = function() {

    for (var i=0; i<this.numberOfTracks; i++) {

        var timing = this.trackTiming[i];
        var trackBuffer = this.trackBuffer[i];
        var currentDuration = timing
            ? timing.effectiveDuration
            : (trackBuffer ? trackBuffer.duration : 0);

        if (currentDuration > this.longestDuration) {
            this.longestDuration = currentDuration
        }

    }

    this.element.trigger("loaded");

    // Generate waveforms if canvas elements are present
    if (this.options.waveform && this.waveformCanvas.length > 0) {
        this.generateWaveforms();
    }

}


// When all tracks have been requested, proceed if possible, or in the event of errors, fire and show error
TrackSwitchPlugin.prototype.trackStatusChanged = function() {

    var numOfRequests = 0, numOfErrors = 0;

    this.trackProperties.forEach(function(thisTrack) {
        numOfRequests += thisTrack.success || thisTrack.error ? 1 : 0;
        numOfErrors += thisTrack.error ? 1 : 0;
    });

    if (numOfRequests === this.numberOfTracks) {

        if (numOfErrors === 0) {
            this.findLongest(); // When `findLongest()` complete, 'loaded()' is called
        } else {
            this.element.trigger("errored");
            this.element.find("#overlaytext").text("One or more audio files failed to load.");
        }

    }

}


// When the audio files are completely (and sucessfully) loaded, unlock the player and set times
TrackSwitchPlugin.prototype.loaded = function() {
    if (this.isDestroyed) {
        return;
    }
    this.isLoaded = true;
    this.isLoading = false;

    this.element.find(".overlay").removeClass("loading");
    this.element.find(".overlay").hide().remove();

    // Update the times based on the longest track
    $(this.element).find('.timing .time'  ).html('00:00:00:000');
    $(this.element).find('.timing .length').html(this.secondsToHHMMSSmmm(this.longestDuration));

    // Fire when loaded to reflect any changed made before activation (radiosolo)
    this.apply_track_properties();

    this.bindEvents();
};


// In the event of a player error, display error UI and unbind events
TrackSwitchPlugin.prototype.errored = function() {
    if (this.isDestroyed) {
        return;
    }
    this.isLoaded = false;
    this.isLoading = false;

    this.element.find(".overlay span").removeClass("fa-spin loading");
    this.element.addClass("error");

    var that = this;
    this.trackProperties.forEach(function(thisTrack, i) {
        if (thisTrack.error) {
            $(that.element).find('.track_list > li:nth-child('+(i+1)+')').addClass("error");
        }
    });

    if (this.timerMonitorPosition) {
        clearInterval(this.timerMonitorPosition);
        this.timerMonitorPosition = null;
    }
    if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
        this.resizeDebounceTimer = null;
    }

    this.unbindEvents();
};


// Unbind all events previously bound
TrackSwitchPlugin.prototype.unbindEvents = function() {
    this.element.off(this.eventNamespace);
    $(window).off(this.eventNamespace);

};


// Bind events for player controls and seeking
TrackSwitchPlugin.prototype.bindEvents = function() {
    var ns = this.eventNamespace;

    this.element.on('touchstart' + ns + ' mousedown' + ns, $.proxy(function() {
        setActiveKeyboardInstance(this.instanceId);
    }, this));

    this.element.on('touchstart' + ns + ' mousedown' + ns, '.playpause', $.proxy(this.event_playpause, this));
    this.element.on('touchstart' + ns + ' mousedown' + ns, '.stop', $.proxy(this.event_stop, this));
    this.element.on('touchstart' + ns + ' mousedown' + ns, '.repeat', $.proxy(this.event_repeat, this));

    this.element.on('mousedown' + ns + ' touchstart' + ns, '.seekwrap', $.proxy(this.event_seekStart, this));
    $(window).on('mousemove' + ns + ' touchmove' + ns, $.proxy(this.event_seekMove, this));
    $(window).on('mouseup' + ns + ' touchend' + ns + ' touchcancel' + ns, $.proxy(this.event_seekEnd, this));

    this.element.on('touchstart' + ns + ' mousedown' + ns, '.mute', $.proxy(this.event_mute, this));
    this.element.on('touchstart' + ns + ' mousedown' + ns, '.solo', $.proxy(this.event_solo, this));

    if (this.options.globalvolume) {
        this.element.on('input' + ns, '.volume-slider', $.proxy(this.event_volume, this));
        // Prevent volume slider interactions from triggering seek or other player events
        this.element.on('mousedown' + ns + ' touchstart' + ns + ' mousemove' + ns + ' touchmove' + ns + ' mouseup' + ns + ' touchend' + ns, '.volume-control', function(e) { e.stopPropagation(); });
    }

    if (this.presetCount >= 2) {
        // Handle both normal changes and explicit reapply requests
        this.element.on('change' + ns + ' preset:reapply' + ns, '.preset-selector', $.proxy(this.event_preset, this));
        this.element.on('wheel' + ns, '.preset-selector', $.proxy(this.event_preset_scroll, this));
        // Prevent preset interactions from being intercepted by other touch/mouse handlers on mobile
        this.element.on('mousedown' + ns + ' touchstart' + ns + ' mouseup' + ns + ' touchend' + ns + ' click' + ns, '.preset-selector, .preset-selector-wrap', function(e) { e.stopPropagation(); });

        // Track last applied preset value so we can detect "reapply same preset" clicks
        this.element.on('change' + ns + ' preset:reapply' + ns, '.preset-selector', function() {
            var $select = $(this);
            $select.data('lastValue', $select.val());
        });
    }

    if (this.options.looping) {
        this.element.on('touchstart' + ns + ' mousedown' + ns, '.loop-a', $.proxy(this.event_setLoopA, this));
        this.element.on('touchstart' + ns + ' mousedown' + ns, '.loop-b', $.proxy(this.event_setLoopB, this));
        this.element.on('touchstart' + ns + ' mousedown' + ns, '.loop-toggle', $.proxy(this.event_toggleLoop, this));
        this.element.on('touchstart' + ns + ' mousedown' + ns, '.loop-clear', $.proxy(this.event_clearLoop, this));

        this.element.on('mousedown' + ns + ' touchstart' + ns, '.loop-marker', $.proxy(this.event_markerDragStart, this));
    }

    var that = this;

    if (this.options.keyboard) {
        $(window).on("keydown" + ns, function (event) {
            that.handleKeyboardEvent(event);
        });
    }

    // Bind window resize handler for responsive waveform regeneration
    if (this.options.waveform && this.waveformCanvas.length > 0) {
        $(window).on('resize' + ns, function() {
            that.handleWaveformResize();
        });
    }

};


// Event filter function to filter the `click` > 'touchstart mousedown' to left mouse and touch only
TrackSwitchPlugin.prototype.valid_click = function(event) {

    if ( // Filter 'click' events for only touch or *left* click
        event.type === "touchstart" ||
        (event.type === "mousedown" && event.which === 1)
    ) {
        return true;
    } else {
        return false;
    }

}


// Detect iOS/iPadOS Safari devices where WebAudio can be muted by hardware silent mode
TrackSwitchPlugin.prototype.isIOSDevice = function() {

    var nav = window.navigator as Navigator & { userAgent?: string; platform?: string; maxTouchPoints?: number };
    var userAgent = nav.userAgent || "";
    var platform = nav.platform || "";
    var maxTouchPoints = nav.maxTouchPoints || 0;

    return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);

}


// On iOS, play a short silent HTML5 audio element once to force media playback category
TrackSwitchPlugin.prototype.unlockIOSPlayback = function() {

    if (!this.options.iosunmute || this.iOSPlaybackUnlocked || !this.isIOSDevice()) {
        return;
    }

    this.iOSPlaybackUnlocked = true;

    if (audioContext && typeof audioContext.resume === "function") {
        try {
            audioContext.resume();
        } catch (e) {}
    }

    try {
        var unlockAudio = document.createElement("audio");
        unlockAudio.setAttribute("playsinline", "playsinline");
        unlockAudio.preload = "auto";
        unlockAudio.volume = 0.0001;
        unlockAudio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=";

        var playPromise = unlockAudio.play();

        var cleanup = function() {
            unlockAudio.pause();
            unlockAudio.removeAttribute("src");
            unlockAudio.load();
        };

        if (playPromise && typeof playPromise.then === "function") {
            playPromise.then(cleanup).catch(function() {});
        } else {
            cleanup();
        }
    } catch (e) {}

}


// Format time for the UI, from seconds to HH:MM:SS:mmm
TrackSwitchPlugin.prototype.secondsToHHMMSSmmm = function(seconds) {
    return formatSecondsToHHMMSSmmm(seconds);
}


// Parse optional ts-source offset attributes and derive effective timeline timing for a track
TrackSwitchPlugin.prototype.calculateTrackTiming = function(sourceElement, bufferDuration) {

    var source = $(sourceElement);
    var startOffsetMs = parseFloat(source.attr('start-offset-ms') ?? '');
    var endOffsetMs = parseFloat(source.attr('end-offset-ms') ?? '');

    var startOffset = isNaN(startOffsetMs) ? 0 : startOffsetMs / 1000;
    var endOffset = isNaN(endOffsetMs) ? 0 : endOffsetMs / 1000;

    var trimStart = startOffset > 0 ? startOffset : 0;
    var padStart = startOffset < 0 ? -startOffset : 0;
    var trimEnd = endOffset > 0 ? endOffset : 0;
    var padEnd = endOffset < 0 ? -endOffset : 0;

    var audioDuration = bufferDuration - trimStart - trimEnd;
    audioDuration = audioDuration > 0 ? audioDuration : 0;

    return {
        trimStart: trimStart,
        padStart: padStart,
        audioDuration: audioDuration,
        effectiveDuration: padStart + audioDuration + padEnd
    };

}


// Update the UI elements for the position
TrackSwitchPlugin.prototype.updateMainControls = function() {

    this.element.find(".playpause").toggleClass('checked', this.playing);
    this.element.find(".repeat").toggleClass('checked', this.repeat);

    var timePerc = ( this.position / this.longestDuration ) * 100;

    this.element.find('.seekhead').each(function() {
        $(this).css({left: timePerc+'%'});
    });

    if (this.longestDuration !== 0) { // Only update when player activated (add active flag?)
        $(this.element).find('.timing .time').html(this.secondsToHHMMSSmmm(this.position));
    }

    // Update loop UI elements (only if looping is enabled)
    if (this.options.looping) {
        this.element.find(".loop-a").toggleClass('checked', this.loopPointA !== null);
        this.element.find(".loop-b").toggleClass('checked', this.loopPointB !== null);
        this.element.find(".loop-toggle").toggleClass('checked', this.loopEnabled);
        this.element.find(".loop-a, .loop-b").toggleClass('active', this.loopEnabled);

        // Position and show/hide loop markers
        if (this.loopPointA !== null && this.longestDuration > 0) {
            var pointAPerc = (this.loopPointA / this.longestDuration) * 100;
            this.element.find('.loop-marker.marker-a').css({left: pointAPerc+'%', display: 'block'});
        } else {
            this.element.find('.loop-marker.marker-a').css({display: 'none'});
        }

        if (this.loopPointB !== null && this.longestDuration > 0) {
            var pointBPerc = (this.loopPointB / this.longestDuration) * 100;
            this.element.find('.loop-marker.marker-b').css({left: pointBPerc+'%', display: 'block'});
        } else {
            this.element.find('.loop-marker.marker-b').css({display: 'none'});
        }

        // Position and show/hide loop region overlay
        if (this.loopPointA !== null && this.loopPointB !== null && this.longestDuration > 0) {
            var pointAPerc = (this.loopPointA / this.longestDuration) * 100;
            var pointBPerc = (this.loopPointB / this.longestDuration) * 100;
            var widthPerc = pointBPerc - pointAPerc;
            this.element.find('.loop-region').css({
                left: pointAPerc+'%',
                width: widthPerc+'%',
                display: 'block'
            }).toggleClass('active', this.loopEnabled);
        } else {
            this.element.find('.loop-region').css({display: 'none'});
        }
    }

}
