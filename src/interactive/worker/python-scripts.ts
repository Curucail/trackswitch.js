/**
 * Embedded Python source strings executed in the Pyodide Web Worker.
 *
 * These scripts provide shims for packages unavailable in Pyodide (numba, libfmp,
 * matplotlib, soundfile, pretty_midi, librosa) and the main alignment pipeline.
 */

/** Fake numba module -- makes @jit a no-op decorator. */
export const NUMBA_SHIM = `
import sys
from types import ModuleType

numba_module = ModuleType('numba')

def _jit(*args, **kwargs):
    def decorator(func):
        return func
    if len(args) == 1 and callable(args[0]):
        return args[0]
    return decorator

numba_module.jit = _jit
numba_module.njit = _jit
numba_module.prange = range
sys.modules['numba'] = numba_module
`;

/** Minimal libfmp shim with real implementations of computational functions. */
export const LIBFMP_SHIM = `
import sys
import os
from types import ModuleType
import numpy as np

# ── libfmp package structure ──
libfmp = ModuleType('libfmp')
libfmp_b = ModuleType('libfmp.b')
libfmp_c1 = ModuleType('libfmp.c1')
libfmp_c2 = ModuleType('libfmp.c2')
libfmp_c3 = ModuleType('libfmp.c3')
libfmp_c6 = ModuleType('libfmp.c6')

# ── libfmp.b: visualization stubs (no-ops) ──
def plot_matrix(*a, **kw):
    return None, None

def plot_chromagram(*a, **kw):
    return None, None

class MultiplePlotsWithColorbar:
    def __init__(self, *a, **kw): pass
    def __enter__(self): return self, [None], [None]
    def __exit__(self, *a): pass

libfmp_b.plot_matrix = plot_matrix
libfmp_b.plot_chromagram = plot_chromagram
libfmp_b.MultiplePlotsWithColorbar = MultiplePlotsWithColorbar

# ── libfmp.c1: CSV / list utilities ──
def list_to_csv(score, csv_filepath):
    import csv
    with open(csv_filepath, 'w', newline='') as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow(['start', 'duration', 'pitch', 'velocity', 'instrument'])
        for row in score:
            writer.writerow(row)

libfmp_c1.list_to_csv = list_to_csv

# ── libfmp.c3: alignment / tuning functions ──

def compute_strict_alignment_path_mask(P):
    """Compute strict alignment path from a warping path.
    Reimplements libfmp.c3.compute_strict_alignment_path_mask.
    P has shape (K, 2)."""
    P = np.array(P, copy=True)
    if P.shape[0] < 2:
        return P
    N, M = P[-1]
    # Keep points where both indices strictly increase from the previous kept point
    keep_mask = np.concatenate(([True], (P[1:, 0] > P[:-1, 0]) & (P[1:, 1] > P[:-1, 1])))
    # Remove all points on the last row or last column (boundary)
    keep_mask[(P[:, 0] == N) | (P[:, 1] == M)] = False
    # Force the very last point to be included (end boundary condition)
    keep_mask[-1] = True
    return P[keep_mask, :]

def compute_freq_distribution(x, Fs, N=16384, gamma=100, local=True, filt=True, filt_len=101):
    """Compute frequency distribution for tuning estimation.
    Returns (v, F_coef_cents) where v is the distribution and F_coef_cents are cent values."""
    from scipy.fft import rfft

    if local:
        # STFT approach: split into overlapping windows
        hop = N // 2
        num_frames = max(1, (len(x) - N) // hop + 1)
        X_sum = np.zeros(N // 2 + 1)
        for i in range(num_frames):
            segment = x[i * hop : i * hop + N]
            if len(segment) < N:
                segment = np.pad(segment, (0, N - len(segment)))
            X = np.abs(rfft(segment * np.hanning(N)))
            X_sum += X
        X_avg = X_sum / num_frames
    else:
        if len(x) < N:
            x = np.pad(x, (0, N - len(x)))
        X_avg = np.abs(rfft(x[:N] * np.hanning(N)))

    # Log compression
    X_log = np.log(1 + gamma * X_avg)

    # Convert to cent scale
    freq_res = Fs / N
    num_bins = len(X_log)
    F_coef_hertz = np.arange(num_bins) * freq_res

    # Map to cents relative to A4=440Hz
    # cents = 1200 * log2(f / 440) + 6900
    # We compute distribution over cents mod 100 (within each semitone)
    v = np.zeros(100)
    for k in range(1, num_bins):
        f = F_coef_hertz[k]
        if f <= 0:
            continue
        cents = 1200 * np.log2(f / 440) + 6900
        cents_mod = cents % 100
        idx = int(cents_mod) % 100
        v[idx] += X_log[k]

    if filt:
        # Local averaging with triangular window
        kernel_len = min(filt_len, 99)
        kernel = np.bartlett(kernel_len)
        kernel /= kernel.sum()
        v_padded = np.concatenate([v, v, v])
        v_filtered = np.convolve(v_padded, kernel, mode='same')
        v = v_filtered[100:200]
        # Half-wave rectification
        v_mean = np.mean(v)
        v = np.maximum(v - v_mean, 0)

    F_coef_cents = np.arange(100)
    return v, F_coef_cents


def tuning_similarity(v):
    """Estimate tuning from frequency distribution.
    Returns (sim, F_coef_cents_shift, v_shift, tuning, max_sim)."""
    # Find peak in distribution = tuning offset
    peak_idx = np.argmax(v)
    # Convert to centered tuning: 0-49 -> 0 to 49 cents sharp, 50-99 -> -50 to -1 cents flat
    if peak_idx <= 50:
        tuning = peak_idx
    else:
        tuning = peak_idx - 100

    sim = np.max(v)
    return sim, np.arange(100), v, tuning, sim

libfmp_c3.compute_strict_alignment_path_mask = compute_strict_alignment_path_mask
libfmp_c3.compute_freq_distribution = compute_freq_distribution
libfmp_c3.tuning_similarity = tuning_similarity

# ── libfmp.c6: novelty / local average ──
def compute_local_average(x, M):
    """Compute local average using a uniform kernel of width 2*M+1."""
    L = len(x)
    local_avg = np.zeros(L)
    for n in range(L):
        start = max(0, n - M)
        end = min(L, n + M + 1)
        local_avg[n] = np.mean(x[start:end])
    return local_avg

libfmp_c6.compute_local_average = compute_local_average

# ── Register all modules ──
sys.modules['libfmp'] = libfmp
sys.modules['libfmp.b'] = libfmp_b
sys.modules['libfmp.c1'] = libfmp_c1
sys.modules['libfmp.c2'] = libfmp_c2
sys.modules['libfmp.c3'] = libfmp_c3
sys.modules['libfmp.c6'] = libfmp_c6
`;

