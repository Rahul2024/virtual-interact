import * as THREE from "three";
import {
  ANIM,
  ARCADE_MSG,
  BRICK_DUNGEON,
  chestAt,
  dungeonClosedDoors,
  CINEMA_HALL,
  CINEMA_MSG,
  CINEMA_SEATS,
  FOOTBALL_MSG,
  FOREST_MSG,
  FRIEND_MSG,
  IDEA_MSG,
  MSG,
  MURAL_MSG,
  NET,
  PLAYER,
  REPO_URL,
  TEAM,
  TOOL,
  getCinemaFloorY,
  getDungeonFloorNumber,
  getDungeonFloorY,
  getWorldFloorY,
  isInArcadeZone,
  POKER_SEAT_SPOTS,
  PRESENCE,
  CLOSE,
  POKER_TABLE,
  nearestPokerSeat,
  pokerSeatIdFor,
  pokerSeatIndexOf,
  HAUNTED_GATE,
  isAtDungeonExitPortal,
  isAtHauntedGatePortal,
  isInBrickDungeon,
  isInCampfireCircle,
  isInCinemaHall,
  isInFootballStadium,
  isInForestWilderness,
  isInOpenSocialZone,
  isNearGraffitiMural,
  isNearOpenMicStage,
  isOnOpenMicStage,
  type Anim,
  type ArcadeStateBroadcast,
  type ChatBroadcast,
  type CinemaSyncSeekBroadcast,
  type DungeonActionType,
  type EmoteBroadcast,
  type FriendIncomingMessage,
  type FriendSyncedMessage,
  type Idea,
  type JoinOptions,
  type MoveMessage,
  type MuralInitMessage,
  type MuralPaintMessage,
  type NoticeMessage,
  type SeatMessage,
  type TeamId,
  type ToolId,
} from "@vi/shared";
import { createWorld, type AnimalRenderState } from "./world/scene";
import { Avatar } from "./world/avatar";
import { Controls } from "./world/controls";
import { IdeaWall } from "./world/ideaWall";
import { joinHub, serverUrl, waitForServer, type HubCallbacks, type HubRoom } from "./net/connection";
import { Voice } from "./voice/voice";
import { Hud, JoinScreen } from "./ui/hud";
import { IdeasPanel } from "./ui/ideas";
import { CinemaController, type CinemaFriendPeer } from "./ui/cinema";
import { ActivitiesController } from "./ui/activities";
import { PokerPanel } from "./ui/poker";
import { AdminPanel } from "./ui/admin";
import { PokerAudio } from "./world/pokerAudio";
import { GameAudio, type AnimalSoundState } from "./world/gameAudio";
import { joinPokerTable } from "./net/poker";
import type { PokerSeatView, PokerTableSnapshot } from "./world/pokerTable";
import type { ChipStack } from "@vi/shared/poker";

const world = createWorld(document.getElementById("world")!, document.getElementById("labels")!);
const controls = new Controls(world.renderer.domElement);
const joinScreen = new JoinScreen();
const hud = new Hud();
const ideasPanel = new IdeasPanel();
const cinema = new CinemaController();
const activities = new ActivitiesController(world.muralCanvas);
const pokerPanel = new PokerPanel();
const adminPanel = new AdminPanel();

// ---- 24/7 Living World Town NPCs (Time-Synced Patrols & Interactive Lore) ----
interface WorldNpc {
  avatar: Avatar;
  lines: string[];
  lineIdx: number;
  lastSpokeAt: number;
  sample(tSec: number): { x: number; z: number; rot: number; anim: Anim };
}

const worldNpcs: WorldNpc[] = (() => {
  // 1. Aria — Central Fountain & Plaza Guide
  const aria = new Avatar("🤖 Aria · Guide", "#4fc3d9");
  aria.onClick = () => {
    aria.react("👋");
    aria.say("Tip: Tap any player's name or use the + Add Friend button anywhere in the world!", 6500);
    hud.addChat("🤖 Aria · Guide", "Tap any player's name or use the + Add Friend button anywhere in the world!", "#4fc3d9");
  };
  world.scene.add(aria.group);

  // 2. Kabir — North Cinema & Arcade Enthusiast
  const kabir = new Avatar("🤖 Kabir · Cinephile", "#f2a33a");
  kabir.onClick = () => {
    kabir.react("🍿");
    kabir.say("Movies in the North Cinema Hall, or Texas Hold'em Poker in the East Royal Hall!", 6500);
    hud.addChat("🤖 Kabir · Cinephile", "Climb the red-carpet stairs for the Cinema Hall, or head East for Texas Hold'em!", "#f2a33a");
  };
  world.scene.add(kabir.group);

  // 3. Viktor — South Forest & Haunted Castle Gate Warden (holds a glowing Torch!)
  const viktor = new Avatar("🤖 Viktor · Warden", "#a66ce8");
  viktor.setTool(TOOL.torch);
  viktor.onClick = () => {
    viktor.react("🕯️");
    viktor.say("Beyond the Haunted Castle Door lies a 4-floor underground abyss (-18m deep)!", 6500);
    hud.addChat("🤖 Viktor · Warden", "Equip a Torch before stepping through the Ominous Haunted Castle Door!", "#a66ce8");
  };
  world.scene.add(viktor.group);

  // 4. Nova — Royal Arcade 2-Player Game Bot (plays Chess, Cut-Cross & Connect 4 with you!)
  const nova = new Avatar("🤖 Nova · Arcade Bot", "#6fcf7a");
  nova.onClick = () => {
    nova.react("🕹️");
    nova.say("Let's play! Pick Cut-Cross, Chess, or Connect 4 — I'm ready!", 6500);
    hud.addChat("🤖 Nova · Arcade Bot", "Let's play! Pick Cut-Cross, Chess, or Connect 4 in the Arcade!", "#6fcf7a");
    activities.openArcadeModal("ttt", true);
  };
  world.scene.add(nova.group);

  return [
    {
      avatar: aria,
      lines: [
        "Welcome! You can send Friend Requests anywhere in the world—even outside the circle!",
        "Accepted Friends ★ can hear each other on voice chat across the entire map!",
        "Click any player's nameplate or tap '+ Add Friend' when standing nearby!",
      ],
      lineIdx: 0,
      lastSpokeAt: 0,
      sample(tSec: number) {
        const cycle = tSec * 0.22;
        const paused = Math.sin(tSec * 0.7) > 0.65;
        const a = paused ? Math.floor(cycle) : cycle;
        const r = 9.2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const rot = Math.atan2(-Math.sin(a), Math.cos(a));
        return { x, z, rot, anim: paused ? ANIM.wave : ANIM.walk };
      },
    },
    {
      avatar: kabir,
      lines: [
        "Heading to the Grand Cinema Hall? Press G inside to sit right next to your Friends!",
        "The server stays live 24/7—come hang out in the Cinema or Arcade anytime!",
        "Try the Open-Mic Stage or paint on the shared Pixel Graffiti Mural!",
      ],
      lineIdx: 0,
      lastSpokeAt: 4000,
      sample(tSec: number) {
        const s = Math.sin(tSec * 0.18);
        const c = Math.cos(tSec * 0.18);
        const x = s * 14;
        const z = -17 + Math.cos(tSec * 0.36) * 3.5;
        const rot = Math.atan2(c * 14 * 0.18, -Math.sin(tSec * 0.36) * 3.5 * 0.36);
        return { x, z, rot, anim: Math.abs(c) < 0.18 ? ANIM.cheer : ANIM.walk };
      },
    },
    {
      avatar: viktor,
      lines: [
        "Beware the Ominous Haunted Door… the castle looks small, but the catacombs plunge 18m underground!",
        "Depth 1 has a sunken ice rotunda & Mimic reliquary; Depth 2 hides a molten forge!",
        "Grab a 🔥 Torch at the Campfire to burn the Cinder-Spider webs on Depth 2!",
      ],
      lineIdx: 0,
      lastSpokeAt: 8000,
      sample(tSec: number) {
        const u = Math.sin(tSec * 0.16);
        const x = Math.sin(tSec * 0.32) * 4.2;
        const z = 96 + u * 16;
        const rot = u >= 0 ? 0 : Math.PI;
        return { x, z, rot, anim: Math.abs(Math.cos(tSec * 0.16)) < 0.15 ? ANIM.idle : ANIM.walk };
      },
    },
    {
      avatar: nova,
      lines: [
        "Click me to play ♟️ Chess, ❌⭕ Cut-Cross, or 🔴🟡 Connect 4 right now!",
        "Think you can beat me at Chess or Cut-Cross? Tap my name or press E in the Arcade!",
        "Up for a quick 2-player match? Challenge me anytime at the Arcade cabinets!",
      ],
      lineIdx: 0,
      lastSpokeAt: 6000,
      sample(tSec: number) {
        const u = Math.sin(tSec * 0.25);
        const paused = Math.abs(Math.cos(tSec * 0.25)) < 0.22;
        const x = 75.5 + u * 4.2;
        const z = -10.5;
        const rot = paused ? 0 : Math.cos(tSec * 0.25) >= 0 ? Math.PI / 2 : -Math.PI / 2;
        return { x, z, rot, anim: paused ? ANIM.wave : ANIM.walk };
      },
    },
  ];
})();

