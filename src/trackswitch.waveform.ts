// Calculate waveform peak data from an audio buffer
// Returns an array of peak values (one per pixel column)
TrackSwitchPlugin.prototype.calculateWaveformPeaks = function(buffer, width) {

    if (!buffer || width <= 0) {
        return new Float32Array(0);
    }

    var channelData = buffer.getChannelData(0); // Use first channel (mono or left channel)
    var samplesPerPixel = Math.floor(channelData.length / width);
    var peaks = new Float32Array(width);

    for (var x = 0; x < width; x++) {
        var start = x * samplesPerPixel;
        var end = start + samplesPerPixel;
        var max = 0;

        // Find peak absolute amplitude in this pixel range
        for (var i = start; i < end && i < channelData.length; i++) {
            var sample = Math.abs(channelData[i]);
            if (sample > max) {
                max = sample;
            }
        }

        peaks[x] = max;
    }

    return peaks;

}


// Draw waveform to canvas using pre-calculated peak data
TrackSwitchPlugin.prototype.drawWaveform = function(canvasIndex, peaks) {

    if (!this.waveformCanvas[canvasIndex] || !this.waveformContext[canvasIndex]) {
        return;
    }

    var canvas = this.waveformCanvas[canvasIndex];
    var ctx = this.waveformContext[canvasIndex];
    var width = canvas.width;
    var height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Check if we have peak data
    if (!peaks || peaks.length === 0) {
        return; // No data to draw
    }

    // Find the maximum peak value for normalization
    var maxPeak = 0;
    for (var i = 0; i < peaks.length; i++) {
        if (peaks[i] > maxPeak) {
            maxPeak = peaks[i];
        }
    }

    // Avoid division by zero
    if (maxPeak === 0) {
        maxPeak = 1;
    }

    // Get waveform color from CSS custom property or use default orange
    var waveformColor = getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || '#ED8C01';
    ctx.fillStyle = waveformColor;

    // Draw centered waveform bars (mirrored from center) with normalization
    // Bar width is configurable via waveformBarWidth option
    var barWidth = this.options.waveformBarWidth;
    for (var x = 0; x < peaks.length && x < width; x++) {
        var normalizedAmplitude = peaks[x] / maxPeak; // Normalize to 0-1 range
        var barHeight = normalizedAmplitude * height * 0.95; // Use 95% of canvas height
        var y = (height - barHeight) / 2;
        var xPos = x * barWidth;

        ctx.fillRect(xPos, y, barWidth, barHeight);
    }

}