/**
 * Monkey-patches synctoolbox's __C_to_DE (DTW accumulated cost matrix)
 * with a vectorized anti-diagonal implementation.
 *
 * The original is a triple-nested Python loop (N × M × S) that relies on
 * numba @jit for speed. Without numba (Pyodide), it's extremely slow.
 *
 * The anti-diagonal approach exploits the fact that all cells on the same
 * anti-diagonal (n + m = d) are independent — their predecessors lie on
 * earlier anti-diagonals.  This lets us process each anti-diagonal as a
 * single vectorized numpy operation, reducing N*M Python iterations to
 * N+M numpy-vectorized iterations.
 */
export const DTW_SPEEDUP = `
import numpy as np
import synctoolbox.dtw.core as _dtw_core

def _fast_C_to_DE(C, dn=np.array([1,1,0], np.int64),
                  dm=np.array([1,0,1], np.int64),
                  dw=np.array([1.0,1.0,1.0], np.float64),
                  sub_sequence=False):
    """Vectorized anti-diagonal DTW accumulation."""
    N, M = C.shape
    S = dn.size

    D = np.full((N, M), np.inf, dtype=np.float64)
    E = np.full((N, M), -1, dtype=np.int64)

    if sub_sequence:
        D[0, :] = C[0, :]
    else:
        D[0, 0] = C[0, 0]

    # Process each anti-diagonal d = n + m, from 1 to N+M-2.
    # All cells on the same anti-diagonal are independent.
    for d in range(1, N + M - 1):
        n_min = max(0, d - M + 1)
        n_max = min(N - 1, d)
        ns = np.arange(n_min, n_max + 1, dtype=np.int64)
        ms = d - ns
        L = len(ns)

        c_vals = C[ns, ms]

        best_cost = np.full(L, np.inf)
        best_step = np.full(L, -1, dtype=np.int64)

        for s in range(S):
            pn = ns - dn[s]
            pm = ms - dm[s]
            valid = (pn >= 0) & (pm >= 0)
            if not np.any(valid):
                continue
            step_cost = np.full(L, np.inf)
            step_cost[valid] = D[pn[valid], pm[valid]] + c_vals[valid] * dw[s]

            improved = step_cost < best_cost
            best_cost[improved] = step_cost[improved]
            best_step[improved] = s

        finite = np.isfinite(best_cost) & (best_cost < D[ns, ms])
        D[ns[finite], ms[finite]] = best_cost[finite]
        E[ns[finite], ms[finite]] = best_step[finite]

    return D, E

# Monkey-patch the slow pure-Python version
_dtw_core.__C_to_DE = _fast_C_to_DE

# Also vectorize normalize_feature (called multiple times per MrMsDTW iteration)
import synctoolbox.feature.utils as _feat_utils

def _fast_normalize_feature(feature, norm_ord, threshold):
    """Vectorized feature normalization — replaces the per-column Python loop."""
    d, N = feature.shape
    norms = np.linalg.norm(feature, ord=norm_ord, axis=0)
    unit_vec = np.ones(d)
    unit_vec = unit_vec / np.linalg.norm(unit_vec, norm_ord)

    f_normalized = np.empty_like(feature)
    below = norms < threshold
    above = ~below

    if np.any(below):
        f_normalized[:, below] = unit_vec[:, np.newaxis]
    if np.any(above):
        f_normalized[:, above] = feature[:, above] / norms[above]

    return f_normalized

_feat_utils.normalize_feature = _fast_normalize_feature
`;

