/**
 * DTW alignment method.
 *
 * Uses basic Dynamic Time Warping with cosine distance cost matrix
 * from synctoolbox.dtw.core. Faster but lower quality than MrMsDTW.
 * Only uses chroma features (no onset features).
 */
export { getAlignmentMethod } from './alignment-method';
