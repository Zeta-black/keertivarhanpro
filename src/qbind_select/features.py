from __future__ import annotations

import numpy as np


def pair_indices(length: int = 8):
    return [(i, j) for i in range(length) for j in range(i + 1, length)]


def feature_matrix(codes: np.ndarray, length: int = 8, alphabet_size: int = 6) -> np.ndarray:
    # Cached class codes are uint8 for compactness. Cast before adding feature
    # offsets: otherwise NumPy can wrap high pair-feature indexes at 255.
    codes = np.asarray(codes, dtype=np.int64)
    n = len(codes)
    # Float64 avoids a score-to-QUBO reconstruction discrepancy larger than the
    # configured 1e-8 solver tolerance.
    features = np.zeros((n, length * alphabet_size + len(pair_indices(length)) * alphabet_size**2), dtype=np.float64)
    rows = np.arange(n)
    for i in range(length):
        features[rows, i * alphabet_size + codes[:, i]] = 1.0
    offset = length * alphabet_size
    for pair_num, (i, j) in enumerate(pair_indices(length)):
        features[rows, offset + pair_num * alphabet_size**2 + codes[:, i] * alphabet_size + codes[:, j]] = 1.0
    return features


def feature_to_qubo(coef: np.ndarray, length: int = 8, alphabet_size: int = 6):
    linear = np.asarray(coef[: length * alphabet_size], dtype=float).copy()
    quadratic = {}
    offset = length * alphabet_size
    for pair_num, (i, j) in enumerate(pair_indices(length)):
        block = coef[offset + pair_num * alphabet_size**2: offset + (pair_num + 1) * alphabet_size**2].reshape(alphabet_size, alphabet_size)
        for a in range(alphabet_size):
            for b in range(alphabet_size):
                quadratic[(i * alphabet_size + a, j * alphabet_size + b)] = float(block[a, b])
    return linear, quadratic