/** Shim for packages that synctoolbox imports but we don't need in Pyodide. */
export const MISC_SHIMS = `
import sys
from types import ModuleType

# soundfile shim
sf = ModuleType('soundfile')
def _sf_read(*a, **kw): raise RuntimeError('soundfile not available in Pyodide')
sf.read = _sf_read
sys.modules['soundfile'] = sf

# pretty_midi shim
pm = ModuleType('pretty_midi')
sys.modules['pretty_midi'] = pm

# librosa shim (synctoolbox imports it but uses implementation='synctoolbox' by default)
librosa = ModuleType('librosa')
librosa_sequence = ModuleType('librosa.sequence')
librosa.sequence = librosa_sequence
sys.modules['librosa'] = librosa
sys.modules['librosa.sequence'] = librosa_sequence
`;

/**
 * Main alignment pipeline script.
 * Executed after all shims are installed and synctoolbox is available.
 * Expects global variables set by the worker:
 *   - audio_files: dict of {file_id: numpy_array} (mono PCM at SAMPLE_RATE)
 *   - full_resolution_audio: dict of {file_id: [numpy_array, ...]} (per-channel PCM at original sample rate)
 *   - audio_sample_rates: dict of {file_id: sample_rate}
 *   - score_files: dict of {file_id: xml_text_string}
 *   - file_names: dict of {file_id: filename}
 *   - reference_file_id: str
 *   - alignment_feature_set_id: str
 *   - alignment_algorithm_id: str
 *   - alignment_method_script: str (defines align_pair function)
 *   - FEATURE_RATE: int
 *   - SAMPLE_RATE: int
 *   - generate_synced_audio: bool
 */
