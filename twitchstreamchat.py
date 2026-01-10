import argparse
import json
import os
import socket
import ssl
import time
from datetime import datetime, timezone
from typing import Dict, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TWITCH_HELIX_BASE = "https://api.twitch.tv/helix"


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


def _helix_get_json(
    endpoint: str, client_id: str, access_token: str, params: Optional[Dict[str, str]]
) -> dict:
    query = urlencode(params or {})
    url = f"{TWITCH_HELIX_BASE}/{endpoint}"
    if query:
        url = f"{url}?{query}"
    request = Request(url)
    request.add_header("Client-Id", client_id)
    request.add_header("Authorization", f"Bearer {access_token}")
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def get_channel_id(client_id: str, access_token: str, channel_name: str) -> str:
    data = _helix_get_json(
        "users", client_id, access_token, {"login": channel_name}
    )
    users = data.get("data", [])
    if not users:
        raise RuntimeError("no twitch user found for provided channel name")
    return users[0].get("id", "")


def get_live_chat_id(client_id: str, access_token: str, channel_name: str) -> str:
    return get_channel_id(client_id, access_token, channel_name)


def get_video_metadata(client_id: str, access_token: str, channel_name: str) -> dict:
    user_data = _helix_get_json(
        "users", client_id, access_token, {"login": channel_name}
    )
    user = (user_data.get("data") or [{}])[0]
    stream_data = _helix_get_json(
        "streams", client_id, access_token, {"user_login": channel_name}
    )
    stream = (stream_data.get("data") or [{}])[0]
    return {
        "title": stream.get("title") or "",
        "description": user.get("description") or "",
        "channel": user.get("display_name") or user.get("login") or channel_name,
        "duration": "",
        "actual_start_time": stream.get("started_at") or "",
        "scheduled_start_time": "",
    }


def _parse_tags(tag_blob: str) -> Dict[str, str]:
    tags = {}
    for pair in tag_blob.split(";"):
        if "=" in pair:
            key, value = pair.split("=", 1)
            tags[key] = value
    return tags


def _format_timestamp(ms_value: str) -> str:
    try:
        ms = int(ms_value)
    except (TypeError, ValueError):
        return ""
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return dt.isoformat()


def iter_live_chat_messages(
    channel_name: str,
    oauth_token: str,
    nickname: str,
) -> dict:
    server = ("irc.chat.twitch.tv", 6697)
    backoff_seconds = 2
    while True:
        try:
            raw_socket = socket.create_connection(server, timeout=15)
            wrapped = ssl.create_default_context().wrap_socket(
                raw_socket, server_hostname=server[0]
            )
            sock_file = wrapped.makefile("r", encoding="utf-8", newline="\r\n")

            wrapped.sendall(f"PASS oauth:{oauth_token}\r\n".encode("utf-8"))
            wrapped.sendall(f"NICK {nickname}\r\n".encode("utf-8"))
            wrapped.sendall("CAP REQ :twitch.tv/tags\r\n".encode("utf-8"))
            wrapped.sendall(f"JOIN #{channel_name}\r\n".encode("utf-8"))

            backoff_seconds = 2

            for line in sock_file:
                stripped = line.strip()
                if stripped.startswith("PING"):
                    wrapped.sendall("PONG :tmi.twitch.tv\r\n".encode("utf-8"))
                    continue
                tag_blob = ""
                payload = stripped
                if stripped.startswith("@"):
                    tag_blob, payload = stripped.split(" ", 1)
                    tag_blob = tag_blob.lstrip("@")
                if "PRIVMSG" not in payload:
                    continue
                prefix, message = payload.split(" :", 1)
                display_name = ""
                tags = _parse_tags(tag_blob) if tag_blob else {}
                display_name = tags.get("display-name") or ""
                timestamp = _format_timestamp(tags.get("tmi-sent-ts", ""))
                if not display_name:
                    try:
                        display_name = prefix.split("!", 1)[0].lstrip(":")
                    except (AttributeError, IndexError):
                        display_name = "viewer"
                yield {
                    "published_at": timestamp,
                    "display_name": display_name,
                    "message": message,
                }
        except (OSError, ssl.SSLError):
            time.sleep(backoff_seconds)
            backoff_seconds = min(backoff_seconds * 2, 60)


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(
        description="Stream Twitch live chat messages for a channel."
    )
    parser.add_argument("--channel", required=True, help="Twitch channel name")
    parser.add_argument(
        "--oauth-token",
        default="",
        help="OAuth token (or set TWITCH_OAUTH_TOKEN)",
    )
    parser.add_argument(
        "--nickname",
        default="",
        help="Chat nickname (or set TWITCH_CHAT_NICK)",
    )
    parser.add_argument(
        "--client-id",
        default="",
        help="Twitch client ID for metadata lookups",
    )
    parser.add_argument(
        "--access-token",
        default="",
        help="Twitch access token for metadata lookups",
    )
    args = parser.parse_args()

    oauth_token = args.oauth_token or os.getenv("TWITCH_OAUTH_TOKEN", "")
    nickname = args.nickname or os.getenv("TWITCH_CHAT_NICK", "")
    client_id = args.client_id or os.getenv("TWITCH_CLIENT_ID", "")
    access_token = args.access_token or os.getenv("TWITCH_ACCESS_TOKEN", "")

    if not oauth_token:
        raise SystemExit(
            "missing oauth token: pass --oauth-token or set TWITCH_OAUTH_TOKEN"
        )
    if not nickname:
        raise SystemExit(
            "missing nickname: pass --nickname or set TWITCH_CHAT_NICK"
        )

    if client_id and access_token:
        metadata = get_video_metadata(client_id, access_token, args.channel)
        title = metadata.get("title") or "Unknown title"
        channel = metadata.get("channel") or args.channel
        print(f"Connected to {channel}: {title}", flush=True)

    for msg in iter_live_chat_messages(args.channel, oauth_token, nickname):
        display_name = msg.get("display_name") or "viewer"
        message = msg.get("message") or ""
        published_at = msg.get("published_at") or ""
        try:
            print(f"[{published_at}] {display_name}: {message}", flush=True)
        except BrokenPipeError:
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
