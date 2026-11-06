// Owned external PTY seam, extracted from the original cross-operator driver.
export async function openDshRenameForm({pty,from}) {
 pty.write('e');
 await pty.waitForOutput('原生会话新名称',10000,from);
}