function stepWorldNpcs(dt: number, nowMs: number) {
  const tSec = nowMs / 1000;
  for (const npc of worldNpcs) {
    const pose = npc.sample(tSec);
    npc.avatar.position.set(pose.x, getWorldFloorY(pose.x, pose.z), pose.z);
    npc.avatar.rot = pose.rot;
    npc.avatar.anim = pose.anim;
    npc.avatar.update(dt);

    if (nowMs - npc.lastSpokeAt > 19_000) {
      npc.lastSpokeAt = nowMs + Math.random() * 4000;
      const line = npc.lines[npc.lineIdx % npc.lines.length]!;
      npc.lineIdx++;
      npc.avatar.say(line, 6500);
    }
  }
}

window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === "KeyA" && session) {
    e.preventDefault();
    adminPanel.toggle();
  }
});
const pokerAudio = new PokerAudio();
const gameAudio = new GameAudio();
pokerPanel.setAudioState(pokerAudio.soundsOn, pokerAudio.voiceOn);
pokerPanel.onToggleSounds = (on) => pokerAudio.setSounds(on);
pokerPanel.onToggleVoice = (on) => pokerAudio.setVoice(on);
const audioBtn = document.getElementById("audio-btn") as HTMLButtonElement | null;
if (audioBtn) {
  const syncAudioBtn = () => {
    const icon = gameAudio.enabled ? "🔊" : "🔇";
    const label = gameAudio.enabled ? "Sound: On" : "Sound: Off";
    audioBtn.innerHTML = `<span class="hud-chip-icon">${icon}</span> <span class="hud-btn-label">${label}</span>`;
    audioBtn.classList.toggle("muted", !gameAudio.enabled);
  };
  syncAudioBtn();
  audioBtn.addEventListener("click", () => {
    gameAudio.toggle();
    syncAudioBtn();
  });
}

const fsBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement | null;
const fsIcon = document.getElementById("fs-icon") as HTMLSpanElement | null;
const fsLabel = fsBtn?.querySelector(".fs-label") as HTMLSpanElement | null;
if (fsBtn) {
  const isFs = (): boolean =>
    Boolean(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);

  const updateFsBtn = () => {
    const full = isFs();
    if (fsIcon) fsIcon.textContent = full ? "↙" : "⛶";
    if (fsLabel) fsLabel.textContent = full ? "Exit" : "Full";
    fsBtn.classList.toggle("active", full);
  };

  fsBtn.addEventListener("click", async () => {
    try {
      if (isFs()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen) {
          await (document as unknown as { webkitExitFullscreen: () => Promise<void> }).webkitExitFullscreen();
        }
      } else {
        const root = document.documentElement as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
        };
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
          await root.webkitRequestFullscreen();
        } else {
          hud.addSystem("📱 On iPhone: tap Safari Share ⎋ at bottom & choose 'Add to Home Screen' for full screen!");
        }
      }
    } catch {
      hud.addSystem("📱 On iPhone: tap Safari Share ⎋ at bottom & choose 'Add to Home Screen' for full screen!");
    }
    updateFsBtn();
  });

  document.addEventListener("fullscreenchange", updateFsBtn);
  document.addEventListener("webkitfullscreenchange", updateFsBtn);
  updateFsBtn();
}

const unlockAllAudio = () => {
  pokerAudio.unlock();
  gameAudio.unlock();
};
window.addEventListener("pointerdown", unlockAllAudio, { once: true });
window.addEventListener("keydown", unlockAllAudio, { once: true });

/** The hub avatar sitting in a poker seat (me or a remote), for speech bubbles. */
function avatarAtPokerSeat(seatIndex: number): Avatar | undefined {
  if (!session) return undefined;
  const seatId = pokerSeatIdFor(seatIndex);
  if (session.me.seatId === seatId) return session.me;
  for (const r of session.remotes.values()) if (r.avatar.seatId === seatId) return r.avatar;
  return undefined;
}

pokerPanel.onTableEvent = (e) => {
  switch (e.kind) {
    case "say":
      if (e.text) {
        world.pokerTable.dealerSay(e.text, 5000);
        pokerAudio.say(e.text);
      }
      break;
    case "handStart":
      pokerAudio.shuffle();
      break;
    case "deal":
      setTimeout(() => pokerAudio.cardSlide(), 400);
      setTimeout(() => pokerAudio.cardSlide(), 650);
      break;
    case "blind":
      pokerAudio.chips(2);
      break;
    case "action": {
      const who = e.seat !== undefined ? avatarAtPokerSeat(e.seat) : undefined;
      const line =
        e.action === "fold" ? "Fold" : e.action === "check" ? "Check" : e.action === "call" ? `Call ${e.amount}` : e.action === "bet" ? `Bet ${e.to}` : `Raise to ${e.to}`;
      who?.say(e.allIn ? `${line}. All in!` : line, 3500);
      if (e.action === "fold") pokerAudio.cardSlide();
      else if (e.action !== "check") pokerAudio.chips(Math.min(6, Math.max(1, Math.round((e.amount ?? 0) / 25))));
      if (e.text) pokerAudio.say(e.text);
      break;
    }
    case "street":
      if (e.text) {
        world.pokerTable.dealerSay(e.text, 4000);
        pokerAudio.say(e.text);
      }
      (e.cards ?? []).forEach((_, i) => setTimeout(() => pokerAudio.cardFlip(), i * 160));
      break;
    case "collect":
      pokerAudio.chips(4);
      break;
    case "runout":
      if (e.text) {
        world.pokerTable.dealerSay(e.text, 4000);
        pokerAudio.say(e.text);
      }
      break;
    case "reveal": {
      pokerAudio.cardFlip();
      const who = e.seat !== undefined ? avatarAtPokerSeat(e.seat) : undefined;
      if (e.hand) who?.say(e.hand, 5000);
      if (e.text) pokerAudio.say(e.text);
      break;
    }
    case "award":
      pokerAudio.win();
      break;
  }
};
pokerPanel.onSeated = (index) => {
  if (!session) return;
  const spot = POKER_SEAT_SPOTS[index]!;
  session.me.seatId = pokerSeatIdFor(index);
  session.me.position.set(spot.x, 0, spot.z);
  session.me.rot = spot.rot;
  session.me.anim = ANIM.sit;
  session.sentHistory.length = 0;
  controls.exitCinemaSeatView();
  controls.enterPokerSeatView(spot, { x: POKER_TABLE.centerX, z: POKER_TABLE.centerZ });
  session.room.send(MSG.seat, { seatId: session.me.seatId } satisfies SeatMessage);
};
pokerPanel.onStood = () => {
  controls.exitPokerSeatView();
  if (!session) return;
  if (pokerSeatIndexOf(session.me.seatId) >= 0) {
    session.me.seatId = -1;
    session.me.anim = ANIM.idle;
    session.room.send(MSG.seat, { seatId: -1 } satisfies SeatMessage);
  }
};

