"""SQLite warehouse. Every row holds approved fields only; review state is separate."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from pathlib import Path

from .core import CATEGORY_NAMES, now

SORTS = {
    "views": "v.view_count DESC",
    "newest": "v.upload_date DESC",
    "duration": "v.duration ASC",
    "updated": "v.updated_at DESC",
    "saved": "v.saved_at DESC",
}
SORT_NULL = {
    "views": "v.view_count",
    "newest": "v.upload_date",
    "duration": "v.duration",
    "updated": "v.updated_at",
    "saved": "v.saved_at",
}
TERMINAL = {"completed", "partial", "failed", "cancelled", "interrupted"}


class Database:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False, timeout=15)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript("""
        CREATE TABLE IF NOT EXISTS videos (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, title TEXT NOT NULL,
            channel TEXT,channel_id TEXT,duration REAL,view_count INTEGER,upload_date TEXT,
            content_type TEXT NOT NULL,updated_at TEXT NOT NULL,saved_at TEXT,
            review_status TEXT NOT NULL DEFAULT 'todo',notes TEXT NOT NULL DEFAULT '',personal_tags TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS video_saved ON videos(saved_at,id);
        CREATE INDEX IF NOT EXISTS video_channel ON videos(channel_id,saved_at,id);
        CREATE INDEX IF NOT EXISTS video_views ON videos(view_count DESC,id);
        CREATE INDEX IF NOT EXISTS video_upload ON videos(upload_date DESC,id);
        CREATE INDEX IF NOT EXISTS video_duration ON videos(duration DESC,id);
        CREATE INDEX IF NOT EXISTS video_updated ON videos(updated_at DESC,id);
        CREATE INDEX IF NOT EXISTS video_review ON videos(review_status,saved_at,id);
        CREATE INDEX IF NOT EXISTS video_type ON videos(content_type,saved_at,id);
        CREATE VIRTUAL TABLE IF NOT EXISTS video_fts USING fts5(id UNINDEXED,title,channel,description,tags,tokenize='unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT);
        CREATE TABLE IF NOT EXISTS video_playlists(video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,playlist_id TEXT NOT NULL REFERENCES playlists(id),PRIMARY KEY(video_id,playlist_id));
        CREATE INDEX IF NOT EXISTS playlist_video ON video_playlists(playlist_id,video_id);
        CREATE TABLE IF NOT EXISTS video_categories(video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,category_key TEXT NOT NULL,title TEXT NOT NULL,PRIMARY KEY(video_id,category_key));
        CREATE INDEX IF NOT EXISTS category_video ON video_categories(category_key,video_id);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL,request TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,created_at);
        CREATE TABLE IF NOT EXISTS job_videos(job_id TEXT NOT NULL REFERENCES jobs(id),video_id TEXT NOT NULL REFERENCES videos(id),existing INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(job_id,video_id));
        CREATE TABLE IF NOT EXISTS resources(job_id TEXT NOT NULL REFERENCES jobs(id),id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(job_id,id));
        """)
        if self.conn.execute("PRAGMA user_version").fetchone()[0] < 1:
            # Pre-release warehouses used independently allocated FTS rowids. Rebuild
            # once so refresh cannot leave stale search documents behind.
            with self.conn:
                self.conn.execute("DELETE FROM video_fts")
                self.conn.execute("""
                    INSERT INTO video_fts(rowid,id,title,channel,description,tags)
                    SELECT rowid,id,title,channel,json_extract(data,'$.description'),
                           COALESCE((SELECT group_concat(value,' ') FROM json_each(json_extract(videos.data,'$.tags'))),'')
                    FROM videos
                """)
                self.conn.execute("PRAGMA user_version=1")
        self.conn.commit()

    def close(self):
        with self.lock:
            self.conn.close()

    @staticmethod
    def decode(row):
        v = json.loads(row["data"])
        v.update(
            saved=bool(row["saved_at"]),
            saved_at=row["saved_at"],
            review_status=row["review_status"],
            notes=row["notes"],
            personal_tags=json.loads(row["personal_tags"]),
        )
        return v

    def video(self, id):
        with self.lock:
            row = self.conn.execute("SELECT * FROM videos WHERE id=?", (id,)).fetchone()
            return self.decode(row) if row else None

    def upsert(self, v, playlist=None):
        with self.lock, self.conn:
            old = self.video(v["id"])
            if old:
                # A quick revisit must never discard previously detailed metadata.
                if old["metadata_level"] == "full" and v["metadata_level"] == "quick":
                    v = {
                        k: value
                        for k, value in old.items()
                        if k
                        not in {
                            "saved",
                            "saved_at",
                            "review_status",
                            "notes",
                            "personal_tags",
                        }
                    }
                else:
                    # Preserve precise Shorts evidence when full extraction normalizes its URL to watch?v=.
                    if old["content_type"] == "shorts" and v["content_type"] == "video":
                        v = dict(
                            v,
                            content_type="shorts",
                            url=f"https://www.youtube.com/shorts/{v['id']}",
                        )
            fields = [
                "id",
                "title",
                "channel",
                "channel_id",
                "duration",
                "view_count",
                "upload_date",
                "content_type",
                "updated_at",
            ]
            cols = ",".join(fields)
            self.conn.execute(
                f"INSERT INTO videos({cols},data) VALUES({','.join('?' for _ in range(len(fields) + 1))}) ON CONFLICT(id) DO UPDATE SET "
                + ",".join(f"{f}=excluded.{f}" for f in fields if f != "id")
                + ",data=excluded.data",
                [*[v.get(f) for f in fields], json.dumps(v, ensure_ascii=False)],
            )
            rowid = self.conn.execute(
                "SELECT rowid FROM videos WHERE id=?", (v["id"],)
            ).fetchone()[0]
            self.conn.execute("DELETE FROM video_fts WHERE rowid=?", (rowid,))
            self.conn.execute(
                "INSERT INTO video_fts(rowid,id,title,channel,description,tags) VALUES(?,?,?,?,?,?)",
                (
                    rowid,
                    v["id"],
                    v["title"],
                    v.get("channel"),
                    v.get("description"),
                    " ".join(v.get("tags", [])),
                ),
            )
            self.conn.execute(
                "DELETE FROM video_categories WHERE video_id=?", (v["id"],)
            )
            reverse = {}
            for key, title in CATEGORY_NAMES.items():
                reverse.setdefault(title, key)
            for title in v.get("categories", []):
                self.conn.execute(
                    "INSERT OR IGNORE INTO video_categories VALUES(?,?,?)",
                    (v["id"], reverse.get(title, title), title),
                )
            if playlist:
                self.conn.execute(
                    "INSERT INTO playlists(id,title,url) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url",
                    (
                        playlist["id"],
                        playlist.get("title") or playlist["id"],
                        playlist.get("url"),
                    ),
                )
                self.conn.execute(
                    "INSERT OR IGNORE INTO video_playlists VALUES(?,?)",
                    (v["id"], playlist["id"]),
                )
        return self.video(v["id"])

    def save(self, ids):
        count = 0
        with self.lock, self.conn:
            for id in ids:
                v = self.video(id)
                if v and v["metadata_level"] == "full" and not v["saved"]:
                    count += self.conn.execute(
                        "UPDATE videos SET saved_at=? WHERE id=? AND saved_at IS NULL",
                        (now(), id),
                    ).rowcount
        return count

    def review(self, id, patch):
        with self.lock, self.conn:
            v = self.video(id)
            if not v:
                raise KeyError(id)
            if not v["saved"]:
                raise ValueError("Chỉ đánh giá video đã lưu.")
            allowed = {
                k: val
                for k, val in patch.items()
                if k in {"review_status", "notes", "personal_tags"}
            }
            if not allowed:
                return v
            if "personal_tags" in allowed:
                allowed["personal_tags"] = json.dumps(
                    allowed["personal_tags"], ensure_ascii=False
                )
            self.conn.execute(
                "UPDATE videos SET "
                + ",".join(f"{key}=?" for key in allowed)
                + " WHERE id=?",
                [*allowed.values(), id],
            )
        return self.video(id)

    def _where(
        self,
        scope="library",
        job_id=None,
        q="",
        status="all",
        existing="all",
        group_kind=None,
        group_key=None,
        content_type="all",
        video_ids=None,
        **_,
    ):
        clauses = []
        params = []
        if scope == "job":
            if not job_id:
                raise ValueError("scope=job cần job_id.")
            clauses.append(
                "EXISTS(SELECT 1 FROM job_videos j WHERE j.video_id=v.id AND j.job_id=?)"
            )
            params.append(job_id)
            if existing in {"new", "saved"}:
                clauses.append(
                    "v.saved_at IS " + ("NOT NULL" if existing == "saved" else "NULL")
                )
        elif scope == "library":
            clauses.append("v.saved_at IS NOT NULL")
        else:
            raise ValueError("scope phải là library hoặc job.")
        if status != "all":
            if status not in {"todo", "keep", "skip"}:
                raise ValueError("Trạng thái không hợp lệ.")
            clauses.append("v.review_status=?")
            params.append(status)
        if content_type != "all":
            if content_type not in {"video", "shorts", "livestream"}:
                raise ValueError("Loại video không hợp lệ.")
            clauses.append("v.content_type=?")
            params.append(content_type)
        if q:
            tokens = re.findall(r"\w+", q, flags=re.UNICODE)[:20]
            if tokens:
                clauses.append(
                    "v.id IN (SELECT id FROM video_fts WHERE video_fts MATCH ?)"
                )
                params.append(" AND ".join('"' + t + '"*' for t in tokens))
            else:
                clauses.append("0")
        if group_key is not None and group_kind:
            clauses.append("v.saved_at IS NOT NULL")
            if group_kind == "channels":
                clauses.append("COALESCE(v.channel_id,'unknown')=?")
                params.append(group_key)
            elif group_kind == "playlists":
                clauses.append(
                    "EXISTS(SELECT 1 FROM video_playlists p WHERE p.video_id=v.id AND p.playlist_id=?)"
                )
                params.append(group_key)
            elif group_kind == "categories":
                if group_key == "unknown":
                    clauses.append(
                        "NOT EXISTS(SELECT 1 FROM video_categories c WHERE c.video_id=v.id)"
                    )
                else:
                    clauses.append(
                        "EXISTS(SELECT 1 FROM video_categories c WHERE c.video_id=v.id AND c.category_key=?)"
                    )
                    params.append(group_key)
            else:
                raise ValueError("Nhóm không hợp lệ.")
        if video_ids is not None:
            if len(video_ids) > 1000:
                raise ValueError("Tối đa 1000 video.")
            if video_ids:
                clauses.append("v.id IN (" + ",".join("?" for _ in video_ids) + ")")
                params.extend(video_ids)
            else:
                clauses.append("0")
        return " AND ".join(clauses) or "1", params

    def videos(self, page=1, page_size=50, sort="views", **filters):
        if sort not in SORTS:
            raise ValueError("Sắp xếp không hợp lệ.")
        if not (1 <= page and 1 <= page_size <= 100):
            raise ValueError("Phân trang không hợp lệ.")
        where, params = self._where(**filters)
        with self.lock:
            total = self.conn.execute(
                "SELECT count(*) FROM videos v WHERE " + where, params
            ).fetchone()[0]
            rows = self.conn.execute(
                "SELECT v.* FROM videos v WHERE "
                + where
                + f" ORDER BY ({SORT_NULL[sort]} IS NULL),{SORTS[sort]},v.id LIMIT ? OFFSET ?",
                [*params, page_size, (page - 1) * page_size],
            ).fetchall()
        return {
            "items": [self.decode(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def iter_videos(self, sort="views", **filters):
        if sort not in SORTS:
            raise ValueError("Sắp xếp không hợp lệ.")
        where, params = self._where(**filters)
        # Dedicated read connection gives a stable streaming snapshot without blocking the worker lock.
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            cursor = connection.execute(
                "SELECT v.* FROM videos v WHERE "
                + where
                + f" ORDER BY ({SORT_NULL[sort]} IS NULL),{SORTS[sort]},v.id",
                params,
            )
            while rows := cursor.fetchmany(100):
                for r in rows:
                    yield self.decode(r)
        finally:
            connection.close()

    def groups(self, kind="channels", page=1, page_size=24, q="", channel_id=None):
        if not (page >= 1 and 1 <= page_size <= 100):
            raise ValueError("Phân trang không hợp lệ.")
        base = "v.saved_at IS NOT NULL"
        params = []
        if channel_id:
            base += " AND COALESCE(v.channel_id,'unknown')=?"
            params.append(channel_id)
        if kind == "channels":
            query = (
                "SELECT COALESCE(v.channel_id,'unknown') AS key,COALESCE(MAX(v.channel),'Chưa xác định kênh') AS title,MAX(v.channel_id) AS subtitle,COUNT(*) AS video_count,SUM(v.review_status='todo') AS unreviewed_count,json_extract(v.data,'$.thumbnail_url') AS thumbnail_url FROM videos v WHERE "
                + base
                + " GROUP BY COALESCE(v.channel_id,'unknown')"
            )
        elif kind == "playlists":
            query = (
                "SELECT p.id AS key,p.title,p.url AS subtitle,COUNT(*) AS video_count,SUM(v.review_status='todo') AS unreviewed_count,json_extract(v.data,'$.thumbnail_url') AS thumbnail_url FROM videos v JOIN video_playlists vp ON vp.video_id=v.id JOIN playlists p ON p.id=vp.playlist_id WHERE "
                + base
                + " GROUP BY p.id"
            )
        elif kind == "categories":
            query = (
                "SELECT COALESCE(c.category_key,'unknown') AS key,COALESCE(c.title,'Chưa xác định thể loại') AS title,NULL AS subtitle,COUNT(*) AS video_count,SUM(v.review_status='todo') AS unreviewed_count,json_extract(v.data,'$.thumbnail_url') AS thumbnail_url FROM videos v LEFT JOIN video_categories c ON c.video_id=v.id WHERE "
                + base
                + " GROUP BY COALESCE(c.category_key,'unknown')"
            )
        else:
            raise ValueError("Nhóm không hợp lệ.")
        outer = "SELECT * FROM (" + query + ")"
        if q:
            outer += " WHERE title LIKE ? ESCAPE '\\'"
            params.append(
                "%"
                + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                + "%"
            )
        with self.lock:
            total = self.conn.execute(
                "SELECT COUNT(*) FROM (" + outer + ")", params
            ).fetchone()[0]
            rows = self.conn.execute(
                outer + " ORDER BY video_count DESC,key LIMIT ? OFFSET ?",
                [*params, page_size, (page - 1) * page_size],
            ).fetchall()
        return {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    def stats(self):
        with self.lock:
            counts = self.conn.execute(
                "SELECT COUNT(*) saved_count,COUNT(DISTINCT COALESCE(channel_id,'unknown')) channel_count,COALESCE(SUM(review_status='todo'),0) todo_count,COALESCE(SUM(review_status='keep'),0) keep_count,COALESCE(SUM(review_status='skip'),0) skip_count FROM videos WHERE saved_at IS NOT NULL"
            ).fetchone()
            out = dict(counts)
            out["playlist_count"] = self.conn.execute(
                "SELECT COUNT(DISTINCT playlist_id) FROM video_playlists p JOIN videos v ON v.id=p.video_id WHERE v.saved_at IS NOT NULL"
            ).fetchone()[0]
            out["category_count"] = self.conn.execute(
                "SELECT COUNT(DISTINCT COALESCE(c.category_key,'unknown')) FROM videos v LEFT JOIN video_categories c ON c.video_id=v.id WHERE v.saved_at IS NOT NULL"
            ).fetchone()[0]
        return out

    def add_job(self, job, request):
        with self.lock, self.conn:
            if (
                self.conn.execute(
                    "SELECT count(*) FROM jobs WHERE status='queued'"
                ).fetchone()[0]
                >= 30
            ):
                raise OverflowError("Hàng đợi đã đầy (30 tác vụ).")
            self.conn.execute(
                "INSERT INTO jobs VALUES(?,?,?,?,?)",
                (
                    job["id"],
                    job["status"],
                    job["created_at"],
                    json.dumps(job, ensure_ascii=False),
                    json.dumps(request, ensure_ascii=False),
                ),
            )
        return job

    def job(self, id):
        with self.lock:
            row = self.conn.execute(
                "SELECT data FROM jobs WHERE id=?", (id,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def job_request(self, id):
        with self.lock:
            row = self.conn.execute(
                "SELECT request FROM jobs WHERE id=?", (id,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def update_job(self, id, **patch):
        with self.lock, self.conn:
            job = self.job(id)
            if not job:
                return None
            job.update(patch)
            self.conn.execute(
                "UPDATE jobs SET status=?,data=? WHERE id=?",
                (job["status"], json.dumps(job, ensure_ascii=False), id),
            )
        return job

    def record_job_failure(self, id, source, message, retry_item=None):
        """Persist the public error and private retry lineage in one transaction."""
        with self.lock, self.conn:
            job = self.job(id)
            request = self.job_request(id)
            request.setdefault("_failed_items", []).append(retry_item)
            job["errors"].append({"source": source, "message": message})
            job["failed_count"] += 1
            job["error"] = message
            self.conn.execute(
                "UPDATE jobs SET data=?,request=? WHERE id=?",
                (
                    json.dumps(job, ensure_ascii=False),
                    json.dumps(request, ensure_ascii=False),
                    id,
                ),
            )
        return job

    def increment(self, id, **counts):
        with self.lock:
            job = self.job(id)
            return self.update_job(id, **{k: job[k] + v for k, v in counts.items()})

    def jobs(self, page=1, page_size=20):
        with self.lock:
            count = self.conn.execute("SELECT count(*) FROM jobs").fetchone()[0]
            rows = self.conn.execute(
                "SELECT data FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (page_size, (page - 1) * page_size),
            ).fetchall()
        return {
            "items": [json.loads(r[0]) for r in rows],
            "total": count,
            "page": page,
            "page_size": page_size,
        }

    def next_job(self):
        with self.lock:
            row = self.conn.execute(
                "SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1"
            ).fetchone()
            return row[0] if row else None

    def recover(self):
        with self.lock:
            for row in self.conn.execute(
                "SELECT id FROM jobs WHERE status IN ('running','queued')"
            ).fetchall():
                self.update_job(
                    row[0],
                    status="interrupted",
                    phase="interrupted",
                    finished_at=now(),
                    error="Máy chủ đã dừng; hãy thử lại tác vụ.",
                )

    def link_job(self, job_id, video_id, existing=False):
        with self.lock, self.conn:
            self.conn.execute(
                "INSERT OR IGNORE INTO job_videos VALUES(?,?,?)",
                (job_id, video_id, int(existing)),
            )

    def resource(self, job_id, item):
        with self.lock, self.conn:
            self.conn.execute(
                "INSERT OR REPLACE INTO resources VALUES(?,?,?)",
                (job_id, item["id"], json.dumps(item, ensure_ascii=False)),
            )

    def resources(self, job_id):
        with self.lock:
            return {
                "items": [
                    json.loads(r[0])
                    for r in self.conn.execute(
                        "SELECT data FROM resources WHERE job_id=? ORDER BY rowid",
                        (job_id,),
                    ).fetchall()
                ]
            }
