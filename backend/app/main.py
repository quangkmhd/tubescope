"""TubeScope HTTP API. Run one worker on loopback; Next.js proxies /api."""

from __future__ import annotations

import csv
import io
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException, Query
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
            raise ValueError("Video IDs must be 11 characters long.")
        self.video_ids = list(dict.fromkeys(self.video_ids))
        return self


class Review(StrictModel):
    review_status: Literal["todo", "keep", "skip"] | None = None
    notes: str | None = Field(default=None, max_length=50000)
    personal_tags: list[str] | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def bounded_tags(self):
        if self.personal_tags and any(len(t) > 200 for t in self.personal_tags):
            raise ValueError("Each tag must be at most 200 characters long.")
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


LEGACY_JOB_MESSAGES = {
    "Người dùng đã hủy tác vụ.": "The collection was cancelled by the user.",
    "Máy chủ đã dừng; hãy thử lại tác vụ.": "The server stopped; retry the collection.",
    "Tác vụ vượt thời gian xử lý tối đa 30 phút.": "The collection exceeded the 30-minute processing limit.",
    "Nguồn có quá nhiều danh sách lồng nhau.": "The source contains too many nested playlists.",
    "Nguồn không trả về một video YouTube hợp lệ.": "The source did not return a valid YouTube video.",
    "Mục nguồn không chứa ID video YouTube hợp lệ.": "The source item does not contain a valid YouTube video ID.",
    "Nguồn không trả về danh sách kết quả.": "The source did not return a list of results.",
    "Một mục nguồn không khả dụng.": "A source item is unavailable.",
    "Dữ liệu phản hồi yt-dlp vượt giới hạn an toàn.": "The yt-dlp response exceeds the safety limit.",
    "yt-dlp không trả về metadata hợp lệ.": "yt-dlp did not return valid metadata.",
    "URL không khớp loại nguồn đã chọn.": "The URL does not match the selected source type.",
    "Chỉ chấp nhận URL YouTube không có tài khoản, cổng hoặc fragment.": "Only YouTube URLs without credentials, ports, or fragments are allowed.",
}


def public_job_message(message):
    if not message:
        return message
    if message in LEGACY_JOB_MESSAGES:
        return LEGACY_JOB_MESSAGES[message]
    timeout = re.fullmatch(
        r"yt-dlp vượt thời gian chờ (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?) giây\.",
        message,
    )
    if timeout:
        return f"yt-dlp timed out after {timeout[1]} seconds."
    exit_code = re.fullmatch(r"yt-dlp thoát với mã (-?\d+)\.", message)
    if exit_code:
        return f"yt-dlp exited with code {exit_code[1]}."
    return message


def public_job(job):
    # Translate known application copy at the API boundary without changing stored
    # history, user input, or arbitrary errors returned by the extractor.
    return {
        **job,
        "error": public_job_message(job.get("error")),
        "errors": [
            {
                **error,
                "message": public_job_message(error["message"]),
            }
            for error in job.get("errors", [])
        ],
    }


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
            content={"detail": "Data not found: " + str(exc.args[0])},
        )

    def get_job(id):
        job = db.job(id)
        if not job:
            raise KeyError(id)
        return public_job(job)

    def selected(ids, saved_only=False):
        rows = []
        for id in ids:
            v = db.video(id)
            if not v:
                raise KeyError(id)
            if saved_only and not v["saved"]:
                raise HTTPException(409, "Video has not been saved: " + id)
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
            "live": "Live",
            "4k": "4K",
            "hd": "HD",
            "cc": "Subtitles/CC",
            "creative": "Creative Commons",
            "360": "360°",
            "vr180": "VR180",
            "3d": "3D",
            "hdr": "HDR",
            "location": "Location",
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
    def jobs_page(
        page: int = Query(1, ge=1),
        page_size: int = Query(20, ge=1, le=100),
        date_from: date | None = None,
        date_to: date | None = None,
        time_zone: str = "UTC",
    ):
        try:
            zone = ZoneInfo(time_zone)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(422, "Invalid time zone.")
        if date_from and date_to and date_from > date_to:
            raise HTTPException(422, "The start date must not be after the end date.")

        def boundary(day):
            return (
                datetime.combine(day, time.min, tzinfo=zone)
                .astimezone(timezone.utc)
                .isoformat()
            )

        try:
            start = boundary(date_from) if date_from else None
            end = (
                boundary(date_to + timedelta(days=1))
                if date_to and date_to < date.max
                else None
            )
        except OverflowError:
            raise HTTPException(422, "The date range exceeds the supported range.")
        result = db.jobs(page, page_size, created_from=start, created_before=end)
        result["items"] = [public_job(job) for job in result["items"]]
        return result

    @app.get("/api/jobs/{id}")
    def job_get(id: str):
        return get_job(id)

    @app.post("/api/jobs/{id}/cancel")
    def job_cancel(id: str):
        return public_job(worker.cancel(id))

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
        scope: Literal["library", "job"] = "library",
        job_id: str | None = None,
        q: str = Query("", max_length=1000),
        status: str = "all",
        existing: str = "all",
        group_kind: str | None = None,
        group_key: str | None = None,
        content_type: str = "all",
        duration_min: float | None = Query(None, ge=0, allow_inf_nan=False),
        duration_max: float | None = Query(None, ge=0, allow_inf_nan=False),
        views_min: int | None = Query(None, ge=0, le=2**63 - 1),
        views_max: int | None = Query(None, ge=0, le=2**63 - 1),
        likes_min: int | None = Query(None, ge=0, le=2**63 - 1),
        likes_max: int | None = Query(None, ge=0, le=2**63 - 1),
        category: str = "all",
        live_status: str = "all",
        metadata_level: str = "all",
        uploaded_from: str | None = None,
        uploaded_to: str | None = None,
        saved_from: str | None = None,
        saved_to: str | None = None,
        time_zone: str = "UTC",
        channel: str = Query("", max_length=1000),
        channel_id: str | None = None,
    ):
        filters = dict(locals())
        if scope == "job":
            if not job_id:
                raise HTTPException(422, "scope=job requires job_id.")
            get_job(job_id)
        if existing not in {"all", "new", "saved"}:
            raise HTTPException(422, "Invalid saved-video filter.")
        if group_kind not in {None, "channels", "playlists", "categories"}:
            raise HTTPException(422, "Invalid group.")
        db._where(**filters)
        return filters

    @app.get("/api/videos")
    def videos(
        page: int = Query(1, ge=1),
        page_size: int = Query(50, ge=1, le=100),
        sort: str | None = None,
        filters: dict = Depends(video_filters),
    ):
        return db.videos(page=page, page_size=page_size, sort=sort, **filters)

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
        video_ids: str | None = None,
        sort: str | None = None,
        filters: dict = Depends(video_filters),
    ):
        if video_ids is not None:
            ids = list(dict.fromkeys(s for s in video_ids.split(",") if s))
            if len(ids) > 1000:
                raise HTTPException(422, "A maximum of 1,000 video IDs is allowed.")
            filters["video_ids"] = ids
        # Validate ahead of starting the streaming response, to preserve meaningful HTTP errors.
        db._where(**filters)
        db.ordering(sort, **filters)

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
