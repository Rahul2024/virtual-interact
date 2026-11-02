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
  getCinemaFloorY,
  getDungeonFloorNumber,
  getDungeonFloorY,
  getWorldFloorY,
  isInArcadeZone,
  POKER_SEAT_SPOTS,
  POKER_TABLE,
  nearestPokerSeat,
  pokerSeatIdFor,
  pokerSeatIndexOf,
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
  // Pot chips: the collected pot shown as clean stacks (per-street bets stay in front of players).
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
const syncBlocked = () => {
  controls.blocked = cinema.expanded || activities.isModalOpen;
};
ideasPanel.onOpenChange = (open) => (controls.blocked = open || cinema.expanded || activities.isModalOpen);
cinema.onModalOpenChange = (open) => (controls.blocked = open || activities.isModalOpen);
activities.onOpenMuralChange = () => syncBlocked();
activities.onTimeModeChange = (mode) => {
  world.timeMode = mode;
};
document.getElementById("ideas-open")!.addEventListener("click", () => session && ideasPanel.open());

window.addEventListener("keydown", (e) => {
  if (!session) return;
  if (e.code === "Escape" && cinema.expanded) {
    e.preventDefault();
    cinema.setExpanded(false);
    return;
  }
  if (controls.blocked) return;

  if (e.code === "KeyE") {
    const px = session.me.position.x;
    const pz = session.me.position.z;
    if (ideaWall.isNear(session.me.position)) {
      e.preventDefault();
      ideasPanel.open();
      return;
    }
    if (isNearGraffitiMural(px, pz)) {
      e.preventDefault();
      activities.openMuralModal();
      return;
    }
    if (pokerSeatIndexOf(session.me.seatId) >= 0) {
      e.preventDefault();
      pokerPanel.detach();
      return;
    }
    const pokerSeat = nearestPokerSeat(px, pz);
    if (pokerSeat >= 0) {
      e.preventDefault();
      void sitAtPokerTable(session, pokerSeat);
      return;
    }
    if (isInArcadeZone(px, pz)) {
      e.preventDefault();
      activities.openArcadeModal();
      return;
    }
    if (isInBrickDungeon(px, pz)) {
      e.preventDefault();
      triggerNearestBrickDungeonAction(session, px, pz);
      return;
    }
    if (isInCampfireCircle(px, pz) || CINEMA_SEATS[session.me.seatId]?.row === 10) {
      e.preventDefault();
      toggleNearestSeat(session, true);
      return;
    }
    if (isInCinemaHall(px, pz) || session.me.seatId >= 0) {
      e.preventDefault();
      toggleNearestSeat(session, false);
      return;
    }
  }
  if (e.code === "Space") {
    if (session.me.mimicTrapped > 0) {
      e.preventDefault();
      session.room.send(FOREST_MSG.dungeonAction, { action: "struggle" });
      return;
    }
    if (isInFootballStadium(session.me.position.x, session.me.position.z)) {
      e.preventDefault();
      session.room.send(FOOTBALL_MSG.kick, { power: 18 });
      return;
    }
    if (
      isInBrickDungeon(session.me.position.x, session.me.position.z) ||
      isInForestWilderness(session.me.position.x, session.me.position.z)
    ) {
      e.preventDefault();
      attackNearestAnimal(session);
      return;
    }
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
      if (chest === 0) return; // not standing at a chest
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
  // Campfire logs are row 10; cinema rows are 0..5; poker seats (row 20) have their own flow.
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
    // Pick center seat in middle tier (e.g. tier 3 / row 2)
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

function runSession(room: HubRoom, callbacks: HubCallbacks, options: JoinOptions, myId: string): Promise<string> {
  return new Promise((resolve) => {
    const remotes = new Map<string, Remote>();
    const friends = new Set<string>();
    const me = new Avatar(options.name || "You", options.color, true);
    me.position.set(0, 0, 8);
    controls.distance = 7;
    controls.pitch = 0.35;
    controls.yaw = Math.PI;
    world.scene.add(me.group);

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
        me.position.set(player.x, initY, player.z);
        me.rot = player.rot;
        me.seatId = player.seatId;
        me.mimicTrapped = player.mimicTrapped ?? 0;
        me.setTool(player.tool as ToolId);
        me.setTeam(player.team as TeamId);
        me.setName(player.name);
        s.rawMeat = player.rawMeat;
        s.cookedMeat = player.cookedMeat;
        s.energy = player.energy;
        controls.yaw = player.rot + Math.PI;
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
          if (!echoed) {
            me.position.set(player.x, getWorldFloorY(player.x, player.z), player.z);
            s.sentHistory.length = 0;
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
    hud.onFocusChange = (focused) => (controls.blocked = focused || cinema.expanded || activities.isModalOpen);

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

    const end = (reason: string) => {
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

    room.onError((code, message) => {
      console.error("room error", code, message);
      hud.addSystem(`Connection problem: ${message ?? code}`);
    });
    room.onLeave((code) =>
      end(code === 1000 || code === 4000 ? "You left the hub." : `Disconnected from the hub (code ${code}).`),
    );

    hud.addSystem("Welcome. WASD to walk, Shift to run, Enter to chat, M to turn on your mic.");
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
    world.updateAtmosphere(now);
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
        // Closed doors are solid on the client, so you stop at them instead of
        // walking through and being teleported back by the server.
        world.colliders.dynamic = dungeonClosedDoors({
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
          nowMs: Date.now(),
        });
      }
      let bossHp = 30;
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
        }
        world.syncAnimals(animalsList);
      }

      const mx = session.me.position.x;
      const mz = session.me.position.z;
      const inCinema = isInCinemaHall(mx, mz) || isCinemaSeated;

      const peerList: CinemaFriendPeer[] = [];
      for (const [sid, r] of session.remotes.entries()) {
        peerList.push({
          sessionId: sid,
          clientId: r.clientId,
          name: roomPlayerName(session, sid),
          color: r.color,
          isFriend: session.friends.has(r.clientId),
          inCinema: isInCinemaHall(r.avatar.position.x, r.avatar.position.z) || (r.avatar.seatId >= 0 && r.avatar.seatId < CINEMA_HALL.seatCount),
          seatId: r.avatar.seatId,
          speaking: r.speaking,
          distance: Math.hypot(r.avatar.position.x - mx, r.avatar.position.z - mz),
        });
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
      });

      if (session.voice.status === "on" && now - lastMicLabel > 600) {
        lastMicLabel = now;
        activities.updateTimeButtonLabel();
        hud.setMic("on", session.voice.listeners);
      }
    } else {
      controls.yaw += dt * 0.08;
      controls.pitch = 0.4;
      controls.distance = 22;
      camTarget.set(0, 2.5, 0);
      controls.updateCamera(world.camera, camTarget);
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
  if (s.me.mimicTrapped > 0) {
    s.me.position.y = getWorldFloorY(s.me.position.x, s.me.position.z);
    s.me.update(dt);
    return;
  }

  const mv = controls.moveVector(moveVec);
  const moving = mv.lengthSq() > 0;

  if (s.me.seatId >= 0) {
    if (moving && pokerSeatIndexOf(s.me.seatId) >= 0) {
      // Standing up from the poker table leaves the game properly (folds if needed).
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
  world.colliders.resolve(s.me.position, PLAYER.radius);
  s.me.position.y = getWorldFloorY(s.me.position.x, s.me.position.z);
  s.me.update(dt);
}

function stepRemotes(s: Session, dt: number) {
  const k = 1 - Math.exp(-dt * 12);
  for (const r of s.remotes.values()) {
    const p = r.avatar.position;
    p.x += (r.target.x - p.x) * k;
    p.z += (r.target.z - p.z) * k;
    const remoteSeat = r.avatar.seatId >= 0 ? CINEMA_SEATS[r.avatar.seatId] : undefined;
    p.y = remoteSeat ? (remoteSeat.y ?? 0) : getWorldFloorY(p.x, p.z);
    r.avatar.rot = lerpAngle(r.avatar.rot, r.target.rot, k);
    r.avatar.update(dt);
  }
}

function maybeSend(s: Session, dt: number) {
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
  if (s.sentHistory.length > 8) s.sentHistory.shift();
}

requestAnimationFrame(frame);
main();
