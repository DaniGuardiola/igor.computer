import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('RAM resume refreshes resolver forwarding from current Lima environment before readiness', () => {
  execFileSync('python3', ['-c', `
import pathlib, runpy, subprocess, tempfile
from unittest.mock import patch
with tempfile.TemporaryDirectory() as directory:
 root = pathlib.Path(directory)
 (root / 'mnt/lima-cidata').mkdir(parents=True)
 (root / 'run').mkdir()
 (root / 'mnt/lima-cidata/meta-data').write_text('instance-id: new-boot\\n')
 (root / 'run/lima-ssh-ready').write_text('old-boot\\n')
 (root / 'run/lima-boot-done').write_text('old-boot\\n')
 actual_path = pathlib.Path
 def path(value): return actual_path(root / value.lstrip('/'))
 calls = []
 def call(args):
  calls.append(args)
  if args[:2] == ['/bin/sh', '-c']:
   assert '. /mnt/lima-cidata/lima.env' in args[2]
   assert '09-host-dns-setup.sh' in args[2]
   assert (root / 'run/lima-ssh-ready').read_text() == 'old-boot\\n'
 with patch('pathlib.Path', path), patch('subprocess.check_output', return_value='/dev/vdb\\n'), patch('subprocess.check_call', side_effect=call):
  runpy.run_path('vm/resume-guest.py')
 assert calls[:3] == [['umount', '/mnt/lima-cidata'], ['blockdev', '--flushbufs', '/dev/vdb'], ['mount', '-o', 'ro', '/dev/vdb', '/mnt/lima-cidata']]
 assert len(calls) == 4
 assert (root / 'run/lima-ssh-ready').read_text() == 'new-boot\\n'
 assert (root / 'run/lima-boot-done').read_text() == 'new-boot\\n'
 # Failure must not mark this partially restored guest ready.
 (root / 'run/lima-ssh-ready').write_text('old-boot\\n')
 def fail(args):
  if args[:2] == ['/bin/sh', '-c']: raise subprocess.CalledProcessError(1, args)
 with patch('pathlib.Path', path), patch('subprocess.check_output', return_value='/dev/vdb\\n'), patch('subprocess.check_call', side_effect=fail):
  try: runpy.run_path('vm/resume-guest.py'); raise AssertionError('Expected failure')
  except subprocess.CalledProcessError: pass
 assert (root / 'run/lima-ssh-ready').read_text() == 'old-boot\\n'
`]);
});
