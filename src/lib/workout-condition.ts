/**
 * Shared indoor/outdoor classification.
 *
 * Device exports use a handful of labels for treadmill sessions, so both the
 * personal-best store and the indoor/outdoor profiling must agree on a single
 * regex-based definition instead of comparing against a literal 'indoor'.
 */
export function getWorkoutCondition(location: string | undefined): 'indoor' | 'outdoor' {
  return /indoor|treadmill|gym|track\s*indoor/i.test(location ?? '') ? 'indoor' : 'outdoor';
}
