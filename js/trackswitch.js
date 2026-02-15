// Put the audioContext in the global scope and pass it to each player instance.
// WebAudioAPI fallback for IE: http://stackoverflow.com/a/27711181
function audioContextCheck() {
    if (typeof AudioContext !== "undefined") {
        return new AudioContext();
    } else if (typeof webkitAudioContext !== "undefined") {
        return new webkitAudioContext();
    } else if (typeof mozAudioContext !== "undefined") {
        return new mozAudioContext();
    } else {
        return null;
    }
}
var audioContext = audioContextCheck();

if (typeof document.registerElement !== "undefined") {
    var TsTrack = document.registerElement('ts-track');
    var TsSource = document.registerElement('ts-source');
}

var pluginName = 'trackSwitch',
    defaults = {
        mute: true,
        solo: true,
        globalsolo: true,
        repeat: false,
        radiosolo: false,
        onlyradiosolo: false,
        tabview: false,
        iosunmute: true,
        keyboard: true,
        looping: true,
    };


function Plugin(element, options) {

    this.element = $(element);

    this.options = $.extend({}, defaults, options);

    if(!this.options.mute && !this.options.solo) {
        console.error("Cannot disable both solo and mute, reactivating solo");
        this.options.solo = true;
    }

    if(this.options.onlyradiosolo) {
        this.options.mute = false;
        this.options.radiosolo = true;
    }

    this._defaults = defaults;
    this._name = pluginName;

    // Properties for the overall player
    this.numberOfTracks = 0;
    this.longestDuration = 0;
    this.playing = false;
    this.repeat = this.options.repeat;
    this.startTime;
    this.position = 0;
    this.timerUpdateUI;
    this.currentlySeeking = false;
    this.seekingElement;
    this.masterVolume = 1.0;
    this.iOSPlaybackUnlocked = false;

    // A/B Loop properties (only initialize if looping is enabled)
    if (this.options.looping) {
        this.loopPointA = null;  // Time in seconds, or null if not set
        this.loopPointB = null;  // Time in seconds, or null if not set
        this.loopEnabled = false; // Whether A/B loop is active
        this.rightClickDragging = false; // Tracks right-click drag state for loop selection
        this.loopDragStart = null; // Stores starting position during right-drag
        this.draggingMarker = null; // Tracks which marker is being dragged ('A', 'B', or null)
        this.loopMinDistance = 0.1; // Minimum distance between loop points (0.1 seconds)
    }

    // Preset configuration properties
    this.presetNames = [];
    this.presetCount = 0;

    // Properties and data for each track in coherent arrays
    this.trackProperties = [];
    this.trackSources = [];
    this.trackGainNode = [];
    this.trackBuffer = [];
    this.trackTiming = [];
    this.activeAudioSources = [];

    // Skip gain node creation if WebAudioAPI could not load.
    if (audioContext) {
        // Volume gain node (user-controlled, between master and destination)
        this.gainNodeVolume = audioContext.createGain();
        this.gainNodeVolume.gain.value = this.masterVolume;
        this.gainNodeVolume.connect(audioContext.destination);

        // Master output gain node setup (used for fade ramps)
        this.gainNodeMaster = audioContext.createGain();
        this.gainNodeMaster.gain.value = 0.0 // Start at 0.0 to allow fade in
        this.gainNodeMaster.connect(this.gainNodeVolume);
    }

    this.init();
}


