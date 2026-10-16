"""TubeScope HTTP API. Run one worker on loopback; Next.js proxies /api."""

from __future__ import annotations

import csv
import io
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from tubescope.core import (
    CATEGORIES,
    FEATURES,
    METADATA_GROUPS,
    JobRequest,
    StrictModel,
)
from tubescope.database import Database
from tubescope.extractor import Extractor
from tubescope.jobs import Worker


class VideoIds(StrictModel):
    video_ids: list[str] = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def unique(self):
        if any(len(s) != 11 for s in self.video_ids):
            raise ValueError("ID video phải dài 11 ký tự.")
        self.video_ids = list(dict.fromkeys(self.video_ids))
        return self


class Review(StrictModel):
    review_status: Literal["todo", "keep", "skip"] | None = None
    notes: str | None = Field(default=None, max_length=50000)
    personal_tags: list[str] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def bounded_tags(self):
        if self.personal_tags and any(len(t) > 200 for t in self.personal_tags):
            raise ValueError("Mỗi nhãn tối đa 200 ký tự.")
        return self


class BulkReview(VideoIds):
    review_status: Literal["todo", "keep", "skip"]


EXPORT_FIELDS = [
    "id",
    "url",
    "title",
    "channel",
    "channel_id",
    "channel_url",
    "channel_handle",
    "thumbnail_url",
    "duration",
    "view_count",
    "upload_date",
    "content_type",
    "live_status",
    "categories",
    "description",
    "tags",
    "like_count",
    "channel_follower_count",
    "channel_is_verified",
    "license",
    "chapters",
    "subtitle_languages",
    "metadata_level",
    "saved_at",
    "updated_at",
    "review_status",
    "notes",
    "personal_tags",
    "source",
]


def safe_cell(value):
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str) and value.lstrip(" \t\r\n\ufeff").startswith(
        ("=", "+", "-", "@")
    ):
        return "'" + value
    return value


