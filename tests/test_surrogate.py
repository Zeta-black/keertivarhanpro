import numpy as np
from qbind_select.enumerate_space import enumerate_codes
from qbind_select.features import feature_matrix
from qbind_select.score_model import _coefficients, score_codes
from qbind_select.surrogate import fit_surrogate, predict_qubo


def test_extracted_qubo_matches_ridge_prediction():
    codes = enumerate_codes()[:12000]
    scores = score_codes(codes, _coefficients()["PET"])
    fitted, metrics = fit_surrogate(codes, scores, 1e-6, 2, 7000, 2000, 2000)
    idx = np.arange(20)
    assert np.allclose(predict_qubo(codes[idx], fitted), fitted.model.predict(feature_matrix(codes[idx])), atol=1e-8)
    assert metrics["test"]["r2"] > .99
