import numpy as np
from qbind_select.alphabet import decode, encode, is_valid_one_hot


def test_encode_decode_round_trip():
    codes = np.array([0, 1, 2, 3, 4, 5, 0, 1])
    encoded = encode(codes)
    assert encoded.sum() == 8
    assert is_valid_one_hot(encoded)
    assert np.array_equal(decode(encoded), codes)


def test_invalid_one_hot_rejected():
    x = np.zeros(48, dtype=int)
    assert not is_valid_one_hot(x)
