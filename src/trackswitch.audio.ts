// Timer fuction to update the UI periodically (with new time and seek position)
// Also listens for the longest track to end and stops or repeats as needed
TrackSwitchPlugin.prototype.monitorPosition = function(context) {
    if (!audioContext || context.isDestroyed) {
        return;
    }

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
TrackSwitchPlugin.prototype.stopAudio = function() {
    if (!this.canUseAudioGraph() || !audioContext || !this.gainNodeMaster) {
        if (this.timerMonitorPosition) {
            clearInterval(this.timerMonitorPosition);
            this.timerMonitorPosition = null;
        }
        return;
    }

    // Create downward master gain ramp to fade signal out
    var now = audioContext.currentTime;
    var downwardRamp = 0.03;

    // NOTE: The downward ramp is in 'free' time, after the playhead has stopped.
    // For this reason, making the ramps long to test with causes overlaps.
    this.gainNodeMaster.gain.cancelScheduledValues(now);
    this.gainNodeMaster.gain.setValueAtTime(1.0, now);
    this.gainNodeMaster.gain.linearRampToValueAtTime(0.0, now + downwardRamp);

    for (var i=0; i<this.numberOfTracks; i++) {
        var activeSource = this.activeAudioSources[i];
        if (activeSource) {
            try {
                activeSource.stop(now + downwardRamp);
            } catch (e) {}
        }
    }

    if (this.timerMonitorPosition) {
        clearInterval(this.timerMonitorPosition);
        this.timerMonitorPosition = null;
    }

}


// Create, connect and start a new audio buffer for each track and begin update timer
TrackSwitchPlugin.prototype.startAudio = function(newPos, duration) {
    if (!this.canUseAudioGraph() || !audioContext || !this.gainNodeMaster) {
        return;
    }

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

        if (!this.trackBuffer[i] || !this.trackGainNode[i]) {
            continue;
        }

        var trackBuffer = this.trackBuffer[i];
        if (!trackBuffer) {
            continue;
        }

        var timing = this.trackTiming[i] || {
            trimStart: 0,
            padStart: 0,
            audioDuration: trackBuffer.duration,
            effectiveDuration: trackBuffer.duration,
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

        var createdSource = audioContext.createBufferSource();
        createdSource.buffer = trackBuffer;
        createdSource.connect(this.trackGainNode[i]);
        createdSource.start(startAt, sourceOffset, playDuration);
        this.activeAudioSources[i] = createdSource;

    }

    this.startTime = now - ( this.position || 0 );

    if (this.timerMonitorPosition) {
        clearInterval(this.timerMonitorPosition);
    }
    this.timerMonitorPosition = setInterval(function(){
        that.monitorPosition(that);
    }, 16); // 62.5Hz for smooth motion

}


// Pause player (used by other players to enforce globalsolo)
TrackSwitchPlugin.prototype.pause = function() {
    if (!audioContext) {
        return;
    }

    if (this.playing === true) {
        this.stopAudio();
        this.position = audioContext.currentTime - this.startTime;
        this.playing = false;
        this.updateMainControls();
    }

};


// Returns the other players on the page (for globalsolo)
TrackSwitchPlugin.prototype.other_instances = function() {
    return $(".jquery-trackswitch").not(this.element);
};


// Iterate through the other players to pause them (for globalsolo)
TrackSwitchPlugin.prototype.pause_others = function() {

    if (this.options.globalsolo) {
        this.other_instances().each(function (this: HTMLElement) {
            const plugin = $(this).data('plugin_' + pluginName);
            if (plugin && typeof plugin.pause === 'function') {
                plugin.pause();
            }
        });
    }

}


// Seek relative to current position by specified seconds (can be negative)
TrackSwitchPlugin.prototype.seekRelative = function(seconds) {

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
TrackSwitchPlugin.prototype.adjustVolume = function(delta) {

    var volumeSlider = this.element.find('.volume-slider');
    var currentVolume = parseFloat(String(volumeSlider.val() ?? '0'));
    var newVolume = currentVolume + delta;
    
    // Clamp to valid range [0, 100]
    newVolume = Math.max(0, Math.min(newVolume, 100));
    
    volumeSlider.val(newVolume);
    
    // Trigger the volume change event
    var event = $.Event('input');
    volumeSlider.trigger(event);

};
