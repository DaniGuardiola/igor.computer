export function windowCommand(action, args = {}) {
  if (!['list', 'focus', 'close', 'restore'].includes(action)) throw new Error('Unknown window action.');
  if (action !== 'list' && (typeof args.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(args.generation))) throw new Error('Refresh the browser window list.');
  if (['focus', 'close'].includes(action) && (typeof args.id !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(args.id))) throw new Error('Invalid window ID.');
  return ['python3', '/opt/igor-computer/windows.py', action,
    ...(action === 'list' ? [] : [args.id || '', args.generation])];
}
