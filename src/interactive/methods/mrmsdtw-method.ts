/**
 * MrMsDTW (Memory-Restricted Multi-Scale DTW) alignment method.
 *
 * Uses multi-resolution alignment with both chroma and DLNCO onset features
 * from synctoolbox.dtw.mrmsdtw. Higher quality but slower than basic DTW.
 * This is the default and recommended alignment method.
 */
export { getAlignmentMethod } from './alignment-method';
