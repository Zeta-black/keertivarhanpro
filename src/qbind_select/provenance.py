from __future__ import annotations

import platform
import subprocess
import sys
from datetime import datetime, timezone


def metadata(source_checksum, config, warnings):
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        commit = None
    return {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "git_commit": commit, "dataset_source_identifier": "set by benchmark", "source_checksum": source_checksum, "preprocessing_version": "0.1.0", "score_orientation": "higher canonical binding score = stronger predicted binding", "normalization_method": config["experiment"]["normalization"], "random_seed": config["reproducibility"]["seed"], "software": {"python": sys.version, "platform": platform.platform()}, "warnings": warnings, "d_wave_executed": False}
