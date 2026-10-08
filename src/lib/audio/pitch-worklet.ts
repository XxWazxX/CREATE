/**
 * Real-time pitch shifter (AudioWorklet), dual-tap delay-line granular method:
 * two read heads sweep a ~80 ms delay at a rate set by the pitch ratio and are
 * crossfaded with complementary triangular windows (constant gain). Changes
 * pitch without changing tempo — ideal for previewing a beat in another key.
 */
const source = /* js */ `
class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "pitchRatio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" }];
  }
  constructor() {
    super();
    this.size = Math.floor(sampleRate * 0.08);
    this.len = this.size * 2 + 8;
    this.bufs = [];
    this.w = 0;
    this.phase = 0;
  }
  read(buf, pos) {
    const len = this.len;
    pos = ((pos % len) + len) % len;
    const i = Math.floor(pos);
    const f = pos - i;
    return buf[i] * (1 - f) + buf[(i + 1) % len] * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const ratio = params.pitchRatio[0];
    const chs = output.length;
    while (this.bufs.length < chs) this.bufs.push(new Float32Array(this.len));
    const n = output[0].length;
    const size = this.size;
    const step = (1 - ratio) / size;
    for (let i = 0; i < n; i++) {
      this.phase += step;
      this.phase -= Math.floor(this.phase);
      const p1 = this.phase;
      const p2 = (p1 + 0.5) % 1;
      const g1 = 1 - Math.abs(2 * p1 - 1);
      const g2 = 1 - Math.abs(2 * p2 - 1);
      const d1 = 2 + p1 * size;
      const d2 = 2 + p2 * size;
      for (let c = 0; c < chs; c++) {
        const inp = input[c] || input[0];
        const buf = this.bufs[c];
        buf[this.w] = inp[i];
        output[c][i] = this.read(buf, this.w - d1) * g1 + this.read(buf, this.w - d2) * g2;
      }
      this.w = (this.w + 1) % this.len;
    }
    return true;
  }
}
registerProcessor("crate-pitch-shifter", PitchShifter);
`;

let url: string | null = null;

export function pitchWorkletUrl(): string {
  if (!url) url = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));
  return url;
}