def create_app(db_path=None, extractor=None):
    # The uvicorn module is importable without opening or migrating a user database.
    deferred = db_path is None and extractor is None
    db_path = (
        db_path
        or os.environ.get("TUBESCOPE_DB")
        or Path(__file__).resolve().parents[1] / "data" / "tubescope.sqlite3"
    )
    db = None if deferred else Database(db_path)
    extractor = extractor or Extractor(
        timeout=float(os.environ.get("TUBESCOPE_EXTRACT_TIMEOUT", "90"))
    )
    worker = None if deferred else Worker(db, extractor)

    @asynccontextmanager
    async def lifespan(app):
        nonlocal db, worker
        if db is None:
            db = Database(db_path)
            worker = Worker(db, extractor)
            app.state.db = db
            app.state.worker = worker
        worker.start()
        try:
            yield
        finally:
            worker.stop()
            db.close()

    app = FastAPI(title="TubeScope", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["127.0.0.1", "localhost", "testserver", "[::1]"],
    )
    app.state.db = db
    app.state.worker = worker

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        details = "; ".join(
            ".".join(map(str, e["loc"])) + ": " + e["msg"] for e in exc.errors()
        )
        return JSONResponse(status_code=422, content={"detail": details})

    @app.exception_handler(ValueError)
    async def value_error(request, exc):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(OverflowError)
    async def queue_error(request, exc):
        return JSONResponse(status_code=429, content={"detail": str(exc)})

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse(
            status_code=404,
            content={"detail": "Không tìm thấy dữ liệu: " + str(exc.args[0])},
        )

    def get_job(id):
        job = db.job(id)
        if not job:
            raise KeyError(id)
        return job

    def selected(ids, saved_only=False):
        rows = []
        for id in ids:
            v = db.video(id)
            if not v:
                raise KeyError(id)
            if saved_only and not v["saved"]:
                raise HTTPException(409, "Video chưa được lưu: " + id)
            rows.append(v)
        return rows

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "yt_dlp_version": extractor.version,
            "database": str(db_path),
        }

    @app.get("/api/catalog")
    def catalog():
        labels = {
            "live": "Đang trực tiếp",
            "4k": "4K",
            "hd": "HD",
            "cc": "Phụ đề",
            "creative": "Creative Commons",
            "360": "360°",
            "vr180": "VR180",
            "3d": "3D",
            "hdr": "HDR",
            "location": "Vị trí",
        }
        return {
            "categories": CATEGORIES,
            "metadata_groups": METADATA_GROUPS,
            "native_features": [{"id": id, "label": labels[id]} for id in FEATURES],
        }

    @app.post("/api/jobs", status_code=202)
    def jobs_create(body: JobRequest):
        return worker.submit(body.model_dump(mode="json"))

    @app.get("/api/jobs")
    def jobs_page(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
        return db.jobs(page, page_size)

    @app.get("/api/jobs/{id}")
    def job_get(id: str):
        return get_job(id)

    @app.post("/api/jobs/{id}/cancel")
    def job_cancel(id: str):
        return worker.cancel(id)

    @app.post("/api/jobs/{id}/retry", status_code=202)
    def job_retry(id: str):
        try:
            return worker.retry(id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/api/jobs/{id}/resources")
    def resources(id: str):
        get_job(id)
        return db.resources(id)

    def video_filters(
        scope="library",
        job_id=None,
        q="",
        status="all",
        existing="all",
        group_kind=None,
        group_key=None,
        content_type="all",
    ):
        if scope == "job":
            if not job_id:
                raise HTTPException(422, "scope=job cần job_id.")
            get_job(job_id)
        if existing not in {"all", "new", "saved"}:
            raise HTTPException(422, "Bộ lọc video đã lưu không hợp lệ.")
        if group_kind not in {None, "channels", "playlists", "categories"}:
            raise HTTPException(422, "Nhóm không hợp lệ.")
        return dict(
            scope=scope,
            job_id=job_id,
            q=q,
            status=status,
            existing=existing,
            group_kind=group_kind,
            group_key=group_key,
            content_type=content_type,
        )

    @app.get("/api/videos")
    def videos(
        scope: Literal["library", "job"] = "library",
        job_id: str | None = None,
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=100),
        q: str = Query("", max_length=1000),
        sort: str = "views",
        status: str = "all",
        existing: str = "all",
        group_kind: str | None = None,
        group_key: str | None = None,
        content_type: str = "all",
    ):
        return db.videos(
            page=page,
            page_size=page_size,
            sort=sort,
            **video_filters(
                scope, job_id, q, status, existing, group_kind, group_key, content_type
            ),
        )

    @app.get("/api/videos/{id}")
    def video_get(id: str):
        v = db.video(id)
        if not v:
            raise KeyError(id)
        return v

    @app.patch("/api/videos/{id}/review")
    def review(id: str, body: Review):
        try:
            return db.review(id, body.model_dump(exclude_none=True))
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/api/library/save")
    def save(body: VideoIds):
        rows = selected(body.video_ids)
        quick = [
            v["id"] for v in rows if v["metadata_level"] == "quick" and not v["saved"]
        ]
        # Reserve enrichment work before mutating immediate saves if the queue is full.
        job = (
            worker.submit(
                {
                    "source_type": "video",
                    "sources": ["https://www.youtube.com/watch?v=" + quick[0]],
                    "existing_policy": "update",
                },
                kind="save",
                video_ids=quick,
            )
            if quick
            else None
        )
        count = db.save([v["id"] for v in rows if v["metadata_level"] == "full"])
        return {"saved_count": count, "job_id": job["id"] if job else None}

    @app.post("/api/library/review")
    def bulk_review(body: BulkReview):
        rows = selected(body.video_ids, saved_only=True)
        for v in rows:
            db.review(v["id"], {"review_status": body.review_status})
        return {"updated_count": len(rows)}

    @app.post("/api/library/refresh", status_code=202)
    def refresh(body: VideoIds):
        selected(body.video_ids, saved_only=True)
        return worker.submit(
            {
                "source_type": "video",
                "sources": ["https://www.youtube.com/watch?v=" + body.video_ids[0]],
                "existing_policy": "update",
            },
            kind="refresh",
            video_ids=body.video_ids,
        )

    @app.get("/api/library/stats")
    def stats():
        return db.stats()

    @app.get("/api/library/groups")
    def groups(
        kind: Literal["channels", "playlists", "categories"] = "channels",
        page: int = Query(1, ge=1),
        page_size: int = Query(24, ge=1, le=100),
        q: str = Query("", max_length=1000),
        channel_id: str | None = None,
    ):
        return db.groups(kind, page, page_size, q, channel_id)

    @app.get("/api/export.csv")
    def export(
        scope: Literal["library", "job"] = "library",
        job_id: str | None = None,
        video_ids: str | None = None,
        group_kind: str | None = None,
        group_key: str | None = None,
        q: str = Query("", max_length=1000),
        status: str = "all",
        content_type: str = "all",
        existing: str = "all",
        sort: str = "views",
    ):
        filters = video_filters(
            scope, job_id, q, status, existing, group_kind, group_key, content_type
        )
        if video_ids is not None:
            ids = list(dict.fromkeys(s for s in video_ids.split(",") if s))
            if len(ids) > 1000:
                raise HTTPException(422, "Tối đa 1000 ID video.")
            filters["video_ids"] = ids
        # Validate ahead of starting the streaming response, to preserve meaningful HTTP errors.
        db._where(**filters)
        from tubescope.database import SORTS

        if sort not in SORTS:
            raise HTTPException(422, "Sắp xếp không hợp lệ.")

        def stream():
            yield "\ufeff"
            buffer = io.StringIO(newline="")
            writer = csv.writer(buffer, quoting=csv.QUOTE_ALL)
            writer.writerow(EXPORT_FIELDS)
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)
            for v in db.iter_videos(sort=sort, **filters):
                writer.writerow([safe_cell(v.get(f)) for f in EXPORT_FIELDS])
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)

        return StreamingResponse(
            stream(),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="tubescope.csv"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    return app


app = create_app()