// Initialize Plugin
// Add markup for play controls
// Bind overlay click events
Plugin.prototype.init = function() {

    var that = this;

    // Add class for default CSS stylesheet
    this.element.addClass("jquery-trackswitch");

    // Parse preset configuration early so we can conditionally include preset dropdown
    // Read preset names from data-preset-names attribute (comma-separated)
    var presetNamesAttr = this.element.attr('data-preset-names');
    var maxPresetIndex = -1;
    
    // First pass: scan all ts-track elements to find max preset index
    this.element.find('ts-track').each(function() {
        var presetsAttr = $(this).attr('data-presets');
        if (presetsAttr) {
            var presets = presetsAttr.split(',').map(function(p) { return parseInt(p.trim()); });
            presets.forEach(function(preset) {
                if (preset > maxPresetIndex) {
                    maxPresetIndex = preset;
                }
            });
        }
    });

    // Include preset 0 (default) even if not explicitly mentioned
    this.presetCount = Math.max(1, maxPresetIndex + 1);

    // Set preset names: either from attribute or auto-generate
    if (presetNamesAttr) {
        this.presetNames = presetNamesAttr.split(',').map(function(name) { return name.trim(); });
    } else {
        // Auto-generate preset names
        for (var p = 0; p < this.presetCount; p++) {
            this.presetNames.push('Preset ' + p);
        }
    }

    if(this.element.find(".main-control").length === 0) {
        // Build preset dropdown HTML (only if presetCount >= 2)
        var presetDropdownHtml = '';
        if (this.presetCount >= 2) {
            presetDropdownHtml = '<li class="preset-selector-wrap">' +
                '<select class="preset-selector" title="Select Preset">';
            for (var p = 0; p < this.presetNames.length; p++) {
                presetDropdownHtml += '<option value="' + p + '"' + (p === 0 ? ' selected' : '') + '>' + 
                    this.presetNames[p] + '</option>';
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
                    '<li class="playpause button" title="Play/Pause (Spacebar)">Play</li>' +
                    '<li class="stop button" title="Stop (Esc)">Stop</li>' +
                    '<li class="repeat button" title="Repeat (R)">Repeat</li>' +
                    '<li class="volume">' +
                        '<div class="volume-control">' +
                            '<i class="fa-volume-up volume-icon"></i>' +
                            '<input type="range" class="volume-slider" min="0" max="100" value="100">' +
                        '</div>' +
                    '</li>' +
                    (that.options.looping ? '<li class="loop-a button" title="Set Loop Point A (A)">Loop A</li>' +
                    '<li class="loop-b button" title="Set Loop Point B (B)">Loop B</li>' +
                    '<li class="loop-toggle button" title="Toggle Loop On/Off (L)">Loop</li>' +
                    '<li class="loop-clear button" title="Clear Loop Points (C)">Clear</li>' : '') +
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
                    '<li class="seekwrap">' +
                        '<div class="seekbar">' +
                            '<div class="loop-region"></div>' +
                            '<div class="loop-marker marker-a"></div>' +
                            '<div class="loop-marker marker-b"></div>' +
                            '<div class="seekhead"></div>' +
                        '</div>' +
                    '</li>' +
                '</ul>' +
            '</div>'
        );
    }

    // Remove the playhead in `.main-control` when there is one or more seekable images
    if (this.element.find('.seekable:not(.seekable-img-wrap > .seekable)').length > 0) {
        this.element.find('.main-control .seekwrap').hide();
    }

    // Wrap any seekable poster images in seekable markup
    this.element.find('.seekable:not(.seekable-img-wrap > .seekable)').each(function() {

        // Save a copy of the original image src to reset image to
        that.originalImage = this.src;

        $(this).wrap( '<div class="seekable-img-wrap" style="' + $(this).data("style") + '; display: block;"></div>' );

        $(this).after(
            '<div class="seekwrap" style=" ' +
            'left: ' + ($(this).data("seekMarginLeft") || 0) + '%; ' +
            'right: ' + ($(this).data("seekMarginRight") || 0) + '%;">' +
                '<div class="loop-region"></div>' +
                '<div class="loop-marker marker-a"></div>' +
                '<div class="loop-marker marker-b"></div>' +
                '<div class="seekhead"></div>' +
            '</div>'
        );

    });

    // Prevent context menu on seekbar for right-click loop selection (only if looping is enabled)
    if (this.options.looping) {
        this.element.on('contextmenu', '.seekwrap', function(e) {
            e.preventDefault();
            return false;
        });
    }

    this.element.on('touchstart mousedown', '.overlay .activate', $.proxy(this.load, this));
    this.element.on('touchstart mousedown', '.overlay #overlayinfo .info', $.proxy(function() {
        this.element.find('.overlay .info').hide();
        this.element.find('.overlay .text').show();
    }, this));
    this.element.one('loaded', $.proxy(this.loaded, this));
    this.element.one('errored', $.proxy(this.errored, this));

    var tracklist = $('<ul class="track_list"></ul>');

    this.numberOfTracks = this.element.find('ts-track').length;

    if (this.numberOfTracks > 0) {

        this.element.find('ts-track').each(function(i) {

            // Parse data-presets attribute (comma-separated list of preset indices)
            var presetsAttr = $(this).attr('data-presets');
            var presetsForTrack = [];
            
            // If data-presets is not specified, check if track has solo attribute for Preset 0
            if (presetsAttr) {
                presetsForTrack = presetsAttr.split(',').map(function(p) { return parseInt(p.trim()); });
            } else if (this.hasAttribute('solo')) {
                // Auto-create preset 0 from initial solo attribute
                presetsForTrack = [0];
            }

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

            tracklist.append(
                // User defined style and title fallback if not defined
                '<li class="track' + tabview + wholesolo + '" style="' + ($(this).attr('style') || "") + '">' +
                    ($(this).attr('title') || "Track " + (i+1)) +
                    '<ul class="control">' +
                        (that.options.mute ? '<li class="mute button" title="Mute">Mute</li>' : '') +
                        (that.options.solo ? '<li class="solo button' + radiosolo + '" title="Solo">Solo</li>' : '') +
                    '</ul>' +
                '</li>'
            );

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
            this.element.find("#overlaytext").html("Web Audio API is not supported in your browser. Please consider upgrading.");
            return false;
        }

    } else {

        this.element.trigger("errored");
        // With no text, as the player will be too small to show it anyway

    }

};


// Remove player elements etc
Plugin.prototype.destroy = function() {

    this.element.find(".main-control").remove();
    this.element.find(".tracks").remove();
    this.element.removeData();
};


// In case of source error, request next source if there is one, else fire a track error
Plugin.prototype.sourceFailed = function(currentTrack, currentSource, errorType) {

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
Plugin.prototype.decodeAudio = function(request, currentTrack, currentSource) {

    var that = this;
    var audioData = request.response;

    // Looks like promise-based syntax (commented below) isn't supported on mobile yet...
    // audioContext.decodeAudioData(audioData).then(function(decodedData) {
    audioContext.decodeAudioData(audioData, function(decodedData) {

        that.trackGainNode[currentTrack] = audioContext.createGain();
        that.trackGainNode[currentTrack].connect(that.gainNodeMaster);
        that.trackBuffer[currentTrack] = audioContext.createBufferSource();
        that.trackBuffer[currentTrack].buffer = decodedData;
        that.trackTiming[currentTrack] = that.calculateTrackTiming(that.trackSources[currentTrack][currentSource], decodedData.duration);

        // Fire a success if the decoding works and allow the player to proceed
        that.trackProperties[currentTrack].success = true;
        that.trackStatusChanged();

    }, function(e) {
        that.sourceFailed(currentTrack, currentSource, "Error Decoding File Type");
    });

}


// Make and listen to XMLHttpRequest for each source of a track as needed
Plugin.prototype.makeRequest = function(currentTrack, currentSource) {

    var that = this;

    var audioURL = $(this.trackSources[currentTrack][currentSource]).attr('src');
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
Plugin.prototype.prepareRequest = function(currentTrack, currentSource) {

    if (this.trackSources[currentTrack][currentSource] !== undefined) {
        this.makeRequest(currentTrack, currentSource)
    } else {
        this.sourceFailed(currentTrack, currentSource, "No Source Found");
    }

}


// On player load/activate, find the audio tracks and sources and filter out ones we can't play
// Then being the process of making requests for the files, starting with the first source of the first track
Plugin.prototype.load = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    this.unlockIOSPlayback();

    var that = this;

    this.element.find(".overlay span.activate").addClass("fa-spin loading");

    if (this.numberOfTracks > 0) {

        var a = document.createElement('audio');

        var mimeTypeTable = {
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

            that.trackSources[i] = $(this).find('ts-source');

            // Check the mime type for each source of the current track
            for (var j=0; j<that.trackSources[i].length; j++) {

                // If a type has been defined by the user, use that
                if ('undefined' !== typeof $(that.trackSources[i][j]).attr('type')) {
                    var mime = $(that.trackSources[i][j]).attr('type') + ';';
                // else, compare the file extention to mime times of common audio formats.
                } else {
                    var ext = $(that.trackSources[i][j]).attr('src').substring($(that.trackSources[i][j]).attr('src').lastIndexOf("."));
                    console.log(ext);
                    var mime = mimeTypeTable[ext] !== undefined ? mimeTypeTable[ext] : "audio/"+ext.substr(1)+";";
                }

                // Beware of triple not!!! - If file type cannot be played...
                if ( !(!!(a.canPlayType && a.canPlayType(mime).replace(/no/, ''))) ) {
                    // ...eject it from the source list
                    that.trackSources[i].splice(j, 1)
                }
            }

        });

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
Plugin.prototype.findLongest = function() {

    for (var i=0; i<this.numberOfTracks; i++) {

        var currentDuration = this.trackTiming[i] ? this.trackTiming[i].effectiveDuration : this.trackBuffer[i].buffer.duration;

        if (currentDuration > this.longestDuration) {
            this.longestDuration = currentDuration
        }

    }

    this.element.trigger("loaded");

}


// When all tracks have been requested, proceed if possible, or in the event of errors, fire and show error
Plugin.prototype.trackStatusChanged = function() {

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
            this.element.find("#overlaytext").html("One or more audio files failed to load.");
        }

    }

}


// When the audio files are completely (and sucessfully) loaded, unlock the player and set times
Plugin.prototype.loaded = function() {

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
Plugin.prototype.errored = function() {

    this.element.find(".overlay span").removeClass("fa-spin loading");
    this.element.addClass("error");

    var that = this;
    this.trackProperties.forEach(function(thisTrack, i) {
        if (thisTrack.error) {
            $(that.element).find('.track_list > li:nth-child('+(i+1)+')').addClass("error");
        }
    });

    this.unbindEvents();
};


// Unbind all events previously bound
Plugin.prototype.unbindEvents = function() {

    this.element.off('touchstart mousedown', '.overlay span');
    this.element.off('loaded');

    this.element.off('touchstart mousedown', '.playpause');
    this.element.off('touchstart mousedown', '.stop');
    this.element.off('touchstart mousedown', '.repeat');

    this.element.off('mousedown touchstart', '.seekwrap');
    this.element.off('mousemove touchmove');
    this.element.off('mouseup touchend');

    this.element.off('touchstart mousedown', '.mute');
    this.element.off('touchstart mousedown', '.solo');

    this.element.off('input', '.volume-slider');
    this.element.off('mousedown touchstart mousemove touchmove mouseup touchend', '.volume-control');

    if (this.presetCount >= 2) {
        this.element.off('change', '.preset-selector');
        this.element.off('wheel', '.preset-selector');
    }

    if (this.options.looping) {
        this.element.off('touchstart mousedown', '.loop-a');
        this.element.off('touchstart mousedown', '.loop-b');
        this.element.off('touchstart mousedown', '.loop-toggle');
        this.element.off('touchstart mousedown', '.loop-clear');
        this.element.off('mousedown touchstart', '.loop-marker');
        this.element.off('contextmenu', '.seekwrap');
    }

    if (this.options.keyboard) {
        $(window).off("keydown.trackswitch");
    }

};


// Bind events for player controls and seeking
Plugin.prototype.bindEvents = function() {

    this.element.on('touchstart mousedown', '.playpause', $.proxy(this.event_playpause, this));
    this.element.on('touchstart mousedown', '.stop', $.proxy(this.event_stop, this));
    this.element.on('touchstart mousedown', '.repeat', $.proxy(this.event_repeat, this));

    this.element.on('mousedown touchstart', '.seekwrap', $.proxy(this.event_seekStart, this));
    this.element.on('mousemove touchmove', $.proxy(this.event_seekMove, this));
    this.element.on('mouseup touchend', $.proxy(this.event_seekEnd, this));

    this.element.on('touchstart mousedown', '.mute', $.proxy(this.event_mute, this));
    this.element.on('touchstart mousedown', '.solo', $.proxy(this.event_solo, this));

    this.element.on('input', '.volume-slider', $.proxy(this.event_volume, this));
    // Prevent volume slider interactions from triggering seek or other player events
    this.element.on('mousedown touchstart mousemove touchmove mouseup touchend', '.volume-control', function(e) { e.stopPropagation(); });

    if (this.presetCount >= 2) {
        this.element.on('change', '.preset-selector', $.proxy(this.event_preset, this));
        this.element.on('wheel', '.preset-selector', $.proxy(this.event_preset_scroll, this));
    }

    if (this.options.looping) {
        this.element.on('touchstart mousedown', '.loop-a', $.proxy(this.event_setLoopA, this));
        this.element.on('touchstart mousedown', '.loop-b', $.proxy(this.event_setLoopB, this));
        this.element.on('touchstart mousedown', '.loop-toggle', $.proxy(this.event_toggleLoop, this));
        this.element.on('touchstart mousedown', '.loop-clear', $.proxy(this.event_clearLoop, this));

        this.element.on('mousedown touchstart', '.loop-marker', $.proxy(this.event_markerDragStart, this));
    }

    var that = this;

    if (this.options.keyboard) {
        $(window).off("keydown.trackswitch"); // Unbind other players before binding new

        $(window).on("keydown.trackswitch", function (event) {
            that.handleKeyboardEvent(event);
        });
    }

};


// Event filter function to filter the `click` > 'touchstart mousedown' to left mouse and touch only
Plugin.prototype.valid_click = function(event) {

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
Plugin.prototype.isIOSDevice = function() {

    var nav = window.navigator || {};
    var userAgent = nav.userAgent || "";
    var platform = nav.platform || "";
    var maxTouchPoints = nav.maxTouchPoints || 0;

    return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);

}


// On iOS, play a short silent HTML5 audio element once to force media playback category
Plugin.prototype.unlockIOSPlayback = function() {

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
Plugin.prototype.secondsToHHMMSSmmm = function(seconds) {

    var h = parseInt( seconds / 3600 ) % 24;
    h = h < 10 ? '0'+h : h;

    var m = parseInt( seconds / 60 ) % 60;
    m = m < 10 ? '0'+m : m;

    var s = seconds % 60;
    s = s.toString().split(".")[0]; // Use only whole seconds (do not round)
    s = s < 10 ? '0'+s : s;

    var mil = Math.round((seconds % 1)*1000); // Decimal places to milliseconds
    mil = mil < 10 ? '00'+mil : mil < 100 ? '0'+mil : mil;

    return (h + ':' + m + ':' + s + ':' + mil);

}


// Parse optional ts-source offset attributes and derive effective timeline timing for a track
Plugin.prototype.calculateTrackTiming = function(sourceElement, bufferDuration) {

    var source = $(sourceElement);
    var startOffsetMs = parseFloat(source.attr('start-offset-ms'));
    var endOffsetMs = parseFloat(source.attr('end-offset-ms'));

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
Plugin.prototype.updateMainControls = function() {

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


// Timer fuction to update the UI periodically (with new time and seek position)
// Also listens for the longest track to end and stops or repeats as needed
Plugin.prototype.monitorPosition = function(context) {

    // context = this from outside the closure

    context.position = context.playing && !context.currentlySeeking ? audioContext.currentTime - context.startTime : context.position;

    // Check for A/B loop (takes precedence over end-of-track repeat) - only if looping is enabled
    if (context.options.looping && context.loopEnabled && context.loopPointB !== null && 
        context.position >= context.loopPointB && !context.currentlySeeking) {
        
        context.stopAudio();
        context.startAudio(context.loopPointA || 0);
        return; // Exit early to prevent end-of-track handling
    }

    // Can't use onEnded as context calls each time stopAudio is called...
    if (context.position >= context.longestDuration && !context.currentlySeeking) {

        context.position = 0;
        context.stopAudio();

        if (context.repeat) {
            context.startAudio(context.position);
        } else {
            context.playing = false;
        }

    }

    context.updateMainControls();

}


// Stop each track and destroy it's audio buffer and clear the timer
Plugin.prototype.stopAudio = function() {

    // Create downward master gain ramp to fade signal out
    var now = audioContext.currentTime;
    var downwardRamp = 0.03;

    // NOTE: The downward ramp is in 'free' time, after the playhead has stopped.
    // For this reason, making the ramps long to test with causes overlaps.
    this.gainNodeMaster.gain.cancelScheduledValues(now);
    this.gainNodeMaster.gain.setValueAtTime(1.0, now);
    this.gainNodeMaster.gain.linearRampToValueAtTime(0.0, now + downwardRamp);

    for (var i=0; i<this.numberOfTracks; i++) {
        if (this.activeAudioSources[i]) {
            try {
                this.activeAudioSources[i].stop(now + downwardRamp);
            } catch (e) {}
        }
    }

    clearInterval(this.timerMonitorPosition);

}


// Create, connect and start a new audio buffer for each track and begin update timer
Plugin.prototype.startAudio = function(newPos, duration) {

    var that = this;

    // Ramping constants
    var now = audioContext.currentTime;
    var upwardRamp = 0.03;
    var downwardRamp = 0.03;

    this.position = typeof newPos !== 'undefined' ? newPos : this.position || 0;

    if (duration !== undefined) {

        // If a duration of track to play is specified (used in seeking)
        // Create upward master gain ramp to fade signal in (after the downwards ramp ends)
        this.gainNodeMaster.gain.setValueAtTime(0.0, now + downwardRamp);
        this.gainNodeMaster.gain.linearRampToValueAtTime(1.0, now + downwardRamp + upwardRamp);

        // Then schedule a downward ramp to fade out after playing for 'duration' of block
        this.gainNodeMaster.gain.setValueAtTime(1.0, now + downwardRamp + upwardRamp);
        this.gainNodeMaster.gain.linearRampToValueAtTime(0.0, now + downwardRamp + upwardRamp + duration);

    } else {

        // Create upward master gain ramp to fade signal in (regardless of the downward ramp)
        this.gainNodeMaster.gain.cancelScheduledValues(now);
        this.gainNodeMaster.gain.setValueAtTime(0.0, now);
        this.gainNodeMaster.gain.linearRampToValueAtTime(1.0, now + upwardRamp);

    }

    for (var i=0; i<this.numberOfTracks; i++) {

        this.activeAudioSources[i] = null; // Destroy old sources before creating new ones...

        var timing = this.trackTiming[i] || {
            trimStart: 0,
            padStart: 0,
            audioDuration: this.trackBuffer[i].buffer.duration
        };

        if (timing.audioDuration <= 0) {
            continue;
        }

        var positionInTrackTimeline = this.position - timing.padStart;
        var scheduleDelay = 0;
        var sourceOffset = timing.trimStart;
        var remainingAudioDuration = timing.audioDuration;

        if (positionInTrackTimeline < 0) {
            scheduleDelay = -positionInTrackTimeline;
        } else if (positionInTrackTimeline >= timing.audioDuration) {
            continue;
        } else {
            sourceOffset = timing.trimStart + positionInTrackTimeline;
            remainingAudioDuration = timing.audioDuration - positionInTrackTimeline;
        }

        var startAt = now + scheduleDelay;
        var playDuration = remainingAudioDuration;

        if (duration !== undefined) {
            var snippetStart = now + downwardRamp;
            var snippetEnd = snippetStart + upwardRamp + duration;

            startAt = snippetStart + scheduleDelay;

            if (startAt >= snippetEnd) {
                continue;
            }

            playDuration = Math.min(remainingAudioDuration, snippetEnd - startAt);
        }

        if (playDuration <= 0) {
            continue;
        }

        this.activeAudioSources[i] = audioContext.createBufferSource();
        this.activeAudioSources[i].buffer = this.trackBuffer[i].buffer;
        this.activeAudioSources[i].connect(this.trackGainNode[i]);

        this.activeAudioSources[i].start(startAt, sourceOffset, playDuration);

    }

    this.startTime = now - ( this.position || 0 );

    this.timerMonitorPosition = setInterval(function(){
        that.monitorPosition(that);
    }, 16); // 62.5Hz for smooth motion

}


// Pause player (used by other players to enforce globalsolo)
Plugin.prototype.pause = function() {

    if (this.playing === true) {
        this.stopAudio();
        this.position = audioContext.currentTime - this.startTime;
        this.playing = false;
        this.updateMainControls();
    }

};


// Returns the other players on the page (for globalsolo)
Plugin.prototype.other_instances = function() {
    return $(".jquery-trackswitch").not(this.element);
};


// Iterate through the other players to pause them (for globalsolo)
Plugin.prototype.pause_others = function() {

    if (this.options.globalsolo) {
        this.other_instances().each(function () {
            $(this).data('plugin_' + pluginName).pause();
        });
    }

}


// Seek relative to current position by specified seconds (can be negative)
Plugin.prototype.seekRelative = function(seconds) {

    var newPosition = this.position + seconds;
    
    // Clamp to valid range [0, longestDuration]
    newPosition = Math.max(0, Math.min(newPosition, this.longestDuration));
    
    // If looping is active, wrap around loop boundaries with offset preservation
    if (this.options.looping && this.loopEnabled && this.loopPointA !== null && this.loopPointB !== null) {
        var loopStart = this.loopPointA;
        var loopEnd = this.loopPointB;
        var loopLength = loopEnd - loopStart;

        if (loopLength > 0) {
            // Normalize newPosition into [loopStart, loopEnd) using modulo arithmetic,
            // correctly handling large positive/negative seeks.
            var relative = newPosition - loopStart;
            relative = ((relative % loopLength) + loopLength) % loopLength;
            newPosition = loopStart + relative;
        }
    }
    
    if (this.playing) {
        this.stopAudio();
        this.startAudio(newPosition);
    } else {
        this.position = newPosition;
    }
    
    this.updateMainControls();

};


// Adjust master volume by delta percentage (0-100 scale)
Plugin.prototype.adjustVolume = function(delta) {

    var volumeSlider = this.element.find('.volume-slider');
    var currentVolume = parseFloat(volumeSlider.val());
    var newVolume = currentVolume + delta;
    
    // Clamp to valid range [0, 100]
    newVolume = Math.max(0, Math.min(newVolume, 100));
    
    volumeSlider.val(newVolume);
    
    // Trigger the volume change event
    var event = $.Event('input');
    volumeSlider.trigger(event);

};


// Handle keyboard shortcuts
Plugin.prototype.handleKeyboardEvent = function(event) {

    // Don't intercept keyboard shortcuts when user is typing in an input field
    if ($(event.target).closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]').length) {
        return;
    }
    
    var handled = false;
    var keyCode = event.keyCode || event.which;
    
    switch (keyCode) {
        case 32: // Space - Play/Pause
            event.preventDefault();
            this.event_playpause(event);
            handled = true;
            break;
            
        case 27: // Escape - Stop
            event.preventDefault();
            var stopEvent = $.Event('mousedown', { which: 1, type: 'mousedown' });
            this.event_stop(stopEvent);
            handled = true;
            break;
            
        case 37: // Left Arrow - Seek backward
            event.preventDefault();
            var seekAmount = event.shiftKey ? -5 : -2;
            this.seekRelative(seekAmount);
            handled = true;
            break;
            
        case 39: // Right Arrow - Seek forward
            event.preventDefault();
            var seekAmount = event.shiftKey ? 5 : 2;
            this.seekRelative(seekAmount);
            handled = true;
            break;
            
        case 38: // Up Arrow - Volume up
            event.preventDefault();
            this.adjustVolume(10);
            handled = true;
            break;
            
        case 40: // Down Arrow - Volume down
            event.preventDefault();
            this.adjustVolume(-10);
            handled = true;
            break;
            
        case 36: // Home - Jump to start
            event.preventDefault();
            if (this.playing) {
                this.stopAudio();
                this.startAudio(0);
            } else {
                this.position = 0;
            }
            this.updateMainControls();
            handled = true;
            break;
            
        case 82: // R - Toggle repeat
            event.preventDefault();
            var repeatEvent = $.Event('mousedown', { which: 1, type: 'mousedown' });
            this.event_repeat(repeatEvent);
            handled = true;
            break;
            
        case 65: // A - Set loop point A at current position (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var loopAEvent = $.Event('mousedown', { which: 1, type: 'mousedown' });
                this.event_setLoopA(loopAEvent);
                handled = true;
            }
            break;
            
        case 66: // B - Set loop point B at current position (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var loopBEvent = $.Event('mousedown', { which: 1, type: 'mousedown' });
                this.event_setLoopB(loopBEvent);
                handled = true;
            }
            break;
            
        case 76: // L - Toggle loop on/off (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var toggleLoopEvent = $.Event('mousedown', { which: 1, type: 'mousedown' });
                this.event_toggleLoop(toggleLoopEvent);
                handled = true;
            }
            break;
            
        case 67: // C - Clear loop points (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var clearLoopEvent = $.Event('mousedown', { which: 1, type: 'mousedown' });
                this.event_clearLoop(clearLoopEvent);
                handled = true;
            }
            break;
    }
    
    if (handled) {
        event.stopPropagation();
        return false;
    }

};


// Toggle start stop of audio, saving the position to mock pausing
Plugin.prototype.event_playpause = function(event) {

    if (!(this.valid_click(event) || event.which === 32)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    this.unlockIOSPlayback();

    if(!this.playing) {
        // Determine starting position
        var startPosition = this.position;
        
        // If looping is enabled and position is outside loop range, jump to loop start
        if (this.loopEnabled && this.loopPointA !== null && this.loopPointB !== null) {
            if (this.position < this.loopPointA || this.position > this.loopPointB) {
                startPosition = this.loopPointA;
            }
        }
        
        this.startAudio(startPosition);
        this.pause_others();
        this.playing = true;
        this.updateMainControls();
    }
    else {
        this.pause();
    }

    event.stopPropagation();
    return false;

};


// Stop all audio tracks and set the position, seekheads etc to the start
Plugin.prototype.event_stop = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    var that = this;

    if (this.playing) {
        this.stopAudio();
    }

    this.position = 0;
    this.playing = false;

    this.updateMainControls();

    event.stopPropagation();
    return false;

};


// Toggle the repeat property and button UI
Plugin.prototype.event_repeat = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    this.repeat = !this.repeat;
    this.updateMainControls();

    event.stopPropagation();
    return false;

};


