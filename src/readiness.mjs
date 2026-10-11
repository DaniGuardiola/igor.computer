export function nativeReadiness(status, now = Date.now()) {
  if (!status || !Number.isFinite(status.checkedAt) || now - status.checkedAt > 15000 || now < status.checkedAt - 5000) {
    return { ready: false, issues: ['Open igor.computer to enable human help.'], notifications: false };
  }
  const issues = [];
  if (!status.notifications) issues.push('Allow igor.computer notifications in System Settings.');
  if (!status.login) issues.push('Enable igor.computer at login in its setup window.');
  return { ready: issues.length === 0, issues, notifications: status.notifications === true, ...(status.notificationSettings ? { notificationSettings: status.notificationSettings } : {}) };
}
export function helpDelivery(setup) {
  return setup.notifications ? 'notification' : 'setup-required';
}