async function sitAtPokerTable(s: Session, seatIndex: number) {
  try {
    hud.addSystem("Taking a seat at the poker table…");
    const room = await joinPokerTable(POKER_TABLE.tableId);
    pokerPanel.attach(room, seatIndex);
  } catch (err) {
    console.error(err);
    hud.addSystem("Could not reach the poker table. Try again in a moment.");
  }
  void s;
}

function pokerSnapshot(): PokerTableSnapshot | undefined {
  const room = pokerPanel.currentRoom;
  const st = room?.state;
  if (!room || !st) return undefined;
  const mySeat = pokerPanel.mySeat;
  const parse = (j: string): ChipStack => {
    try {
      return JSON.parse(j) as ChipStack;
    } catch {
      return {};
    }
  };
  const seats: PokerSeatView[] = st.seats.map((seat) => {
    const mine = seat.index === mySeat;
    const shown = seat.shownCards ? [...seat.shownCards] : [];
    const hole = mine && seat.holeCards ? [...seat.holeCards] : [];
    return {
      index: seat.index,
      occupied: !!seat.sessionId,
      name: seat.name,
      status: seat.status,
      chips: parse(seat.chips),
      frontChips: parse(seat.frontChips),
      front: seat.front,
      cards: shown.length ? shown : hole,
      faceDown: shown.length === 0,
      isButton: seat.isButton,
      isTurn: seat.isTurn,
      lastAction: seat.lastAction,
    };
  });
  const pots = (() => {
    try {
      return JSON.parse(st.pots) as Array<{ amount: number }>;
    } catch {
      return [];
    }
  })();
  const inFront = st.seats.reduce((n, seat) => n + seat.front, 0);
  const collected = Math.max(0, pots.reduce((n, p) => n + p.amount, 0) - inFront);
  const potChips: ChipStack = {};
  let left = collected;
  for (const v of [1000, 500, 100, 25, 5, 1]) {
    const n = Math.floor(left / v);
    if (n > 0) {
      potChips[v] = n;
      left -= n * v;
    }
  }
  return { seats, board: [...st.board], potChips, potTotal: st.potTotal, dealerLine: st.dealerLine, mySeat, peeking: pokerPanel.peeking };
}
world.setScreenTexture(cinema.screenTexture);

// Between the north and east paths, facing the fountain.
const ideaWall = new IdeaWall(world.scene, world.colliders, 12.5, -12.5);

(document.getElementById("source-link") as HTMLAnchorElement).href = REPO_URL;
let chatFocused = false;
let ideasOpen = false;
let cinemaModalOpen = false;
const syncBlocked = () => {
  controls.blocked = chatFocused || ideasOpen || cinemaModalOpen || cinema.expanded || activities.isModalOpen;
};
ideasPanel.onOpenChange = (open) => {
  ideasOpen = open;
  syncBlocked();
};
cinema.onModalOpenChange = (open) => {
  cinemaModalOpen = open;
  syncBlocked();
};
activities.onOpenMuralChange = () => syncBlocked();
activities.onTimeModeChange = (mode) => {
  world.timeMode = mode;
};
document.getElementById("ideas-open")!.addEventListener("click", () => session && ideasPanel.open());

const handlePrimaryInteract = (): boolean => {
  if (!session) return false;
  const px = session.me.position.x;
  const pz = session.me.position.z;
  if (ideaWall.isNear(session.me.position)) {
    ideasPanel.open();
    return true;
  }
  if (isNearGraffitiMural(px, pz)) {
    activities.openMuralModal();
    return true;
  }
  if (pokerSeatIndexOf(session.me.seatId) >= 0) {
    pokerPanel.detach();
    return true;
  }
  const pokerSeat = nearestPokerSeat(px, pz);
  if (pokerSeat >= 0) {
    void sitAtPokerTable(session, pokerSeat);
    return true;
  }
  if (isInArcadeZone(px, pz)) {
    activities.openArcadeModal();
    return true;
  }
  if (isInBrickDungeon(px, pz)) {
    triggerNearestBrickDungeonAction(session, px, pz);
    return true;
  }
  if (isInCampfireCircle(px, pz) || CINEMA_SEATS[session.me.seatId]?.row === 10) {
    toggleNearestSeat(session, true);
    return true;
  }
  if (isInCinemaHall(px, pz) || session.me.seatId >= 0) {
    toggleNearestSeat(session, false);
    return true;
  }
  return false;
};

const handlePrimaryAction = (): boolean => {
  if (!session) return false;
  if (session.me.mimicTrapped > 0) {
    session.room.send(FOREST_MSG.dungeonAction, { action: "struggle" });
    return true;
  }
  if (isInFootballStadium(session.me.position.x, session.me.position.z)) {
    session.room.send(FOOTBALL_MSG.kick, { power: 18 });
    return true;
  }
  if (
    isInBrickDungeon(session.me.position.x, session.me.position.z) ||
    isInForestWilderness(session.me.position.x, session.me.position.z)
  ) {
    attackNearestAnimal(session);
    return true;
  }
  return false;
};

// Wire Mobile Virtual Joystick & Action Buttons
const joyZone = document.getElementById("mobile-joystick-zone");
const joyBase = document.getElementById("mobile-joystick-base");
const joyStick = document.getElementById("mobile-joystick-stick");
if (joyZone && joyBase && joyStick) {
  let joyPointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  const maxRadius = 46;

  const updateStick = (clientX: number, clientY: number) => {
    const dx = clientX - originX;
    const dy = clientY - originY;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, maxRadius);
    const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0;
    const sx = Math.cos(angle) * clamped;
    const sy = Math.sin(angle) * clamped;
    joyStick.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;

    const normX = sx / maxRadius;
    const normY = sy / maxRadius;
    const isRunning = clamped / maxRadius > 0.72;
    controls.setJoystick(normX, normY, isRunning);
  };

  const resetStick = () => {
    joyPointerId = null;
    joyBase.classList.remove("active");
    joyStick.style.transform = "translate3d(0px, 0px, 0)";
    controls.setJoystick(0, 0, false);
  };

  joyZone.addEventListener("pointerdown", (e) => {
    if (joyPointerId !== null) return;
    e.preventDefault();
    e.stopPropagation();
    joyPointerId = e.pointerId;
    try {
      joyZone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const rect = joyBase.getBoundingClientRect();
    originX = rect.left + rect.width / 2;
    originY = rect.top + rect.height / 2;
    joyBase.classList.add("active");
    updateStick(e.clientX, e.clientY);
  });

  joyZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== joyPointerId) return;
    e.preventDefault();
    e.stopPropagation();
    updateStick(e.clientX, e.clientY);
  });

  const endJoy = (e: PointerEvent) => {
    if (e.pointerId !== joyPointerId) return;
    resetStick();
  };
  joyZone.addEventListener("pointerup", endJoy);
  joyZone.addEventListener("pointercancel", endJoy);
}

const mobileInteractBtn = document.getElementById("mobile-btn-interact");
mobileInteractBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  handlePrimaryInteract();
});

const mobileAttackBtn = document.getElementById("mobile-btn-attack");
mobileAttackBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  if (!handlePrimaryAction()) {
    handlePrimaryInteract();
  }
});

const mobileRunBtn = document.getElementById("mobile-btn-run");
mobileRunBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const runningOn = controls.toggleMobileRun();
  mobileRunBtn.classList.toggle("active", runningOn);
});

window.addEventListener("keydown", (e) => {
  if (!session) return;
  if (e.code === "Escape" && cinema.expanded) {
    e.preventDefault();
    cinema.setExpanded(false);
    return;
  }
  if (controls.blocked) return;

  if (e.code === "KeyE") {
    if (handlePrimaryInteract()) e.preventDefault();
    return;
  }
  if (e.code === "Space") {
    if (handlePrimaryAction()) e.preventDefault();
    return;
  }
  if (e.code === "KeyG") {
    e.preventDefault();
    sitBesideFriends(session);
    return;
  }
  if (e.code === "KeyF") {
    if (
      isInCinemaHall(session.me.position.x, session.me.position.z) ||
      (session.me.seatId >= 0 && session.me.seatId < CINEMA_HALL.seatCount) ||
      cinema.expanded
    ) {
      e.preventDefault();
      cinema.setExpanded(!cinema.expanded);
      return;
    }
  }
  if (e.code === "KeyM") {
    e.preventDefault();
    toggleMic();
    return;
  }
  if (e.code === "Digit1") triggerEmote(session, ANIM.popcorn, "🍿");
  if (e.code === "Digit2") triggerEmote(session, ANIM.cheer, "👏");
  if (e.code === "Digit3") triggerEmote(session, ANIM.wave, "👋");
  if (e.code === "Digit4") triggerEmote(session, ANIM.mindblown, "🤯");
});

