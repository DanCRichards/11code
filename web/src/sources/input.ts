import { Decimator, StreamDecoder } from "../decoder/stream";
import type { Call } from "../core/types";
import { store, type InputState } from "../store";

const BATCH = 2048; // samples per message from the audio thread

// Runs on the audio thread: hands blocks of input samples to the page.
const TAP_WORKLET = `
class SelcallTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${BATCH}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(${BATCH}); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor("selcall-tap", SelcallTap);
`;

let seq = 0;

/**
 * Live input: a microphone, or a scanner plugged into line-in or a USB sound
 * card. Decodes continuously and can play the input back out (monitor) so
 * you hear the radio while the board updates.
 */
export class InputSource {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private monitor?: GainNode;
  private nodes: AudioNode[] = [];
  private decoder?: StreamDecoder;
  private decimator?: Decimator;
  private lastLevelAt = 0;
  private peak = 0;

  start() {
    store.set({
      connection: { status: "input" }, calls: [], lastCall: undefined,
      input: { status: "idle", devices: [], level: 0, peak: 0, heard: 0 },
    });
    void this.listDevices();
  }

  stop() {
    this.release();
    store.set({ input: undefined });
  }

  private patch(p: Partial<InputState>) {
    const cur = store.get().input;
    if (cur) store.set({ input: { ...cur, ...p } });
  }

  async listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all.filter((d) => d.kind === "audioinput")
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Input ${i + 1}` }));
      this.patch({ devices });
    } catch { /* no device list; the default input still works */ }
  }

  /** Ask for the input and start decoding. Call from a tap/click. */
  async listen() {
    this.release();
    this.patch({ status: "starting", error: undefined });
    // Create/resume audio now, while still inside the tap: browsers (Safari
    // especially) keep audio suspended if this waits until after the prompt.
    const ctx = (this.ctx ??= new AudioContext({ latencyHint: "interactive" }));
    void ctx.resume();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.patch({ status: "error", error: "This browser can't use audio inputs here. Open the board over https (like the GitHub Pages site) in Chrome, Edge, Firefox or Safari." });
      return;
    }
    const { deviceId } = store.get().settings.input;
    try {
      // The phone-call processing (echo/noise/gain) mangles tones, so turn it all off.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
        },
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      this.patch({
        status: "error",
        error: name === "NotAllowedError" ? "Microphone access was blocked. Allow it for this site in the browser's settings, then try again."
          : name === "NotFoundError" || name === "OverconstrainedError" ? "That input isn't available. Plug it in, or pick another input."
          : `Couldn't open the input (${e instanceof Error ? e.message : String(e)}).`,
      });
      return;
    }
    void this.listDevices(); // labels appear once permission is granted

    const src = ctx.createMediaStreamSource(this.stream);
    const factor = Math.max(1, Math.round(ctx.sampleRate / 8000));
    this.decimator = new Decimator(factor);
    this.decoder = new StreamDecoder(ctx.sampleRate / factor);

    // Monitor: input -> gain -> speakers/headphones.
    this.monitor = ctx.createGain();
    this.applyMonitor();
    src.connect(this.monitor).connect(ctx.destination);

    // Tap: input -> sample collector -> silent sink (keeps it running).
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    let tap: AudioNode;
    try {
      const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: "text/javascript" }));
      // Some browsers/pages never settle this promise, so don't wait forever.
      await Promise.race([
        ctx.audioWorklet.addModule(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error("worklet timed out")), 2000)),
      ]);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, "selcall-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (m) => this.onSamples(m.data as Float32Array);
      tap = node;
    } catch {
      // Older browsers, or pages that can't load a worklet: the deprecated but universal processor.
      const sp = ctx.createScriptProcessor(BATCH, 1, 1);
      sp.onaudioprocess = (e) => this.onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
      tap = sp;
    }
    src.connect(tap).connect(sink);
    this.nodes = [src, this.monitor, tap, sink];
    this.patch({ status: "listening", rate: ctx.sampleRate });
  }

  /** Stop listening (keeps the board as it is). */
  pause() {
    this.release();
    this.patch({ status: "idle", level: 0, peak: 0 });
  }

  applyMonitor() {
    if (!this.monitor || !this.ctx) return;
    const { monitor, volume } = store.get().settings.input;
    this.monitor.gain.setTargetAtTime(monitor ? volume : 0, this.ctx.currentTime, 0.02);
  }

  private onSamples(x: Float32Array) {
    let sum = 0, pk = 0;
    for (let i = 0; i < x.length; i++) { sum += x[i] * x[i]; pk = Math.max(pk, Math.abs(x[i])); }
    this.peak = Math.max(this.peak * 0.9, pk);
    const now = performance.now();
    if (now - this.lastLevelAt > 100) {
      this.lastLevelAt = now;
      const db = 10 * Math.log10(sum / x.length + 1e-12); // dBFS
      this.patch({ level: Math.max(0, Math.min(1, (db + 60) / 60)), peak: this.peak });
    }
    if (!this.decoder || !this.decimator) return;
    const events = this.decoder.feed(this.decimator.process(x));
    if (!events.length) return;
    const sd = this.decoder;
    const calls: Call[] = events.map((ev) => ({
      id: `i${Date.now().toString(36)}${(seq++).toString(36)}`,
      time: Math.round(Date.now() - (sd.now - ev.start) * 1000),
      code: ev.code, kind: ev.kind, confidence: ev.confidence, source: "input", slots: ev.slots,
    }));
    store.addCalls(calls);
    this.patch({ heard: (store.get().input?.heard ?? 0) + calls.filter((c) => c.confidence >= 0.5).length });
  }

  private release() {
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* already */ } }
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.decoder = undefined;
    this.decimator = undefined;
  }
}
