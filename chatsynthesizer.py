import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from shutil import get_terminal_size
from textwrap import wrap
from typing import List, Optional, Tuple

from gemini import generate_text


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


def parse_timestamp(raw: str) -> Optional[float]:
    cleaned = raw.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def parse_chat_line(line: str) -> Tuple[float, str]:
    stripped = line.strip()
    if stripped.startswith("[") and "]" in stripped:
        close_idx = stripped.find("]")
        timestamp_raw = stripped[1:close_idx]
        timestamp = parse_timestamp(timestamp_raw)
        if timestamp is None:
            timestamp = time.time()
        text = stripped[close_idx + 1 :].strip()
        return timestamp, text
    return time.time(), stripped


def compute_rate(messages: List[Tuple[float, str]], sample_size: int) -> float:
    if len(messages) < 2:
        return 0.05
    sample = messages[-sample_size:]
    start_ts = sample[0][0]
    end_ts = sample[-1][0]
    span = max(end_ts - start_ts, 1.0)
    return len(sample) / span


def compute_window_seconds(rate: float, min_window: int, max_window: int) -> int:
    window = min_window + int(rate * 60)
    return max(min_window, min(window, max_window))


def select_window_messages(
    messages: List[Tuple[float, str]], window_seconds: int
) -> List[Tuple[float, str]]:
    if not messages:
        return []
    end_ts = messages[-1][0]
    cutoff = end_ts - window_seconds
    return [item for item in messages if item[0] >= cutoff]


def format_summary_box(summary: str, header: str) -> str:
    terminal_width = get_terminal_size((100, 20)).columns
    max_inner_width = max(30, terminal_width - 4)

    raw_lines = [header]
    safe_summary = summary or ""
    for line in safe_summary.strip().splitlines():
        cleaned = line.rstrip()
        if cleaned:
            raw_lines.append(cleaned)

    wrapped_lines: List[str] = []
    for line in raw_lines:
        wrapped = wrap(line, width=max_inner_width) or [""]
        wrapped_lines.extend(wrapped)

    width = max(len(line) for line in wrapped_lines) if wrapped_lines else len(header)
    border = "+" + "-" * (width + 2) + "+"
    output_lines = [border]
    for line in wrapped_lines:
        padding = " " * (width - len(line))
        output_lines.append(f"| {line}{padding} |")
    output_lines.append(border)
    return "\n".join(output_lines)


def build_prompt(
    messages: List[Tuple[float, str]], mode: str, context: Optional[str] = None
) -> str:
    formatted = "\n".join(text for _, text in messages)
    context_block = f"Stream context:\n{context}\n\n" if context else ""
    if mode == "streamer":
        prompt = (
            "You are summarizing a live YouTube chat for the streamer. Provide a "
            "short bulleted summary focused on viewer demands, requests, questions, "
            "or actionables directed at the streamer. Write the summary in English "
            "even if messages are in other languages. Use 3-5 bullets, be concise, "
            "and avoid repeating user names. Each bullet should start by referencing "
            "who is saying what, such as 'Viewers are asking for...', "
            "'One viewer requested...', or 'The chat wants...'. Avoid meta "
            "commentary about chat activity or lack of topics. Exclude any "
            "self-promotion, spam, or harassment from the summary. Only return "
            "bullets.\n\n"
        )
    else:
        prompt = (
            "You are summarizing a live YouTube chat. Provide a short bulleted "
            "summary of what viewers are chatting about. Write the summary in "
            "English even if messages are in other languages. Use 3-5 bullets, be "
            "concise, and avoid repeating user names. Each bullet should start by "
            "referencing who is saying what, such as 'Viewers are saying...', "
            "'One viewer asked...', or 'The chat is asking for...'. Avoid meta "
            "commentary about chat activity or lack of topics. Exclude any "
            "self-promotion, spam, or harassment from the summary. Only return "
            "bullets.\n\n"
        )
    return f"{prompt}{context_block}Chat messages:\n{formatted}\n"