// Set loop point A at current position
Plugin.prototype.event_setLoopA = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    // If point A is already set at this position, clear it
    if (this.loopPointA !== null && Math.abs(this.loopPointA - this.position) < this.loopMinDistance) {
        this.loopPointA = null;
        this.loopEnabled = false;
    } else {
        this.loopPointA = this.position;
        
        // Validate: A must be before B if B is set
        if (this.loopPointB !== null && this.loopPointA > this.loopPointB) {
            // Swap points automatically
            var temp = this.loopPointA;
            this.loopPointA = this.loopPointB;
            this.loopPointB = temp;
        }
        
        // Enforce minimum distance from B
        if (this.loopPointB !== null && (this.loopPointB - this.loopPointA) < this.loopMinDistance) {
            console.warn("trackSwitch: Loop point A must be at least " + (this.loopMinDistance * 1000) + "ms before point B");
            // Don't set the point if it violates minimum distance
            this.loopPointA = null;
            return false;
        }
        
        // Auto-enable looping if both points are now set
        if (this.loopPointA !== null && this.loopPointB !== null) {
            this.loopEnabled = true;
            
            // If playing and position is outside loop range, jump to loop start
            if (this.playing) {
                if (this.position < this.loopPointA || this.position > this.loopPointB) {
                    this.stopAudio();
                    this.startAudio(this.loopPointA);
                }
            }
        }
    }

    this.updateMainControls();

    event.stopPropagation();
    return false;

};


