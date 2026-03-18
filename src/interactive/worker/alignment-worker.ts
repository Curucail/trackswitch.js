/**
 * Alignment Web Worker.
 *
 * Loads Pyodide, installs shims for unavailable packages (numba, libfmp, etc.),
 * installs synctoolbox, and runs the alignment pipeline on demand.
 */
import type { WorkerMessage, WorkerResponse } from '../types';
import {
    NUMBA_SHIM,
    LIBFMP_SHIM,
    MISC_SHIMS,
    DTW_SPEEDUP,
    ALIGNMENT_PIPELINE,
} from './python-scripts';
import { getAlignmentMethod } from '../methods/alignment-method';
import { FEATURE_RATE, SAMPLE_RATE } from '../constants';

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

async function computeAlignment(message: Extract<WorkerMessage, { type: 'compute' }>): Promise<string> {
    if (!pyodide || !synctoolboxInstalled) {
        throw new Error('Pyodide is not initialized.');
    }

    const { files, referenceFileId, method, featureRate } = message;

    // Prepare data dictionaries for Python
    const audioFiles: Record<string, Float32Array> = {};
    const scoreFiles: Record<string, string> = {};
    const fileNames: Record<string, string> = {};

    for (const file of files) {
        fileNames[file.id] = file.name;
        if (file.type === 'audio') {
            audioFiles[file.id] = file.pcmData;
        } else {
            scoreFiles[file.id] = file.xmlText;
        }
    }

    // Get alignment method script
    const alignmentMethod = getAlignmentMethod(method);
    const methodScript = alignmentMethod.getPythonScript({ featureRate: featureRate });

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
    pyodide.globals.set('score_files', pyodide.toPy(scoreFiles));
    pyodide.globals.set('file_names', pyodide.toPy(fileNames));
    pyodide.globals.set('reference_file_id', referenceFileId);
    pyodide.globals.set('alignment_method_script', methodScript);
    pyodide.globals.set('FEATURE_RATE', featureRate);
    pyodide.globals.set('SAMPLE_RATE', SAMPLE_RATE);

    // Convert audio arrays from JS lists to numpy arrays
    await pyodide.runPythonAsync(`
import numpy as np

_audio_files_raw = dict(audio_files_js)
audio_files = {}
for fid, arr in _audio_files_raw.items():
    audio_files[fid] = np.array(arr, dtype=np.float64)
del _audio_files_raw
`);

    // Expose a progress reporting function to Python
    pyodide.globals.set('report_progress', (msg: string) => {
        postProgress(msg);
    });

    // Run the pipeline
    await pyodide.runPythonAsync(ALIGNMENT_PIPELINE);

    // Get the CSV output
    const csvOutput = pyodide.globals.get('csv_output') as string;

    postProgress('Alignment complete.');
    return csvOutput;
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
                const csv = await computeAlignment(message);
                postResponse({ type: 'result', csv: csv });
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
