import hashlib
import json
import pathlib
import re
import tarfile
import sys
root = pathlib.Path(__file__).parent
mode = sys.argv[1] if len(sys.argv) > 1 else 'first'
if mode not in ('first', 'short'):
    raise ValueError('Unexpected inspection mode')
destination = root / ('linux-' + mode + '-inspection')
destination.mkdir(exist_ok=True)
total = 0
entries = []
selected = []
names = set()
with tarfile.open(root / ('linux-short-onboarding-evidence.tgz' if mode == 'short' else 'linux-onboarding-evidence.tgz'), 'r:gz') as archive:
    for entry in archive:
        name = entry.name.removeprefix('./').rstrip('/')
        if entry.isdir() and name in ('', '.'):
            continue
        if len(entries) > 160 or name in names or name.startswith('/') or '\\' in name or ':' in name or '..' in name.split('/') or not (entry.isdir() or entry.isfile()):
            raise ValueError('Unsafe archive member')
        names.add(name)
        total += entry.size
        if entry.size > 8 * 1024 * 1024 or total > 128 * 1024 * 1024:
            raise ValueError('Archive byte budget')
        entries.append({'name': name, 'bytes': entry.size, 'directory': entry.isdir()})
        if entry.isdir():
            continue
        stream = archive.extractfile(entry)
        with stream:
            raw = stream.read(8 * 1024 * 1024 + 1)
        if len(raw) != entry.size:
            raise ValueError('Member length mismatch')
        entries[-1]['sha256'] = hashlib.sha256(raw).hexdigest()
        wanted = name == 'summary.json' or re.fullmatch(r'(baseline|candidate|retry)-(install|package-lock)\.json', name)
        match = re.fullmatch(r'(baseline|candidate|retry)-[^/]+/(report|process|native-skill-and-identity|retained-profile-chat-hashes|doctor-json|install-skills|update-skills|remove-plugin|uninstall-crosschat-data|tui-application|tui-terminal)\.(json|jsonl)', name)
        if not wanted and not match:
            continue
        if entry.size > 4 * 1024 * 1024:
            raise ValueError('JSON byte budget')
        file = name if wanted else match[1] + '-' + match[2] + '.' + match[3]
        if any(value['file'] == file for value in selected):
            raise ValueError('Duplicate selected evidence')
        text = raw.decode('utf-8', errors='strict')
        value = json.loads(text) if file.endswith('.json') else [json.loads(line) for line in text.splitlines() if line.strip()]
        output = destination / file
        if output.exists() and output.read_bytes() != raw:
            raise ValueError('Existing inspected evidence differs')
        if not output.exists():
            output.write_bytes(raw)
        selected.append({'file': file, 'entry': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
        if name == 'summary.json':
            print(json.dumps({key: value.get(key) for key in ('platform', 'arch', 'classification', 'error', 'installationCleanup', 'retainedInstallation', 'retainedTaskRoot')}))
        elif match and match[2] == 'report':
            print(json.dumps({key: value.get(key) for key in ('platform', 'arch', 'status', 'category', 'stage', 'check', 'error', 'cleanup')}))
        elif match and match[2] == 'process':
            print(json.dumps({key: value.get(key) for key in ('code', 'signal', 'timedOut', 'stderr')}))
(destination / 'index.json').write_text(json.dumps({'entries': entries, 'selected': selected, 'expandedBytes': total}, indent=2) + '\n', encoding='utf-8')
