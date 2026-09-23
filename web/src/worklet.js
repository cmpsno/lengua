/**
 * AudioWorklet processor: float32 mic input -> 16-bit PCM mono @ 16 kHz.
 *
 * Posts Int16Array buffers (transferred) to the main thread, which forwards
 * them as WebSocket binary frames to the backend STT adapter.
 *
 * Kept as a plain .js file (no bundler): served at /worklet.js and loaded
 * via audioWorklet.addModule().
 */
class Pcm16Worklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this._acc = []; // fractional-sample accumulator for resampling
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    // Downmix to mono (first channel), then resample to 16 kHz.
    const mono = input[0];
    const inRate = sampleRate;
    const outRate = 16000;
    const step = inRate / outRate;

    const out = [];
    let pos = this._pos || 0;
    while (pos < mono.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = mono[i];
      const b = mono[Math.min(i + 1, mono.length - 1)];
      out.push(a + (b - a) * frac);
      pos += step;
    }
    this._pos = pos - mono.length; // carry the fractional offset

    const pcm = new Int16Array(out.length);
    for (let n = 0; n < out.length; n++) {
      const s = Math.max(-1, Math.min(1, out[n]));
      pcm[n] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("pcm16-worklet", Pcm16Worklet);
