from __future__ import annotations

import time
import numpy as np


def solve(codes, pet, pe, pp, lam, tolerance=1e-8, top_n=10):
    started = time.perf_counter()
    objective = -pet + lam * (pe + pp)
    order = np.lexsort((np.arange(len(objective)), objective))
    best = objective[order[0]]
    return {"objective": objective, "order": order[:top_n], "best_index": int(order[0]), "best_energy": float(best), "optimum_hits": int(np.count_nonzero(np.abs(objective-best) <= tolerance)), "runtime_seconds": time.perf_counter()-started}
