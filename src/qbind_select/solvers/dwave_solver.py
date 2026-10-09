from __future__ import annotations

def solve_if_configured(bqm):
    """Real Leap path; no results are created without credentials and a live run."""
    try:
        from dwave.system import LeapHybridSampler
        sampler = LeapHybridSampler()
        sample = sampler.sample(bqm).first
        return {"status": "EXECUTED", "energy": float(sample.energy), "sample": {str(k): int(v) for k,v in sample.sample.items()}}
    except Exception as exc:
        return {"status": "NOT EXECUTED - credentials/remote access unavailable", "reason": str(exc)}
