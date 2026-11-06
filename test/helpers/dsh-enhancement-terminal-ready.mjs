// Synchronize the single keypress with a fresh enabled action in the owned PTY.
export async function openDshRenameForm({pty,from}) {
 await pty.waitForOutput(/<e> 原生改名(?= {2})/u,10000,from);
 const formMark=pty.output.length;
 pty.write('e');
 await pty.waitForOutput('原生会话新名称',10000,formMark);
}
