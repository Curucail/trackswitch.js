import type {
    AlignmentMethodId,
    BasicPitchFeatureMatrix,
    BasicPitchFeatureSet,
    InteractiveFile,
    WorkerComputeMessage,
    WorkerComputeResult,
    WorkerFile,
    WorkerFileAudio,
    WorkerFileScore,
    WorkerResponse,
} from '../types';
import { FEATURE_RATE, PYODIDE_CDN_URL, DEFAULT_WORKER_URL } from '../constants';
import { cloneBasicPitchFeatureSet } from '../basic-pitch';

type ProgressCallback = (message: string) => void;

export class AlignmentWorkerBridge {
    private worker: Worker | null = null;
    private workerUrl: string;
    private pyodideCdnUrl: string;
    private ready = false;
    private music21Installed = false;
    private initPromise: Promise<void> | null = null;
    private onProgress: ProgressCallback | null = null;

    constructor(workerUrl?: string, pyodideCdnUrl?: string) {
        this.workerUrl = workerUrl || DEFAULT_WORKER_URL;
        this.pyodideCdnUrl = pyodideCdnUrl || PYODIDE_CDN_URL;
    }

    setProgressCallback(callback: ProgressCallback | null): void {
        this.onProgress = callback;
    }

    initialize(): Promise<void> {
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = new Promise((resolve, reject) => {
            try {
                this.worker = new Worker(this.workerUrl);
            } catch (_e) {
                reject(new Error('Failed to create alignment worker. Ensure the worker script is available at: ' + this.workerUrl));
                return;
            }

            const onMessage = (event: MessageEvent<WorkerResponse>) => {
                const response = event.data;
                if (response.type === 'ready') {
                    this.ready = true;
                    this.worker!.removeEventListener('message', onMessage);
                    resolve();
                } else if (response.type === 'error') {
                    reject(new Error(response.message));
                } else if (response.type === 'progress' && this.onProgress) {
                    this.onProgress(response.message);
                }
            };

            this.worker.addEventListener('message', onMessage);
            this.worker.addEventListener('error', (event) => {
                reject(new Error('Worker error: ' + (event.message || 'unknown')));
            });

            this.worker.postMessage({
                type: 'init',
                pyodideCdnUrl: this.pyodideCdnUrl,
            });
        });

        return this.initPromise;
    }

    async installMusic21(): Promise<void> {
        if (this.music21Installed) {
            return;
        }
        await this.ensureReady();

        return new Promise((resolve, reject) => {
            const onMessage = (event: MessageEvent<WorkerResponse>) => {
                const response = event.data;
                if (response.type === 'music21_installed') {
                    this.music21Installed = true;
                    this.worker!.removeEventListener('message', onMessage);
                    resolve();
                } else if (response.type === 'error') {
                    this.worker!.removeEventListener('message', onMessage);
                    reject(new Error(response.message));
                } else if (response.type === 'progress' && this.onProgress) {
                    this.onProgress(response.message);
                }
            };

            this.worker!.addEventListener('message', onMessage);
            this.worker!.postMessage({ type: 'install_music21' });
        });
    }

    async computeAlignment(
        files: InteractiveFile[],
        referenceFileId: string,
        method: AlignmentMethodId,
        generateSyncedAudio: boolean
    ): Promise<WorkerComputeResult> {
        await this.ensureReady();

        const hasMusicXml = files.some(function(f) { return f.type === 'musicxml'; });
        if (hasMusicXml) {
            await this.installMusic21();
        }

        const workerFiles: WorkerFile[] = files.map(function(file): WorkerFile {
            if (file.type === 'audio') {
                const pcmCopy = new Float32Array(file.pcmData!);
                const fullPcmChannels = (file.fullPcmChannels || []).map(function(channelData) {
                    return new Float32Array(channelData);
                });
                return {
                    id: file.id,
                    name: file.name,
                    type: 'audio',
                    pcmData: pcmCopy,
                    fullPcmChannels: fullPcmChannels,
                    sampleRate: file.sampleRate!,
                    basicPitchFeatures: method === 'basic_pitch' && file.basicPitchFeatures
                        ? cloneBasicPitchFeatureSet(file.basicPitchFeatures)
                        : undefined,
                } as WorkerFileAudio;
            }
            return {
                id: file.id,
                name: file.name,
                type: 'musicxml',
                xmlText: file.xmlText!,
            } as WorkerFileScore;
        });

        const transferables: Transferable[] = [];
        workerFiles.forEach(function(wf) {
            if (wf.type === 'audio') {
                transferables.push(wf.pcmData.buffer);
                wf.fullPcmChannels.forEach(function(channelData) {
                    transferables.push(channelData.buffer);
                });
                if (wf.basicPitchFeatures) {
                    transferables.push(wf.basicPitchFeatures.frames.data.buffer);
                    transferables.push(wf.basicPitchFeatures.contours.data.buffer);
                }
            }
        });

        return new Promise((resolve, reject) => {
            const onMessage = (event: MessageEvent<WorkerResponse>) => {
                const response = event.data;
                if (response.type === 'result') {
                    this.worker!.removeEventListener('message', onMessage);
                    resolve(response.result);
                } else if (response.type === 'error') {
                    this.worker!.removeEventListener('message', onMessage);
                    reject(new Error(response.message));
                } else if (response.type === 'progress' && this.onProgress) {
                    this.onProgress(response.message);
                }
            };

            this.worker!.addEventListener('message', onMessage);

            const message: WorkerComputeMessage = {
                type: 'compute',
                files: workerFiles,
                referenceFileId: referenceFileId,
                method: method,
                featureRate: FEATURE_RATE,
                generateSyncedAudio: generateSyncedAudio,
            };

            this.worker!.postMessage(message, transferables);
        });
    }

    isReady(): boolean {
        return this.ready;
    }

    destroy(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
        this.ready = false;
        this.music21Installed = false;
        this.initPromise = null;
    }

    private async ensureReady(): Promise<void> {
        if (!this.initPromise) {
            await this.initialize();
        } else {
            await this.initPromise;
        }
    }
}
