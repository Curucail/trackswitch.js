// Handle keyboard shortcuts
TrackSwitchPlugin.prototype.handleKeyboardEvent = function(event) {

    // Don't intercept keyboard shortcuts when user is typing in an input field
    if ($(event.target ?? document.body).closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]').length) {
        return;
    }
    if (!isKeyboardInstanceActive(this.instanceId)) {
        return;
    }
    
    var handled = false;
    var key = event.key || event.code;
    
    switch (key) {
        // Spacebar values: event.key === " " (or legacy "Spacebar"), event.code === "Space"
        case ' ':
        case 'Spacebar':
        case 'Space': // Space - Play/Pause
            event.preventDefault();
            this.event_playpause(event);
            handled = true;
            break;
            
        // Escape values: event.key === "Escape" (or legacy "Esc"), event.code === "Escape"
        case 'Escape':
        case 'Esc': // Escape - Stop
            event.preventDefault();
            var stopEvent = $.Event('mousedown', { which: 1, type: 'mousedown' }) as unknown as TrackSwitchEvent;
            this.event_stop(stopEvent);
            handled = true;
            break;
            
        // Left arrow values: event.key === "ArrowLeft", event.code === "ArrowLeft"
        case 'ArrowLeft': // Left Arrow - Seek backward
            event.preventDefault();
            var seekAmount = event.shiftKey ? -5 : -2;
            this.seekRelative(seekAmount);
            handled = true;
            break;
            
        // Right arrow values: event.key === "ArrowRight", event.code === "ArrowRight"
        case 'ArrowRight': // Right Arrow - Seek forward
            event.preventDefault();
            var seekAmount = event.shiftKey ? 5 : 2;
            this.seekRelative(seekAmount);
            handled = true;
            break;
            
        // Up arrow values: event.key === "ArrowUp", event.code === "ArrowUp"
        case 'ArrowUp': // Up Arrow - Volume up
            if (this.options.globalvolume) {
                event.preventDefault();
                this.adjustVolume(10);
                handled = true;
            }
            break;
            
        // Down arrow values: event.key === "ArrowDown", event.code === "ArrowDown"
        case 'ArrowDown': // Down Arrow - Volume down
            if (this.options.globalvolume) {
                event.preventDefault();
                this.adjustVolume(-10);
                handled = true;
            }
            break;
            
        // Home values: event.key === "Home", event.code === "Home"
        case 'Home': // Home - Jump to start
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
            
        // Repeat key values: event.key === "r"/"R", event.code === "KeyR"
        case 'r':
        case 'R':
        case 'KeyR': // R - Toggle repeat
            event.preventDefault();
            var repeatEvent = $.Event('mousedown', { which: 1, type: 'mousedown' }) as unknown as TrackSwitchEvent;
            this.event_repeat(repeatEvent);
            handled = true;
            break;
            
        // Loop A key values: event.key === "a"/"A", event.code === "KeyA"
        case 'a':
        case 'A':
        case 'KeyA': // A - Set loop point A at current position (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var loopAEvent = $.Event('mousedown', { which: 1, type: 'mousedown' }) as unknown as TrackSwitchEvent;
                this.event_setLoopA(loopAEvent);
                handled = true;
            }
            break;
            
        // Loop B key values: event.key === "b"/"B", event.code === "KeyB"
        case 'b':
        case 'B':
        case 'KeyB': // B - Set loop point B at current position (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var loopBEvent = $.Event('mousedown', { which: 1, type: 'mousedown' }) as unknown as TrackSwitchEvent;
                this.event_setLoopB(loopBEvent);
                handled = true;
            }
            break;
            
        // Loop toggle key values: event.key === "l"/"L", event.code === "KeyL"
        case 'l':
        case 'L':
        case 'KeyL': // L - Toggle loop on/off (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var toggleLoopEvent = $.Event('mousedown', { which: 1, type: 'mousedown' }) as unknown as TrackSwitchEvent;
                this.event_toggleLoop(toggleLoopEvent);
                handled = true;
            }
            break;
            
        // Loop clear key values: event.key === "c"/"C", event.code === "KeyC"
        case 'c':
        case 'C':
        case 'KeyC': // C - Clear loop points (only if looping enabled)
            if (this.options.looping) {
                event.preventDefault();
                var clearLoopEvent = $.Event('mousedown', { which: 1, type: 'mousedown' }) as unknown as TrackSwitchEvent;
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
TrackSwitchPlugin.prototype.event_playpause = function(event) {

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
TrackSwitchPlugin.prototype.event_stop = function(event) {

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
TrackSwitchPlugin.prototype.event_repeat = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    this.repeat = !this.repeat;
    this.updateMainControls();

    event.stopPropagation();
    return false;

};

// A shorthandle to resolve click target index number. Used for mute/solo buttons
TrackSwitchPlugin.prototype._index_from_target = function(target) {
    if (!(target instanceof Element)) {
        return -1;
    }
    return $(target).closest(".track").prevAll().length;
};


// Set or unset solo mode for each track, only change properties
TrackSwitchPlugin.prototype.event_solo = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    // Events not prevented/halted as this stops scrolling for full track solo

    var targetIndex = this._index_from_target(event.target ?? null);
    if (targetIndex < 0 || !this.trackProperties[targetIndex]) {
        return true;
    }
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
TrackSwitchPlugin.prototype.event_mute = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    var targetIndex = this._index_from_target(event.target ?? null);
    if (targetIndex < 0 || !this.trackProperties[targetIndex]) {
        return true;
    }

    // Flip the current mute state of the selected track
    this.trackProperties[targetIndex].mute = !this.trackProperties[targetIndex].mute;

    this.apply_track_properties();

    event.stopPropagation();
    return false;

};


// Handle preset selection from dropdown
TrackSwitchPlugin.prototype.event_preset = function(event) {
    if (!event.target) {
        return;
    }

    var presetIndex = parseStrictNonNegativeInt(String($(event.target).val() ?? '0'));
    if (!Number.isFinite(presetIndex)) {
        presetIndex = 0;
    }
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
TrackSwitchPlugin.prototype.event_preset_scroll = function(event) {

    event.preventDefault();
    if (!event.target) {
        return;
    }

    var $selector = $(event.target).closest('.preset-selector');
    var currentIndex = parseStrictNonNegativeInt(String($selector.val() ?? '0'));
    if (!Number.isFinite(currentIndex)) {
        currentIndex = 0;
    }
    var maxIndex = $selector.find('option').length - 1;
    var newIndex = currentIndex;

    // Scroll down (deltaY > 0) moves to next preset, scroll up (deltaY < 0) moves to previous
    var deltaY = event.originalEvent?.deltaY ?? 0;
    if (deltaY > 0) {
        newIndex = Math.min(currentIndex + 1, maxIndex);
    } else if (deltaY < 0) {
        newIndex = Math.max(currentIndex - 1, 0);
    }

    // Update the dropdown value and trigger change event
    $selector.val(newIndex);
    $selector.trigger('change');
};


// Cycle through the available images, setting it based on the solo states
TrackSwitchPlugin.prototype.switch_image = function() {

    var that = this;
    var numSoloed = 0, imageSrc: string | undefined;

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
TrackSwitchPlugin.prototype.apply_track_properties = function() {
    var that = this;

    var anySolos = false;
    $.each(this.trackProperties, function(i, value) {
        var index = Number(i);
        anySolos = anySolos || that.trackProperties[index].solo;
    });

    $.each(this.trackProperties, function(i, value) {
        var index = Number(i);

      // 1) First update the UI elements to reflect the changes in properties...

        var elem = that.element.find(".track_list li.track:nth-child(" + (index + 1) + ")");

        // Update the mute icon status based on track mute state
        if(that.trackProperties[index].mute) {
            elem.find(".mute").addClass('checked');
        }
        else {
            elem.find(".mute").removeClass('checked');
        }

        // Update the solo icon status based on track solo state
        if(that.trackProperties[index].solo) {
            elem.find(".solo").addClass('checked');
        }
        else {
            elem.find(".solo").removeClass('checked');
        }

      // 2) Then update the gains of each track depending on the new properties

        // Filter to stop the gains being edited before activation (gain undefined)
        if (that.trackGainNode.length > 0 && that.trackGainNode[index]) {

            that.trackGainNode[index].gain.value = 1;

            // First, only play tracks that are not muted
            if(that.trackProperties[index].mute) {
                that.trackGainNode[index].gain.value = 0;
            }
            else {
                that.trackGainNode[index].gain.value = 1;
            }

            // Then, if there are 1 or more soloed tracks, overwrite with their solo state
            if(anySolos) {
                if(that.trackProperties[index].solo) {
                    that.trackGainNode[index].gain.value = 1;
                }
                else {
                    that.trackGainNode[index].gain.value = 0;
                }
            }

        }

    });

    this.switch_image(); // Now handle the switching of the poster image
    this.switchWaveform(); // Now handle the switching of the waveform

    this.deselect();
};


// Handle volume slider input — update the volume gain node
TrackSwitchPlugin.prototype.event_volume = function(event) {
    if (!this.options.globalvolume) {
        this.masterVolume = 1;
        if (this.gainNodeVolume) {
            this.gainNodeVolume.gain.value = 1;
        }
        return;
    }

    if (!event.target) {
        return;
    }

    var val = parseFloat(String($(event.target).val() ?? '0')) / 100;
    if (!Number.isFinite(val)) {
        val = 0;
    }
    val = Math.max(0, Math.min(1, val));
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


TrackSwitchPlugin.prototype.deselect = function(index) {
    var selection = window.getSelection();
    if (selection) {
        selection.removeAllRanges();
        return;
    }

    var legacySelection = (document as Document & { selection?: { empty?: () => void } }).selection;
    if (legacySelection?.empty) {
        legacySelection.empty();
    }
};
