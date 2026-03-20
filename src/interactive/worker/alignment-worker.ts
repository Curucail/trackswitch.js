/**
 * Alignment Web Worker.
 *
 * Loads Pyodide, installs shims for unavailable packages (numba, libfmp, etc.),
 * installs synctoolbox, and runs the alignment pipeline on demand.
 */
import type { WorkerComputeResult, WorkerMessage, WorkerResponse } from '../types';
import {
    NUMBA_SHIM,
    LIBFMP_SHIM,
    MISC_SHIMS,
    DTW_SPEEDUP,
    ALIGNMENT_PIPELINE,
} from './python-scripts';
import { getAlignmentMethod } from '../methods/alignment-method';
import { SAMPLE_RATE } from '../constants';

declare const self: Worker & { addEventListener: (type: string, listener: (event: MessageEvent) => void) => void; location: { href: string } };
declare function importScripts(...urls: string[]): void;

interface PyodideInterface {
    runPythonAsync(code: string): Promise<unknown>;
    loadPackage(packages: string | string[]): Promise<void>;
    globals: {
        set(key: string, value: unknown): void;
        get(key: string): unknown;
    };
    toPy(value: unknown): unknown;
}

declare function loadPyodide(options: { indexURL: string }): Promise<PyodideInterface>;

let pyodide: PyodideInterface | null = null;
let synctoolboxInstalled = false;
let music21Installed = false;

function postResponse(response: WorkerResponse): void {
    self.postMessage(response);
}

function postResult(result: WorkerComputeResult): void {
    const transferables = result.synchronizedAudio.map(function(entry) {
        return entry.wavData;
    });
    self.postMessage({ type: 'result', result: result }, transferables);
}

function postProgress(message: string): void {
    postResponse({ type: 'progress', message: message });
}

async function initializePyodide(cdnUrl: string): Promise<void> {
    // Init progress: 0% → ~15% of the overall compute pipeline.
    // If init already happened in the background, compute starts at 0% anyway.
    postProgress('[0%] Loading Pyodide runtime...');

    importScripts(cdnUrl + 'pyodide.js');
    pyodide = await loadPyodide({ indexURL: cdnUrl });

    postProgress('[3%] Loading NumPy and SciPy...');
    await pyodide.loadPackage(['numpy', 'scipy']);

    postProgress('[6%] Loading pandas and matplotlib...');
    await pyodide.loadPackage(['matplotlib', 'pandas']);

    postProgress('[9%] Loading scikit-learn...');
    await pyodide.loadPackage(['scikit-learn', 'joblib', 'micropip']);

    postProgress('[12%] Installing compatibility shims...');
    await pyodide.runPythonAsync(NUMBA_SHIM);
    await pyodide.runPythonAsync(LIBFMP_SHIM);
    await pyodide.runPythonAsync(MISC_SHIMS);

    postProgress('[14%] Installing synctoolbox...');

    // Install synctoolbox by extracting the wheel directly to site-packages.
    const workerBaseUrl = self.location.href.substring(0, self.location.href.lastIndexOf('/') + 1);
    const wheelUrl = workerBaseUrl + 'synctoolbox-1.4.2-py3-none-any.whl';
    pyodide.globals.set('_wheel_url', wheelUrl);

    await pyodide.runPythonAsync(`
import zipfile, io
from pyodide.http import pyfetch

response = await pyfetch(_wheel_url)
data = await response.bytes()
zf = zipfile.ZipFile(io.BytesIO(data))
zf.extractall('/lib/python3.12/site-packages/')
`);

    synctoolboxInstalled = true;

    postProgress('[14%] Installing libtsm...');
    const libtsmWheelUrl = workerBaseUrl + 'libtsm-1.1.2-py3-none-any.whl';
    pyodide.globals.set('_libtsm_wheel_url', libtsmWheelUrl);

    await pyodide.runPythonAsync(`
import zipfile, io
from pyodide.http import pyfetch

response = await pyfetch(_libtsm_wheel_url)
data = await response.bytes()
zf = zipfile.ZipFile(io.BytesIO(data))
zf.extractall('/lib/python3.12/site-packages/')
`);

    postProgress('[14%] Applying DTW speedup...');
    await pyodide.runPythonAsync(DTW_SPEEDUP);

    postProgress('[15%] Python environment ready');
}

