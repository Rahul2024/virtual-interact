/**
 * Constants and message contracts shared by the world server and the client.
 * Keep this file dependency-free: it is imported by both sides.
 */

export const REPO_URL = "https://github.com/Rahul2024/virtual-interact";

/**
 * Expanded World: 1040m × 1040m (-520 to +520 on X and Z) to fit all city
 * districts, the Deep Southern Forest, and the 360m-long 4-Floor Ascending
 * Frieren-Style Stone-Brick Hallway Dungeon (`z = +120..+480`).
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
 * 360m-Long 4-Floor Ascending Frieren-Style Stone-Brick Hallway Dungeon
 * ("The Spire of the 3-Faced Dire Wolf" at `x = -24..+24, z = +120..+480`):
 *
 * - FLOOR 1 (`z = 120..210`, `y = 0m` — ❄️ ICE HEAD THEME: Frost-Fang Aqueduct Hallway):
 *   - Flooded freezing underground canal (`z = 132..172`) with 10 slippery ice stepping-stones,
 *     waterfalls pouring from wall grates & dripping ceiling icicles (`z = 138, 152, 166`),
 *     plus branching West & East outer brick walkways (`x = ±14`).
 *   - Cracked frost-slab booby traps (`z = 126..182`) & sweeping Frost-Arrow Volleys.
 *   - Shifting Brick T-Junction Levers (`z = 186`) & 3-Chest Frost Mimic Alcove (`z = 192..208`)
 *     + Secret Brick Bookcase Wall at `z = 210`.
 * - STAIRCASE 1→2 (`z = 210..226`): Grand Stone-Brick Stairway climbing `y = 0m -> +6.0m`.
 * - FLOOR 2 (`z = 226..316`, `y = +6.0m` — 🔥 FIRE HEAD THEME: Crimson-Ember & Spider-Web Hallway):
 *   - Long elevated stone-brick hallway flanked by glowing magma channels & branching West/East galleries.
 *   - Sticky Cinder-Spider Web Nets (`z = 238, 256, 274`) that slow movement until burned with a 🔥 Torch
 *     + 4 Giant Ceiling Spiders (`spider-1..4`) dropping on silk threads.
 *   - Timed Flame-Jet Wall Vents, Swinging Molten Pendulum Blades (`z = 262, 278, 294`), and
 *     Rolling Fire-Boulders (`fireBoulderZ` in `282..314`).
 * - STAIRCASE 2→3 (`z = 316..332`): Ascending Stone-Brick Stairway climbing `y = +6.0m -> +12.0m`.
 * - FLOOR 3 (`z = 332..404`, `y = +12.0m` — 🌑 SHADOW HEAD THEME: Shadow-Mana Chasm & Wolf Den):
 *   - Long vaulted purple-slate brick hallway with 3 branching paths over a bottomless abyss (`z = 340..368`),
 *     Parallel Iron-Bar Corridors with Loose Brick Portcullis Switches (`z = 372..392`, Gate at `z = 388`),
 *     and 4 prowling Small Shadow Wolves (`shadow-wolf-1..4`) that howl and ambush players on the approach!
 * - STAIRCASE 3→4 (`z = 404..420`): Grand Sanctum Stairway climbing `y = +12.0m -> +18.0m`.
 * - FLOOR 4 (`z = 420..480`, `y = +18.0m` — 👑 BOSS SANCTUM: Colossal Hall of the 3-Faced Dire Wolf):
 *   - 44m-wide vaulted stone-brick boss arena where Cerberus, the 3-Faced Dire Wolf (`boss-cerberus`, 30 HP)
 *     guards the Golden Royal Vault (`z = 470`) and the Waterfall Return Slide (`z = 476`).
 */
