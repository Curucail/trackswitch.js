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
    /** Raw MusicXML text (musicxml files only). */
    xmlText?: string;
    /** Duration in seconds (audio files only, set after decoding). */
    duration?: number;
}

export interface InteractiveState {
    files: InteractiveFile[];
    referenceFileId: string | null;
    alignmentMethod: AlignmentMethodId;
    waveformAlignedPlayhead: boolean;
    waveformShowAlignmentPoints: boolean;
    computationStatus: 'idle' | 'initializing' | 'computing' | 'done' | 'error';
    computationError: string | null;
    alignmentCsv: string | null;
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
    csv: string;
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
