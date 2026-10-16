import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('tubescope_dev', Path(__file__).resolve().parents[1] / 'scripts/dev.py')
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


def test_cleanup_terminates_descendants_after_the_wrapper_exits():
    stop_groups = getattr(dev, 'stop_process_groups', None)
    assert stop_groups is not None, 'Launcher needs cleanup independent of wrapper poll state'
    code = 'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(60)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); print(p.pid,flush=True)'
    parent = subprocess.Popen([sys.executable, '-c', code], stdout=subprocess.PIPE, text=True, start_new_session=True)
    child_pid = int(parent.stdout.readline())
    parent.wait(timeout=5)
    try:
        assert parent.poll() == 0
        stop_groups([parent])
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            state_path = Path(f'/proc/{child_pid}/stat')
            if not state_path.exists() or state_path.read_text().split()[2] == 'Z':
                return
            time.sleep(.02)
        raise AssertionError('Grandchild still running after process group cleanup')
    finally:
        try:
            os.killpg(parent.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
