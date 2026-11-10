import {
  BRICK_DUNGEON,
  GRAFFITI_MURAL,
  TEAM,
  TOOL,
  formatIndianTime,
  getDungeonFloorNumber,
  type ArcadeStateBroadcast,
  type DungeonActionType,
  type TeamId,
  type ToolId,
} from "@vi/shared";
import type { TimeMode } from "../world/scene";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const TRIVIA_QUESTIONS: Array<{ q: string; options: [string, string, string, string]; answerIdx: number }> = [
  {
    q: "Which planet in our solar system is known for having the most extensive ring system?",
    options: ["Mars", "Saturn", "Venus", "Mercury"],
    answerIdx: 1,
  },
  {
    q: "In WebGL / Three.js, which axis typically points straight UP in default world space?",
    options: ["X-Axis", "Y-Axis", "Z-Axis", "W-Axis"],
    answerIdx: 1,
  },
  {
    q: "What is the standard time offset of Indian Standard Time (IST) from UTC?",
    options: ["UTC +4:00", "UTC +5:00", "UTC +5:30", "UTC +6:00"],
    answerIdx: 2,
  },
  {
    q: "How many players are on the field for one standard football (soccer) team?",
    options: ["9 Players", "10 Players", "11 Players", "12 Players"],
    answerIdx: 2,
  },
  {
    q: "Which browser technology powers direct peer-to-peer proximity voice in Virtual Interact?",
    options: ["WebRTC", "LocalStorage", "IndexedDB", "WebSQL"],
    answerIdx: 0,
  },
  {
    q: "What are the 3 elemental floor themes leading up to the 3-Faced Dire Wolf Boss?",
    options: ["Earth, Wind & Water", "Ice (Floor 1), Fire (Floor 2) & Shadow (Floor 3)", "Gold, Silver & Bronze", "Sun, Moon & Stars"],
    answerIdx: 1,
  },
  {
    q: "In the Ruins of the King's Tomb, how many of the 3 ornate chests are actually Mimics?",
    options: ["None of them", "2 out of 3 (99% Mimic detector lie!)", "All 3", "Only 1"],
    answerIdx: 1,
  },
];

/**
 * Minimal, clean controller for:
 * 1. Top HUD Indian Standard Time (IST) & Day/Sunset/Night Cycle Switcher
 * 2. Compact Context Action Bar (only visible when standing in an activity zone)
 * 3. Shared Pixel Graffiti Mural Painter Modal (opened with E near the Mural)
 * 4. East Multiplayer Arcade Modal (opened with E inside the Arcade)
 */
export class ActivitiesController {
  private timeBtn = el<HTMLButtonElement>("time-mode-btn");

  private activityBar = el<HTMLDivElement>("activity-bar");
  private activityActionsEl = el<HTMLDivElement>("activity-actions");

  // Graffiti Pixel Mural Modal
  private muralModal = el<HTMLDivElement>("mural-modal");
  private muralClose = el<HTMLButtonElement>("mural-close");
  private muralPaletteEl = el<HTMLDivElement>("mural-palette");
  private muralCanvas = el<HTMLCanvasElement>("mural-editor-canvas");
  private muralClearBtn = el<HTMLButtonElement>("mural-clear-btn");
  private selectedColorIdx = 2;
  private paintingMural = false;

  // Multiplayer Arcade Modal
  private arcadeModal = el<HTMLDivElement>("arcade-modal");
  private arcadeClose = el<HTMLButtonElement>("arcade-close");
  private arcadeTabs = el<HTMLElement>("arcade-tabs");
  private c4Container = el<HTMLDivElement>("arcade-c4");
  private tttContainer = el<HTMLDivElement>("arcade-ttt");
  private triviaContainer = el<HTMLDivElement>("arcade-trivia");
  private activeArcadeTab: "c4" | "ttt" | "trivia" = "c4";
  private lastArcadeState: ArcadeStateBroadcast = {
    c4Board: new Array(42).fill(0),
    c4Turn: 1,
    c4Winner: 0,
    tttBoard: new Array(9).fill(0),
    tttTurn: 1,
    tttWinner: 0,
    triviaIdx: 0,
    triviaScores: {},
  };

