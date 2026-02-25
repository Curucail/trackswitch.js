import { TrackRuntime, TrackSwitchFeatures, TrackSwitchUiState } from '../domain/types';
import { clampPercent, escapeHtml, formatSecondsToHHMMSSmmm, sanitizeInlineStyle } from '../utils/helpers';
import { WaveformEngine } from '../engine/waveform-engine';

function buildSeekWrap(leftPercent: number, rightPercent: number): string {
    return '<div class="seekwrap" style="left: ' + leftPercent + '%; right: ' + rightPercent + '%;">'
        + '<div class="loop-region"></div>'
        + '<div class="loop-marker marker-a"></div>'
        + '<div class="loop-marker marker-b"></div>'
        + '<div class="seekhead"></div>'
        + '</div>';
}

export class ViewRenderer {
    private readonly root: JQuery<HTMLElement>;
    private readonly features: TrackSwitchFeatures;
    private readonly presetNames: string[];

    private originalImage = '';
    private readonly waveformCanvases: HTMLCanvasElement[] = [];
    private readonly waveformContexts: Array<CanvasRenderingContext2D | null> = [];
    private readonly waveformOriginalHeight: number[] = [];

    constructor(root: JQuery<HTMLElement>, features: TrackSwitchFeatures, presetNames: string[]) {
        this.root = root;
        this.features = features;
        this.presetNames = presetNames;
    }

    initialize(runtimes: TrackRuntime[]): void {
        this.root.addClass('jquery-trackswitch');

        if (this.root.find('.main-control').length === 0) {
            this.root.prepend(this.buildMainControlHtml());
        }

        this.wrapSeekableImages();
        this.wrapWaveformCanvases();
        this.renderTrackList(runtimes);

        if (this.root.find('.seekable:not(.seekable-img-wrap > .seekable)').length > 0) {
            this.root.find('.main-control .seekwrap').hide();
        }

        this.updateTiming(0, 0);
        this.updateVolumeIcon(1);
    }

    private buildMainControlHtml(): string {
        let presetDropdownHtml = '';
        if (this.presetNames.length >= 2) {
            presetDropdownHtml += '<li class="preset-selector-wrap"><select class="preset-selector" title="Select Preset">';
            for (let i = 0; i < this.presetNames.length; i += 1) {
                presetDropdownHtml += '<option value="' + i + '"' + (i === 0 ? ' selected' : '') + '>'
                    + escapeHtml(this.presetNames[i]) + '</option>';
            }
            presetDropdownHtml += '</select></li>';
        }

        return '<div class="overlay"><span class="activate">Activate</span>'
            + '<p id="overlaytext"></p>'
            + '<p id="overlayinfo">'
            + '<span class="info">Info</span>'
            + '<span class="text">'
            + '<strong>trackswitch.js</strong> - open source multitrack audio player<br />'
            + '<a href="https://github.com/audiolabs/trackswitch.js">https://github.com/audiolabs/trackswitch.js</a>'
            + '</span>'
            + '</p>'
            + '</div>'
            + '<div class="main-control">'
            + '<ul class="control">'
            + '<li class="playback-group">'
            + '<ul class="playback-controls">'
            + '<li class="playpause button" title="Play/Pause (Spacebar)">Play</li>'
            + '<li class="stop button" title="Stop (Esc)">Stop</li>'
            + '<li class="repeat button" title="Repeat (R)">Repeat</li>'
            + '</ul>'
            + '</li>'
            + (this.features.globalvolume
                ? '<li class="volume"><div class="volume-control"><i class="fa-volume-up volume-icon"></i>'
                    + '<input type="range" class="volume-slider" min="0" max="100" value="100"></div></li>'
                : '')
            + (this.features.looping
                ? '<li class="loop-group"><ul class="loop-controls">'
                    + '<li class="loop-a button" title="Set Loop Point A (A)">Loop A</li>'
                    + '<li class="loop-b button" title="Set Loop Point B (B)">Loop B</li>'
                    + '<li class="loop-toggle button" title="Toggle Loop On/Off (L)">Loop</li>'
                    + '<li class="loop-clear button" title="Clear Loop Points (C)">Clear</li>'
                    + '</ul></li>'
                : '')
            + presetDropdownHtml
            + '<li class="timing"><span class="time">--:--:--:---</span> / <span class="length">--:--:--:---</span></li>'
            + (this.features.seekbar
                ? '<li class="seekwrap">'
                    + '<div class="seekbar">'
                    + '<div class="loop-region"></div>'
                    + '<div class="loop-marker marker-a"></div>'
                    + '<div class="loop-marker marker-b"></div>'
                    + '<div class="seekhead"></div>'
                    + '</div>'
                    + '</li>'
                : '')
            + '</ul>'
            + '</div>';
    }