// Set loop point B at current position
Plugin.prototype.event_setLoopB = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    // Use the configured minimum loop distance as the tolerance for detecting a toggle click
    var loopPointTolerance = this.loopMinDistance;

    // If point B is already set at this position, clear it
    if (this.loopPointB !== null && Math.abs(this.loopPointB - this.position) < loopPointTolerance) {
        this.loopPointB = null;
    } else {
        this.loopPointB = this.position;
        
        // Validate: B must be after A if A is set
        if (this.loopPointA !== null && this.loopPointB < this.loopPointA) {
            // Swap points automatically
            var temp = this.loopPointB;
            this.loopPointB = this.loopPointA;
            this.loopPointA = temp;
        }
        
        // Enforce minimum distance from A
        if (this.loopPointA !== null && (this.loopPointB - this.loopPointA) < this.loopMinDistance) {
            console.warn("trackSwitch: Loop point B must be at least " + (this.loopMinDistance * 1000) + "ms after point A");
            // Don't set the point if it violates minimum distance
            this.loopPointB = null;
            return false;
        }
        
        // Auto-enable looping if both points are now set
        if (this.loopPointA !== null && this.loopPointB !== null) {
            this.loopEnabled = true;
            
            // If playing and position is outside loop range, jump to loop start
            if (this.playing) {
                if (this.position < this.loopPointA || this.position > this.loopPointB) {
                    this.stopAudio();
                    this.startAudio(this.loopPointA);
                }
            }
        }
    }

    this.updateMainControls();

    event.stopPropagation();
    return false;

};


