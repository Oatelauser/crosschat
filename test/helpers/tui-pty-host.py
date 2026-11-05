"""Single-threaded POSIX fixture host for the existing JSON PTY driver protocol."""
import base64
import errno
import fcntl
import json
import os
import pty
import selectors
import signal
import struct
import subprocess
import sys
import termios
import time


def emit(value):
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()


def dimensions(columns, rows):
    if any(type(value) is not int or not 1 <= value <= 1000 for value in (columns, rows)):
        raise ValueError("Fixture dimensions must be integers from 1 to 1000")
    return struct.pack("HHHH", rows, columns, 0, 0)


def own_terminal():
    # This Python host has one thread. The child gets its own session and
    # controlling terminal before exec; Popen still reports exec failures.
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def main():
    master = slave = None
    child = None
    selector = selectors.DefaultSelector()
    requested = False
    forced = False
    stopping_at = None
    master_open = True
    pending = bytearray()
    control = bytearray()

    def request_stop(*_):
        nonlocal requested
        requested = True

    def group_exists():
        if child is None:
            return False
        try:
            os.killpg(child.pid, 0)
            return True
        except ProcessLookupError:
            return False

    def send_signal(number):
        try:
            os.killpg(child.pid, number)
        except ProcessLookupError:
            pass

    def read_output():
        nonlocal master_open
        try:
            data = os.read(master, 65536)
        except BlockingIOError:
            return False
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b""
        if not data:
            master_open = False
            selector.unregister(master)
            return False
        emit({"event": "output", "data": base64.b64encode(data).decode("ascii")})
        return True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    try:
        if len(sys.argv) != 2 or len(sys.argv[1]) > 1024 * 1024:
            raise ValueError("Expected one bounded launch payload")
        launch = json.loads(base64.b64decode(sys.argv[1], validate=True).decode("utf-8"))
        if (not isinstance(launch, dict) or not isinstance(launch.get("executable"), str)
                or not launch["executable"] or not isinstance(launch.get("args"), list)
                or not all(isinstance(value, str) for value in launch["args"])
                or not isinstance(launch.get("cwd"), str) or not os.path.isabs(launch["cwd"])):
            raise ValueError("Invalid fixture executable, argv or working directory")
        size = dimensions(launch.get("columns"), launch.get("rows"))
        master, slave = pty.openpty()
        fcntl.ioctl(master, termios.TIOCSWINSZ, size)
        environment = os.environ.copy()
        if environment.get("TERM") in (None, "dumb"):
            environment["TERM"] = "xterm-256color"
        child = subprocess.Popen([launch["executable"], *launch["args"]],
                                 stdin=slave, stdout=slave, stderr=slave,
                                 cwd=launch["cwd"], env=environment, shell=False,
                                 close_fds=True, preexec_fn=own_terminal)
        os.close(slave)
        slave = None
        os.set_blocking(master, False)
        os.set_blocking(0, False)
        selector.register(master, selectors.EVENT_READ, "terminal")
        selector.register(0, selectors.EVENT_READ, "control")
        emit({"event": "ready", "pid": child.pid})
        while True:
            code = child.poll()
            if (requested or code is not None) and stopping_at is None:
                stopping_at = time.monotonic()
                send_signal(signal.SIGTERM)
            if stopping_at is not None:
                elapsed = time.monotonic() - stopping_at
                if code is not None and not group_exists():
                    while master_open and read_output():
                        pass
                    break
                if elapsed >= 1.0 and not forced:
                    forced = True
                    send_signal(signal.SIGKILL)
                if elapsed >= 2.2:
                    raise RuntimeError("Owned fixture process group did not release")
            for key, events in selector.select(0.03):
                if key.data == "terminal":
                    if events & selectors.EVENT_READ and master_open:
                        read_output()
                    if events & selectors.EVENT_WRITE and pending and master_open:
                        try:
                            del pending[:os.write(master, pending)]
                        except BlockingIOError:
                            pass
                        if not pending:
                            selector.modify(master, selectors.EVENT_READ, "terminal")
                else:
                    data = os.read(0, 65536)
                    if not data:
                        selector.unregister(0)
                        request_stop()
                        continue
                    control.extend(data)
                    if len(control) > 1024 * 1024:
                        raise ValueError("Fixture control input exceeds its budget")
                    while b"\n" in control:
                        line, _, control = control.partition(b"\n")
                        value = json.loads(line.decode("utf-8"))
                        if not isinstance(value, dict):
                            raise ValueError("Invalid fixture control record")
                        if value.get("op") == "terminate":
                            request_stop()
                        elif value.get("op") == "resize":
                            size = dimensions(value.get("columns"), value.get("rows"))
                            if master_open:
                                fcntl.ioctl(master, termios.TIOCSWINSZ, size)
                        elif value.get("op") == "write" and isinstance(value.get("data"), str):
                            data = base64.b64decode(value["data"], validate=True)
                            if len(pending) + len(data) > 1024 * 1024:
                                raise ValueError("Fixture terminal input exceeds its budget")
                            pending.extend(data)
                            if pending and master_open:
                                selector.modify(master, selectors.EVENT_READ | selectors.EVENT_WRITE, "terminal")
                        else:
                            raise ValueError("Unknown fixture control operation")
        emit({"event": "cleanup", "forced": forced, "groupReleased": True})
        emit({"event": "exit", "code": child.returncode})
        return 0
    except Exception as error:
        try:
            emit({"event": "error", "message": str(error)})
        except BrokenPipeError:
            pass
        return 1
    finally:
        if child is not None:
            if group_exists():
                send_signal(signal.SIGKILL)
            child.wait(timeout=2)
        selector.close()
        for descriptor in (master, slave):
            if descriptor is not None:
                os.close(descriptor)


if __name__ == "__main__":
    sys.exit(main())
