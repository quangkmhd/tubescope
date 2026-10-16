import csv
import io
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.test_core import raw
from tubescope.extractor import ExtractionCancelled, Extractor


class ControlledExtractor:
    version = "controlled-test-only"

    def __init__(self):
        self.block = False
        self.entered = threading.Event()

    def extract(self, url, *, flat=False, limit=100, start=None, end=None, cancel=None):
        self.entered.set()
        if self.block:
            while not cancel.is_set():
                time.sleep(0.005)
            raise ExtractionCancelled()
        if "fail" in url:
            raise RuntimeError("Extractor returned a real error")
        if "list=PL" in url:
            return {
                "id": url.split("list=")[-1],
                "title": "Playlist",
                "entries": [raw()],
            }
        if "results?" in url:
            if "resources" in url:
                return {
                    "entries": [
                        {
                            "id": "UC_x",
                            "title": "Channel",
                            "url": "https://www.youtube.com/channel/UC_x",
                            "ie_key": "YoutubeTab",
                        }
                    ]
                }
            return {"entries": [raw(), raw(id="12345678901")]}
        if "12345678901" in url:
            raise RuntimeError("Unavailable video")
        return raw(
            description="Full description",
            comment_count=999,
            formats=[{"url": "never persist"}],
        )


def finished(c, id):
    for _ in range(300):
        j = c.get("/api/jobs/" + id).json()
        if j["status"] in {
            "completed",
            "partial",
            "failed",
            "cancelled",
            "interrupted",
        }:
            return j
        time.sleep(0.01)
    raise AssertionError(j)


@pytest.fixture
def setup(tmp_path):
    extractor = ControlledExtractor()
    app = create_app(tmp_path / "api.db", extractor=extractor)
    with TestClient(app) as c:
        yield c, app, extractor


def crawl(c, **kw):
    return c.post(
        "/api/jobs",
        json={
            "source_type": "video",
            "sources": ["https://youtu.be/abcdefghijk"],
            **kw,
        },
    )


def test_api_crawl_save_review_refresh_export_and_restart(setup):
    c, app, _ = setup
    assert c.get("/api/health").status_code == 200
    catalog = c.get("/api/catalog").json()
    assert len(catalog["categories"]) == 32 and len(catalog["metadata_groups"]) == 17
    job = crawl(c).json()
    assert finished(c, job["id"])["status"] == "completed"
    rows = c.get("/api/videos", params={"scope": "job", "job_id": job["id"]}).json()
    assert rows["total"] == 1 and rows["items"][0]["saved"] is False
    id = rows["items"][0]["id"]
    assert c.patch(f"/api/videos/{id}/review", json={"notes": "bad"}).status_code == 409
    assert c.post("/api/library/save", json={"video_ids": [id]}).json() == {
        "saved_count": 1,
        "job_id": None,
    }
    assert (
        c.patch(
            f"/api/videos/{id}/review",
            json={
                "review_status": "keep",
                "notes": "Review",
                "personal_tags": ["useful"],
            },
        ).json()["notes"]
        == "Review"
    )
    j = c.post("/api/library/refresh", json={"video_ids": [id]}).json()
    assert finished(c, j["id"])["status"] == "completed"
    assert c.get("/api/videos/" + id).json()["review_status"] == "keep"
    assert c.get("/api/library/stats").json()["saved_count"] == 1
    text = c.get("/api/export.csv").text
    assert (
        text.startswith("\ufeff")
        and "comment_count" not in text
        and "formats" not in text
        and "never persist" not in text
    )
    assert "'=Học Python" in text
    assert c.get("/api/videos", params={"q": "Full"}).json()["total"] == 1
    assert c.get("/api/videos", params={"page_size": 101}).status_code == 422
    assert c.get("/api/videos", params={"scope": "job"}).status_code == 422
    assert c.get("/api/videos", params={"sort": "DROP TABLE videos"}).status_code == 422