// Toggle loop on/off (requires both points to be set)
Plugin.prototype.event_toggleLoop = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    // Only allow toggling if both points are set
    if (this.loopPointA !== null && this.loopPointB !== null) {
        this.loopEnabled = !this.loopEnabled;
        
        // If enabling loop and position is outside range, jump to start of loop
        if (this.loopEnabled && (this.position < this.loopPointA || this.position > this.loopPointB)) {
            if (this.playing) {
                this.stopAudio();
                this.startAudio(this.loopPointA);
            } else {
                this.position = this.loopPointA;
            }
        }
    } else {
        // If both points aren't set, show a console message
        console.warn("trackSwitch: Both loop points A and B must be set before enabling loop");
    }

    this.updateMainControls();

    event.stopPropagation();
    return false;

};


// Clear both loop points and disable looping
Plugin.prototype.event_clearLoop = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    this.loopPointA = null;
    this.loopPointB = null;
    this.loopEnabled = false;
    this.rightClickDragging = false;
    this.loopDragStart = null;

    this.updateMainControls();

    event.stopPropagation();
    return false;

};


// When seeking, calculate the desired position in the audio from the position on the slider
Plugin.prototype.seek = function(event) {

    // Getting the position of the event is different for mouse and touch...
    if (event.type.indexOf("mouse") >= 0) {
        var posXRel = event.pageX - $(this.seekingElement).offset().left;
    } else {
        var posXRel = event.originalEvent.touches[0].pageX - $(this.seekingElement).offset().left;
    }

    // Limit the seeking to within the seekbar min/max
    var seekWidth = $(this.seekingElement).width();
    seekWidth = seekWidth < 1 ? 1 : seekWidth // Lower limit of width to 1 to avoid dividing by 0

    // Constrain posXRel to within the seekable object
    var posXRelLimted = posXRel < 0 ? 0 : posXRel > seekWidth ? seekWidth : posXRel;

    var timePerc = ( posXRelLimted / seekWidth ) * 100;

    var newPosTime = this.longestDuration * (timePerc/100);

    // Only perform the audio part of the seek function if mouse is within seekable area!
    if (posXRel >= 0 && posXRel <= seekWidth) {

        if (this.playing) {
            this.stopAudio();
            this.startAudio(newPosTime, 0.03);
        } else {
            this.position = newPosTime;
        }

    } else {
        // Always update the position and update UI to ensure it reads extremes of seek
        this.position = newPosTime;
    }

    this.updateMainControls();

}


