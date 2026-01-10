import argparse
import json
import os
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import certifi


YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"


def load_dotenv(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


def _get_json(url: str) -> dict:
    request = Request(url)
    context = ssl.create_default_context(cafile=certifi.where())
    try:
        with urlopen(request, timeout=15, context=context) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload)
    except HTTPError as exc:
        error_body = ""
        try:
            error_body = exc.read().decode("utf-8")
            parsed = json.loads(error_body)
            message = parsed.get("error", {}).get("message")
            if message:
                raise RuntimeError(
                    f"youtube api http error: {exc.code} ({message})"
                ) from exc
        except (ValueError, OSError):
            pass
        raise RuntimeError(f"youtube api http error: {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"youtube api connection error: {exc.reason}") from exc


def get_live_chat_id(api_key: str, video_id: str) -> str:
    query = urlencode(
        {
            "part": "liveStreamingDetails",
            "id": video_id,
            "key": api_key,
        }
    )
    url = f"{YOUTUBE_API_BASE}/videos?{query}"
    data = _get_json(url)
    items = data.get("items", [])
    if not items:
        raise RuntimeError("no video found for provided video id")
    details = items[0].get("liveStreamingDetails", {})
    live_chat_id = details.get("activeLiveChatId")
    if not live_chat_id:
        raise RuntimeError("no active live chat id found (stream may be offline)")
    return live_chat_id


def get_video_metadata(api_key: str, video_id: str) -> dict:
    query = urlencode(
        {
            "part": "snippet,contentDetails,liveStreamingDetails",
            "id": video_id,
            "key": api_key,
            "fields": "items(snippet(title,description,channelTitle),contentDetails(duration),liveStreamingDetails(actualStartTime,scheduledStartTime))",
        }
    )
    url = f"{YOUTUBE_API_BASE}/videos?{query}"
    data = _get_json(url)
    items = data.get("items", [])
    if not items:
        raise RuntimeError("no video found for provided video id")
    item = items[0]
    snippet = item.get("snippet", {})
    content = item.get("contentDetails", {})
    live = item.get("liveStreamingDetails", {})
    return {
        "title": snippet.get("title") or "",
        "description": snippet.get("description") or "",
        "channel": snippet.get("channelTitle") or "",
        "duration": content.get("duration") or "",
        "actual_start_time": live.get("actualStartTime") or "",
        "scheduled_start_time": live.get("scheduledStartTime") or "",
    }


def iter_live_chat_messages(api_key: str, live_chat_id: str, poll_seconds: int = 2):
    page_token = None
    backoff_seconds = 2
    while True:
        query = {
            "part": "snippet,authorDetails",
            "liveChatId": live_chat_id,
            "key": api_key,
            "maxResults": 200,
            "fields": "nextPageToken,pollingIntervalMillis,items(snippet(publishedAt,displayMessage),authorDetails(displayName))",
        }
        if page_token:
            query["pageToken"] = page_token
        url = f"{YOUTUBE_API_BASE}/liveChat/messages?{urlencode(query)}"
        try:
            data = _get_json(url)
            backoff_seconds = 2
        except RuntimeError as exc:
            message = str(exc)
            if "http error: 403" in message or "http error: 429" in message:
                time.sleep(max(poll_seconds, 5))
                continue
            if message.startswith("youtube api connection error"):
                time.sleep(backoff_seconds)
                backoff_seconds = min(backoff_seconds * 2, 60)
                continue
            raise
        page_token = data.get("nextPageToken")
        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            author = item.get("authorDetails", {})
            yield {
                "published_at": snippet.get("publishedAt"),
                "display_name": author.get("displayName"),
                "message": snippet.get("displayMessage"),
            }
        interval_ms = data.get("pollingIntervalMillis")
        if isinstance(interval_ms, int) and interval_ms > 0:
            time.sleep(max(interval_ms / 1000, poll_seconds))
        else:
            time.sleep(poll_seconds)


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(
        description="Stream YouTube live chat messages for a livestream."
    )
    parser.add_argument("--video-id", required=True, help="YouTube livestream video ID")
    parser.add_argument(
        "--api-key",
        default="",
        help="YouTube Data API v3 key (or set YOUTUBE_API_KEY)",
    )
    parser.add_argument(
        "--poll-seconds",
        type=int,
        default=2,
        help="Seconds to wait between chat polls",
    )
    args = parser.parse_args()

    api_key = args.api_key or os.getenv("YOUTUBE_API_KEY", "")
    if not api_key:
        raise SystemExit("missing api key: pass --api-key or set YOUTUBE_API_KEY")

    live_chat_id = get_live_chat_id(api_key, args.video_id)
    for msg in iter_live_chat_messages(
        api_key, live_chat_id, poll_seconds=args.poll_seconds
    ):
        display_name = msg.get("display_name") or "unknown"
        message = msg.get("message") or ""
        published_at = msg.get("published_at") or ""
        try:
            print(f"[{published_at}] {display_name}: {message}", flush=True)
        except BrokenPipeError:
            return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