export const ALIGNMENT_PIPELINE = `
import numpy as np
import io
import wave

# Execute the alignment method script (defines align_pair)
exec(alignment_method_script)

import libtsm
from synctoolbox.feature.pitch import audio_to_pitch_features
from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma, quantized_chroma_to_CENS
from synctoolbox.feature.utils import estimate_tuning, shift_chroma_vectors
from synctoolbox.dtw.utils import compute_optimal_chroma_shift

# Try to import onset features (may fail gracefully)
try:
    from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features
    from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
    HAS_ONSET_FEATURES = True
except Exception:
    HAS_ONSET_FEATURES = False

BASIC_PITCH_MIDI_OFFSET = 21
BASIC_PITCH_N_SEMITONES = 88

def extract_audio_features(audio_data, sample_rate, feature_rate, progress_fn=None):
    """Extract chroma and optional onset features from audio PCM data."""
    if progress_fn: progress_fn('Estimating tuning')
    tuning_offset = estimate_tuning(audio_data, sample_rate)

    if progress_fn: progress_fn('Computing pitch features')
    f_pitch = audio_to_pitch_features(
        f_audio=audio_data,
        Fs=sample_rate,
        tuning_offset=tuning_offset,
        feature_rate=feature_rate,
        verbose=False,
    )

    if progress_fn: progress_fn('Computing chroma features')
    f_chroma = pitch_to_chroma(f_pitch=f_pitch)
    f_chroma_quantized = quantize_chroma(f_chroma=f_chroma)

    f_onset = None
    if HAS_ONSET_FEATURES:
        try:
            if progress_fn: progress_fn('Computing onset features')
            f_pitch_onset = audio_to_pitch_onset_features(
                f_audio=audio_data,
                Fs=sample_rate,
                tuning_offset=tuning_offset,
                verbose=False,
            )
            if progress_fn: progress_fn('Computing DLNCO features')
            f_onset = pitch_onset_features_to_DLNCO(
                f_peaks=f_pitch_onset,
                feature_rate=feature_rate,
                feature_sequence_length=f_chroma_quantized.shape[1],
                visualize=False,
            )
        except Exception:
            f_onset = None

    return f_chroma_quantized, f_onset

def decode_basic_pitch_feature_matrix(payload):
    frame_count = int(payload['frameCount'])
    bin_count = int(payload['binCount'])
    data = np.asarray(payload['data'], dtype=np.float64)

    if frame_count == 0 or bin_count == 0:
        return np.zeros((0, 0), dtype=np.float64)

    if data.size != frame_count * bin_count:
        raise ValueError('Invalid Basic Pitch feature payload dimensions.')

    # JS caches matrices as time x bins. DTW expects feature_dim x time.
    return data.reshape((frame_count, bin_count)).T

def build_basic_pitch_score_matrix(f_pitch):
    target_end = BASIC_PITCH_MIDI_OFFSET + BASIC_PITCH_N_SEMITONES
    if f_pitch.shape[0] < target_end:
        padded = np.zeros((target_end, f_pitch.shape[1]), dtype=np.float64)
        padded[:f_pitch.shape[0], :] = f_pitch
        f_pitch = padded

    return np.asarray(
        f_pitch[BASIC_PITCH_MIDI_OFFSET:target_end, :],
        dtype=np.float64
    )

def pitch_shift_cents_from_chroma_shift(chroma_shift):
    cents = int(chroma_shift) % 12
    if cents > 6:
        cents -= 12
    return int(cents * 100)

def build_valid_time_map(warping_path, sample_rate, feature_rate):
    source_samples = np.round(warping_path[1] / feature_rate * sample_rate).astype(int)
    target_samples = np.round(warping_path[0] / feature_rate * sample_rate).astype(int)
    time_map = np.column_stack((source_samples, target_samples))

    if time_map.shape[0] == 0:
        raise ValueError('time_map is empty.')

    max_source = max(0, int(source_samples.max()))
    max_target = max(0, int(target_samples.max()))
    time_map[:, 0] = np.clip(time_map[:, 0], 0, max_source)
    time_map[:, 1] = np.clip(time_map[:, 1], 0, max_target)

    keep = np.ones(time_map.shape[0], dtype=bool)
    if time_map.shape[0] > 1:
        keep[1:] = (np.diff(time_map[:, 0]) > 0) & (np.diff(time_map[:, 1]) > 0)
    time_map = time_map[keep]
    time_map = libtsm.ensure_validity(time_map)

    if time_map.shape[0] == 0:
        raise ValueError('time_map is empty after validity filtering.')

    if time_map[0, 1] != 0:
        time_map = np.vstack(([time_map[0, 0], 0], time_map))

    if time_map.shape[0] < 2:
        raise ValueError('time_map has too few anchor points after filtering.')

    return time_map.astype(int)

def encode_wav_bytes(audio_data, sample_rate):
    audio_array = np.asarray(audio_data, dtype=np.float64)
    if audio_array.ndim == 1:
        audio_array = audio_array[:, np.newaxis]

    audio_array = np.clip(audio_array, -1.0, 1.0)
    pcm = np.round(audio_array * 32767.0).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(int(pcm.shape[1]))
        wav_file.setsampwidth(2)
        wav_file.setframerate(int(sample_rate))
        wav_file.writeframes(pcm.reshape(-1).tobytes())

    return buffer.getvalue()

def render_synchronized_audio(fid, warping_path, chroma_shift, progress_fn=None):
    sample_rate = int(audio_sample_rates[str(fid)])
    if progress_fn is not None:
        progress_fn(0.02, 'preparing time map')
    time_map = build_valid_time_map(warping_path, sample_rate, FEATURE_RATE)
    pitch_shift_cents = pitch_shift_cents_from_chroma_shift(chroma_shift)
    rendered_channels = []
    total_channels = len(full_resolution_audio[fid])

    for channel_index, channel_audio in enumerate(full_resolution_audio[fid]):
        channel_start = channel_index / max(total_channels, 1)
        channel_span = 1.0 / max(total_channels, 1)
        if progress_fn is not None:
            progress_fn(
                channel_start + 0.05 * channel_span,
                f'rendering channel {channel_index + 1}/{total_channels}'
            )
        shifted_audio = channel_audio
        if pitch_shift_cents != 0:
            if progress_fn is not None:
                progress_fn(
                    channel_start + 0.18 * channel_span,
                    f'Synchronizing audio: pitch-shifting channel {channel_index + 1}/{total_channels}'
                )
            shifted_audio = libtsm.pitch_shift(
                channel_audio,
                pitch_shift_cents,
                Fs=sample_rate,
                order='tsm-res'
            )
        shifted_audio = np.asarray(shifted_audio, dtype=np.float64).reshape(-1)
        if progress_fn is not None:
            progress_fn(
                channel_start + 0.62 * channel_span,
                f'Synchronizing audio: time-stretching channel {channel_index + 1}/{total_channels}'
            )
        synced_audio = libtsm.hps_tsm(shifted_audio, time_map, Fs=sample_rate)
        rendered_channels.append(np.asarray(synced_audio, dtype=np.float64).reshape(-1))

    if len(rendered_channels) == 0:
        raise ValueError('No audio channels available for synchronized rendering.')

    min_length = min(len(channel) for channel in rendered_channels)
    stacked = np.stack([channel[:min_length] for channel in rendered_channels], axis=1)
    if progress_fn is not None:
        progress_fn(0.98, 'encoding wav')
    return encode_wav_bytes(stacked, sample_rate)

def extract_score_note_events_and_measure_map(xml_text):
    """Extract score note events and measure boundaries from MusicXML."""
    import music21
    import pandas as pd

    score = music21.converter.parse(xml_text)
    score = score.stripTies()
    try:
        score = score.expandRepeats()
    except Exception:
        pass

    # Extract note events
    notes = []
    for part in score.parts:
        instrument_obj = part.getInstrument(returnDefault=True)
        instrument_name = "Unknown"
        if instrument_obj is not None:
            instrument_name = instrument_obj.partName or instrument_obj.instrumentName or "Unknown"

        for note in part.flatten().notes:
            if isinstance(note, music21.chord.Chord):
                for chord_note in note.pitches:
                    notes.append({
                        'start': float(note.offset) * 60.0 / 120.0,
                        'duration': float(note.quarterLength) * 60.0 / 120.0,
                        'pitch': int(chord_note.ps),
                        'velocity': int(note.volume.realized * 127) if note.volume.realized else 64,
                        'instrument': instrument_name,
                    })
            elif hasattr(note, 'pitch'):
                notes.append({
                    'start': float(note.offset) * 60.0 / 120.0,
                    'duration': float(note.quarterLength) * 60.0 / 120.0,
                    'pitch': int(note.pitch.ps),
                    'velocity': int(note.volume.realized * 127) if note.volume.realized else 64,
                    'instrument': instrument_name,
                })

    if not notes:
        raise ValueError("No notes found in MusicXML file")

    tempos = score.flatten().getElementsByClass(music21.tempo.MetronomeMark)
    default_bpm = 120.0
    if tempos:
        default_bpm = tempos[0].number

    for n in notes:
        n['start'] = n['start'] * 120.0 / default_bpm
        n['duration'] = n['duration'] * 120.0 / default_bpm

    measure_times = []
    try:
        ref_part = score.parts[0]
        for m in ref_part.getElementsByClass(music21.stream.Measure):
            measure_num = m.number
            time_sec = float(m.offset) * 60.0 / default_bpm
            measure_times.append((time_sec, measure_num))
        measure_times.sort(key=lambda x: x[0])
    except Exception:
        measure_times = []

    return pd.DataFrame(notes), measure_times

def extract_score_features(xml_text, feature_rate):
    """Extract score chroma/onset features, Basic Pitch-like frame features, and measure map."""
    from synctoolbox.feature.csv_tools import df_to_pitch_features, df_to_pitch_onset_features

    df, measure_times = extract_score_note_events_and_measure_map(xml_text)

    f_pitch = df_to_pitch_features(df, feature_rate=feature_rate)
    f_basic_pitch_score = build_basic_pitch_score_matrix(f_pitch)
    f_chroma = pitch_to_chroma(f_pitch=f_pitch)
    f_chroma_quantized = quantize_chroma(f_chroma=f_chroma)

    f_onset = None
    try:
        f_pitch_onset = df_to_pitch_onset_features(df)
        f_onset = pitch_onset_features_to_DLNCO(
            f_peaks=f_pitch_onset,
            feature_rate=feature_rate,
            feature_sequence_length=f_chroma_quantized.shape[1],
            visualize=False,
        )
    except Exception:
        f_onset = None

    return f_chroma_quantized, f_onset, measure_times, f_basic_pitch_score


# ── Main pipeline ──

import re

def _sanitize_col_name(filename):
    """Strip extension, replace non-alphanumeric chars with underscore.
    Must match the TypeScript fileNameToColumnName / fileNameToMeasureColumnName."""
    base = filename.rsplit('.', 1)[0] if '.' in filename else filename
    return re.sub(r'[^a-zA-Z0-9_-]', '_', base)

report_progress('[18%] Importing synctoolbox modules...')

all_file_ids = list(audio_files.keys()) + list(score_files.keys())
total_files = len(all_file_ids)
non_ref_count = total_files - 1
sync_audio_file_ids = [
    fid for fid in all_file_ids
    if generate_synced_audio and fid in audio_files and fid != reference_file_id
]
sync_audio_count = len(sync_audio_file_ids)
_file_names_dict = dict(file_names)
_basic_pitch_audio_features_raw = dict(basic_pitch_audio_features) if 'basic_pitch_audio_features' in globals() else {}
audio_basic_pitch_features = {}

for fid, payload in _basic_pitch_audio_features_raw.items():
    audio_basic_pitch_features[str(fid)] = {
        'frames': decode_basic_pitch_feature_matrix(payload['frames']),
        'contours': decode_basic_pitch_feature_matrix(payload['contours']),
    }

def _progress_percent(value):
    return int(np.clip(np.round(value), 0, 100))

def _phase_end(start, weight, total_weight, progress_span):
    return start + (weight / total_weight) * progress_span

PIPELINE_IMPORT_PCT = 18.0
PIPELINE_START_PCT = 20.0
PIPELINE_END_PCT = 99.0
PIPELINE_SPAN = PIPELINE_END_PCT - PIPELINE_START_PCT

feature_weight = max(float(total_files), 1.0)
shift_weight = max(float(non_ref_count) * 0.65, 0.75)
align_weight = max(float(non_ref_count) * 1.0, 1.0)
csv_weight = 0.8
sync_weight = float(sync_audio_count) * 2.4 if generate_synced_audio else 0.0
total_weight = feature_weight + shift_weight + align_weight + csv_weight + sync_weight

FEAT_START = PIPELINE_START_PCT
FEAT_END = _phase_end(FEAT_START, feature_weight, total_weight, PIPELINE_SPAN)
SHIFT_START = FEAT_END
SHIFT_END = _phase_end(SHIFT_START, shift_weight, total_weight, PIPELINE_SPAN)
ALIGN_START = SHIFT_END
ALIGN_END = _phase_end(ALIGN_START, align_weight, total_weight, PIPELINE_SPAN)
CSV_START = ALIGN_END
CSV_END = _phase_end(CSV_START, csv_weight, total_weight, PIPELINE_SPAN)
SYNC_START = CSV_END
SYNC_END = PIPELINE_END_PCT

# Sub-steps within feature extraction per audio file:
# tuning=10%, pitch=35%, chroma=10%, onset=25%, dlnco=20%
_audio_substeps = [
    ('Estimating tuning', 0.0),
    ('Computing pitch features', 0.10),
    ('Computing chroma features', 0.45),
    ('Computing onset features', 0.55),
    ('Computing DLNCO features', 0.80),
]

report_progress(f'[{_progress_percent(FEAT_START)}%] Starting feature extraction...')

# Extract features for all files
features = {}
score_measure_maps = {}  # file_id -> [(time_sec, measure_num), ...]
for file_idx, fid in enumerate(all_file_ids):
    file_start_pct = FEAT_START + (file_idx / total_files) * (FEAT_END - FEAT_START)
    file_end_pct = FEAT_START + ((file_idx + 1) / total_files) * (FEAT_END - FEAT_START)
    fname = str(_file_names_dict[fid])

    if fid in audio_files:
        def _make_progress_fn(base, span, name):
            def fn(step_name):
                # Map sub-step name to fractional progress within this file
                frac = 0.0
                for sname, sfrac in _audio_substeps:
                    if sname == step_name:
                        frac = sfrac
                        break
                pct = _progress_percent(base + frac * span)
                report_progress(f'[{pct}%] {name}: {step_name.lower()}')
            return fn
        prog_fn = _make_progress_fn(file_start_pct, file_end_pct - file_start_pct, fname)
        report_progress(f'[{_progress_percent(file_start_pct)}%] Extracting features: {fname}')
        chroma, onset = extract_audio_features(audio_files[fid], SAMPLE_RATE, FEATURE_RATE, progress_fn=prog_fn)
        file_features = {
            'chroma': chroma,
            'onset': onset,
        }
        if alignment_feature_set_id == 'basic_pitch':
            audio_basic_pitch = audio_basic_pitch_features.get(str(fid))
            if not audio_basic_pitch:
                raise ValueError(f'Missing Basic Pitch features for audio file: {fname}')
            file_features['basic_pitch_frames'] = audio_basic_pitch['frames']
            file_features['basic_pitch_contours'] = audio_basic_pitch['contours']
    else:
        report_progress(f'[{_progress_percent(file_start_pct)}%] Parsing score: {fname}')
        chroma, onset, measure_map, score_basic_pitch = extract_score_features(score_files[fid], FEATURE_RATE)
        if measure_map:
            score_measure_maps[fid] = measure_map
        file_features = {
            'chroma': chroma,
            'onset': onset,
            'score_basic_pitch': score_basic_pitch,
        }
    features[fid] = file_features

report_progress(f'[{_progress_percent(SHIFT_START)}%] Feature extraction complete')

ref_chroma = features[reference_file_id]['chroma']

# ── Optimal chroma shift ──
# Compute CENS features (smoothed + downsampled to ~1Hz) for efficient shift search,
# then apply the found shift to the full-resolution chroma and DLNCO features.
# This compensates for pitch transpositions between recordings.
report_progress(f'[{_progress_percent(SHIFT_START)}%] Computing optimal chroma shifts...')

ref_cens = quantized_chroma_to_CENS(ref_chroma, 201, 50, FEATURE_RATE)[0]
chroma_shifts = {reference_file_id: 0}

shift_idx = 0
for fid in all_file_ids:
    if fid == reference_file_id:
        continue
    pct = _progress_percent(SHIFT_START + (shift_idx / max(non_ref_count, 1)) * (SHIFT_END - SHIFT_START))
    fname = str(_file_names_dict[fid])
    report_progress(f'[{pct}%] Finding chroma shift: {fname}')

    other_chroma = features[fid]['chroma']
    other_onset = features[fid]['onset']
    other_cens = quantized_chroma_to_CENS(other_chroma, 201, 50, FEATURE_RATE)[0]
    opt_shift = compute_optimal_chroma_shift(ref_cens, other_cens)
    chroma_shifts[fid] = int(opt_shift)

    if opt_shift != 0:
        report_progress(f'[{pct}%] Applying chroma shift ({opt_shift} bins): {fname}')
        other_chroma = shift_chroma_vectors(other_chroma, opt_shift)
        if other_onset is not None:
            other_onset = shift_chroma_vectors(other_onset, opt_shift)
        features[fid]['chroma'] = other_chroma
        features[fid]['onset'] = other_onset

    shift_idx += 1

report_progress(f'[{_progress_percent(ALIGN_START)}%] Chroma shift complete')

def get_alignment_pair_features(reference_id, other_id):
    ref_features = features[reference_id]
    other_features = features[other_id]

    if alignment_feature_set_id == 'chroma':
        return (
            ref_features['chroma'],
            other_features['chroma'],
            None,
            None,
        )

    if alignment_feature_set_id in ('chroma_dlnco_synctoolbox', 'chroma_dlnco'):
        return (
            ref_features['chroma'],
            other_features['chroma'],
            ref_features.get('onset'),
            other_features.get('onset'),
        )

    reference_is_audio = reference_id in audio_files
    other_is_audio = other_id in audio_files

    if reference_is_audio and other_is_audio:
        return (
            ref_features['basic_pitch_contours'],
            other_features['basic_pitch_contours'],
            None,
            None,
        )

    if reference_is_audio and not other_is_audio:
        return (
            ref_features['basic_pitch_frames'],
            other_features['score_basic_pitch'],
            None,
            None,
        )

    if not reference_is_audio and other_is_audio:
        return (
            ref_features['score_basic_pitch'],
            other_features['basic_pitch_frames'],
            None,
            None,
        )

    return (
        ref_features['score_basic_pitch'],
        other_features['score_basic_pitch'],
        None,
        None,
    )

def get_reference_feature_length(reference_id):
    reference_features = features[reference_id]

    if alignment_feature_set_id != 'basic_pitch':
        return int(reference_features['chroma'].shape[1])

    if reference_id in audio_files:
        if 'basic_pitch_frames' in reference_features:
            return int(reference_features['basic_pitch_frames'].shape[1])
        return int(reference_features['basic_pitch_contours'].shape[1])

    return int(reference_features['score_basic_pitch'].shape[1])

# Align each non-reference file to the reference
warping_paths = {}
align_idx = 0
for fid in all_file_ids:
    if fid == reference_file_id:
        continue
    pct = _progress_percent(ALIGN_START + (align_idx / max(non_ref_count, 1)) * (ALIGN_END - ALIGN_START))
    fname = str(_file_names_dict[fid])
    report_progress(f'[{pct}%] Computing warping path: {fname}')
    ref_feature_matrix, other_feature_matrix, ref_onset, other_onset = get_alignment_pair_features(reference_file_id, fid)
    try:
        wp = align_pair(ref_feature_matrix, other_feature_matrix, ref_onset, other_onset)
    except TypeError:
        wp = align_pair(ref_feature_matrix, other_feature_matrix)
    warping_paths[fid] = wp
    align_idx += 1

report_progress(f'[{_progress_percent(CSV_START)}%] Building CSV output...')

import pandas as pd

ref_length = get_reference_feature_length(reference_file_id)
ref_times = np.arange(ref_length, dtype=np.float64) / FEATURE_RATE

other_file_ids_ordered = [fid for fid in all_file_ids if fid != reference_file_id]

ref_col_name = 'time_' + _sanitize_col_name(_file_names_dict[reference_file_id])
columns = {ref_col_name: ref_times}

for fid in other_file_ids_ordered:
    wp = warping_paths[fid]
    col_name = 'time_' + _sanitize_col_name(_file_names_dict[fid])
    # Vectorized interpolation: map ref frames to other file times
    columns[col_name] = np.interp(ref_times, wp[0] / FEATURE_RATE, wp[1] / FEATURE_RATE)

# Add measure columns for MusicXML files.
# For each score file, map each reference time frame to a fractional measure number
# by interpolating between measure boundaries.
for fid, mmap in score_measure_maps.items():
    if len(mmap) < 2:
        continue
    m_times = np.array([m[0] for m in mmap], dtype=np.float64)
    m_nums = np.array([m[1] for m in mmap], dtype=np.float64)
    col_name = 'measure_' + _sanitize_col_name(_file_names_dict[fid])

    if fid == reference_file_id:
        # Score is the reference: map ref_times directly to measure numbers
        columns[col_name] = np.interp(ref_times, m_times, m_nums)
    else:
        # Score is not the reference: use its warping path to map ref times
        # to score times, then score times to measure numbers
        wp = warping_paths[fid]
        score_times = np.interp(ref_times, wp[0] / FEATURE_RATE, wp[1] / FEATURE_RATE)
        columns[col_name] = np.interp(score_times, m_times, m_nums)

sync_audio_outputs = {}
sync_reference_time_column = None

if generate_synced_audio:
    sync_reference_time_column = 'time_sync_reference'
    columns[sync_reference_time_column] = ref_times

report_progress(f'[{_progress_percent(CSV_END)}%] Writing CSV...')

df = pd.DataFrame(columns)
csv_output = df.to_csv(index=False, float_format='%.6f')

if generate_synced_audio:
    total_sync_files = max(len(sync_audio_file_ids), 1)

    def _make_sync_progress_fn(base, span, name):
        def fn(frac, stage):
            pct = _progress_percent(base + np.clip(frac, 0.0, 1.0) * span)
            report_progress(f'[{pct}%] {name}: {stage}')
        return fn

    for sync_index, fid in enumerate(sync_audio_file_ids):
        file_start_pct = SYNC_START + (sync_index / total_sync_files) * (SYNC_END - SYNC_START)
        file_end_pct = SYNC_START + ((sync_index + 1) / total_sync_files) * (SYNC_END - SYNC_START)
        fname = str(_file_names_dict[fid])
        report_progress(f'[{_progress_percent(file_start_pct)}%] Rendering synced audio: {fname}')
        sync_audio_outputs[fid] = np.frombuffer(
            render_synchronized_audio(
                fid,
                warping_paths[fid],
                chroma_shifts.get(fid, 0),
                progress_fn=_make_sync_progress_fn(file_start_pct, file_end_pct - file_start_pct, fname)
            ),
            dtype=np.uint8
        )

report_progress('[100%] Alignment complete')
`;
