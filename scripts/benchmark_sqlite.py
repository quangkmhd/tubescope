"""Exercise warehouse paging/search on 100k synthetic rows in a temporary DB.

This never writes fixtures into the real app warehouse. It measures local SQL,
not YouTube crawling speed or concurrent production throughput.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from tubescope.core import normalize  # noqa: E402
from tubescope.database import Database  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rows', type=int, default=100000)
    parser.add_argument('--output', default='.runtime/sqlite-benchmark.json')
    args = parser.parse_args()
    stamp = '2026-10-16T00:00:00+00:00'
    result = {'rows': args.rows, 'synthetic': True, 'temporary_database': True, 'milliseconds': {}}
    with tempfile.TemporaryDirectory(prefix='tubescope-scale-') as directory:
        db = Database(Path(directory) / 'scale.sqlite3')
        started = time.perf_counter()

        def rows():
            for i in range(args.rows):
                video_id = f'T{i:010d}'
                channel_id = f'UC_BENCH_{i % 2000:04d}'
                title = f'Nghiên cứu video số {i}'
                value = normalize({'id': video_id, 'title': title, 'channel': f'Kênh {i % 2000}',
                                   'channel_id': channel_id, 'duration': i % 7200,
                                   'view_count': i * 10, 'upload_date': '20261010',
                                   'description': 'Dữ liệu tổng hợp chỉ dành cho kiểm tra SQLite.',
                                   'tags': ['nghiên cứu'], 'categories': ['Education']})
                yield (video_id, json.dumps(value, ensure_ascii=False), title, value['channel'],
                       channel_id, value['duration'], value['view_count'], value['upload_date'],
                       value['content_type'], stamp, stamp)

        with db.conn:
            db.conn.executemany('INSERT INTO videos(id,data,title,channel,channel_id,duration,view_count,upload_date,content_type,updated_at,saved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', rows())
            db.conn.execute("INSERT INTO video_fts(rowid,id,title,channel,description,tags) SELECT rowid,id,title,channel,json_extract(data,'$.description'),'nghiên cứu' FROM videos")
            db.conn.execute("INSERT INTO video_categories SELECT id,'27','Education' FROM videos")
        result['seed_seconds'] = round(time.perf_counter() - started, 3)

        def measure(name, fn):
            start = time.perf_counter()
            value = fn()
            result['milliseconds'][name] = round((time.perf_counter() - start) * 1000, 2)
            return value

        page = measure('videos_first50', lambda: db.videos(page=1, page_size=50))
        assert page['total'] == args.rows and len(page['items']) == min(args.rows, 50)
        if args.rows > 50000:
            deep = measure('videos_page1000', lambda: db.videos(page=1000, page_size=50))
            assert len(deep['items']) == 50
        search = measure('fts_search_first50', lambda: db.videos(q='nghiên cứu', page_size=50))
        assert search['total'] == args.rows
        groups = measure('channels_first24', lambda: db.groups(kind='channels', page_size=24))
        assert groups['total'] == min(args.rows, 2000) and len(groups['items']) <= 24
        group = groups['items'][0]
        inside = measure('channel_drilldown', lambda: db.videos(group_kind='channels', group_key=group['key'], page_size=50))
        assert inside['total'] == group['video_count']
        category = measure('categories_first24', lambda: db.groups(kind='categories', page_size=24))
        assert category['items'][0]['video_count'] == args.rows
        update = normalize({'id': 'T0000000000', 'title': 'Updated research record', 'channel_id': 'UC_BENCH_0000'})
        measure('upsert_existing_video', lambda: db.upsert(update))
        result['max_page_payload_kib'] = round(len(json.dumps(page).encode()) / 1024, 2)
        db.close()
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
