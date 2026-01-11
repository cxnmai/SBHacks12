import json
import os
import threading
import time
from typing import Dict, Optional, Tuple
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from flask import Flask, jsonify, render_template, request

from chatsynthesizer import (
    compute_rate,
    compute_window_seconds,
    parse_timestamp,
    select_window_messages,
    summarize_with_keywords,
)
from chatvelocitychart import ChatVelocityChart
from gemini import generate_text, load_dotenv
from twitchstreamchat import get_video_metadata as get_twitch_metadata
from twitchstreamchat import iter_live_chat_messages as iter_twitch_chat
from ytstreamchat import get_live_chat_id, get_video_metadata, iter_live_chat_messages

load_dotenv()

app = Flask(__name__)

WorkerKey = Tuple[str, str]


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


def extract_twitch_channel(value: str) -> Optional[str]:
    if not value:
        return None
    trimmed = value.strip()
    if trimmed and all(c.isalnum() or c == "_" for c in trimmed):
        return trimmed
    try:
        parsed = urlparse(trimmed)
    except ValueError:
        return None
    if "twitch.tv" not in parsed.netloc:
        return None
    path = parsed.path.strip("/").split("/")
    if not path:
        return None
    channel = path[0]
    if channel and all(c.isalnum() or c == "_" for c in channel):
        return channel
    return None


class ChatSummaryWorker:
    def __init__(
        self,
        source: str,
        stream_id: str,
        mode: str,
        keywords: Tuple[str, ...],
        keyword_threshold: int,
    ) -> None:
        self.source = source
        self.stream_id = stream_id
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
        self.max_history = 20000
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        self.velocity_chart = ChatVelocityChart()

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
                "rates": self.velocity_chart.get_rates(),
                "ratePoints": self.velocity_chart.get_points(),
                "streamStartTs": self.stream_start_ts or None,
            }

    def _set_error(self, message: str) -> None:
        with self._lock:
            self.last_error = message

    def update_settings(
        self, mode: str, keywords: Tuple[str, ...], keyword_threshold: int
    ) -> None:
        with self._lock:
            self.mode = mode
            self.keywords = keywords
            self.keyword_threshold = max(1, keyword_threshold)

    def _get_settings(self) -> Tuple[str, Tuple[str, ...], int]:
        with self._lock:
            return self.mode, self.keywords, self.keyword_threshold

    def _run(self) -> None:
        if self.source == "youtube":
            api_key = os.getenv("YOUTUBE_API_KEY", "")
            if not api_key:
                self._set_error("Missing YOUTUBE_API_KEY.")
                return
            try:
                live_chat_id = get_live_chat_id(api_key, self.stream_id)
                metadata = get_video_metadata(api_key, self.stream_id)
            except Exception as exc:  # noqa: BLE001
                self._set_error(str(exc))
                return
            self._set_context(metadata)
            message_iter = iter_live_chat_messages(api_key, live_chat_id)
        else:
            oauth_token = os.getenv("TWITCH_OAUTH_TOKEN", "")
            nickname = os.getenv("TWITCH_CHAT_NICK", "")
            if not oauth_token or not nickname:
                self._set_error("Missing TWITCH_OAUTH_TOKEN or TWITCH_CHAT_NICK.")
                return
            metadata = {}
            client_id = os.getenv("TWITCH_CLIENT_ID", "")
            access_token = os.getenv("TWITCH_ACCESS_TOKEN", "")
            if not access_token:
                access_token = os.getenv("TWITCH_OAUTH_TOKEN", "")
            if client_id and access_token:
                try:
                    metadata = get_twitch_metadata(
                        client_id, access_token, self.stream_id
                    )
                except Exception as exc:  # noqa: BLE001
                    self._set_error(str(exc))
                    return
            if metadata:
                self._set_context(metadata)
            else:
                self.video_title = ""
                self.video_channel = self.stream_id
                self.context = f"Channel: {self.stream_id}"
            message_iter = iter_twitch_chat(self.stream_id, oauth_token, nickname)

        messages = []
        last_summary_time = 0.0
        last_summary_count = 0
        max_buffer_seconds = 600
        min_window_seconds = 20
        max_window_seconds = 120
        rate_sample_size = 30

        try:
            for msg in message_iter:
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

                sample_time = time.time()
                self.velocity_chart.add_rate(rate, sample_time)
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

                mode, keywords, keyword_threshold = self._get_settings()
                summary, matched_keywords = summarize_with_keywords(
                    window_messages,
                    mode,
                    list(keywords),
                    context=self.context,
                )
                if not summary:
                    continue

                condensed = self._condense_summary(summary)
                if not condensed:
                    condensed = summary

                if matched_keywords and mode == "streamer":
                    first_ts = window_messages[0][0]
                    hit_ts = max(first_ts - 15, 0)
                    min_gap = 30
                    min_matches = keyword_threshold
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
                    self.summary_history.append(
                        {"summary": condensed, "timestamp": self._format_runtime(now)}
                    )
                    if len(self.summary_history) > self.max_history:
                        self.summary_history = self.summary_history[-self.max_history :]

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

    def _condense_summary(self, summary: str) -> str:
        prompt = (
            "Condense the following summary into at most two compact sentences. "
            "Do not use bullet points. Keep it concise and readable.\n\n"
            f"Summary:\n{summary}\n"
        )
        condensed = generate_text(prompt)
        if not condensed:
            return ""
        return condensed.strip().replace("\n", " ")


