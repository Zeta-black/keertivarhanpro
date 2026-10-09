/**
 * Device capability detection, used to pick render quality rather than to
 * identify anyone. Nothing here is stored or sent anywhere.
 */

import type { DeviceCapability } from './types';

export function detectCapability(): DeviceCapability {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return {
      cores: 1,
      memoryGb: null,
      prefersReducedMotion: false,
      coarsePointer: false,
      tier: 'lite',
      reason: 'No browser environment detected; assuming the lightweight path.',
    };
  }

  const cores = navigator.hardwareConcurrency ?? 2;
  const memoryGb =
    (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
  const prefersReducedMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

  let tier: 'full' | 'lite' = 'full';
  let reason = `${cores} logical cores detected; full 3D scene enabled.`;

  if (prefersReducedMotion) {
    tier = 'lite';
    reason = 'Your system asks for reduced motion, so the still illustration is shown instead.';
  } else if (cores <= 2) {
    tier = 'lite';
    reason = `Only ${cores} logical core${cores === 1 ? '' : 's'} detected, so the lighter 2D illustration is used to keep the page smooth.`;
  } else if (memoryGb !== null && memoryGb <= 2) {
    tier = 'lite';
    reason = `About ${memoryGb} GB of device memory reported, so the lighter 2D illustration is used.`;
  }

  return { cores, memoryGb, prefersReducedMotion, coarsePointer, tier, reason };
}

/** Annealing and surrogate sizes scaled to what the device can actually do. */
export function tunedWorkload(capability: DeviceCapability): {
  surrogate: { trainSize: number; validationSize: number; testSize: number; enabled: boolean };
  annealing: { reads: number; sweeps: number; runs: number; enabled: boolean };
} {
  if (capability.tier === 'lite' || capability.cores <= 2) {
    return {
      surrogate: { trainSize: 1500, validationSize: 400, testSize: 400, enabled: true },
      annealing: { reads: 12, sweeps: 60, runs: 2, enabled: true },
    };
  }
  if (capability.cores <= 4) {
    return {
      surrogate: { trainSize: 3000, validationSize: 800, testSize: 800, enabled: true },
      annealing: { reads: 25, sweeps: 100, runs: 3, enabled: true },
    };
  }
  return {
    surrogate: { trainSize: 4000, validationSize: 1000, testSize: 1000, enabled: true },
    annealing: { reads: 40, sweeps: 120, runs: 3, enabled: true },
  };
}
