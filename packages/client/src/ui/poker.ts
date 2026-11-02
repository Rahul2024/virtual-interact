import {
  DEFAULT_POKER_CONFIG,
  POKER_MSG,
  RANK_CHARS,
  SUIT_SYMBOLS,
  describeHand,
  evaluateBest,
  rankOf,
  suitOf,
  type Action,
  type PokerEventMessage,
  type PokerTableConfig,
} from "@vi/shared/poker";
import type { PokerRoomRef } from "../net/poker";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function cardText(card: number): string {
  const r = RANK_CHARS[rankOf(card)] === "T" ? "10" : RANK_CHARS[rankOf(card)]!;
  return `${r}${SUIT_SYMBOLS[suitOf(card)]}`;
}
function cardHtml(card: number): string {
  const red = suitOf(card) === 1 || suitOf(card) === 2;
  return `<span class="pcard${red ? " red" : ""}">${cardText(card)}</span>`;
}

/**
 * The 2D side of the poker table: lobby (buy-in, host settings, Start), the
 * action bar with legal min/max, your cards, the dealer's line, hand history
 * and the practice aids. The 3D table shows everyone the same scene; this
 * panel is only yours.
 */
export class PokerPanel {
  private root = el<HTMLDivElement>("poker");
  private lobby = el<HTMLDivElement>("poker-lobby");
  private play = el<HTMLDivElement>("poker-play");
  private title = el<HTMLDivElement>("poker-title");
  private dealerLine = el<HTMLDivElement>("poker-dealer");
  private myCards = el<HTMLDivElement>("poker-my-cards");
  private handName = el<HTMLDivElement>("poker-hand-name");
  private potInfo = el<HTMLDivElement>("poker-pot");
  private timerBar = el<HTMLDivElement>("poker-timer");
  private actions = el<HTMLDivElement>("poker-actions");
  private foldBtn = el<HTMLButtonElement>("poker-fold");
  private checkCallBtn = el<HTMLButtonElement>("poker-check-call");
  private raiseBtn = el<HTMLButtonElement>("poker-raise");
  private raiseSlider = el<HTMLInputElement>("poker-raise-slider");
  private raiseInput = el<HTMLInputElement>("poker-raise-input");
  private presets = el<HTMLDivElement>("poker-presets");
  private history = el<HTMLDivElement>("poker-history");
  private leaveBtn = el<HTMLButtonElement>("poker-leave");
  private sitOutBtn = el<HTMLButtonElement>("poker-sit-out");
  private showBtn = el<HTMLButtonElement>("poker-show");
  private peekBtn = el<HTMLButtonElement>("poker-peek");
  private fairBtn = el<HTMLButtonElement>("poker-fair");
  private fairBox = el<HTMLDivElement>("poker-fair-box");
  // lobby
  private buyInInput = el<HTMLInputElement>("poker-buyin");
  private buyInRange = el<HTMLSpanElement>("poker-buyin-range");
  private sitBtn = el<HTMLButtonElement>("poker-sit");
  private hostBox = el<HTMLDivElement>("poker-host");
  private cfgSb = el<HTMLInputElement>("poker-cfg-sb");
  private cfgBb = el<HTMLInputElement>("poker-cfg-bb");
  private cfgMin = el<HTMLInputElement>("poker-cfg-min");
  private cfgMax = el<HTMLInputElement>("poker-cfg-max");
  private cfgTimer = el<HTMLInputElement>("poker-cfg-timer");
  private cfgPractice = el<HTMLInputElement>("poker-cfg-practice");
  private cfgApply = el<HTMLButtonElement>("poker-cfg-apply");
  private startBtn = el<HTMLButtonElement>("poker-start");
  private lobbyStatus = el<HTMLDivElement>("poker-lobby-status");
  private closeBtn = el<HTMLButtonElement>("poker-close");

  private room: PokerRoomRef | undefined;
  private pendingSeat = -1;
  private seatIndex = -1;
  private minTo = 0;
  private maxTo = 0;
  private peekHeld = false;

