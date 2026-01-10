import os
import threading
import time
from typing import Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse

from flask import Flask, jsonify, render_template, request

from chatsynthesizer import (
    compute_rate,
    compute_window_seconds,
    parse_timestamp,
    select_window_messages,
    summarize_with_keywords,
)
from gemini import load_dotenv
from streamchat import get_live_chat_id, get_video_metadata, iter_live_chat_messages

load_dotenv()

app = Flask(__name__)

WorkerKey = Tuple[str, str, Tuple[str, ...], int]


def extract_video_id(value: str) -> Optional[str]:
    if not value:
        return None
    trimmed = value.strip()
    if len(trimmed) == 11 and all(c.isalnum() or c in "-_" for c in trimmed):
        return trimmed
    try:
        parsed = urlparse(trimmed)
    except ValueError:
        return None
    if "youtu.be" in parsed.netloc:
        return parsed.path.strip("/").split("/")[0] or None
    if "youtube.com" in parsed.netloc:
        query = parse_qs(parsed.query)
        if "v" in query:
            return query["v"][0]
        parts = [part for part in parsed.path.split("/") if part]
        if "live" in parts:
            idx = parts.index("live")
            if idx + 1 < len(parts):
                return parts[idx + 1]
    return None


class ChatSummaryWorker:
    def __init__(
        self,
        video_id: str,
        mode: str,
        keywords: Tuple[str, ...],
        keyword_threshold: int,
    ) -> None:
        self.video_id = video_id
        self.mode = mode
        self.keywords = keywords
        self.keyword_threshold = max(1, keyword_threshold)
        self.latest_summary: str = ""
        self.last_updated: float = 0.0
        self.last_error: str = ""
        self.context: str = ""
        self.video_title: str = ""
        self.video_channel: str = ""
        self.stream_start_ts: float = 0.0
        self.keyword_hits = []
        self.last_keyword_hit = {}
        self.pending_keyword_hits = {}
        self.summary_history = []
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def snapshot(self) -> Dict[str, object]:
        with self._lock:
            return {
                "summary": self.latest_summary,
                "updatedAt": self.last_updated or None,
                "error": self.last_error or None,
                "events": list(self.keyword_hits),
                "videoTitle": self.video_title,
                "videoChannel": self.video_channel,
                "summaryHistory": list(self.summary_history),
            }

    def _set_error(self, message: str) -> None:
        with self._lock:
            self.last_error = message

    def _run(self) -> None:
        api_key = os.getenv("YOUTUBE_API_KEY", "")
        if not api_key:
            self._set_error("Missing YOUTUBE_API_KEY.")
            return
        try:
            live_chat_id = get_live_chat_id(api_key, self.video_id)
            metadata = get_video_metadata(api_key, self.video_id)
        except Exception as exc:  # noqa: BLE001
            self._set_error(str(exc))
            return

        self._set_context(metadata)

        messages = []
        last_summary_time = 0.0
        last_summary_count = 0
        max_buffer_seconds = 600
        min_window_seconds = 20
        max_window_seconds = 120
        rate_sample_size = 30

        try:
            for msg in iter_live_chat_messages(api_key, live_chat_id):
                published_at = msg.get("published_at") or ""
                timestamp = parse_timestamp(published_at) or time.time()
                display_name = msg.get("display_name") or "viewer"
                message = msg.get("message") or ""
                if not message.strip():
                    continue
                text = f"{display_name}: {message}".strip()
                messages.append((timestamp, text))

                cutoff = timestamp - max_buffer_seconds
                while messages and messages[0][0] < cutoff:
                    messages.pop(0)

                rate = compute_rate(messages, rate_sample_size)
                window_seconds = compute_window_seconds(
                    rate, min_window_seconds, max_window_seconds
                )
                update_interval = max(4.0, min(20.0, 20.0 / max(rate, 0.05)))

                now = time.time()
                if now - last_summary_time < update_interval:
                    continue
                if len(messages) == last_summary_count:
                    continue

                window_messages = select_window_messages(messages, window_seconds)
                if not window_messages:
                    continue

                summary, matched_keywords = summarize_with_keywords(
                    window_messages,
                    self.mode,
                    list(self.keywords),
                    context=self.context,
                )
                if not summary:
                    continue

                if matched_keywords and self.mode == "streamer":
                    first_ts = window_messages[0][0]
                    hit_ts = max(first_ts - 15, 0)
                    min_gap = 30
                    min_matches = self.keyword_threshold
                    decay_window = 90
                    with self._lock:
                        stale = []
                        for keyword, meta in self.pending_keyword_hits.items():
                            if now - meta["last_seen"] > decay_window:
                                stale.append(keyword)
                        for keyword in stale:
                            self.pending_keyword_hits.pop(keyword, None)

                        for keyword in matched_keywords:
                            meta = self.pending_keyword_hits.get(keyword)
                            if meta:
                                meta["count"] += 1
                                meta["last_seen"] = now
                            else:
                                self.pending_keyword_hits[keyword] = {
                                    "count": 1,
                                    "first_ts": hit_ts,
                                    "last_seen": now,
                                }
                            meta = self.pending_keyword_hits[keyword]
                            last_hit = self.last_keyword_hit.get(keyword, 0)
                            if meta["count"] < min_matches:
                                continue
                            if meta["first_ts"] - last_hit < min_gap:
                                continue
                            self.last_keyword_hit[keyword] = meta["first_ts"]
                            self.keyword_hits.append(
                                {
                                    "keyword": keyword,
                                    "timestamp": self._format_runtime(meta["first_ts"]),
                                }
                            )
                            self.pending_keyword_hits.pop(keyword, None)
                        if len(self.keyword_hits) > 100:
                            self.keyword_hits = self.keyword_hits[-100:]

                with self._lock:
                    self.latest_summary = summary
                    self.last_updated = now
                    self.last_error = ""
                    self.summary_history.append({"summary": summary, "timestamp": now})
                    if len(self.summary_history) > 10:
                        self.summary_history = self.summary_history[-10:]

                last_summary_time = now
                last_summary_count = len(messages)
        except Exception as exc:  # noqa: BLE001
            self._set_error(str(exc))

    def _set_context(self, metadata: dict) -> None:
        title = metadata.get("title", "")
        channel = metadata.get("channel", "")
        description = metadata.get("description", "")
        duration = metadata.get("duration", "")
        actual_start = metadata.get("actual_start_time", "")
        scheduled_start = metadata.get("scheduled_start_time", "")
        self.stream_start_ts = parse_timestamp(actual_start or scheduled_start) or 0.0
        self.video_title = title
        self.video_channel = channel
        parts = []
        if title:
            parts.append(f"Title: {title}")
        if channel:
            parts.append(f"Channel: {channel}")
        if duration:
            parts.append(f"Duration: {duration}")
        if description:
            parts.append(f"Description: {description}")
        self.context = "\n".join(parts)

    def _format_runtime(self, timestamp: float) -> str:
        if not self.stream_start_ts:
            return time.strftime("%H:%M:%S", time.gmtime(max(timestamp, 0)))
        offset = max(int(timestamp - self.stream_start_ts), 0)
        hours = offset // 3600
        minutes = (offset % 3600) // 60
        seconds = offset % 60
        if hours:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        return f"{minutes:02d}:{seconds:02d}"