// When touchsstart or mousedown on a seeking area, turn 'seeking' on and seek to cursor
Plugin.prototype.event_seekStart = function(event) {

    // Check for right-click (button 3) for loop selection
    if (event.type === "mousedown" && event.which === 3) {
        event.preventDefault();
        
        this.rightClickDragging = true;
        this.seekingElement = $(event.target).closest('.seekwrap');
        
        // Calculate the starting position
        var posXRel = event.pageX - $(this.seekingElement).offset().left;
        var seekWidth = $(this.seekingElement).width();
        seekWidth = seekWidth < 1 ? 1 : seekWidth;
        var posXRelLimited = posXRel < 0 ? 0 : posXRel > seekWidth ? seekWidth : posXRel;
        var timePerc = (posXRelLimited / seekWidth) * 100;
        var startTime = this.longestDuration * (timePerc / 100);
        
        this.loopDragStart = startTime;
        this.loopPointA = startTime;
        this.loopPointB = startTime;
        
        this.updateMainControls();
        
        event.stopPropagation();
        return false;
    }

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    // Must save which seekwrap (not direct element) is being seeked on!
    this.seekingElement = $(event.target).closest('.seekwrap');

    this.seek(event);
    this.currentlySeeking = true;
    
    // If seeking outside loop region while looping, disable loop but keep points
    if (this.loopEnabled && this.loopPointA !== null && this.loopPointB !== null) {
        var seekTime = this.position;
        if (seekTime < this.loopPointA || seekTime > this.loopPointB) {
            this.loopEnabled = false;
        }
    }

    event.stopPropagation();
    return false;

};

