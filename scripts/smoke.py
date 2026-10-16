"""Real network acceptance check against a running TubeScope API.

Creates a small real crawl and saves its results. Review edits are restored.
Never substitutes fixtures for YouTube output.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
import time
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8765')
    parser.add_argument('--limit', type=int, default=3)
    parser.add_argument('--output', default='.runtime/smoke.json')
    args = parser.parse_args()
    base = args.base_url.rstrip('/') + '/api'
    evidence = {'base_url': args.base_url, 'checks': [], 'timings': {}}

    def request(path, body=None, method=None):
        data = None if body is None else json.dumps(body).encode()
        req = Request(base + path, data=data, method=method or ('POST' if body is not None else 'GET'),
                      headers={'Content-Type': 'application/json'})
        with urlopen(req, timeout=30) as response:
            value = response.read()
            return json.loads(value) if 'json' in response.headers.get('Content-Type', '') else value

    def check(name, predicate):
        if not predicate:
            raise AssertionError(name)
        evidence['checks'].append(name)
        print('PASS', name, flush=True)

    def await_job(job_id, timeout=240):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            job = request('/jobs/' + job_id)
            if job['status'] not in ('queued', 'running'):
                return job
            time.sleep(.5)
        raise TimeoutError(f'Job {job_id} did not finish in {timeout}s')

    health = request('/health')
    evidence['health'] = health
    check('backend healthy', health['status'] == 'ok')
    catalog = request('/catalog')
    check('17 approved metadata groups', len(catalog['metadata_groups']) == 17)
    started = time.monotonic()
    job = request('/jobs', {'source_type': 'keyword', 'sources': ['ẩm thực đường phố Việt Nam'],
                           'limit': args.limit, 'mode': 'full', 'existing_policy': 'update'})
    job = await_job(job['id'])
    evidence['job'] = job
    evidence['timings']['crawl_seconds'] = round(time.monotonic() - started, 3)
    check('live crawl produced results', job['status'] in ('completed', 'partial') and job['matched_count'] > 0)
    page = request('/videos?' + urlencode({'scope': 'job', 'job_id': job['id'], 'page_size': 2}))
    check('server pagination bounds rows', len(page['items']) <= 2 and page['total'] >= 1)
    all_rows = request('/videos?' + urlencode({'scope': 'job', 'job_id': job['id'], 'page_size': 100}))['items']
    ids = [row['id'] for row in all_rows]
    forbidden = {'comment_count', 'comments', 'heatmap', 'formats', 'automatic_captions', 'subtitles', 'fps', 'vcodec', 'acodec', 'bitrate'}
    check('metadata whitelist excludes removed fields', all(not (forbidden & set(row)) for row in all_rows))
    check('real canonical video IDs, no DEMO data', all(len(key) == 11 and not key.startswith('DEMO') for key in ids))
    saved = request('/library/save', {'video_ids': ids})
    if saved.get('job_id'):
        check('save enrichment completed', await_job(saved['job_id'])['status'] in ('completed', 'partial'))
    check('saved rows persisted through API reads', all(request('/videos/' + quote(key))['saved'] for key in ids))
    target = request('/videos/' + quote(ids[0]))
    before = {key: target[key] for key in ('review_status', 'notes', 'personal_tags')}
    review = {'review_status': 'keep', 'notes': 'Kiểm tra bảo toàn review khi cập nhật metadata.', 'personal_tags': ['kiểm-thử']}
    request('/videos/' + quote(ids[0]) + '/review', review, 'PATCH')
    try:
        readback = request('/videos/' + quote(ids[0]))
        check('review persisted', all(readback[key] == value for key, value in review.items()))
        refresh = request('/library/refresh', {'video_ids': [ids[0]]})
        result = await_job(refresh['id'])
        check('real refresh completed', result['status'] in ('completed', 'partial') and result['matched_count'] > 0)
        readback = request('/videos/' + quote(ids[0]))
        check('refresh preserved review', all(readback[key] == value for key, value in review.items()))
    finally:
        request('/videos/' + quote(ids[0]) + '/review', before, 'PATCH')
    stats = request('/library/stats')
    check('warehouse counts real saved videos', stats['saved_count'] >= len(ids))
    groups = request('/library/groups?kind=channels&page_size=24')
    check('channel hierarchy has saved groups', bool(groups['items']))
    group = groups['items'][0]
    inside = request('/videos?' + urlencode({'scope': 'library', 'group_kind': 'channels', 'group_key': group['key']}))
    check('channel drilldown counts match', inside['total'] == group['video_count'])
    title_word = next((word for word in target['title'].split() if len(word) > 3), None)
    if title_word:
        search = request('/videos?' + urlencode({'scope': 'library', 'q': title_word}))
        check('server search finds saved title', search['total'] > 0)
    csv_bytes = request('/export.csv?' + urlencode({'scope': 'job', 'job_id': job['id']}))
    exported = list(csv.DictReader(io.StringIO(csv_bytes.decode('utf-8-sig'))))
    check('CSV exports exactly this job', len(exported) == len(ids))
    check('CSV excludes removed fields', not any(any(word in field.lower() for word in ('comment', 'binh_luan', 'heatmap', 'codec', 'bitrate', 'fps')) for field in exported[0]))
    evidence['sample_video'] = {key: all_rows[0].get(key) for key in ('id', 'title', 'channel', 'categories', 'upload_date', 'like_count', 'metadata_level')}
    evidence['stats'] = stats
    evidence['video_ids'] = ids
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': len(evidence['checks']), 'evidence': str(output), 'crawl_seconds': evidence['timings']['crawl_seconds']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
