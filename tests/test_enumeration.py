import numpy as np
from qbind_select.enumerate_space import enumerate_codes, sequence_count


def test_full_search_space_cardinality_and_unique_endpoints():
    assert sequence_count(8, 6) == 1_679_616
    codes = enumerate_codes()
    assert codes.shape == (1_679_616, 8)
    assert np.array_equal(codes[0], np.zeros(8, dtype=np.uint8))
    assert np.array_equal(codes[-1], np.full(8, 5, dtype=np.uint8))