def test_partial_errors_and_resources(setup):
    c, app, _ = setup
    j = crawl(c, source_type="keyword", sources=["python"]).json()
    done = finished(c, j["id"])
    assert (
        done["status"] == "partial"
        and done["matched_count"] == 1
        and done["failed_count"] == 1
    )
    assert "Unavailable" in done["errors"][0]["message"]
    j = crawl(
        c,
        source_type="keyword",
        sources=["resources"],
        native={"result_type": "channels"},
    ).json()
    done = finished(c, j["id"])
    assert done["status"] == "completed"
    assert (
        c.get(f"/api/jobs/{j['id']}/resources").json()["items"][0]["kind"] == "channel"
    )
    assert (
        c.get("/api/videos", params={"scope": "job", "job_id": j["id"]}).json()["total"]
        == 0
    )


def test_quick_save_enriches_and_memberships(setup):
    c, app, _ = setup
    j = crawl(
        c,
        source_type="playlist",
        sources=["https://www.youtube.com/playlist?list=PL1"],
        mode="quick",
    ).json()
    assert finished(c, j["id"])["status"] == "completed"
    id = c.get("/api/videos", params={"scope": "job", "job_id": j["id"]}).json()[
        "items"
    ][0]["id"]
    result = c.post("/api/library/save", json={"video_ids": [id]}).json()
    assert result["job_id"] and result["saved_count"] == 0
    assert finished(c, result["job_id"])["status"] == "completed"
    assert c.get("/api/videos/" + id).json()["metadata_level"] == "full"
    j = crawl(
        c, source_type="playlist", sources=["https://www.youtube.com/playlist?list=PL2"]
    ).json()
    assert finished(c, j["id"])["skipped_count"] == 1
    assert (
        c.get("/api/library/groups", params={"kind": "playlists"}).json()["total"] == 2
    )


def test_cancel_durable_recovery_and_retry(setup):
    c, app, extractor = setup
    extractor.block = True
    j = crawl(c).json()
    assert extractor.entered.wait(2)
    assert c.post(f"/api/jobs/{j['id']}/cancel").json()["status"] == "cancelled"
    assert finished(c, j["id"])["matched_count"] == 0
    extractor.block = False
    retry = c.post(f"/api/jobs/{j['id']}/retry")
    assert (
        retry.status_code == 202
        and finished(c, retry.json()["id"])["status"] == "completed"
    )
    assert c.post(f"/api/jobs/{retry.json()['id']}/retry").status_code == 409
    interrupted = app.state.worker.submit(
        {"source_type": "video", "sources": ["https://youtu.be/abcdefghijk"]},
        wake=False,
    )
    app.state.db.recover()
    assert c.get("/api/jobs/" + interrupted["id"]).json()["status"] == "interrupted"


def test_api_validation(setup):
    c, _, _ = setup
    for source in [
        "https://evil.com/watch?v=abcdefghijk",
        "https://youtube.com:443/watch?v=abcdefghijk",
        "--exec echo attack",
    ]:
        response = crawl(c, sources=[source])
        assert response.status_code == 422 and isinstance(
            response.json()["detail"], str
        )
    assert crawl(c, limit=1001).status_code == 422
    assert (
        c.post("/api/library/refresh", json={"video_ids": ["missing0000"]}).status_code
        == 404
    )


def test_real_subprocess_cancel_and_timeout(tmp_path):
    script = tmp_path / "extractor.py"
    script.write_text("import time\ntime.sleep(60)\n")
    import sys

    extractor = Extractor(command=[sys.executable, str(script)], timeout=0.1)
    with pytest.raises(TimeoutError):
        extractor.extract("https://youtu.be/abcdefghijk", cancel=threading.Event())
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(ExtractionCancelled):
        extractor.extract("https://youtu.be/abcdefghijk", cancel=cancel)


def test_job_existing_filter_tracks_current_save_state(setup):
    c, _, _ = setup
    j = crawl(c).json()
    finished(c, j["id"])
    params = {"scope": "job", "job_id": j["id"], "existing": "new"}
    assert c.get("/api/videos", params=params).json()["total"] == 1
    c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
    assert c.get("/api/videos", params=params).json()["total"] == 0
    assert (
        c.get("/api/videos", params={**params, "existing": "saved"}).json()["total"]
        == 1
    )