function triggerNearestBrickDungeonAction(s: Session, px: number, pz: number) {
  if (s.me.mimicTrapped > 0) {
    s.room.send(FOREST_MSG.dungeonAction, { action: "struggle" });
    return;
  }
  for (const r of s.remotes.values()) {
    if (r.avatar.mimicTrapped > 0 && Math.hypot(r.avatar.position.x - px, r.avatar.position.z - pz) <= 5.5) {
      s.room.send(FOREST_MSG.dungeonAction, { action: "rescue" });
      return;
    }
  }

  const cx = BRICK_DUNGEON.centerX;
  const floorNum = getDungeonFloorNumber(px, pz);
  if (floorNum === 1) {
    if (pz < BRICK_DUNGEON.mimicRoomStartZ) {
      const action: DungeonActionType = px <= cx ? "lever1" : "lever2";
      s.room.send(FOREST_MSG.dungeonAction, { action });
    } else {
      const chest = chestAt(px, pz);
      if (chest === 0) return;
      const action: DungeonActionType = chest === 1 ? "chest1" : chest === 2 ? "chest2" : "chest3";
      s.room.send(FOREST_MSG.dungeonAction, { action });
    }
  } else if (floorNum === 2) {
    s.room.send(FOREST_MSG.dungeonAction, { action: "burnWeb" });
  } else if (floorNum === 3) {
    const action: DungeonActionType = px <= cx ? "switchL" : "switchR";
    s.room.send(FOREST_MSG.dungeonAction, { action });
  } else {
    if (pz >= BRICK_DUNGEON.escapeSlideZ - 2.5) {
      s.room.send(FOREST_MSG.dungeonAction, { action: "escapeSlide" });
    } else {
      s.room.send(FOREST_MSG.dungeonAction, { action: "vault" });
    }
  }
}

function toggleMic() {
  if (!session) return;
  if (session.voice.isOn) session.voice.toggleMuted();
  else void session.voice.start();
}
hud.onMicClick = toggleMic;

interface Remote {
  avatar: Avatar;
  clientId: string;
  color: string;
  speaking: boolean;
  target: { x: number; z: number; rot: number };
}

interface Sent {
  x: number;
  z: number;
  rot: number;
  anim: Anim;
  at: number;
}

interface Session {
  room: HubRoom;
  myClientId: string;
  me: Avatar;
  rawMeat: number;
  cookedMeat: number;
  energy: number;
  remotes: Map<string, Remote>;
  friends: Set<string>;
  voice: Voice;
  lastSent: Sent;
  sentHistory: Sent[];
  sendAccumulator: number;
  emoteUntil: number;
  startedAt: number;
  spawned: boolean;
}

let session: Session | undefined;

function triggerEmote(s: Session, anim: Anim, emoji: string) {
  if (s.me.seatId < 0) {
    s.me.anim = anim;
    s.emoteUntil = performance.now() + 2600;
  }
  s.me.react(emoji);
  s.room.send(MSG.emote, { anim, emoji });
}

function attackNearestAnimal(s: Session) {
  const animals = s.room.state?.animals;
  if (!animals || typeof animals.entries !== "function") return;
  let closestId = "";
  let closestDist = Infinity;
  for (const [id, a] of animals.entries()) {
    if (!a || a.hp <= 0) continue;
    const d = Math.hypot(a.x - s.me.position.x, a.z - s.me.position.z);
    if (d < closestDist) {
      closestDist = d;
      closestId = id;
    }
  }
  if (closestId) {
    s.me.anim = ANIM.attack;
    s.emoteUntil = performance.now() + 600;
    s.room.send(FOREST_MSG.attackAnimal, { animalId: closestId });
  }
}

function getOccupiedSeats(s: Session): Set<number> {
  const occupied = new Set<number>();
  for (const r of s.remotes.values()) {
    if (r.avatar.seatId >= 0) occupied.add(r.avatar.seatId);
  }
  return occupied;
}

function toggleNearestSeat(s: Session, campfireMode: boolean) {
  if (s.me.seatId >= 0) {
    s.me.seatId = -1;
    s.me.anim = ANIM.idle;
    controls.exitCinemaSeatView();
    s.room.send(MSG.seat, { seatId: -1 } satisfies SeatMessage);
    return;
  }
  const occupied = getOccupiedSeats(s);
  const pool = CINEMA_SEATS.filter((seat) => (campfireMode ? seat.row === 10 : seat.row < 10) && !occupied.has(seat.id));
  if (pool.length === 0) {
    hud.addSystem("All seats here are currently taken!");
    return;
  }
  pool.sort(
    (a, b) =>
      Math.hypot(a.x - s.me.position.x, a.z - s.me.position.z) -
      Math.hypot(b.x - s.me.position.x, b.z - s.me.position.z),
  );
  const chosen = pool[0]!;
  sitInSeat(s, chosen.id);
}

function sitBesideFriends(s: Session) {
  const occupied = getOccupiedSeats(s);
  const available = CINEMA_SEATS.filter((seat) => seat.id < CINEMA_HALL.seatCount && !occupied.has(seat.id));
  if (available.length === 0) {
    hud.addSystem("No empty seats available in the Cinema Hall.");
    return;
  }
  const friendCoords: Array<{ x: number; z: number }> = [];
  for (const r of s.remotes.values()) {
    if (s.friends.has(r.clientId) && (r.avatar.seatId >= 0 || isInCinemaHall(r.avatar.position.x, r.avatar.position.z))) {
      friendCoords.push({ x: r.avatar.position.x, z: r.avatar.position.z });
    }
  }
  if (friendCoords.length > 0) {
    available.sort((a, b) => {
      const minA = Math.min(...friendCoords.map((f) => Math.hypot(a.x - f.x, a.z - f.z)));
      const minB = Math.min(...friendCoords.map((f) => Math.hypot(b.x - f.x, b.z - f.z)));
      return minA - minB;
    });
    const best = available[0]!;
    sitInSeat(s, best.id);
    hud.addSystem(`Seated in Seat #${best.id + 1} right beside your friend!`);
  } else {
    const centerSeat = available.find((seat) => seat.row === 3 && (seat.col === 4 || seat.col === 5)) ?? available[0]!;
    sitInSeat(s, centerSeat.id);
    hud.addSystem(`Seated in Cinema Seat #${centerSeat.id + 1}.`);
  }
}

