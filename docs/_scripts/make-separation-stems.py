"""Generates the harmonic/percussive/residual stems of the separated-stems demo.

The two Gefrorne Traenen recordings in docs/assets/alignment are decomposed with
librosa's HPSS; what the two masks leave over is kept as a third stem, so the
three of them add back up to the input. Every stem inherits its recording's
alignment column and offsets, which is what lets one trackList play them
together on a single timeline.

The stems are derived data and are not committed. `npm run docs:assets` runs
this script, or run it directly:

    uv run --with librosa --with soundfile docs/_scripts/make-separation-stems.py

Pass --refresh (or set REFRESH_DOCS_ASSETS=1) to rebuild files that are already
there.
"""

import os
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

DOCS = Path(__file__).resolve().parent.parent
ROOT = DOCS.parent
SOURCE_DIR = DOCS / "assets" / "alignment"
TARGET_DIR = DOCS / "assets" / "separation"

PERFORMANCES = {
    "hu33": SOURCE_DIR / "Schubert_D911-03_HU33.wav",
    "sc06": SOURCE_DIR / "Schubert_D911-03_SC06.wav",
}
STEMS = ("harmonic", "percussive", "residual")

N_FFT = 2048
HOP_LENGTH = 512
# Above 1.0 the masks get stricter, which pushes everything they disagree about
# into the residual and makes that third stem worth listening to.
MARGIN = (2.0, 2.0)
# Six full-length stems ship with the page, so they are encoded rather than kept
# as WAV. All of them carry the same encoder delay and stay aligned with each
# other, and with the alignment column they share.
COMPRESSION_LEVEL = 0.3


def stem_path(performance: str, stem: str) -> Path:
    return TARGET_DIR / f"{performance}_{stem}.mp3"


def main() -> None:
    refresh = "--refresh" in sys.argv or os.environ.get("REFRESH_DOCS_ASSETS") == "1"
    TARGET_DIR.mkdir(parents=True, exist_ok=True)

    pending = {
        performance: path
        for performance, path in PERFORMANCES.items()
        if refresh
        or any(not stem_path(performance, stem).exists() for stem in STEMS)
    }

    if not pending:
        print(
            f"docs/assets/separation: {len(PERFORMANCES) * len(STEMS)} files already present"
        )
        return

    print(f"docs/assets/separation: separating {len(pending)} recordings")

    for performance, path in pending.items():
        signal, sample_rate = librosa.load(path, sr=None, mono=True)
        stft = librosa.stft(signal, n_fft=N_FFT, hop_length=HOP_LENGTH)
        harmonic, percussive = librosa.decompose.hpss(stft, margin=MARGIN)
        spectra = {
            "harmonic": harmonic,
            "percussive": percussive,
            "residual": stft - (harmonic + percussive),
        }

        for stem, spectrum in spectra.items():
            samples = librosa.istft(
                spectrum, hop_length=HOP_LENGTH, length=len(signal)
            )
            target = stem_path(performance, stem)
            sf.write(
                target,
                samples.astype(np.float32),
                sample_rate,
                format="MP3",
                bitrate_mode="VARIABLE",
                compression_level=COMPRESSION_LEVEL,
            )
            print(f"{target.relative_to(ROOT)}: {target.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
