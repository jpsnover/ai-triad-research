#!/usr/bin/env python3
"""
PTY broker — allocates a real pseudo-terminal for a shell process
and bridges stdin/stdout over pipes so Electron can communicate with it.
Uses only Python stdlib (pty, os, select, sys).
"""

import pty, os, sys, select, signal, struct, fcntl, termios

SHELL = os.environ.get('SHELL_PWSH', None)
if SHELL is None:
    # Auto-detect pwsh location
    for candidate in ['/usr/local/bin/pwsh', '/opt/microsoft/powershell/7/pwsh', '/usr/local/microsoft/powershell/7/pwsh']:
        if os.path.isfile(candidate):
            SHELL = candidate
            break
    if SHELL is None:
        SHELL = 'pwsh'  # fall back to PATH lookup
COLS = int(os.environ.get('PTY_COLS', '120'))
ROWS = int(os.environ.get('PTY_ROWS', '30'))

def set_winsize(fd, rows, cols):
    s = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)

def main():
    # Fork with a PTY
    pid, master_fd = pty.fork()

    if pid == 0:
        # Child — exec the shell
        os.environ['TERM'] = 'xterm-256color'
        os.execlp(SHELL, SHELL, '-NoLogo')
        sys.exit(1)

    # Parent — set initial window size
    set_winsize(master_fd, ROWS, COLS)

    # Make stdin non-blocking
    import fcntl as fcntl2
    flags = fcntl2.fcntl(sys.stdin.fileno(), fcntl2.F_GETFL)
    fcntl2.fcntl(sys.stdin.fileno(), fcntl2.F_SETFL, flags | os.O_NONBLOCK)

    # Bridge: stdin → master, master → stdout
    try:
        while True:
            rlist, _, _ = select.select([master_fd, sys.stdin.fileno()], [], [], 0.05)

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 65536)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                except OSError:
                    break

            if sys.stdin.fileno() in rlist:
                try:
                    data = sys.stdin.buffer.read(65536)
                    if data:
                        # Check for resize escape: \x1b]R;COLS;ROWS\x07
                        if b'\x1b]R;' in data:
                            idx = data.index(b'\x1b]R;')
                            end = data.index(b'\x07', idx)
                            parts = data[idx+4:end].decode().split(';')
                            if len(parts) == 2:
                                c, r = int(parts[0]), int(parts[1])
                                set_winsize(master_fd, r, c)
                                os.kill(pid, signal.SIGWINCH)
                            # Remove the escape from data
                            data = data[:idx] + data[end+1:]
                        if data:
                            os.write(master_fd, data)
                except (OSError, BlockingIOError):
                    pass

    except KeyboardInterrupt:
        pass
    finally:
        os.close(master_fd)
        try:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
        except (OSError, ChildProcessError):
            pass

if __name__ == '__main__':
    main()
