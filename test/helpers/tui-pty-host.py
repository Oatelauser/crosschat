"""Linux PTY fixture host. The child session is the sole process owner boundary."""

import base64
import ctypes
import errno
import fcntl
import json
import os
import pty
import select
import selectors
import signal
import struct
import subprocess
import sys
import termios
import time


TERM_GRACE_SECONDS = 0.5
KILL_GRACE_SECONDS = 1.0
MAX_CONTROL_BYTES = 16 * 1024 * 1024
MAX_INPUT_BYTES = 8 * 1024 * 1024
EVENT_WRITE_TIMEOUT_SECONDS = 0.5


def emit(value):
    pending = memoryview((json.dumps(value, separators=(",", ":")) + "\n").encode("utf8"))
    deadline = time.monotonic() + EVENT_WRITE_TIMEOUT_SECONDS
    while pending:
        try:
            written = os.write(sys.stdout.fileno(), pending)
            pending = pending[written:]
        except BlockingIOError:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [sys.stdout.fileno()], [], remaining)[1]:
                raise RuntimeError("PTY event consumer did not drain its output pipe")


def dimensions(columns, rows):
    if (type(columns) is not int or type(rows) is not int
            or not 1 <= columns <= 32767 or not 1 <= rows <= 32767):
        raise ValueError("PTY dimensions must be integers from 1 to 32767")
    return struct.pack("HHHH", rows, columns, 0, 0)


def become_subreaper():
    # Adopt this child's orphaned descendants so they cannot remain zombies under
    # a container/WSL PID 1. Reaping below is restricted to the owned process group.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # Linux PR_SET_CHILD_SUBREAPER
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


