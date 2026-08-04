export function planEvaluationAlarm(state, currentAlarm, now, intervalMs) {
  if (state?.campaign?.status !== "ACTIVE" || currentAlarm !== null) {
    return { scheduled: false, before: currentAlarm, after: currentAlarm };
  }
  return { scheduled: true, before: null, after: now + intervalMs };
}