    private renderTrackList(runtimes: TrackRuntime[]): void {
        this.root.find('.track_list').remove();
        const list = $('<ul class="track_list"></ul>');

        runtimes.forEach((runtime, index) => {
            const tabviewClass = this.features.tabview ? ' tabs' : '';
            const radioSoloClass = this.features.radiosolo ? ' radio' : '';
            const wholeSoloClass = this.features.onlyradiosolo ? ' solo' : '';

            const track = $('<li class="track' + tabviewClass + wholeSoloClass + '"></li>');
            track.attr('style', sanitizeInlineStyle(runtime.definition.style || ''));
            track.append(document.createTextNode(runtime.definition.title || 'Track ' + (index + 1)));

            const controls = $('<ul class="control"></ul>');
            if (this.features.mute) {
                controls.append('<li class="mute button" title="Mute">Mute</li>');
            }
            if (this.features.solo) {
                controls.append('<li class="solo button' + radioSoloClass + '" title="Solo">Solo</li>');
            }

            track.append(controls);
            list.append(track);
        });

        this.root.append(list);
    }

    private wrapSeekableImages(): void {
        const that = this;
        this.root.find('.seekable:not(.seekable-img-wrap > .seekable)').each(function(this: HTMLElement) {
            const image = this as HTMLImageElement;
            if (!that.originalImage) {
                that.originalImage = image.src;
            }

            const wrappedImage = $(image) as JQuery<HTMLImageElement>;
            wrappedImage.wrap('<div class="seekable-img-wrap"></div>');
            wrappedImage.parent('.seekable-img-wrap').attr(
                'style',
                sanitizeInlineStyle(wrappedImage.data('style')) + '; display: block;'
            );

            wrappedImage.after(buildSeekWrap(
                clampPercent(wrappedImage.data('seekMarginLeft')),
                clampPercent(wrappedImage.data('seekMarginRight'))
            ));
        });
    }

    private wrapWaveformCanvases(): void {
        if (!this.features.waveform) {
            return;
        }

        const that = this;
        this.root.find('canvas.waveform:not(.waveform-wrap > canvas.waveform)').each(function(this: HTMLElement) {
            const canvas = this as HTMLCanvasElement;
            that.waveformCanvases.push(canvas);
            that.waveformContexts.push(canvas.getContext('2d'));
            that.waveformOriginalHeight.push(canvas.height);

            const wrappedCanvas = $(canvas) as JQuery<HTMLCanvasElement>;
            wrappedCanvas.wrap('<div class="waveform-wrap"></div>');
            wrappedCanvas.parent('.waveform-wrap').attr(
                'style',
                sanitizeInlineStyle(wrappedCanvas.data('waveformStyle')) + '; display: block;'
            );

            wrappedCanvas.after(buildSeekWrap(
                clampPercent(wrappedCanvas.data('seekMarginLeft')),
                clampPercent(wrappedCanvas.data('seekMarginRight'))
            ));
        });
    }

    drawDummyWaveforms(waveformEngine: WaveformEngine): void {
        if (!this.features.waveform) {
            return;
        }

        for (let i = 0; i < this.waveformCanvases.length; i += 1) {
            const canvas = this.waveformCanvases[i];
            const context = this.waveformContexts[i];
            if (!context) {
                continue;
            }

            const displayWidth = canvas.clientWidth || canvas.width;
            const originalHeight = this.waveformOriginalHeight[i] || canvas.height;

            if (canvas.width !== displayWidth) {
                canvas.width = displayWidth;
            }
            if (canvas.height !== originalHeight) {
                canvas.height = originalHeight;
            }

            waveformEngine.drawPlaceholder(canvas, context, this.features.waveformBarWidth, 0.3);
        }
    }

    renderWaveforms(waveformEngine: WaveformEngine, runtimes: TrackRuntime[]): void {
        if (!this.features.waveform || this.waveformCanvases.length === 0) {
            return;
        }

        for (let i = 0; i < this.waveformCanvases.length; i += 1) {
            const canvas = this.waveformCanvases[i];
            const context = this.waveformContexts[i];
            if (!context) {
                continue;
            }

            const displayWidth = canvas.clientWidth || canvas.width;
            const originalHeight = this.waveformOriginalHeight[i] || canvas.height;

            if (canvas.width !== displayWidth) {
                canvas.width = displayWidth;
            }
            if (canvas.height !== originalHeight) {
                canvas.height = originalHeight;
            }

            const peakCount = Math.max(1, Math.floor(canvas.width / this.features.waveformBarWidth));
            const mixed = waveformEngine.calculateMixedWaveform(runtimes, peakCount, this.features.waveformBarWidth);

            if (!mixed) {
                waveformEngine.drawPlaceholder(canvas, context, this.features.waveformBarWidth, 0.3);
                continue;
            }

            waveformEngine.drawWaveform(canvas, context, mixed, this.features.waveformBarWidth);
        }
    }

