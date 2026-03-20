import type {
    InteractiveAlignmentResult,
    InteractiveFile,
    InteractiveState,
    InteractiveTrackSwitchController,
    InteractiveTrackSwitchInit,
    AlignmentAlgorithmId,
    AlignmentFeatureSetId,
    WorkerComputeResult,
} from './types';
import type { TrackSwitchController } from '../domain/types';
import { ensureBasicPitchFeatures, resolveBasicPitchModelUrl } from './basic-pitch';
import {
    coerceAlignmentSelectionForAlgorithm,
    coerceAlignmentSelectionForFeatureSet,
    normalizeAlignmentSelection,
} from './alignment-options';
import {
    processFile,
    fileNameToColumnName,
    fileNameToDisplayTitle,
    fileNameToMeasureColumnName,
} from './file-handler';
import { AlignmentWorkerBridge } from './worker/alignment-worker-bridge';
import {
    buildFullDropZonePanel,
    bindDropZoneEvents,
    type DropZoneEvents,
} from './ui/render-dropzone';
import { buildPlayerSettingsMenuHtml } from './ui/render-player-settings';
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
    private settingsMenuContainer: HTMLElement | null = null;
    private settingsMenuDismissHandler: ((event: MouseEvent) => void) | null = null;
    private playerSetupSnapshot: {
        files: InteractiveFile[];
        referenceFileId: string | null;
        featureSet: AlignmentFeatureSetId;
        algorithm: AlignmentAlgorithmId;
        syncGenerationEnabled: boolean;
        alignmentResult: InteractiveAlignmentResult | null;
        alignmentCacheKey: string | null;
        playbackPosition: number;
        wasPlaying: boolean;
    } | null = null;

    constructor(rootElement: HTMLElement, init: InteractiveTrackSwitchInit) {
        this.rootElement = rootElement;
        this.init = init;
        const initialAlignmentSelection = normalizeAlignmentSelection(init);
        this.state = {
            files: [],
            referenceFileId: null,
            featureSet: initialAlignmentSelection.featureSet,
            algorithm: initialAlignmentSelection.algorithm,
            syncGenerationEnabled: false,
            waveformAlignedPlayhead: true,
            waveformShowAlignmentPoints: false,
            computationStatus: 'idle',
            computationError: null,
            alignmentResult: null,
            alignmentCacheKey: null,
            canCancelBackToPlayer: false,
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
        this.closePlayerSettingsMenu();
        this.replaceAlignmentResult(null);
        if (this.innerController) {
            this.innerController.destroy();
            this.innerController = null;
        }
        this.rootElement.innerHTML = '';
        this.rootElement.classList.remove('trackswitch', 'ts-controls-disabled', 'ts-interactive-player');
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

        this.rootElement.classList.remove('ts-interactive-player');
        let html = this.buildDisabledNavBarHtml();
        html += buildFullDropZonePanel(
            this.state.files,
            this.state.referenceFileId,
            canCompute,
            statusMessage,
            isComputing,
            computingMessage,
            this.state.featureSet,
            this.state.algorithm,
            this.state.canCancelBackToPlayer,
            this.state.syncGenerationEnabled
        );

        this.rootElement.innerHTML = html;
        this.rootElement.classList.add('ts-controls-disabled');

        // Bind drop zone events
        const panel = this.rootElement.querySelector('.ts-interactive-panel') as HTMLElement;
        if (panel) {
            this.dropZoneContainer = panel;
            bindDropZoneEvents(panel, this.createDropZoneEvents());
        }

    }

    private buildDisabledNavBarHtml(): string {
        let html = '<div class="main-control ts-stack-section">'
            + '<ul class="control">'
            + '<li class="playback-group">'
            + '<ul class="playback-controls">'
            + '<li class="playpause button" title="Play/Pause">Play'
            + renderIconSlotHtml('play')
            + '</li>'
            + '<li class="stop button" title="Stop">Stop'
            + renderIconSlotHtml('stop')
            + '</li>'
            + '</ul>'
            + '</li>'
            + '<li class="timing"><span class="time">--:--:--:---</span> / <span class="length">--:--:--:---</span></li>'
            + '<li class="seekwrap">'
            + '<div class="seekbar">'
            + '<div class="seekhead"></div>'
            + '</div>'
            + '</li>';

        html += '</ul>'
            + '</div>';

        return html;
    }

    private createDropZoneEvents(): DropZoneEvents {
        return {
            onFilesAdded: this.handleFilesAdded.bind(this),
            onReferenceChanged: this.handleReferenceChanged.bind(this),
            onFileRemoved: this.handleFileRemoved.bind(this),
            onFeatureSetChanged: this.handleFeatureSetChanged.bind(this),
            onAlgorithmChanged: this.handleAlgorithmChanged.bind(this),
            onSyncGenerationChanged: this.handleSyncGenerationChanged.bind(this),
            onCancelClicked: this.handleSetupCancelClicked.bind(this),
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
        this.rerenderDropZone();
    }

    private handleFeatureSetChanged(featureSet: AlignmentFeatureSetId): void {
        const nextSelection = coerceAlignmentSelectionForFeatureSet(featureSet, this.state.algorithm);
        this.state.featureSet = nextSelection.featureSet;
        this.state.algorithm = nextSelection.algorithm;
        this.rerenderDropZone();
    }

    private handleAlgorithmChanged(algorithm: AlignmentAlgorithmId): void {
        const nextSelection = coerceAlignmentSelectionForAlgorithm(this.state.featureSet, algorithm);
        this.state.featureSet = nextSelection.featureSet;
        this.state.algorithm = nextSelection.algorithm;
        this.rerenderDropZone();
    }

    private handleSyncGenerationChanged(enabled: boolean): void {
        this.state.syncGenerationEnabled = enabled;
        this.rerenderDropZone();
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

        const alignmentCacheKey = this.buildAlignmentCacheKey();
        if (this.state.alignmentResult && this.state.alignmentCacheKey === alignmentCacheKey) {
            this.state.computationStatus = 'done';
            this.state.computationError = null;
            this.buildAndMountPlayer();
            return;
        }

        this.state.computationStatus = 'initializing';
        this.state.computationError = null;
        this.rerenderDropZone();

        try {
            if (this.state.featureSet === 'basic_pitch') {
                await this.ensureBasicPitchFeaturesForAlignment();
            }

            // Ensure worker is ready
            await this.workerBridge.initialize();
            this.state.workerReady = true;

            this.state.computationStatus = 'computing';
            this.rerenderDropZone();

            const result = await this.workerBridge.computeAlignment(
                this.state.files,
                this.state.referenceFileId,
                this.state.featureSet,
                this.state.algorithm,
                this.state.syncGenerationEnabled
            );

            this.replaceAlignmentResult(this.createAlignmentResult(result));
            this.state.alignmentCacheKey = alignmentCacheKey;
            this.state.canCancelBackToPlayer = false;
            this.state.computationStatus = 'done';

            // Transition to player phase
            this.buildAndMountPlayer();
        } catch (error) {
            this.state.computationStatus = 'error';
            this.state.computationError = error instanceof Error ? error.message : String(error);
            this.rerenderDropZone();
        }
    }

    private async ensureBasicPitchFeaturesForAlignment(): Promise<void> {
        const audioFiles = this.state.files.filter(function(file) {
            return file.type === 'audio';
        });

        if (audioFiles.length === 0) {
            return;
        }

        const modelUrl = resolveBasicPitchModelUrl(this.init.workerUrl);
        const total = audioFiles.length;

        for (let index = 0; index < total; index += 1) {
            const file = audioFiles[index];
            const fileLabel = 'Basic Pitch ' + (index + 1) + '/' + total + ': ' + file.name;

            await ensureBasicPitchFeatures(
                file,
                modelUrl,
                (progress) => {
                    const percentage = Number.isFinite(progress.progress)
                        ? Math.max(0, Math.min(100, Math.round(progress.progress * 100)))
                        : null;
                    const prefix = percentage === null ? fileLabel : fileLabel + ' (' + percentage + '%)';
                    this.onWorkerProgress(prefix + ' - ' + progress.message);
                }
            );
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

    private buildAndMountPlayer(restorePlayback?: { position: number; playing: boolean }): void {
        if (this.destroyed || !this.state.alignmentResult || !this.state.referenceFileId) {
            return;
        }

        this.rootElement.classList.remove('ts-controls-disabled');
        this.closePlayerSettingsMenu();

        // Build TrackSwitchInit config from the computed alignment
        const referenceFile = this.state.files.find(
            (f) => f.id === this.state.referenceFileId
        );
        if (!referenceFile) {
            return;
        }

        const referenceColumnName = fileNameToColumnName(referenceFile.name);
        const warpingMatrixBpm = referenceFile.type === 'musicxml' ? 'infer_score' : null;

        // Encode CSV as data URL for the existing alignment system
        const csvDataUrl = 'data:text/csv;base64,' + btoa(this.state.alignmentResult.csv);
        const synchronizedAudioByFileId = new Map(
            this.state.alignmentResult.synchronizedAudio.map(function(entry) {
                return [entry.fileId, entry];
            })
        );

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
                    alignedPlayhead: this.state.waveformAlignedPlayhead,
                    showAlignmentPoints: this.state.waveformShowAlignmentPoints,
                });

                uiElements.push({
                    type: 'trackGroup',
                    trackGroup: [{
                        title: fileNameToDisplayTitle(file.name),
                        sources: [{ src: audioUrl, type: file.file.type }],
                        alignment: {
                            column: columnName,
                            synchronizedSources: this.buildSynchronizedSourcesForFile(
                                file,
                                audioUrl,
                                synchronizedAudioByFileId
                            ),
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
            bpm: warpingMatrixBpm,
        });

        const playerInit = {
            features: {
                mode: 'alignment' as const,
                seekBar: true,
                timer: true,
                keyboard: true,
                globalVolume: true,
                trackMixControls: true,
                looping: true,
            },
            alignment: {
                csv: csvDataUrl,
                referenceTimeColumn: referenceColumnName,
                referenceTimeColumnSync: this.state.alignmentResult.syncReferenceTimeColumn || undefined,
                outOfRange: 'clamp' as const,
            },
            ui: uiElements,
        };

        // Clear and mount
        this.rootElement.innerHTML = '';
        this.rootElement.classList.add('ts-interactive-player');

        try {
            this.innerController = createTrackSwitch(this.rootElement, playerInit);

            // Load the player
            this.innerController.load().then(() => {
                if (!this.destroyed) {
                    // Inject the settings button into the player's nav bar
                    const settingsBtn = injectSettingsButton(this.rootElement);
                    if (settingsBtn) {
                        settingsBtn.addEventListener('click', this.togglePlayerSettingsMenu.bind(this));
                    }

                    if (restorePlayback) {
                        if (restorePlayback.position > 0) {
                            this.innerController?.seekTo(restorePlayback.position);
                        }
                        if (restorePlayback.playing) {
                            this.innerController?.play();
                        }
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

    // ── Return To Setup ──

    private returnToSetupPhase(): void {
        if (this.destroyed) {
            return;
        }

        const playerSnapshot = this.innerController ? this.innerController.getState() : null;

        this.playerSetupSnapshot = {
            files: [...this.state.files],
            referenceFileId: this.state.referenceFileId,
            featureSet: this.state.featureSet,
            algorithm: this.state.algorithm,
            syncGenerationEnabled: this.state.syncGenerationEnabled,
            alignmentResult: this.state.alignmentResult,
            alignmentCacheKey: this.state.alignmentCacheKey,
            playbackPosition: playerSnapshot ? playerSnapshot.state.position : 0,
            wasPlaying: playerSnapshot ? playerSnapshot.state.playing : false,
        };

        if (this.innerController) {
            this.innerController.destroy();
            this.innerController = null;
        }

        this.state.computationStatus = 'idle';
        this.state.computationError = null;
        this.state.canCancelBackToPlayer = true;
        this.rootElement.classList.remove('ts-interactive-player');
        this.renderDropZonePhase();
    }

    private handleSetupCancelClicked(): void {
        if (this.destroyed || !this.playerSetupSnapshot) {
            return;
        }

        this.state.files = [...this.playerSetupSnapshot.files];
        this.state.referenceFileId = this.playerSetupSnapshot.referenceFileId;
        this.state.featureSet = this.playerSetupSnapshot.featureSet;
        this.state.algorithm = this.playerSetupSnapshot.algorithm;
        this.state.syncGenerationEnabled = this.playerSetupSnapshot.syncGenerationEnabled;
        this.state.alignmentResult = this.playerSetupSnapshot.alignmentResult;
        this.state.alignmentCacheKey = this.playerSetupSnapshot.alignmentCacheKey;
        this.state.canCancelBackToPlayer = false;
        this.state.computationStatus = 'done';
        this.state.computationError = null;
        this.buildAndMountPlayer({
            position: this.playerSetupSnapshot.playbackPosition,
            playing: this.playerSetupSnapshot.wasPlaying,
        });
    }

    private togglePlayerSettingsMenu(): void {
        if (this.destroyed) {
            return;
        }

        if (this.settingsMenuContainer) {
            this.closePlayerSettingsMenu();
            return;
        }

        const settingsBtn = this.rootElement.querySelector('.settings-button');
        if (!(settingsBtn instanceof HTMLElement)) {
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildPlayerSettingsMenuHtml({
            waveformAlignedPlayhead: this.state.waveformAlignedPlayhead,
            waveformShowAlignmentPoints: this.state.waveformShowAlignmentPoints,
        });

        const menu = wrapper.firstElementChild as HTMLElement | null;
        if (!menu) {
            return;
        }

        this.rootElement.style.position = 'relative';
        this.rootElement.appendChild(menu);
        this.settingsMenuContainer = menu;

        const buttonRect = settingsBtn.getBoundingClientRect();
        const rootRect = this.rootElement.getBoundingClientRect();
        menu.style.top = String(Math.round(buttonRect.bottom - rootRect.top + 8)) + 'px';
        menu.style.right = String(Math.max(12, Math.round(rootRect.right - buttonRect.right))) + 'px';

        const alignedPlayheadInput = menu.querySelector('[data-setting-id="aligned-playhead"]') as HTMLInputElement | null;
        if (alignedPlayheadInput) {
            alignedPlayheadInput.addEventListener('change', () => {
                this.applyWaveformDisplaySettings(
                    alignedPlayheadInput.checked,
                    this.state.waveformShowAlignmentPoints
                );
            });
        }

        const alignmentPointsInput = menu.querySelector('[data-setting-id="show-alignment-points"]') as HTMLInputElement | null;
        if (alignmentPointsInput) {
            alignmentPointsInput.addEventListener('change', () => {
                this.applyWaveformDisplaySettings(
                    this.state.waveformAlignedPlayhead,
                    alignmentPointsInput.checked
                );
            });
        }

        const alignmentSetupBtn = menu.querySelector('[data-settings-action="alignment-setup"]') as HTMLButtonElement | null;
        if (alignmentSetupBtn) {
            alignmentSetupBtn.addEventListener('click', () => {
                this.closePlayerSettingsMenu();
                this.returnToSetupPhase();
            });
        }

        const exportCsvBtn = menu.querySelector('[data-settings-action="export-csv"]') as HTMLButtonElement | null;
        if (exportCsvBtn) {
            exportCsvBtn.addEventListener('click', () => {
                this.exportAlignmentCsv();
            });
        }

        this.settingsMenuDismissHandler = (event: MouseEvent) => {
            if (!this.settingsMenuContainer) {
                return;
            }

            const target = event.target as Node | null;
            if (!target) {
                return;
            }

            if (
                this.settingsMenuContainer.contains(target)
                || settingsBtn.contains(target)
            ) {
                return;
            }

            this.closePlayerSettingsMenu();
        };

        requestAnimationFrame(() => {
            if (this.settingsMenuDismissHandler) {
                document.addEventListener('mousedown', this.settingsMenuDismissHandler, true);
            }
        });
    }

    private closePlayerSettingsMenu(): void {
        if (this.settingsMenuDismissHandler) {
            document.removeEventListener('mousedown', this.settingsMenuDismissHandler, true);
            this.settingsMenuDismissHandler = null;
        }

        if (this.settingsMenuContainer && this.settingsMenuContainer.parentNode) {
            this.settingsMenuContainer.parentNode.removeChild(this.settingsMenuContainer);
        }

        this.settingsMenuContainer = null;
    }

    private applyWaveformDisplaySettings(
        waveformAlignedPlayhead: boolean,
        waveformShowAlignmentPoints: boolean
    ): void {
        if (!this.innerController || !this.state.alignmentResult || this.destroyed) {
            return;
        }

        const snapshot = this.innerController.getState();
        this.state.waveformAlignedPlayhead = waveformAlignedPlayhead;
        this.state.waveformShowAlignmentPoints = waveformShowAlignmentPoints;

        this.innerController.destroy();
        this.innerController = null;
        this.buildAndMountPlayer({
            position: snapshot.state.position,
            playing: snapshot.state.playing,
        });
    }

    private exportAlignmentCsv(): void {
        if (!this.state.alignmentResult || this.destroyed) {
            return;
        }

        const csvBlob = new Blob([this.state.alignmentResult.csv], {
            type: 'text/csv;charset=utf-8',
        });
        const downloadUrl = URL.createObjectURL(csvBlob);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = 'alignment.csv';
        downloadLink.style.display = 'none';
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        URL.revokeObjectURL(downloadUrl);
    }

    private buildAlignmentCacheKey(): string {
        const fileIds = this.state.files.map(function(file) {
            return file.id;
        }).join('|');

        return [
            fileIds,
            this.state.referenceFileId || '',
            this.state.featureSet,
            this.state.algorithm,
            this.state.syncGenerationEnabled ? 'sync' : 'base',
        ].join('::');
    }

    private buildSynchronizedSourcesForFile(
        file: InteractiveFile,
        baseAudioUrl: string,
        synchronizedAudioByFileId: Map<string, { objectUrl: string; mimeType: string }>
    ): Array<{ src: string; type: string }> | undefined {
        if (!this.state.alignmentResult?.syncReferenceTimeColumn) {
            return undefined;
        }

        if (file.id === this.state.referenceFileId) {
            return [{ src: baseAudioUrl, type: file.file.type || 'audio/wav' }];
        }

        const synchronizedAudio = synchronizedAudioByFileId.get(file.id);
        if (!synchronizedAudio) {
            return undefined;
        }

        return [{ src: synchronizedAudio.objectUrl, type: synchronizedAudio.mimeType }];
    }

    private createAlignmentResult(result: WorkerComputeResult): InteractiveAlignmentResult {
        return {
            csv: result.csv,
            syncReferenceTimeColumn: result.syncReferenceTimeColumn,
            synchronizedAudio: result.synchronizedAudio.map(function(entry) {
                const mimeType = entry.mimeType || 'audio/wav';
                return {
                    fileId: entry.fileId,
                    objectUrl: URL.createObjectURL(new Blob([entry.wavData], { type: mimeType })),
                    mimeType: mimeType,
                };
            }),
        };
    }

    private replaceAlignmentResult(nextResult: InteractiveAlignmentResult | null): void {
        if (this.state.alignmentResult) {
            this.revokeSynchronizedAudioUrls(this.state.alignmentResult);
        }

        this.state.alignmentResult = nextResult;
    }

    private revokeSynchronizedAudioUrls(result: InteractiveAlignmentResult): void {
        result.synchronizedAudio.forEach(function(entry) {
            URL.revokeObjectURL(entry.objectUrl);
        });
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
            const overlayText = this.rootElement.querySelector('.ts-computing-message');
            if (overlayText) {
                overlayText.textContent = displayText;
            }

            // Update progress bar
            const progressPercent = this.rootElement.querySelector('.ts-progress-percent');
            if (progressPercent) {
                progressPercent.textContent = percentage >= 0 ? percentage + '%' : '--%';
            }

            if (percentage >= 0) {
                const progressFill = this.rootElement.querySelector('.ts-progress-fill') as HTMLElement;
                if (progressFill) {
                    progressFill.style.width = percentage + '%';
                }
            }
        }
    }
}