def test_restart_preserves_saved_review_and_interrupts_queue(tmp_path):
    path = tmp_path / "restart.db"
    first = create_app(path, extractor=ControlledExtractor())
    with TestClient(first) as c:
        j = crawl(c).json()
        finished(c, j["id"])
        c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
        c.patch(
            "/api/videos/abcdefghijk/review",
            json={"notes": "Persist me", "review_status": "skip"},
        )
        pending = first.state.worker.submit(
            {"source_type": "video", "sources": ["https://youtu.be/abcdefghijk"]},
            wake=False,
        )
    second = create_app(path, extractor=ControlledExtractor())
    with TestClient(second) as c:
        assert c.get("/api/videos/abcdefghijk").json()["notes"] == "Persist me"
        assert c.get("/api/library/stats").json()["skip_count"] == 1
        assert c.get("/api/jobs/" + pending["id"]).json()["status"] == "interrupted"


def test_queue_is_bounded_and_jobs_paginated(tmp_path):
    app = create_app(tmp_path / "queue.db", extractor=ControlledExtractor())
    try:
        for _ in range(30):
            app.state.worker.submit(
                {"source_type": "keyword", "sources": ["one"]}, wake=False
            )
        with pytest.raises(OverflowError):
            app.state.worker.submit(
                {"source_type": "keyword", "sources": ["overflow"]}, wake=False
            )
        page = app.state.db.jobs(page=2, page_size=7)
        assert page["total"] == 30 and len(page["items"]) == 7
    finally:
        app.state.db.close()


def test_export_obeys_group_ids_status_and_search(setup):
    c, _, _ = setup
    j = crawl(c).json()
    finished(c, j["id"])
    c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
    c.patch(
        "/api/videos/abcdefghijk/review",
        json={"notes": "\t=cmd()", "review_status": "keep"},
    )
    assert (
        "'\t=cmd()"
        in c.get("/api/export.csv", params={"status": "keep", "q": "Full"}).text
    )
    assert (
        len(
            list(
                csv.reader(
                    io.StringIO(
                        c.get("/api/export.csv", params={"status": "skip"}).text
                    )
                )
            )
        )
        == 1
    )
    assert (
        len(
            list(
                csv.reader(
                    io.StringIO(
                        c.get(
                            "/api/export.csv", params={"video_ids": "12345678901"}
                        ).text
                    )
                )
            )
        )
        == 1
    )
    assert (
        len(
            list(
                csv.reader(
                    io.StringIO(
                        c.get(
                            "/api/export.csv",
                            params={"group_kind": "channels", "group_key": "different"},
                        ).text
                    )
                )
            )
        )
        == 1
    )


def test_running_subprocess_cancellation_terminates_child_process_group(tmp_path):
    import sys

    pid_file = tmp_path / "child.pid"
    script = tmp_path / "tree.py"
    script.write_text(
        "import subprocess,sys,time,pathlib\np=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])\npathlib.Path(sys.argv[1]).write_text(str(p.pid))\ntime.sleep(60)\n"
    )
    extractor = Extractor(
        command=[sys.executable, str(script), str(pid_file)], timeout=3
    )
    cancel = threading.Event()
    errors = []

    def run():
        try:
            extractor.extract("https://youtu.be/abcdefghijk", cancel=cancel)
        except Exception as e:
            errors.append(e)

    thread = threading.Thread(target=run)
    thread.start()
    for _ in range(100):
        if pid_file.exists():
            break
        time.sleep(0.01)
    assert pid_file.exists()
    cancel.set()
    thread.join(4)
    assert not thread.is_alive() and isinstance(errors[0], ExtractionCancelled)
    pid = int(pid_file.read_text())
    try:
        stat = open(f"/proc/{pid}/stat").read()
        assert (
            stat.split()[2] == "Z"
        )  # A zombie is terminated, waiting for host PID1 to reap.
    except FileNotFoundError:
        pass


def test_extractor_reads_bounded_json_and_reports_nonzero_exit(tmp_path):
    import sys

    script = tmp_path / "json.py"
    script.write_text('print(\'{"id":"abcdefghijk","title":"real boundary"}\')\n')
    assert (
        Extractor(command=[sys.executable, str(script)]).extract(
            "https://youtu.be/abcdefghijk"
        )["title"]
        == "real boundary"
    )
    script.write_text(
        "import sys\nprint('external failure',file=sys.stderr)\nsys.exit(7)\n"
    )
    with pytest.raises(RuntimeError, match="external failure"):
        Extractor(command=[sys.executable, str(script)]).extract(
            "https://youtu.be/abcdefghijk"
        )


