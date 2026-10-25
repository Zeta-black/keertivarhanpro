/* GENERATED FILE - do not edit.
 *
 * Written by scripts/export_quantum_summary.py from results/quantum_*.json|csv.
 * These are the measured numbers from the FULL-SIZE offline run: a 48-qubit
 * XY-mixer QAOA circuit over all 1,679,616 valid designs, simulated exactly
 * inside the one-hot feasible subspace, plus the penalty-QUBO control.
 *
 * NO QUANTUM HARDWARE WAS USED. No speedup is claimed: the reference every
 * ratio below is measured against is an exact brute-force optimum over the
 * same design space.
 *
 * Regenerate with:  py scripts/export_quantum_summary.py
 * Kept honest by:   web/tests/science/quantum-summary.test.ts
 */

export const QUANTUM_BENCHMARK = {
  "schema": "qbind-select/quantum-benchmark/1",
  "generatedBy": "scripts/export_quantum_summary.py",
  "source": "REAL PUBLIC DATA: QA-PBP-RL-Nexus PottsModel_Energies, PET/PE/PP bb1; arithmetic 20-aa-to-6-class aggregation; canonical binding score = negative raw Potts energy",
  "sourceChecksumSha256": "ea704a2f0ccc0af2d621262ea2d82f649c4cfda78145cd844c04277696cb683a",
  "seed": 42,
  "gitCommit": "bc28bd37ee7646522251cd28d68140e41174461a",
  "timestampUtc": "2026-10-24T13:38:04.468141+00:00",
  "quantumHardwareExecuted": false,
  "method": {
    "primary": "Quantum Alternating Operator Ansatz (QAOA with complete-graph XY mixers) on the one-hot feasible subspace",
    "reference": "Hadfield et al. 2019 (QAOA ansatz family); Farhi et al. 2014 (QAOA); Zhou et al. 2020 (INTERP seeding)",
    "control": "Penalty-QUBO QAOA with the standard transverse-field X mixer",
    "classical_reference": "exact brute force over the same design space",
    "lambda": 1.0,
    "optimiser": "Nelder-Mead simplex, multi-restart with INTERP depth seeding",
    "seed": 42
  },
  "simulation": {
    "engine": "NumPy exact statevector, float64/complex128",
    "hardware": "classical CPU",
    "quantum_hardware_executed": false,
    "nominal_circuit_width_qubits": 48,
    "naive_statevector_amplitudes": "2**48",
    "simulated_feasible_dimension": 1679616,
    "why_tractable": "The complete-graph XY mixer conserves Hamming weight inside every one-hot block, so a feasible initial state confines the dynamics to the 6**8 = 1,679,616-dimensional feasible sector. That sector is simulated exactly in 27 MB. This is a symmetry-sector simulation, not an approximation of the circuit.",
    "unmodelled_error": "The XY mixer is applied as an exact matrix exponential. Gate-model hardware must Trotterise non-commuting XY terms; that Trotter error, and all device noise, are NOT modelled."
  },
  "searchSpace": {
    "positions": 8,
    "classes": 6,
    "one_hot_binary_variables": 48,
    "valid_designs": 1679616,
    "proven_optimum_energy": -383.48736111111117,
    "proven_optimum_class_sequence": "HYDROPHOBIC-SMALL_POLAR-AROM_W-AROM_W-HYDROPHOBIC-HYDROPHOBIC-AROM_FY-HYDROPHOBIC",
    "proven_optimum_representative_sequence": "LSWWLLFL",
    "uniform_mean_energy": -77.68222820987656,
    "worst_energy": 155.47172222222218
  },
  "headline": {
    "best_depth": 3,
    "approximation_ratio": 0.8550313964410305,
    "random_baseline_ratio": 0.43260046567931865,
    "validity_rate": 1.0,
    "found_proven_optimum_as_most_likely_outcome": true,
    "optimum_probability": 0.004651104576124457,
    "enrichment_over_uniform_sampling": 7812.069663731855,
    "optimum_rank_by_probability": 1
  },
  "hardwareCostIfExecuted": {
    "qubits": 48,
    "qaoa_layers": 3,
    "trotter_steps_per_layer": 1,
    "w_state_prep_cnot": 80,
    "phase_separator_rz": 144,
    "phase_separator_zz": 3024,
    "phase_separator_cnot": 6048,
    "xy_pair_terms_per_layer": 120,
    "mixer_cnot": 720,
    "mixer_single_qubit": 1080,
    "cnot_total_lower_bound": 6848,
    "variational_parameters": 6,
    "caveats": [
      "LOWER BOUND: assumes all-to-all connectivity; limited-connectivity hardware needs SWAP insertion and would execute more.",
      "The simulation applies the XY mixer EXACTLY; hardware must Trotterise, and that Trotter error is not modelled anywhere in this repository.",
      "NOT EXECUTED on any quantum device."
    ]
  },
  "xyDepthSweep": [
    {
      "depth": 1,
      "nominal_qubits": 48,
      "simulated_dimension": 1679616,
      "variational_parameters": 2,
      "approximation_ratio": 0.742828634349348,
      "random_baseline_ratio": 0.43260046567931865,
      "validity_rate": 1.0,
      "most_likely_representative_sequence": "LSWWLLFL",
      "most_likely_energy": -383.48736111111117,
      "found_exact_optimum": true,
      "optimum_probability": 0.0006570595319488594,
      "optimum_rank": 1,
      "enrichment_over_uniform": 1103.6077028138154,
      "proven_optimum_energy": -383.48736111111117,
      "runtime_seconds": 101.40212989999964
    },
    {
      "depth": 2,
      "nominal_qubits": 48,
      "simulated_dimension": 1679616,
      "variational_parameters": 4,
      "approximation_ratio": 0.8193289563741512,
      "random_baseline_ratio": 0.43260046567931865,
      "validity_rate": 1.0,
      "most_likely_representative_sequence": "LSWWLLFL",
      "most_likely_energy": -383.48736111111117,
      "found_exact_optimum": true,
      "optimum_probability": 0.0024632506428881457,
      "optimum_rank": 1,
      "enrichment_over_uniform": 4137.315191805215,
      "proven_optimum_energy": -383.48736111111117,
      "runtime_seconds": 442.89328250000017
    },
    {
      "depth": 3,
      "nominal_qubits": 48,
      "simulated_dimension": 1679616,
      "variational_parameters": 6,
      "approximation_ratio": 0.8550313964410305,
      "random_baseline_ratio": 0.43260046567931865,
      "validity_rate": 1.0,
      "most_likely_representative_sequence": "LSWWLLFL",
      "most_likely_energy": -383.48736111111117,
      "found_exact_optimum": true,
      "optimum_probability": 0.004651104576124457,
      "optimum_rank": 1,
      "enrichment_over_uniform": 7812.069663731855,
      "proven_optimum_energy": -383.48736111111117,
      "runtime_seconds": 658.7349751000002
    }
  ],
  "penaltyControl": [
    {
      "depth": 1,
      "nominal_qubits": 12,
      "variational_parameters": 2,
      "penalty_P": 2059.2639844444443,
      "objective_span": 125.16704222222211,
      "approximation_ratio": 0.32609780321619247,
      "random_baseline_ratio": 0.325159096874318,
      "validity_rate": 0.25595081764382743,
      "runtime_seconds": 0.9591066000002684
    },
    {
      "depth": 2,
      "nominal_qubits": 12,
      "variational_parameters": 4,
      "penalty_P": 2059.2639844444443,
      "objective_span": 125.16704222222211,
      "approximation_ratio": 0.32715688697459094,
      "random_baseline_ratio": 0.325159096874318,
      "validity_rate": 0.43510624029565276,
      "runtime_seconds": 1.2471151999998256
    },
    {
      "depth": 3,
      "nominal_qubits": 12,
      "variational_parameters": 6,
      "penalty_P": 2059.2639844444443,
      "objective_span": 125.16704222222211,
      "approximation_ratio": 0.3272183827070842,
      "random_baseline_ratio": 0.325159096874318,
      "validity_rate": 0.4461969085307972,
      "runtime_seconds": 3.188962599999286
    }
  ],
  "warnings": [
    "All outputs are computational predictions, not biological validation.",
    "NO QUANTUM HARDWARE EXECUTION. Exact classical statevector simulation only.",
    "NO QUANTUM SPEEDUP IS CLAIMED OR DEMONSTRATED."
  ],
  "notes": [
    "Exact statevector simulation inside the one-hot feasible subspace. NO QUANTUM HARDWARE WAS USED.",
    "Nominal circuit width 48 qubits; simulated exactly in the 1679616-dimensional feasible sector the XY mixer cannot leave.",
    "Validity rate is 1.0 by construction (mixer-enforced), not by penalty tuning.",
    "NO QUANTUM SPEEDUP IS CLAIMED. Classical brute force over the same designs is faster here and returns a proven optimum; that optimum is the reference used above.",
    "The XY mixer is applied as an exact matrix exponential. Hardware would need a Trotterised approximation, whose error is NOT modelled here."
  ],
  "comparison": {
    "xyMarginOverRandom": 0.4224309307617119,
    "penaltyMarginOverRandom": 0.002059285832766211,
    "penaltyToSpanRatio": 16.452126277685927,
    "xyValidityRate": 1.0,
    "penaltyValidityRate": 0.4461969085307972,
    "xyBestDepth": 3,
    "penaltyBestDepth": 3
  }
} as const;

export type QuantumBenchmark = typeof QUANTUM_BENCHMARK;