  /** Who to tell when the panel wants the avatar to sit/stand in the hub. */
  onSeated: (seatIndex: number) => void = () => {};
  /** Every table event, for sounds, voice and speech bubbles. */
  onTableEvent: (e: PokerEventMessage) => void = () => {};
  /** Toggles in the header. */
  onToggleSounds: (on: boolean) => void = () => {};
  onToggleVoice: (on: boolean) => void = () => {};
  private soundsBtn = el<HTMLButtonElement>("poker-sounds");
  private voiceBtn = el<HTMLButtonElement>("poker-voice");
  private lastTurnSeat = -1;
  onStood: () => void = () => {};
  onOpenChange: (open: boolean) => void = () => {};

  get isOpen(): boolean {
    return !this.root.hidden;
  }
  get peeking(): boolean {
    return this.peekHeld;
  }
  get mySeat(): number {
    return this.seatIndex;
  }
  get currentRoom(): PokerRoomRef | undefined {
    return this.room;
  }

  constructor() {
    this.closeBtn.addEventListener("click", () => this.close());
    this.sitBtn.addEventListener("click", () => this.sit());
    this.cfgApply.addEventListener("click", () => this.applyConfig());
    this.startBtn.addEventListener("click", () => this.room?.send(POKER_MSG.start));
    this.foldBtn.addEventListener("click", () => this.act({ type: "fold" }));
    this.checkCallBtn.addEventListener("click", () => {
      const owed = Number(this.checkCallBtn.dataset.owed ?? 0);
      this.act(owed > 0 ? { type: "call" } : { type: "check" });
    });
    this.raiseBtn.addEventListener("click", () => {
      const to = Math.floor(Number(this.raiseInput.value));
      const noBet = this.raiseBtn.dataset.mode === "bet";
      this.act(noBet ? { type: "bet", to } : { type: "raise", to });
    });
    this.raiseSlider.addEventListener("input", () => {
      this.raiseInput.value = this.raiseSlider.value;
      this.updateRaiseLabel();
    });
    this.raiseInput.addEventListener("input", () => {
      const v = Math.min(this.maxTo, Math.max(this.minTo, Math.floor(Number(this.raiseInput.value) || this.minTo)));
      this.raiseSlider.value = String(v);
      this.updateRaiseLabel();
    });
    this.leaveBtn.addEventListener("click", () => this.stand());
    this.sitOutBtn.addEventListener("click", () => {
      const out = this.sitOutBtn.dataset.out === "1";
      this.room?.send(out ? POKER_MSG.imBack : POKER_MSG.sitOut);
    });
    this.showBtn.addEventListener("click", () => this.room?.send(POKER_MSG.showCards));
    const peekOn = () => (this.peekHeld = true);
    const peekOff = () => (this.peekHeld = false);
    this.peekBtn.addEventListener("pointerdown", peekOn);
    window.addEventListener("pointerup", peekOff);
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyQ" && this.seatIndex >= 0 && !(e.target instanceof HTMLInputElement)) this.peekHeld = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "KeyQ") this.peekHeld = false;
    });
    this.fairBtn.addEventListener("click", () => (this.fairBox.hidden = !this.fairBox.hidden));
    this.soundsBtn.addEventListener("click", () => {
      const on = this.soundsBtn.dataset.on !== "1";
      this.setToggle(this.soundsBtn, on, "sounds");
      this.onToggleSounds(on);
    });
    this.voiceBtn.addEventListener("click", () => {
      const on = this.voiceBtn.dataset.on !== "1";
      this.setToggle(this.voiceBtn, on, "dealer voice");
      this.onToggleVoice(on);
    });
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
  }

  /** Attach to a joined table room and open the panel on the lobby view. */
  attach(room: PokerRoomRef, wantSeat: number) {
    this.detach();
    this.room = room;
    this.pendingSeat = wantSeat;
    this.history.replaceChildren();
    room.onMessage(POKER_MSG.event, (e: PokerEventMessage) => this.onEvent(e));
    room.onLeave(() => {
      if (this.room === room) this.detach();
    });
    this.open();
    this.render();
  }

  detach() {
    if (this.room) {
      const r = this.room;
      this.room = undefined;
      void r.leave().catch(() => {});
    }
    if (this.seatIndex >= 0) {
      this.seatIndex = -1;
      this.onStood();
    }
    this.pendingSeat = -1;
    this.close();
  }

  open() {
    if (this.isOpen) return;
    this.root.hidden = false;
    this.onOpenChange(true);
  }
  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.onOpenChange(false);
  }

  /** Called every frame by main.ts with the live state (cheap: only touches DOM on change). */
  render() {
    const room = this.room;
    if (!room || !room.state) return;
    const st = room.state;
    const me = st.seats.find((s) => s.sessionId === room.sessionId);
    const seated = me !== undefined;
    if (seated && this.seatIndex !== me.index) {
      this.seatIndex = me.index;
      this.onSeated(me.index);
    }
    if (!seated && this.seatIndex >= 0) {
      this.seatIndex = -1;
      this.onStood();
    }

    const isHost = st.hostSessionId === room.sessionId;
    this.title.textContent = `Royal Arcade · No-Limit Hold'em · blinds ${st.smallBlind}/${st.bigBlind}${st.phase === "lobby" ? " · lobby" : ` · hand #${st.handNo}`}`;
    this.dealerLine.textContent = st.dealerLine;

    // Lobby vs play.
    const showLobby = !seated || st.phase === "lobby";
    this.lobby.hidden = !showLobby;
    this.play.hidden = !seated;
    if (showLobby) {
      this.buyInRange.textContent = `${st.minBuyIn}–${st.maxBuyIn}`;
      if (!this.buyInInput.value) this.buyInInput.value = String(Math.min(st.maxBuyIn, Math.max(st.minBuyIn, st.bigBlind * 100)));
      this.sitBtn.hidden = seated;
      this.hostBox.hidden = !isHost || st.phase !== "lobby";
      if (!this.hostBox.hidden && document.activeElement?.closest("#poker-host") === null) {
        this.cfgSb.value = String(st.smallBlind);
        this.cfgBb.value = String(st.bigBlind);
        this.cfgMin.value = String(st.minBuyIn);
        this.cfgMax.value = String(st.maxBuyIn);
        this.cfgTimer.value = String(st.actionSeconds);
        this.cfgPractice.checked = st.practice;
      }
      const seatedCount = st.seats.filter((s) => s.sessionId && s.stack > 0).length;
      this.startBtn.hidden = !isHost || st.phase !== "lobby";
      this.startBtn.disabled = seatedCount < 2;
      this.lobbyStatus.textContent =
        st.phase === "lobby"
          ? `${seatedCount} seated. ${isHost ? "You are the host: set the table, then press Start." : "Waiting for the host to start."}`
          : `Game in progress. Buy in to join from the next hand.`;
    }

    if (!seated) return;

    // My cards and hand strength.
    const hole = me.holeCards ? [...me.holeCards] : [];
    const board = [...st.board];
    this.myCards.innerHTML = hole.length ? hole.map(cardHtml).join("") : `<span class="pcard back">?</span><span class="pcard back">?</span>`;
    if (st.practice && hole.length === 2 && hole.length + board.length >= 5) {
      this.handName.textContent = describeHand(evaluateBest([...hole, ...board]));
    } else if (st.practice && hole.length === 2) {
      this.handName.textContent = startingHandLabel(hole[0]!, hole[1]!);
    } else {
      this.handName.textContent = "";
    }

    // Pot and position.
    const pots = safeJson<Array<{ amount: number; eligible: number[] }>>(st.pots, []);
    const potText = pots.length > 1 ? pots.map((p, i) => `${i === 0 ? "Main" : `Side ${i}`} ${p.amount}`).join(" · ") : `Pot ${st.potTotal}`;
    this.potInfo.textContent = `${potText} · your stack ${me.stack}`;

    // Action bar.
    const myTurn = st.phase === "acting" && st.toAct === me.index;
    this.actions.classList.toggle("active", myTurn);
    this.foldBtn.disabled = !myTurn;
    this.checkCallBtn.disabled = !myTurn;
    this.raiseBtn.disabled = !myTurn;
    this.raiseSlider.disabled = !myTurn;
    this.raiseInput.disabled = !myTurn;
    if (myTurn) {
      const owed = Math.max(0, st.currentBet - me.front);
      const callAmt = Math.min(owed, me.stack);
      this.checkCallBtn.dataset.owed = String(owed);
      this.checkCallBtn.textContent = owed > 0 ? (callAmt < owed ? `Call ${callAmt} (all in)` : `Call ${callAmt}`) : "Check";
      const noBet = st.currentBet === 0;
      this.raiseBtn.dataset.mode = noBet ? "bet" : "raise";
      this.maxTo = me.front + me.stack;
      this.minTo = Math.min(this.maxTo, st.minRaiseTo || st.bigBlind);
      const canRaise = me.stack > owed;
      this.raiseBtn.disabled = !canRaise;
      this.raiseSlider.disabled = !canRaise;
      this.raiseInput.disabled = !canRaise;
      this.raiseSlider.min = String(this.minTo);
      this.raiseSlider.max = String(this.maxTo);
      this.raiseSlider.step = String(Math.max(1, Math.floor(st.smallBlind)));
      if (Number(this.raiseSlider.value) < this.minTo || Number(this.raiseSlider.value) > this.maxTo || !this.raiseSlider.dataset.touched) {
        this.raiseSlider.value = String(this.minTo);
        this.raiseInput.value = String(this.minTo);
      }
      this.updateRaiseLabel();
      // Presets: min, ½ pot, pot, all in.
      const pot = st.potTotal;
      const presetVals: Array<[string, number]> = [
        ["Min", this.minTo],
        ["½ pot", Math.min(this.maxTo, Math.max(this.minTo, st.currentBet + Math.floor((pot + owed) / 2)))],
        ["Pot", Math.min(this.maxTo, Math.max(this.minTo, st.currentBet + pot + owed))],
        ["All in", this.maxTo],
      ];
      this.presets.replaceChildren(
        ...presetVals.map(([label, v]) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = `${label} ${v}`;
          b.disabled = !canRaise;
          b.addEventListener("click", () => {
            this.raiseSlider.value = String(v);
            this.raiseInput.value = String(v);
            this.raiseSlider.dataset.touched = "1";
            this.updateRaiseLabel();
          });
          return b;
        }),
      );
      // Pot odds hint (practice).
      if (st.practice && owed > 0) {
        const pct = Math.round((owed / (pot + owed)) * 100);
        this.potInfo.textContent += ` · pot odds: ${owed} to win ${pot} (need ${pct}% equity)`;
      }
    } else {
      this.checkCallBtn.textContent = "Check / Call";
      this.raiseSlider.dataset.touched = "";
    }

    // Timer bar.
    if (myTurn && st.actionDeadline > 0) {
      const left = Math.max(0, st.actionDeadline - Date.now());
      const frac = Math.min(1, left / (st.actionSeconds * 1000));
      this.timerBar.style.width = `${frac * 100}%`;
      this.timerBar.classList.toggle("urgent", frac < 0.3);
      this.timerBar.parentElement!.hidden = false;
    } else {
      this.timerBar.parentElement!.hidden = true;
    }

    // Sit out / show.
    const out = me.status === "out";
    this.sitOutBtn.dataset.out = out ? "1" : "0";
    this.sitOutBtn.textContent = out ? "I'm back" : "Sit out next hand";
    this.showBtn.hidden = !(st.phase === "showdown" && me.shownCards.length === 0 && hole.length === 2);
    this.peekBtn.hidden = hole.length === 0;

    // Provably fair box.
    this.fairBox.innerHTML = `<div><b>Hand #${st.handNo}</b> commitment<br><code>${st.deckCommitment || "—"}</code></div>${
      st.lastSeed ? `<div>Seed (revealed after the hand)<br><code>${st.lastSeed}</code></div><div>Deck<br><code class="deck">${st.lastDeck}</code></div><div class="muted">Check: sha256("seed:deck") equals the commitment published before the deal.</div>` : `<div class="muted">The seed is revealed when the hand ends.</div>`
    }`;
  }

  private updateRaiseLabel() {
    const v = Math.floor(Number(this.raiseInput.value) || this.minTo);
    const mode = this.raiseBtn.dataset.mode === "bet" ? "Bet" : "Raise to";
    this.raiseBtn.textContent = v >= this.maxTo ? `All in ${this.maxTo}` : `${mode} ${v}`;
  }

  private sit() {
    if (!this.room) return;
    const buyIn = Math.floor(Number(this.buyInInput.value));
    const seat = this.pendingSeat >= 0 ? this.pendingSeat : this.room.state.seats.findIndex((s) => !s.sessionId);
    if (seat < 0) return;
    const name = (() => {
      try {
        return localStorage.getItem("vi.name") ?? "";
      } catch {
        return "";
      }
    })();
    const color = (() => {
      try {
        return localStorage.getItem("vi.color") ?? undefined;
      } catch {
        return undefined;
      }
    })();
    this.room.send(POKER_MSG.sit, { seat, buyIn, name, color });
  }

  private stand() {
    this.room?.send(POKER_MSG.leave);
    this.detach();
  }

  private applyConfig() {
    const cfg: Partial<PokerTableConfig> = {
      smallBlind: Number(this.cfgSb.value),
      bigBlind: Number(this.cfgBb.value),
      minBuyIn: Number(this.cfgMin.value),
      maxBuyIn: Number(this.cfgMax.value),
      actionSeconds: Number(this.cfgTimer.value),
      practice: this.cfgPractice.checked,
    };
    this.room?.send(POKER_MSG.config, cfg);
    this.buyInInput.value = "";
  }

  private act(action: Action) {
    this.room?.send(POKER_MSG.action, { action });
    this.raiseSlider.dataset.touched = "";
  }

  /** Reflect the saved preferences in the header buttons. */
  setAudioState(sounds: boolean, voice: boolean) {
    this.setToggle(this.soundsBtn, sounds, "sounds");
    this.setToggle(this.voiceBtn, voice, "dealer voice");
  }

  private setToggle(btn: HTMLButtonElement, on: boolean, label: string) {
    btn.dataset.on = on ? "1" : "0";
    btn.textContent = `${label}: ${on ? "on" : "off"}`;
    btn.classList.toggle("off", !on);
  }

  /** True on the frame your turn begins (for the "your turn" sound). */
  turnJustStarted(): boolean {
    const st = this.room?.state;
    if (!st) return false;
    const myTurn = st.phase === "acting" && st.toAct === this.seatIndex && this.seatIndex >= 0;
    const started = myTurn && this.lastTurnSeat !== st.toAct;
    this.lastTurnSeat = st.phase === "acting" ? st.toAct : -1;
    return started;
  }

  private onEvent(e: PokerEventMessage) {
    this.onTableEvent(e);
    if (e.kind === "handStart") this.addHistory(`— Hand #${e.handNo} —`, "sep");
    if (e.text) this.addHistory(e.text, e.kind === "say" ? "say" : "");
    if (e.kind === "award" && e.awards) {
      for (const a of e.awards) {
        if (!a.returned) this.addHistory(`Seat ${a.seat + 1} wins ${a.amount}${a.hand ? ` with ${a.hand}` : ""}.`, "win");
      }
    }
  }

  private addHistory(text: string, cls = "") {
    const div = document.createElement("div");
    div.className = `poker-line ${cls}`;
    div.textContent = text;
    this.history.appendChild(div);
    while (this.history.childElementCount > 80) this.history.firstElementChild?.remove();
    this.history.scrollTop = this.history.scrollHeight;
  }
}

function safeJson<T>(s: string, dflt: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return dflt;
  }
}

/** "A♠ K♠ — AKs (suited)" style label for the pre-flop practice hint. */
function startingHandLabel(a: number, b: number): string {
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  const r = (x: number) => RANK_CHARS[x]!;
  if (hi === lo) return `Pocket ${r(hi)}${r(hi)}`;
  return `${r(hi)}${r(lo)}${suitOf(a) === suitOf(b) ? "s (suited)" : "o (off-suit)"}`;
}

export { DEFAULT_POKER_CONFIG };
