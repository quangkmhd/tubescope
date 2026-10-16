"""One local worker backed by durable jobs and incremental result membership."""

from __future__ import annotations

import threading
import time
import uuid
from contextlib import contextmanager
from urllib.parse import parse_qs, urlsplit

from .core import (
    SEARCH_TARGETS,
    VIDEO_ID,
    JobRequest,
    keyword_input,
    listing_rejects,
    matches,
    native_search_url,
    normalize,
    now,
    source_url,
)
from .database import TERMINAL
from .extractor import ExtractionCancelled


class JobDeadlineExceeded(TimeoutError):
    """The complete job budget expired, distinct from one extractor timeout."""


def listing_entries(entries, *, shorts=False, depth=0, content_types=None):
    """Interleave channel tabs, carrying canonical Shorts evidence to enrichment."""
    if depth > 5:
        raise ValueError("The source contains too many nested playlists.")
    branches = []
    for entry in entries:
        if isinstance(entry, dict) and isinstance(entry.get("entries"), list):
            tab_url = entry.get("webpage_url") or entry.get("url") or ""
            tab = urlsplit(tab_url).path.rstrip("/").rsplit("/", 1)[-1]
            tab_type = {
                "videos": "video",
                "shorts": "shorts",
                "streams": "livestream",
            }.get(tab)
            if content_types and tab_type and tab_type not in content_types:
                continue
            branches.append(
                iter(
                    listing_entries(
                        entry["entries"],
                        shorts=shorts or tab == "shorts",
                        depth=depth + 1,
                        content_types=content_types,
                    )
                )
            )
        else:
            branches.append(iter([(entry, shorts)]))
    while branches:
        remaining = []
        for branch in branches:
            try:
                yield next(branch)
                remaining.append(branch)
            except StopIteration:
                pass
        branches = remaining