workers: Dict[WorkerKey, ChatSummaryWorker] = {}
workers_lock = threading.Lock()


def get_worker(
    video_id: str, mode: str, keywords: Tuple[str, ...], keyword_threshold: int
) -> ChatSummaryWorker:
    key = (video_id, mode, keywords, keyword_threshold)
    with workers_lock:
        worker = workers.get(key)
        if worker is None:
            worker = ChatSummaryWorker(video_id, mode, keywords, keyword_threshold)
            workers[key] = worker
        return worker


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/summary")
def summary() -> Tuple[str, int]:
    video_id = request.args.get("videoId") or request.args.get("url")
    mode = request.args.get("mode", "general")
    keywords_raw = request.args.get("keywords", "")
    threshold_raw = request.args.get("keywordThreshold", "2")
    if mode not in ("general", "streamer"):
        mode = "general"
    resolved_id = extract_video_id(video_id or "")
    if not resolved_id:
        return jsonify({"error": "Invalid YouTube link or video ID."}), 400
    keywords = []
    if mode == "streamer" and keywords_raw:
        keywords = [item.strip() for item in keywords_raw.split(",") if item.strip()]
    try:
        keyword_threshold = max(1, int(threshold_raw))
    except ValueError:
        keyword_threshold = 2
    worker = get_worker(resolved_id, mode, tuple(keywords), keyword_threshold)
    snapshot = worker.snapshot()
    return jsonify(snapshot), 200


if __name__ == "__main__":
    import os

    app.run(host="0.0.0.0", port=6767, debug=True)