    updateMainControls(state: TrackSwitchUiState): void {
        this.root.find('.playpause').toggleClass('checked', state.playing);
        this.root.find('.repeat').toggleClass('checked', state.repeat);

        const timePerc = state.longestDuration > 0
            ? (state.position / state.longestDuration) * 100
            : 0;

        this.root.find('.seekhead').each(function() {
            $(this).css({ left: timePerc + '%' });
        });

        this.updateTiming(state.position, state.longestDuration);

        if (!this.features.looping) {
            return;
        }

        this.root.find('.loop-a').toggleClass('checked', state.loop.pointA !== null);
        this.root.find('.loop-b').toggleClass('checked', state.loop.pointB !== null);
        this.root.find('.loop-toggle').toggleClass('checked', state.loop.enabled);
        this.root.find('.loop-a, .loop-b').toggleClass('active', state.loop.enabled);

        if (state.loop.pointA !== null && state.longestDuration > 0) {
            const pointAPerc = (state.loop.pointA / state.longestDuration) * 100;
            this.root.find('.loop-marker.marker-a').css({ left: pointAPerc + '%', display: 'block' });
        } else {
            this.root.find('.loop-marker.marker-a').css({ display: 'none' });
        }

        if (state.loop.pointB !== null && state.longestDuration > 0) {
            const pointBPerc = (state.loop.pointB / state.longestDuration) * 100;
            this.root.find('.loop-marker.marker-b').css({ left: pointBPerc + '%', display: 'block' });
        } else {
            this.root.find('.loop-marker.marker-b').css({ display: 'none' });
        }

        if (state.loop.pointA !== null && state.loop.pointB !== null && state.longestDuration > 0) {
            const pointAPerc = (state.loop.pointA / state.longestDuration) * 100;
            const pointBPerc = (state.loop.pointB / state.longestDuration) * 100;
            const widthPerc = pointBPerc - pointAPerc;

            this.root.find('.loop-region').css({
                left: pointAPerc + '%',
                width: widthPerc + '%',
                display: 'block',
            }).toggleClass('active', state.loop.enabled);
        } else {
            this.root.find('.loop-region').css({ display: 'none' });
        }
    }

    updateTrackControls(runtimes: TrackRuntime[]): void {
        runtimes.forEach((runtime, index) => {
            const row = this.root.find('.track_list li.track:nth-child(' + (index + 1) + ')');
            row.find('.mute').toggleClass('checked', runtime.state.mute);
            row.find('.solo').toggleClass('checked', runtime.state.solo);
        });
    }

    switchPosterImage(runtimes: TrackRuntime[]): void {
        let soloCount = 0;
        let imageSrc: string | undefined;

        runtimes.forEach(function(runtime) {
            if (runtime.state.solo) {
                soloCount += 1;
                imageSrc = runtime.definition.image;
            }
        });

        if (soloCount !== 1 || !imageSrc) {
            imageSrc = this.originalImage;
        }

        if (imageSrc) {
            this.root.find('.seekable').attr('src', imageSrc);
        }
    }

    setVolumeSlider(volumeZeroToOne: number): void {
        const slider = this.root.find('.volume-slider');
        if (slider.length === 0) {
            return;
        }
        slider.val(Math.round(volumeZeroToOne * 100));
        this.updateVolumeIcon(volumeZeroToOne);
    }

    updateVolumeIcon(volumeZeroToOne: number): void {
        const volumeIcon = this.root.find('.volume-control .volume-icon');
        volumeIcon.removeClass('fa-volume-off fa-volume-down fa-volume-up');

        if (volumeZeroToOne === 0) {
            volumeIcon.addClass('fa-volume-off');
        } else if (volumeZeroToOne < 0.5) {
            volumeIcon.addClass('fa-volume-down');
        } else {
            volumeIcon.addClass('fa-volume-up');
        }
    }

    setOverlayLoading(isLoading: boolean): void {
        this.root.find('.overlay .activate').toggleClass('fa-spin loading', isLoading);
        this.root.find('.overlay').toggleClass('loading', isLoading);
    }

    showOverlayInfoText(): void {
        this.root.find('.overlay .info').hide();
        this.root.find('.overlay .text').show();
    }

    hideOverlayOnLoaded(): void {
        this.root.find('.overlay').hide().remove();
    }

    showError(message: string, runtimes: TrackRuntime[]): void {
        this.root.addClass('error');
        this.root.find('.overlay .activate').removeClass('fa-spin loading');
        this.root.find('#overlaytext').text(message);

        runtimes.forEach((runtime, index) => {
            if (!runtime.errored) {
                return;
            }
            this.root.find('.track_list > li:nth-child(' + (index + 1) + ')').addClass('error');
        });
    }

    destroy(): void {
        this.root.find('.main-control').remove();
        this.root.find('.track_list').remove();
    }

    getPresetCount(): number {
        return this.presetNames.length;
    }

    updateTiming(position: number, longestDuration: number): void {
        this.root.find('.timing .time').html(formatSecondsToHHMMSSmmm(position));
        this.root.find('.timing .length').html(formatSecondsToHHMMSSmmm(longestDuration));
    }
}
