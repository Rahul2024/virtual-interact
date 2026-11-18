/**
 * Constants and message contracts shared by the world server and the client.
 * Keep this file dependency-free: it is imported by both sides.
 */

export const REPO_URL = "https://github.com/Rahul2024/virtual-interact";

/**
 * Expanded World: 1040m × 1040m (-520 to +520 on X and Z) to fit all city
 * districts, the Deep Southern Forest, the Haunted Castle Gatehouse, and the
 * 360m-long 4-Depth Descending Underground Dungeon (`z = +120..+480`, `y = 0m..-18m`).
 */
export const WORLD = {
  size: 1040,
  half: 520,
} as const;

export const PLAYER = {
  walkSpeed: 4.5, // m/s
  runSpeed: 8.0, // m/s
  maxSpeed: 12.5, // m/s
  radius: 0.4, // collision radius, m
  height: 1.7, // m
  maxNameLength: 20,
  maxChatLength: 240,
} as const;

export const NET = {
  sendHz: 10,
  patchMs: 50,
  maxMessagesPerSecond: 250,
} as const;

/** Animation states. Kept numeric so they fit in one byte on the wire. */
export const ANIM = {
  idle: 0,
  walk: 1,
  run: 2,
  sit: 3,
  wave: 4,
  cheer: 5,
  popcorn: 6,
  mindblown: 7,
  attack: 8,
} as const;
export type Anim = (typeof ANIM)[keyof typeof ANIM];

/** Equipped hand tool for Forest Survival & Night/Dungeon Exploration. */
export const TOOL = {
  none: 0,
  torch: 1,
  spear: 2,
  bow: 3,
} as const;
export type ToolId = (typeof TOOL)[keyof typeof TOOL];

/** Football team assignment. */
export const TEAM = {
  none: 0,
  red: 1,
  blue: 2,
} as const;
export type TeamId = (typeof TEAM)[keyof typeof TEAM];

/**
 * Computes current Indian Standard Time (IST, UTC+5:30) as a fractional hour
 * (0.0 .. 24.0) so day, sunset, and night match real Indian clock time.
 */
export function getIndianHourFloat(nowMs = Date.now()): number {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(nowMs + istOffsetMs);
  const h = istDate.getUTCHours();
  const m = istDate.getUTCMinutes();
  const s = istDate.getUTCSeconds();
  return h + m / 60 + s / 3600;
}

