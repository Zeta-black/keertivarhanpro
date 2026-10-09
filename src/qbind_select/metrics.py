from __future__ import annotations

import numpy as np

from .alphabet import CLASSES


def candidate_metrics(codes, pet, pe, pp):
    codes = np.asarray(codes)
    fractions = {name: float(np.mean(codes == idx)) for idx, name in enumerate(CLASSES)}
    aromatic = fractions["AROM_W"] + fractions["AROM_FY"]
    hydrophobic = fractions["HYDROPHOBIC"]
    polar = fractions["SMALL_POLAR"]
    charge = fractions["CHARGED_POS"] - fractions["CHARGED_NEG"]
    mean_off = (pe + pp) / 2
    labels = []
    if hydrophobic >= .75: labels.append("HIGH_HYDROPHOBICITY")
    if fractions["CHARGED_NEG"] + fractions["CHARGED_POS"] >= .5: labels.append("HIGH_CHARGE")
    if pet - mean_off <= 0: labels.append("LOW_SELECTIVITY")
    if not labels: labels.append("BALANCED")
    return {"mean_offtarget": float(mean_off), "worst_offtarget": float(max(pe, pp)), "margin_mean": float(pet-mean_off), "margin_worst": float(pet-max(pe,pp)), "aromatic_fraction": aromatic, "hydrophobic_fraction": hydrophobic, "polar_fraction": polar, "net_charge_class_balance": charge, "warnings": ";".join(labels)}
