import {
  getDungeonFloorNumber,
  isInArcadeZone,
  isInBrickDungeon,
  isInCampfireCircle,
  isInForestWilderness,
} from "@vi/shared";

export type AudioTheme =
  | "day"
  | "sunset"
  | "night"
  | "forest_day"
  | "forest_sunset"
  | "forest_night"
  | "arcade"
  | "dungeon_ice"
  | "dungeon_fire"
  | "dungeon_shadow"
  | "dungeon_boss"
  | "silent";

export interface AnimalSoundState {
  id: string;
  species: string;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
}

/**
 * Procedural Web Audio Music & Sound Engine with Strict Single-Arena Isolation:
 * - Guarantees only ONE arena soundtrack/ambience plays at a time.
 * - Immediately fades out, stops, and disconnects the previous arena's GainNode
 *   and oscillators whenever the player crosses into a different arena or floor,
 *   so zero sounds or drones ever carry forward or overlap.
 */
export class GameAudio {
  private ctx: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private sfxGain: GainNode | undefined;
  /** Dedicated gain bus for the currently active arena; replaced & disconnected on every arena change. */
  private activeArenaGain: GainNode | undefined;
  private activeSourceNodes = new Set<AudioScheduledSourceNode>();

  enabled = true;
  private currentTheme: AudioTheme = "day";
  private inForestZone = false;
  private themeStepTimer: ReturnType<typeof setInterval> | undefined;
  private ambientStepTimer: ReturnType<typeof setInterval> | undefined;
  private stepCount = 0;

  // Track previous HP of animals to detect damage & deaths
  private lastAnimalHp = new Map<string, number>();
  private lastAmbientAnimalSoundTime = 0;

  constructor() {
    try {
      this.enabled = localStorage.getItem("vi.game.audio") !== "0";
    } catch {
      /* ignore */
    }
  }

