export function planEvaluationAlarm(state, currentAlarm, now, intervalMs) {
  if (state?.campaign?.status !== "ACTIVE" || (currentAlarm !== null && currentAlarm > now)) {
    return { scheduled: false, before: currentAlarm, after: currentAlarm };
  }
  return { scheduled: true, before: currentAlarm, after: now + intervalMs };
}
