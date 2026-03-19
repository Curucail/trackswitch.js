import { BasicPitch } from '@spotify/basic-pitch';
import { FEATURE_RATE } from './constants';
import type { BasicPitchFeatureMatrix, BasicPitchFeatureSet, InteractiveFile } from './types';

const BASIC_PITCH_MODEL_RELATIVE_URL = './basic-pitch/model.json';
const BASIC_PITCH_FEATURE_RATE = Math.floor(22050 / 256);
const interactiveScriptPattern = /trackswitch-interactive(?:\.min)?\.js(?:\?.*)?$/;

const basicPitchInstanceByModelUrl = new Map<string, Promise<BasicPitch>>();

export interface BasicPitchExtractionProgress {
    progress: number;
    message: string;
}

function createFeatureMatrix(rows: number[][], label: string): BasicPitchFeatureMatrix {
    if (rows.length === 0) {
        return {
            data: new Float32Array(0),
            frameCount: 0,
            binCount: 0,
        };
    }

    const binCount = rows[0].length;
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
        if (rows[rowIndex].length !== binCount) {
            throw new Error('Basic Pitch returned inconsistent ' + label + ' row widths.');
        }
    }

    const data = new Float32Array(rows.length * binCount);
    rows.forEach(function(row, rowIndex) {
        data.set(row, rowIndex * binCount);
    });

    return {
        data: data,
        frameCount: rows.length,
        binCount: binCount,
    };
}

function cloneFeatureMatrix(matrix: BasicPitchFeatureMatrix): BasicPitchFeatureMatrix {
    return {
        data: new Float32Array(matrix.data),
        frameCount: matrix.frameCount,
        binCount: matrix.binCount,
    };
}

function resampleFeatureMatrix(
    matrix: BasicPitchFeatureMatrix,
    sourceFrameRate: number,
    targetFrameRate: number
): BasicPitchFeatureMatrix {
    if (
        matrix.frameCount === 0
        || matrix.binCount === 0
        || sourceFrameRate <= 0
        || targetFrameRate <= 0
        || sourceFrameRate === targetFrameRate
    ) {
        return matrix;
    }

    const targetFrameCount = Math.max(1, Math.round((matrix.frameCount / sourceFrameRate) * targetFrameRate));
    if (targetFrameCount === matrix.frameCount) {
        return matrix;
    }

    const resampledData = new Float32Array(targetFrameCount * matrix.binCount);
    const sourceData = matrix.data;
    const frameScale = sourceFrameRate / targetFrameRate;

    for (let targetFrameIndex = 0; targetFrameIndex < targetFrameCount; targetFrameIndex += 1) {
        const sourcePosition = targetFrameIndex * frameScale;
        const sourceFrameIndex = Math.min(Math.floor(sourcePosition), matrix.frameCount - 1);
        const nextSourceFrameIndex = Math.min(sourceFrameIndex + 1, matrix.frameCount - 1);
        const interpolation = Math.min(Math.max(sourcePosition - sourceFrameIndex, 0), 1);

        for (let binIndex = 0; binIndex < matrix.binCount; binIndex += 1) {
            const currentValue = sourceData[sourceFrameIndex * matrix.binCount + binIndex];
            const nextValue = sourceData[nextSourceFrameIndex * matrix.binCount + binIndex];
            resampledData[targetFrameIndex * matrix.binCount + binIndex] =
                currentValue + ((nextValue - currentValue) * interpolation);
        }
    }

    return {
        data: resampledData,
        frameCount: targetFrameCount,
        binCount: matrix.binCount,
    };
}

export function cloneBasicPitchFeatureSet(features: BasicPitchFeatureSet): BasicPitchFeatureSet {
    return {
        frames: cloneFeatureMatrix(features.frames),
        contours: cloneFeatureMatrix(features.contours),
    };
}

function resolveInteractiveScriptUrl(): string | null {
    if (typeof document === 'undefined') {
        return null;
    }

    const scriptElements = Array.from(document.querySelectorAll('script[src]'));
    for (let index = scriptElements.length - 1; index >= 0; index -= 1) {
        const scriptElement = scriptElements[index];
        if (!(scriptElement instanceof HTMLScriptElement) || !scriptElement.src) {
            continue;
        }
        if (interactiveScriptPattern.test(scriptElement.src)) {
            return scriptElement.src;
        }
    }

    return null;
}

export function resolveBasicPitchModelUrl(workerUrl?: string): string {
    const baseUrl = workerUrl || resolveInteractiveScriptUrl();
    if (baseUrl) {
        return new URL(BASIC_PITCH_MODEL_RELATIVE_URL, new URL(baseUrl, window.location.href)).href;
    }

    return new URL(BASIC_PITCH_MODEL_RELATIVE_URL, window.location.href).href;
}

function getBasicPitchInstance(modelUrl: string): Promise<BasicPitch> {
    const existing = basicPitchInstanceByModelUrl.get(modelUrl);
    if (existing) {
        return existing;
    }

    const created = Promise.resolve(new BasicPitch(modelUrl));
    basicPitchInstanceByModelUrl.set(modelUrl, created);
    return created;
}

export async function ensureBasicPitchFeatures(
    file: InteractiveFile,
    modelUrl: string,
    onProgress?: (progress: BasicPitchExtractionProgress) => void
): Promise<BasicPitchFeatureSet> {
    if (file.type !== 'audio' || !file.pcmData) {
        throw new Error('Basic Pitch feature extraction requires an audio file with decoded PCM data.');
    }

    if (file.basicPitchFeatures) {
        return file.basicPitchFeatures;
    }

    onProgress?.({
        progress: 0,
        message: 'Loading Basic Pitch model',
    });

    const basicPitch = await getBasicPitchInstance(modelUrl);
    const frames: number[][] = [];
    const contours: number[][] = [];

    onProgress?.({
        progress: 0,
        message: 'Running Basic Pitch inference',
    });

    await basicPitch.evaluateModel(
        file.pcmData,
        function(nextFrames, _nextOnsets, nextContours) {
            frames.push(...nextFrames);
            contours.push(...nextContours);
        },
        function(progress) {
            onProgress?.({
                progress: progress,
                message: 'Running Basic Pitch inference',
            });
        }
    );

    const features = {
        frames: resampleFeatureMatrix(
            createFeatureMatrix(frames, 'frame'),
            BASIC_PITCH_FEATURE_RATE,
            FEATURE_RATE
        ),
        contours: resampleFeatureMatrix(
            createFeatureMatrix(contours, 'contour'),
            BASIC_PITCH_FEATURE_RATE,
            FEATURE_RATE
        ),
    };

    file.basicPitchFeatures = features;

    onProgress?.({
        progress: 1,
        message: 'Basic Pitch features ready',
    });

    return features;
}
