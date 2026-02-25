function finalizeLoopControlEvent(context: TrackSwitchPlugin, event: TrackSwitchEvent): false {
    context.updateMainControls();
    event.stopPropagation();
    return false;
}

function applyLoopPointChange(context: TrackSwitchPlugin, marker: 'A' | 'B', position: number): boolean {
    if (marker === 'A') {
        context.loopPointA = position;
    } else {
        context.loopPointB = position;
    }

    if (context.loopPointA !== null && context.loopPointB !== null && context.loopPointA > context.loopPointB) {
        var temp = context.loopPointA;
        context.loopPointA = context.loopPointB;
        context.loopPointB = temp;
    }

    if (
        context.loopPointA !== null &&
        context.loopPointB !== null &&
        (context.loopPointB - context.loopPointA) < context.loopMinDistance
    ) {
        if (marker === 'A') {
            console.warn('trackSwitch: Loop point A must be at least ' + (context.loopMinDistance * 1000) + 'ms before point B');
            context.loopPointA = null;
        } else {
            console.warn('trackSwitch: Loop point B must be at least ' + (context.loopMinDistance * 1000) + 'ms after point A');
            context.loopPointB = null;
        }
        context.loopEnabled = false;
        return false;
    }

    return true;
}

function maybeEnableLoopAndJump(context: TrackSwitchPlugin): void {
    if (context.loopPointA === null || context.loopPointB === null) {
        return;
    }

    context.loopEnabled = true;

    if (context.playing && (context.position < context.loopPointA || context.position > context.loopPointB)) {
        context.stopAudio();
        context.startAudio(context.loopPointA);
    }
}

// Set loop point A at current position
TrackSwitchPlugin.prototype.event_setLoopA = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    if (this.loopPointA !== null && Math.abs(this.loopPointA - this.position) < this.loopMinDistance) {
        this.loopPointA = null;
        this.loopEnabled = false;
        return finalizeLoopControlEvent(this, event);
    }

    if (applyLoopPointChange(this, 'A', this.position)) {
        maybeEnableLoopAndJump(this);
    }

    return finalizeLoopControlEvent(this, event);

};


// Set loop point B at current position
TrackSwitchPlugin.prototype.event_setLoopB = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    if (this.loopPointB !== null && Math.abs(this.loopPointB - this.position) < this.loopMinDistance) {
        this.loopPointB = null;
        this.loopEnabled = false;
        return finalizeLoopControlEvent(this, event);
    }

    if (applyLoopPointChange(this, 'B', this.position)) {
        maybeEnableLoopAndJump(this);
    }

    return finalizeLoopControlEvent(this, event);

};


// Toggle loop on/off (requires both points to be set)
TrackSwitchPlugin.prototype.event_toggleLoop = function(event) {

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

    return finalizeLoopControlEvent(this, event);

};


// Clear both loop points and disable looping
TrackSwitchPlugin.prototype.event_clearLoop = function(event) {

    if (!this.valid_click(event)) { return true; } // If not valid click, break out of func

    event.preventDefault();

    this.loopPointA = null;
    this.loopPointB = null;
    this.loopEnabled = false;
    this.rightClickDragging = false;
    this.loopDragStart = null;

    return finalizeLoopControlEvent(this, event);

};


// When seeking, calculate the desired position in the audio from the position on the slider
TrackSwitchPlugin.prototype.seek = function(event) {
    var seekMetrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
    if (!seekMetrics) {
        return;
    }

    var newPosTime = seekMetrics.time;

    // Only perform the audio part of the seek function if mouse is within seekable area!
    if (seekMetrics.posXRel >= 0 && seekMetrics.posXRel <= seekMetrics.seekWidth) {

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
TrackSwitchPlugin.prototype.event_seekStart = function(event) {

    // Check for right-click (button 3) for loop selection
    if (this.options.looping && event.type === "mousedown" && event.which === 3) {
        event.preventDefault();

        if (!event.target) {
            return true;
        }

        this.rightClickDragging = true;
        this.seekingElement = $(event.target).closest('.seekwrap');

        var seekMetrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
        if (!seekMetrics) {
            this.rightClickDragging = false;
            return true;
        }

        var startTime = seekMetrics.time;
        
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
    if (!event.target) {
        return true;
    }
    this.seekingElement = $(event.target).closest('.seekwrap');
    if (this.seekingElement.length === 0) {
        return true;
    }

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
TrackSwitchPlugin.prototype.event_seekMove = function(event) {

    // Handle marker dragging
    if (this.draggingMarker !== null) {
        event.preventDefault();

        var markerSeekMetrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
        if (!markerSeekMetrics) {
            return false;
        }
        var newTime = markerSeekMetrics.time;
        
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
    if (this.options.looping && this.rightClickDragging) {
        event.preventDefault();

        var dragSeekMetrics = getSeekMetrics(this.seekingElement, event, this.longestDuration);
        if (!dragSeekMetrics || this.loopDragStart === null) {
            return false;
        }
        var currentTime = dragSeekMetrics.time;
        
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
TrackSwitchPlugin.prototype.event_seekEnd = function(event) {

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
TrackSwitchPlugin.prototype.event_markerDragStart = function(event) {

    if (!this.options.looping || !this.valid_click(event)) { return true; } // If not valid click, break out of func
    if (!event.target) {
        return true;
    }

    event.preventDefault();
    event.stopPropagation(); // Prevent seek from triggering

    // Determine which marker is being dragged
    var eventTarget = $(event.target);
    if (eventTarget.hasClass('marker-a')) {
        this.draggingMarker = 'A';
    } else if (eventTarget.hasClass('marker-b')) {
        this.draggingMarker = 'B';
    }

    // Store the seekwrap element for position calculations
    this.seekingElement = eventTarget.closest('.seekwrap');

    return false;

};