def build_keyword_prompt(
    messages: List[Tuple[float, str]], keywords: List[str], context: Optional[str] = None
) -> str:
    formatted = "\n".join(text for _, text in messages)
    keyword_list = ", ".join(keywords)
    context_block = f"Stream context:\n{context}\n\n" if context else ""
    return (
        "You are summarizing a live YouTube chat for the streamer. "
        "Return a JSON object with two keys: "
        '"summary" (string with 3-5 bullet lines) and '
        '"matched_keywords" (array of zero or more keywords taken only from the '
        f"provided list). Write the summary in English even if messages are in other "
        "languages. Each bullet should start by referencing who is saying what, "
        "such as 'Viewers are asking for...', 'One viewer requested...', or "
        "'The chat wants...'. Avoid meta commentary about chat activity or lack of "
        "topics. Exclude any self-promotion, spam, or harassment from the summary. "
        "Only return JSON, with double quotes and no extra text.\n\n"
        f"Keyword list: {keyword_list}\n\n"
        f"{context_block}"
        "Chat messages:\n"
        f"{formatted}\n"
    )


def summarize_with_keywords(
    messages: List[Tuple[float, str]],
    mode: str,
    keywords: Optional[List[str]] = None,
    context: Optional[str] = None,
) -> Tuple[str, List[str]]:
    clean_keywords = [kw.strip() for kw in (keywords or []) if kw.strip()]
    if mode != "streamer" or not clean_keywords:
        summary = generate_text(build_prompt(messages, mode, context))
        return summary or "", []

    prompt = build_keyword_prompt(messages, clean_keywords, context)
    response = generate_text(prompt)
    if not response:
        return "", []
    raw_json = response
    start = raw_json.find("{")
    end = raw_json.rfind("}")
    if start != -1 and end != -1 and end > start:
        raw_json = raw_json[start : end + 1]
    try:
        payload = json.loads(raw_json)
    except json.JSONDecodeError:
        summary = generate_text(build_prompt(messages, mode, context))
        return summary or "", []

    summary = payload.get("summary")
    if isinstance(summary, list):
        summary = "\n".join(f"- {item}" for item in summary if str(item).strip())
    if not isinstance(summary, str):
        summary = ""
    matched = payload.get("matched_keywords") or []
    if not isinstance(matched, list):
        if isinstance(matched, str):
            matched = [item.strip() for item in matched.split(",") if item.strip()]
        else:
            matched = []

    keyword_set = {kw.lower(): kw for kw in clean_keywords}
    normalized = []
    for item in matched:
        if not isinstance(item, str):
            continue
        key = item.strip().lower()
        if key in keyword_set:
            normalized.append(keyword_set[key])
    if not summary:
        summary = generate_text(build_prompt(messages, mode, context)) or ""
    return summary, normalized


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Continuously summarize livestream chat from stdin."
    )
    parser.add_argument(
        "--min-window-seconds",
        type=int,
        default=20,
        help="Minimum time window for message synthesis",
    )
    parser.add_argument(
        "--max-window-seconds",
        type=int,
        default=120,
        help="Maximum time window for message synthesis",
    )
    parser.add_argument(
        "--rate-sample-size",
        type=int,
        default=30,
        help="Number of recent messages used to estimate chat velocity",
    )
    parser.add_argument(
        "--max-buffer-seconds",
        type=int,
        default=600,
        help="Maximum age of messages kept in memory",
    )
    parser.add_argument(
        "--mode",
        choices=("general", "streamer"),
        default="general",
        help="Summary mode: general or streamer-focused demand summary",
    )
    parser.add_argument(
        "--keywords",
        default="",
        help="Comma-separated keywords for streamer mode tagging",
    )
    args = parser.parse_args()

    load_dotenv()

    messages: List[Tuple[float, str]] = []
    last_summary_time = 0.0
    last_summary_count = 0

    for line in sys.stdin:
        timestamp, text = parse_chat_line(line)
        if not text:
            continue
        messages.append((timestamp, text))

        cutoff = timestamp - args.max_buffer_seconds
        while messages and messages[0][0] < cutoff:
            messages.pop(0)

        rate = compute_rate(messages, args.rate_sample_size)
        window_seconds = compute_window_seconds(
            rate, args.min_window_seconds, args.max_window_seconds
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

        keywords = [kw.strip() for kw in args.keywords.split(",") if kw.strip()]
        summary, _ = summarize_with_keywords(window_messages, args.mode, keywords)
        if not summary:
            continue

        header = (
            f"Chat summary: last {window_seconds}s, "
            f"{len(window_messages)} msgs, {rate:.2f} msg/s"
        )
        box = format_summary_box(summary, header)
        print(box, flush=True)

        last_summary_time = now
        last_summary_count = len(messages)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
