import os
import sys
from typing import Optional

from google import genai
from google.genai.errors import ClientError


def _load_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "Missing GEMINI_API_KEY. Set it in your environment (see .env.example)."
        )
    return api_key


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


def get_client(api_key: Optional[str] = None) -> genai.Client:
    key = api_key or _load_api_key()
    return genai.Client(api_key=key)


def generate_text(prompt: str) -> str:
    client = get_client()
    model_name = os.getenv("GEMINI_MODEL", "models/gemini-flash-latest")
    fallback_model = os.getenv("GEMINI_FALLBACK_MODEL", "models/gemini-2.5-flash")
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
        )
        return response.text
    except ClientError as exc:
        status_code = getattr(exc, "status_code", None)
        if status_code is None:
            status_code = getattr(exc, "status", None)
        if status_code is None:
            status_code = getattr(exc, "code", None)
        if status_code == 404 and model_name != fallback_model:
            response = client.models.generate_content(
                model=fallback_model,
                contents=prompt,
            )
            return response.text
        raise


def main() -> int:
    load_dotenv()
    if len(sys.argv) < 2:
        print('Usage: python gemini.py "your prompt"')
        print("       python gemini.py --list-models")
        return 2
    if sys.argv[1] == "--list-models":
        client = get_client()
        for model in client.models.list():
            print(model.name)
        return 0
    prompt = sys.argv[1]
    print(generate_text(prompt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
