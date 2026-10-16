import json

import pytest

from tubescope.core import (
    JobRequest,
    listing_rejects,
    matches,
    native_search_url,
    normalize,
    source_url,
)
from tubescope.database import Database


def raw(id="abcdefghijk", **kw):
    return {
        "id": id,
        "title": "=Học Python",
        "webpage_url": f"https://www.youtube.com/watch?v={id}",
        "channel_id": "UC_test",
        "channel": "Learning",
        "duration": 60,
        "view_count": 0,
        "upload_date": "20260101",
        "categories": ["Education"],
        **kw,
    }


@pytest.mark.parametrize(
    "entry,filters,rejected",
    [
        ({}, {"duration_min": 1201, "views_min": 1000000}, False),
        ({"duration": 60}, {"duration_min": 1201}, True),
        ({"duration": 1201}, {"duration_min": 1201}, False),
        ({"duration": 1202}, {"duration_max": 1200}, True),
        ({"duration": 1200}, {"duration_min": 1200.5}, False),
        ({"duration": 1201}, {"duration_max": 1200}, False),
        ({"duration": 0}, {"duration_max": 0}, False),
        ({"duration": True}, {"duration_min": 1201}, False),
        ({"duration": -1}, {"duration_min": 1201}, False),
        ({"duration": "60"}, {"duration_min": 1201}, False),
        ({"duration": float("nan")}, {"duration_min": 1201}, False),
        ({"view_count": float("inf")}, {"views_max": 1000000}, False),
        ({"view_count": 0}, {"views_min": 1}, True),
        ({"view_count": 999000}, {"views_min": 1000000}, False),
        ({"view_count": 980000}, {"views_min": 1000000}, True),
        ({"view_count": 1010000}, {"views_max": 1000000}, False),
        ({"view_count": 1200000}, {"views_max": 1000000}, True),
        (
            {"duration": 60, "view_count": 0, "is_live": True},
            {"duration_min": 1201, "views_min": 1000000},
            False,
        ),
        ({"duration": 60, "live_status": "is_upcoming"}, {"duration_min": 1201}, False),
        ({"duration": 60, "live_status": "post_live"}, {"duration_min": 1201}, False),
        (
            {"duration": 60},
            {"category": "27", "date_after": "2026-01-01", "content_types": ["shorts"]},
            False,
        ),
    ],
)
def test_listing_prefilter_only_rejects_known_values_away_from_rounding_boundary(
    entry, filters, rejected
):
    assert listing_rejects(entry, filters) is rejected


def test_normalization_excludes_forbidden_and_preserves_null_false():
    v = normalize(
        raw(
            comment_count=9,
            comments=["private"],
            formats=[{"url": "x"}],
            subtitles={"en": [{"ext": "vtt", "url": "secret", "name": "English"}]},
            automatic_captions={"vi": [{"url": "secret"}]},
            channel_is_verified=False,
            like_count=None,
            heatmap=[1],
        )
    )
    assert v["view_count"] == 0
    assert v["like_count"] is None
    assert v["channel_is_verified"] is False
    assert (
        v["content_type"] == "video"
    )  # Short duration alone is not evidence of Shorts.
    assert v["upload_date"] == "2026-01-01"
    assert v["subtitle_languages"] == [
        {"code": "en", "name": "English", "kind": "manual"},
        {"code": "vi", "name": "vi", "kind": "automatic"},
    ]
    assert not (
        {"comment_count", "comments", "formats", "heatmap", "subtitles"} & v.keys()
    )
    assert "secret" not in json.dumps(v)
    assert (
        normalize(raw(webpage_url="https://www.youtube.com/shorts/abcdefghijk"))[
            "content_type"
        ]
        == "shorts"
    )


@pytest.mark.parametrize(
    "source_type,value",
    [
        ("video", "https://evil.com/watch?v=abcdefghijk"),
        ("video", "--exec touch /tmp/a"),
        ("video", "https://youtube.com:8443/watch?v=abcdefghijk"),
        ("channel", "https://youtube.com/watch?v=abcdefghijk"),
        ("playlist", "https://youtube.com/playlist"),
        ("video", "https://u:p@youtube.com/watch?v=abcdefghijk"),
        ("keyword", ""),
    ],
)
def test_source_validation(source_type, value):
    with pytest.raises(ValueError):
        JobRequest(source_type=source_type, sources=[value])


def test_validation_and_native_search():
    req = JobRequest(
        source_type="video",
        sources=["https://youtu.be/abcdefghijk"],
        mode="quick",
        filters={"category": "27"},
    )
    assert req.mode == "full"
    assert source_url("video", req.sources[0]) == "https://youtu.be/abcdefghijk"
    url = native_search_url("music", {"result_type": "shorts", "order": "popularity"})
    assert "sp=" in url and "search_query=music" in url
    original = "https://www.youtube.com/results?search_query=cat&sp=EgIQAQ%3D%3D"
    assert native_search_url(original, {}) == original
    with pytest.raises(ValueError):
        JobRequest(
            source_type="keyword",
            sources=["a"],
            filters={"duration_min": 100, "duration_max": 3},
        )


def test_filters_are_null_safe():
    v = normalize(raw(duration=None, view_count=None, categories=[]))
    assert not matches(v, {"duration_min": 1})
    assert not matches(v, {"views_max": 100})
    assert matches(v, {"category": "unknown"})
    assert matches(
        normalize(raw()), {"category": "27", "date_after": "2025-01-01", "views_min": 0}
    )


