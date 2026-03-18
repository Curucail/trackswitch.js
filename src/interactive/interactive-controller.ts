import type {
    InteractiveFile,
    InteractiveState,
    InteractiveTrackSwitchController,
    InteractiveTrackSwitchInit,
    AlignmentMethodId,
} from './types';
import type { TrackSwitchController } from '../domain/types';
import { FEATURE_RATE } from './constants';
import { processFile, fileNameToColumnName, fileNameToMeasureColumnName } from './file-handler';
import { AlignmentWorkerBridge } from './worker/alignment-worker-bridge';
import {
    buildFullDropZonePanel,
    bindDropZoneEvents,
    type DropZoneEvents,
} from './ui/render-dropzone';
import {
    buildSettingsPanelHtml,
    bindSettingsPanelEvents,
    type SettingsPanelState,
} from './ui/render-settings';
import { injectSettingsButton } from './ui/settings-button';
import { renderIconSlotHtml } from '../ui/icons';
import { createTrackSwitch } from '../player/factory';

export class InteractiveTrackSwitchControllerImpl implements InteractiveTrackSwitchController {
    private rootElement: HTMLElement;
    private init: InteractiveTrackSwitchInit;
    private state: InteractiveState;
    private workerBridge: AlignmentWorkerBridge;
    private innerController: TrackSwitchController | null = null;
    private destroyed = false;
    private dropZoneContainer: HTMLElement | null = null;
    private settingsPanelContainer: HTMLElement | null = null;

    constructor(rootElement: HTMLElement, init: InteractiveTrackSwitchInit) {
        this.rootElement = rootElement;
        this.init = init;
        this.state = {
            files: [],
            referenceFileId: null,
            alignmentMethod: init.alignmentMethod || 'mrmsdtw',
            computationStatus: 'idle',
            computationError: null,
            alignmentCsv: null,
            workerReady: false,
        };
        this.workerBridge = new AlignmentWorkerBridge(init.workerUrl, init.pyodideCdnUrl);
        this.workerBridge.setProgressCallback(this.onWorkerProgress.bind(this));
    }

    initialize(): void {
        if (this.destroyed) {
            return;
        }

        this.rootElement.classList.add('trackswitch');
        this.renderDropZonePhase();
    }

    destroy(): void {
        this.destroyed = true;
        this.workerBridge.destroy();
        if (this.innerController) {
            this.innerController.destroy();
            this.innerController = null;
        }
        this.rootElement.innerHTML = '';
        this.rootElement.classList.remove('trackswitch', 'ts-controls-disabled');
    }

    getInnerController(): TrackSwitchController | null {
        return this.innerController;
    }

    // ── Drop Zone Phase ──

