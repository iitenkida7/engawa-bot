# engawa-bot

[日本語](README.ja.md)

A resident bot for [engawa](https://github.com/iitenkida7/engawa), the browser-only virtual office.
It lives quietly outside the busy floor, now and then strolling about. **Knock on it and it comes to
your meeting**, records and transcribes it, and when you leave it hands you the video, a summary and
the full transcript.

- **Records** the meeting with engawa's own recorder (screen share as the main stage, cameras beside it).
- **Transcribes** it with engawa's own Groq Whisper transcription (who said what, per speaker).
- **Summarizes** it with a Groq-hosted LLM (decisions, action items, next steps).
- **Delivers** it to a Google shared drive and shares the meeting folder with the person who called it
  (Drive's notification email carries the highlights) — or simply into a local folder.

The bot is an ordinary engawa participant: it logs in, walks and presses the same buttons a person
would, so **engawa itself needs no changes**. It drives the real engawa web client in headless Chrome
through Bun's built-in [`Bun.WebView`](https://bun.com/docs/runtime/webview), and reads what is going
on from the client's own WebSocket traffic.

## How it works

1. The bot joins engawa and stays around `STROLL_POINTS`, moving every few minutes and keeping away
   from people (walking into someone's range would start a call).
2. Knock on it (👥 participants → the bot → Knock). It accepts and engawa walks it over to you.
3. Once it shares a call with you it starts recording and transcribing. Everyone sees the usual
   recording / transcribing indicators.
4. When **you** (the caller) have been out of its call for 15 seconds — you left the room — it stops,
   collects the recording and transcript, and walks home. A meeting is also capped at
   `MAX_MEETING_MINUTES`.
5. In the background it summarizes the transcript and delivers everything.

While busy, it answers other knocks with "later" (one meeting at a time).

It is easy to spot: a robot face as its profile picture (on its camera-off tile, in the roster and by
its name on the map) and a fixed avatar with a hat and glasses. Swap them with `BOT_AVATAR_IMAGE` and
`BOT_OUTFIT`. It never sends audio or video of its own, and its own tile is kept out of the recording.

## Setup

Requirements: Docker (with Compose) on a machine that can reach your engawa. A small box is enough:
one meeting takes roughly 0.5–1 GB of RAM and 1–2 CPU cores while recording.

```bash
cp .env.example .env
```

Fill in `.env`: `ENGAWA_URL`, `ENGAWA_PASSWORD` (if your engawa has one), `GROQ_API_KEY`, and
`STROLL_POINTS` (tile coordinates `c,r;c,r` outside the busy area of your map — see engawa's map JSON).

```bash
make up      # build and start in the background (restarts automatically)
make logs    # follow the log
```

With `DELIVERY=local` (the default) each meeting lands in `./data/meetings/<date time room (participants)>/`, e.g.
`2026-11-14 1430 Meeting room 1 (Alice, Bob)` (up to four names, then a count).

### Google Drive delivery

1. In Google Cloud, enable the **Google Drive API** and create a **service account**; download its JSON
   key to `config/service-account.json`.
2. Create a **shared drive** (a service account has no storage of its own, so My Drive does not work)
   and add the service account's email as a **Content manager**.
3. Set `DELIVERY=drive` and `DRIVE_FOLDER_ID` to the shared drive's ID (the last part of its URL) or a
   folder inside it.
4. Copy `config/recipients.example.json` to `config/recipients.json` and map engawa display names to
   email addresses. Set `ALLOWED_EMAIL_DOMAINS` to your organization's domain(s): the bot never shares
   with an address outside them.

Meetings are filed as `<shared drive>/<YYYY-MM>/<YYYY-MM-DD HHMM room (participants)>/` with the recording, a summary
doc and a transcript doc, and the meeting folder is shared (editor) with the caller only. If Drive fails
the meeting is kept locally instead, so nothing is lost.

## Configuration

See [.env.example](.env.example) for every setting.

## Development

Everything runs through Docker, as in engawa:

| Purpose | Command |
|---|---|
| Install dependencies | `make install` |
| Type-check | `make typecheck` |
| Lint (Biome) | `make lint` |
| Test | `make test` |

Pure logic (frame parsing, world state, the meeting state machine, strolling, formatting, Drive / Groq
request building) lives in its own modules with unit tests in `src/__tests__/`.

## Limitations

- The bot depends on engawa's client UI (element IDs, the knock toast). Run a bot version that matches
  your engawa version.
- Recipients are looked up by display name, since engawa knows no email addresses.
- One bot handles one meeting at a time.

## License

[MIT](LICENSE)