function sitInSeat(s: Session, seatId: number) {
  const seat = CINEMA_SEATS[seatId];
  if (!seat) return;
  s.me.seatId = seat.id;
  s.me.position.set(seat.x, seat.y ?? 0, seat.z);
  s.me.rot = seat.rot;
  s.me.anim = ANIM.sit;
  s.sentHistory.length = 0;
  if (seat.id < CINEMA_HALL.seatCount) {
    controls.enterCinemaSeatView();
  }
  s.room.send(MSG.seat, { seatId: seat.id } satisfies SeatMessage);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

async function main() {
  for (;;) {
    const options = await joinScreen.waitForSubmit();
    joinScreen.setBusy(true, "Connecting…");
    try {
      await waitForServer((text) => joinScreen.setBusy(true, text));
      joinScreen.setBusy(true, "Entering the hub…");
      const { room, callbacks, myId } = await joinHub(options);
      joinScreen.hide();
      hud.show();
      const reason = await runSession(room, callbacks, options, myId);
      cinema.setExpanded(false);
      hud.hide();
      joinScreen.show();
      joinScreen.setError(reason);
    } catch (err) {
      console.error(err);
      joinScreen.setError(`Could not reach the world server at ${serverUrl()}. Is it running? (npm run dev)`);
    }
  }
}

interface RestoredPlayerState {
  x: number;
  y: number;
  z: number;
  rot: number;
  seatId: number;
  tool: ToolId;
}

function runSession(
  room: HubRoom,
  callbacks: HubCallbacks,
  options: JoinOptions,
  myId: string,
  restoredState?: RestoredPlayerState,
): Promise<string> {
  return new Promise((resolve) => {
    const remotes = new Map<string, Remote>();
    const friends = new Set<string>();
    const me = new Avatar(options.name || "You", options.color, true);
    if (restoredState) {
      me.position.set(restoredState.x, restoredState.y, restoredState.z);
      me.rot = restoredState.rot;
      me.seatId = restoredState.seatId;
      me.setTool(restoredState.tool);
    } else {
      me.position.set(0, 0, 8);
      controls.distance = 7;
      controls.pitch = 0.35;
      controls.yaw = Math.PI;
    }
    world.scene.add(me.group);

    const isPeerFriend = (peerSessionId: string): boolean => {
      const remote = remotes.get(peerSessionId);
      return remote ? friends.has(remote.clientId) : false;
    };

    const canHearPeer = (peerSessionId: string): boolean => {
      const remote = remotes.get(peerSessionId);
      if (!remote) return false;
      if (friends.has(remote.clientId)) return true;

      const mx = me.position.x;
      const mz = me.position.z;
      const px = remote.avatar.position.x;
      const pz = remote.avatar.position.z;

      if (isInOpenSocialZone(mx, mz) && isInOpenSocialZone(px, pz)) return true;
      if (isInCampfireCircle(mx, mz) && isInCampfireCircle(px, pz)) return true;
      if (isInBrickDungeon(mx, mz) && isInBrickDungeon(px, pz)) return true;
      if (isOnOpenMicStage(px, pz) && isNearOpenMicStage(mx, mz)) return true;
      if (isOnOpenMicStage(mx, mz) && isNearOpenMicStage(px, pz)) return true;
      if (me.team !== TEAM.none && me.team === remote.avatar.team && isInFootballStadium(mx, mz) && isInFootballStadium(px, pz)) {
        return true;
      }

      return false;
    };

    const voice = new Voice(room, {
      myPosition: () => me.position,
      listenerYaw: () => controls.yaw,
      peerPosition: (id) => remotes.get(id)?.avatar.position,
      canHearPeer,
      isFriend: isPeerFriend,
    });
    voice.onStatus = (status) => {
      hud.setMic(status, voice.listeners);
      me.setMic(status === "on");
    };
    voice.onSpeaking = (id, speaking) => {
      if (id === "me") {
        me.setSpeaking(speaking);
      } else {
        const rem = remotes.get(id);
        if (rem) {
          rem.speaking = speaking;
          rem.avatar.setSpeaking(speaking);
        }
      }
    };
    hud.setMic("off");

    const s: Session = (session = {
      room,
      myClientId: myId,
      me,
      rawMeat: 0,
      cookedMeat: 1,
      energy: 85,
      remotes,
      friends,
      voice,
      lastSent: { x: NaN, z: NaN, rot: NaN, anim: ANIM.idle, at: 0 },
      sentHistory: [],
      sendAccumulator: 0,
      emoteUntil: 0,
      startedAt: performance.now(),
      spawned: false,
    });

    cinema.onToggleSeat = () => toggleNearestSeat(s, false);
    cinema.onSitWithFriends = () => sitBesideFriends(s);
    cinema.onEmote = (anim, emoji) => triggerEmote(s, anim, emoji);
    cinema.onSetMovieUrl = (url) => room.send(CINEMA_MSG.setUrl, { url });
    cinema.onReportDuration = (durationSec) => room.send(CINEMA_MSG.setDuration, { durationSec });
    cinema.onControlMovie = (action, seekSec) => room.send(CINEMA_MSG.control, { action, seekSec });
    cinema.onTransferHost = (targetSessionId) => room.send(CINEMA_MSG.transferHost, { targetSessionId });
    cinema.onSendChat = (text) => room.send(MSG.chat, { text });
    cinema.onFriendRequest = (toSessionId) => room.send(FRIEND_MSG.request, { toSessionId });
    cinema.onFriendAccept = (fromClientId) => room.send(FRIEND_MSG.accept, { fromClientId });
    cinema.onFriendRemove = (friendClientId) => room.send(FRIEND_MSG.remove, { friendClientId });

    activities.onPaintPixel = (x, y, colorIdx) => room.send(MURAL_MSG.paint, { x, y, colorIdx });
    activities.onClearMural = () => room.send(MURAL_MSG.clear);
    activities.onFootballTeam = (team) => room.send(FOOTBALL_MSG.joinTeam, { team });
    activities.onFootballKick = () => room.send(FOOTBALL_MSG.kick, { power: 18 });
    activities.onFootballReset = () => room.send(FOOTBALL_MSG.resetMatch);
    activities.onArcadeMove = (game, colOrCell) => room.send(ARCADE_MSG.move, { game, colOrCell });
    activities.onArcadeReset = (game) => room.send(ARCADE_MSG.reset, { game });
    activities.onEquipTool = (tool) => room.send(FOREST_MSG.equipTool, { tool });
    activities.onAttackNearestAnimal = () => attackNearestAnimal(s);
    activities.onForageBerry = () => room.send(FOREST_MSG.forageBerry);
    activities.onCookMeat = () => room.send(FOREST_MSG.cookMeat);
    activities.onEatMeat = () => room.send(FOREST_MSG.eatMeat);
    activities.onSitCampfire = () => toggleNearestSeat(s, true);
    activities.onDungeonAction = (action) => room.send(FOREST_MSG.dungeonAction, { action });
    activities.onSendFriendRequest = (toSessionId) => room.send(FRIEND_MSG.request, { toSessionId });

    const syncCinemaFromRoom = () => {
      const st = room.state;
      if (!st) return;
      const hostId = st.cinemaHostId || "";
      const isHost = hostId === room.sessionId || hostId === "";
      const hostName = isHost ? "You" : st.cinemaHostName || "Host";
      cinema.syncState({
        movieUrl: st.movieUrl || "",
        movieDurationSec: st.movieDurationSec || 0,
        startedAt: st.movieStartedAt || 0,
        paused: st.moviePaused === 1,
        pausedAtSec: st.moviePausedAtSec || 0,
        isHost,
        hostName,
      });
    };

    if (room.state) {
      callbacks.onChange(room.state, () => syncCinemaFromRoom());
      syncCinemaFromRoom();
    }

    room.onMessage(CINEMA_MSG.syncSeek, (m: CinemaSyncSeekBroadcast) => {
      cinema.applyImmediateSyncSeek(m.seekSec, m.paused);
    });
    room.onMessage(MURAL_MSG.init, (m: MuralInitMessage) => {
      world.paintMuralData(m.pixels ?? []);
      activities.refreshMuralEditorCanvas();
    });
    room.onMessage(MURAL_MSG.patched, (m: MuralPaintMessage) => {
      world.paintMuralPixel(m.x, m.y, m.colorIdx);
      activities.refreshMuralEditorCanvas();
    });
    room.onMessage(ARCADE_MSG.state, (st: ArcadeStateBroadcast) => {
      activities.setArcadeState(st);
    });

    const refreshFriendBadges = () => {
      for (const r of remotes.values()) {
        r.avatar.setFriend(friends.has(r.clientId));
      }
    };

    room.onMessage(FRIEND_MSG.synced, (m: FriendSyncedMessage) => {
      friends.clear();
      for (const cid of m.friendClientIds ?? []) friends.add(cid);
      refreshFriendBadges();
    });
    room.onMessage(FRIEND_MSG.incoming, (req: FriendIncomingMessage) => {
      cinema.handleIncomingFriendRequest(req);
      hud.addSystem(`👋 ${req.fromName} sent you a Friend Request!`);
    });

    const updateCount = () => hud.setCount(room.state?.players?.size ?? 1);

    callbacks.onAdd("players", (player, id) => {
      const initSeat = player.seatId >= 0 ? CINEMA_SEATS[player.seatId] : undefined;
      const initY = initSeat ? (initSeat.y ?? 0) : getWorldFloorY(player.x, player.z);
      if (id === room.sessionId) {
        if (restoredState) {
          me.position.set(restoredState.x, restoredState.y, restoredState.z);
          me.rot = restoredState.rot;
          me.seatId = restoredState.seatId;
          me.setTool(restoredState.tool);
          s.sentHistory.push({
            x: restoredState.x,
            z: restoredState.z,
            rot: restoredState.rot,
            anim: me.anim,
            at: performance.now(),
          });
          s.sendAccumulator = 1;
          try {
            room.send(MSG.move, {
              x: restoredState.x,
              z: restoredState.z,
              rot: restoredState.rot,
              anim: me.anim,
            });
            if (restoredState.seatId >= 0) {
              room.send(MSG.seat, { seatId: restoredState.seatId });
            }
            if (restoredState.tool !== TOOL.none) {
              room.send(FOREST_MSG.equipTool, { tool: restoredState.tool });
            }
          } catch {
            /* ignore */
          }
        } else {
          me.position.set(player.x, initY, player.z);
          me.rot = player.rot;
          me.seatId = player.seatId;
          me.setTool(player.tool as ToolId);
          controls.yaw = player.rot + Math.PI;
          s.lastSent = { x: player.x, z: player.z, rot: player.rot, anim: me.anim, at: performance.now() };
          s.sentHistory.push(s.lastSent);
        }
        s.spawned = true;
        me.mimicTrapped = player.mimicTrapped ?? 0;
        me.setTeam(player.team as TeamId);
        me.setName(player.name);
        s.rawMeat = player.rawMeat;
        s.cookedMeat = player.cookedMeat;
        s.energy = player.energy;
        callbacks.onChange(player, () => {
          me.seatId = player.seatId;
          me.mimicTrapped = player.mimicTrapped ?? 0;
          me.setTool(player.tool as ToolId);
          me.setTeam(player.team as TeamId);
          s.rawMeat = player.rawMeat;
          s.cookedMeat = player.cookedMeat;
          s.energy = player.energy;
          if (player.mimicTrapped > 0) {
            me.position.set(player.x, getWorldFloorY(player.x, player.z), player.z);
            me.rot = player.rot;
            s.sentHistory.length = 0;
            return;
          }
          if (player.seatId >= 0) {
            const curSeat = CINEMA_SEATS[player.seatId];
            me.position.set(player.x, curSeat ? (curSeat.y ?? 0) : 0, player.z);
            me.rot = player.rot;
            me.anim = ANIM.sit;
            return;
          }
          const echoed = s.sentHistory.some((p) => Math.abs(p.x - player.x) < 0.05 && Math.abs(p.z - player.z) < 0.05);
          const drift = Math.hypot(player.x - me.position.x, player.z - me.position.z);
          if (!echoed && drift > 3.5) {
            me.position.set(player.x, getWorldFloorY(player.x, player.z), player.z);
            s.lastSent = { x: player.x, z: player.z, rot: player.rot, anim: me.anim, at: performance.now() };
            s.sentHistory.push(s.lastSent);
          }
        });
        updateCount();
        syncCinemaFromRoom();
        return;
      }

      const avatar = new Avatar(player.name, player.color);
      avatar.position.set(player.x, initY, player.z);
      avatar.rot = player.rot;
      avatar.anim = player.anim as Anim;
      avatar.seatId = player.seatId;
      avatar.mimicTrapped = player.mimicTrapped ?? 0;
      avatar.setTool(player.tool as ToolId);
      avatar.setTeam(player.team as TeamId);
      avatar.setFriend(friends.has(player.clientId));
      avatar.onClick = () => {
        if (friends.has(player.clientId)) {
          cinema.openFriendsModal();
        } else {
          room.send(FRIEND_MSG.request, { toSessionId: id });
        }
      };
      world.scene.add(avatar.group);
      avatar.setMic(player.mic === 1);

      const remote: Remote = {
        avatar,
        clientId: player.clientId,
        color: player.color,
        speaking: false,
        target: { x: player.x, z: player.z, rot: player.rot },
      };
      remotes.set(id, remote);

      callbacks.onChange(player, () => {
        remote.clientId = player.clientId;
        remote.target.x = player.x;
        remote.target.z = player.z;
        remote.target.rot = player.rot;
        avatar.anim = player.anim as Anim;
        avatar.seatId = player.seatId;
        avatar.mimicTrapped = player.mimicTrapped ?? 0;
        avatar.setTool(player.tool as ToolId);
        avatar.setTeam(player.team as TeamId);
        avatar.setMic(player.mic === 1);
        avatar.setFriend(friends.has(player.clientId));
      });
      if (performance.now() - s.startedAt > 1500) hud.addSystem(`${player.name} arrived`);
      updateCount();
      syncCinemaFromRoom();
    });

    callbacks.onRemove("players", (player, id) => {
      const remote = remotes.get(id);
      if (remote) {
        remote.avatar.dispose();
        remotes.delete(id);
        hud.addSystem(`${player.name} left`);
      }
      updateCount();
      syncCinemaFromRoom();
    });

    room.onMessage(MSG.chat, (m: ChatBroadcast) => {
      const isMe = m.id === room.sessionId;
      const rem = remotes.get(m.id);
      const isFriend = rem ? friends.has(rem.clientId) : false;
      const speaker = isMe ? me : rem?.avatar;
      const color = isMe ? options.color : room.state?.players?.get?.(m.id)?.color;

      const hideBubble = !isMe && !isFriend && cinema.hideStrangerBubbles;
      speaker?.say(m.text, 6000, hideBubble);
      hud.addChat(isFriend ? `★ ${m.name}` : m.name, m.text, color);
      cinema.addOverlayComment(m.name, m.text, color, isFriend, isMe);
    });

    room.onMessage(MSG.emote, (m: EmoteBroadcast) => {
      const who = m.id === room.sessionId ? me : remotes.get(m.id)?.avatar;
      if (who) {
        if (who.seatId < 0) who.anim = m.anim;
        who.react(m.emoji);
      }
    });

    room.onMessage(MSG.notice, (m: NoticeMessage) => hud.addSystem(m.text));

    hud.onSend = (text) => room.send(MSG.chat, { text });
    adminPanel.attach(room);
    const heartbeat = setInterval(() => {
      if (room.connection?.isOpen) room.send(MSG.heartbeat);
    }, PRESENCE.heartbeatMs);
    hud.onFocusChange = (focused) => {
      chatFocused = focused;
      syncBlocked();
    };

    // Idea Wall
    ideasPanel.bind(myId, {
      create: (title, details) => room.request<unknown, Idea>(IDEA_MSG.create, { title, details }),
      vote: (id) => room.request<unknown, Idea>(IDEA_MSG.vote, { id }),
      join: (id) => room.request<unknown, Idea>(IDEA_MSG.join, { id }),
      leave: (id) => room.request<unknown, Idea>(IDEA_MSG.leave, { id }),
      setStatus: (id, status) => room.request<unknown, Idea>(IDEA_MSG.status, { id, status }),
    });
    room.onMessage(IDEA_MSG.changed, (idea: Idea) => {
      ideasPanel.upsert(idea);
      ideaWall.upsert(idea);
    });
    room
      .request<unknown, Idea[]>(IDEA_MSG.list)
      .then((list) => {
        ideasPanel.setIdeas(list);
        ideaWall.setIdeas(list);
      })
      .catch((err) => console.warn("could not load ideas", err));

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        try {
          room.send(MSG.heartbeat);
        } catch {
          /* ignore if reconnecting */
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const end = (reason: string) => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(heartbeat);
      adminPanel.detach();
      pokerPanel.detach();
      voice.dispose();
      hud.setMic("off");
      for (const r of remotes.values()) r.avatar.dispose();
      remotes.clear();
      me.dispose();
      ideasPanel.unbind();
      ideaWall.setNear(false);
      controls.exitCinemaSeatView();
      session = undefined;
      controls.blocked = false;
      resolve(reason);
    };

    let reconnectingNoticed = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let rejoiningInPlace = false;

    const clearFallbackTimer = () => {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }
    };

    const triggerSeamlessRejoin = async () => {
      if (rejoiningInPlace || !session) return;
      rejoiningInPlace = true;
      clearFallbackTimer();
      const savedPos: RestoredPlayerState = {
        x: me.position.x,
        y: me.position.y,
        z: me.position.z,
        rot: me.rot,
        seatId: me.seatId,
        tool: me.tool,
      };
      try {
        room.reconnection.enabled = false;
        void room.leave(false).catch(() => {});
      } catch {
        /* ignore */
      }
      try {
        await waitForServer(() => {}, 25_000);
        const fresh = await joinHub(options);
        if (!session) return;
        end("__SEAMLESS_REJOIN__");
        const nextPromise = runSession(fresh.room, fresh.callbacks, options, fresh.myId, savedPos);
        hud.addSystem("✅ Connected!");
        const nextReason = await nextPromise;
        if (nextReason !== "__SEAMLESS_REJOIN__") {
          resolve(nextReason);
        }
      } catch {
        rejoiningInPlace = false;
        end("Connection lost. Click Enter to rejoin.");
      }
    };

    room.onDrop(() => {
      if (!reconnectingNoticed) {
        reconnectingNoticed = true;
        hud.addSystem("⚠️ Connection hiccup — reconnecting…");
      }
      clearFallbackTimer();
      fallbackTimer = setTimeout(() => {
        if (reconnectingNoticed && !room.connection?.isOpen) {
          void triggerSeamlessRejoin();
        }
      }, 4500);
    });
    room.onReconnect(() => {
      clearFallbackTimer();
      reconnectingNoticed = false;
      hud.addSystem("✅ Connected!");
      try {
        if (room.connection?.isOpen) {
          room.send(MSG.heartbeat);
          room.send(MSG.move, { x: me.position.x, z: me.position.z, rot: me.rot, anim: me.anim });
        }
      } catch {
        /* ignore */
      }
    });
    room.onError((code, message) => {
      console.error("room error", code, message);
      if (code === 524 || message?.includes("failed to reconnect") || message?.includes("already consumed")) {
        void triggerSeamlessRejoin();
        return;
      }
      hud.addSystem(`Connection problem: ${message ?? code}`);
    });
    room.onLeave((code) => {
      clearFallbackTimer();
      if (rejoiningInPlace) return;
      if (code !== 1000 && code !== 4000 && code !== CLOSE.kicked && code !== CLOSE.banned && code !== CLOSE.replaced) {
        void triggerSeamlessRejoin();
        return;
      }
      end(code === 1000 || code === 4000 ? "You left the hub." : `Disconnected from the hub (code ${code}).`);
    });

    if (!restoredState) {
      hud.addSystem("Welcome. WASD to walk, Shift to run, Enter to chat, M to turn on your mic.");
    }
  });
}

