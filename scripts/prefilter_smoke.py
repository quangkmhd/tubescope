"""Measure the real optimized channel crawl; stores no synthetic production data."""
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode

base = 'http://127.0.0.1:8765/api'
source = 'https://www.youtube.com/channel/UCFMEYTv6N64hIL9FlQ_hxBw'

def request(path, body=None):
    req = Request(base + path, data=None if body is None else json.dumps(body).encode(),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=15) as response:
        return json.load(response)

started = time.monotonic()
job = request('/jobs', {'source_type': 'channel', 'sources': [source], 'mode': 'full',
                      'limit': 100, 'existing_policy': 'update',
                      'filters': {'duration_min': 1201, 'views_min': 1000000}})
while time.monotonic() - started < 240:
    job = request('/jobs/' + job['id'])
    if job['status'] not in ['queued', 'running']:
        break
    time.sleep(.5)
elapsed = round(time.monotonic() - started, 3)
report = {'seconds': elapsed, 'job': job}
output = Path(__file__).resolve().parents[1] / '.runtime/prefilter-smoke.json'
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
assert job['status'] == 'completed', job
assert job['scanned_count'] == 100, job
assert 0 < job['detailed_count'] < job['scanned_count'], job
assert job['prefiltered_count'] + job['detailed_count'] == job['scanned_count'], job
assert job['matched_count'] > 0 and job['failed_count'] == 0, job
rows = request('/videos?' + urlencode({'scope': 'job', 'job_id': job['id'], 'page_size': 100}))['items']
assert len(rows) == job['matched_count']
assert all(v['metadata_level'] == 'full' and v['duration'] >= 1201 and v['view_count'] >= 1000000 for v in rows)
print(json.dumps({'seconds': elapsed, 'job_id': job['id'], 'considered': job['scanned_count'],
                  'prefiltered': job['prefiltered_count'], 'detailed': job['detailed_count'],
                  'matched': job['matched_count'], 'failed': job['failed_count']}, ensure_ascii=False))