def test_metadata_capture_never_uses_disk_spooling(tmp_path, monkeypatch):
    import sys
    import tempfile

    def refuse(*args, **kwargs):
        raise AssertionError("Raw metadata may not be persisted, even temporarily")

    script = tmp_path / "json_stdout.py"
    script.write_text('print(\'{"id":"abcdefghijk"}\')')
    monkeypatch.setattr(tempfile, "TemporaryFile", refuse)
    assert (
        Extractor(command=[sys.executable, str(script)]).extract(
            "https://youtu.be/abcdefghijk"
        )["id"]
        == "abcdefghijk"
    )


def test_one_video_timeout_keeps_other_video_results(setup):
    c, app, extractor = setup
    original = extractor.extract

    def extract(url, **kwargs):
        if "12345678901" in url:
            raise TimeoutError("video timeout")
        return original(url, **kwargs)

    extractor.extract = extract
    j = crawl(c, source_type="keyword", sources=["python"]).json()
    done = finished(c, j["id"])
    assert (
        done["status"] == "partial"
        and done["failed_count"] == 1
        and done["matched_count"] == 1
    )
    assert done["errors"][0]["message"] == "video timeout"


def test_full_crawl_prefilters_listing_but_enriches_unknown_and_checks_final_values(
    setup,
):
    c, app, extractor = setup
    calls = []
    entries = [
        raw(id="aaaaaaaaaaa", duration=60, view_count=2000000),
        raw(id="bbbbbbbbbbb", duration=3600, view_count=25000),
        raw(id="ccccccccccc", duration=None, view_count=None),
        raw(id="ddddddddddd", duration=3600, view_count=999000),
        raw(id="eeeeeeeeeee", duration=3600, view_count=2000000),
    ]

    def extract(url, **kwargs):
        if kwargs.get("flat"):
            return {"entries": entries}
        vid = url.split("=")[-1]
        calls.append(vid)
        return raw(
            id=vid,
            duration=3600,
            view_count=500000 if vid == "eeeeeeeeeee" else 1000001,
        )

    extractor.extract = extract
    j = crawl(
        c,
        source_type="channel",
        sources=["https://www.youtube.com/@test"],
        filters={"duration_min": 1201, "views_min": 1000000},
    ).json()
    done = finished(c, j["id"])
    assert calls == ["ccccccccccc", "ddddddddddd", "eeeeeeeeeee"]
    assert done["status"] == "completed"
    assert done["scanned_count"] == 5
    assert done["prefiltered_count"] == 2
    assert done["detailed_count"] == 3
    assert done["matched_count"] == 2
    assert done["failed_count"] == 0
    rows = c.get("/api/videos", params={"scope": "job", "job_id": j["id"]}).json()
    assert {v["id"] for v in rows["items"]} == {"ccccccccccc", "ddddddddddd"}
    assert all(v["metadata_level"] == "full" for v in rows["items"])


def test_prefilter_preserves_existing_review_and_observed_playlist(setup):
    c, app, extractor = setup
    first = crawl(c).json()
    finished(c, first["id"])
    c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
    c.patch(
        "/api/videos/abcdefghijk/review",
        json={"notes": "Keep this", "review_status": "keep"},
    )
    calls = []

    def extract(url, **kwargs):
        calls.append(url)
        return {"title": "Observed playlist", "entries": [raw(duration=60)]}

    extractor.extract = extract
    j = crawl(
        c,
        source_type="playlist",
        sources=["https://www.youtube.com/playlist?list=PLnew"],
        existing_policy="update",
        filters={"duration_min": 1201},
    ).json()
    done = finished(c, j["id"])
    assert calls == ["https://www.youtube.com/playlist?list=PLnew"]
    assert done["prefiltered_count"] == 1
    assert done["matched_count"] == 0
    assert c.get("/api/videos/abcdefghijk").json()["notes"] == "Keep this"
    assert c.get("/api/library/groups?kind=playlists").json()["total"] == 1


