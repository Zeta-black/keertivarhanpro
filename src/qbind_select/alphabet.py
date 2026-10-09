from __future__ import annotations

import numpy as np

CLASSES = ("AROM_W", "AROM_FY", "HYDROPHOBIC", "SMALL_POLAR", "CHARGED_NEG", "CHARGED_POS")
REPRESENTATIVES = ("W", "F", "L", "S", "E", "K")


def variable_index(position: int, amino_class: int, alphabet_size: int = 6) -> int:
    return position * alphabet_size + amino_class


def encode(classes: np.ndarray, length: int = 8) -> np.ndarray:
    classes = np.asarray(classes, dtype=np.int8)
    if classes.shape != (length,) or np.any((classes < 0) | (classes >= len(CLASSES))):
        raise ValueError("expected an 8-position sequence of class indices 0..5")
    x = np.zeros(length * len(CLASSES), dtype=np.int8)
    x[np.arange(length) * len(CLASSES) + classes] = 1
    return x


def decode(x: np.ndarray, length: int = 8) -> np.ndarray:
    x = np.asarray(x, dtype=int).reshape(length, len(CLASSES))
    if not np.all(x.sum(axis=1) == 1):
        raise ValueError("invalid one-hot encoding")
    return x.argmax(axis=1).astype(np.int8)


def class_sequence(codes: np.ndarray) -> str:
    return "-".join(CLASSES[int(i)] for i in codes)


def representative_sequence(codes: np.ndarray) -> str:
    return "".join(REPRESENTATIVES[int(i)] for i in codes)


def is_valid_one_hot(x: np.ndarray, length: int = 8) -> bool:
    x = np.asarray(x, dtype=int)
    return x.size == length * len(CLASSES) and bool(np.all(x.reshape(length, len(CLASSES)).sum(axis=1) == 1))