class Worker:
    def __init__(self, db, extractor):
        self.db = db
        self.extractor = extractor
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.active_lock = threading.RLock()
        self.active_id = None
        self.cancel_event = None
        self.thread = threading.Thread(
            target=self._loop, name="tubescope-extraction", daemon=True
        )

    def start(self):
        self.db.recover()
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.wake.set()
        with self.active_lock:
            if self.cancel_event:
                self.cancel_event.set()
        self.thread.join(timeout=8)
        if self.thread.is_alive():
            raise RuntimeError("Extraction worker did not stop")

    def submit(
        self, body, *, kind="crawl", video_ids=None, wake=True, retry_items=None
    ):
        req = JobRequest.model_validate(body)
        request = req.model_dump(mode="json")
        request["_kind"] = kind
        if video_ids is not None:
            request["_video_ids"] = video_ids
        if retry_items:
            request["_retry_items"] = retry_items
        search_target = None
        if req.source_type in {"keyword", "search"}:
            search_target = req.native.result_type
        elif all(keyword_input(source) for source in req.sources):
            search_target = SEARCH_TARGETS.get(req.source_type)
        job = {
            "id": uuid.uuid4().hex,
            "status": "queued",
            "kind": kind,
            "source_type": req.source_type,
            "search_target": search_target,
            "sources": req.sources,
            "mode": req.mode,
            "limit": req.limit,
            "phase": "queued",
            "scanned_count": 0,
            "processed_count": 0,
            "discovery_complete": False,
            "termination_reason": None,
            "prefiltered_count": 0,
            "detailed_count": 0,
            "matched_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "total_count": None,
            "created_at": now(),
            "started_at": None,
            "finished_at": None,
            "error": None,
            "errors": [],
        }
        self.db.add_job(job, request)
        if wake:
            self.wake.set()
        return job

    def cancel(self, id):
        with self.active_lock, self.db.lock:
            job = self.db.job(id)
            if job is None:
                raise KeyError(id)
            if job["status"] in TERMINAL:
                return job
            if id == self.active_id and self.cancel_event:
                self.cancel_event.set()
            return self.db.update_job(
                id,
                status="cancelled",
                phase="cancelled",
                finished_at=now(),
                termination_reason="user_cancelled",
                error="The collection was cancelled by the user.",
            )

    def retry(self, id):
        job = self.db.job(id)
        if not job:
            raise KeyError(id)
        if job["status"] not in {"failed", "partial", "cancelled", "interrupted"}:
            raise ValueError("This collection has no items to retry.")
        req = self.db.job_request(id)
        kind = req.pop("_kind", "crawl")
        ids = req.pop("_video_ids", None)
        prior_retry_items = req.pop("_retry_items", None)
        failed_items = req.pop("_failed_items", [])
        items = (
            prior_retry_items if job["status"] in {"cancelled", "interrupted"} else None
        )
        if job["status"] in {"failed", "partial"} and kind == "crawl" and job["errors"]:
            items = []
            for index, e in enumerate(job["errors"]):
                if index < len(failed_items) and failed_items[index] is not None:
                    items.append(failed_items[index])
                    continue
                try:
                    source_url("video", e["source"])
                    kind_source = "video"
                except ValueError:
                    kind_source = req["source_type"]
                items.append({"source_type": kind_source, "source": e["source"]})
        return self.submit(req, kind=kind, video_ids=ids, retry_items=items)

    def _loop(self):
        while not self.stop_event.is_set():
            id = self.db.next_job()
            if id:
                with self.active_lock, self.db.lock:
                    if self.db.job(id)["status"] != "queued":
                        continue
                    self.active_id = id
                    self.cancel_event = threading.Event()
                    self.db.update_job(
                        id, status="running", phase="extracting", started_at=now()
                    )
                try:
                    self._run(id, self.cancel_event)
                except ExtractionCancelled:
                    status = "interrupted" if self.stop_event.is_set() else "cancelled"
                    with self.db.lock:
                        if self.db.job(id)["status"] != "cancelled":
                            self.db.update_job(
                                id,
                                status=status,
                                phase=status,
                                finished_at=now(),
                                termination_reason="service_restart"
                                if status == "interrupted"
                                else "user_cancelled",
                                error="The server stopped; retry the collection."
                                if status == "interrupted"
                                else "The collection was cancelled by the user.",
                            )
                except Exception as exc:
                    with self.db.lock:
                        if self.db.job(id)["status"] != "cancelled":
                            self.db.update_job(
                                id,
                                status="failed",
                                phase="failed",
                                error=str(exc)[:3000],
                                finished_at=now(),
                            )
                finally:
                    with self.active_lock:
                        self.active_id = None
                        self.cancel_event = None
            else:
                self.wake.wait(0.2)
                self.wake.clear()

    def _error(self, id, source, exc, retry_item=None):
        self.db.record_job_failure(id, source, str(exc)[:3000], retry_item)

    @staticmethod
    def _check(cancel, deadline):
        if cancel.is_set():
            raise ExtractionCancelled()
        if time.monotonic() > deadline:
            raise JobDeadlineExceeded(
                "The collection exceeded the 30-minute processing limit."
            )

    @contextmanager
    def _publication(self, id, cancel, deadline):
        # cancel() takes this same lock before setting the event or terminal state.
        # Keep extraction outside: one completed occurrence publishes atomically.
        with self.db.lock:
            self._check(cancel, deadline)
            yield
            self.db.increment(id, processed_count=1)

    def _run(self, id, cancel):
        req = self.db.job_request(id)
        deadline = time.monotonic() + 1800
        mode = req["mode"]
        kind = req["_kind"]
        filters = req["filters"]
        seen = set()
        considered = set()
        prefiltered = set()
        failed_candidates = {}
        total = 0

        def extract(url, **options):
            self._check(cancel, deadline)
            return self.extractor.extract(url, cancel=cancel, **options)

        def clear_prefilter(vid):
            if vid in prefiltered:
                prefiltered.remove(vid)
                self.db.increment(id, prefiltered_count=-1)

        def failed(source, exc, retry_item=None, *, candidate=False):
            if candidate:
                with self._publication(id, cancel, deadline):
                    self._error(id, source, exc, retry_item)
            else:
                with self.db.lock:
                    self._check(cancel, deadline)
                    self._error(id, source, exc, retry_item)

        def cached_metadata(video):
            return {
                key: value
                for key, value in video.items()
                if key
                not in {"saved", "saved_at", "review_status", "notes", "personal_tags"}
            }

        def ingest(entry, source, playlist=None, shorts=False):
            video_id = str(entry.get("id") or "")
            if video_id in failed_candidates:
                # Retain each duplicate's retry context without extracting again.
                raise RuntimeError(failed_candidates[video_id])
            try:
                ingest_candidate(entry, source, playlist, shorts)
            except (ExtractionCancelled, JobDeadlineExceeded):
                raise
            except Exception as exc:
                failed_candidates[video_id] = str(exc)[:3000]
                raise

        def ingest_candidate(entry, source, playlist=None, shorts=False):
            self._check(cancel, deadline)
            vid = str(entry.get("id") or "")
            if not VIDEO_ID.fullmatch(vid):
                raise ValueError(
                    "The source item does not contain a valid YouTube video ID."
                )
            old = self.db.video(vid)
            if vid in seen:
                # Each duplicate still completes one discovered occurrence.
                with self._publication(id, cancel, deadline):
                    if old and playlist:
                        self.db.upsert(cached_metadata(old), playlist=playlist)
                return
            with self.db.lock:
                self._check(cancel, deadline)
                if vid not in considered:
                    considered.add(vid)
                    self.db.increment(id, scanned_count=1)
                self.db.update_job(id, phase=f"extracting {vid}")
            existing = bool(old and old["saved"])
            skip = existing and req["existing_policy"] == "skip" and kind == "crawl"
            if skip:
                v = old
            elif mode == "full":
                short_evidence = (
                    shorts
                    or bool(
                        old
                        and (
                            old["content_type"] == "shorts" or "/shorts/" in old["url"]
                        )
                    )
                    or any(
                        "youtube.com/shorts/" in str(entry.get(key) or "")
                        for key in ("url", "webpage_url")
                    )
                )
                if kind == "crawl" and listing_rejects(entry, filters):
                    with self._publication(id, cancel, deadline):
                        # Preserve observed evidence without fetching rejected metadata.
                        if old is None:
                            self.db.upsert(
                                normalize(
                                    entry, mode="quick", source=source, shorts=shorts
                                ),
                                playlist=playlist,
                            )
                        elif playlist or short_evidence:
                            cached = cached_metadata(old)
                            if short_evidence:
                                cached["url"] = f"https://www.youtube.com/shorts/{vid}"
                                if cached["content_type"] != "livestream":
                                    cached["content_type"] = "shorts"
                            self.db.upsert(cached, playlist=playlist)
                        if vid not in prefiltered:
                            prefiltered.add(vid)
                            self.db.increment(id, prefiltered_count=1)
                        self.db.update_job(id, phase="filtering")
                    return
                with self.db.lock:
                    self._check(cancel, deadline)
                    clear_prefilter(vid)
                # No database publication lock is held during extractor/network work.
                raw = extract(
                    f"https://www.youtube.com/{'shorts/' if short_evidence else 'watch?v='}{vid}"
                )
                v = normalize(raw, mode="full", source=source, shorts=short_evidence)
            else:
                v = normalize(entry, mode="quick", source=source, shorts=shorts)
            with self._publication(id, cancel, deadline):
                clear_prefilter(vid)
                if skip:
                    if playlist:
                        self.db.upsert(cached_metadata(old), playlist=playlist)
                    self.db.increment(id, skipped_count=1)
                else:
                    self.db.upsert(v, playlist=playlist)
                    if mode == "full":
                        self.db.increment(id, detailed_count=1)
                seen.add(vid)
                if kind == "save":
                    self.db.save([vid])
                if matches(v, filters) and not (
                    req["source_type"] in {"keyword", "search"}
                    and req["native"]["result_type"] == "longform"
                    and v["content_type"] == "shorts"
                ):
                    self.db.link_job(id, vid, existing)
                    self.db.increment(id, matched_count=1)

        if kind in {"save", "refresh"}:
            ids = req.get("_video_ids", [])
            self.db.update_job(id, total_count=len(ids), discovery_complete=True)
            for vid in ids:
                v = self.db.video(vid)
                try:
                    ingest(
                        {"id": vid, "url": v["url"]},
                        v.get("source") or v["url"],
                        shorts=v["content_type"] == "shorts",
                    )
                except (ExtractionCancelled, JobDeadlineExceeded):
                    raise
                except Exception as exc:
                    failed(v["url"], exc, candidate=True)
        else:
            sources = req.get("_retry_items") or [
                {"source_type": req["source_type"], "source": s} for s in req["sources"]
            ]
            direct_sources = all(
                item["source_type"] == "video" and not keyword_input(item["source"])
                for item in sources
            )
            if direct_sources:
                total = len(sources)
                self.db.update_job(id, total_count=total, discovery_complete=True)
            for source_index, item in enumerate(sources):
                self._check(cancel, deadline)
                source = item["source"]
                st = item["source_type"]
                native = req["native"]
                if st in SEARCH_TARGETS and keyword_input(source):
                    target = SEARCH_TARGETS[st]
                    native = dict(native, result_type=target)
                    if target in {"channels", "playlists"}:
                        native = {"result_type": target, "order": native["order"]}
                    st = "keyword"
                url = (
                    native_search_url(source, native)
                    if st in {"keyword", "search"}
                    else source
                )
                if st == "channel":
                    p = urlsplit(url).path.rstrip("/").strip("/").split("/")
                    if (p[0].startswith("@") and len(p) == 1) or (
                        p[0] in {"channel", "c", "user"} and len(p) == 2
                    ):
                        types = filters.get("content_types") or []
                        if len(types) == 1:
                            url = (
                                url.rstrip("/")
                                + "/"
                                + {
                                    "video": "videos",
                                    "shorts": "shorts",
                                    "livestream": "streams",
                                }[types[0]]
                            )
                try:
                    if st == "video":
                        if not direct_sources:
                            total += 1
                            self.db.update_job(
                                id,
                                total_count=total,
                                discovery_complete=source_index == len(sources) - 1,
                            )
                        u = urlsplit(source)
                        q = parse_qs(u.query)
                        vid = q.get("v", [u.path.rstrip("/").split("/")[-1]])[0]
                        if mode == "quick":
                            entry = extract(
                                url
                            )  # No flat listing for a standalone video.
                        else:
                            entry = {"id": vid, "url": source}
                        ingest(
                            entry,
                            item.get("origin_source", source),
                            playlist=item.get("playlist"),
                            shorts=item.get("shorts", False) or "/shorts/" in source,
                        )
                        continue
                    listing = extract(
                        url,
                        flat=True,
                        limit=req["limit"],
                        start=filters.get("playlist_start")
                        if st == "playlist"
                        else None,
                        end=filters.get("playlist_end") if st == "playlist" else None,
                    )
                    entries = listing.get("entries")
                    if entries is None:
                        raise RuntimeError(
                            "The source did not return a list of results."
                        )
                    from itertools import islice

                    entries = list(
                        islice(
                            listing_entries(
                                entries,
                                shorts="/shorts" in urlsplit(url).path,
                                content_types=filters.get("content_types"),
                            ),
                            req["limit"],
                        )
                    )
                    total += len(entries)
                    self.db.update_job(
                        id,
                        total_count=total,
                        discovery_complete=source_index == len(sources) - 1,
                    )
                    playlist = None
                    if st == "playlist":
                        playlist = {
                            "id": parse_qs(urlsplit(source).query)["list"][0],
                            "title": listing.get("title"),
                            "url": source,
                        }
                    for entry, short_evidence in entries:
                        self._check(cancel, deadline)
                        if not isinstance(entry, dict):
                            failed(
                                source,
                                ValueError("A source item is unavailable."),
                                candidate=True,
                            )
                            continue
                        entry_url = entry.get("url") or entry.get("webpage_url") or ""
                        resource_kind = None
                        if "youtube.com/playlist?" in entry_url:
                            resource_kind = "playlist"
                        elif any(
                            x in entry_url
                            for x in (
                                "youtube.com/channel/",
                                "youtube.com/@",
                                "youtube.com/c/",
                                "youtube.com/user/",
                            )
                        ):
                            resource_kind = "channel"
                        if resource_kind:
                            source_url(resource_kind, entry_url)
                            thumb = entry.get("thumbnail") or next(
                                (
                                    t.get("url")
                                    for t in reversed(entry.get("thumbnails") or [])
                                    if t.get("url")
                                ),
                                None,
                            )
                            with self._publication(id, cancel, deadline):
                                self.db.resource(
                                    id,
                                    {
                                        "id": str(entry["id"]),
                                        "title": str(entry.get("title") or entry["id"]),
                                        "url": entry_url,
                                        "kind": resource_kind,
                                        "thumbnail_url": thumb,
                                    },
                                )
                                self.db.increment(id, scanned_count=1, matched_count=1)
                            continue
                        try:
                            ingest(entry, source, playlist, shorts=short_evidence)
                        except (ExtractionCancelled, JobDeadlineExceeded):
                            raise
                        except Exception as exc:
                            err_source = (
                                f"https://www.youtube.com/watch?v={entry['id']}"
                                if VIDEO_ID.fullmatch(str(entry.get("id") or ""))
                                else source
                            )
                            candidate_shorts = short_evidence or any(
                                "youtube.com/shorts/" in str(entry.get(k) or "")
                                for k in ("url", "webpage_url")
                            )
                            failed(
                                err_source,
                                exc,
                                retry_item={
                                    "source_type": "video",
                                    "source": err_source,
                                    "origin_source": source,
                                    "playlist": playlist,
                                    "shorts": candidate_shorts,
                                }
                                if VIDEO_ID.fullmatch(str(entry.get("id") or ""))
                                else item,
                                candidate=True,
                            )
                except (ExtractionCancelled, JobDeadlineExceeded):
                    raise
                except Exception as exc:
                    failed(source, exc, retry_item=item, candidate=st == "video")
        self._check(cancel, deadline)
        with self.db.lock:
            j = self.db.job(id)
            if j["status"] == "cancelled":
                return
            status = (
                "partial"
                if j["failed_count"] and j["matched_count"]
                else "failed"
                if j["failed_count"]
                else "completed"
            )
            self.db.update_job(
                id,
                status=status,
                phase=status,
                finished_at=now(),
                discovery_complete=True,
                total_count=total if kind == "crawl" else len(ids),
            )
