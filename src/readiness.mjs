export function nativeReadiness(status, now = Date.now()) {
  if (!status || !Number.isFinite(status.checkedAt) || now - status.checkedAt > 15000 || now < status.checkedAt - 5000) {
    return { ready: false, issues: ['Open Igor Browser to enable human help.'], notifications: false };
  }
  const issues = [];
  if (!status.notifications) issues.push('Allow Igor Browser notifications and alerts in System Settings.');
  if (!status.login) issues.push('Enable Igor Browser at login in its setup window.');
  return { ready: issues.length === 0, issues, notifications: status.notifications === true };
}
export function helpDelivery(setup) {
  return setup.notifications ? 'notification' : 'setup-required';
}