// ---- Render loop -----------------------------------------------------------

const moveVec = new THREE.Vector2();
const camTarget = new THREE.Vector3();
let last = performance.now();
let lastMicLabel = 0;

function frame(now: number) {
  requestAnimationFrame(frame);

  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  try {
    const wallNowMs = Date.now();
    world.updateAtmosphere(now);
    stepWorldNpcs(dt, wallNowMs);
    cinema.updateFrame(now);

    if (session) {
      stepLocal(session, dt, now);
      stepRemotes(session, dt);
      const isSeated = session.me.seatId >= 0;
      const isCinemaSeated = session.me.seatId >= 0 && session.me.seatId < CINEMA_HALL.seatCount;
      camTarget.set(
        session.me.position.x,
        session.me.position.y + (isSeated ? 1.25 : 1.5),
        session.me.position.z,
      );
      controls.updateCamera(world.camera, camTarget);
      maybeSend(session, dt);
      ideaWall.setNear(ideaWall.isNear(session.me.position));
      session.voice.update(now);

      pokerPanel.render();
      adminPanel.render();
      const serverTime = session.room.state?.timeMode;
      if (serverTime && serverTime !== "auto" && world.timeMode !== serverTime) world.timeMode = serverTime as typeof world.timeMode;
      if (pokerPanel.turnJustStarted()) pokerAudio.yourTurn();
      const pokerSnap = pokerSnapshot();
      if (pokerSnap) world.pokerTable.update(pokerSnap);
      world.pokerTable.tick(dt, pokerPanel.peeking);

      // Which mimic chests (1..3) have someone in their jaws right now, as a bitmask.
      let chompingChests = 0;
      let anyPeerMimicTrapped = false;
      if (session.me.mimicTrapped > 0) chompingChests |= 1 << (session.me.mimicTrapped - 1);
      for (const r of session.remotes.values()) {
        if (r.avatar.mimicTrapped > 0) {
          anyPeerMimicTrapped = true;
          chompingChests |= 1 << (r.avatar.mimicTrapped - 1);
        }
      }

      const st = session.room.state;
      if (st && Number.isFinite(st.ballX) && Number.isFinite(st.ballZ)) {
        world.setFootballState(
          st.ballX,
          st.ballZ,
          st.scoreRed ?? 0,
          st.scoreBlue ?? 0,
        );
      }
      if (st) {
        world.dungeonColliders.dynamic = dungeonClosedDoors({
          dungeonWing: st.dungeonWing ?? 1,
          grimoireFound: st.grimoireFound ?? 0,
          websBurned: st.websBurned ?? 0,
          gateLeftOpen: st.gateLeftOpen ?? 0,
          gateRightOpen: st.gateRightOpen ?? 0,
        });
        world.setDungeonState({
          dungeonWing: st.dungeonWing ?? 1,
          dungeonSeed: st.dungeonSeed ?? 0,
          grimoireFound: st.grimoireFound ?? 0,
          gateLeftOpen: st.gateLeftOpen ?? 0,
          gateRightOpen: st.gateRightOpen ?? 0,
          vaultUnlocked: st.vaultUnlocked ?? 0,
          arrowVolleyZ: st.arrowVolleyZ ?? BRICK_DUNGEON.hall1EndZ,
          fireBoulderZ: st.fireBoulderZ ?? BRICK_DUNGEON.boulderEndZ,
          websBurned: st.websBurned ?? 0,
          chompingChests,
          nowMs: wallNowMs,
        });
      }
      let bossHp = 30;
      const soundAnimals: AnimalSoundState[] = [];
      if (st?.animals && typeof st.animals.values === "function") {
        const animalsList: AnimalRenderState[] = [];
        for (const a of st.animals.values()) {
          if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
          if (a.id === "boss-cerberus") bossHp = a.hp ?? 0;
          animalsList.push({
            id: a.id,
            species: a.species,
            x: a.x,
            z: a.z,
            rot: a.rot ?? 0,
            hp: a.hp ?? 1,
            maxHp: a.maxHp ?? 1,
          });
          soundAnimals.push({
            id: a.id,
            species: a.species,
            x: a.x,
            z: a.z,
            hp: a.hp ?? 0,
            maxHp: a.maxHp ?? 1,
          });
        }
        world.syncAnimals(animalsList);
      }

      const mx = session.me.position.x;
      const mz = session.me.position.z;
      const inCinema = isInCinemaHall(mx, mz) || isCinemaSeated;

      const peerList: CinemaFriendPeer[] = [];
      let closestStranger: { sessionId: string; name: string; dist: number } | undefined;

      for (const [sid, r] of session.remotes.entries()) {
        const isFriend = session.friends.has(r.clientId);
        const name = roomPlayerName(session, sid);
        const distance = Math.hypot(r.avatar.position.x - mx, r.avatar.position.z - mz);
        peerList.push({
          sessionId: sid,
          clientId: r.clientId,
          name,
          color: r.color,
          isFriend,
          inCinema: isInCinemaHall(r.avatar.position.x, r.avatar.position.z) || (r.avatar.seatId >= 0 && r.avatar.seatId < CINEMA_HALL.seatCount),
          seatId: r.avatar.seatId,
          speaking: r.speaking,
          distance,
        });
        if (!isFriend && distance <= 12.0 && (!closestStranger || distance < closestStranger.dist)) {
          closestStranger = { sessionId: sid, name, dist: distance };
        }
      }

      cinema.updateHudState({
        playerX: mx,
        playerZ: mz,
        inCinema,
        isSeated: isCinemaSeated,
        friendSpeaking: session.voice.isAnyPeerSpeaking,
        friendsCount: peerList.filter((p) => p.isFriend).length,
        peers: peerList,
      });

      activities.updateContextBar({
        tool: session.me.tool,
        team: session.me.team,
        rawMeat: session.rawMeat,
        cookedMeat: session.cookedMeat,
        energy: session.energy,
        isSeated,
        onOpenMic: isOnOpenMicStage(mx, mz),
        nearMural: isNearGraffitiMural(mx, mz),
        inFootball: isInFootballStadium(mx, mz),
        inArcade: isInArcadeZone(mx, mz),
        inCampfire: isInCampfireCircle(mx, mz),
        inForest: isInForestWilderness(mx, mz),
        inDungeon: isInBrickDungeon(mx, mz),
        playerX: mx,
        playerZ: mz,
        dungeonWing: st?.dungeonWing ?? 1,
        grimoireFound: st?.grimoireFound ?? 0,
        websBurned: st?.websBurned ?? 0,
        bossHp,
        mimicTrapped: session.me.mimicTrapped,
        anyPeerMimicTrapped,
        isNight: world.isNight,
        nearbyStranger: closestStranger ? { sessionId: closestStranger.sessionId, name: closestStranger.name } : undefined,
      });

      if (session.voice.status === "on" && now - lastMicLabel > 600) {
        lastMicLabel = now;
        activities.updateTimeButtonLabel();
        hud.setMic("on", session.voice.listeners);
      }

      gameAudio.update({
        playerX: mx,
        playerZ: mz,
        isNight: world.isNight,
        timeMode: world.timeMode,
        inCinema: inCinema || cinema.expanded,
        moviePlaying: Boolean(st?.movieUrl && st?.moviePaused !== 1),
        inArcadeModal: activities.isModalOpen,
        inPoker: pokerSeatIndexOf(session.me.seatId) >= 0 || Boolean(pokerPanel.currentRoom),
        animals: soundAnimals,
      });
    } else {
      controls.yaw += dt * 0.08;
      controls.pitch = 0.4;
      controls.distance = 22;
      camTarget.set(0, 2.5, 0);
      controls.updateCamera(world.camera, camTarget);
      gameAudio.update({
        playerX: 0,
        playerZ: 0,
        isNight: world.isNight,
        timeMode: world.timeMode,
        inCinema: false,
        moviePlaying: false,
        inArcadeModal: false,
        animals: [],
      });
    }

    world.render();
    cinema.updateScreenProjection(world.camera, !session);
  } catch (err) {
    console.error("Render frame error:", err);
  }
}