export const BRICK_DUNGEON = {
  centerX: 0,
  startZ: 120,
  endZ: 480,
  halfW: 19.0,
  bossHalfW: 22.0,

  // Floor 1: Ice Hallway (z = 120..210, y = 0)
  waterStartZ: 132,
  waterEndZ: 172,
  hall1EndZ: 184,
  junctionZ: 186,
  mimicRoomStartZ: 190,
  mimicRoomEndZ: 210,
  secretWallZ: 210,

  // Staircase 1->2 (z = 210..226, y = 0..6)
  stairs1StartZ: 210,
  stairs1EndZ: 226,
  floor2Y: 6.0,

  // Floor 2: Fire & Spider-Web Hallway (z = 226..316, y = 6)
  web1Z: 238,
  web2Z: 256,
  web3Z: 274,
  pendulum1Z: 262,
  pendulum2Z: 278,
  pendulum3Z: 294,
  boulderStartZ: 280,
  boulderEndZ: 314,
  floor2EndZ: 316,

  // Staircase 2->3 (z = 316..332, y = 6..12)
  stairs2StartZ: 316,
  stairs2EndZ: 332,
  floor3Y: 12.0,

  // Floor 3: Shadow Chasm & Wolf Den Hallway (z = 332..404, y = 12)
  chasmStartZ: 340,
  chasmEndZ: 368,
  parallelStartZ: 372,
  switchZ: 382,
  gateZ: 388,
  floor3EndZ: 404,

  // Staircase 3->4 (z = 404..420, y = 12..18)
  stairs3StartZ: 404,
  stairs3EndZ: 420,
  floor4Y: 18.0,

  // Floor 4: Colossal Boss Sanctum (z = 420..480, y = 18)
  sanctumStartZ: 420,
  bossHomeZ: 446,
  vaultChestZ: 470,
  escapeSlideZ: 476,
} as const;

export function isInBrickDungeon(x: number, z: number): boolean {
  const maxW = z >= BRICK_DUNGEON.sanctumStartZ ? BRICK_DUNGEON.bossHalfW + 3 : BRICK_DUNGEON.halfW + 3;
  return Math.abs(x - BRICK_DUNGEON.centerX) <= maxW && z >= BRICK_DUNGEON.startZ - 3 && z <= BRICK_DUNGEON.endZ + 3;
}

/**
 * Returns the vertical floor elevation `y` (in metres) at `(x, z)` along the
 * 360m-long 4-Floor Ascending Stone-Brick Dungeon so avatars, enemies, and
 * cameras smoothly climb the staircases from `y = 0m` up to `y = +18m`!
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

// ---- South Campfire, Forest Hunting & 4-Floor Brick Dungeon Messages -------

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
  z: number;
  rot: number;
}

export const CINEMA_HALL = {
  centerX: 0,
  centerZ: -44,
  screenZ: -54.5,
  screenY: 3.9,
  screenWidth: 13.5,
  screenHeight: 5.6,
  minX: -10.5,
  maxX: 10.5,
  minZ: -56,
  maxZ: -33,
} as const;

export function isInCinemaHall(x: number, z: number): boolean {
  return x >= CINEMA_HALL.minX && x <= CINEMA_HALL.maxX && z >= CINEMA_HALL.minZ && z <= CINEMA_HALL.maxZ;
}

/**
 * 24 Cinema Hall seats (0..23) + 10 Campfire Log seats (24..33) at z = +68.
 */
export const CINEMA_SEATS: readonly CinemaSeat[] = (() => {
  const list: CinemaSeat[] = [];
  const rowZs = [-44.5, -41.2, -37.9];
  const colXs = [-6.2, -4.6, -3.0, -1.4, 1.4, 3.0, 4.6, 6.2];
  let id = 0;
  for (let r = 0; r < rowZs.length; r++) {
    for (let c = 0; c < colXs.length; c++) {
      list.push({
        id: id++,
        row: r,
        col: c,
        x: colXs[c]!,
        z: rowZs[r]!,
        rot: Math.PI,
      });
    }
  }
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
      z: z,
      rot: rot,
    });
  }
  return list;
})();

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
