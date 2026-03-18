import type { InteractiveFile, InteractiveFileType } from './types';
import { SAMPLE_RATE } from './constants';

let idCounter = 0;

function generateFileId(): string {
    idCounter += 1;
    return 'ifile-' + idCounter + '-' + Date.now();
}

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.webm']);
const MUSICXML_EXTENSIONS = new Set(['.xml', '.musicxml', '.mxl']);

function getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.substring(dot).toLowerCase() : '';
}

export function classifyFileType(file: File): InteractiveFileType | null {
    const ext = getExtension(file.name);
    if (AUDIO_EXTENSIONS.has(ext)) {
        return 'audio';
    }
    if (MUSICXML_EXTENSIONS.has(ext)) {
        return 'musicxml';
    }
    return null;
}

export function readFileAsText(file: File): Promise<string> {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() {
            resolve(reader.result as string);
        };
        reader.onerror = function() {
            reject(new Error('Failed to read file: ' + file.name));
        };
        reader.readAsText(file);
    });
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() {
            resolve(reader.result as ArrayBuffer);
        };
        reader.onerror = function() {
            reject(new Error('Failed to read file: ' + file.name));
        };
        reader.readAsArrayBuffer(file);
    });
}

export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const audioContext = new AudioContext();
    try {
        return await audioContext.decodeAudioData(arrayBuffer);
    } finally {
        await audioContext.close();
    }
}

export async function resampleToMono(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<Float32Array> {
    const totalSamples = Math.ceil(audioBuffer.duration * targetSampleRate);
    const offline = new OfflineAudioContext(1, totalSamples, targetSampleRate);
    const source = offline.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offline.destination);
    source.start();
    const resampled = await offline.startRendering();
    return resampled.getChannelData(0);
}

export async function processAudioFile(file: File): Promise<InteractiveFile> {
    const audioBuffer = await decodeAudioFile(file);
    const pcmData = await resampleToMono(audioBuffer, SAMPLE_RATE);
    const fullPcmChannels: Float32Array[] = [];

    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
        fullPcmChannels.push(new Float32Array(audioBuffer.getChannelData(channelIndex)));
    }

    return {
        id: generateFileId(),
        name: file.name,
        type: 'audio',
        file: file,
        pcmData: pcmData,
        fullPcmChannels: fullPcmChannels,
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration,
    };
}

export async function processMusicXmlFile(file: File): Promise<InteractiveFile> {
    const xmlText = await readFileAsText(file);
    return {
        id: generateFileId(),
        name: file.name,
        type: 'musicxml',
        file: file,
        xmlText: xmlText,
    };
}

export async function processFile(file: File): Promise<InteractiveFile> {
    const fileType = classifyFileType(file);
    if (fileType === 'audio') {
        return processAudioFile(file);
    }
    if (fileType === 'musicxml') {
        return processMusicXmlFile(file);
    }
    throw new Error('Unsupported file type: ' + file.name);
}

export function stripExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot > 0 ? filename.substring(0, dot) : filename;
}

/** Keep the original filename for visible UI labels. */
export function fileNameToDisplayTitle(filename: string): string {
    return stripExtension(filename);
}

/** Sanitize a filename into a valid CSV column name. */
export function fileNameToColumnName(filename: string): string {
    return 'time_' + stripExtension(filename).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Measure column name matching the Python pipeline's naming convention. */
export function fileNameToMeasureColumnName(filename: string): string {
    return 'measure_' + stripExtension(filename).replace(/[^a-zA-Z0-9_-]/g, '_');
}