@pytest.mark.parametrize("later_views", [1100000, None])
@pytest.mark.parametrize("fails_once", [False, True])
def test_prefiltered_duplicate_is_reconsidered_with_all_playlist_and_shorts_evidence(
    setup, later_views, fails_once
):
    c, app, extractor = setup
    detailed = []

    def extract(url, **kwargs):
        if kwargs.get("flat"):
            first = "PLfirst" in url
            return {
                "title": "First" if first else "Second",
                "entries": [
                    raw(
                        view_count=980000 if first else later_views,
                        webpage_url="https://www.youtube.com/shorts/abcdefghijk"
                        if first
                        else "https://www.youtube.com/watch?v=abcdefghijk",
                    )
                ],
            }
        detailed.append(url)
        if fails_once and len(detailed) == 1:
            raise RuntimeError("Transient extraction failure")
        return raw(view_count=1100000)

    extractor.extract = extract
    j = crawl(
        c,
        source_type="playlist",
        sources=[
            "https://www.youtube.com/playlist?list=PLfirst",
            "https://www.youtube.com/playlist?list=PLsecond",
        ],
        filters={"views_min": 1000000},
    ).json()
    done = finished(c, j["id"])
    if fails_once:
        assert done["status"] == "failed"
        done = finished(c, c.post(f"/api/jobs/{j['id']}/retry").json()["id"])
    assert done["matched_count"] == 1
    assert done["scanned_count"] == 1
    assert done["prefiltered_count"] == 0
    assert done["detailed_count"] == 1
    assert detailed == ["https://www.youtube.com/shorts/abcdefghijk"] * (
        2 if fails_once else 1
    )
    assert (
        c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]}).json()[
            "saved_count"
        ]
        == 1
    )
    assert c.get("/api/videos/abcdefghijk").json()["content_type"] == "shorts"
    assert {
        g["key"] for g in c.get("/api/library/groups?kind=playlists").json()["items"]
    } == {"PLfirst", "PLsecond"}


@pytest.mark.parametrize("source_type", ["playlist", "channel"])
@pytest.mark.parametrize("seed_full", [False, True])
def test_later_rejected_shorts_evidence_is_preserved_before_enrichment(
    setup, source_type, seed_full
):
    c, app, extractor = setup
    if seed_full:
        first = crawl(c).json()
        finished(c, first["id"])
        c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
        c.patch("/api/videos/abcdefghijk/review", json={"notes": "Preserved review"})
    observations = 0
    details = []

    def extract(url, **kwargs):
        nonlocal observations
        if kwargs.get("flat"):
            observations += 1
            if observations == 3 and seed_full:
                cached = c.get("/api/videos/abcdefghijk").json()
                assert cached["metadata_level"] == "full"
                assert cached["description"] == "Full description"
                assert cached["notes"] == "Preserved review"
            return {
                "entries": [
                    raw(
                        view_count=None if observations == 3 else 980000,
                        webpage_url="https://www.youtube.com/shorts/abcdefghijk"
                        if observations == 2
                        else "https://www.youtube.com/watch?v=abcdefghijk",
                    )
                ],
                "title": "Observed",
            }
        details.append(url)
        return raw(view_count=1100000)

    extractor.extract = extract
    sources = (
        [f"https://www.youtube.com/playlist?list=PL{i}" for i in range(3)]
        if source_type == "playlist"
        else [f"https://www.youtube.com/@source{i}/videos" for i in range(3)]
    )
    j = crawl(
        c,
        source_type=source_type,
        sources=sources,
        existing_policy="update",
        filters={"views_min": 1000000, "content_types": ["shorts"]},
    ).json()
    done = finished(c, j["id"])
    assert done["status"] == "completed"
    assert done["matched_count"] == 1
    assert done["scanned_count"] == 1
    assert done["prefiltered_count"] == 0
    assert details == ["https://www.youtube.com/shorts/abcdefghijk"]
    c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
    assert c.get("/api/videos/abcdefghijk").json()["content_type"] == "shorts"
    if source_type == "playlist":
        assert c.get("/api/library/groups?kind=playlists").json()["total"] == 3