// When touchmove or mousemove over a seeking area, seek if seeking has been started
Plugin.prototype.event_seekMove = function(event) {

    // Handle marker dragging
    if (this.draggingMarker !== null) {
        event.preventDefault();
        
        // Calculate current position
        var posXRel = event.type.indexOf("mouse") >= 0 
            ? event.pageX - $(this.seekingElement).offset().left
            : event.originalEvent.touches[0].pageX - $(this.seekingElement).offset().left;
        
        var seekWidth = $(this.seekingElement).width();
        seekWidth = seekWidth < 1 ? 1 : seekWidth;
        var posXRelLimited = posXRel < 0 ? 0 : posXRel > seekWidth ? seekWidth : posXRel;
        var timePerc = (posXRelLimited / seekWidth) * 100;
        var newTime = this.longestDuration * (timePerc / 100);
        
        // Update the appropriate marker with minimum distance constraint
        if (this.draggingMarker === 'A') {
            // Constrain A to be at least loopMinDistance before B
            if (this.loopPointB !== null) {
                newTime = Math.min(newTime, this.loopPointB - this.loopMinDistance);
            }
            newTime = Math.max(0, newTime); // Don't go below 0
            this.loopPointA = newTime;
        } else if (this.draggingMarker === 'B') {
            // Constrain B to be at least loopMinDistance after A
            if (this.loopPointA !== null) {
                newTime = Math.max(newTime, this.loopPointA + this.loopMinDistance);
            }
            newTime = Math.min(this.longestDuration, newTime); // Don't exceed duration
            this.loopPointB = newTime;
        }
        
        this.updateMainControls();
        return false;
    }

    // Handle right-click drag for loop selection
    if (this.rightClickDragging) {
        event.preventDefault();
        
        // Calculate current position
        var posXRel = event.pageX - $(this.seekingElement).offset().left;
        var seekWidth = $(this.seekingElement).width();
        seekWidth = seekWidth < 1 ? 1 : seekWidth;
        var posXRelLimited = posXRel < 0 ? 0 : posXRel > seekWidth ? seekWidth : posXRel;
        var timePerc = (posXRelLimited / seekWidth) * 100;
        var currentTime = this.longestDuration * (timePerc / 100);
        
        // Update loop points based on drag direction
        if (currentTime >= this.loopDragStart) {
            // Dragging right - ensure minimum distance
            this.loopPointA = this.loopDragStart;
            this.loopPointB = Math.max(currentTime, this.loopDragStart + this.loopMinDistance);
        } else {
            // Dragging left - ensure minimum distance
            this.loopPointA = Math.min(currentTime, this.loopDragStart - this.loopMinDistance);
            this.loopPointB = this.loopDragStart;
        }
        
        this.updateMainControls();
        return false;
    }

    if (this.currentlySeeking) {
        event.preventDefault();
        this.seek(event);
        return false;
    }

    event.stopPropagation();

};


// When touchend or mouseup on a seeking area, turn seeking off
Plugin.prototype.event_seekEnd = function(event) {

    event.preventDefault();

    // Finalize marker dragging
    if (this.draggingMarker !== null) {
        this.draggingMarker = null;
        this.updateMainControls();
        
        event.stopPropagation();
        return false;
    }

    // Finalize right-click loop selection
    if (this.rightClickDragging) {
        this.rightClickDragging = false;
        this.loopDragStart = null;
        
        // Ensure points are ordered correctly (should already be, but double-check)
        if (this.loopPointA !== null && this.loopPointB !== null) {
            if (this.loopPointA > this.loopPointB) {
                var temp = this.loopPointA;
                this.loopPointA = this.loopPointB;
                this.loopPointB = temp;
            }
            
            // Auto-enable looping after selection
            // Only enable if there's a meaningful range (at least loopMinDistance)
            if (Math.abs(this.loopPointB - this.loopPointA) >= this.loopMinDistance) {
                this.loopEnabled = true;
                
                // If playing and position is outside loop range, jump to loop start
                if (this.playing) {
                    if (this.position < this.loopPointA || this.position > this.loopPointB) {
                        this.stopAudio();
                        this.startAudio(this.loopPointA);
                    }
                }
            } else {
                // If range too small, clear the points
                this.loopPointA = null;
                this.loopPointB = null;
            }
        }
        
        this.updateMainControls();
        
        event.stopPropagation();
        return false;
    }

    // Since seeking plays only snippits of audio, restart playback if it was playing
    if (this.currentlySeeking && this.playing) {
        this.stopAudio(); // Stop the seeking audio snippets first
        this.startAudio();
    }

    this.currentlySeeking = false;

    event.stopPropagation();
    return false;

};


// Start dragging a loop marker
Plugin.prototype.event_markerDragStart = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();
    event.stopPropagation(); // Prevent seek from triggering

    // Determine which marker is being dragged
    if ($(event.target).hasClass('marker-a')) {
        this.draggingMarker = 'A';
    } else if ($(event.target).hasClass('marker-b')) {
        this.draggingMarker = 'B';
    }

    // Store the seekwrap element for position calculations
    this.seekingElement = $(event.target).closest('.seekwrap');

    return false;

};


// A shorthandle to resolve click target index number. Used for mute/solo buttons
Plugin.prototype._index_from_target = function(target) {
    return $(target).closest(".track").prevAll().length;
};