  onTimeModeChange: (mode: TimeMode) => void = () => {};
  onPaintPixel: (x: number, y: number, colorIdx: number) => void = () => {};
  onClearMural: () => void = () => {};
  onFootballTeam: (team: TeamId) => void = () => {};
  onFootballKick: () => void = () => {};
  onFootballReset: () => void = () => {};
  onArcadeMove: (game: "c4" | "ttt" | "trivia", colOrCell: number) => void = () => {};
  onArcadeReset: (game: "c4" | "ttt") => void = () => {};
  onEquipTool: (tool: ToolId) => void = () => {};
  onAttackNearestAnimal: () => void = () => {};
  onForageBerry: () => void = () => {};
  onCookMeat: () => void = () => {};
  onEatMeat: () => void = () => {};
  onSitCampfire: () => void = () => {};
  onDungeonAction: (action: DungeonActionType) => void = () => {};
  onOpenMuralChange: (open: boolean) => void = () => {};

  private currentMode: TimeMode = "ist";

  constructor(private readonly worldMuralCanvas: HTMLCanvasElement) {
    this.buildMuralEditor();
    this.bindArcadeEvents();

    this.timeBtn.addEventListener("click", () => {
      const order: TimeMode[] = ["ist", "night", "sunset", "day"];
      const next = order[(order.indexOf(this.currentMode) + 1) % order.length]!;
      this.currentMode = next;
      this.onTimeModeChange(next);
      this.updateTimeButtonLabel();
    });
    this.updateTimeButtonLabel();
  }

  get isModalOpen(): boolean {
    return !this.muralModal.hidden || !this.arcadeModal.hidden;
  }

  updateTimeButtonLabel() {
    const istStr = formatIndianTime();
    let icon = "🇮🇳";
    let text = istStr;
    if (this.currentMode === "night") {
      icon = "🌙";
      text = "Night";
    } else if (this.currentMode === "sunset") {
      icon = "🌅";
      text = "Sunset";
    } else if (this.currentMode === "day") {
      icon = "☀️";
      text = "Day";
    }
    this.timeBtn.innerHTML = `<span class="hud-chip-icon">${icon}</span> <span class="hud-btn-label">${text}</span>`;
  }

  private buildMuralEditor() {
    this.muralPaletteEl.innerHTML = "";
    GRAFFITI_MURAL.palette.forEach((hex, idx) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "swatch" + (idx === this.selectedColorIdx ? " selected" : "");
      sw.style.background = hex;
      sw.addEventListener("click", () => {
        this.selectedColorIdx = idx;
        this.muralPaletteEl.querySelectorAll(".swatch").forEach((s, i) => s.classList.toggle("selected", i === idx));
      });
      this.muralPaletteEl.appendChild(sw);
    });

    const paintFromEvent = (e: PointerEvent) => {
      const rect = this.muralCanvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const gx = Math.floor(((e.clientX - rect.left) / rect.width) * GRAFFITI_MURAL.width);
      const gy = Math.floor(((e.clientY - rect.top) / rect.height) * GRAFFITI_MURAL.height);
      if (gx >= 0 && gx < GRAFFITI_MURAL.width && gy >= 0 && gy < GRAFFITI_MURAL.height) {
        this.onPaintPixel(gx, gy, this.selectedColorIdx);
      }
    };

    this.muralCanvas.addEventListener("pointerdown", (e) => {
      this.paintingMural = true;
      paintFromEvent(e);
    });
    this.muralCanvas.addEventListener("pointermove", (e) => {
      if (this.paintingMural) paintFromEvent(e);
    });
    window.addEventListener("pointerup", () => {
      this.paintingMural = false;
    });

