#!/usr/bin/env python3
"""
PTY broker for the Taxonomy Editor web terminal.

Spawns a shell inside a real pseudo-terminal so interactive programs,
tab completion, and color output work. Bridges stdin/stdout of this
process to the PTY child. The Node.js server communicates via pipes:

  stdin  -> forwarded to PTY child (keystrokes)
  stdout <- forwarded from PTY child (terminal output)
  stderr <- forwarded from PTY child (error output, if any)

Resize: the server sends an OSC escape  \x1b]R;COLS;ROWS\x07  which
this broker intercepts and translates into a TIOCSWINSZ ioctl.
"""

import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios

COLS = int(os.environ.get("PTY_COLS", "120"))
ROWS = int(os.environ.get("PTY_ROWS", "30"))

RESIZE_RE = re.compile(rb"\x1b\]R;(\d+);(\d+)\x07")


def find_shell():
    for candidate in ("pwsh", "/usr/bin/pwsh", "bash", "/bin/bash", "sh"):
        for d in os.environ.get("PATH", "/usr/bin").split(":"):
            if os.path.isfile(os.path.join(d, candidate)):
                return candidate
    return "sh"


def set_winsize(fd, cols, rows):
    s = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)


def main():
    shell = find_shell()
    shell_args = [shell, "-NoLogo"] if "pwsh" in shell else [shell]

    pid, master_fd = pty.fork()

    if pid == 0:
        os.execvp(shell, shell_args)

    set_winsize(master_fd, COLS, ROWS)

    stdin_fd = sys.stdin.fileno()
    os.set_blocking(stdin_fd, False)
    os.set_blocking(master_fd, False)

    buf = b""

    def handle_sigchld(*_):
        pass

    signal.signal(signal.SIGCHLD, handle_sigchld)

    try:
        while True:
            try:
                rlist, _, _ = select.select([stdin_fd, master_fd], [], [], 1.0)
            except (OSError, ValueError):
                break

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 65536)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                except OSError:
                    break

            if stdin_fd in rlist:
                try:
                    data = os.read(stdin_fd, 65536)
                    if not data:
                        break
                except OSError:
                    break

                buf += data

                while True:
                    m = RESIZE_RE.search(buf)
                    if not m:
                        break
                    before = buf[: m.start()]
                    if before:
                        os.write(master_fd, before)
                    cols, rows = int(m.group(1)), int(m.group(2))
                    set_winsize(master_fd, cols, rows)
                    buf = buf[m.end() :]

                if buf:
                    try:
                        os.write(master_fd, buf)
                    except OSError:
                        break
                    buf = b""

            pid_result, status = os.waitpid(pid, os.WNOHANG)
            if pid_result != 0:
                break

    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass


if __name__ == "__main__":
    main()
