"""Metadata-only, bounded, cancellable yt-dlp subprocess adapter."""

from __future__ import annotations

import json
import os
import selectors
import signal
import subprocess
import sys
import threading
import time
from importlib.metadata import version


class ExtractionCancelled(Exception):
    pass


class Extractor:
    def __init__(self, command=None, timeout=90):
        self.command = command or [sys.executable, "-m", "yt_dlp"]
        self.timeout = timeout
        self.version = version("yt-dlp")

    @staticmethod
    def _stop(process):
        # Kill the session as well as the immediate process; JS runtimes inherit it.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=3)

    def extract(self, url, *, flat=False, limit=100, start=None, end=None, cancel=None):
        cancel = cancel or threading.Event()
        if cancel.is_set():
            raise ExtractionCancelled()
        args = [
            *self.command,
            "--ignore-config",
            "--no-cache-dir",
            "--no-cookies",
            "--simulate",
            "--skip-download",
            "--no-write-comments",
            "--no-write-subs",
            "--no-write-auto-subs",
            "--no-write-thumbnail",
            "--no-write-info-json",
            "--socket-timeout",
            "12",
            "--extractor-retries",
            "1",
            "--retries",
            "1",
            "--js-runtimes",
            "node",
            "--ignore-no-formats-error",
            "--no-progress",
            "--dump-single-json",
        ]
        if flat:
            args.extend(
                [
                    "--flat-playlist",
                    "--playlist-start",
                    str(start or 1),
                    "--playlist-end",
                    str(
                        min(
                            end if end is not None else 1000000,
                            (start or 1) + limit - 1,
                        )
                    ),
                ]
            )
        else:
            args.append("--no-playlist")
        args.extend(["--", url])
        # Drain both pipes continuously into bounded memory. Raw extractor JSON never touches disk.
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            stdin=subprocess.DEVNULL,
        )
        selector = selectors.DefaultSelector()
        out = bytearray()
        err = bytearray()
        for stream in (process.stdout, process.stderr):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ)
        deadline = time.monotonic() + self.timeout
        try:
            while selector.get_map():
                if cancel.is_set():
                    raise ExtractionCancelled()
                if time.monotonic() > deadline:
                    raise TimeoutError(
                        f"yt-dlp vượt thời gian chờ {self.timeout:g} giây."
                    )
                for key, _ in selector.select(timeout=0.05):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    target = out if key.fileobj is process.stdout else err
                    target.extend(chunk)
                    if len(out) > 64 * 1024 * 1024 or len(err) > 4 * 1024 * 1024:
                        raise RuntimeError(
                            "Dữ liệu phản hồi yt-dlp vượt giới hạn an toàn."
                        )
            # A child may close its output before exiting; keep cancellation active
            # through that final wait instead of blocking in Popen.wait().
            while process.poll() is None:
                if cancel.wait(0.05):
                    raise ExtractionCancelled()
                if time.monotonic() > deadline:
                    raise TimeoutError(
                        f"yt-dlp vượt thời gian chờ {self.timeout:g} giây."
                    )
            if cancel.is_set():
                raise ExtractionCancelled()
            if process.returncode:
                error = err[-3000:].decode("utf-8", errors="replace").strip()
                raise RuntimeError(
                    error or f"yt-dlp thoát với mã {process.returncode}."
                )
            result = json.loads(out)
            if not isinstance(result, dict):
                raise RuntimeError("yt-dlp không trả về metadata hợp lệ.")
            return result
        finally:
            selector.close()
            self._stop(process)
            process.stdout.close()
            process.stderr.close()
