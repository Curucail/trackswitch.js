import type { AlignmentMethodId } from '../types';

export interface AlignmentMethodConfig {
    featureRate: number;
}

export interface AlignmentMethod {
    id: AlignmentMethodId;
    name: string;
    /** Return the Python script that performs alignment given features are already extracted. */
    getPythonScript(config: AlignmentMethodConfig): string;
}

export function getAlignmentMethod(id: AlignmentMethodId): AlignmentMethod {
    switch (id) {
        case 'dtw':
            return dtwMethod;
        case 'mrmsdtw':
            return mrmsdtwMethod;
        default:
            return mrmsdtwMethod;
    }
}

const dtwMethod: AlignmentMethod = {
    id: 'dtw',
    name: 'DTW',
    getPythonScript(config: AlignmentMethodConfig): string {
        return `
import numpy as np
from synctoolbox.dtw.cost import cosine_distance
from synctoolbox.dtw.core import compute_warping_path
from synctoolbox.dtw.utils import make_path_strictly_monotonic

FEATURE_RATE = ${config.featureRate}

def align_pair(f_chroma_ref, f_chroma_other):
    C = cosine_distance(f_chroma_ref, f_chroma_other)
    D, E, wp = compute_warping_path(C)
    wp = make_path_strictly_monotonic(wp)
    return wp
`;
    },
};

const mrmsdtwMethod: AlignmentMethod = {
    id: 'mrmsdtw',
    name: 'MrMsDTW',
    getPythonScript(config: AlignmentMethodConfig): string {
        return `
import numpy as np
from synctoolbox.dtw.mrmsdtw import sync_via_mrmsdtw
from synctoolbox.dtw.utils import make_path_strictly_monotonic

FEATURE_RATE = ${config.featureRate}

def align_pair(f_chroma_ref, f_chroma_other, f_onset_ref=None, f_onset_other=None):
    step_weights = np.array([1.5, 1.5, 2.0])
    threshold_rec = 10 ** 6
    wp = sync_via_mrmsdtw(
        f_chroma1=f_chroma_ref,
        f_onset1=f_onset_ref,
        f_chroma2=f_chroma_other,
        f_onset2=f_onset_other,
        input_feature_rate=FEATURE_RATE,
        step_weights=step_weights,
        threshold_rec=threshold_rec,
        verbose=False,
    )
    wp = make_path_strictly_monotonic(wp)
    return wp
`;
    },
};
