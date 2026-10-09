from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import numpy as np

PLASTICS = ("PET", "PE", "PP")
CLASS_RESIDUES = {
    "AROM_W": ("TRP",), "AROM_FY": ("PHE", "TYR"),
    "HYDROPHOBIC": ("ALA", "VAL", "ILE", "LEU", "MET", "CYS"),
    "SMALL_POLAR": ("GLY", "SER", "THR", "ASN", "GLN"),
    "CHARGED_NEG": ("ASP", "GLU"), "CHARGED_POS": ("ARG", "LYS", "HIE"),
}
RESIDUE_CLASS = {residue: idx for idx, residues in enumerate(CLASS_RESIDUES.values()) for residue in residues}


def _coefficients(length: int = 8, alphabet_size: int = 6) -> dict:
    """Transparent deterministic PROXY / SYNTHETIC SCORING MODEL.

    Coefficients are deliberately not biological measurements. PET favours both
    aromatic classes, PE/PP favour HYDROPHOBIC; small fixed interactions make a
    quadratic benchmark. Values are canonical binding scores: higher is stronger.
    """
    bases = {
        "PET": np.array([1.30, 1.05, 0.18, 0.34, -0.18, 0.12]),
        "PE": np.array([0.12, 0.24, 1.22, 0.05, -0.22, 0.08]),
        "PP": np.array([0.25, 0.38, 1.00, 0.08, -0.18, 0.10]),
    }
    rng = np.random.default_rng(20261005)
    output = {}
    for plastic, base in bases.items():
        linear = np.tile(base, (length, 1)).astype(float)
        linear += rng.normal(0.0, 0.055, size=(length, alphabet_size))
        pair = np.zeros((length, length, alphabet_size, alphabet_size), dtype=float)
        for i in range(length):
            for j in range(i + 1, length):
                matrix = rng.normal(0.0, 0.045, size=(alphabet_size, alphabet_size))
                if plastic == "PET":
                    matrix[:2, :2] += 0.045  # aromatic co-occurrence proxy effect
                else:
                    matrix[2, 2] += 0.040  # hydrophobic co-occurrence proxy effect
                pair[i, j] = matrix
        output[plastic] = {"intercept": 0.0, "linear": linear, "pair": pair}
    return output


def save_proxy_model(path: Path, model: dict) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    arrays = {f"{p}_linear": model[p]["linear"] for p in PLASTICS}
    arrays.update({f"{p}_pair": model[p]["pair"] for p in PLASTICS})
    np.savez_compressed(path, **arrays)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_or_create_proxy(path: Path) -> tuple[dict, str]:
    if path.exists():
        z = np.load(path)
        model = {p: {"intercept": 0.0, "linear": z[f"{p}_linear"], "pair": z[f"{p}_pair"]} for p in PLASTICS}
        return model, hashlib.sha256(path.read_bytes()).hexdigest()
    model = _coefficients()
    return model, save_proxy_model(path, model)


def _parse_single(path: Path) -> dict:
    values = {}
    pattern = re.compile(r"Res\s+(\d+)\s+Type\s+(\S+)\s+(-?\d+(?:\.\d+)?)")
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.search(line)
        if match:
            position, residue, value = int(match.group(1)), match.group(2)[-3:], float(match.group(3))
            values[(position, residue)] = value
    return values


def _parse_pair(path: Path) -> dict:
    values = {}
    pattern = re.compile(r"Res\s+(\d+)\s+Type\s+\S+\s+Res\s+(\d+)\s+Type\s+\S+\s+(-?\d+(?:\.\d+)?)")
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.search(line)
        if match:
            # Parse residue tokens separately so terminal N/C prefixes are removed.
            tokens = line.split()
            first_type, second_type = tokens[3][-3:], tokens[7][-3:]
            values[(int(match.group(1)), first_type, int(match.group(2)), second_type)] = float(match.group(3))
    return values


def real_potts_coefficients(repo_root: Path, backbone: str = "bb1") -> dict:
    """Aggregate a public 20-aa Potts model into six classes for 8 central positions.

    QA-PBP-RL-Nexus supplies a 12-position, 19-aa energy model. Positions 2..9
    avoid its terminal residue encodings. Within each requested reduced class,
    one-body and two-body Potts energies are arithmetic-mean aggregated. Raw
    Potts energy is minimized by the source QUBO, so canonical binding score is
    its negative (higher is stronger predicted binding).
    """
    model = {}
    source_positions = tuple(range(2, 10))
    base = repo_root / "Data Folder" / "PottsModel_Energies"
    for plastic in PLASTICS:
        folder = base / plastic / backbone
        singles = _parse_single(folder / "SingleEnergy.txt")
        pairs = _parse_pair(folder / "PairwiseEnergy.txt")
        linear = np.zeros((8, 6), dtype=float)
        pair = np.zeros((8, 8, 6, 6), dtype=float)
        for i, source_i in enumerate(source_positions):
            for a, residues in enumerate(CLASS_RESIDUES.values()):
                vals = [singles[(source_i, r)] for r in residues if (source_i, r) in singles]
                if not vals: raise ValueError(f"missing {plastic} one-body class {a} at position {source_i}")
                linear[i, a] = -float(np.mean(vals))
            for j, source_j in enumerate(source_positions[i+1:], i+1):
                for a, residues_a in enumerate(CLASS_RESIDUES.values()):
                    for b, residues_b in enumerate(CLASS_RESIDUES.values()):
                        vals = [pairs[(source_i, ra, source_j, rb)] for ra in residues_a for rb in residues_b if (source_i, ra, source_j, rb) in pairs]
                        if not vals: raise ValueError(f"missing {plastic} pair class {a},{b} at positions {source_i},{source_j}")
                        pair[i, j, a, b] = -float(np.mean(vals))
        model[plastic] = {"intercept": 0.0, "linear": linear, "pair": pair}
    return model


def load_or_create_real(repo_root: Path, path: Path) -> tuple[dict, str]:
    if path.exists():
        z = np.load(path)
        model = {p: {"intercept": 0.0, "linear": z[f"{p}_linear"], "pair": z[f"{p}_pair"]} for p in PLASTICS}
        return model, hashlib.sha256(path.read_bytes()).hexdigest()
    model = real_potts_coefficients(repo_root)
    return model, save_proxy_model(path, model)


def score_codes(codes: np.ndarray, coefficients: dict) -> np.ndarray:
    codes = np.asarray(codes)
    n, length = codes.shape
    score = np.full(n, coefficients["intercept"], dtype=np.float64)
    for i in range(length):
        score += coefficients["linear"][i, codes[:, i]]
    for i in range(length):
        for j in range(i + 1, length):
            score += coefficients["pair"][i, j, codes[:, i], codes[:, j]]
    return score


def model_description() -> dict:
    return {"label": "PROXY / SYNTHETIC SCORING MODEL", "raw_score": "same as canonical_binding_score", "orientation": "higher score = stronger predicted binding", "coefficient_explanation": "PET linear class preference is aromatic-rich; PE/PP prefer hydrophobic class. Pair matrices are seeded, small (normal sigma 0.045) class co-occurrence proxy terms, with +0.045 aromatic PET or +0.040 hydrophobic PE/PP diagonal increments."}
