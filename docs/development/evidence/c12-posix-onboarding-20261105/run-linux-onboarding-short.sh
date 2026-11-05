set -eu
control_root=/mnt/d/workspace/CC/cc-dsh-onboarding-posix-20261105/node_modules/.cache/c12-posix-pty-20261105
task_root=$(mktemp -d /tmp/crosschat-c12-onboarding-short-20261105-XXXXXX)
printf '%s\n' "$task_root" > "$control_root/linux-short-root.txt"
collect() {
  task_status=$?
  trap - EXIT
  if [ -d "$task_root/repo/dsh-onboarding-evidence" ]; then
    tar -czf "$control_root/linux-short-onboarding-evidence.tgz" -C "$task_root/repo/dsh-onboarding-evidence" .
    python3 "$control_root/audit-short.py" "$task_root" > "$control_root/linux-short-disposition.json"
  fi
  if [ -f "$task_root/environment.json" ]; then cp "$task_root/environment.json" "$control_root/linux-short-environment.json"; fi
  printf '%s\n' "$task_status" > "$control_root/linux-short-exit-code.txt"
  exit "$task_status"
}
trap collect EXIT
mkdir -p "$task_root/repo" "$task_root/dev-npm-cache"
printf '%s\n' '{"task":"c12-posix-onboarding-short","date":"20261105"}' > "$task_root/ownership.json"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 180 https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz -o "$task_root/node.tar.xz"
(cd "$task_root"; printf '%s\n' '1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce  node.tar.xz' | sha256sum --check)
cp "$task_root/node.tar.xz" "$control_root/node22-linux.tar.xz"
tar -xJf "$task_root/node.tar.xz" -C "$task_root"
export PATH="$task_root/node-v22.23.4-linux-x64/bin:$PATH"
export TMPDIR=/tmp
export npm_config_cache="$task_root/dev-npm-cache"
export npm_config_userconfig="$task_root/npmrc"
touch "$npm_config_userconfig"
tar -xf "$control_root/source.tar" -C "$task_root/repo"
cd "$task_root/repo"
node -e 'console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,tmpdir:require("node:os").tmpdir()}))' > "$task_root/environment.json"
python3 --version
npm ci --no-audit --no-fund
npm run build
export CROSSCHAT_LIVE=1
export DSH_COMPAT_SUITE=onboarding
node scripts/dsh-compat-ci.mjs
