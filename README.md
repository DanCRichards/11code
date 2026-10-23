# Auckland Turnouts

A live board for Auckland fire radio: which stations have been turned out, and where each appliance (fire engine) is up to, from turnout through responding, at incident, available and back on station. The radio messages carry no location, so the board shows who sent each message, not where any incident is.

| Part | What it does |
|---|---|
| `web/` | The board. A browser app that runs on its own in **demo mode** (simulated Auckland traffic) or connects to a backend for **live** calls. Deploys to GitHub Pages. |
| `server/` | Optional backend. Takes radio audio from a receiver or a recording, keeps the shared station and truck list, and streams calls to the board. Python standard library plus NumPy/SciPy. |

## Try it

```sh
cd web
npm install
npm run dev          # demo mode at http://localhost:5173
```

For a live board fed by your radio, see [`server/README.md`](server/README.md).

## The board

- **Live:** turnouts grouped into jobs (stations called close together, with each appliance's current status); a status board of every appliance that's out; "On air" for routine calls, priority calls and status messages; a priority-call banner with an alarm; and a map you can show or hide.
- **My board:** your own grid of trucks, grouped by station and coloured by status. A truck flashes when it's turned out; a whole-station call makes the station's group pulse. Stations pack together as clusters sized by how many trucks they have, with a colour key (and counts) at the top. Large or compact cells, keep-screen-on, and **TV mode**: the same station cards, scaled up so everything fits the screen, with a "station called" banner. On a phone, TV mode scrolls instead. Open `…/#tv` to start a TV straight in it.
- **Several boards:** keep more than one board (e.g. Central, North Shore), each with its own stations and trucks. Switch with the chips under the title; TV mode shows the board you're on.
- **Set a truck's K code:** tap any truck (on the board, in TV mode, or its page) and pick a K code. In live mode with the editing key it's posted to the backend so everyone sees it; otherwise it only changes your screen.
- **K codes:** each truck shows the FENZ K code it last sent (K1 Responding, K2 At incident, K7 On station…) and the first-arrival codes K55, K66, K77, K88 and K99. See `CLAUDE.md` for the list.
- **Turnout alarm** (Settings → Alerts): pick stations and trucks; when one is turned out the screen becomes a full-screen alarm showing the truck's callsign and station (or, for a whole-station call, the station and all its trucks). It stays up until you acknowledge it, or clears by itself after 15 s, 30 s or 1 min if you choose.
- **Priority alarm** (Settings → Alerts): full-screen for priority calls from any truck, or only chosen trucks/stations, showing which truck called. Same acknowledge or auto-clear choice.
- **Acknowledge** silences everything: the alarm, any chime, and the alert's temporary un-mute. The test buttons in Settings never play over each other.
- **Mute with auto un-mute:** the speaker button mutes radio audio. Any alert or alarm un-mutes it for 45 seconds or a minute, then it mutes again.
- **Settings** (the gear): radio source (demo, recording, audio input, backend), alerts, the station and truck list, backup, and **Design options** (or `…/design-options.html`), which compares four looks for the app.
- **Appliances**, **Stations** and **Log:** every fire engine and station with its current status, and every call heard, searchable and filterable.
- **Audio input:** listen to a scanner through a microphone, line-in or USB sound card, and hear it through your speakers at the same time. Needs https (the Pages site is) and a browser that allows audio input.
- **Recordings:** open an audio file or phone video; it plays back with a waveform scrubber and each call appears on the board as you hear it.

### GitHub Pages

`.github/workflows/pages.yml` builds `web/` and deploys it on each push to `master` (repository **Settings → Pages → Source: GitHub Actions**). The Pages site runs in demo mode. To point it at your backend, open **Settings → Radio source**, or add `?backend=https://your-backend` to the URL. Browsers only let an https page talk to an https backend.

## Development

```sh
python -m unittest discover -s tests     # server tests
cd web && npm test && npm run build      # web tests, type check, build
```

## License

Licensed under a Creative Commons Attribution-ShareAlike 3.0 Unported License (http://creativecommons.org/licenses/by-sa/3.0/). Originally adapted from py5mon by Mathias Bøhn Grytemark. Thanks to Justin Peel on Stack Overflow for the frequency-detection approach in the original script.
