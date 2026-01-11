# Spectator

Livestream chat summarizer for YouTube and Twitch. Paste a link, choose viewer or streamer mode, and get live summaries, keyword timestamps, and chat velocity insights.

## Features
- YouTube and Twitch chat ingestion
- Viewer and streamer modes
- Keyword timestamp tagging for streamer clips
- Live summary history
- Chat velocity chart with CSV export
- Theme switcher (default/dark/light)

## Project layout
- `app.py`: Flask API server
- `ytstreamchat.py`: YouTube live chat CLI
- `twitchstreamchat.py`: Twitch live chat CLI
- `chatsynthesizer.py`: summarization logic
- `frontend/`: React + Vite UI

## Requirements
- Python 3.10+
- Node.js 18+
- YouTube Data API key
- Gemini API key
- Twitch OAuth token (for Twitch mode)

## Setup
1) Create `.env` in the repo root:
```
GEMINI_API_KEY=...
GEMINI_MODEL=models/gemini-flash-latest
GEMINI_FALLBACK_MODEL=models/gemini-2.5-flash

YOUTUBE_API_KEY=...

TWITCH_CLIENT_ID=...
TWITCH_OAUTH_TOKEN=...
TWITCH_CHAT_NICK=your_twitch_username
```

2) Install Python deps:
```
pip install -r requirements.txt
```

3) Install frontend deps:
```
cd frontend
npm install
```

## Run the app
Backend:
```
python app.py
```

Frontend:
```
cd frontend
npm run dev
```

Open `http://localhost:5173` (Vite proxies `/api` to the Flask server on port 6767).

## Twitch OAuth (public app, implicit flow)
Use this URL (replace your client ID and redirect domain):
```
https://id.twitch.tv/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://YOUR_NGROK_DOMAIN/oauth/twitch/callback&response_type=token&scope=chat:read
```
After approval, copy `access_token` from the URL fragment and set:
```
TWITCH_OAUTH_TOKEN=...
```

## CLI usage
YouTube chat:
```
python ytstreamchat.py --video-id YOUR_VIDEO_ID
```

Twitch chat:
```
python twitchstreamchat.py --channel CHANNEL_NAME
```

## Notes
- Twitch chat uses IRC and only streams new messages (no backlog).
- Keyword timestamps and summary history use stream runtime.
- Increase chat velocity history size via `ChatVelocityChart` if desired.
