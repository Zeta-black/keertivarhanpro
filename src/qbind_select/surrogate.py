from __future__ import annotations

from dataclasses import dataclass
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

from .features import feature_matrix, feature_to_qubo


@dataclass
class FittedSurrogate:
    model: Ridge
    linear: np.ndarray
    quadratic: dict


def fit_surrogate(codes, scores, alpha, seed, train_size, validation_size, test_size):
    total = train_size + validation_size + test_size
    rng = np.random.default_rng(seed)
    indices = rng.choice(len(codes), size=total, replace=False)
    X = feature_matrix(codes[indices])
    y = scores[indices]
    train_end = train_size
    valid_end = train_size + validation_size
    model = Ridge(alpha=alpha, fit_intercept=True).fit(X[:train_end], y[:train_end])
    output, fitted = {}, FittedSurrogate(model, *feature_to_qubo(model.coef_))
    for name, start, end in (("train", 0, train_end), ("validation", train_end, valid_end), ("test", valid_end, total)):
        pred = model.predict(X[start:end])
        actual = y[start:end]
        output[name] = {"count": int(end-start), "r2": float(r2_score(actual, pred)), "rmse": float(mean_squared_error(actual, pred) ** 0.5), "mae": float(mean_absolute_error(actual, pred))}
    return fitted, output


def predict_qubo(codes: np.ndarray, fitted: FittedSurrogate) -> np.ndarray:
    out = np.full(len(codes), fitted.model.intercept_, dtype=float)
    for i in range(8):
        out += fitted.linear[i * 6 + codes[:, i]]
    for i in range(8):
        for j in range(i + 1, 8):
            block = np.empty((6, 6), dtype=float)
            for a in range(6):
                for b in range(6):
                    block[a, b] = fitted.quadratic[(i * 6 + a, j * 6 + b)]
            out += block[codes[:, i], codes[:, j]]
    return out