def test_database_dedupe_review_many_playlist_fts_and_pagination(tmp_path):
    db = Database(tmp_path / "data.db")
    v = normalize(raw())
    db.upsert(
        v,
        playlist={
            "id": "PL1",
            "title": "One",
            "url": "https://youtube.com/playlist?list=PL1",
        },
    )
    db.save([v["id"]])
    db.review(
        v["id"], {"review_status": "keep", "notes": "retain", "personal_tags": ["work"]}
    )
    db.upsert(
        normalize(raw(title="Updated Python")),
        playlist={
            "id": "PL2",
            "title": "Two",
            "url": "https://youtube.com/playlist?list=PL2",
        },
    )
    db.upsert(normalize(raw(id="12345678901", title="Other")))
    got = db.video(v["id"])
    assert (
        got["notes"] == "retain"
        and got["review_status"] == "keep"
        and got["personal_tags"] == ["work"]
    )
    assert db.videos(q="Python")["total"] == 1
    assert db.groups("playlists")["total"] == 2
    assert db.videos(group_kind="playlists", group_key="PL2")["total"] == 1
    assert db.videos(page_size=1)["total"] == 1
    assert db.stats()["saved_count"] == 1
    assert len(db.videos()["items"]) == 1
    db.close()


def test_shortest_first_fts_rowids_and_chat_track_exclusion(tmp_path):
    v = normalize(
        raw(
            subtitles={
                "live_chat": [{"name": "Chat", "url": "x"}],
                "en": [{"name": "English"}],
            },
            automatic_captions={"danmaku": [{}]},
        )
    )
    assert [t["code"] for t in v["subtitle_languages"]] == ["en"]
    db = Database(tmp_path / "sort.db")
    for vid, duration in [
        ("aaaaaaaaaaa", 200),
        ("bbbbbbbbbbb", 40),
        ("ccccccccccc", None),
    ]:
        db.upsert(normalize(raw(id=vid, duration=duration)))
        db.save([vid])
    assert [v["id"] for v in db.videos(sort="duration")["items"]] == [
        "bbbbbbbbbbb",
        "aaaaaaaaaaa",
        "ccccccccccc",
    ]
    assert (
        db.conn.execute(
            "SELECT rowid FROM videos WHERE id=?", ("bbbbbbbbbbb",)
        ).fetchone()[0]
        == db.conn.execute(
            "SELECT rowid FROM video_fts WHERE id=?", ("bbbbbbbbbbb",)
        ).fetchone()[0]
    )
    db.close()


def test_search_q_alias():
    req = JobRequest(
        source_type="search", sources=["https://www.youtube.com/results?q=music"]
    )
    assert "search_query=music" in native_search_url(
        req.sources[0], {"order": "popularity"}
    )


@pytest.mark.parametrize(
    "kind,url",
    [
        ("playlist", "https://youtu.be/playlist?list=PL123"),
        ("search", "https://youtu.be/results?search_query=cat"),
        ("video", "https://www.youtube.com/watch?v=abcdefghijk\n&list=PL123"),
    ],
)
def test_reject_malformed_and_mismatched_short_host(kind, url):
    with pytest.raises(ValueError):
        JobRequest(source_type=kind, sources=[url])


def test_native_protobuf_uses_multibyte_feature_keys():
    import base64
    from urllib.parse import parse_qs, urlsplit

    url = native_search_url(
        "test",
        {
            "result_type": "shorts",
            "order": "popularity",
            "upload_date": "today",
            "duration": "short",
            "features": ["vr180", "hdr", "location"],
        },
    )
    data = base64.b64decode(parse_qs(urlsplit(url).query)["sp"][0])
    assert data.startswith(b"\x08\x03\x12")
    assert b"\x10\x09" in data and b"\x08\x02" in data and b"\x18\x04" in data
    assert (
        b"\xd0\x01\x01" in data and b"\xc8\x01\x01" in data and b"\xb8\x01\x01" in data
    )


def test_reopen_rebuilds_legacy_fts_rowids_without_touching_reviews(tmp_path):
    path = tmp_path / "legacy.db"
    db = Database(path)
    db.upsert(normalize(raw()))
    db.save(["abcdefghijk"])
    db.review("abcdefghijk", {"notes": "Keep review"})
    with db.conn:
        db.conn.execute("UPDATE video_fts SET rowid=99 WHERE id=?", ("abcdefghijk",))
        db.conn.execute("PRAGMA user_version=0")
    db.close()
    db = Database(path)
    assert db.video("abcdefghijk")["notes"] == "Keep review"
    assert (
        db.conn.execute("SELECT rowid FROM video_fts").fetchone()[0]
        == db.conn.execute("SELECT rowid FROM videos").fetchone()[0]
    )
    db.upsert(normalize(raw(title="Fresh title")))
    assert db.conn.execute("SELECT COUNT(*) FROM video_fts").fetchone()[0] == 1
    assert db.videos(q="Fresh")["total"] == 1
    db.close()


@pytest.mark.parametrize("kind", ["video", "channel", "playlist"])
def test_selected_source_kind_accepts_plain_keywords_but_url_validator_stays_strict(
    kind,
):
    req = JobRequest(source_type=kind, sources=["  nhạc vàng  ", "nhạc vàng"])
    assert req.sources == ["nhạc vàng"]
    with pytest.raises(ValueError):
        source_url(kind, "nhạc vàng")


@pytest.mark.parametrize(
    "value",
    [
        "https://evil.com/x",
        "http://127.0.0.1/x",
        "ftp://youtube.com/x",
        "https://u:p@youtube.com/watch?v=abcdefghijk",
        "--exec touch /tmp/x",
    ],
)
def test_keyword_capable_sources_do_not_turn_unsafe_urls_or_flags_into_searches(value):
    for kind in ["video", "channel", "playlist"]:
        with pytest.raises(ValueError):
            JobRequest(source_type=kind, sources=[value])