// Set or unset solo mode for each track, only change properties
Plugin.prototype.event_solo = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    // Events not prevented/halted as this stops scrolling for full track solo

    var targetIndex = this._index_from_target(event.target);
    var that = this;

    var currentState = this.trackProperties[targetIndex].solo;

    if (event.shiftKey || this.options.radiosolo) {
        $.each(this.trackProperties, function(i, value) {
            that.trackProperties[i].solo = false;
        });
    }

    // If radiosolo option is on and the target is already soloed...
    if ((this.options.radiosolo || event.shiftKey) && currentState) {
        // ...keep the target soloed (must be one track always soloed)
        this.trackProperties[targetIndex].solo = true
    }
    // Else, flip the solo state of the target
    else {
        this.trackProperties[targetIndex].solo = !currentState;
    }

    this.apply_track_properties();

};


// Set or unset mute mode for each track, only change properties
Plugin.prototype.event_mute = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    var targetIndex = this._index_from_target(event.target);

    // Flip the current mute state of the selected track
    this.trackProperties[targetIndex].mute = !this.trackProperties[targetIndex].mute;

    this.apply_track_properties();

    event.stopPropagation();
    return false;

};


// Handle preset selection from dropdown
Plugin.prototype.event_preset = function(event) {

    var presetIndex = parseInt($(event.target).val());
    var that = this;

    // Apply the selected preset: solo tracks that belong to it, reset mutes
    $.each(this.trackProperties, function(i, value) {
        // Track is soloed if it belongs to the selected preset
        that.trackProperties[i].solo = that.trackProperties[i].presetsForTrack.indexOf(presetIndex) !== -1;
        // Reset all mute states to unmuted
        that.trackProperties[i].mute = false;
    });

    this.apply_track_properties();
};


// Handle mouse wheel scrolling on preset selector
Plugin.prototype.event_preset_scroll = function(event) {

    event.preventDefault();

    var $selector = $(event.target).closest('.preset-selector');
    var currentIndex = parseInt($selector.val());
    var maxIndex = $selector.find('option').length - 1;
    var newIndex = currentIndex;

    // Scroll down (deltaY > 0) moves to next preset, scroll up (deltaY < 0) moves to previous
    if (event.originalEvent.deltaY > 0) {
        newIndex = Math.min(currentIndex + 1, maxIndex);
    } else if (event.originalEvent.deltaY < 0) {
        newIndex = Math.max(currentIndex - 1, 0);
    }

    // Update the dropdown value and trigger change event
    $selector.val(newIndex);
    $selector.trigger('change');
};


// Cycle through the available images, setting it based on the solo states
Plugin.prototype.switch_image = function() {

    var that = this;
    var numSoloed = 0, imageSrc;

    // For each track that's soloed, set it's image as the image src...
    $.each(this.trackProperties, function(i, value) {
        if (that.trackProperties[i].solo === true){
            numSoloed++;
            imageSrc = that.element.find("ts-track")[i]['dataset']['img'];
        }
    });

    // ...then reset the new source to the original/default if necessary
    if (numSoloed !== 1 || (imageSrc === undefined || imageSrc.length < 1)) {
        imageSrc = this.originalImage;
    }

    // Apply the final image src to the display element
    this.element.find(".seekable").attr('src', imageSrc)

}


// When mute or solo properties changed, apply them to the gain of each track and update UI
Plugin.prototype.apply_track_properties = function() {
    var that = this;

    var anySolos = false;
    $.each(this.trackProperties, function(i, value) {
        anySolos = anySolos || that.trackProperties[i].solo;
    });

    $.each(this.trackProperties, function(i, value) {

      // 1) First update the UI elements to reflect the changes in properties...

        var elem = that.element.find(".track_list li.track:nth-child(" + (i+1) + ")");

        // Update the mute icon status based on track mute state
        if(that.trackProperties[i].mute) {
            elem.find(".mute").addClass('checked');
        }
        else {
            elem.find(".mute").removeClass('checked');
        }

        // Update the solo icon status based on track solo state
        if(that.trackProperties[i].solo) {
            elem.find(".solo").addClass('checked');
        }
        else {
            elem.find(".solo").removeClass('checked');
        }

      // 2) Then update the gains of each track depending on the new properties

        // Filter to stop the gains being edited before activation (gain undefined)
        if (that.trackGainNode.length > 0) {

            that.trackGainNode[i].gain.value = 1;

            // First, only play tracks that are not muted
            if(that.trackProperties[i].mute) {
                that.trackGainNode[i].gain.value = 0;
            }
            else {
                that.trackGainNode[i].gain.value = 1;
            }

            // Then, if there are 1 or more soloed tracks, overwrite with their solo state
            if(anySolos) {
                if(that.trackProperties[i].solo) {
                    that.trackGainNode[i].gain.value = 1;
                }
                else {
                    that.trackGainNode[i].gain.value = 0;
                }
            }

        }

    });

    this.switch_image(); // Now handle the switching of the poster image

    this.deselect();
};


// Handle volume slider input — update the volume gain node
Plugin.prototype.event_volume = function(event) {
    var val = parseFloat($(event.target).val()) / 100;
    this.masterVolume = val;
    if (this.gainNodeVolume) {
        this.gainNodeVolume.gain.value = val;
    }
    
    // Update volume icon based on slider value
    var volumeIcon = $(event.target).closest('.volume-control').find('.volume-icon');
    volumeIcon.removeClass('fa-volume-off fa-volume-down fa-volume-up');
    
    if (val === 0) {
        volumeIcon.addClass('fa-volume-off');
    } else if (val < 0.5) {
        volumeIcon.addClass('fa-volume-down');
    } else {
        volumeIcon.addClass('fa-volume-up');
    }
};


Plugin.prototype.deselect = function(index) {
    var selection = ('getSelection' in window)
        ? window.getSelection()
        : ('selection' in document)
            ? document.selection
            : null;
    if ('removeAllRanges' in selection) selection.removeAllRanges();
    else if ('empty' in selection) selection.empty();
};


$.fn[pluginName] = function(options) {
    return this.each(function () {
        if (!$(this).data('plugin_' + pluginName)) {
            $(this).data('plugin_' + pluginName, new Plugin(this, options));
        }
    });
};