function roomPlayerName(s: Session, sid: string): string {
  return s.room.state?.players?.get?.(sid)?.name ?? "Guest";
}

function stepLocal(s: Session, dt: number, now: number) {
  if (!s.spawned) {
    s.me.update(dt);
    return;
  }
  if (s.me.mimicTrapped > 0) {
    s.me.position.y = getWorldFloorY(s.me.position.x, s.me.position.z);
    s.me.update(dt);
    return;
  }

  const mv = controls.moveVector(moveVec);
  const moving = mv.lengthSq() > 0;

  if (s.me.seatId >= 0) {
    if (moving && pokerSeatIndexOf(s.me.seatId) >= 0) {
      pokerPanel.detach();
      return;
    }
    if (moving) {
      s.me.seatId = -1;
      controls.exitCinemaSeatView();
      s.room.send(MSG.seat, { seatId: -1 } satisfies SeatMessage);
    } else {
      const seat = CINEMA_SEATS[s.me.seatId];
      if (seat) {
        s.me.position.set(seat.x, seat.y ?? 0, seat.z);
        s.me.rot = seat.rot;
      }
      s.me.anim = ANIM.sit;
      s.me.update(dt);
      return;
    }
  }

  if (moving) {
    const staminaBoost = s.energy >= 70 ? 1.25 : 1.0;
    const baseSpeed = controls.running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const speed = baseSpeed * staminaBoost;
    s.me.position.x += mv.x * speed * dt;
    s.me.position.z += mv.y * speed * dt;
    const want = Math.atan2(mv.x, mv.y);
    s.me.rot = lerpAngle(s.me.rot, want, 1 - Math.exp(-dt * 14));
    s.me.anim = controls.running ? ANIM.run : ANIM.walk;
  } else if (now >= s.emoteUntil) {
    s.me.anim = ANIM.idle;
  }
  const wasInDungeon = isInBrickDungeon(s.me.position.x, s.me.position.z);
  if (!wasInDungeon && isAtHauntedGatePortal(s.me.position.x, s.me.position.z)) {
    world.ensureDungeonLoaded();
    s.me.position.set(BRICK_DUNGEON.centerX, 0, BRICK_DUNGEON.startZ + 4.5);
    s.me.rot = 0;
    controls.yaw = Math.PI;
    s.lastSent = { x: s.me.position.x, z: s.me.position.z, rot: s.me.rot, anim: s.me.anim, at: 0 };
    s.sentHistory.length = 0;
    s.sentHistory.push(s.lastSent);
    s.sendAccumulator = 1;
  } else if (wasInDungeon && isAtDungeonExitPortal(s.me.position.x, s.me.position.z)) {
    s.me.position.set(HAUNTED_GATE.exitX, 0, HAUNTED_GATE.exitZ);
    s.me.rot = Math.PI;
    controls.yaw = 0;
    s.lastSent = { x: s.me.position.x, z: s.me.position.z, rot: s.me.rot, anim: s.me.anim, at: 0 };
    s.sentHistory.length = 0;
    s.sentHistory.push(s.lastSent);
    s.sendAccumulator = 1;
  }
  const activeColliders = isInBrickDungeon(s.me.position.x, s.me.position.z) ? world.dungeonColliders : world.colliders;
  activeColliders.resolve(s.me.position, PLAYER.radius);
  s.me.position.y = getWorldFloorY(s.me.position.x, s.me.position.z);
  s.me.update(dt);
}