class PtyHost:
    def __init__(self, spec):
        self.spec = spec
        self.child = None
        self.master = None
        self.slave = None
        self.selector = selectors.DefaultSelector()
        self.control_open = False
        self.master_open = False
        self.control_buffer = bytearray()
        self.input_buffer = bytearray()
        self.stop_at = None
        self.kill_at = None
        self.forced = False
        self.signal_requested = False

    def signal_group(self, signum):
        if self.child is None:
            return
        try:
            os.killpg(self.child.pid, signum)
        except ProcessLookupError:
            pass

    def group_alive(self):
        if self.child is None:
            return False
        try:
            os.killpg(self.child.pid, 0)
            return True
        except ProcessLookupError:
            return False

    def reap_descendants(self):
        if self.child is None or self.child.poll() is None:
            return
        # Popen first reaps the exact leader and preserves its real exit status.
        # Any same-group adopted children are exclusively this fixture's children.
        while True:
            try:
                pid, _status = os.waitpid(-self.child.pid, os.WNOHANG)
            except ChildProcessError:
                return
            if pid == 0:
                return

    def request_stop(self):
        if self.stop_at is None:
            self.stop_at = time.monotonic()
            self.input_buffer.clear()
            self.signal_group(signal.SIGTERM)
            self.update_master_interest()

    def update_master_interest(self):
        if self.master_open:
            mask = selectors.EVENT_READ
            if self.input_buffer:
                mask |= selectors.EVENT_WRITE
            self.selector.modify(self.master, mask, "pty")

    def close_master(self):
        if self.master_open:
            self.selector.unregister(self.master)
            self.master_open = False
            self.input_buffer.clear()

    def read_output(self):
        try:
            data = os.read(self.master, 65536)
        except BlockingIOError:
            return False
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        if data:
            emit({"event": "output", "data": base64.b64encode(data).decode("ascii")})
            return True
        self.close_master()
        self.request_stop()
        return False

    def write_input(self):
        if not self.input_buffer:
            return
        try:
            written = os.write(self.master, self.input_buffer)
        except BlockingIOError:
            return
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            self.close_master()
            self.request_stop()
            return
        del self.input_buffer[:written]
        self.update_master_interest()

    def command(self, command):
        if not isinstance(command, dict):
            raise ValueError("PTY control command must be an object")
        operation = command.get("op")
        if operation == "terminate":
            self.request_stop()
        elif operation == "write":
            data = command.get("data")
            if not isinstance(data, str):
                raise ValueError("PTY write data must be base64 text")
            decoded = base64.b64decode(data, validate=True)
            if len(self.input_buffer) + len(decoded) > MAX_INPUT_BYTES:
                raise ValueError("PTY input exceeded the 8 MiB pending limit")
            if self.stop_at is None and self.master_open:
                self.input_buffer.extend(decoded)
                self.update_master_interest()
        elif operation == "resize":
            size = dimensions(command.get("columns"), command.get("rows"))
            if self.stop_at is None and self.master_open:
                fcntl.ioctl(self.master, termios.TIOCSWINSZ, size)
                emit({"event": "resized", "columns": command["columns"], "rows": command["rows"]})
        else:
            raise ValueError("Unsupported PTY control operation")

    def read_control(self):
        try:
            data = os.read(sys.stdin.fileno(), 65536)
        except BlockingIOError:
            return
        if not data:
            self.selector.unregister(sys.stdin.fileno())
            self.control_open = False
            if self.control_buffer.strip():
                raise ValueError("PTY control input ended with an incomplete command")
            self.request_stop()
            return
        self.control_buffer.extend(data)
        if len(self.control_buffer) > MAX_CONTROL_BYTES:
            raise ValueError("PTY control input exceeded the 16 MiB limit")
        while b"\n" in self.control_buffer:
            line, remainder = self.control_buffer.split(b"\n", 1)
            self.control_buffer = bytearray(remainder)
            if line.strip():
                self.command(json.loads(line))

    def start(self):
        executable = self.spec.get("executable")
        args = self.spec.get("args")
        directory = self.spec.get("cwd")
        if (not isinstance(executable, str) or not executable
                or not isinstance(args, list) or not all(isinstance(value, str) for value in args)
                or not isinstance(directory, str) or not directory):
            raise ValueError("PTY fixture needs an executable, string arguments and working directory")
        size = dimensions(self.spec.get("columns"), self.spec.get("rows"))
        become_subreaper()
        self.master, self.slave = pty.openpty()
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, size)

        def attach_terminal():
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        self.child = subprocess.Popen([executable, *args], cwd=directory, stdin=self.slave,
                                      stdout=self.slave, stderr=self.slave, close_fds=True,
                                      start_new_session=True, preexec_fn=attach_terminal)
        os.close(self.slave)
        self.slave = None
        os.set_blocking(self.master, False)
        os.set_blocking(sys.stdin.fileno(), False)
        self.selector.register(self.master, selectors.EVENT_READ, "pty")
        self.master_open = True
        self.selector.register(sys.stdin.fileno(), selectors.EVENT_READ, "control")
        self.control_open = True
        signal.signal(signal.SIGTERM, lambda _signum, _frame: setattr(self, "signal_requested", True))
        signal.signal(signal.SIGINT, lambda _signum, _frame: setattr(self, "signal_requested", True))
        emit({"event": "ready", "pid": self.child.pid})

    def advance_cleanup(self):
        self.reap_descendants()
        if not self.group_alive():
            return True
        now = time.monotonic()
        if self.kill_at is None and now >= self.stop_at + TERM_GRACE_SECONDS:
            self.forced = True
            self.kill_at = now
            self.signal_group(signal.SIGKILL)
        if self.kill_at is not None and now >= self.kill_at + KILL_GRACE_SECONDS:
            raise RuntimeError("Owned PTY process group did not exit after SIGKILL")
        return False

    def run(self):
        self.start()
        while True:
            if self.signal_requested or self.child.poll() is not None:
                self.request_stop()
            if self.stop_at is not None and self.advance_cleanup():
                # All writers are gone; only drain bytes already buffered in the PTY.
                while self.master_open and self.read_output():
                    pass
                return
            for key, mask in self.selector.select(timeout=0.05):
                if key.data == "control":
                    self.read_control()
                elif self.master_open:
                    if mask & selectors.EVENT_READ:
                        self.read_output()
                    if self.master_open and mask & selectors.EVENT_WRITE:
                        self.write_input()

    def close(self):
        try:
            self.request_stop()
            # Errors also take the same bounded ownership cleanup path.
            while not self.advance_cleanup():
                if self.master_open:
                    self.read_output()
                time.sleep(0.02)
            if self.child is not None:
                self.child.wait(timeout=0)
            return {"complete": True, "descendantsStopped": True}
        finally:
            self.selector.close()
            for descriptor in (self.master, self.slave):
                if descriptor is not None:
                    os.close(descriptor)


def main():
    os.set_blocking(sys.stdout.fileno(), False)
    host = None
    failure = None
    cleanup = {"complete": True, "descendantsStopped": True}
    try:
        spec = json.loads(base64.b64decode(sys.argv[1], validate=True))
        if not isinstance(spec, dict):
            raise ValueError("PTY fixture specification must be an object")
        host = PtyHost(spec)
        host.run()
    except Exception as error:
        failure = error
    finally:
        if host is not None:
            try:
                cleanup = host.close()
            except Exception as error:
                cleanup = {"complete": False, "descendantsStopped": False}
                failure = failure or error
    if failure is not None:
        emit({"event": "error", "message": str(failure)})
    code = host.child.returncode if host is not None and host.child is not None else None
    emit({"event": "exit", "code": code if code is not None and code >= 0 else None,
          "signal": signal.Signals(-code).name if code is not None and code < 0 else None,
          "forced": host.forced if host is not None else False, "cleanup": cleanup})
    return 1 if failure is not None or not cleanup["complete"] else 0


if __name__ == "__main__":
    sys.exit(main())
