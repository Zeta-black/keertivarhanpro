from __future__ import annotations

import numpy as np


def sequence_count(length: int, alphabet_size: int) -> int:
    return alphabet_size ** length


def enumerate_codes(length: int = 8, alphabet_size: int = 6) -> np.ndarray:
    """Enumerate valid base-A sequences only; never the 2^(A*L) binary cube."""
    n = sequence_count(length, alphabet_size)
    numbers = np.arange(n, dtype=np.int64)
    result = np.empty((n, length), dtype=np.uint8)
    for position in range(length - 1, -1, -1):
        result[:, position] = numbers % alphabet_size
        numbers //= alphabet_size
    return result
