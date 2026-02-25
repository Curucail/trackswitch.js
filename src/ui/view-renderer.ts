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

function setDisplay(element: Element, displayValue: string): void {
    (element as HTMLElement).style.display = displayValue;
}

function setLeftPercent(element: Element, value: number): void {
    (element as HTMLElement).style.left = value + '%';
}

function setWidthPercent(element: Element, value: number): void {
    (element as HTMLElement).style.width = value + '%';
}

export class ViewRenderer {
    private readonly root: HTMLElement;
    private readonly features: TrackSwitchFeatures;
    private readonly presetNames: string[];

    private originalImage = '';
    private readonly waveformCanvases: HTMLCanvasElement[] = [];
    private readonly waveformContexts: Array<CanvasRenderingContext2D | null> = [];
    private readonly waveformOriginalHeight: number[] = [];

    constructor(root: HTMLElement, features: TrackSwitchFeatures, presetNames: string[]) {
        this.root = root;
        this.features = features;
        this.presetNames = presetNames;
    }

    private query(selector: string): HTMLElement | null {
        return this.root.querySelector(selector);
    }

    private queryAll(selector: string): HTMLElement[] {
        return Array.from(this.root.querySelectorAll(selector)) as HTMLElement[];
    }

    initialize(runtimes: TrackRuntime[]): void {
        this.root.classList.add('trackswitch');
        this.root.classList.add('jquery-trackswitch');

        if (!this.query('.main-control')) {
            this.root.insertAdjacentHTML('afterbegin', this.buildMainControlHtml());
        }

        this.wrapSeekableImages();
        this.wrapWaveformCanvases();
        this.renderTrackList(runtimes);

        if (this.query('.seekable:not(.seekable-img-wrap > .seekable)')) {
            this.queryAll('.main-control .seekwrap').forEach(function(seekWrap) {
                setDisplay(seekWrap, 'none');
            });
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
        this.queryAll('.track_list').forEach(function(existing) {
            existing.remove();
        });

        const list = document.createElement('ul');
        list.className = 'track_list';

        runtimes.forEach((runtime, index) => {
            const tabviewClass = this.features.tabview ? ' tabs' : '';
            const radioSoloClass = this.features.radiosolo ? ' radio' : '';
            const wholeSoloClass = this.features.onlyradiosolo ? ' solo' : '';

            const track = document.createElement('li');
            track.className = 'track' + tabviewClass + wholeSoloClass;
            track.setAttribute('style', sanitizeInlineStyle(runtime.definition.style || ''));
            track.append(document.createTextNode(runtime.definition.title || 'Track ' + (index + 1)));

            const controls = document.createElement('ul');
            controls.className = 'control';

            if (this.features.mute) {
                const mute = document.createElement('li');
                mute.className = 'mute button';
                mute.title = 'Mute';
                mute.textContent = 'Mute';
                controls.appendChild(mute);
            }

            if (this.features.solo) {
                const solo = document.createElement('li');
                solo.className = 'solo button' + radioSoloClass;
                solo.title = 'Solo';
                solo.textContent = 'Solo';
                controls.appendChild(solo);
            }

            track.appendChild(controls);
            list.appendChild(track);
        });

        this.root.appendChild(list);
    }

    private wrapSeekableImages(): void {
        const candidates = this.queryAll('.seekable');

        candidates.forEach((candidate) => {
            if (!(candidate instanceof HTMLImageElement)) {
                return;
            }

            if (candidate.parentElement?.classList.contains('seekable-img-wrap')) {
                return;
            }

            if (!this.originalImage) {
                this.originalImage = candidate.src;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'seekable-img-wrap';
            wrapper.setAttribute('style', sanitizeInlineStyle(candidate.getAttribute('data-style')) + '; display: block;');

            const parent = candidate.parentElement;
            if (!parent) {
                return;
            }

            parent.insertBefore(wrapper, candidate);
            wrapper.appendChild(candidate);
            wrapper.insertAdjacentHTML(
                'beforeend',
                buildSeekWrap(
                    clampPercent(candidate.getAttribute('data-seek-margin-left')),
                    clampPercent(candidate.getAttribute('data-seek-margin-right'))
                )
            );
        });
    }

    private wrapWaveformCanvases(): void {
        if (!this.features.waveform) {
            return;
        }

        const canvases = this.root.querySelectorAll('canvas.waveform');
        canvases.forEach((canvasElement) => {
            if (!(canvasElement instanceof HTMLCanvasElement)) {
                return;
            }

            if (canvasElement.parentElement?.classList.contains('waveform-wrap')) {
                return;
            }

            this.waveformCanvases.push(canvasElement);
            this.waveformContexts.push(canvasElement.getContext('2d'));
            this.waveformOriginalHeight.push(canvasElement.height);

            const wrapper = document.createElement('div');
            wrapper.className = 'waveform-wrap';
            wrapper.setAttribute('style', sanitizeInlineStyle(canvasElement.getAttribute('data-waveform-style')) + '; display: block;');

            const parent = canvasElement.parentElement;
            if (!parent) {
                return;
            }

            parent.insertBefore(wrapper, canvasElement);
            wrapper.appendChild(canvasElement);
            wrapper.insertAdjacentHTML(
                'beforeend',
                buildSeekWrap(
                    clampPercent(canvasElement.getAttribute('data-seek-margin-left')),
                    clampPercent(canvasElement.getAttribute('data-seek-margin-right'))
                )
            );
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
        this.queryAll('.playpause').forEach(function(element) {
            element.classList.toggle('checked', state.playing);
        });

        this.queryAll('.repeat').forEach(function(element) {
            element.classList.toggle('checked', state.repeat);
        });

        const timePerc = state.longestDuration > 0
            ? (state.position / state.longestDuration) * 100
            : 0;

        this.queryAll('.seekhead').forEach(function(seekhead) {
            setLeftPercent(seekhead, timePerc);
        });

        this.updateTiming(state.position, state.longestDuration);

        if (!this.features.looping) {
            return;
        }

        this.queryAll('.loop-a').forEach(function(element) {
            element.classList.toggle('checked', state.loop.pointA !== null);
            element.classList.toggle('active', state.loop.enabled);
        });

        this.queryAll('.loop-b').forEach(function(element) {
            element.classList.toggle('checked', state.loop.pointB !== null);
            element.classList.toggle('active', state.loop.enabled);
        });

        this.queryAll('.loop-toggle').forEach(function(element) {
            element.classList.toggle('checked', state.loop.enabled);
        });

        if (state.loop.pointA !== null && state.longestDuration > 0) {
            const pointAPerc = (state.loop.pointA / state.longestDuration) * 100;
            this.queryAll('.loop-marker.marker-a').forEach(function(marker) {
                setLeftPercent(marker, pointAPerc);
                setDisplay(marker, 'block');
            });
        } else {
            this.queryAll('.loop-marker.marker-a').forEach(function(marker) {
                setDisplay(marker, 'none');
            });
        }

        if (state.loop.pointB !== null && state.longestDuration > 0) {
            const pointBPerc = (state.loop.pointB / state.longestDuration) * 100;
            this.queryAll('.loop-marker.marker-b').forEach(function(marker) {
                setLeftPercent(marker, pointBPerc);
                setDisplay(marker, 'block');
            });
        } else {
            this.queryAll('.loop-marker.marker-b').forEach(function(marker) {
                setDisplay(marker, 'none');
            });
        }

        if (state.loop.pointA !== null && state.loop.pointB !== null && state.longestDuration > 0) {
            const pointAPerc = (state.loop.pointA / state.longestDuration) * 100;
            const pointBPerc = (state.loop.pointB / state.longestDuration) * 100;
            const widthPerc = pointBPerc - pointAPerc;

            this.queryAll('.loop-region').forEach(function(region) {
                setLeftPercent(region, pointAPerc);
                setWidthPercent(region, widthPerc);
                setDisplay(region, 'block');
                region.classList.toggle('active', state.loop.enabled);
            });
        } else {
            this.queryAll('.loop-region').forEach(function(region) {
                setDisplay(region, 'none');
                region.classList.remove('active');
            });
        }
    }

    updateTrackControls(runtimes: TrackRuntime[]): void {
        runtimes.forEach((runtime, index) => {
            const row = this.query('.track_list li.track:nth-child(' + (index + 1) + ')');
            if (!row) {
                return;
            }

            const mute = row.querySelector('.mute');
            const solo = row.querySelector('.solo');

            if (mute) {
                mute.classList.toggle('checked', runtime.state.mute);
            }

            if (solo) {
                solo.classList.toggle('checked', runtime.state.solo);
            }
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

        if (!imageSrc) {
            return;
        }

        this.queryAll('.seekable').forEach(function(element) {
            if (element instanceof HTMLImageElement) {
                element.src = imageSrc as string;
            }
        });
    }

    setVolumeSlider(volumeZeroToOne: number): void {
        const slider = this.query('.volume-slider');
        if (!slider || !(slider instanceof HTMLInputElement)) {
            return;
        }

        slider.value = String(Math.round(volumeZeroToOne * 100));
        this.updateVolumeIcon(volumeZeroToOne);
    }

    updateVolumeIcon(volumeZeroToOne: number): void {
        this.queryAll('.volume-control .volume-icon').forEach(function(icon) {
            icon.classList.remove('fa-volume-off', 'fa-volume-down', 'fa-volume-up');

            if (volumeZeroToOne === 0) {
                icon.classList.add('fa-volume-off');
            } else if (volumeZeroToOne < 0.5) {
                icon.classList.add('fa-volume-down');
            } else {
                icon.classList.add('fa-volume-up');
            }
        });
    }

    setOverlayLoading(isLoading: boolean): void {
        this.queryAll('.overlay .activate').forEach(function(activate) {
            activate.classList.toggle('fa-spin', isLoading);
            activate.classList.toggle('loading', isLoading);
        });

        this.queryAll('.overlay').forEach(function(overlay) {
            overlay.classList.toggle('loading', isLoading);
        });
    }

    showOverlayInfoText(): void {
        this.queryAll('.overlay .info').forEach(function(info) {
            setDisplay(info, 'none');
        });

        this.queryAll('.overlay .text').forEach(function(text) {
            setDisplay(text, 'block');
        });
    }

    hideOverlayOnLoaded(): void {
        this.queryAll('.overlay').forEach(function(overlay) {
            overlay.remove();
        });
    }

    showError(message: string, runtimes: TrackRuntime[]): void {
        this.root.classList.add('error');

        this.queryAll('.overlay .activate').forEach(function(activate) {
            activate.classList.remove('fa-spin', 'loading');
        });

        const overlayText = this.query('#overlaytext');
        if (overlayText) {
            overlayText.textContent = message;
        }

        runtimes.forEach((runtime, index) => {
            if (!runtime.errored) {
                return;
            }

            const row = this.query('.track_list > li:nth-child(' + (index + 1) + ')');
            if (row) {
                row.classList.add('error');
            }
        });
    }

    destroy(): void {
        this.queryAll('.main-control').forEach(function(mainControl) {
            mainControl.remove();
        });

        this.queryAll('.track_list').forEach(function(trackList) {
            trackList.remove();
        });
    }

    getPresetCount(): number {
        return this.presetNames.length;
    }

    updateTiming(position: number, longestDuration: number): void {
        this.queryAll('.timing .time').forEach(function(node) {
            node.textContent = formatSecondsToHHMMSSmmm(position);
        });

        this.queryAll('.timing .length').forEach(function(node) {
            node.textContent = formatSecondsToHHMMSSmmm(longestDuration);
        });
    }
}