    this.muralClearBtn.addEventListener("click", () => this.onClearMural());
    this.muralClose.addEventListener("click", () => this.closeMuralModal());
    this.muralModal.addEventListener("click", (e) => {
      if (e.target === this.muralModal) this.closeMuralModal();
    });
  }

  refreshMuralEditorCanvas() {
    const ctx = this.muralCanvas.getContext("2d")!;
    ctx.drawImage(this.worldMuralCanvas, 0, 0, this.muralCanvas.width, this.muralCanvas.height);
  }

  openMuralModal() {
    this.refreshMuralEditorCanvas();
    this.muralModal.hidden = false;
    this.onOpenMuralChange(true);
  }

  closeMuralModal() {
    this.muralModal.hidden = true;
    this.onOpenMuralChange(!this.arcadeModal.hidden);
  }

  private bindArcadeEvents() {
    this.arcadeClose.addEventListener("click", () => this.closeArcadeModal());
    this.arcadeModal.addEventListener("click", (e) => {
      if (e.target === this.arcadeModal) this.closeArcadeModal();
    });
    this.arcadeTabs.querySelectorAll<HTMLButtonElement>("button[data-game]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.activeArcadeTab = (btn.dataset.game as "c4" | "ttt" | "trivia") ?? "c4";
        this.arcadeTabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
        this.renderArcade();
      });
    });
  }

  openArcadeModal() {
    this.renderArcade();
    this.arcadeModal.hidden = false;
    this.onOpenMuralChange(true);
  }

  closeArcadeModal() {
    this.arcadeModal.hidden = true;
    this.onOpenMuralChange(!this.muralModal.hidden);
  }

  setArcadeState(state: ArcadeStateBroadcast) {
    this.lastArcadeState = state;
    if (!this.arcadeModal.hidden) this.renderArcade();
  }

  private renderArcade() {
    this.c4Container.hidden = this.activeArcadeTab !== "c4";
    this.tttContainer.hidden = this.activeArcadeTab !== "ttt";
    this.triviaContainer.hidden = this.activeArcadeTab !== "trivia";

    const st = this.lastArcadeState;

    if (this.activeArcadeTab === "c4") {
      this.c4Container.innerHTML = "";
      const status = document.createElement("div");
      status.className = "arcade-status";
      status.textContent =
        st.c4Winner === 1
          ? "🔴 Red Wins!"
          : st.c4Winner === 2
            ? "🟡 Yellow Wins!"
            : st.c4Winner === 3
              ? "🤝 Draw!"
              : st.c4Turn === 1
                ? "Turn: 🔴 Red"
                : "Turn: 🟡 Yellow";

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dock-btn";
      resetBtn.textContent = "New Game";
      resetBtn.addEventListener("click", () => this.onArcadeReset("c4"));
      status.appendChild(resetBtn);
      this.c4Container.appendChild(status);

      const grid = document.createElement("div");
      grid.className = "c4-grid";
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          const val = st.c4Board[r * 7 + c] ?? 0;
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "c4-cell" + (val === 1 ? " red" : val === 2 ? " yellow" : "");
          cell.addEventListener("click", () => this.onArcadeMove("c4", c));
          grid.appendChild(cell);
        }
      }
      this.c4Container.appendChild(grid);
    } else if (this.activeArcadeTab === "ttt") {
      this.tttContainer.innerHTML = "";
      const status = document.createElement("div");
      status.className = "arcade-status";
      status.textContent =
        st.tttWinner === 1
          ? "❌ X Wins!"
          : st.tttWinner === 2
            ? "⭕ O Wins!"
            : st.tttWinner === 3
              ? "🤝 Draw!"
              : st.tttTurn === 1
                ? "Turn: ❌ X"
                : "Turn: ⭕ O";

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dock-btn";
      resetBtn.textContent = "New Game";
      resetBtn.addEventListener("click", () => this.onArcadeReset("ttt"));
      status.appendChild(resetBtn);
      this.tttContainer.appendChild(status);

      const grid = document.createElement("div");
      grid.className = "ttt-grid";
      for (let i = 0; i < 9; i++) {
        const val = st.tttBoard[i] ?? 0;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ttt-cell";
        cell.textContent = val === 1 ? "❌" : val === 2 ? "⭕" : "";
        cell.addEventListener("click", () => this.onArcadeMove("ttt", i));
        grid.appendChild(cell);
      }
      this.tttContainer.appendChild(grid);
    } else {
      this.triviaContainer.innerHTML = "";
      const qObj = TRIVIA_QUESTIONS[st.triviaIdx % TRIVIA_QUESTIONS.length]!;
      const card = document.createElement("div");
      card.className = "trivia-card";
      const h3 = document.createElement("h3");
      h3.textContent = `Q#${(st.triviaIdx % TRIVIA_QUESTIONS.length) + 1}: ${qObj.q}`;
      card.appendChild(h3);

      const opts = document.createElement("div");
      opts.className = "trivia-options";
      qObj.options.forEach((optText, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dock-btn";
        btn.textContent = optText;
        btn.addEventListener("click", () => {
          if (idx === qObj.answerIdx) {
            this.onArcadeMove("trivia", 1);
          } else {
            btn.textContent = `${optText} ✗`;
            btn.disabled = true;
          }
        });
        opts.appendChild(btn);
      });
      card.appendChild(opts);

      const scoresEl = document.createElement("div");
      scoresEl.className = "trivia-scores";
      const entries = Object.entries(st.triviaScores).sort((a, b) => b[1] - a[1]);
      scoresEl.textContent =
        entries.length > 0
          ? `Leaderboard: ${entries.map(([k, v]) => `${k} (${v})`).join(" · ")}`
          : "First correct answer scores +10 pts!";
      card.appendChild(scoresEl);
      this.triviaContainer.appendChild(card);
    }
  }

  /**
   * Shows a compact context button bar when the player is inside one of the
   * activity zones (Mural, Football, Arcade, Campfire/Forest, or the 4-Floor Brick Dungeon).
   */
  updateContextBar(opts: {
    tool: ToolId;
    team: TeamId;
    rawMeat: number;
    cookedMeat: number;
    energy: number;
    isSeated: boolean;
    onOpenMic: boolean;
    nearMural: boolean;
    inFootball: boolean;
    inArcade: boolean;
    inCampfire: boolean;
    inForest: boolean;
    inDungeon: boolean;
    playerX: number;
    playerZ: number;
    dungeonWing: number;
    grimoireFound: number;
    websBurned: number;
    bossHp: number;
    mimicTrapped: number;
    anyPeerMimicTrapped: boolean;
    isNight: boolean;
  }) {
    const activeZone =
      opts.nearMural ||
      opts.onOpenMic ||
      opts.inFootball ||
      opts.inArcade ||
      opts.inCampfire ||
      opts.inForest ||
      opts.inDungeon;
    if (!activeZone) {
      this.activityBar.hidden = true;
      return;
    }

    const floorNum = getDungeonFloorNumber(opts.playerX, opts.playerZ);
    const f1Stage =
      floorNum !== 1
        ? 0
        : opts.playerZ < BRICK_DUNGEON.mimicRoomStartZ
          ? 1
          : 2;

    const key = [
      opts.tool,
      opts.team,
      opts.rawMeat,
      opts.cookedMeat,
      opts.isSeated ? 1 : 0,
      opts.onOpenMic ? 1 : 0,
      opts.nearMural ? 1 : 0,
      opts.inFootball ? 1 : 0,
      opts.inArcade ? 1 : 0,
      opts.inCampfire ? 1 : 0,
      opts.inForest ? 1 : 0,
      floorNum,
      f1Stage,
      opts.dungeonWing,
      opts.grimoireFound,
      opts.websBurned,
      opts.bossHp > 0 ? 1 : 0,
      opts.mimicTrapped,
      opts.anyPeerMimicTrapped ? 1 : 0,
    ].join(":");

    if (this.activityActionsEl.dataset.key === key) {
      this.activityBar.hidden = false;
      return;
    }
    this.activityActionsEl.dataset.key = key;
    this.activityActionsEl.innerHTML = "";

    const addBtn = (label: string, cls: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `dock-btn ${cls}`;
      b.textContent = label;
      b.addEventListener("click", onClick);
      this.activityActionsEl.appendChild(b);
    };

    if (opts.nearMural) {
      addBtn("🎨 Paint Mural (E)", "accent", () => this.openMuralModal());
    }

    if (opts.onOpenMic) {
      addBtn("🎤 On Stage · Mic Amplified", "primary active", () => {});
    }

    if (opts.inFootball) {
      addBtn("⚽ Kick (Space)", "accent", () => this.onFootballKick());
      addBtn(opts.team === TEAM.red ? "🔴 Red Team ✓" : "🔴 Join Red", opts.team === TEAM.red ? "accent" : "", () =>
        this.onFootballTeam(TEAM.red),
      );
      addBtn(opts.team === TEAM.blue ? "🔵 Blue Team ✓" : "🔵 Join Blue", opts.team === TEAM.blue ? "accent" : "", () =>
        this.onFootballTeam(TEAM.blue),
      );
      addBtn("Reset Score", "", () => this.onFootballReset());
    }

    if (opts.inArcade) {
      addBtn("🕹️ Play Arcade (E)", "accent", () => this.openArcadeModal());
    }

    if (opts.inDungeon) {
      if (opts.mimicTrapped > 0) {
        addBtn("🦵 Struggle Free from Mimic! (Space)", "accent", () => this.onDungeonAction("struggle"));
      } else if (opts.anyPeerMimicTrapped) {
        addBtn("🤝 Pull Friend Out of Mimic! (E)", "accent", () => this.onDungeonAction("rescue"));
      }

      if (floorNum === 1) {
        if (f1Stage === 1) {
          addBtn(
            opts.dungeonWing === 1 ? "❄️ West Frost Wing ✓" : "❄️ Pull West Lever (E)",
            opts.dungeonWing === 1 ? "accent" : "primary",
            () => this.onDungeonAction("lever1"),
          );
          addBtn(
            opts.dungeonWing === 2 ? "❄️ East Frost Wing ✓" : "❄️ Pull East Lever (E)",
            opts.dungeonWing === 2 ? "accent" : "primary",
            () => this.onDungeonAction("lever2"),
          );
        } else if (opts.mimicTrapped === 0) {
          addBtn("📦 West Chest #1", "primary", () => this.onDungeonAction("chest1"));
          addBtn("📦 Center Chest #2", "primary", () => this.onDungeonAction("chest2"));
          addBtn("📦 East Chest #3", "primary", () => this.onDungeonAction("chest3"));
        }
      } else if (floorNum === 2) {
        if (opts.websBurned < 7) {
          addBtn("🔥🕸️ Burn Spiderweb (E)", "accent", () => this.onDungeonAction("burnWeb"));
        }
        addBtn("🕷️ Strike Spider (Space)", "primary", () => this.onAttackNearestAnimal());
      } else if (floorNum === 3) {
        addBtn("🧱 Press Loose Brick Switch (E)", "accent", () => this.onDungeonAction("switchL"));
        addBtn("🌑🐺 Fight Shadow Wolf (Space)", "primary", () => this.onAttackNearestAnimal());
      } else if (floorNum === 4) {
        if (opts.bossHp > 0) {
          addBtn(`⚔️🐺 Attack 3-Faced Wolf (${opts.bossHp} HP · Space)`, "accent", () => this.onAttackNearestAnimal());
        } else {
          addBtn("👑 Unlock Golden Royal Vault (E)", "accent", () => this.onDungeonAction("vault"));
        }
        addBtn("🌊 Waterfall Slide to Floor 1", "primary", () => this.onDungeonAction("escapeSlide"));
      }

      if (opts.cookedMeat > 0) {
        addBtn(`🍖 Eat Steak (${opts.cookedMeat})`, "primary active", () => this.onEatMeat());
      }
      addBtn(opts.tool === TOOL.torch ? "🔥 Torch ✓" : "🔥 Torch", opts.tool === TOOL.torch ? "accent" : "", () =>
        this.onEquipTool(opts.tool === TOOL.torch ? TOOL.none : TOOL.torch),
      );
      addBtn(opts.tool === TOOL.spear ? "🗡️ Spear ✓" : "🗡️ Spear", opts.tool === TOOL.spear ? "accent" : "", () =>
        this.onEquipTool(opts.tool === TOOL.spear ? TOOL.none : TOOL.spear),
      );
      addBtn(opts.tool === TOOL.bow ? "🏹 Bow ✓" : "🏹 Bow", opts.tool === TOOL.bow ? "accent" : "", () =>
        this.onEquipTool(opts.tool === TOOL.bow ? TOOL.none : TOOL.bow),
      );
    } else if (opts.inCampfire || opts.inForest) {
      if (opts.inCampfire) {
        addBtn(opts.isSeated ? "Stand Up (E)" : "Sit at Fire (E)", "primary", () => this.onSitCampfire());
        if (opts.rawMeat > 0) {
          addBtn(`🔥 Roast Meat (${opts.rawMeat})`, "accent", () => this.onCookMeat());
        }
      }
      if (opts.cookedMeat > 0) {
        addBtn(`🍖 Eat Steak (${opts.cookedMeat})`, "primary active", () => this.onEatMeat());
      }
      addBtn(opts.tool === TOOL.torch ? "🔥 Torch ✓" : "🔥 Torch", opts.tool === TOOL.torch ? "accent" : "", () =>
        this.onEquipTool(opts.tool === TOOL.torch ? TOOL.none : TOOL.torch),
      );
      addBtn(opts.tool === TOOL.spear ? "🗡️ Spear ✓" : "🗡️ Spear", opts.tool === TOOL.spear ? "accent" : "", () =>
        this.onEquipTool(opts.tool === TOOL.spear ? TOOL.none : TOOL.spear),
      );
      addBtn(opts.tool === TOOL.bow ? "🏹 Bow ✓" : "🏹 Bow", opts.tool === TOOL.bow ? "accent" : "", () =>
        this.onEquipTool(opts.tool === TOOL.bow ? TOOL.none : TOOL.bow),
      );
      if (opts.inForest) {
        addBtn("🏹 Hunt / Fight Snake (Space)", "accent", () => this.onAttackNearestAnimal());
      }
    }

    this.activityBar.hidden = false;
  }
}
