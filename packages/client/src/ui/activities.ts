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
import {
  CHESS_GLYPHS,
  applyChessMove,
  checkC4Winner,
  checkTttWinner,
  createInitialChessBoard,
  dropC4Piece,
  isKingInCheck,
  legalChessMoves,
  pickC4BotMove,
  pickChessBotMove,
  pickTttBotMove,
  type ChessColor,
  type ChessMove,
  type ChessPiece,
} from "./arcadeBot";

export type ArcadeGameTab = "ttt" | "chess" | "c4" | "trivia";

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
    q: "What are the 3 elemental floor themes leading down to the 3-Faced Dire Wolf Boss?",
    options: ["Earth, Wind & Water", "Ice (Depth 1), Fire (Depth 2) & Shadow (Depth 3)", "Gold, Silver & Bronze", "Sun, Moon & Stars"],
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
 * 2. Compact Context Action Bar (visible in activity zones OR when near a non-friend player anywhere)
 * 3. Shared Pixel Graffiti Mural Painter Modal (opened with E near the Mural)
 * 4. East Multiplayer & Vs-Bot (🤖 Nova) Arcade Modal (Cut-Cross, Chess, Connect 4, Trivia)
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

  // Arcade Modal (Vs 🤖 Nova Bot + Multiplayer Room)
  private arcadeModal = el<HTMLDivElement>("arcade-modal");
  private arcadeClose = el<HTMLButtonElement>("arcade-close");
  private arcadeTabs = el<HTMLElement>("arcade-tabs");
  private arcadeModeBar = el<HTMLDivElement>("arcade-mode-bar");
  private arcadeModeBotBtn = el<HTMLButtonElement>("arcade-mode-bot");
  private arcadeModePvpBtn = el<HTMLButtonElement>("arcade-mode-pvp");
  private c4Container = el<HTMLDivElement>("arcade-c4");
  private tttContainer = el<HTMLDivElement>("arcade-ttt");
  private chessContainer = el<HTMLDivElement>("arcade-chess");
  private triviaContainer = el<HTMLDivElement>("arcade-trivia");
  private activeArcadeTab: ArcadeGameTab = "ttt";
  private vsBot = true;
  private botThinking = false;
  private botTimer: ReturnType<typeof setTimeout> | undefined;

  // Local Vs-Nova state for Cut-Cross, Connect 4, and Chess
  private botTttBoard: number[] = new Array(9).fill(0);
  private botTttTurn: 1 | 2 = 1;
  private botTttWinner: 0 | 1 | 2 | 3 = 0;

  private botC4Board: number[] = new Array(42).fill(0);
  private botC4Turn: 1 | 2 = 1;
  private botC4Winner: 0 | 1 | 2 | 3 = 0;

  private chessBoard: Array<ChessPiece | null> = createInitialChessBoard();
  private chessTurn: ChessColor = "w";
  private chessSelected: number | null = null;
  private chessLastMove: ChessMove | null = null;
  private chessStatus = "";

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
  onSendFriendRequest: (toSessionId: string) => void = () => {};
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
        this.activeArcadeTab = (btn.dataset.game as ArcadeGameTab) ?? "ttt";
        this.syncArcadeTabButtons();
        this.renderArcade();
      });
    });
    this.arcadeModeBotBtn.addEventListener("click", () => {
      this.vsBot = true;
      this.syncModeButtons();
      this.renderArcade();
    });
    this.arcadeModePvpBtn.addEventListener("click", () => {
      this.vsBot = false;
      this.syncModeButtons();
      this.renderArcade();
    });
  }

  private syncArcadeTabButtons() {
    this.arcadeTabs.querySelectorAll<HTMLButtonElement>("button[data-game]").forEach((b) => {
      b.classList.toggle("active", b.dataset.game === this.activeArcadeTab);
    });
  }

  private syncModeButtons() {
    this.arcadeModeBotBtn.classList.toggle("accent", this.vsBot);
    this.arcadeModePvpBtn.classList.toggle("accent", !this.vsBot);
  }

  openArcadeModal(tab?: ArcadeGameTab, vsBot?: boolean) {
    if (tab) this.activeArcadeTab = tab;
    if (vsBot !== undefined) this.vsBot = vsBot;
    this.syncArcadeTabButtons();
    this.syncModeButtons();
    this.renderArcade();
    this.arcadeModal.hidden = false;
    this.onOpenMuralChange(true);
  }

  closeArcadeModal() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botThinking = false;
    this.arcadeModal.hidden = true;
    this.onOpenMuralChange(!this.muralModal.hidden);
  }

  setArcadeState(state: ArcadeStateBroadcast) {
    this.lastArcadeState = state;
    if (!this.arcadeModal.hidden) this.renderArcade();
  }

  private resetBotTtt() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botThinking = false;
    this.botTttBoard.fill(0);
    this.botTttTurn = 1;
    this.botTttWinner = 0;
    this.renderArcade();
  }

  private playBotTttCell(idx: number) {
    if (this.botThinking || this.botTttWinner !== 0 || this.botTttBoard[idx] !== 0) return;
    this.botTttBoard[idx] = 1;
    this.botTttWinner = checkTttWinner(this.botTttBoard);
    if (this.botTttWinner !== 0) {
      this.renderArcade();
      return;
    }
    this.botTttTurn = 2;
    this.botThinking = true;
    this.renderArcade();
    this.botTimer = setTimeout(() => {
      const move = pickTttBotMove(this.botTttBoard, 2);
      if (move >= 0) {
        this.botTttBoard[move] = 2;
        this.botTttWinner = checkTttWinner(this.botTttBoard);
      }
      this.botTttTurn = 1;
      this.botThinking = false;
      this.renderArcade();
    }, 340);
  }

  private resetBotC4() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botThinking = false;
    this.botC4Board.fill(0);
    this.botC4Turn = 1;
    this.botC4Winner = 0;
    this.renderArcade();
  }

  private playBotC4Col(col: number) {
    if (this.botThinking || this.botC4Winner !== 0) return;
    const placed = dropC4Piece(this.botC4Board, col, 1);
    if (placed < 0) return;
    this.botC4Winner = checkC4Winner(this.botC4Board);
    if (this.botC4Winner !== 0) {
      this.renderArcade();
      return;
    }
    this.botC4Turn = 2;
    this.botThinking = true;
    this.renderArcade();
    this.botTimer = setTimeout(() => {
      const botCol = pickC4BotMove(this.botC4Board, 2);
      if (botCol >= 0) {
        dropC4Piece(this.botC4Board, botCol, 2);
        this.botC4Winner = checkC4Winner(this.botC4Board);
      }
      this.botC4Turn = 1;
      this.botThinking = false;
      this.renderArcade();
    }, 380);
  }

  private resetChess() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botThinking = false;
    this.chessBoard = createInitialChessBoard();
    this.chessTurn = "w";
    this.chessSelected = null;
    this.chessLastMove = null;
    this.chessStatus = "";
    this.renderArcade();
  }

  private clickChessSquare(sq: number) {
    if (this.botThinking || this.chessStatus.includes("Checkmate") || this.chessStatus.includes("Stalemate")) return;
    if (this.vsBot && this.chessTurn === "b") return;

    const legal = legalChessMoves(this.chessBoard, this.chessTurn);
    if (this.chessSelected !== null) {
      const chosen = legal.find((m) => m.from === this.chessSelected && m.to === sq);
      if (chosen) {
        this.executeChessMove(chosen);
        return;
      }
    }
    const piece = this.chessBoard[sq];
    if (piece && piece.c === this.chessTurn) {
      this.chessSelected = this.chessSelected === sq ? null : sq;
    } else {
      this.chessSelected = null;
    }
    this.renderArcade();
  }

  private executeChessMove(move: ChessMove) {
    this.chessBoard = applyChessMove(this.chessBoard, move);
    this.chessLastMove = move;
    this.chessSelected = null;
    this.chessTurn = this.chessTurn === "w" ? "b" : "w";

    const nextLegal = legalChessMoves(this.chessBoard, this.chessTurn);
    const inCheck = isKingInCheck(this.chessBoard, this.chessTurn);
    if (nextLegal.length === 0) {
      if (inCheck) {
        const winner = this.chessTurn === "w" ? (this.vsBot ? "🤖 Nova (Black)" : "Black") : "White (You)";
        this.chessStatus = `👑 Checkmate! ${winner} wins!`;
      } else {
        this.chessStatus = "🤝 Stalemate — Draw!";
      }
      this.renderArcade();
      return;
    }
    this.chessStatus = inCheck ? "⚠️ Check!" : "";
    this.renderArcade();

    if (this.vsBot && this.chessTurn === "b") {
      this.botThinking = true;
      this.renderArcade();
      this.botTimer = setTimeout(() => {
        const botMove = pickChessBotMove(this.chessBoard, "b");
        this.botThinking = false;
        if (botMove) {
          this.executeChessMove(botMove);
        } else {
          this.renderArcade();
        }
      }, 360);
    }
  }

  private renderArcade() {
    this.tttContainer.hidden = this.activeArcadeTab !== "ttt";
    this.chessContainer.hidden = this.activeArcadeTab !== "chess";
    this.c4Container.hidden = this.activeArcadeTab !== "c4";
    this.triviaContainer.hidden = this.activeArcadeTab !== "trivia";
    this.arcadeModeBar.hidden = this.activeArcadeTab === "trivia";

    const st = this.lastArcadeState;

    if (this.activeArcadeTab === "ttt") {
      this.tttContainer.innerHTML = "";
      const board = this.vsBot ? this.botTttBoard : st.tttBoard;
      const turn = this.vsBot ? this.botTttTurn : st.tttTurn;
      const winner = this.vsBot ? this.botTttWinner : st.tttWinner;

      const status = document.createElement("div");
      status.className = "arcade-status";
      status.textContent =
        winner === 1
          ? this.vsBot
            ? "🎉 You (❌) beat Nova!"
            : "❌ X Wins!"
          : winner === 2
            ? this.vsBot
              ? "🤖 Nova (⭕) Wins!"
              : "⭕ O Wins!"
            : winner === 3
              ? "🤝 Draw!"
              : this.botThinking
                ? "🤖 Nova is thinking…"
                : turn === 1
                  ? this.vsBot
                    ? "Your turn (❌)"
                    : "Turn: ❌ X"
                  : this.vsBot
                    ? "Nova's turn (⭕)"
                    : "Turn: ⭕ O";

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dock-btn";
      resetBtn.textContent = "New Game";
      resetBtn.addEventListener("click", () => (this.vsBot ? this.resetBotTtt() : this.onArcadeReset("ttt")));
      status.appendChild(resetBtn);
      this.tttContainer.appendChild(status);

      const grid = document.createElement("div");
      grid.className = "ttt-grid";
      for (let i = 0; i < 9; i++) {
        const val = board[i] ?? 0;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ttt-cell";
        cell.textContent = val === 1 ? "❌" : val === 2 ? "⭕" : "";
        cell.addEventListener("click", () => (this.vsBot ? this.playBotTttCell(i) : this.onArcadeMove("ttt", i)));
        grid.appendChild(cell);
      }
      this.tttContainer.appendChild(grid);
    } else if (this.activeArcadeTab === "chess") {
      this.chessContainer.innerHTML = "";
      const status = document.createElement("div");
      status.className = "arcade-status";
      if (this.chessStatus.includes("Checkmate") || this.chessStatus.includes("Stalemate")) {
        status.textContent = this.chessStatus;
      } else if (this.botThinking) {
        status.textContent = "🤖 Nova is thinking…";
      } else {
        const turnLabel =
          this.chessTurn === "w"
            ? this.vsBot
              ? "⬜ Your Turn (White)"
              : "⬜ White's Turn"
            : this.vsBot
              ? "⬛ Nova's Turn (Black)"
              : "⬛ Black's Turn";
        status.textContent = this.chessStatus ? `${turnLabel} · ${this.chessStatus}` : turnLabel;
      }

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dock-btn";
      resetBtn.textContent = "New Game";
      resetBtn.addEventListener("click", () => this.resetChess());
      status.appendChild(resetBtn);
      this.chessContainer.appendChild(status);

      const legalForSelected =
        this.chessSelected !== null
          ? legalChessMoves(this.chessBoard, this.chessTurn).filter((m) => m.from === this.chessSelected)
          : [];
      const targetMap = new Map<number, ChessMove>();
      for (const m of legalForSelected) targetMap.set(m.to, m);

      const grid = document.createElement("div");
      grid.className = "chess-grid";
      for (let sq = 0; sq < 64; sq++) {
        const r = Math.floor(sq / 8);
        const c = sq % 8;
        const btn = document.createElement("button");
        btn.type = "button";
        const isLight = (r + c) % 2 === 0;
        const moveTarget = targetMap.get(sq);
        const isLast = this.chessLastMove && (this.chessLastMove.from === sq || this.chessLastMove.to === sq);
        btn.className =
          "chess-sq " +
          (isLight ? "light" : "dark") +
          (this.chessSelected === sq ? " selected" : "") +
          (moveTarget ? (moveTarget.capture ? " capture" : " target") : "") +
          (isLast ? " last-move" : "");
        const p = this.chessBoard[sq];
        if (p) {
          const span = document.createElement("span");
          span.className = p.c === "w" ? "chess-piece-w" : "chess-piece-b";
          span.textContent = CHESS_GLYPHS[p.c][p.t];
          btn.appendChild(span);
        }
        btn.addEventListener("click", () => this.clickChessSquare(sq));
        grid.appendChild(btn);
      }
      this.chessContainer.appendChild(grid);
    } else if (this.activeArcadeTab === "c4") {
      this.c4Container.innerHTML = "";
      const board = this.vsBot ? this.botC4Board : st.c4Board;
      const turn = this.vsBot ? this.botC4Turn : st.c4Turn;
      const winner = this.vsBot ? this.botC4Winner : st.c4Winner;

      const status = document.createElement("div");
      status.className = "arcade-status";
      status.textContent =
        winner === 1
          ? this.vsBot
            ? "🎉 You (🔴) beat Nova!"
            : "🔴 Red Wins!"
          : winner === 2
            ? this.vsBot
              ? "🤖 Nova (🟡) Wins!"
              : "🟡 Yellow Wins!"
            : winner === 3
              ? "🤝 Draw!"
              : this.botThinking
                ? "🤖 Nova is thinking…"
                : turn === 1
                  ? this.vsBot
                    ? "Your turn (🔴)"
                    : "Turn: 🔴 Red"
                  : this.vsBot
                    ? "Nova's turn (🟡)"
                    : "Turn: 🟡 Yellow";

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "dock-btn";
      resetBtn.textContent = "New Game";
      resetBtn.addEventListener("click", () => (this.vsBot ? this.resetBotC4() : this.onArcadeReset("c4")));
      status.appendChild(resetBtn);
      this.c4Container.appendChild(status);

      const grid = document.createElement("div");
      grid.className = "c4-grid";
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          const val = board[r * 7 + c] ?? 0;
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "c4-cell" + (val === 1 ? " red" : val === 2 ? " yellow" : "");
          cell.addEventListener("click", () => (this.vsBot ? this.playBotC4Col(c) : this.onArcadeMove("c4", c)));
          grid.appendChild(cell);
        }
      }
      this.c4Container.appendChild(grid);
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
   * activity zones OR standing near any non-friend player anywhere in the world.
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
    nearbyStranger?: { sessionId: string; name: string };
  }) {
    const activeZone =
      Boolean(opts.nearbyStranger) ||
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
      opts.nearbyStranger?.sessionId ?? "",
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

    if (opts.nearbyStranger) {
      const target = opts.nearbyStranger;
      addBtn(`👋 + Add Friend: ${target.name}`, "accent", () => this.onSendFriendRequest(target.sessionId));
    }

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
      addBtn("♟️ Chess vs Nova", "primary", () => this.openArcadeModal("chess", true));
      addBtn("❌⭕ Cut-Cross vs Nova", "primary", () => this.openArcadeModal("ttt", true));
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
            opts.dungeonWing === 1 ? "❄️ West Crypt Wing ✓" : "❄️ Pull West Lever (E)",
            opts.dungeonWing === 1 ? "accent" : "primary",
            () => this.onDungeonAction("lever1"),
          );
          addBtn(
            opts.dungeonWing === 2 ? "❄️ East Crypt Wing ✓" : "❄️ Pull East Lever (E)",
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
        addBtn("🌀 Abyssal Geyser to Surface", "primary", () => this.onDungeonAction("escapeSlide"));
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
