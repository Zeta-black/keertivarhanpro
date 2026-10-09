from pathlib import Path

import pytest

from qbind_select.score_model import PLASTICS, real_potts_coefficients, score_codes

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/raw/QA-PBP-RL-Nexus"

# The QA-PBP-RL-Nexus Potts files are ~23 MB and are not committed, so a clean
# checkout (CI included) will not have them. Skip rather than fail: the rest of
# the suite exercises the same code paths against the cached reduced model, and
# the browser-side parity gate in web/tests/science/parity.test.ts checks the
# exported coefficients independently.
requires_source = pytest.mark.skipif(
    not (SOURCE / "Data Folder" / "PottsModel_Energies").exists(),
    reason=(
        "QA-PBP-RL-Nexus source data not present. Clone it into "
        "data/raw/QA-PBP-RL-Nexus to run this test."
    ),
)


@requires_source
def test_public_potts_data_reduces_to_complete_six_class_eight_mer_model():
    import numpy as np

    model = real_potts_coefficients(SOURCE)
    for plastic in PLASTICS:
        assert model[plastic]["linear"].shape == (8, 6)
        assert model[plastic]["pair"].shape == (8, 8, 6, 6)
        assert score_codes(np.zeros((1, 8), dtype=int), model[plastic]).shape == (1,)


@requires_source
def test_pair_tensor_is_strictly_upper_triangular():
    """Only i<j blocks carry coefficients; the browser export relies on this."""
    import numpy as np

    model = real_potts_coefficients(SOURCE)
    for plastic in PLASTICS:
        pair = model[plastic]["pair"]
        for i in range(8):
            for j in range(0, i + 1):
                assert np.count_nonzero(pair[i, j]) == 0, (
                    f"{plastic} has coefficients at lower-triangular position ({i},{j}); "
                    "the 28-block export assumes i<j only"
                )


@requires_source
def test_reduced_model_matches_the_cached_npz_used_by_the_web_export():
    """The committed .npz must still equal what the source data reduces to.

    `scripts/export_web_model.py` ships the cached .npz to the browser. If the
    cache and the source ever disagree, the website would be showing numbers the
    published data does not support.
    """
    import numpy as np

    cache = ROOT / "data/processed/real_aggregated_potts_model.npz"
    if not cache.exists():
        pytest.skip("cached reduced model not generated yet")

    fresh = real_potts_coefficients(SOURCE)
    stored = np.load(cache)
    for plastic in PLASTICS:
        assert np.allclose(
            fresh[plastic]["linear"], stored[f"{plastic}_linear"], atol=1e-12
        ), f"{plastic} one-body terms differ between the source data and the cached model"
        assert np.allclose(
            fresh[plastic]["pair"], stored[f"{plastic}_pair"], atol=1e-12
        ), f"{plastic} two-body terms differ between the source data and the cached model"
