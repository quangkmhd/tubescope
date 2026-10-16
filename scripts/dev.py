"""Start local TubeScope services and clean up their process groups on exit."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def stop_process_groups(children: list[subprocess.Popen]) -> None:
    """A wrapper may exit before its npm/uv descendants: signal the whole group."""
    for child in reversed(children):
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def available(port: int) -> bool:
    with socket.socket() as sock:
        return sock.connect_ex(('127.0.0.1', port)) != 0


def wait_http(url: str, process: subprocess.Popen, timeout: int = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Dịch vụ dừng sớm (mã {process.returncode}). Xem log phía trên.')
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.3)
    raise RuntimeError(f'Dịch vụ chưa sẵn sàng sau {timeout} giây: {url}')


def main() -> int:
    parser = argparse.ArgumentParser(description='Chạy TubeScope thật trên máy này.')
    parser.add_argument('--skip-install', action='store_true', help='Bỏ qua kiểm tra/cài dependency.')
    parser.add_argument('--production', action='store_true', help='Build frontend rồi chạy next start.')
    parser.add_argument('--port', type=int, default=3000, help='Cổng frontend, mặc định3000.')
    parser.add_argument('--api-port', type=int, default=8765, help='Cổng backend, mặc định8765.')
    args = parser.parse_args()
    for tool in ('uv', 'npm', 'node'):
        if not shutil.which(tool):
            parser.error(f'Thiếu {tool}. Cài Node.js22+ và uv trước khi chạy.')
    if not (1 <= args.port <= 65535 and 1 <= args.api_port <= 65535) or args.port == args.api_port:
        parser.error('Hai cổng phải khác nhau và nằm trong khoảng1–65535.')
    for port in (args.port, args.api_port):
        if not available(port):
            parser.error(f'Cổng {port} đang được sử dụng. Chọn --port/--api-port khác hoặc dừng dịch vụ cũ.')
    if not args.skip_install:
        subprocess.run(['uv', 'sync', '--group', 'dev'], cwd=ROOT / 'backend', check=True)
        if not (ROOT / 'frontend/node_modules').exists():
            subprocess.run(['npm', 'ci'], cwd=ROOT / 'frontend', check=True)
    env = os.environ.copy()
    env['TUBESCOPE_API_URL'] = f'http://127.0.0.1:{args.api_port}'
    env['NEXT_TELEMETRY_DISABLED'] = '1'
    if args.production:
        subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'frontend', env=env, check=True)
    children: list[subprocess.Popen] = []

    def stop(_signal=None, _frame=None):
        stop_process_groups(children)

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        backend = subprocess.Popen(
            ['uv', 'run', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(args.api_port)],
            cwd=ROOT / 'backend', env=env, start_new_session=True,
        )
        children.append(backend)
        wait_http(f'http://127.0.0.1:{args.api_port}/api/health', backend)
        frontend = subprocess.Popen(
            ['npm', 'run', 'start' if args.production else 'dev', '--', '--hostname', '127.0.0.1', '--port', str(args.port)],
            cwd=ROOT / 'frontend', env=env, start_new_session=True,
        )
        children.append(frontend)
        wait_http(f'http://127.0.0.1:{args.port}', frontend)
        print(f'\nTubeScope: http://localhost:{args.port}\nAPI: http://127.0.0.1:{args.api_port}/docs\nNhấn Ctrl+C để dừng cả hai dịch vụ.\n', flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        codes = [child.returncode for child in children if child.poll() is not None]
        return 0 if all(code in (0, -signal.SIGTERM) for code in codes) else 1
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
