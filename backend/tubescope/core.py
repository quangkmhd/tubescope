"""Input validation and an explicit allowlist boundary for retained metadata."""

from __future__ import annotations

import base64
import json
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlencode, urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator

CATEGORIES = json.loads(Path(__file__).with_name("catalog.json").read_text())
CATEGORY_NAMES = {x["id"]: x["title"] for x in CATEGORIES}
FEATURES = {
    "live": 8,
    "4k": 14,
    "hd": 4,
    "cc": 5,
    "creative": 6,
    "360": 15,
    "vr180": 26,
    "3d": 7,
    "hdr": 25,
    "location": 23,
}
METADATA_GROUPS = [
    "video_id_url",
    "title",
    "channel",
    "thumbnail_url",
    "duration",
    "view_count",
    "upload_date",
    "content_type_live_status",
    "categories",
    "description",
    "tags",
    "like_count",
    "channel_follower_count",
    "channel_is_verified",
    "license",
    "chapters",
    "subtitle_languages",
]
HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def now():
    return datetime.now(timezone.utc).isoformat()


SEARCH_TARGETS = {"video": "videos", "channel": "channels", "playlist": "playlists"}


def keyword_input(value: str) -> bool:
    # URL-shaped input must pass URL validation, never silently become a query.
    return not re.search(
        r"(?:[a-z][a-z0-9+.-]*://|www\.|youtu\.be/|youtube\.com/|(?:javascript|data|file|mailto):)",
        value,
        re.I,
    )


def source_url(kind: str, value: str) -> str:
    value = value.strip()
    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("Nguồn chứa ký tự điều khiển không hợp lệ.")
    if kind == "keyword":
        if (
            not value
            or len(value) > 1000
            or value.startswith("-")
            or not keyword_input(value)
        ):
            raise ValueError(
                "Từ khóa không hợp lệ; dùng đúng loại nguồn cho URL YouTube."
            )
        return value
    try:
        u = urlsplit(value)
        if (
            u.scheme not in ("https", "http")
            or u.hostname not in HOSTS
            or u.username
            or u.password
            or u.port is not None
            or u.fragment
        ):
            raise ValueError(
                "Chỉ chấp nhận URL YouTube không có tài khoản, cổng hoặc fragment."
            )
        p = u.path.rstrip("/")
        q = parse_qs(u.query)
        parts = p.strip("/").split("/")
        is_video = (
            u.hostname in {"youtu.be", "www.youtu.be"}
            and len(parts) == 1
            and bool(VIDEO_ID.fullmatch(parts[0]))
        ) or (
            u.hostname not in {"youtu.be", "www.youtu.be"}
            and (
                (
                    p == "/watch"
                    and len(q.get("v", [])) == 1
                    and bool(VIDEO_ID.fullmatch(q["v"][0]))
                )
                or (
                    len(parts) == 2
                    and parts[0] in {"shorts", "live", "embed"}
                    and bool(VIDEO_ID.fullmatch(parts[1]))
                )
            )
        )
        is_playlist = (
            u.hostname not in {"youtu.be", "www.youtu.be"}
            and p == "/playlist"
            and len(q.get("list", [])) == 1
            and bool(re.fullmatch(r"[A-Za-z0-9_-]{2,150}", q["list"][0]))
        )
        tabs = {
            "videos",
            "shorts",
            "streams",
            "playlists",
            "featured",
            "community",
            "live",
            "releases",
            "podcasts",
        }
        is_channel = u.hostname not in {"youtu.be", "www.youtu.be"} and (
            bool(
                parts[0].startswith("@")
                and len(parts[0]) > 1
                and len(parts) <= 2
                and (len(parts) == 1 or parts[1] in tabs)
            )
            or (
                len(parts) in {2, 3}
                and parts[0] in {"channel", "c", "user"}
                and bool(re.fullmatch(r"[\w.@-]+", parts[1]))
                and (len(parts) == 2 or parts[2] in tabs)
            )
        )
        is_search = (
            u.hostname not in {"youtu.be", "www.youtu.be"}
            and p == "/results"
            and bool(q.get("search_query", q.get("q", [""]))[0].strip())
        )
        if not {
            "video": is_video,
            "playlist": is_playlist,
            "channel": is_channel,
            "search": is_search,
        }.get(kind):
            raise ValueError("URL không khớp loại nguồn đã chọn.")
    except (ValueError, IndexError) as exc:
        raise ValueError(str(exc) or "URL YouTube không hợp lệ.") from exc
    return value