def test_bare_channel_interleaves_tabs_preserves_shorts_and_global_cap(setup):
    c, app, extractor = setup

    def extract(url, **kwargs):
        if "/@mixed" in url:
            return {
                "entries": [
                    {
                        "_type": "playlist",
                        "id": "UCvideos",
                        "title": "Videos",
                        "webpage_url": "https://www.youtube.com/@mixed/videos",
                        "entries": [raw(id="aaaaaaaaaaa"), raw(id="bbbbbbbbbbb")],
                    },
                    {
                        "_type": "playlist",
                        "id": "UCshorts",
                        "title": "Shorts",
                        "webpage_url": "https://www.youtube.com/@mixed/shorts",
                        "entries": [raw(id="ccccccccccc"), raw(id="ddddddddddd")],
                    },
                    {
                        "_type": "playlist",
                        "id": "UCstreams",
                        "title": "Streams",
                        "webpage_url": "https://www.youtube.com/@mixed/streams",
                        "entries": [raw(id="eeeeeeeeeee", live_status="was_live")],
                    },
                ]
            }
        return raw(id=url.split("=")[-1] if "?v=" in url else url.rsplit("/", 1)[-1])

    extractor.extract = extract
    j = crawl(
        c, source_type="channel", sources=["https://www.youtube.com/@mixed"], limit=3
    ).json()
    assert finished(c, j["id"])["matched_count"] == 3
    rows = c.get("/api/videos", params={"scope": "job", "job_id": j["id"]}).json()
    assert {v["id"] for v in rows["items"]} == {
        "aaaaaaaaaaa",
        "ccccccccccc",
        "eeeeeeeeeee",
    }
    assert (
        next(v for v in rows["items"] if v["id"] == "ccccccccccc")["content_type"]
        == "shorts"
    )


def test_channel_shorts_filter_selects_shorts_tab_before_candidate_limit(setup):
    c, app, extractor = setup
    seen = []

    def extract(url, **kwargs):
        seen.append(url)
        if kwargs.get("flat"):
            return {
                "entries": [
                    raw(webpage_url="https://www.youtube.com/shorts/abcdefghijk")
                ]
            }
        return raw()

    extractor.extract = extract
    j = crawl(
        c,
        source_type="channel",
        sources=["https://www.youtube.com/@mixed"],
        limit=1,
        filters={"content_types": ["shorts"]},
    ).json()
    assert finished(c, j["id"])["matched_count"] == 1
    assert seen[0] == "https://www.youtube.com/@mixed/shorts"


def test_importing_api_does_not_open_or_migrate_default_database(tmp_path):
    import os
    import subprocess
    import sys

    path = tmp_path / "import.sqlite3"
    subprocess.run(
        [sys.executable, "-c", "import app.main"],
        env={**os.environ, "TUBESCOPE_DB": str(path)},
        check=True,
    )
    assert not path.exists()


def test_cancel_remains_responsive_after_extractor_closes_output_pipes(tmp_path):
    import sys

    script = tmp_path / "closed_pipes.py"
    script.write_text("import os,time\nos.close(1)\nos.close(2)\ntime.sleep(60)\n")
    extractor = Extractor(command=[sys.executable, str(script)], timeout=1)
    cancel = threading.Event()
    errors = []

    def run():
        try:
            extractor.extract("https://youtu.be/abcdefghijk", cancel=cancel)
        except Exception as e:
            errors.append(e)

    thread = threading.Thread(target=run)
    thread.start()
    time.sleep(0.1)
    cancel.set()
    thread.join(0.5)
    assert not thread.is_alive()
    assert isinstance(errors[0], ExtractionCancelled)


