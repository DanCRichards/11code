# Backend

Decodes SelCall from audio, keeps the shared codebook, and streams calls to the board. Built on Python's standard library plus NumPy and SciPy, so it runs on a Raspberry Pi.

## Run

```sh
pip install -r requirements.txt
(cd web && npm install && npm run build)

# From an RTL-SDR (replace the frequency with your fire channel)
rtl_fm -f 141.000M -M fm -s 22050 -l 0 | python -m server --audio-stdin --rate 22050 --static web/dist

# Replay a recording in real time, for testing
python -m server --audio-file recordings/059dbcae.wav --loop --static web/dist

# No radio: API and board only (calls can be POSTed in)
python -m server --static web/dist
```

Open `http://<host>:8080`. A board served by the backend connects to it automatically.

| Option | Default | |
|---|---|---|
| `--port` | 8080 | |
| `--data-dir` | `server-data/` | Codebook and call log. Seeded from `data/codebook.json` on first run. |
| `--static` | none | Folder of the built board (`web/dist`). |
| `--cors-origin` | `*` | Set to your Pages origin (e.g. `https://you.github.io`) to limit which sites can call the API. |
| `--audio-stdin` / `--rate` | | Raw signed 16-bit mono audio on stdin. |
| `--audio-file` / `--loop` | | Replay a WAV in real time. |

Set `SELCALL_API_KEY` to fix the editing key. Otherwise a new one is printed at each start. The key is needed to change the codebook or post calls; reading is open.

## Using it from GitHub Pages

The Pages site is served over https, and browsers block an https page from calling an http backend. Either:

- open the board from the backend itself (`http://<pi>:8080`), or
- put the backend behind https (Cloudflare Tunnel, Tailscale Funnel, or a reverse proxy with a certificate), then enter that address under **Codebook → Data source** on the Pages site.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/health` | `{ ok, version, codebookVersion, decoder, decoded, unreadable }` |
| GET | `/api/codebook` | The codebook. `ETag` is its version. |
| PUT | `/api/codebook` | Replace it. Needs `X-API-Key`. Send `If-Match: <version>` to avoid overwriting someone else's change (409 if it moved). Invalid codebooks get 400 with the problems listed. |
| GET | `/api/calls?limit=200` | Recent calls, oldest first. |
| POST | `/api/calls` | Add calls from another decoder: `{ "code": "182821", "kind": "station", "confidence": 1 }` or `{ "calls": [...] }`. Needs `X-API-Key`. |
| GET | `/api/stream` | Server-Sent Events. `call` carries one call; `codebook` means the codebook changed. |

A call looks like:

```json
{ "id": "3f2a9c1d0b7e", "time": "2026-10-23T09:41:07.512Z", "code": "D8611-F1A0C2",
  "kind": "appliance-msg", "confidence": 0.92, "source": "decoder" }
```

The backend sends raw codes. The board works out what each one means from the codebook, so codebook edits also re-read past calls.
