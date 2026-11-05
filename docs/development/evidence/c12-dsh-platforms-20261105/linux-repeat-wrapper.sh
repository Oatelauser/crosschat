set -eu
control_root=/mnt/d/workspace/CC/cc-dsh-platform-20261105/node_modules/.cache/c12-native-20261105/retry1
task_root=$(mktemp -d /tmp/crosschat-c12-dsh-20261105-XXXXXX)
printf '%s\n' "$task_root" > "$control_root/linux-root.txt"
collect() {
  task_status=$?
  trap - EXIT
  if [ -d "$task_root/repo/dsh-compat-evidence" ]; then
    tar -czf "$control_root/linux-communication-evidence.tgz" -C "$task_root/repo/dsh-compat-evidence" .
  fi
  if [ -f "$task_root/environment.json" ]; then cp "$task_root/environment.json" "$control_root/linux-environment.json"; fi
  printf '%s\n' "$task_status" > "$control_root/linux-exit-code.txt"
  exit "$task_status"
}
trap collect EXIT
mkdir -p "$task_root/repo" "$task_root/tmp" "$task_root/dev-npm-cache"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 180 https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz -o "$task_root/node.tar.xz"
(cd "$task_root"; printf '%s\n' '1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce  node.tar.xz' | sha256sum --check)
tar -xJf "$task_root/node.tar.xz" -C "$task_root"
export PATH="$task_root/node-v22.23.4-linux-x64/bin:$PATH"
export TMPDIR="$task_root/tmp"
export npm_config_cache="$task_root/dev-npm-cache"
export npm_config_userconfig="$task_root/npmrc"
export npm_config_globalconfig="$task_root/global-npmrc"
touch "$npm_config_userconfig" "$npm_config_globalconfig"
node -p 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})' > "$task_root/environment.json"
tar -xf "$control_root/source.tar" -C "$task_root/repo"
cd "$task_root/repo"
timeout --signal=TERM --kill-after=10s 300 npm ci --no-audit --no-fund
npm run build
export CROSSCHAT_LIVE=1
node scripts/dsh-compat-ci.mjs