export function formatIndianTime(nowMs = Date.now()): string {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(nowMs + istOffsetMs);
  let h = istDate.getUTCHours();
  const m = istDate.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm} IST`;
}

// ---- District Zones & Coordinates -----------------------------------------

export const SOCIAL_ZONE = {
  x: 0,
  z: 0,
  radius: 14.5,
} as const;

export function isInOpenSocialZone(x: number, z: number): boolean {
  return Math.hypot(x - SOCIAL_ZONE.x, z - SOCIAL_ZONE.z) <= SOCIAL_ZONE.radius;
}

/** North-East Open-Mic Stage: speaker on stage broadcasts to nearby audience. */
export const OPEN_MIC_STAGE = {
  x: 24,
  z: -42,
  stageRadius: 4.2,
  audienceRadius: 24,
} as const;

export function isOnOpenMicStage(x: number, z: number): boolean {
  return Math.hypot(x - OPEN_MIC_STAGE.x, z - OPEN_MIC_STAGE.z) <= OPEN_MIC_STAGE.stageRadius;
}

export function isNearOpenMicStage(x: number, z: number): boolean {
  return Math.hypot(x - OPEN_MIC_STAGE.x, z - OPEN_MIC_STAGE.z) <= OPEN_MIC_STAGE.audienceRadius;
}

/** North-West Shared Pixel Graffiti Mural Wall. */
export const GRAFFITI_MURAL = {
  x: -24,
  z: -42,
  width: 32,
  height: 16,
  interactRadius: 6.5,
  palette: [
    "#141824",
    "#ffffff",
    "#f26d6d",
    "#f2a33a",
    "#e8d44d",
    "#6fcf7a",
    "#4fc3d9",
    "#5b8def",
    "#a66ce8",
    "#f28ac9",
    "#ff0055",
    "#00ffcc",
  ],
} as const;

export function isNearGraffitiMural(x: number, z: number): boolean {
  return Math.hypot(x - GRAFFITI_MURAL.x, z - GRAFFITI_MURAL.z) <= GRAFFITI_MURAL.interactRadius;
}

/** West District: Team Football (Soccer) Stadium. */
export const FOOTBALL_STADIUM = {
  centerX: -82,
  centerZ: 0,
  halfW: 20,
  halfD: 13,
  goalHalfZ: 3.6,
  ballRadius: 0.55,
} as const;

export function isInFootballStadium(x: number, z: number): boolean {
  return (
    Math.abs(x - FOOTBALL_STADIUM.centerX) <= FOOTBALL_STADIUM.halfW + 6 &&
    Math.abs(z - FOOTBALL_STADIUM.centerZ) <= FOOTBALL_STADIUM.halfD + 6
  );
}

/** East District: Multiplayer Neon Arcade Plaza. */
export const ARCADE_ZONE = {
  centerX: 82,
  centerZ: 0,
  radius: 15,
} as const;

export function isInArcadeZone(x: number, z: number): boolean {
  return Math.hypot(x - ARCADE_ZONE.centerX, z - ARCADE_ZONE.centerZ) <= ARCADE_ZONE.radius;
}

/**
 * The Royal Arcade Hall: an enclosed, warm-lit room on the east side of the
 * city. Walls, door and the poker table are placed from these numbers.
 */
export const ARCADE_HALL = {
  minX: 64,
  maxX: 102,
  minZ: -15,
  maxZ: 15,
  wallHeight: 6.5,
  /** Door in the west wall facing the plaza, |z| < doorHalfW. */
  doorHalfW: 3.2,
} as const;

export function isInArcadeHall(x: number, z: number): boolean {
  return x >= ARCADE_HALL.minX && x <= ARCADE_HALL.maxX && z >= ARCADE_HALL.minZ && z <= ARCADE_HALL.maxZ;
}

/**
 * The poker table: an oval with 9 player seats around it and the NPC dealer
 * on the flat south side. Seats are numbered clockwise from the dealer's left.
 */
export const POKER_TABLE = {
  tableId: "royal-1",
  centerX: 86,
  centerZ: 0,
  /** Felt half-length along x (plus rounded ends) and half-width along z. */
  halfLength: 2.3,
  halfWidth: 1.45,
  /** Ellipse the seats sit on. */
  seatRx: 3.35,
  seatRz: 2.55,
  /** Dealer position angle (radians, 0 = +x, counter-clockwise), seats fill the rest of the ring. */
  dealerAngle: Math.PI / 2,
  seatCount: 9,
  /** Hub seat ids for the 9 poker seats start here (see CINEMA_SEATS). */
  firstSeatId: 70,
  /** Press E within this distance of a seat to sit. */
  reach: 2.2,
} as const;

export interface PokerSeatSpot {
  index: number;
  x: number;
  z: number;
  /** Yaw the sitter faces (towards the table centre). */
  rot: number;
  /** Angle on the seat ellipse. */
  angle: number;
}

/** Positions of the 9 player seats, clockwise from the dealer's left. */
export const POKER_SEAT_SPOTS: readonly PokerSeatSpot[] = (() => {
  const out: PokerSeatSpot[] = [];
  const n = POKER_TABLE.seatCount;
  for (let i = 0; i < n; i++) {
    // Spread the seats over the ring, leaving the dealer's slot free.
    const angle = POKER_TABLE.dealerAngle + ((i + 1) / (n + 1)) * Math.PI * 2;
    const x = POKER_TABLE.centerX + Math.cos(angle) * POKER_TABLE.seatRx;
    const z = POKER_TABLE.centerZ + Math.sin(angle) * POKER_TABLE.seatRz;
    const rot = Math.atan2(POKER_TABLE.centerX - x, POKER_TABLE.centerZ - z);
    out.push({ index: i, x, z, rot, angle });
  }
  return out;
})();

export const POKER_DEALER_SPOT = {
  x: POKER_TABLE.centerX + Math.cos(POKER_TABLE.dealerAngle) * POKER_TABLE.seatRx,
  z: POKER_TABLE.centerZ + Math.sin(POKER_TABLE.dealerAngle) * POKER_TABLE.seatRz,
  rot: Math.atan2(-Math.cos(POKER_TABLE.dealerAngle), -Math.sin(POKER_TABLE.dealerAngle)),
} as const;

/** Nearest poker seat within reach of (x, z), or -1. */
export function nearestPokerSeat(x: number, z: number): number {
  let best = -1;
  let bestD: number = POKER_TABLE.reach;
  for (const s of POKER_SEAT_SPOTS) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s.index;
    }
  }
  return best;
}

/**
 * South District: Deep Forest Campfire Valley (`z = +68`, hidden behind the
 * Foothill Ridge at `z = +36..+56` so the city skyline is screened off).
 */
export const CAMPFIRE_BASE = {
  x: 0,
  z: 68,
  fireRadius: 2.2,
  voiceCircleRadius: 11.5,
  cookPos: { x: -4.8, z: 68 },
  toolRackPos: { x: 4.8, z: 68 },
} as const;

export function isInCampfireCircle(x: number, z: number): boolean {
  return Math.hypot(x - CAMPFIRE_BASE.x, z - CAMPFIRE_BASE.z) <= CAMPFIRE_BASE.voiceCircleRadius;
}

export function isInForestWilderness(x: number, z: number): boolean {
  return z >= 38 && Math.abs(x) <= 240;
}

/**
 * Surface Landmark: Compact Haunted Castle Gatehouse (`z = 115..121`) with an
 * Ominous Abyssal Portal Doorway that teleports players to the off-map
 * 4-Depth Underground Dungeon (`BRICK_DUNGEON`, `z = 1200..1560`).
 */
export const HAUNTED_GATE = {
  x: 0,
  z: 120,
  portalZ: 119.3,
  portalHalfW: 4.1,
  exitX: 0,
  exitZ: 115.0,
} as const;

export function isAtHauntedGatePortal(x: number, z: number): boolean {
  return Math.abs(x - HAUNTED_GATE.x) <= HAUNTED_GATE.portalHalfW && z >= HAUNTED_GATE.portalZ - 1.1 && z <= HAUNTED_GATE.z + 2.0;
}

const DUNGEON_Z_OFFSET = 1080;

/**
 * 360m-Long 4-Depth Descending Underground Dungeon ("The Abyssal Catacombs of the 3-Faced Dire Wolf")
 * located off-map at `z = 1200..1560` so it never collides with or loads on the surface world!
 * Players enter via the Haunted Castle Gatehouse portal and it lazy-loads on entry.
 */
export const BRICK_DUNGEON = {
  centerX: 0,
  startZ: 120 + DUNGEON_Z_OFFSET,
  endZ: 480 + DUNGEON_Z_OFFSET,
  halfW: 19.0,
  bossHalfW: 22.0,

  // Depth 1: Ice Crypts & Aqueduct Rotunda (y = 0)
  waterStartZ: 132 + DUNGEON_Z_OFFSET,
  waterEndZ: 172 + DUNGEON_Z_OFFSET,
  hall1EndZ: 184 + DUNGEON_Z_OFFSET,
  junctionZ: 186 + DUNGEON_Z_OFFSET,
  mimicRoomStartZ: 190 + DUNGEON_Z_OFFSET,
  mimicRoomEndZ: 210 + DUNGEON_Z_OFFSET,
  secretWallZ: 210 + DUNGEON_Z_OFFSET,

  // Descending Stairwell 1->2 (y = 0..-6)
  stairs1StartZ: 210 + DUNGEON_Z_OFFSET,
  stairs1EndZ: 226 + DUNGEON_Z_OFFSET,
  floor2Y: -6.0,

  // Depth 2: Fire & Spider-Web Catacombs (y = -6)
  web1Z: 238 + DUNGEON_Z_OFFSET,
  web2Z: 256 + DUNGEON_Z_OFFSET,
  web3Z: 274 + DUNGEON_Z_OFFSET,
  pendulum1Z: 262 + DUNGEON_Z_OFFSET,
  pendulum2Z: 278 + DUNGEON_Z_OFFSET,
  pendulum3Z: 294 + DUNGEON_Z_OFFSET,
  boulderStartZ: 280 + DUNGEON_Z_OFFSET,
  boulderEndZ: 314 + DUNGEON_Z_OFFSET,
  floor2EndZ: 316 + DUNGEON_Z_OFFSET,

  // Descending Stairwell 2->3 (y = -6..-12)
  stairs2StartZ: 316 + DUNGEON_Z_OFFSET,
  stairs2EndZ: 332 + DUNGEON_Z_OFFSET,
  floor3Y: -12.0,

  // Depth 3: Shadow Chasm & Twin Iron Gaol (y = -12)
  chasmStartZ: 340 + DUNGEON_Z_OFFSET,
  chasmEndZ: 368 + DUNGEON_Z_OFFSET,
  parallelStartZ: 372 + DUNGEON_Z_OFFSET,
  switchZ: 382 + DUNGEON_Z_OFFSET,
  gateZ: 388 + DUNGEON_Z_OFFSET,
  floor3EndZ: 404 + DUNGEON_Z_OFFSET,

  // Descending Stairwell 3->4 (y = -12..-18)
  stairs3StartZ: 404 + DUNGEON_Z_OFFSET,
  stairs3EndZ: 420 + DUNGEON_Z_OFFSET,
  floor4Y: -18.0,

  // Depth 4: Colossal Subterranean Boss Cathedral (y = -18)
  sanctumStartZ: 420 + DUNGEON_Z_OFFSET,
  bossHomeZ: 446 + DUNGEON_Z_OFFSET,
  vaultChestZ: 470 + DUNGEON_Z_OFFSET,
  escapeSlideZ: 476 + DUNGEON_Z_OFFSET,

  // ---- Hazard geometry ----
  slabRowZs: [126 + DUNGEON_Z_OFFSET, 175 + DUNGEON_Z_OFFSET, 181 + DUNGEON_Z_OFFSET],
  slabCenterX: 2.6,
  slabHalfW: 2.1,
  slabHalfD: 1.2,
  grateZs: [138 + DUNGEON_Z_OFFSET, 152 + DUNGEON_Z_OFFSET, 166 + DUNGEON_Z_OFFSET],
  grateDripX: 1.4,
  grateDripHalfW: 1.3,
  canalStoneHalfW: 2.9,
  canalWalkwayMinX: 10.8,
  arrowHalfW: 3.8,
  arrowHalfD: 1.1,
  partitionZ: 190.5 + DUNGEON_Z_OFFSET,
  partitionHalfD: 0.7,
  partitionInnerX: 0.5,
  partitionOuterX: 16.5,
  chestXs: [-5.2, 0, 5.2],
  chestZ: 201.5 + DUNGEON_Z_OFFSET,
  chestReach: 2.6,
  secretWallHalfD: 0.6,

  // Depth 2
  webHalfW: 8.5,
  webHalfD: 0.35,
  boulderRadius: 2.6,
  boulderHitHalfW: 3.0,

  // Depth 3
  chasmBridgeHalfW: 3.2,
  chasmCatwalkMinX: 11.0,
  ironBarsStartZ: 372 + DUNGEON_Z_OFFSET,
  ironBarsEndZ: 392 + DUNGEON_Z_OFFSET,
  ironBarsHalfW: 0.4,
  gateHalfD: 0.4,
  gateInnerX: 0.6,
} as const;

export function isAtDungeonExitPortal(x: number, z: number): boolean {
  return Math.abs(x - BRICK_DUNGEON.centerX) <= 6.5 && z >= BRICK_DUNGEON.startZ - 4.0 && z <= BRICK_DUNGEON.startZ + 1.4;
}

/** The flags that decide which dungeon doors are currently solid. */
export interface DungeonDoorState {
  dungeonWing: number;
  grimoireFound: number;
  websBurned: number;
  gateLeftOpen: number;
  gateRightOpen: number;
}

/** Axis-aligned wall segment on the ground plane; the same shape the client's collider system uses. */
export interface WallBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** Which door this is, for messages. */
  door: "partition" | "bookcase" | "web1" | "web2" | "web3" | "gateLeft" | "gateRight";
}

/**
 * The doors that are closed right now, as solid boxes. The client turns these
 * into colliders so you stop at a door instead of walking through and being
 * teleported back; the server enforces the same boxes so nobody cheats.
 */
export function dungeonClosedDoors(state: DungeonDoorState): WallBox[] {
  const D = BRICK_DUNGEON;
  const cx = D.centerX;
  const doors: WallBox[] = [];

  // Depth 1 shifting partition: wing 1 = west open (east wall closed), wing 2 = east open.
  const closedSide = state.dungeonWing === 1 ? 1 : -1;
  const pHalf = (D.partitionOuterX - D.partitionInnerX) / 2;
  doors.push({
    x: cx + closedSide * (D.partitionInnerX + pHalf),
    z: D.partitionZ,
    hw: pHalf,
    hd: D.partitionHalfD,
    door: "partition",
  });

  // Depth 1 secret bookcase across the whole hallway until the grimoire is found.
  if (state.grimoireFound === 0) {
    doors.push({ x: cx, z: D.secretWallZ, hw: D.halfW, hd: D.secretWallHalfD, door: "bookcase" });
  }

  // Depth 2 web curtains in the centre lane.
  const webZs = [D.web1Z, D.web2Z, D.web3Z] as const;
  webZs.forEach((wz, i) => {
    if ((state.websBurned & (1 << i)) === 0) {
      doors.push({ x: cx, z: wz, hw: D.webHalfW, hd: D.webHalfD, door: `web${i + 1}` as WallBox["door"] });
    }
  });

  // Depth 3 portcullis gates, one per side of the iron bars.
  const gHalf = (D.halfW - D.gateInnerX) / 2;
  if (state.gateLeftOpen === 0) {
    doors.push({ x: cx - (D.gateInnerX + gHalf), z: D.gateZ, hw: gHalf, hd: D.gateHalfD, door: "gateLeft" });
  }
  if (state.gateRightOpen === 0) {
    doors.push({ x: cx + (D.gateInnerX + gHalf), z: D.gateZ, hw: gHalf, hd: D.gateHalfD, door: "gateRight" });
  }
  return doors;
}

/**
 * Which chest (1..3) is within reach of (x, z), or 0. Shared so the E key and
 * the server agree on which chest you're standing at.
 */
export function chestAt(x: number, z: number): 0 | 1 | 2 | 3 {
  const D = BRICK_DUNGEON;
  if (Math.abs(z - D.chestZ) > 3.2) return 0;
  let best: 0 | 1 | 2 | 3 = 0;
  let bestD: number = D.chestReach;
  D.chestXs.forEach((chX, i) => {
    const d = Math.abs(x - (D.centerX + chX));
    if (d < bestD) {
      bestD = d;
      best = (i + 1) as 1 | 2 | 3;
    }
  });
  return best;
}

export function isInBrickDungeon(x: number, z: number): boolean {
  const maxW = z >= BRICK_DUNGEON.sanctumStartZ ? BRICK_DUNGEON.bossHalfW + 20 : BRICK_DUNGEON.halfW + 20;
  return Math.abs(x - BRICK_DUNGEON.centerX) <= maxW && z >= BRICK_DUNGEON.startZ - 25 && z <= BRICK_DUNGEON.endZ + 25;
}

/**
 * Returns the vertical floor elevation `y` (in metres) at `(x, z)` along the
 * 360m-long 4-Depth Descending Underground Dungeon so avatars, enemies, and
 * cameras smoothly descend the subterranean stairwells from `y = 0m` down to `y = -18m`!
 */
export function getDungeonFloorY(x: number, z: number): number {
  if (!isInBrickDungeon(x, z) || z <= BRICK_DUNGEON.stairs1StartZ) return 0;
  if (z < BRICK_DUNGEON.stairs1EndZ) {
    return ((z - BRICK_DUNGEON.stairs1StartZ) / (BRICK_DUNGEON.stairs1EndZ - BRICK_DUNGEON.stairs1StartZ)) * BRICK_DUNGEON.floor2Y;
  }
  if (z <= BRICK_DUNGEON.stairs2StartZ) return BRICK_DUNGEON.floor2Y;
  if (z < BRICK_DUNGEON.stairs2EndZ) {
    return (
      BRICK_DUNGEON.floor2Y +
      ((z - BRICK_DUNGEON.stairs2StartZ) / (BRICK_DUNGEON.stairs2EndZ - BRICK_DUNGEON.stairs2StartZ)) *
        (BRICK_DUNGEON.floor3Y - BRICK_DUNGEON.floor2Y)
    );
  }
  if (z <= BRICK_DUNGEON.stairs3StartZ) return BRICK_DUNGEON.floor3Y;
  if (z < BRICK_DUNGEON.stairs3EndZ) {
    return (
      BRICK_DUNGEON.floor3Y +
      ((z - BRICK_DUNGEON.stairs3StartZ) / (BRICK_DUNGEON.stairs3EndZ - BRICK_DUNGEON.stairs3StartZ)) *
        (BRICK_DUNGEON.floor4Y - BRICK_DUNGEON.floor3Y)
    );
  }
  return BRICK_DUNGEON.floor4Y;
}

export function getDungeonFloorNumber(x: number, z: number): 0 | 1 | 2 | 3 | 4 {
  if (!isInBrickDungeon(x, z)) return 0;
  if (z < BRICK_DUNGEON.stairs1EndZ) return 1;
  if (z < BRICK_DUNGEON.stairs2EndZ) return 2;
  if (z < BRICK_DUNGEON.stairs3EndZ) return 3;
  return 4;
}

/** Proximity voice. Distances in metres; volumes 0..1. */
export const VOICE = {
  nearRadius: 8,
  farRadius: 20,
  connectRadius: 28,
  reviewMs: 500,
  speakingThreshold: 0.02,
} as const;

export const ROOMS = {
  hub: "hub",
} as const;

export const MSG = {
  move: "move",
  chat: "chat",
  notice: "notice",
  mic: "mic",
  seat: "seat",
  emote: "emote",
  /** client → server, every 15 s: still here (sockets can lie). */
  heartbeat: "heartbeat",
} as const;

/** How long a silent player survives before the server drops them (ms). */
export const PRESENCE = {
  heartbeatMs: 15_000,
  idleDropMs: 60_000,
} as const;

/** Developer / moderator controls. Every command is checked on the server. */
export const ADMIN_MSG = {
  /** request: { key } → { ok } */
  login: "admin:login",
  /** { sessionId } */
  kick: "admin:kick",
  /** { sessionId }: kicks and blocks that browser for the rest of the server's life */
  ban: "admin:ban",
  /** { mode: "auto" | "day" | "sunset" | "night" | "ist" } for everyone */
  time: "admin:time",
} as const;

export type ServerTimeMode = "auto" | "day" | "sunset" | "night" | "ist";

/** WebSocket close codes we use so the client can explain what happened. */
export const CLOSE = {
  replaced: 4012,
  kicked: 4013,
  banned: 4014,
  idle: 4015,
} as const;

export interface MicMessage {
  on: boolean;
}

export interface SeatMessage {
  seatId: number;
}

export interface EmoteMessage {
  anim: Anim;
  emoji: string;
}

export interface EmoteBroadcast {
  id: string;
  anim: Anim;
  emoji: string;
}

export interface JoinOptions {
  name: string;
  color: string;
  clientId?: string;
}

export interface MoveMessage {
  x: number;
  z: number;
  rot: number;
  anim: Anim;
}

export interface ChatSend {
  text: string;
}

export interface ChatBroadcast {
  id: string;
  name: string;
  text: string;
  at: number;
}

export interface NoticeMessage {
  text: string;
}

// ---- Shared Pixel Graffiti Mural Messages ---------------------------------

export const MURAL_MSG = {
  paint: "mural:paint",
  clear: "mural:clear",
  init: "mural:init",
  patched: "mural:patched",
} as const;

export interface MuralPaintMessage {
  x: number;
  y: number;
  colorIdx: number;
}

export interface MuralInitMessage {
  pixels: number[];
}

// ---- West Football Stadium Messages ---------------------------------------

export const FOOTBALL_MSG = {
  joinTeam: "football:team",
  kick: "football:kick",
  resetMatch: "football:reset",
  goal: "football:goal",
} as const;

export interface FootballTeamMessage {
  team: TeamId;
}

export interface FootballKickMessage {
  power?: number;
}

export interface FootballGoalBroadcast {
  scoringTeam: "red" | "blue";
  scorerName: string;
  scoreRed: number;
  scoreBlue: number;
}

// ---- East Multiplayer Arcade Messages -------------------------------------

export const ARCADE_MSG = {
  move: "arcade:move",
  reset: "arcade:reset",
  state: "arcade:state",
} as const;

export interface ArcadeMoveMessage {
  game: "c4" | "ttt" | "trivia";
  colOrCell: number;
}

export interface ArcadeStateBroadcast {
  c4Board: number[];
  c4Turn: 1 | 2;
  c4Winner: number;
  tttBoard: number[];
  tttTurn: 1 | 2;
  tttWinner: number;
  triviaIdx: number;
  triviaScores: Record<string, number>;
}

// ---- South Campfire, Forest Hunting & 4-Depth Underground Dungeon Messages -------

export const FOREST_MSG = {
  equipTool: "forest:tool",
  attackAnimal: "forest:attack",
  forageBerry: "forest:berry",
  cookMeat: "forest:cook",
  eatMeat: "forest:eat",
  dungeonAction: "forest:dungeon-action",
} as const;

export interface ForestEquipMessage {
  tool: ToolId;
}

export interface ForestAttackMessage {
  animalId: string;
}

export type DungeonActionType =
  | "lever1"
  | "lever2"
  | "chest1"
  | "chest2"
  | "chest3"
  | "rescue"
  | "struggle"
  | "burnWeb"
  | "switchL"
  | "switchR"
  | "vault"
  | "escapeSlide";

export interface DungeonActionMessage {
  action: DungeonActionType;
}

export type AnimalSpecies =
  | "rabbit"
  | "deer"
  | "boar"
  | "wolf"
  | "snake"
  | "spider"
  | "shadow_wolf"
  | "cerberus";

// ---- Friend System & Voice Privacy ----------------------------------------

export const FRIEND_MSG = {
  request: "friend:request",
  incoming: "friend:incoming",
  accept: "friend:accept",
  remove: "friend:remove",
  synced: "friend:synced",
} as const;

export interface FriendRequestSend {
  toSessionId: string;
}

export interface FriendIncomingMessage {
  fromSessionId: string;
  fromClientId: string;
  fromName: string;
  fromColor: string;
}

export interface FriendAcceptSend {
  fromClientId: string;
}

export interface FriendRemoveSend {
  friendClientId: string;
}

export interface FriendSyncedMessage {
  friendClientIds: string[];
}

// ---- Cinema Hall (Simple Link Player, Duration & Host Sync) ---------------

export interface CinemaSeat {
  id: number;
  row: number;
  col: number;
  x: number;
  y?: number;
  z: number;
  rot: number;
}

export const CINEMA_HALL = {
  centerX: 0,
  centerZ: -50,
  screenZ: -72.0,
  screenY: 6.2,
  screenWidth: 22.0,
  screenHeight: 9.5,
  minX: -16.5,
  maxX: 16.5,
  minZ: -74.5,
  maxZ: -26.0,
  seatCount: 60,
} as const;

export function isInCinemaHall(x: number, z: number): boolean {
  return x >= CINEMA_HALL.minX && x <= CINEMA_HALL.maxX && z >= CINEMA_HALL.minZ && z <= CINEMA_HALL.maxZ;
}

/**
 * Returns the floor elevation inside the Grand Tiered Stadium Cinema Hall
 * (and its grand exterior entrance stairway) so players smoothly climb up
 * the exterior marquee stairs to the entrance lobby (y = +3.6m), and then step
 * down the tiered "ladder" seating aisles (y = 3.6m -> 3.0m -> 2.4m -> 1.8m -> 1.2m -> 0.6m -> 0.0m)
 * towards the colossal screen!
 */
export function getCinemaFloorY(x: number, z: number): number {
  if (Math.abs(x) > 16.5) return 0;
  // Exterior grand entrance stairway climbing from the north avenue up to the doors
  if (z >= -26 && z <= -20 && Math.abs(x) <= 5.5) {
    return ((-20 - z) / 6) * 3.6;
  }
  if (!isInCinemaHall(x, z)) return 0;
  // Inside Cinema Hall: ladder/stadium tiers descending from back entrance down to front screen
  if (z >= -32) return 3.6; // Entrance lobby & top promenade
  if (z >= -38) return 3.0; // Tier 6 (Row 5)
  if (z >= -44) return 2.4; // Tier 5 (Row 4)
  if (z >= -50) return 1.8; // Tier 4 (Row 3)
  if (z >= -56) return 1.2; // Tier 3 (Row 2)
  if (z >= -62) return 0.6; // Tier 2 (Row 1)
  return 0.0;               // Tier 1 (Row 0) & front orchestra/stage
}

export function getWorldFloorY(x: number, z: number): number {
  if (isInBrickDungeon(x, z)) return getDungeonFloorY(x, z);
  const cinemaY = getCinemaFloorY(x, z);
  if (cinemaY > 0) return cinemaY;
  return 0;
}

/**
 * 60 Cinema Hall stadium seats (0..59) across 6 descending tiers + 10 Campfire Log seats (60..69) at z = +68.
 */
export const CINEMA_SEATS: readonly CinemaSeat[] = (() => {
  const list: CinemaSeat[] = [];
  // 6 descending stadium tiers: Row 5 (highest, near entrance) down to Row 0 (lowest, near screen)
  const tiers: Array<{ row: number; z: number; y: number }> = [
    { row: 5, z: -35.0, y: 3.0 },
    { row: 4, z: -41.0, y: 2.4 },
    { row: 3, z: -47.0, y: 1.8 },
    { row: 2, z: -53.0, y: 1.2 },
    { row: 1, z: -59.0, y: 0.6 },
    { row: 0, z: -65.0, y: 0.0 },
  ];
  // 10 seats per row: 5 left of center aisle, 5 right of center aisle
  const colXs = [-9.4, -7.6, -5.8, -4.0, -2.2, 2.2, 4.0, 5.8, 7.6, 9.4];
  let id = 0;
  for (const tier of tiers) {
    for (let c = 0; c < colXs.length; c++) {
      list.push({
        id: id++,
        row: tier.row,
        col: c,
        x: colXs[c]!,
        y: tier.y,
        z: tier.z,
        rot: Math.PI, // Facing screen at -z
      });
    }
  }
  // 10 Campfire Log seats at z = +68 (ids 60..69)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = 4.2;
    const x = Math.cos(a) * r;
    const z = CAMPFIRE_BASE.z + Math.sin(a) * r;
    const rot = Math.atan2(-x, CAMPFIRE_BASE.z - z);
    list.push({
      id: id++,
      row: 10,
      col: i,
      x: x,
      y: 0,
      z: z,
      rot: rot,
    });
  }
  // 9 Poker table seats in the Royal Arcade Hall (ids 70..78)
  for (const spot of POKER_SEAT_SPOTS) {
    list.push({ id: id++, row: 20, col: spot.index, x: spot.x, y: 0, z: spot.z, rot: spot.rot });
  }
  return list;
})();

/** Hub seat id for a poker seat index, and back. */
export function pokerSeatIdFor(index: number): number {
  return POKER_TABLE.firstSeatId + index;
}
export function pokerSeatIndexOf(seatId: number): number {
  const i = seatId - POKER_TABLE.firstSeatId;
  return i >= 0 && i < POKER_TABLE.seatCount ? i : -1;
}

export const CINEMA_MSG = {
  setUrl: "cinema:set-url",
  setDuration: "cinema:set-duration",
  control: "cinema:control",
  transferHost: "cinema:transfer-host",
  syncSeek: "cinema:sync-seek",
} as const;

export interface CinemaSetUrlMessage {
  url: string;
}

export interface CinemaSetDurationMessage {
  durationSec: number;
}

export interface CinemaControlMessage {
  action: "toggle" | "restart" | "seek";
  seekSec?: number;
}

export interface CinemaTransferHostMessage {
  targetSessionId: string;
}

export interface CinemaSyncSeekBroadcast {
  seekSec: number;
  paused: boolean;
  byName: string;
}

// ---- Idea Wall ------------------------------------------------------------

export const IDEA = {
  maxTitle: 80,
  maxDetails: 500,
  maxIdeas: 500,
  postCooldownMs: 30_000,
  boardSize: 6,
} as const;

export type IdeaStatus = "open" | "building" | "built";

export interface IdeaBuilder {
  id: string;
  name: string;
}

export interface Idea {
  id: string;
  title: string;
  details: string;
  authorId: string;
  authorName: string;
  status: IdeaStatus;
  votes: string[];
  builders: IdeaBuilder[];
  createdAt: number;
  updatedAt: number;
}

export const IDEA_MSG = {
  list: "ideas:list",
  create: "ideas:create",
  vote: "ideas:vote",
  join: "ideas:join",
  leave: "ideas:leave",
  status: "ideas:status",
  changed: "ideas:changed",
} as const;

export interface IdeaCreate {
  title: string;
  details: string;
}
export interface IdeaRef {
  id: string;
}
export interface IdeaStatusChange extends IdeaRef {
  status: IdeaStatus;
}

export function sanitizeIdeaText(raw: unknown, max: number): string {
  const text = typeof raw === "string" ? raw : "";
  return text
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function sortIdeas(ideas: Idea[]): Idea[] {
  const rank: Record<IdeaStatus, number> = { open: 0, building: 1, built: 2 };
  return [...ideas].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.votes.length - a.votes.length || b.createdAt - a.createdAt,
  );
}

export const AVATAR_COLORS = [
  "#f26d6d",
  "#f2a33a",
  "#e8d44d",
  "#6fcf7a",
  "#4fc3d9",
  "#5b8def",
  "#a66ce8",
  "#f28ac9",
] as const;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function sanitizeName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  const cleaned = text.replace(/[^\p{L}\p{N} _\-.]/gu, "").trim().slice(0, PLAYER.maxNameLength);
  return cleaned.length > 0 ? cleaned : `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
}

export function sanitizeChat(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  return text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, PLAYER.maxChatLength);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