workers: Dict[WorkerKey, ChatSummaryWorker] = {}
workers_lock = threading.Lock()


def get_worker(
    source: str,
    stream_id: str,
    mode: str,
    keywords: Tuple[str, ...],
    keyword_threshold: int,
) -> ChatSummaryWorker:
    key = (source, stream_id)
    with workers_lock:
        worker = workers.get(key)
        if worker is None:
            worker = ChatSummaryWorker(
                source, stream_id, mode, keywords, keyword_threshold
            )
            workers[key] = worker
        else:
            worker.update_settings(mode, keywords, keyword_threshold)
        return worker


@app.route("/")
def index() -> str:
    return render_template("index.html")


@app.route("/api/summary")
def summary() -> Tuple[str, int]:
    source = request.args.get("source", "youtube")
    video_id = request.args.get("videoId") or request.args.get("url")
    mode = request.args.get("mode", "general")
    keywords_raw = request.args.get("keywords", "")
    threshold_raw = request.args.get("keywordThreshold", "2")
    if mode not in ("general", "streamer"):
        mode = "general"
    if source == "youtube":
        resolved_id = extract_video_id(video_id or "")
        if not resolved_id:
            return jsonify({"error": "Invalid YouTube link or video ID."}), 400
    elif source == "twitch":
        resolved_id = extract_twitch_channel(video_id or "")
        if not resolved_id:
            return jsonify({"error": "Invalid Twitch channel or link."}), 400
    else:
        return jsonify({"error": "Invalid source. Use youtube or twitch."}), 400
    keywords = []
    if mode == "streamer" and keywords_raw:
        keywords = [item.strip() for item in keywords_raw.split(",") if item.strip()]
    try:
        keyword_threshold = max(1, int(threshold_raw))
    except ValueError:
        keyword_threshold = 2
    worker = get_worker(source, resolved_id, mode, tuple(keywords), keyword_threshold)
    snapshot = worker.snapshot()
    return jsonify(snapshot), 200


@app.route("/oauth/twitch/callback")
def twitch_oauth_callback() -> Tuple[str, int]:
    code = request.args.get("code", "")
    if not code:
        return jsonify({"error": "Missing code parameter."}), 400

    client_id = os.getenv("TWITCH_CLIENT_ID", "")
    client_secret = os.getenv("TWITCH_CLIENT_SECRET", "")
    redirect_uri = os.getenv(
        "TWITCH_REDIRECT_URI",
        "https://cannon-unconcealing-sharice.ngrok-free.dev/oauth/twitch/callback",
    )
    if not client_id or not client_secret:
        return jsonify(
            {"error": "Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET."}
        ), 400

    payload = (
        f"client_id={client_id}&client_secret={client_secret}&code={code}"
        f"&grant_type=authorization_code&redirect_uri={redirect_uri}"
    ).encode("utf-8")
    req = Request(
        "https://id.twitch.tv/oauth2/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urlopen(req, timeout=15) as response:
            body = response.read().decode("utf-8")
            token_payload = json.loads(body)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Token exchange failed: {exc}"}), 500

    return jsonify(
        {
            "access_token": token_payload.get("access_token"),
            "refresh_token": token_payload.get("refresh_token"),
            "scope": token_payload.get("scope"),
            "expires_in": token_payload.get("expires_in"),
        }
    ), 200


if __name__ == "__main__":
    import os

    app.run(host="0.0.0.0", port=6767, debug=True)
