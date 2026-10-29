// Synthetic process tables for the C14-W01 source probe. Shapes mirror the
// layouts measured on this machine; no real process data is stored here.
export const DESKTOP_EXE = 'C:/Users/u/AppData/Local/OpenAI/Codex/bin/08d187884f2330d1/codex.exe';
export const NPM_EXE =
  'C:/Users/u/AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
export const COMMAND_RUNNER = `${NPM_EXE.replace(/bin[\\/]codex\.exe$/, '')}codex-resources/codex-command-runner.exe`;
export const NODE_EXE = 'C:/Program Files/nodejs/node.exe';
export const CHATGPT_EXE = 'C:/Program Files/WindowsApps/OpenAI.Codex/ChatGPT.exe';
export const BASH_EXE = 'C:/Program Files/Git/bin/bash.exe';

export function tableText(rows) {
  return rows.map((row) => row.join('\t')).join('\n');
}

// [pid, ppid, createdAt, name, exePath]
export function cliChain({ executorPid = 300, probePid = 100 } = {}) {
  return tableText([
    [probePid, 200, 5000, 'node.exe', NODE_EXE],
    [200, executorPid, 4900, 'bash.exe', BASH_EXE],
    [executorPid, 400, 4800, 'codex.exe', NPM_EXE],
    [400, 500, 4700, 'node.exe', NODE_EXE],
    [500, 600, 4600, 'pwsh.exe', 'C:/Program Files/PowerShell/7/pwsh.exe'],
    [600, 0, 4500, 'explorer.exe', 'C:/Windows/explorer.exe'],
  ]);
}

export function desktopChain({ executorPid = 300, probePid = 100 } = {}) {
  return tableText([
    [probePid, 200, 5000, 'node.exe', NODE_EXE],
    [200, executorPid, 4900, 'bash.exe', BASH_EXE],
    [executorPid, 400, 4800, 'codex.exe', DESKTOP_EXE],
    [400, 600, 4700, 'ChatGPT.exe', CHATGPT_EXE],
    [600, 0, 4500, 'explorer.exe', 'C:/Windows/explorer.exe'],
  ]);
}

export function wrappedCliChain({ probePid = 100 } = {}) {
  return tableText([
    [probePid, 200, 5000, 'node.exe', NODE_EXE],
    [200, 250, 4900, 'bash.exe', BASH_EXE],
    [250, 300, 4850, 'codex-command-runner.exe', COMMAND_RUNNER],
    [300, 400, 4800, 'codex.exe', NPM_EXE],
    [400, 500, 4700, 'node.exe', NODE_EXE],
    [500, 0, 4600, 'pwsh.exe', 'C:/Program Files/PowerShell/7/pwsh.exe'],
  ]);
}
