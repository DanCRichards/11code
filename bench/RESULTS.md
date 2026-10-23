# Decoder benchmark: 2026-10-23

Raw output: `results-2026-10-23.txt`. Re-run with `python -m bench.run`.

## Test data

- **Real**: 4 phone videos of a scanner speaker (heavy room echo). 9 station
  calls hand-labelled from tone-energy plots; appliance bursts are unlabelled.
- **Synthetic SDR**: 40 calls per condition sent through a simulated 12.5 kHz
  narrowband FM link (pre-emphasis, RF noise, discriminator, de-emphasis),
  with open-squelch noise and fake voice between calls. CNR 20 to 2 dB.
  The FM threshold (where audio collapses) is around 6-9 dB CNR.

## Format findings

- Station calls: 5 tones, 20 ms each, then a final tone ~137 ms after the
  first, ~35-55 ms long. `E` (repeat) is 2110 Hz; the original code had 2210.
- Appliance calls (`C...`) appear to be the longer "13tone" format and do not
  fit the 6-slot grid. The slot assembler currently truncates them.

## Calls decoded correctly out of 40, by CNR (dB)

| Decoder | 20 | 10 | 7 | 5 | 4 | 3 | 2 | Wrong codes | Real (of 9) | Speed |
|---|---|---|---|---|---|---|---|---|---|---|
| Original SepacDecoder.py | 1 | 1 | 1 | 2 | 4 | 1 | 0 | 103 + 47 false alarms | 4 | 455x |
| Goertzel 15 ms, run-based | 35 | 39 | 34 | 34 | 21 | 12 | 2 | 72 | 4 | 335x |
| **Goertzel 15 ms, slots, ratio 2 dB (new default)** | 40 | 40 | 40 | 40 | 35 | 26 | 7 | **0** | 9 | 231x |
| FFT 15 ms, slots | 40 | 40 | 40 | 40 | 36 | 26 | 7 | 0 | 9 | 23x |
| Goertzel 20 ms, matched-filter slots | 40 | 40 | 40 | 40 | 34 | 20 | 5 | 0 | 9 | 67x |
| Instantaneous frequency 8 ms, slots | - | - | - | - | - | - | - | 0 | 5 | 199x |

"Speed" is audio seconds processed per CPU second on this container.

## Takeaways

1. The original decoder is unusable on SDR audio even with a strong signal:
   23 ms non-overlapping frames can't see 20 ms tones.
2. Reading tones at their known time slots is the biggest single win. It
   also never produced a wrong code: when unsure it reports low confidence.
3. Goertzel and FFT detectors tie on accuracy; Goertzel is ~10x faster.
4. Instantaneous frequency, a 10 ms window, and an 8 dB ratio gate all lose.
5. Band-pass filtering and 3-frame smoothing each help; 16 kHz sampling
   doesn't.

## Update: long appliance messages ("13tone")

Two real appliance messages share a layout: the 5-tone header, a ~55 ms
separator tone (F in both) starting at ~105 ms, then 5 body tones on a 20 ms
grid from ~165 ms. Both bodies read `1400C`, so the body looks like a status
or message code. Decoded as `C72D1-F1400C`. The body length (5) is from these two
messages only.

Decoded correctly out of 180 synthetic SDR calls (3 seeds x 60), by CNR:

| CNR (dB) | Stations | Short appliance | Long appliance | Wrong |
|---|---|---|---|---|
| 20 | 75/75 | 58/58 | 47/47 | 0 |
| 7 | 75/75 | 58/58 | 47/47 | 0 |
| 5 | 75/75 | 57/58 | 46/47 | 0 |
| 4 | 75/75 | 51/58 | 32/47 | 2 |
| 3 | 59/75 | 34/58 | 14/47 | 6 |
