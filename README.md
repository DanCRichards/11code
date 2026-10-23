# Auckland Turnouts: FENZ SelCall decoder and board

Decodes the SelCall tones on Auckland fire radio and shows them on a live board: which stations have been turned out, and where each appliance (fire engine) is up to, from turnout through responding, at incident, available and back on station. Selcall carries no location, so the board shows who sent each message, not where any incident is.

It has three parts:

| Part | What it does |
|---|---|
| `web/` | The board. A browser app that runs on its own in **demo mode** (simulated Auckland traffic, decoded from synthesised audio in the browser) or connects to a backend for **live** calls. Deploys to GitHub Pages. |
| `server/` | Optional backend. Decodes audio from an SDR or a recording, keeps the shared codebook (stations, appliances, codes), and streams calls to the board. Python standard library plus NumPy/SciPy. |
| `selcall/` | The decoder: Goertzel tone detection, slot-based reading of the FENZ format, and a streaming wrapper. |

## Try it

```sh
cd web
npm install
npm run dev          # demo mode at http://localhost:5173
```

For a live board fed by your radio, see [`server/README.md`](server/README.md). In short:

```sh
pip install -r requirements.txt
(cd web && npm install && npm run build)
rtl_fm -f <channel>M -M fm -s 22050 -l 0 | python -m server --audio-stdin --rate 22050 --static web/dist
```

Then open `http://<pi-address>:8080`. The server prints an editing key for changing the codebook from the board.

## The board

- **Live:** turnouts grouped into jobs (stations called close together, with each appliance's current status); a status board of every appliance that's out; "On air" for routine calls, priority calls and status messages; a priority-call banner with an alarm; and a map you can show or hide.
- **My board:** your own grid of trucks, grouped by station and coloured by status. A truck flashes when it's turned out; a whole-station call makes the station's group pulse. Large or compact cells, full screen, and keep-screen-on for a wall display.
- **Turnout alarm** (Settings → Alerts): pick stations and trucks; when one is turned out the screen becomes a full-screen alarm that sounds until you acknowledge it.
- **Settings** (the gear): radio source (demo, recording, audio input, backend), alerts (priority alarm, chime for watched stations, background notifications), and the codebook.
- **Appliances:** every fire engine with its current status, searchable and filterable.
- **Stations:** last turnout, turnouts today and appliance statuses for every station.
- **Log:** every call, with filters for turnouts, statuses, priority calls, unknown codes and unreadable calls.
- **Audio input:** listen to a scanner through a microphone, line-in or USB sound card. Calls are decoded live in the browser, and the input can be played through your speakers or headphones at the same time, with a level meter to set the scanner volume. Needs https (the Pages site is) and a browser that allows audio input.
- **Recordings:** open an audio file or phone video (or a generated sample). It's decoded in the browser, then plays back with a waveform scrubber; each call appears on the board as you hear it. Tap a call to jump to it.
- **Codebook** (in Settings): the unknown-codes inbox (assign a heard code to a station or appliance, with suggestions), editors for stations, appliances, turnout codes and message meanings, the data source switch, and JSON import/export. In live mode, edits are saved to the backend for everyone. In demo mode they're saved in your browser.

### GitHub Pages

`.github/workflows/pages.yml` builds `web/` and deploys it on each push to `master` (repository **Settings → Pages → Source: GitHub Actions**). The Pages site runs in demo mode. To point it at your backend, open **Codebook → Data source**, or add `?backend=https://your-backend` to the URL. Browsers only let an https page talk to an https backend.

## What the decoder knows about FENZ SelCall

Measured from recordings, so treat these as working assumptions:

- **Station turnouts:** 5 tones, 20 ms each, on the CCIR frequencies, then a final tone ~137 ms after the first. `E` (2110 Hz) means "repeat the previous tone".
- **Turnout codes** look like `182` + appliance callsign (`182821` = Birkenhead 821). Codes ending in `0` are whole-station calls (`182860` = Kumeu station).
- **Short appliance calls:** a 5-tone unit ID plus a final tone (`C072D2`). The original decoder treated final `B` as a priority call. That's unconfirmed.
- **Long appliance messages ("13tone"):** the unit ID, a ~55 ms separator tone, then about 5 message tones (`C72D1-F1400C`). What the message tones mean isn't known yet; the demo uses its own K-code encoding.

Benchmarks and how the decoder was chosen are in [`bench/RESULTS.md`](bench/RESULTS.md).

## Data

`data/codebook.json` is the starting codebook, built by `tools/make_codebook.py` from `Store/*.lst`. Codes from the list are marked `list`. Codes filled in from the 182 pattern are marked `pattern` and are unconfirmed. Station positions are approximate. The map coastline (`web/src/data/geo.json`) comes from GSHHS full resolution via `tools/make_geo.py`.

## Development

```sh
python -m unittest discover -s tests     # decoder, stream decoder, server API
cd web && npm test && npm run build      # decoder port, interpretation, type check
python -m bench.run --quick              # decoder benchmark
```

`SepacDecoder.py` is the original 2018 script, kept for reference.

## License

Licensed under a Creative Commons Attribution-ShareAlike 3.0 Unported License (http://creativecommons.org/licenses/by-sa/3.0/). Originally adapted from py5mon by Mathias Bøhn Grytemark. Thanks to Justin Peel on Stack Overflow for the frequency-detection approach in the original script.