def source_input(kind: str, value: str) -> str:
    if kind in SEARCH_TARGETS and keyword_input(value):
        return source_url("keyword", value)
    return source_url(kind, value)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Filters(StrictModel):
    category: str | None = None
    duration_min: float | None = Field(default=None, ge=0)
    duration_max: float | None = Field(default=None, ge=0)
    views_min: int | None = Field(default=None, ge=0)
    views_max: int | None = Field(default=None, ge=0)
    date_after: date | None = None
    date_before: date | None = None
    content_types: list[Literal["video", "shorts", "livestream"]] = Field(
        default_factory=list, max_length=3
    )
    live_status: (
        Literal["all", "not_live", "is_live", "is_upcoming", "was_live", "post_live"]
        | None
    ) = None
    playlist_start: int | None = Field(default=None, ge=1, le=1000000)
    playlist_end: int | None = Field(default=None, ge=1, le=1000000)

    @model_validator(mode="after")
    def ranges(self):
        for low, high in [
            (self.duration_min, self.duration_max),
            (self.views_min, self.views_max),
            (self.date_after, self.date_before),
            (self.playlist_start, self.playlist_end),
        ]:
            if low is not None and high is not None and low > high:
                raise ValueError("Giới hạn từ phải nhỏ hơn hoặc bằng giới hạn đến.")
        if self.category not in {None, "", "all", "unknown", *CATEGORY_NAMES}:
            raise ValueError("Category không có trong danh mục lưu sẵn.")
        return self


class Native(StrictModel):
    result_type: Literal[
        "videos", "longform", "shorts", "channels", "playlists", "movies"
    ] = "videos"
    order: Literal["relevance", "popularity"] = "relevance"
    upload_date: Literal["all", "today", "week", "month", "year"] = "all"
    duration: Literal["all", "short", "medium", "long"] = "all"
    features: list[
        Literal[
            "live",
            "4k",
            "hd",
            "cc",
            "creative",
            "360",
            "vr180",
            "3d",
            "hdr",
            "location",
        ]
    ] = Field(default_factory=list, max_length=10)


class JobRequest(StrictModel):
    source_type: Literal["keyword", "channel", "playlist", "video", "search"]
    sources: list[str] = Field(min_length=1, max_length=20)
    limit: int = Field(default=100, ge=1, le=1000)
    mode: Literal["quick", "full"] = "full"
    existing_policy: Literal["skip", "update"] = "skip"
    filters: Filters = Field(default_factory=Filters)
    native: Native = Field(default_factory=Native)

    @model_validator(mode="after")
    def valid(self):
        self.sources = list(
            dict.fromkeys(source_input(self.source_type, s) for s in self.sources)
        )
        f = self.filters
        if (
            any(
                getattr(f, k) is not None
                for k in (
                    "duration_min",
                    "duration_max",
                    "views_min",
                    "views_max",
                    "date_after",
                    "date_before",
                )
            )
            or f.category not in (None, "", "all")
            or f.live_status not in (None, "all")
            or f.content_types
            or self.native.result_type == "longform"
        ):
            self.mode = "full"
        return self


def _varint(n):
    b = bytearray()
    while n > 127:
        b.append((n & 127) | 128)
        n >>= 7
    b.append(n)
    return bytes(b)


def native_search_url(source, native):
    n = Native(**native).model_dump()
    original = source.startswith(("http://", "https://"))
    if original and n == Native().model_dump():
        return source
    keyword = (
        parse_qs(urlsplit(source).query).get(
            "search_query", parse_qs(urlsplit(source).query).get("q", [""])
        )[0]
        if original
        else source
    )
    types = {
        "videos": 1,
        "longform": 1,
        "shorts": 9,
        "channels": 2,
        "playlists": 3,
        "movies": 4,
    }
    inner = _varint(2 << 3) + _varint(types[n["result_type"]])
    if n["upload_date"] != "all":
        inner += _varint(1 << 3) + _varint(
            {"today": 2, "week": 3, "month": 4, "year": 5}[n["upload_date"]]
        )
    if n["duration"] != "all":
        inner += _varint(3 << 3) + _varint(
            {"short": 4, "medium": 5, "long": 2}[n["duration"]]
        )
    for feature in sorted(set(n["features"]), key=lambda f: FEATURES[f]):
        inner += _varint(FEATURES[feature] << 3) + b"\x01"
    outer = (
        (b"\x08\x03" if n["order"] == "popularity" else b"")
        + b"\x12"
        + _varint(len(inner))
        + inner
    )
    return "https://www.youtube.com/results?" + urlencode(
        {"search_query": keyword, "sp": base64.b64encode(outer).decode()}
    )


def _strings(items):
    return list(dict.fromkeys(str(x) for x in (items or []) if isinstance(x, str)))


