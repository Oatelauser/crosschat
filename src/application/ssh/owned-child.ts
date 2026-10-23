import type { DiscoverySshChild } from '../discovery/ssh.js';

/** Observe only this owner's child; signalling and its other listeners stay with the caller. */
export function observeSshChildClose(child: DiscoverySshChild): { wait(): Promise<boolean> } {
  let closed = false;
  let waiting: Promise<boolean> | undefined;
  let complete: ((closed: boolean) => void) | undefined;
  const onClose = () => { closed = true; complete?.(true); };
  child.once('close', onClose);
  return { wait() {
    waiting ??= new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      complete = (result) => {
        clearTimeout(timer);
        child.off('close', onClose);
        complete = undefined;
        resolve(result);
      };
      if (closed) complete(true);
      else timer = setTimeout(() => complete?.(false), 1000);
    });
    return waiting;
  } };
}
