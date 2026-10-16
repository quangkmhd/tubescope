"""Small real-network checks for channel, Shorts and playlist source paths."""
import json
from pathlib import Path
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = 'http://127.0.0.1:8765/api'


def request(path, body=None):
    req = Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                  headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def wait(job):
    start = time.monotonic()
    while time.monotonic() - start < 180:
        result = request('/jobs/' + job['id'])
        if result['status'] not in ('queued', 'running'):
            if result['status'] not in ('completed', 'partial'):
                raise AssertionError(json.dumps(result, ensure_ascii=False))
            print(result['source_type'], result['mode'], result['status'], result['matched_count'], round(time.monotonic() - start, 2), flush=True)
            return result
        time.sleep(.4)
    raise TimeoutError(job['id'])


def crawl(source_type, sources, **options):
    return wait(request('/jobs', {'source_type': source_type, 'sources': sources,
                                 'limit': 2, 'mode': 'quick', **options}))


def videos(job):
    return request('/videos?' + urlencode({'scope': 'job', 'job_id': job['id']}))['items']


def main():
    checks = []
    mixed = crawl('channel', ['https://www.youtube.com/channel/UC-EPZk8dEqGgvNKpDdkMWJQ'])
    rows = videos(mixed)
    assert len(rows) == 2 and {row['content_type'] for row in rows} == {'video', 'shorts'}
    checks.append('Bare channel interleaves video and Shorts under global limit2')
    shorts = crawl('channel', ['https://www.youtube.com/channel/UC-EPZk8dEqGgvNKpDdkMWJQ'], filters={'content_types': ['shorts']})
    rows = videos(shorts)
    assert len(rows) == 2 and all(row['content_type'] == 'shorts' for row in rows)
    checks.append('Channel Shorts filter selects correct tab and preserves full classification')
    resources = crawl('keyword', ['ẩm thực Việt Nam'], native={'result_type': 'channels'})
    channels = request('/jobs/' + resources['id'] + '/resources')['items']
    assert channels and all(row['kind'] == 'channel' for row in channels)
    checks.append('Native channel search returns real channel resources')
    resources = crawl('keyword', ['ẩm thực Việt Nam'], native={'result_type': 'playlists'})
    playlists = request('/jobs/' + resources['id'] + '/resources')['items']
    assert playlists and all(row['kind'] == 'playlist' for row in playlists)
    checks.append('Native playlist search returns real playlist resources')
    playlist = playlists[0]
    playlist_job = crawl('playlist', [playlist['url']])
    playlist_videos = videos(playlist_job)
    assert playlist_videos
    saved = request('/library/save', {'video_ids': [row['id'] for row in playlist_videos]})
    if saved['job_id']:
        wait({'id': saved['job_id']})
    groups = request('/library/groups?kind=playlists')['items']
    assert any(row['key'] == playlist['id'] for row in groups)
    checks.append('Quick playlist saving enriches videos and preserves playlist membership')
    search = crawl('search', ['https://www.youtube.com/results?' + urlencode({'search_query': 'ẩm thực Việt Nam'})])
    assert videos(search)
    checks.append('Full YouTube search URL accepted and returns videos')
    video = playlist_videos[0]
    direct = crawl('video', [video['url']], mode='full')
    assert videos(direct)[0]['id'] == video['id']
    checks.append('Direct video source resolves canonical ID')
    output = Path('.runtime/source-smoke.json')
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps({'checks': checks, 'job_ids': [mixed['id'], shorts['id'], playlist_job['id'], search['id'], direct['id']], 'playlist': playlist}, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': checks}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
