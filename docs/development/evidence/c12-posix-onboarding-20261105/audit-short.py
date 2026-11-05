import json
import os
import pathlib
import re
import sys
outer = pathlib.Path(sys.argv[1])
if not re.fullmatch(r'/tmp/crosschat-c12-onboarding-short-20261105-[A-Za-z0-9]{6}', str(outer)) or json.loads((outer / 'ownership.json').read_text()).get('task') != 'c12-posix-onboarding-short':
    raise ValueError('Unexpected task root')
summary = json.loads((outer / 'repo/dsh-onboarding-evidence/summary.json').read_text())
cache = summary.get('npmCache', {})
if cache.get('external') is not False:
    raise ValueError('Expected private default cache')
inner = pathlib.Path(cache['path']).parent
if not re.fullmatch(r'/tmp/crosschat-dsh-ci-[A-Za-z0-9]{6}', str(inner)):
    raise ValueError('Unexpected inner root')
active = []
for entry in pathlib.Path('/proc').iterdir():
    if not entry.name.isdigit() or int(entry.name) == os.getpid():
        continue
    try:
        command = (entry / 'cmdline').read_bytes()
    except FileNotFoundError:
        continue
    if str(outer).encode() in command or str(inner).encode() in command:
        active.append(int(entry.name))
print(json.dumps({'scope': 'Observed within the same WSL execution before its exit', 'innerRoot': str(inner), 'innerRootExists': inner.exists(), 'npmCacheExists': pathlib.Path(cache['path']).exists(), 'processesMatchingOwnedRoots': active, 'installationCleanup': summary.get('installationCleanup'), 'reportedReleaseIsNotInferredFromLaterRootAbsence': True}))