def test_partial_playlist_retry_preserves_membership_shorts_and_origin_without_recrawl(
    setup,
):
    c, app, extractor = setup
    calls = []
    failed = True

    def extract(url, **kwargs):
        nonlocal failed
        calls.append(url)
        if kwargs.get("flat"):
            return {
                "title": "Original playlist",
                "entries": [
                    raw(id="aaaaaaaaaaa"),
                    raw(
                        id="bbbbbbbbbbb",
                        webpage_url="https://www.youtube.com/shorts/bbbbbbbbbbb",
                    ),
                ],
            }
        if "bbbbbbbbbbb" in url and failed:
            raise RuntimeError("Transient Shorts failure")
        vid = url.split("=")[-1] if "?v=" in url else url.rsplit("/", 1)[-1]
        # Real full extraction normalizes Shorts URLs to watch; only source evidence identifies Shorts.
        return raw(id=vid)

    extractor.extract = extract
    playlist_url = "https://www.youtube.com/playlist?list=PLretry"
    first = crawl(c, source_type="playlist", sources=[playlist_url]).json()
    assert finished(c, first["id"])["status"] == "partial"
    failed = False
    retried = c.post(f"/api/jobs/{first['id']}/retry").json()
    assert finished(c, retried["id"])["status"] == "completed"
    assert c.get("/api/videos/bbbbbbbbbbb").json()["content_type"] == "shorts"
    assert c.get("/api/videos/bbbbbbbbbbb").json()["source"] == playlist_url
    assert calls.count(playlist_url) == 1
    assert sum("aaaaaaaaaaa" in url for url in calls) == 1
    c.post("/api/library/save", json={"video_ids": ["bbbbbbbbbbb"]})
    groups = c.get("/api/library/groups", params={"kind": "playlists"}).json()
    assert groups["total"] == 1 and groups["items"][0]["key"] == "PLretry"
    assert groups["items"][0]["title"] == "Original playlist"


def test_repeated_failed_candidate_retries_keep_context_after_database_reopen(tmp_path):
    path = tmp_path / "retry_context.sqlite3"
    extractor = ControlledExtractor()

    def extract(url, **kwargs):
        if kwargs.get("flat"):
            return {
                "title": "Retained playlist",
                "entries": [
                    raw(webpage_url="https://www.youtube.com/shorts/abcdefghijk")
                ],
            }
        raise RuntimeError("Still unavailable")

    extractor.extract = extract
    with TestClient(create_app(path, extractor=extractor)) as c:
        first = crawl(
            c,
            source_type="playlist",
            sources=["https://www.youtube.com/playlist?list=PLpersist"],
        ).json()
        assert finished(c, first["id"])["status"] == "failed"
        second = c.post(f"/api/jobs/{first['id']}/retry").json()
        assert finished(c, second["id"])["status"] == "failed"
    with TestClient(create_app(path, extractor=ControlledExtractor())) as c:
        third = c.post(f"/api/jobs/{second['id']}/retry").json()
        assert finished(c, third["id"])["status"] == "completed"
        assert c.get("/api/videos/abcdefghijk").json()["content_type"] == "shorts"
        c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
        assert (
            c.get("/api/library/groups", params={"kind": "playlists"}).json()["items"][
                0
            ]["key"]
            == "PLpersist"
        )


def test_failed_duplicate_candidate_retry_preserves_all_playlist_memberships(setup):
    c, app, extractor = setup
    unavailable = True
    extracted = []

    def extract(url, **kwargs):
        if kwargs.get("flat"):
            return {
                "title": "Playlist " + url.split("=")[-1],
                "entries": [
                    raw(webpage_url="https://www.youtube.com/shorts/abcdefghijk")
                ],
            }
        extracted.append(url)
        if unavailable:
            raise RuntimeError("One deduplicated extraction failed")
        return raw()

    extractor.extract = extract
    sources = [
        "https://www.youtube.com/playlist?list=PLfirst",
        "https://www.youtube.com/playlist?list=PLsecond",
    ]
    first = crawl(c, source_type="playlist", sources=sources).json()
    assert finished(c, first["id"])["status"] == "failed"
    assert len(extracted) == 1
    unavailable = False
    retried = c.post(f"/api/jobs/{first['id']}/retry").json()
    assert finished(c, retried["id"])["status"] == "completed"
    assert len(extracted) == 2
    assert c.get("/api/videos/abcdefghijk").json()["content_type"] == "shorts"
    c.post("/api/library/save", json={"video_ids": ["abcdefghijk"]})
    groups = c.get("/api/library/groups", params={"kind": "playlists"}).json()
    assert {g["key"] for g in groups["items"]} == {"PLfirst", "PLsecond"}