// Draw a dummy/placeholder waveform before audio is loaded
TrackSwitchPlugin.prototype.drawDummyWaveform = function(canvasIndex) {

    if (!this.waveformCanvas[canvasIndex] || !this.waveformContext[canvasIndex]) {
        return;
    }

    var canvas = this.waveformCanvas[canvasIndex];
    var ctx = this.waveformContext[canvasIndex];
    
    // Ensure canvas dimensions are set based on display size
    var displayWidth = canvas.clientWidth || canvas.width;
    var originalHeight = this.waveformOriginalHeight[canvasIndex] || canvas.height;
    
    if (canvas.width !== displayWidth) {
        canvas.width = displayWidth;
    }
    if (canvas.height !== originalHeight) {
        canvas.height = originalHeight;
    }
    
    var width = canvas.width;
    var height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get waveform color from CSS custom property or use default orange
    var waveformColor = getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || '#ED8C01';
    // Make it semi-transparent to indicate it's a placeholder
    ctx.fillStyle = waveformColor;
    ctx.globalAlpha = 0.3;

    var barWidth = this.options.waveformBarWidth;
    var numBars = Math.floor(width / barWidth);

    // Generate a random waveform pattern for a realistic audio-like appearance
    for (var x = 0; x < numBars; x++) {
        // Use random values for amplitude with some smoothing to avoid too much noise
        var amplitude = Math.random() * 0.7 + 0.3; // Random between 0.3 and 1.0
        
        var barHeight = amplitude * height * 0.7; // Use up to 70% of canvas height
        var y = (height - barHeight) / 2;
        var xPos = x * barWidth;

        ctx.fillRect(xPos, y, barWidth, barHeight);
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;

};


// Draw dummy waveforms on all canvases
TrackSwitchPlugin.prototype.drawDummyWaveforms = function() {

    if (!this.options.waveform || this.waveformCanvas.length === 0) {
        return;
    }

    for (var i = 0; i < this.waveformCanvas.length; i++) {
        this.drawDummyWaveform(i);
    }

};


// Generate waveform data for all tracks
TrackSwitchPlugin.prototype.generateWaveforms = function() {

    if (!this.options.waveform || this.waveformCanvas.length === 0) {
        return;
    }

    var that = this;

    // For each canvas, we'll generate waveform data for all tracks
    this.waveformCanvas.forEach(function(canvas, canvasIndex) {

        // Set canvas width to match its display size for responsive scaling
        // Keep height consistent using the original height attribute
        var displayWidth = canvas.clientWidth || canvas.width;
        var originalHeight = that.waveformOriginalHeight[canvasIndex] || canvas.height;

        // Update canvas resolution if needed (only width, height stays consistent)
        if (canvas.width !== displayWidth) {
            canvas.width = displayWidth;
        }
        if (canvas.height !== originalHeight) {
            canvas.height = originalHeight;
        }

        // Calculate waveform peaks for each track
        // Peak count adjusted based on bar width to avoid overlapping bars
        var barWidth = that.options.waveformBarWidth;
        var peakCount = Math.floor(canvas.width / barWidth);
        for (var i = 0; i < that.numberOfTracks; i++) {
            var trackBuffer = that.trackBuffer[i];
            if (trackBuffer) {
                // Calculate peaks based on adjusted width for configurable bar width
                that.waveformData[i] = that.calculateWaveformPeaks(trackBuffer, peakCount);
            }
        }

        // Draw initial waveform (show first track or mixed view)
        that.switchWaveform();

    });

}


// Calculate mixed waveform from multiple tracks based on current audible state
TrackSwitchPlugin.prototype.calculateMixedWaveform = function() {

    if (!this.waveformData || this.waveformData.length === 0) {
        return null;
    }

    var anySolos = false;
    for (var i = 0; i < this.trackProperties.length; i++) {
        anySolos = anySolos || this.trackProperties[i].solo;
    }

    // Determine which tracks are audible
    var audibleTracks: number[] = [];
    for (var t = 0; t < this.trackProperties.length; t++) {
        var peaks = this.waveformData[t];
        if (!peaks) {
            continue;
        }

        var isAudible = anySolos ? this.trackProperties[t].solo : !this.trackProperties[t].mute;
        if (isAudible) {
            audibleTracks.push(t);
        }
    }

    // If only one audible track, return its waveform directly
    if (audibleTracks.length === 1) {
        return this.waveformData[audibleTracks[0]] || null;
    }

    // If no audible tracks, return null
    if (audibleTracks.length === 0) {
        return null;
    }

    // Mix multiple tracks by summing their peaks
    var firstTrackPeaks = this.waveformData[audibleTracks[0]];
    if (!firstTrackPeaks) {
        return null;
    }
    var width = firstTrackPeaks.length;
    var mixedPeaks = new Float32Array(width);

    for (var x = 0; x < width; x++) {
        var sum = 0;
        for (var trackCursor = 0; trackCursor < audibleTracks.length; trackCursor++) {
            var trackIndex = audibleTracks[trackCursor];
            var trackPeaks = this.waveformData[trackIndex];
            if (trackPeaks && x < trackPeaks.length) {
                sum += trackPeaks[x];
            }
        }
        // Average the sum to prevent clipping
        mixedPeaks[x] = sum / Math.sqrt(audibleTracks.length);
    }

    return mixedPeaks;

};


// Switch the displayed waveform based on solo state (similar to switch_image)
TrackSwitchPlugin.prototype.switchWaveform = function() {

    if (!this.options.waveform || this.waveformCanvas.length === 0) {
        return;
    }

    // Calculate the mixed waveform based on current track states
    var peaksToDisplay = this.calculateMixedWaveform();

    // Draw the waveform on all canvases
    for (var canvasIndex = 0; canvasIndex < this.waveformCanvas.length; canvasIndex++) {
        if (peaksToDisplay) {
            this.drawWaveform(canvasIndex, peaksToDisplay);
        }
    }

}


// Handle window resize for responsive waveform regeneration (debounced)
TrackSwitchPlugin.prototype.handleWaveformResize = function() {

    var that = this;

    // Clear existing debounce timer
    if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
    }

    // Debounce resize events to avoid excessive recalculation
    this.resizeDebounceTimer = setTimeout(function() {

        that.waveformCanvas.forEach(function(canvas, canvasIndex) {

            // Update canvas width to match its display size
            // Keep height consistent using the original height attribute
            var displayWidth = canvas.clientWidth;
            var originalHeight = that.waveformOriginalHeight[canvasIndex] || canvas.height;

            // Only regenerate if width changed (height stays consistent)
            if (canvas.width !== displayWidth) {
                canvas.width = displayWidth;
                canvas.height = originalHeight; // Ensure height remains consistent

                // Recalculate waveform peaks for all tracks at new width
                // Peak count adjusted based on bar width to avoid overlapping bars
                var barWidth = that.options.waveformBarWidth;
                var peakCount = Math.floor(canvas.width / barWidth);
                for (var i = 0; i < that.numberOfTracks; i++) {
                    var trackBuffer = that.trackBuffer[i];
                    if (trackBuffer) {
                        that.waveformData[i] = that.calculateWaveformPeaks(trackBuffer, peakCount);
                    }
                }

                // Redraw current waveform
                that.switchWaveform();
            }

        });

    }, 300); // 300ms debounce delay

}
