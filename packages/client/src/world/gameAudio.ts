import {
  CAMPFIRE_BASE,
  CINEMA_HALL,
  getDungeonFloorNumber,
  isInArcadeZone,
  isInBrickDungeon,
  isInCinemaHall,
  isInForestWilderness,
  type AnimalSpecies,
} from "@vi/shared";

export type AudioTheme =
  | "day"
  | "sunset"
  | "night"
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
 * Complete Procedural Web Audio Music & Sound Engine:
 * - Dynamic Day / Sunset / Night Theme Tones
 * - Ominous Multi-Stage Dungeon Themes (Floor 1 Ice, Floor 2 Fire, Floor 3 Shadow, Floor 4 Boss)
 * - Retro 8-bit Synth Chiptune in the East Arcade Plaza & Games
 * - Ambient Forest Insect Sounds (Daytime cicadas, Sunset/Night crickets)
 * - Animal Proximity Sounds & Distinct Wounded/Death Screeches
 * - Cinema Hall Audio Ducking
 */
export class GameAudio {
  private ctx: AudioContext | undefined;
  private masterGain: GainNode | undefined;
  private musicGain: GainNode | undefined;
  private sfxGain: GainNode | undefined;
  private ambientGain: GainNode | undefined;

  enabled = true;
  private currentTheme: AudioTheme = "day";
  private targetTheme: AudioTheme = "day";
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
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.linearRampToValueAtTime(this.enabled ? 0.65 : 0.0001, now + 0.15);
    }
    return this.enabled;
  }

  private ensureContext(): AudioContext | undefined {
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AudioCtx();

        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.enabled ? 0.65 : 0.0001;
        this.masterGain.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.42;
        this.musicGain.connect(this.masterGain);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.55;
        this.sfxGain.connect(this.masterGain);

        this.ambientGain = this.ctx.createGain();
        this.ambientGain.gain.value = 0.38;
        this.ambientGain.connect(this.masterGain);

        this.startMusicClock();
      } catch {
        return undefined;
      }
    }
    return this.ctx;
  }

  private startMusicClock() {
    if (this.themeStepTimer) clearInterval(this.themeStepTimer);
    if (this.ambientStepTimer) clearInterval(this.ambientStepTimer);

    // Musical step clock fires every ~320ms (roughly 8th notes at 94 BPM or 16th notes at 188 BPM)
    this.themeStepTimer = setInterval(() => {
      this.onMusicStep();
    }, 320);

    // Ambient insect & wind pulse clock fires every 600ms
    this.ambientStepTimer = setInterval(() => {
      this.onAmbientStep();
    }, 600);
  }

  // =========================================================================
  // MUSIC & THEME SEQUENCER
  // =========================================================================

  private onMusicStep() {
    if (!this.ctx || !this.enabled || !this.musicGain) return;
    if (this.currentTheme === "silent") return;

    const t = this.ctx.currentTime;
    const step = this.stepCount++;

    switch (this.currentTheme) {
      case "day":
        this.stepDayTheme(t, step);
        break;
      case "sunset":
        this.stepSunsetTheme(t, step);
        break;
      case "night":
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

  /**
   * Day Theme: Bright, peaceful pentatonic melody with acoustic sine/triangle tones.
   * Chords: Cmaj7 (C-E-G-B) -> Fmaj7 (F-A-C-E) -> G (G-B-D-F) -> Am (A-C-E-G).
   */
  private stepDayTheme(t: number, step: number) {
    const bar = Math.floor(step / 16) % 4;
    const sub = step % 16;

    // Warm gentle root & fifth bass pedal
    if (sub === 0) {
      const bassNotes = [130.81, 174.61, 196.0, 220.0]; // C3, F3, G3, A3
      this.playTone(bassNotes[bar]!, t, 2.2, "sine", 0.16, 0.2, 1.8);
      this.playTone(bassNotes[bar]! * 1.5, t + 0.1, 1.8, "triangle", 0.08, 0.3, 1.4);
    }

    // Melodic acoustic chime on selected beats (pentatonic major)
    const melodyMap: Record<number, number[]> = {
      0: [523.25, 659.25, 783.99, 987.77, 1046.5], // C5, E5, G5, B5, C6
      1: [698.46, 880.0, 1046.5, 1318.51], // F5, A5, C6, E6
      2: [783.99, 987.77, 1174.66, 1318.51], // G5, B5, D6, E6
      3: [880.0, 1046.5, 1318.51, 1567.98], // A5, C6, E6, G6
    };
    const notes = melodyMap[bar] ?? [523.25];

    if (sub % 4 === 0 || sub === 7 || sub === 11 || sub === 14) {
      const note = notes[(Math.floor(sub * 1.7) + bar) % notes.length]!;
      this.playChime(note, t, 0.85, 0.14);
    }

    // Occasional gentle distant bird chirping in daytime
    if (sub === 3 && Math.random() < 0.25) {
      this.playBirdChirp(t);
    }
  }

  /**
   * Sunset Theme: Warm, nostalgic golden-hour theme.
   * Rich mellow minor-7th / major-7th chords (Dm7 -> Bbmaj7 -> Fmaj7 -> C9).
   */
  private stepSunsetTheme(t: number, step: number) {
    const bar = Math.floor(step / 16) % 4;
    const sub = step % 16;

    // Slow, rich Rhodes-like pad swell
    if (sub === 0) {
      const roots = [146.83, 116.54, 174.61, 130.81]; // D3, Bb2, F3, C3
      const root = roots[bar]!;
      this.playTone(root, t, 3.8, "triangle", 0.2, 0.8, 2.6);
      this.playTone(root * 1.2, t + 0.05, 3.4, "sine", 0.14, 0.9, 2.3);
      this.playTone(root * 1.5, t + 0.1, 3.2, "sine", 0.12, 1.0, 2.0);
    }

    // Mellow evening bell notes
    if (sub === 2 || sub === 6 || sub === 10 || sub === 13) {
      const sunsetScales: Record<number, number[]> = {
        0: [587.33, 698.46, 880.0, 1046.5], // D5, F5, A5, C6
        1: [466.16, 587.33, 698.46, 880.0], // Bb4, D5, F5, A5
        2: [698.46, 880.0, 1046.5, 1318.51], // F5, A5, C6, E6
        3: [523.25, 659.25, 783.99, 1046.5], // C5, E5, G5, C6
      };
      const scale = sunsetScales[bar]!;
      const freq = scale[sub % scale.length]!;
      this.playWarmBell(freq, t, 1.4, 0.15);
    }
  }

  /**
   * Night Theme: Deep, ethereal nocturnal ambient drone with sparkling glass chimes.
   */
  private stepNightTheme(t: number, step: number) {
    const sub = step % 32;

    // Subterranean serene nocturnal drone
    if (sub === 0) {
      this.playTone(110.0, t, 8.5, "sine", 0.22, 1.4, 6.5); // A2
      this.playTone(164.81, t + 0.2, 8.0, "triangle", 0.14, 1.8, 5.8); // E3
      this.playTone(220.0, t + 0.4, 7.5, "sine", 0.1, 2.0, 5.0); // A3
    }

    // Distant, delicate crystal stars
    if (sub === 4 || sub === 12 || sub === 20 || sub === 27) {
      const nightBells = [880.0, 1046.5, 1318.51, 1567.98, 1760.0];
      const bell = nightBells[(sub * 3) % nightBells.length]!;
      this.playGlassChime(bell, t, 2.4, 0.11);
    }
  }

  /**
   * Arcade Theme: Upbeat 8-bit retro chiptune gaming music!
   * Fast, punchy square & triangle synth arpeggios at 132 BPM.
   */
  private stepArcadeTheme(t: number, step: number) {
    const sub = step % 16;
    const bar = Math.floor(step / 16) % 4;

    // Bouncy 8-bit chiptune bass
    const bassChords = [130.81, 164.81, 174.61, 196.0]; // C, E, F, G
    const root = bassChords[bar]!;
    if (sub % 2 === 0) {
      const octave = sub % 4 === 0 ? 1 : 2;
      this.playTone(root * octave, t, 0.15, "triangle", 0.26, 0.005, 0.12);
    }

    // High energetic 8-bit square arpeggio
    const arps = [
      [523.25, 659.25, 783.99, 1046.5],
      [659.25, 783.99, 987.77, 1318.51],
      [698.46, 880.0, 1046.5, 1396.91],
      [783.99, 987.77, 1174.66, 1567.98],
    ];
    const arp = arps[bar]!;
    const note = arp[sub % arp.length]!;
    this.playTone(note, t, 0.12, "square", 0.12, 0.008, 0.09);

    // Retro electronic snare tap
    if (sub === 4 || sub === 12) {
      this.playWhiteNoiseBurst(t, 0.07, 0.16, 2800, 1.8);
    }
  }

  /**
   * Dungeon Stage 1 (Floor 1: Ice Head - Frost Aqueduct):
   * Ominous, shivering crystalline wind, hollow echoing drips & dissonant minor 2nd bell chimes.
   */
  private stepDungeonIceTheme(t: number, step: number) {
    const sub = step % 24;

    // Shivering cold hollow drone
    if (sub === 0) {
      this.playTone(82.41, t, 6.5, "sine", 0.24, 1.2, 4.8); // E2
      this.playTone(123.47, t + 0.3, 5.8, "triangle", 0.12, 1.6, 4.0); // B2
    }

    // Icy minor 2nd bell dissonances (E, F, Bb, B)
    if (sub === 3 || sub === 9 || sub === 16 || sub === 21) {
      const iceBells = [659.25, 698.46, 932.33, 987.77, 1318.51, 1396.91];
      const freq = iceBells[sub % iceBells.length]!;
      this.playGlassChime(freq, t, 2.8, 0.14);
    }

    // Echoing water cavern drip
    if (sub === 7 || sub === 18) {
      this.playWaterDrip(t);
    }
  }

  /**
   * Dungeon Stage 2 (Floor 2: Fire Head - Crimson Ember Hall):
   * Threatening, heavy volcanic rumbling drone with low saw ostinato and tension-building pulses.
   */
  private stepDungeonFireTheme(t: number, step: number) {
    const sub = step % 16;

    // Deep subterranean volcanic saw-wave rumble
    if (sub % 4 === 0) {
      const rumblers = [55.0, 58.27, 65.41, 73.42]; // A1, Bb1, C2, D2
      const root = rumblers[Math.floor(sub / 4)]!;
      this.playTone(root, t, 1.2, "sawtooth", 0.22, 0.1, 0.95);
    }

    // Pulsing dark brass horns
    if (sub === 0 || sub === 6 || sub === 10) {
      this.playLowBrassStab(110.0, t, 0.75, 0.2);
    }

    // Crackling ember sparks
    if (Math.random() < 0.4) {
      this.playWhiteNoiseBurst(t, 0.04, 0.09, 3600, 3.2);
    }
  }

  /**
   * Dungeon Stage 3 (Floor 3: Shadow Head - Bottomless Chasm):
   * Creeping subterranean horror, 42 Hz sub-bass, tritone sweeps and dark bowed strings.
   */
  private stepDungeonShadowTheme(t: number, step: number) {
    const sub = step % 24;

    // 42 Hz abyssal sub-bass thrum
    if (sub === 0) {
      this.playTone(43.65, t, 7.2, "sine", 0.32, 1.5, 5.2); // F1
      this.playTone(61.74, t + 0.4, 6.5, "sawtooth", 0.14, 2.0, 4.2); // B1 (Tritone dread!)
    }

    // Dissonant shadow sweeps
    if (sub === 6 || sub === 14 || sub === 19) {
      const shadowFreqs = [174.61, 246.94, 349.23, 493.88]; // F3, B3, F4, B4
      const f = shadowFreqs[sub % shadowFreqs.length]!;
      this.playBowedShadowTone(f, t, 3.0, 0.16);
    }
  }

  /**
   * Dungeon Stage 4 (Floor 4: 3-Faced Dire Wolf Boss Sanctum):
   * Pounding cinematic boss battle theme! Tribal war drums, driving bass and dramatic brass stabs!
   */
  private stepDungeonBossTheme(t: number, step: number) {
    const sub = step % 16;
    const bar = Math.floor(step / 16) % 4;

    // Heavy tribal war drum (booming kick on 0, 3, 6, 8, 11, 14)
    if (sub === 0 || sub === 3 || sub === 6 || sub === 8 || sub === 11 || sub === 14) {
      this.playWarDrum(t, sub === 0 || sub === 8 ? 0.38 : 0.26);
    }

    // Driving minor ostinato bassline
    const bassline = [73.42, 82.41, 87.31, 98.0]; // D2, E2, F2, G2
    this.playTone(bassline[bar]!, t, 0.28, "sawtooth", 0.24, 0.02, 0.22);

    // Dramatic brass battle stabs on climax beats
    if (sub === 0 || sub === 6 || sub === 12) {
      const brassChords = [146.83, 174.61, 220.0]; // D3, F3, A3
      brassChords.forEach((bf) => this.playLowBrassStab(bf, t, 0.6, 0.18));
    }
  }

  // =========================================================================
  // AMBIENT NATURE & FOREST INSECT SOUNDS
  // =========================================================================

  private onAmbientStep() {
    if (!this.ctx || !this.enabled || !this.ambientGain) return;
    const t = this.ctx.currentTime;

    // Forest cricket & cicada chorus at sunset & night
    if (this.currentTheme === "night" || this.currentTheme === "sunset") {
      this.playCricketChirp(t);
    } else if (this.currentTheme === "day" && Math.random() < 0.45) {
      // Warm midday cicada hum
      this.playCicadaHum(t);
    }
  }

  private playCricketChirp(t: number) {
    if (!this.ctx || !this.ambientGain) return;
    const count = 3 + Math.floor(Math.random() * 3);
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
      g.gain.linearRampToValueAtTime(0.045, st + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.045);

      osc.connect(bp).connect(g).connect(this.ambientGain);
      osc.start(st);
      osc.stop(st + 0.05);
    }
  }

  private playCicadaHum(t: number) {
    if (!this.ctx || !this.ambientGain) return;
    const dur = 0.55 + Math.random() * 0.35;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(3800 + Math.random() * 500, t);
    osc.frequency.linearRampToValueAtTime(4200, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.ambientGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playBirdChirp(t: number) {
    if (!this.ctx || !this.ambientGain) return;
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

    osc.connect(g).connect(this.ambientGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private playWaterDrip(t: number) {
    if (!this.ctx || !this.musicGain) return;
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

    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // =========================================================================
  // ANIMAL AMBIENT & DEATH SOUNDS
  // =========================================================================

  /**
   * Plays a distinct spatial death screech/whimper when an animal's HP reaches 0!
   */
  playAnimalDeath(species: string, distance: number) {
    this.ensureContext();
    if (!this.ctx || !this.enabled || !this.sfxGain) return;

    // Attenuate volume smoothly based on distance from player
    const distGain = Math.max(0.05, Math.min(1.0, 1 - distance / 40));
    const t = this.ctx.currentTime;

    switch (species) {
      case "rabbit":
        // High-pitched distress squeak
        this.playPitchSweep(1800, 750, 0.22, "sine", 0.32 * distGain, t);
        break;

      case "deer":
        // Low wounded bleat / groan
        this.playPitchSweep(360, 180, 0.45, "triangle", 0.38 * distGain, t);
        this.playPitchSweep(240, 110, 0.5, "sawtooth", 0.22 * distGain, t + 0.05);
        break;

      case "boar":
        // Loud, furious pig squeal
        this.playBoarSqueal(t, distGain);
        break;

      case "wolf":
      case "shadow_wolf":
        // Canine yelp & dying whimper
        this.playWolfYelp(t, distGain, species === "shadow_wolf");
        break;

      case "snake":
        // Sharp venomous death rattle & thrashing hiss
        this.playSnakeHiss(t, distGain);
        break;

      case "spider":
        // Wet crunchy chitin crunch & dying screech
        this.playSpiderSquish(t, distGain);
        break;

      case "cerberus":
        // Thunderous, multi-frequency earth-shaking defeat roar of the 3-Faced Dire Wolf!
        this.playCerberusDeathRoar(t, distGain);
        break;
    }
  }

  /**
   * Plays a quick hurt flinch sound when an animal is struck.
   */
  playAnimalHurt(species: string, distance: number) {
    this.ensureContext();
    if (!this.ctx || !this.enabled || !this.sfxGain) return;
    const distGain = Math.max(0.05, Math.min(1.0, 1 - distance / 35));
    const t = this.ctx.currentTime;

    if (species === "cerberus") {
      this.playPitchSweep(160, 90, 0.4, "sawtooth", 0.45 * distGain, t);
      this.playWhiteNoiseBurst(t, 0.25, 0.3 * distGain, 550, 2.0);
    } else if (species === "boar") {
      this.playPitchSweep(620, 310, 0.18, "sawtooth", 0.3 * distGain, t);
    } else if (species === "spider") {
      this.playWhiteNoiseBurst(t, 0.12, 0.25 * distGain, 2400, 2.5);
    } else {
      this.playPitchSweep(580, 220, 0.16, "triangle", 0.25 * distGain, t);
    }
  }

  /**
   * Plays occasional living ambient noise when player is close to a species.
   */
  playAnimalAmbient(species: string, distance: number) {
    this.ensureContext();
    if (!this.ctx || !this.enabled || !this.sfxGain) return;
    const now = Date.now();
    if (now - this.lastAmbientAnimalSoundTime < 4500) return;
    this.lastAmbientAnimalSoundTime = now;

    const distGain = Math.max(0.05, Math.min(1.0, 1 - distance / 22));
    const t = this.ctx.currentTime;

    switch (species) {
      case "rabbit":
        this.playWhiteNoiseBurst(t, 0.08, 0.1 * distGain, 3200, 1.2);
        break;
      case "deer":
        this.playPitchSweep(280, 220, 0.35, "sine", 0.16 * distGain, t);
        break;
      case "boar":
        this.playPitchSweep(180, 130, 0.22, "sawtooth", 0.18 * distGain, t);
        break;
      case "wolf":
      case "shadow_wolf":
        // Distant mournful howl
        this.playWolfHowl(t, distGain);
        break;
      case "snake":
        // Sibilant hiss
        this.playWhiteNoiseBurst(t, 0.28, 0.15 * distGain, 4800, 2.8);
        break;
      case "spider":
        // Rapid chitin clicks
        for (let i = 0; i < 4; i++) {
          this.playWhiteNoiseBurst(t + i * 0.045, 0.025, 0.14 * distGain, 3800, 3.2);
        }
        break;
      case "cerberus":
        // Deep menacing 3-headed growl
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
    if (!this.ctx || !this.sfxGain) return;
    const dur = 1.8;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.linearRampToValueAtTime(620, t + 0.5);
    osc.frequency.linearRampToValueAtTime(580, t + 1.2);
    osc.frequency.exponentialRampToValueAtTime(260, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.25 * vol, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playSnakeHiss(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    // Layer 1: Sibilant dying hiss
    this.playWhiteNoiseBurst(t, 0.45, 0.32 * vol, 5200, 2.2);
    // Layer 2: Fast thrashing rattles
    for (let i = 0; i < 6; i++) {
      this.playWhiteNoiseBurst(t + i * 0.05, 0.03, 0.22 * vol, 6800, 3.8);
    }
  }

  private playSpiderSquish(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    // Chitin crack + wet squish
    this.playPitchSweep(1200, 240, 0.18, "sawtooth", 0.35 * vol, t);
    this.playWhiteNoiseBurst(t, 0.22, 0.3 * vol, 1800, 1.2);
  }

  private playCerberusDeathRoar(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    const dur = 2.4;

    // 3 Harmonized heads roaring in agony (Low, Mid, High frequencies)
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
      osc.frequency.linearRampToValueAtTime(f.peak, st + 0.5);
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

    // Heavy earth-shattering roar noise blast
    this.playWhiteNoiseBurst(t, 1.8, 0.42 * vol, 450, 1.5);
  }

  private playCerberusGrowl(t: number, vol: number) {
    if (!this.ctx || !this.sfxGain) return;
    const dur = 1.4;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(75, t);
    osc.frequency.linearRampToValueAtTime(95, t + 0.6);
    osc.frequency.linearRampToValueAtTime(55, t + dur);

    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 350;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28 * vol, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---- Synthesis Primitives ------------------------------------------------

  private playTone(
    freq: number,
    t: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    attack = 0.02,
    release = 0.2,
  ) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + release);
  }

  private playChime(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private playWarmBell(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
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

    osc.connect(f).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private playGlassChime(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private playLowBrassStab(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
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

    osc.connect(f).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playBowedShadowTone(freq: number, t: number, dur: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, t);

    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.Q.value = 2.0;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(f).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private playWarDrum(t: number, vol: number) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.24);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private playPitchSweep(
    startFreq: number,
    endFreq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    t: number,
  ) {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private playWhiteNoiseBurst(t: number, dur: number, vol: number, freq: number, q: number) {
    if (!this.ctx) return;
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

    src.connect(f).connect(g).connect(this.sfxGain ?? this.ctx.destination);
    src.start(t);
  }

  // =========================================================================
  // FRAME UPDATE & SPATIAL DUCKING
  // =========================================================================

  update(opts: {
    playerX: number;
    playerZ: number;
    isNight: boolean;
    timeMode: string;
    inCinema: boolean;
    moviePlaying: boolean;
    inArcadeModal: boolean;
    animals: AnimalSoundState[];
  }) {
    if (!this.enabled) return;

    // 1. Determine target theme based on player zone & environment
    let nextTheme: AudioTheme = "day";

    if (opts.inCinema && opts.moviePlaying) {
      // Duck all game music completely when watching cinema video
      nextTheme = "silent";
    } else if (isInBrickDungeon(opts.playerX, opts.playerZ)) {
      const floor = getDungeonFloorNumber(opts.playerX, opts.playerZ);
      if (floor === 1) nextTheme = "dungeon_ice";
      else if (floor === 2) nextTheme = "dungeon_fire";
      else if (floor === 3) nextTheme = "dungeon_shadow";
      else nextTheme = "dungeon_boss";
    } else if (isInArcadeZone(opts.playerX, opts.playerZ) || opts.inArcadeModal) {
      nextTheme = "arcade";
    } else {
      // Open World / Hub / Forest
      if (opts.timeMode === "night" || opts.isNight) {
        nextTheme = "night";
      } else if (opts.timeMode === "sunset") {
        nextTheme = "sunset";
      } else {
        nextTheme = "day";
      }
    }

    if (nextTheme !== this.currentTheme) {
      this.currentTheme = nextTheme;
    }

    // 2. Track animal HP transitions to trigger death / hurt sounds
    let closestAnimal: AnimalSoundState | undefined;
    let closestDist = Infinity;

    for (const a of opts.animals) {
      const dist = Math.hypot(a.x - opts.playerX, a.z - opts.playerZ);
      const prevHp = this.lastAnimalHp.get(a.id);

      if (prevHp !== undefined) {
        if (prevHp > 0 && a.hp === 0) {
          // Animal died!
          this.playAnimalDeath(a.species, dist);
        } else if (a.hp < prevHp && a.hp > 0) {
          // Animal was hurt!
          this.playAnimalHurt(a.species, dist);
        }
      }
      this.lastAnimalHp.set(a.id, a.hp);

      if (a.hp > 0 && dist < closestDist) {
        closestDist = dist;
        closestAnimal = a;
      }
    }

    // 3. Play subtle ambient animal sound if standing close to a creature
    if (closestAnimal && closestDist < 16) {
      this.playAnimalAmbient(closestAnimal.species, closestDist);
    }
  }
}
