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
 *   - score_files: dict of {file_id: xml_text_string}
 *   - file_names: dict of {file_id: filename}
 *   - reference_file_id: str
 *   - alignment_method_script: str (defines align_pair function)
 *   - FEATURE_RATE: int
 *   - SAMPLE_RATE: int
 */
export const ALIGNMENT_PIPELINE = `
import numpy as np
import io

# Execute the alignment method script (defines align_pair)
exec(alignment_method_script)

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

def extract_score_features(xml_text, feature_rate):
    """Extract chroma, onset features, and measure map from MusicXML via music21 + synctoolbox.
    Returns (f_chroma_quantized, f_onset, measure_times) where measure_times is a list of
    (time_seconds, measure_number) tuples for each measure boundary."""
    import music21
    import pandas as pd
    import tempfile
    import os
    from synctoolbox.feature.csv_tools import df_to_pitch_features, df_to_pitch_onset_features

    # Parse MusicXML
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

    # Actually use tempo from score if available
    tempos = score.flatten().getElementsByClass(music21.tempo.MetronomeMark)
    default_bpm = 120.0
    if tempos:
        default_bpm = tempos[0].number

    # Recompute times with actual tempo
    for n in notes:
        n['start'] = n['start'] * 120.0 / default_bpm
        n['duration'] = n['duration'] * 120.0 / default_bpm

    # Extract measure boundaries: (time_in_seconds, measure_number)
    # Use the first part to get measure offsets (all parts share the same measure structure)
    measure_times = []
    try:
        ref_part = score.parts[0]
        for m in ref_part.getElementsByClass(music21.stream.Measure):
            measure_num = m.number
            # offset is in quarter-note beats, convert to seconds
            time_sec = float(m.offset) * 60.0 / default_bpm
            measure_times.append((time_sec, measure_num))
        measure_times.sort(key=lambda x: x[0])
    except Exception:
        measure_times = []

    df = pd.DataFrame(notes)

    f_pitch = df_to_pitch_features(df, feature_rate=feature_rate)
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

    return f_chroma_quantized, f_onset, measure_times


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
_file_names_dict = dict(file_names)

# Progress budget (0-15% used by Python environment setup):
#   18-20% = imports / setup
#   20-55% = feature extraction (sub-steps per file)
#   55-70% = optimal chroma shift
#   70-90% = alignment
#   90-100% = CSV output
FEAT_START = 20
FEAT_END = 55
SHIFT_START = 55
SHIFT_END = 70
ALIGN_START = 70
ALIGN_END = 90

# Sub-steps within feature extraction per audio file:
# tuning=10%, pitch=35%, chroma=10%, onset=25%, dlnco=20%
_audio_substeps = [
    ('Estimating tuning', 0.0),
    ('Computing pitch features', 0.10),
    ('Computing chroma features', 0.45),
    ('Computing onset features', 0.55),
    ('Computing DLNCO features', 0.80),
]

report_progress(f'[{FEAT_START}%] Starting feature extraction...')

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
                pct = int(base + frac * span)
                report_progress(f'[{pct}%] {name}: {step_name.lower()}')
            return fn
        prog_fn = _make_progress_fn(file_start_pct, file_end_pct - file_start_pct, fname)
        report_progress(f'[{int(file_start_pct)}%] Extracting features: {fname}')
        chroma, onset = extract_audio_features(audio_files[fid], SAMPLE_RATE, FEATURE_RATE, progress_fn=prog_fn)
    else:
        report_progress(f'[{int(file_start_pct)}%] Parsing score: {fname}')
        chroma, onset, measure_map = extract_score_features(score_files[fid], FEATURE_RATE)
        if measure_map:
            score_measure_maps[fid] = measure_map
    features[fid] = (chroma, onset)

report_progress(f'[{SHIFT_START}%] Feature extraction complete')

ref_chroma, ref_onset = features[reference_file_id]

# ── Optimal chroma shift ──
# Compute CENS features (smoothed + downsampled to ~1Hz) for efficient shift search,
# then apply the found shift to the full-resolution chroma and DLNCO features.
# This compensates for pitch transpositions between recordings.
report_progress(f'[{SHIFT_START}%] Computing optimal chroma shifts...')

ref_cens = quantized_chroma_to_CENS(ref_chroma, 201, 50, FEATURE_RATE)[0]

shift_idx = 0
for fid in all_file_ids:
    if fid == reference_file_id:
        continue
    pct = int(SHIFT_START + (shift_idx / max(non_ref_count, 1)) * (SHIFT_END - SHIFT_START))
    fname = str(_file_names_dict[fid])
    report_progress(f'[{pct}%] Finding chroma shift: {fname}')

    other_chroma, other_onset = features[fid]
    other_cens = quantized_chroma_to_CENS(other_chroma, 201, 50, FEATURE_RATE)[0]
    opt_shift = compute_optimal_chroma_shift(ref_cens, other_cens)

    if opt_shift != 0:
        report_progress(f'[{pct}%] Applying chroma shift ({opt_shift} bins): {fname}')
        other_chroma = shift_chroma_vectors(other_chroma, opt_shift)
        if other_onset is not None:
            other_onset = shift_chroma_vectors(other_onset, opt_shift)
        features[fid] = (other_chroma, other_onset)

    shift_idx += 1

report_progress(f'[{ALIGN_START}%] Chroma shift complete')

# Re-read reference features (unchanged, but keeps code symmetric)
ref_chroma, ref_onset = features[reference_file_id]

# Align each non-reference file to the reference
warping_paths = {}
align_idx = 0
for fid in all_file_ids:
    if fid == reference_file_id:
        continue
    pct = int(ALIGN_START + (align_idx / max(non_ref_count, 1)) * (ALIGN_END - ALIGN_START))
    fname = str(_file_names_dict[fid])
    report_progress(f'[{pct}%] Computing warping path: {fname}')
    other_chroma, other_onset = features[fid]
    try:
        wp = align_pair(ref_chroma, other_chroma, ref_onset, other_onset)
    except TypeError:
        wp = align_pair(ref_chroma, other_chroma)
    warping_paths[fid] = wp
    align_idx += 1

report_progress(f'[{ALIGN_END}%] Building CSV output...')

import pandas as pd

ref_length = ref_chroma.shape[1]
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

report_progress('[95%] Writing CSV...')

df = pd.DataFrame(columns)
csv_output = df.to_csv(index=False, float_format='%.6f')
report_progress('[100%] Alignment complete')
`;