    private renderDropZonePhase(): void {
        const canCompute = this.state.files.length >= 2 && this.state.referenceFileId !== null;
        const isComputing = this.state.computationStatus === 'computing'
            || this.state.computationStatus === 'initializing';
        const statusMessage = this.getStatusMessage();
        const computingMessage = this.state.computationError || statusMessage || 'Computing alignment...';

        let html = this.buildDisabledNavBarHtml();
        html += buildFullDropZonePanel(
            this.state.files,
            this.state.referenceFileId,
            canCompute,
            statusMessage,
            isComputing,
            computingMessage,
            this.state.alignmentMethod
        );

        this.rootElement.innerHTML = html;
        this.rootElement.classList.add('ts-controls-disabled');

        // Bind drop zone events
        const panel = this.rootElement.querySelector('.ts-interactive-panel') as HTMLElement;
        if (panel) {
            this.dropZoneContainer = panel;
            bindDropZoneEvents(panel, this.createDropZoneEvents());
        }

        // Bind settings button
        const settingsBtn = this.rootElement.querySelector('.settings-button');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', this.openSettingsPanel.bind(this));
        }
    }

    private buildDisabledNavBarHtml(): string {
        return '<div class="main-control ts-stack-section">'
            + '<ul class="control">'
            + '<li class="playback-group">'
            + '<ul class="playback-controls">'
            + '<li class="playpause button" title="Play/Pause">Play'
            + renderIconSlotHtml('play')
            + '</li>'
            + '<li class="stop button" title="Stop">Stop'
            + renderIconSlotHtml('stop')
            + '</li>'
            + '<li class="repeat button" title="Repeat">Repeat'
            + renderIconSlotHtml('rotate-right')
            + '</li>'
            + '</ul>'
            + '</li>'
            + '<li class="timing"><span class="time">--:--:--:---</span> / <span class="length">--:--:--:---</span></li>'
            + '<li class="seekwrap">'
            + '<div class="seekbar">'
            + '<div class="seekhead"></div>'
            + '</div>'
            + '</li>'
            + '<li class="settings-button button" title="Settings">'
            + renderIconSlotHtml('gear')
            + '</li>'
            + '</ul>'
            + '</div>';
    }

    private createDropZoneEvents(): DropZoneEvents {
        return {
            onFilesAdded: this.handleFilesAdded.bind(this),
            onReferenceChanged: this.handleReferenceChanged.bind(this),
            onFileRemoved: this.handleFileRemoved.bind(this),
            onMethodChanged: this.handleMethodChanged.bind(this),
            onComputeClicked: this.handleComputeClicked.bind(this),
        };
    }

    private getStatusMessage(): string {
        if (this.state.computationError) {
            return 'Error: ' + this.state.computationError;
        }
        if (this.state.computationStatus === 'initializing') {
            return 'Preparing alignment engine...';
        }
        if (this.state.computationStatus === 'computing') {
            return 'Computing alignment...';
        }
        if (this.state.files.length === 0) {
            return '';
        }
        if (this.state.files.length === 1) {
            return 'Add at least one more file to compute alignment.';
        }
        if (!this.state.referenceFileId) {
            return 'Select a reference file.';
        }
        return '';
    }

    // ── File Handling ──

    private async handleFilesAdded(files: File[]): Promise<void> {
        if (this.destroyed) {
            return;
        }

        for (const file of files) {
            try {
                const interactiveFile = await processFile(file);
                this.state.files.push(interactiveFile);
            } catch (error) {
                console.warn('Failed to process file:', file.name, error);
            }
        }

        // Auto-select reference: first score file, else first item
        if (!this.state.referenceFileId && this.state.files.length > 0) {
            const firstScore = this.state.files.find(function(f) { return f.type === 'musicxml'; });
            this.state.referenceFileId = firstScore ? firstScore.id : this.state.files[0].id;
        }

        // Start loading Pyodide in the background when first file is added
        if (this.state.files.length > 0 && !this.state.workerReady) {
            this.workerBridge.initialize().then(() => {
                this.state.workerReady = true;
            }).catch((error) => {
                console.warn('Worker initialization deferred:', error);
            });
        }

        this.rerenderDropZone();
    }

    private handleReferenceChanged(fileId: string): void {
        this.state.referenceFileId = fileId;
    }

    private handleMethodChanged(method: AlignmentMethodId): void {
        this.state.alignmentMethod = method;
    }

    private handleFileRemoved(fileId: string): void {
        this.state.files = this.state.files.filter(function(f) { return f.id !== fileId; });

        if (this.state.referenceFileId === fileId) {
            if (this.state.files.length > 0) {
                const firstScore = this.state.files.find(function(f) { return f.type === 'musicxml'; });
                this.state.referenceFileId = firstScore ? firstScore.id : this.state.files[0].id;
            } else {
                this.state.referenceFileId = null;
            }
        }

        this.rerenderDropZone();
    }

    private async handleComputeClicked(): Promise<void> {
        if (this.state.files.length < 2 || !this.state.referenceFileId || this.destroyed) {
            return;
        }

        this.state.computationStatus = 'initializing';
        this.state.computationError = null;
        this.rerenderDropZone();

        try {
            // Ensure worker is ready
            await this.workerBridge.initialize();
            this.state.workerReady = true;

            this.state.computationStatus = 'computing';
            this.rerenderDropZone();

            const csv = await this.workerBridge.computeAlignment(
                this.state.files,
                this.state.referenceFileId,
                this.state.alignmentMethod
            );

            this.state.alignmentCsv = csv;
            this.state.computationStatus = 'done';

            // Transition to player phase
            this.buildAndMountPlayer();
        } catch (error) {
            this.state.computationStatus = 'error';
            this.state.computationError = error instanceof Error ? error.message : String(error);
            this.rerenderDropZone();
        }
    }

    private rerenderDropZone(): void {
        if (this.destroyed || !this.dropZoneContainer) {
            // Full re-render
            this.renderDropZonePhase();
            return;
        }
        // Full re-render for simplicity (the DOM is small enough)
        this.renderDropZonePhase();
    }

    // ── Player Phase ──

    private buildAndMountPlayer(): void {
        if (this.destroyed || !this.state.alignmentCsv || !this.state.referenceFileId) {
            return;
        }

        this.rootElement.classList.remove('ts-controls-disabled');

        // Build TrackSwitchInit config from the computed alignment
        const referenceFile = this.state.files.find(
            (f) => f.id === this.state.referenceFileId
        );
        if (!referenceFile) {
            return;
        }

        const referenceColumnName = fileNameToColumnName(referenceFile.name);

        // Encode CSV as data URL for the existing alignment system
        const csvDataUrl = 'data:text/csv;base64,' + btoa(this.state.alignmentCsv);

        // Build UI array
        const uiElements: any[] = [];

        // Add sheet music for MusicXML files
        for (const file of this.state.files) {
            if (file.type === 'musicxml') {
                const xmlBlob = new Blob([file.xmlText!], { type: 'application/xml' });
                const xmlUrl = URL.createObjectURL(xmlBlob);
                uiElements.push({
                    type: 'sheetMusic',
                    src: xmlUrl,
                    renderScale: 0.65,
                    measureColumn: fileNameToMeasureColumnName(file.name),
                    followPlayback: true,
                });
            }
        }

        // Add one waveform + one trackGroup per audio file.
        // waveformSource is the global track index (sequential across all trackGroups).
        let audioTrackCount = 0;
        for (const file of this.state.files) {
            if (file.type === 'audio') {
                const audioBlob = new Blob([file.file], { type: file.file.type });
                const audioUrl = URL.createObjectURL(audioBlob);
                const columnName = fileNameToColumnName(file.name);

                uiElements.push({
                    type: 'waveform',
                    waveformSource: audioTrackCount,
                    alignedPlayhead: true,
                    showAlignmentPoints: false,
                });

                uiElements.push({
                    type: 'trackGroup',
                    trackGroup: [{
                        title: file.name,
                        sources: [{ src: audioUrl, type: file.file.type }],
                        alignment: {
                            column: columnName,
                        },
                    }],
                });

                audioTrackCount++;
            }
        }

        if (audioTrackCount === 0) {
            this.state.computationError = 'No audio tracks to play. Add at least one audio file.';
            this.state.computationStatus = 'error';
            this.renderDropZonePhase();
            return;
        }

        // Add warping matrix
        uiElements.push({
            type: 'warpingMatrix',
        });

        const playerInit = {
            features: {
                mode: 'alignment' as const,
                seekBar: true,
                timer: true,
                keyboard: true,
            },
            alignment: {
                csv: csvDataUrl,
                referenceTimeColumn: referenceColumnName,
                outOfRange: 'clamp' as const,
            },
            ui: uiElements,
        };

        // Clear and mount
        this.rootElement.innerHTML = '';

        try {
            this.innerController = createTrackSwitch(this.rootElement, playerInit);

            // Load the player
            this.innerController.load().then(() => {
                if (!this.destroyed) {
                    // Inject settings button into the player's nav bar
                    const settingsBtn = injectSettingsButton(this.rootElement);
                    if (settingsBtn) {
                        settingsBtn.addEventListener('click', this.openSettingsPanel.bind(this));
                    }
                }
            }).catch((error) => {
                console.error('Failed to load player:', error);
            });
        } catch (error) {
            console.error('Failed to create player:', error);
            this.state.computationError = 'Failed to create player: '
                + (error instanceof Error ? error.message : String(error));
            this.state.computationStatus = 'error';
            this.renderDropZonePhase();
        }
    }

    // ── Settings Panel ──

    private openSettingsPanel(): void {
        if (this.destroyed) {
            return;
        }

        const settingsState: SettingsPanelState = {
            files: [...this.state.files],
            referenceFileId: this.state.referenceFileId,
            alignmentMethod: this.state.alignmentMethod,
        };

        const panel = document.createElement('div');
        panel.innerHTML = buildSettingsPanelHtml(settingsState);
        this.settingsPanelContainer = panel.firstElementChild as HTMLElement;

        if (this.settingsPanelContainer) {
            this.rootElement.style.position = 'relative';
            this.rootElement.appendChild(this.settingsPanelContainer);

            bindSettingsPanelEvents(this.settingsPanelContainer, settingsState, {
                onApply: this.handleSettingsApply.bind(this),
                onCancel: this.closeSettingsPanel.bind(this),
                onAddFiles: this.handleSettingsAddFiles.bind(this),
            });
        }
    }

    private closeSettingsPanel(): void {
        if (this.settingsPanelContainer && this.settingsPanelContainer.parentNode) {
            this.settingsPanelContainer.parentNode.removeChild(this.settingsPanelContainer);
            this.settingsPanelContainer = null;
        }
    }

    private async handleSettingsApply(newState: SettingsPanelState): Promise<void> {
        this.closeSettingsPanel();

        const referenceChanged = newState.referenceFileId !== this.state.referenceFileId;
        const methodChanged = newState.alignmentMethod !== this.state.alignmentMethod;
        const filesChanged = newState.files.length !== this.state.files.length
            || newState.files.some(function(f, i) { return f.id !== newState.files[i]?.id; });

        this.state.files = newState.files;
        this.state.referenceFileId = newState.referenceFileId;
        this.state.alignmentMethod = newState.alignmentMethod;

        if (referenceChanged || methodChanged || filesChanged) {
            // Need to recompute alignment
            if (this.state.files.length >= 2 && this.state.referenceFileId) {
                // If player is running, save state
                const savedPosition = this.innerController
                    ? this.innerController.getState().state.position
                    : 0;

                this.state.computationStatus = 'computing';
                this.state.computationError = null;

                try {
                    const csv = await this.workerBridge.computeAlignment(
                        this.state.files,
                        this.state.referenceFileId,
                        this.state.alignmentMethod
                    );

                    this.state.alignmentCsv = csv;
                    this.state.computationStatus = 'done';

                    // Destroy and rebuild player
                    if (this.innerController) {
                        this.innerController.destroy();
                        this.innerController = null;
                    }

                    this.buildAndMountPlayer();

                    // Try to restore position
                    if (savedPosition > 0) {
                        this.restorePosition(savedPosition);
                    }
                } catch (error) {
                    this.state.computationStatus = 'error';
                    this.state.computationError = error instanceof Error ? error.message : String(error);
                }
            }
        }
    }

    private async handleSettingsAddFiles(files: File[]): Promise<void> {
        for (const file of files) {
            try {
                const interactiveFile = await processFile(file);
                this.state.files.push(interactiveFile);
            } catch (error) {
                console.warn('Failed to process file:', file.name, error);
            }
        }

        // Re-open settings panel with updated files
        this.closeSettingsPanel();
        this.openSettingsPanel();
    }

    private restorePosition(position: number): void {
        if (this.innerController) {
            this.innerController.on('loaded', () => {
                if (this.innerController) {
                    this.innerController.seekTo(position);
                }
            });
        }
    }

    // ── Worker Progress ──

    private onWorkerProgress(message: string): void {
        // Update status display if in computing state
        if (this.state.computationStatus === 'initializing' || this.state.computationStatus === 'computing') {
            // Parse percentage from "[XX%] description" format
            const match = message.match(/^\[(\d+)%\]\s*(.*)/);
            const displayText = match ? match[2] : message;
            const percentage = match ? parseInt(match[1], 10) : -1;

            const statusEl = this.rootElement.querySelector('.ts-compute-status');
            if (statusEl) {
                statusEl.textContent = displayText;
            }
            const overlayText = this.rootElement.querySelector('.ts-computing-overlay span:last-child');
            if (overlayText) {
                overlayText.textContent = displayText;
            }

            // Update progress bar
            if (percentage >= 0) {
                const progressFill = this.rootElement.querySelector('.ts-progress-fill') as HTMLElement;
                if (progressFill) {
                    progressFill.style.width = percentage + '%';
                }
            }
        }
    }
}
