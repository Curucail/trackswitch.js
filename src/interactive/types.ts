import type { TrackSwitchController } from '../domain/types';

export type InteractiveFileType = 'audio' | 'musicxml';

export type AlignmentMethodId = 'dtw' | 'mrmsdtw';

export interface InteractiveFile {
    id: string;
    name: string;
    type: InteractiveFileType;
    file: File;
    /** Decoded and resampled mono PCM at SAMPLE_RATE (audio files only). */
    pcmData?: Float32Array;
    /** Decoded full-fidelity PCM per channel at the original sample rate (audio files only). */
    fullPcmChannels?: Float32Array[];
    /** Original sample rate of the decoded audio file (audio files only). */
    sampleRate?: number;
    /** Raw MusicXML text (musicxml files only). */
    xmlText?: string;
    /** Duration in seconds (audio files only, set after decoding). */
    duration?: number;
}

export interface InteractiveSynchronizedAudio {
    fileId: string;
    objectUrl: string;
    mimeType: string;
}

export interface InteractiveAlignmentResult {
    csv: string;
    syncReferenceTimeColumn: string | null;
    synchronizedAudio: InteractiveSynchronizedAudio[];
}

export interface InteractiveState {
    files: InteractiveFile[];
    referenceFileId: string | null;
    alignmentMethod: AlignmentMethodId;
    syncGenerationEnabled: boolean;
    waveformAlignedPlayhead: boolean;
    waveformShowAlignmentPoints: boolean;
    computationStatus: 'idle' | 'initializing' | 'computing' | 'done' | 'error';
    computationError: string | null;
    alignmentResult: InteractiveAlignmentResult | null;
    alignmentCacheKey: string | null;
    canCancelBackToPlayer: boolean;
    workerReady: boolean;
}

export interface InteractiveTrackSwitchInit {
    /** URL to the alignment worker script. Defaults to relative `trackswitch-alignment-worker.js`. */
    workerUrl?: string;
    /** Pyodide CDN index URL override. */
    pyodideCdnUrl?: string;
    /** Default alignment method. */
    alignmentMethod?: AlignmentMethodId;
}

export interface InteractiveTrackSwitchController {
    /** Initialize the interactive player (renders drop zone + disabled nav bar). */
    initialize(): void;
    /** Destroy the interactive player and clean up. */
    destroy(): void;
    /** Get the inner standard TrackSwitchController (available after alignment is computed). */
    getInnerController(): TrackSwitchController | null;
}

// ─── Worker protocol ────────────────────────────────────────────────

export interface WorkerFileAudio {
    id: string;
    name: string;
    type: 'audio';
    pcmData: Float32Array;
    fullPcmChannels: Float32Array[];
    sampleRate: number;
}

export interface WorkerFileScore {
    id: string;
    name: string;
    type: 'musicxml';
    xmlText: string;
}

export type WorkerFile = WorkerFileAudio | WorkerFileScore;

export interface WorkerInitMessage {
    type: 'init';
    pyodideCdnUrl: string;
}

export interface WorkerComputeMessage {
    type: 'compute';
    files: WorkerFile[];
    referenceFileId: string;
    method: AlignmentMethodId;
    featureRate: number;
    generateSyncedAudio: boolean;
}

export interface WorkerInstallMusic21Message {
    type: 'install_music21';
}

export type WorkerMessage = WorkerInitMessage | WorkerComputeMessage | WorkerInstallMusic21Message;

export interface WorkerReadyResponse {
    type: 'ready';
}

export interface WorkerMusic21InstalledResponse {
    type: 'music21_installed';
}

export interface WorkerResultResponse {
    type: 'result';
    result: WorkerComputeResult;
}

export interface WorkerErrorResponse {
    type: 'error';
    message: string;
}

export interface WorkerProgressResponse {
    type: 'progress';
    message: string;
}

export type WorkerResponse =
    | WorkerReadyResponse
    | WorkerMusic21InstalledResponse
    | WorkerResultResponse
    | WorkerErrorResponse
    | WorkerProgressResponse;

export interface WorkerSynchronizedAudioResult {
    fileId: string;
    wavData: ArrayBuffer;
    mimeType: string;
}

export interface WorkerComputeResult {
    csv: string;
    syncReferenceTimeColumn: string | null;
    synchronizedAudio: WorkerSynchronizedAudioResult[];
}