  unlock() {
    this.ensureContext();
    if (this.ctx?.state === "suspended") {
      void this.ctx.resume();
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem("vi.game.audio", this.enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!this.enabled) {
      this.killActiveArenaAudio();
    } else if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0.65, now);
      this.resetArenaBus();
    }
    return this.enabled;
  }

  private ensureContext(): AudioContext | undefined {
    if (!this.ctx) {
      try {
        const AudioCtx =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AudioCtx();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.enabled ? 0.65 : 0.0001;
        this.masterGain.connect(this.ctx.destination);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.55;
        this.sfxGain.connect(this.masterGain);

        this.resetArenaBus();
        this.startMusicClock();
      } catch {
        return undefined;
      }
    }
    return this.ctx;
  }

  /**
   * Immediately cuts off and disconnects all oscillators/gains from the previous arena
   * so no music or ambient sound ever carries forward or overlaps into another arena.
   */
  private killActiveArenaAudio() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.activeArenaGain) {
      const oldBus = this.activeArenaGain;
      this.activeArenaGain = undefined;
      try {
        oldBus.gain.cancelScheduledValues(now);
        oldBus.gain.setValueAtTime(Math.max(0.0001, oldBus.gain.value), now);
        oldBus.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
        setTimeout(() => {
          try {
            oldBus.disconnect();
          } catch {
            /* ignore */
          }
        }, 70);
      } catch {
        /* ignore */
      }
    }

    for (const node of this.activeSourceNodes) {
      try {
        node.stop(now + 0.05);
      } catch {
        /* ignore */
      }
    }
    this.activeSourceNodes.clear();
  }

  private resetArenaBus() {
    this.killActiveArenaAudio();
    if (!this.ctx || !this.masterGain || !this.enabled || this.currentTheme === "silent") return;

    const bus = this.ctx.createGain();
    const now = this.ctx.currentTime;
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(0.45, now + 0.12);
    bus.connect(this.masterGain);
    this.activeArenaGain = bus;
    this.stepCount = 0;
  }

  private trackSource(node: AudioScheduledSourceNode) {
    this.activeSourceNodes.add(node);
    node.onended = () => {
      this.activeSourceNodes.delete(node);
    };
  }

  private startMusicClock() {
    if (this.themeStepTimer) clearInterval(this.themeStepTimer);
    if (this.ambientStepTimer) clearInterval(this.ambientStepTimer);

    this.themeStepTimer = setInterval(() => {
      this.onMusicStep();
    }, 320);

    this.ambientStepTimer = setInterval(() => {
      this.onAmbientStep();
    }, 600);
  }

  // =========================================================================
  // MUSIC & THEME SEQUENCER (Strictly 1 active theme at a time)
  // =========================================================================

  private onMusicStep() {
    if (!this.ctx || !this.enabled || !this.activeArenaGain) return;
    if (this.currentTheme === "silent") return;

    const t = this.ctx.currentTime;
    const step = this.stepCount++;

    switch (this.currentTheme) {
      case "day":
      case "forest_day":
        this.stepDayTheme(t, step);
        break;
      case "sunset":
      case "forest_sunset":
        this.stepSunsetTheme(t, step);
        break;
      case "night":
      case "forest_night":
        this.stepNightTheme(t, step);
        break;
      case "arcade":
        this.stepArcadeTheme(t, step);
        break;
      case "dungeon_ice":
        this.stepDungeonIceTheme(t, step);
        break;
      case "dungeon_fire":
        this.stepDungeonFireTheme(t, step);
        break;
      case "dungeon_shadow":
        this.stepDungeonShadowTheme(t, step);
        break;
      case "dungeon_boss":
        this.stepDungeonBossTheme(t, step);
        break;
    }
  }

  private stepDayTheme(t: number, step: number) {
    const bar = Math.floor(step / 16) % 4;
    const sub = step % 16;

    if (sub === 0) {
      const bassNotes = [130.81, 174.61, 196.0, 220.0]; // C3, F3, G3, A3
      this.playTone(bassNotes[bar]!, t, 2.0, "sine", 0.15, 0.15, 0.4);
      this.playTone(bassNotes[bar]! * 1.5, t + 0.1, 1.6, "triangle", 0.08, 0.2, 0.4);
    }

    const melodyMap: Record<number, number[]> = {
      0: [523.25, 659.25, 783.99, 987.77, 1046.5],
      1: [698.46, 880.0, 1046.5, 1318.51],
      2: [783.99, 987.77, 1174.66, 1318.51],
      3: [880.0, 1046.5, 1318.51, 1567.98],
    };
    const notes = melodyMap[bar] ?? [523.25];

    if (sub % 4 === 0 || sub === 7 || sub === 11 || sub === 14) {
      const note = notes[(Math.floor(sub * 1.7) + bar) % notes.length]!;
      this.playChime(note, t, 0.75, 0.13);
    }

    if (this.inForestZone && sub === 3 && Math.random() < 0.35) {
      this.playBirdChirp(t);
    }
  }

  private stepSunsetTheme(t: number, step: number) {
    const bar = Math.floor(step / 16) % 4;
    const sub = step % 16;

    if (sub === 0) {
      const roots = [146.83, 116.54, 174.61, 130.81]; // D3, Bb2, F3, C3
      const root = roots[bar]!;
      this.playTone(root, t, 2.8, "triangle", 0.18, 0.5, 0.6);
      this.playTone(root * 1.2, t + 0.05, 2.5, "sine", 0.13, 0.6, 0.6);
      this.playTone(root * 1.5, t + 0.1, 2.3, "sine", 0.11, 0.6, 0.6);
    }

    if (sub === 2 || sub === 6 || sub === 10 || sub === 13) {
      const sunsetScales: Record<number, number[]> = {
        0: [587.33, 698.46, 880.0, 1046.5],
        1: [466.16, 587.33, 698.46, 880.0],
        2: [698.46, 880.0, 1046.5, 1318.51],
        3: [523.25, 659.25, 783.99, 1046.5],
      };
      const scale = sunsetScales[bar]!;
      const freq = scale[sub % scale.length]!;
      this.playWarmBell(freq, t, 1.2, 0.14);
    }
  }

  private stepNightTheme(t: number, step: number) {
    const sub = step % 24;

    if (sub === 0) {
      this.playTone(110.0, t, 4.2, "sine", 0.2, 0.8, 0.8); // A2
      this.playTone(164.81, t + 0.2, 3.8, "triangle", 0.12, 1.0, 0.8); // E3
      this.playTone(220.0, t + 0.4, 3.4, "sine", 0.09, 1.0, 0.8); // A3
    }

    if (sub === 4 || sub === 11 || sub === 18) {
      const nightBells = [880.0, 1046.5, 1318.51, 1567.98, 1760.0];
      const bell = nightBells[(sub * 3) % nightBells.length]!;
      this.playGlassChime(bell, t, 1.8, 0.11);
    }
  }

  private stepArcadeTheme(t: number, step: number) {
    const sub = step % 16;
    const bar = Math.floor(step / 16) % 4;

    const bassChords = [130.81, 164.81, 174.61, 196.0];
    const root = bassChords[bar]!;
    if (sub % 2 === 0) {
      const octave = sub % 4 === 0 ? 1 : 2;
      this.playTone(root * octave, t, 0.14, "triangle", 0.24, 0.005, 0.08);
    }

    const arps = [
      [523.25, 659.25, 783.99, 1046.5],
      [659.25, 783.99, 987.77, 1318.51],
      [698.46, 880.0, 1046.5, 1396.91],
      [783.99, 987.77, 1174.66, 1567.98],
    ];
    const arp = arps[bar]!;
    const note = arp[sub % arp.length]!;
    this.playTone(note, t, 0.11, "square", 0.11, 0.008, 0.06);

    if (sub === 4 || sub === 12) {
      this.playArenaNoiseBurst(t, 0.06, 0.14, 2800, 1.8);
    }
  }

  private stepDungeonIceTheme(t: number, step: number) {
    const sub = step % 20;

    if (sub === 0) {
      this.playTone(82.41, t, 3.8, "sine", 0.22, 0.7, 0.8); // E2
      this.playTone(123.47, t + 0.25, 3.4, "triangle", 0.11, 0.9, 0.8); // B2
    }

    if (sub === 3 || sub === 8 || sub === 14) {
      const iceBells = [659.25, 698.46, 932.33, 987.77, 1318.51, 1396.91];
      const freq = iceBells[sub % iceBells.length]!;
      this.playGlassChime(freq, t, 1.8, 0.13);
    }

    if (sub === 6 || sub === 15) {
      this.playWaterDrip(t);
    }
  }

  private stepDungeonFireTheme(t: number, step: number) {
    const sub = step % 16;

    if (sub % 4 === 0) {
      const rumblers = [55.0, 58.27, 65.41, 73.42];
      const root = rumblers[Math.floor(sub / 4)]!;
      this.playTone(root, t, 0.95, "sawtooth", 0.2, 0.08, 0.25);
    }

    if (sub === 0 || sub === 6 || sub === 10) {
      this.playLowBrassStab(110.0, t, 0.65, 0.18);
    }

    if (Math.random() < 0.35) {
      this.playArenaNoiseBurst(t, 0.04, 0.08, 3600, 3.2);
    }
  }

  private stepDungeonShadowTheme(t: number, step: number) {
    const sub = step % 20;

    if (sub === 0) {
      this.playTone(43.65, t, 4.0, "sine", 0.28, 0.8, 0.8); // F1
      this.playTone(61.74, t + 0.3, 3.6, "sawtooth", 0.13, 1.0, 0.8); // B1 tritone
    }

    if (sub === 5 || sub === 12 || sub === 17) {
      const shadowFreqs = [174.61, 246.94, 349.23, 493.88];
      const f = shadowFreqs[sub % shadowFreqs.length]!;
      this.playBowedShadowTone(f, t, 2.0, 0.15);
    }
  }

  private stepDungeonBossTheme(t: number, step: number) {
    const sub = step % 16;
    const bar = Math.floor(step / 16) % 4;

    if (sub === 0 || sub === 3 || sub === 6 || sub === 8 || sub === 11 || sub === 14) {
      this.playWarDrum(t, sub === 0 || sub === 8 ? 0.36 : 0.24);
    }

    const bassline = [73.42, 82.41, 87.31, 98.0];
    this.playTone(bassline[bar]!, t, 0.24, "sawtooth", 0.22, 0.02, 0.08);

    if (sub === 0 || sub === 6 || sub === 12) {
      const brassChords = [146.83, 174.61, 220.0];
      brassChords.forEach((bf) => this.playLowBrassStab(bf, t, 0.5, 0.16));
    }
  }

  // =========================================================================
  // AMBIENT FOREST INSECT SOUNDS (Strictly inside Forest/Campfire zone only)
  // =========================================================================

  private onAmbientStep() {
    if (!this.ctx || !this.enabled || !this.activeArenaGain || !this.inForestZone) return;
    const t = this.ctx.currentTime;

    if (this.currentTheme === "forest_night" || this.currentTheme === "forest_sunset") {
      this.playCricketChirp(t);
    } else if (this.currentTheme === "forest_day" && Math.random() < 0.55) {
      this.playCicadaHum(t);
    }
  }

  private playCricketChirp(t: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const st = t + i * 0.055;
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(4500 + Math.random() * 400, st);

      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 4600;
      bp.Q.value = 3.5;

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.055, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.045);

      osc.connect(bp).connect(g).connect(this.activeArenaGain);
      this.trackSource(osc);
      osc.start(st);
      osc.stop(st + 0.05);
    }
  }

  private playCicadaHum(t: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const dur = 0.45 + Math.random() * 0.25;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(3800 + Math.random() * 500, t);
    osc.frequency.linearRampToValueAtTime(4200, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.04, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  private playBirdChirp(t: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const startF = 2600 + Math.random() * 800;
    const endF = startF + (Math.random() > 0.5 ? 900 : -600);
    const dur = 0.12;

    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(startF, t);
    osc.frequency.exponentialRampToValueAtTime(endF, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playWaterDrip(t: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    const f = 1400 + Math.random() * 600;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.04);
    osc.frequency.exponentialRampToValueAtTime(f * 0.75, t + 0.14);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // =========================================================================
  // ANIMAL AMBIENT & DEATH SOUNDS
  // =========================================================================

  playAnimalDeath(species: string, distance: number) {
    this.ensureContext();
    if (!this.ctx || !this.enabled || !this.sfxGain) return;

    const distGain = Math.max(0.05, Math.min(1.0, 1 - distance / 36));
    const t = this.ctx.currentTime;

    switch (species) {
      case "rabbit":
        this.playPitchSweep(1800, 750, 0.22, "sine", 0.32 * distGain, t);
        break;
      case "deer":
        this.playPitchSweep(360, 180, 0.45, "triangle", 0.38 * distGain, t);
        this.playPitchSweep(240, 110, 0.5, "sawtooth", 0.22 * distGain, t + 0.05);
        break;
      case "boar":
        this.playBoarSqueal(t, distGain);
        break;
      case "wolf":
      case "shadow_wolf":
        this.playWolfYelp(t, distGain, species === "shadow_wolf");
        break;
      case "snake":
        this.playSnakeHiss(t, distGain);
        break;
      case "spider":
        this.playSpiderSquish(t, distGain);
        break;
      case "cerberus":
        this.playCerberusDeathRoar(t, distGain);
        break;
    }
  }

  playAnimalHurt(species: string, distance: number) {
    this.ensureContext();
    if (!this.ctx || !this.enabled || !this.sfxGain) return;
    const distGain = Math.max(0.05, Math.min(1.0, 1 - distance / 30));
    const t = this.ctx.currentTime;

    if (species === "cerberus") {
      this.playPitchSweep(160, 90, 0.4, "sawtooth", 0.45 * distGain, t);
      this.playSfxNoiseBurst(t, 0.25, 0.3 * distGain, 550, 2.0);
    } else if (species === "boar") {
      this.playPitchSweep(620, 310, 0.18, "sawtooth", 0.3 * distGain, t);
    } else if (species === "spider") {
      this.playSfxNoiseBurst(t, 0.12, 0.25 * distGain, 2400, 2.5);
    } else {
      this.playPitchSweep(580, 220, 0.16, "triangle", 0.25 * distGain, t);
    }
  }

  playAnimalAmbient(species: string, distance: number) {
    this.ensureContext();
    if (!this.ctx || !this.enabled || !this.activeArenaGain) return;
    const now = Date.now();
    if (now - this.lastAmbientAnimalSoundTime < 4500) return;
    this.lastAmbientAnimalSoundTime = now;

    const distGain = Math.max(0.05, Math.min(1.0, 1 - distance / 20));
    const t = this.ctx.currentTime;

    switch (species) {
      case "rabbit":
        this.playArenaNoiseBurst(t, 0.08, 0.1 * distGain, 3200, 1.2);
        break;
      case "deer":
        this.playPitchSweep(280, 220, 0.35, "sine", 0.16 * distGain, t, this.activeArenaGain);
        break;
      case "boar":
        this.playPitchSweep(180, 130, 0.22, "sawtooth", 0.18 * distGain, t, this.activeArenaGain);
        break;
      case "wolf":
      case "shadow_wolf":
        this.playWolfHowl(t, distGain);
        break;
      case "snake":
        this.playArenaNoiseBurst(t, 0.28, 0.15 * distGain, 4800, 2.8);
        break;
      case "spider":
        for (let i = 0; i < 4; i++) {
          this.playArenaNoiseBurst(t + i * 0.045, 0.025, 0.14 * distGain, 3800, 3.2);
        }
        break;
      case "cerberus":
        this.playCerberusGrowl(t, distGain);
        break;
    }
  }

  // ---- Animal Audio Synthesis Helpers --------------------------------------

  private playBoarSqueal(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    const dur = 0.42;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(850, t);
    osc.frequency.linearRampToValueAtTime(1450, t + 0.1);
    osc.frequency.exponentialRampToValueAtTime(320, t + dur);

    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 1200;
    f.Q.value = 1.4;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.38 * vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playWolfYelp(t: number, vol: number, isShadow: boolean) {
    if (!this.ctx || !this.sfxGain) return;
    const dur = 0.48;
    const osc = this.ctx.createOscillator();
    osc.type = isShadow ? "sawtooth" : "triangle";
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.linearRampToValueAtTime(980, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(220, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35 * vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playWolfHowl(t: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const dur = 1.6;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.linearRampToValueAtTime(620, t + 0.45);
    osc.frequency.linearRampToValueAtTime(580, t + 1.0);
    osc.frequency.exponentialRampToValueAtTime(260, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.24 * vol, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playSnakeHiss(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    this.playSfxNoiseBurst(t, 0.45, 0.32 * vol, 5200, 2.2);
    for (let i = 0; i < 6; i++) {
      this.playSfxNoiseBurst(t + i * 0.05, 0.03, 0.22 * vol, 6800, 3.8);
    }
  }

  private playSpiderSquish(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    this.playPitchSweep(1200, 240, 0.18, "sawtooth", 0.35 * vol, t);
    this.playSfxNoiseBurst(t, 0.22, 0.3 * vol, 1800, 1.2);
  }

  private playCerberusDeathRoar(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    const dur = 2.2;
    const freqs = [
      { start: 160, peak: 240, end: 45, type: "sawtooth" as const, delay: 0 },
      { start: 220, peak: 360, end: 60, type: "sawtooth" as const, delay: 0.1 },
      { start: 320, peak: 480, end: 85, type: "triangle" as const, delay: 0.18 },
    ];

    for (const f of freqs) {
      const st = t + f.delay;
      const osc = this.ctx.createOscillator();
      osc.type = f.type;
      osc.frequency.setValueAtTime(f.start, st);
      osc.frequency.linearRampToValueAtTime(f.peak, st + 0.45);
      osc.frequency.exponentialRampToValueAtTime(f.end, st + dur);

      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1400, st);
      lp.frequency.exponentialRampToValueAtTime(320, st + dur);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.linearRampToValueAtTime(0.35 * vol, st + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, st + dur);

      osc.connect(lp).connect(g).connect(this.sfxGain);
      osc.start(st);
      osc.stop(st + dur + 0.05);
    }

    this.playSfxNoiseBurst(t, 1.6, 0.42 * vol, 450, 1.5);
  }

  private playCerberusGrowl(t: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const dur = 1.2;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(75, t);
    osc.frequency.linearRampToValueAtTime(95, t + 0.5);
    osc.frequency.linearRampToValueAtTime(55, t + dur);

    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 350;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28 * vol, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---- Synthesis Primitives (all routed to activeArenaGain) ----------------

  private playTone(
    freq: number,
    t: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    attack = 0.02,
    release = 0.2,
  ) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + release);
  }

  private playChime(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private playWarmBell(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t);

    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1600;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private playGlassChime(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private playLowBrassStab(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t);

    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(800, t);
    f.frequency.exponentialRampToValueAtTime(250, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playBowedShadowTone(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t);

    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.Q.value = 2.0;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  private playWarDrum(t: number, vol: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.24);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

    osc.connect(g).connect(this.activeArenaGain);
    this.trackSource(osc);
    osc.start(t);
    osc.stop(t + 0.38);
  }

  private playPitchSweep(
    startFreq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    t: number,
    dest?: AudioNode,
  ) {
    const out = dest ?? this.sfxGain;
    if (!this.ctx || !out) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(out);
    if (dest === this.activeArenaGain) this.trackSource(osc);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playArenaNoiseBurst(t: number, dur: number, vol: number, freq: number, q: number) {
    if (!this.ctx || !this.activeArenaGain) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.value = vol;

    src.connect(f).connect(g).connect(this.activeArenaGain);
    this.trackSource(src);
    src.start(t);
  }

  private playSfxNoiseBurst(t: number, dur: number, vol: number, freq: number, q: number) {
    if (!this.ctx || !this.sfxGain) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.value = vol;

    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t);
  }

  // =========================================================================
  // FRAME UPDATE & STRICT ARENA ISOLATION
  // =========================================================================

  update(opts: {
    playerX: number;
    playerZ: number;
    isNight: boolean;
    timeMode: string;
    inCinema: boolean;
    moviePlaying: boolean;
    inArcadeModal: boolean;
    inPoker?: boolean;
    animals: AnimalSoundState[];
  }) {
    if (!this.enabled) return;

    const inDungeon = isInBrickDungeon(opts.playerX, opts.playerZ);
    const inArcade = isInArcadeZone(opts.playerX, opts.playerZ) || opts.inArcadeModal;
    const inForest =
      !inDungeon &&
      !inArcade &&
      !opts.inCinema &&
      !opts.inPoker &&
      (isInForestWilderness(opts.playerX, opts.playerZ) || isInCampfireCircle(opts.playerX, opts.playerZ));

    this.inForestZone = inForest;

    // 1. Determine exclusive arena theme (only ONE can be active at a time)
    let nextTheme: AudioTheme = "day";

    if (opts.inCinema || opts.moviePlaying || opts.inPoker) {
      // Complete silence inside Cinema Hall & Poker Table so two audio players never overlap
      nextTheme = "silent";
    } else if (inDungeon) {
      const floor = getDungeonFloorNumber(opts.playerX, opts.playerZ);
      if (floor === 1) nextTheme = "dungeon_ice";
      else if (floor === 2) nextTheme = "dungeon_fire";
      else if (floor === 3) nextTheme = "dungeon_shadow";
      else nextTheme = "dungeon_boss";
    } else if (inArcade) {
      nextTheme = "arcade";
    } else if (inForest) {
      if (opts.timeMode === "night" || opts.isNight) nextTheme = "forest_night";
      else if (opts.timeMode === "sunset") nextTheme = "forest_sunset";
      else nextTheme = "forest_day";
    } else {
      if (opts.timeMode === "night" || opts.isNight) nextTheme = "night";
      else if (opts.timeMode === "sunset") nextTheme = "sunset";
      else nextTheme = "day";
    }

    // If the arena or theme changed, immediately cut off & disconnect previous arena's audio!
    if (nextTheme !== this.currentTheme) {
      this.currentTheme = nextTheme;
      if (this.ctx) {
        this.resetArenaBus();
      }
    }

    // 2. Only process animal sounds when the player is in the Forest or Dungeon (never in Cinema/Arcade/Hub)
    if (!inForest && !inDungeon) {
      for (const a of opts.animals) {
        this.lastAnimalHp.set(a.id, a.hp);
      }
      return;
    }

    const playerFloor = inDungeon ? getDungeonFloorNumber(opts.playerX, opts.playerZ) : 0;
    let closestAnimal: AnimalSoundState | undefined;
    let closestDist = Infinity;

    for (const a of opts.animals) {
      const animalInDungeon = isInBrickDungeon(a.x, a.z);
      const sameArena = inDungeon
        ? animalInDungeon && getDungeonFloorNumber(a.x, a.z) === playerFloor
        : !animalInDungeon;

      const dist = Math.hypot(a.x - opts.playerX, a.z - opts.playerZ);
      const prevHp = this.lastAnimalHp.get(a.id);

      if (prevHp !== undefined && sameArena) {
        if (prevHp > 0 && a.hp === 0) {
          this.playAnimalDeath(a.species, dist);
        } else if (a.hp < prevHp && a.hp > 0) {
          this.playAnimalHurt(a.species, dist);
        }
      }
      this.lastAnimalHp.set(a.id, a.hp);

      if (sameArena && a.hp > 0 && dist < closestDist) {
        closestDist = dist;
        closestAnimal = a;
      }
    }

    if (closestAnimal && closestDist < 15) {
      this.playAnimalAmbient(closestAnimal.species, closestDist);
    }
  }
}