def normalize(raw: dict, mode="full", source=None, shorts=False):
    vid = str(raw.get("id") or "")
    if not VIDEO_ID.fullmatch(vid):
        raise ValueError("Nguồn không trả về một video YouTube hợp lệ.")
    live = raw.get("live_status")
    if live is None:
        if raw.get("is_live"):
            live = "is_live"
        elif raw.get("was_live"):
            live = "was_live"
    urls = [str(raw.get(k) or "") for k in ("url", "webpage_url", "original_url")]
    short = shorts or any("youtube.com/shorts/" in u for u in urls)
    ct = (
        "livestream"
        if live in {"is_live", "was_live", "post_live", "is_upcoming"}
        else "shorts"
        if short
        else "video"
    )
    channel_url = raw.get("channel_url") or (
        f"https://www.youtube.com/channel/{raw['channel_id']}"
        if raw.get("channel_id")
        else None
    )
    handle = raw.get("uploader_id")
    if not isinstance(handle, str) or not handle.startswith("@"):
        handle = next(
            (
                urlsplit(str(raw.get(k) or "")).path.split("/")[1]
                for k in ("uploader_url", "channel_url")
                if "/@" in str(raw.get(k) or "")
            ),
            None,
        )
    thumbs = raw.get("thumbnails") or []
    thumbnail = raw.get("thumbnail") or next(
        (
            t.get("url")
            for t in reversed(thumbs)
            if isinstance(t, dict) and t.get("url")
        ),
        None,
    )
    upload = raw.get("upload_date")
    if isinstance(upload, str) and re.fullmatch(r"\d{8}", upload):
        try:
            upload = date(
                int(upload[:4]), int(upload[4:6]), int(upload[6:])
            ).isoformat()
        except ValueError:
            upload = None
    else:
        upload = None
    languages = []
    for key, kind in [("subtitles", "manual"), ("automatic_captions", "automatic")]:
        for code, entries in (raw.get(key) or {}).items():
            if code in {"live_chat", "danmaku"}:
                continue
            name = next(
                (
                    e.get("name")
                    for e in entries
                    if isinstance(e, dict) and e.get("name")
                ),
                code,
            )
            languages.append({"code": code, "name": name, "kind": kind})
    chapters = []
    for c in raw.get("chapters") or []:
        if isinstance(c, dict) and isinstance(c.get("start_time"), (int, float)):
            chapters.append(
                {
                    "title": str(c.get("title") or ""),
                    "start_time": c["start_time"],
                    "end_time": c.get("end_time")
                    if isinstance(c.get("end_time"), (int, float))
                    else None,
                }
            )
    out = {
        "id": vid,
        "url": f"https://www.youtube.com/{'shorts/' if short else 'watch?v='}{vid}",
        "title": str(raw.get("title") or vid),
        "channel": raw.get("channel") or raw.get("uploader"),
        "channel_id": raw.get("channel_id"),
        "channel_url": channel_url,
        "channel_handle": handle,
        "thumbnail_url": thumbnail,
        "upload_date": upload,
        "content_type": ct,
        "live_status": live,
        "categories": _strings(raw.get("categories")),
        "description": raw.get("description"),
        "tags": _strings(raw.get("tags")),
        "license": raw.get("license"),
        "chapters": chapters,
        "subtitle_languages": languages,
        "metadata_level": mode,
        "updated_at": now(),
        "source": source,
    }
    for field in ("duration", "view_count", "like_count", "channel_follower_count"):
        v = raw.get(field)
        out[field] = (
            v
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0
            else None
        )
    verified = raw.get("channel_is_verified")
    out["channel_is_verified"] = verified if isinstance(verified, bool) else None
    return out


def listing_rejects(entry, filters):
    """Reject only known numeric mismatches; missing fields still need enrichment.

    YouTube lists rounded view counts. Keep a conservative two-significant-digit
    interval around those counts and a one-second margin for displayed duration.
    Enrich boundary candidates. Active streams
    have changing durations/counts, so never reject them from a listing snapshot.
    """
    if entry.get("is_live") or entry.get("live_status") in {
        "is_live",
        "is_upcoming",
        "post_live",
    }:
        return False
    for field, low, high in [
        ("duration", "duration_min", "duration_max"),
        ("view_count", "views_min", "views_max"),
    ]:
        value = entry.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        if not math.isfinite(value) or value < 0:
            continue
        margin = (
            10 ** max(0, len(str(int(value))) - 2)
            if field == "view_count" and value >= 1000
            else 1
            if field == "duration"
            else 0
        )
        minimum, maximum = filters.get(low), filters.get(high)
        if minimum is not None and value + margin < minimum:
            return True
        if maximum is not None and max(0, value - margin) > maximum:
            return True
    return False


def matches(v, filters):
    for field, low, high in [
        ("duration", "duration_min", "duration_max"),
        ("view_count", "views_min", "views_max"),
        ("upload_date", "date_after", "date_before"),
    ]:
        val = v.get(field)
        for key, op in [(low, lambda a, b: a >= b), (high, lambda a, b: a <= b)]:
            target = filters.get(key)
            if target is not None and (
                val is None
                or not op(val, str(target) if field == "upload_date" else target)
            ):
                return False
    category = filters.get("category")
    if category == "unknown" and v["categories"]:
        return False
    if (
        category not in (None, "", "all", "unknown")
        and CATEGORY_NAMES.get(category, category) not in v["categories"]
    ):
        return False
    if (
        filters.get("content_types")
        and v["content_type"] not in filters["content_types"]
    ):
        return False
    if (
        filters.get("live_status") not in (None, "all")
        and v.get("live_status") != filters["live_status"]
    ):
        return False
    return True
