/**
 * Table sounds and the dealer's voice. Everything is synthesized: chip
 * clicks, card slides and flips come from a tiny Web Audio graph, and the
 * dealer speaks through the browser's speech synthesis. No files to load.
 */
export class PokerAudio {
  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private voice: SpeechSynthesisVoice | undefined;
  private queue: string[] = [];
  private speaking = false;

  soundsOn = true;
  voiceOn = true;

  constructor() {
    try {
      this.soundsOn = localStorage.getItem("vi.poker.sounds") !== "0";
      this.voiceOn = localStorage.getItem("vi.poker.voice") !== "0";
    } catch {
      /* ignore */
    }
    if ("speechSynthesis" in window) {
      const pick = () => {
        const voices = speechSynthesis.getVoices();
        // Prefer an English voice with a warm, lower register; fall back to anything English.
        this.voice =
          voices.find((v) => /en-(GB|IN)/i.test(v.lang) && /male|daniel|george|rishi|arthur/i.test(v.name)) ??
          voices.find((v) => /^en/i.test(v.lang) && /male|daniel|george|alex|david/i.test(v.name)) ??
          voices.find((v) => /^en/i.test(v.lang)) ??
          voices[0];
      };
      pick();
      speechSynthesis.addEventListener("voiceschanged", pick);
    }
  }

  setSounds(on: boolean) {
    this.soundsOn = on;
    try {
      localStorage.setItem("vi.poker.sounds", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  setVoice(on: boolean) {
    this.voiceOn = on;
    if (!on && "speechSynthesis" in window) speechSynthesis.cancel();
    this.queue.length = 0;
    this.speaking = false;
    try {
      localStorage.setItem("vi.poker.voice", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  /** Call from a click/keypress once so the AudioContext may start. */
  unlock() {
    this.ensure();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  private ensure(): AudioContext | undefined {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
      } catch {
        return undefined;
      }
    }
    return this.ctx;
  }

  // ---- Sounds ---------------------------------------------------------------------

  /** Clay chips landing: a few short filtered clicks. */
  chips(count = 3) {
    if (!this.soundsOn) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const n = Math.min(8, Math.max(1, count));
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.045 + Math.random() * 0.02);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1800 + Math.random() * 900, t);
      osc.frequency.exponentialRampToValueAtTime(600, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2400;
      bp.Q.value = 1.2;
      osc.connect(bp).connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.09);
    }
  }

  /** A card sliding across felt: short noise burst with a soft envelope. */
  cardSlide() {
    if (!this.soundsOn) return;
    this.noise(0.09, 0.18, 1200, 0.4);
  }

  /** A card turning over: sharper snap. */
  cardFlip() {
    if (!this.soundsOn) return;
    this.noise(0.05, 0.3, 3200, 2);
  }

  /** Riffle shuffle: a run of quick noise ticks. */
  shuffle() {
    if (!this.soundsOn) return;
    for (let i = 0; i < 14; i++) setTimeout(() => this.noise(0.03, 0.14, 2600, 1.5), i * 38);
  }

  /** Pot pushed to the winner: chips plus a soft chime. */
  win() {
    if (!this.soundsOn) return;
    this.chips(8);
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + 0.25;
    for (const [f, d] of [
      [660, 0],
      [880, 0.12],
      [1320, 0.24],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.2, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
      osc.connect(g).connect(this.master);
      osc.start(t + d);
      osc.stop(t + d + 0.55);
    }
  }

  /** Your turn: two soft ticks. */
  yourTurn() {
    if (!this.soundsOn) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    for (const d of [0, 0.14]) {
      const t = ctx.currentTime + d;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 1046;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  private noise(duration: number, volume: number, freq: number, q: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  // ---- Voice --------------------------------------------------------------------------

  /** The dealer says a line. Lines queue so they don't talk over each other; long backlogs drop the oldest. */
  say(text: string) {
    if (!this.voiceOn || !("speechSynthesis" in window)) return;
    const clean = text.replace(/[^\p{L}\p{N}\s.,:;!?'’%-]/gu, "").trim();
    if (!clean) return;
    this.queue.push(clean);
    while (this.queue.length > 3) this.queue.shift();
    this.pump();
  }

  private pump() {
    if (this.speaking || this.queue.length === 0) return;
    const text = this.queue.shift()!;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1.02;
    u.pitch = 0.9;
    u.volume = 0.9;
    this.speaking = true;
    const done = () => {
      this.speaking = false;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }
}