async function installMusic21Impl(): Promise<void> {
    if (!pyodide || music21Installed) {
        return;
    }

    postProgress('Installing MusicXML support (music21)...');
    await pyodide.runPythonAsync(`
import micropip
# Mock music21's deps that aren't available in Pyodide.
for pkg, ver in [('chardet', '5.2.0'), ('webcolors', '1.13')]:
    micropip.add_mock_package(pkg, ver)
await micropip.install('music21')
`);
    music21Installed = true;
    postProgress('MusicXML support installed.');
}

async function computeAlignment(message: Extract<WorkerMessage, { type: 'compute' }>): Promise<WorkerComputeResult> {
    if (!pyodide || !synctoolboxInstalled) {
        throw new Error('Pyodide is not initialized.');
    }

    const { files, referenceFileId, featureSet, algorithm, featureRate, generateSyncedAudio } = message;

    // Prepare data dictionaries for Python
    const audioFiles: Record<string, Float32Array> = {};
    const fullResolutionAudioFiles: Record<string, number[][]> = {};
    const audioSampleRates: Record<string, number> = {};
    const basicPitchAudioFeatures: Record<string, {
        frames: { data: number[]; frameCount: number; binCount: number };
        contours: { data: number[]; frameCount: number; binCount: number };
    }> = {};
    const scoreFiles: Record<string, string> = {};
    const fileNames: Record<string, string> = {};

    for (const file of files) {
        fileNames[file.id] = file.name;
        if (file.type === 'audio') {
            audioFiles[file.id] = file.pcmData;
            fullResolutionAudioFiles[file.id] = file.fullPcmChannels.map(function(channelData) {
                return Array.from(channelData);
            });
            audioSampleRates[file.id] = file.sampleRate;
            if (file.basicPitchFeatures) {
                basicPitchAudioFeatures[file.id] = {
                    frames: {
                        data: Array.from(file.basicPitchFeatures.frames.data),
                        frameCount: file.basicPitchFeatures.frames.frameCount,
                        binCount: file.basicPitchFeatures.frames.binCount,
                    },
                    contours: {
                        data: Array.from(file.basicPitchFeatures.contours.data),
                        frameCount: file.basicPitchFeatures.contours.frameCount,
                        binCount: file.basicPitchFeatures.contours.binCount,
                    },
                };
            }
        } else {
            scoreFiles[file.id] = file.xmlText;
        }
    }

    // Get alignment method script
    const alignmentAlgorithm = getAlignmentMethod(algorithm);
    const methodScript = alignmentAlgorithm.getPythonScript({
        featureRate: featureRate,
        featureSet: featureSet,
    });

    postProgress('[15%] Preparing data...');

    // Set global variables in Python
    // Convert audio arrays to Python
    const audioFilesPlain: Record<string, number[]> = {};
    for (const key of Object.keys(audioFiles)) {
        audioFilesPlain[key] = Array.from(audioFiles[key]);
    }
    const pyAudioFiles = pyodide.toPy(audioFilesPlain);

    // Set ALL globals BEFORE running any Python that references them
    pyodide.globals.set('audio_files_js', pyAudioFiles);
    pyodide.globals.set('full_resolution_audio_files', pyodide.toPy(fullResolutionAudioFiles));
    pyodide.globals.set('audio_sample_rates', pyodide.toPy(audioSampleRates));
    pyodide.globals.set('basic_pitch_audio_features', pyodide.toPy(basicPitchAudioFeatures));
    pyodide.globals.set('score_files', pyodide.toPy(scoreFiles));
    pyodide.globals.set('file_names', pyodide.toPy(fileNames));
    pyodide.globals.set('reference_file_id', referenceFileId);
    pyodide.globals.set('alignment_feature_set_id', featureSet);
    pyodide.globals.set('alignment_algorithm_id', algorithm);
    pyodide.globals.set('alignment_method_script', methodScript);
    pyodide.globals.set('FEATURE_RATE', featureRate);
    pyodide.globals.set('SAMPLE_RATE', SAMPLE_RATE);
    pyodide.globals.set('generate_synced_audio', generateSyncedAudio);

    // Convert audio arrays from JS lists to numpy arrays
    await pyodide.runPythonAsync(`
import numpy as np

_audio_files_raw = dict(audio_files_js)
audio_files = {}
for fid, arr in _audio_files_raw.items():
    audio_files[fid] = np.array(arr, dtype=np.float64)
del _audio_files_raw
`);

    await pyodide.runPythonAsync(`
_full_resolution_audio_files_raw = dict(full_resolution_audio_files)
full_resolution_audio = {}
for fid, channels in _full_resolution_audio_files_raw.items():
    full_resolution_audio[fid] = [np.array(channel, dtype=np.float64) for channel in channels]
del _full_resolution_audio_files_raw
audio_sample_rates = {str(fid): int(rate) for fid, rate in dict(audio_sample_rates).items()}
`);

    // Expose a progress reporting function to Python
    pyodide.globals.set('report_progress', (msg: string) => {
        postProgress(msg);
    });

    // Run the pipeline
    await pyodide.runPythonAsync(ALIGNMENT_PIPELINE);

    // Get the CSV output and synchronized audio payloads
    const csvOutput = pyodide.globals.get('csv_output') as string;
    const syncReferenceTimeColumn = pyodide.globals.get('sync_reference_time_column') as string | null;
    const synchronizedAudioProxy = pyodide.globals.get('sync_audio_outputs');
    const synchronizedAudioRecord = synchronizedAudioProxy && typeof (synchronizedAudioProxy as any).toJs === 'function'
        ? (synchronizedAudioProxy as any).toJs()
        : synchronizedAudioProxy;
    const synchronizedAudio: WorkerComputeResult['synchronizedAudio'] = [];

    if (synchronizedAudioRecord) {
        const synchronizedEntries = synchronizedAudioRecord instanceof Map
            ? Array.from(synchronizedAudioRecord.entries())
            : Object.entries(synchronizedAudioRecord as Record<string, Uint8Array | ArrayBuffer>);

        synchronizedEntries.forEach(function(entry) {
            const fileId = String(entry[0]);
            const rawData = entry[1] as Uint8Array | ArrayBuffer | ArrayLike<number>;
            let wavData: ArrayBuffer;

            if (rawData instanceof ArrayBuffer) {
                wavData = rawData;
            } else if (ArrayBuffer.isView(rawData)) {
                wavData = new Uint8Array(
                    rawData.buffer,
                    rawData.byteOffset,
                    rawData.byteLength
                ).slice().buffer;
            } else {
                const fallbackBytes = new Uint8Array(rawData as ArrayLike<number>);
                wavData = fallbackBytes.buffer;
            }

            synchronizedAudio.push({
                fileId: fileId,
                wavData: wavData,
                mimeType: 'audio/wav',
            });
        });
    }

    postProgress('Alignment complete.');
    return {
        csv: csvOutput,
        syncReferenceTimeColumn: syncReferenceTimeColumn || null,
        synchronizedAudio: synchronizedAudio,
    };
}

// ── Message handler ──

self.addEventListener('message', async function(event: MessageEvent<WorkerMessage>) {
    const message = event.data;

    try {
        switch (message.type) {
            case 'init': {
                await initializePyodide(message.pyodideCdnUrl);
                postResponse({ type: 'ready' });
                break;
            }

            case 'install_music21': {
                await installMusic21Impl();
                postResponse({ type: 'music21_installed' });
                break;
            }

            case 'compute': {
                const result = await computeAlignment(message);
                postResult(result);
                break;
            }

            default:
                postResponse({ type: 'error', message: 'Unknown message type.' });
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        postResponse({ type: 'error', message: errorMessage });
    }
});