function stepRemotes(s: Session, dt: number) {
  const k = 1 - Math.exp(-dt * 12);
  const myInDungeon = isInBrickDungeon(s.me.position.x, s.me.position.z);
  for (const r of s.remotes.values()) {
    const p = r.avatar.position;
    p.x += (r.target.x - p.x) * k;
    p.z += (r.target.z - p.z) * k;
    const remoteSeat = r.avatar.seatId >= 0 ? CINEMA_SEATS[r.avatar.seatId] : undefined;
    p.y = remoteSeat ? (remoteSeat.y ?? 0) : getWorldFloorY(p.x, p.z);
    r.avatar.rot = lerpAngle(r.avatar.rot, r.target.rot, k);
    // Hide players who are deep inside the underground dungeon when you are outside on the surface!
    const peerInDungeon = isInBrickDungeon(p.x, p.z);
    r.avatar.group.visible = !peerInDungeon || myInDungeon;
    r.avatar.update(dt);
  }
}

function maybeSend(s: Session, dt: number) {
  if (!s.spawned || !s.room.connection?.isOpen) return;
  s.sendAccumulator += dt;
  if (s.sendAccumulator < 1 / NET.sendHz) return;
  s.sendAccumulator = 0;

  const { x, z } = s.me.position;
  const rot = s.me.rot;
  const anim = s.me.anim;
  const ls = s.lastSent;
  const changed =
    Math.abs(x - ls.x) > 0.001 || Math.abs(z - ls.z) > 0.001 || Math.abs(rot - ls.rot) > 0.001 || anim !== ls.anim;
  const stale = performance.now() - ls.at > 1000;
  if (!changed && !stale) return;

  const msg: MoveMessage = { x, z, rot, anim };
  s.room.send(MSG.move, msg);
  s.lastSent = { x, z, rot, anim, at: performance.now() };
  s.sentHistory.push(s.lastSent);
  if (s.sentHistory.length > 40) s.sentHistory.shift();
}

requestAnimationFrame(frame);
main();
