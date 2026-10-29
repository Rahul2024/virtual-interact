import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * One person in a zone. Everything here is broadcast to every client in the
 * zone on each patch, so keep it small: the client derives everything else.
 */
export const Player = schema(
  {
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    clientId: t.string().default(""),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    rot: t.float32().default(0),
    anim: t.uint8().default(0),
    mic: t.uint8().default(0),
    seatId: t.int16().default(-1),
    tool: t.uint8().default(0),
    team: t.uint8().default(0),
    rawMeat: t.uint8().default(0),
    cookedMeat: t.uint8().default(0),
    energy: t.uint8().default(80),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const ForestAnimal = schema(
  {
    id: t.string().default(""),
    species: t.string().default("deer"),
    x: t.float32().default(0),
    z: t.float32().default(75),
    rot: t.float32().default(0),
    hp: t.uint8().default(3),
    maxHp: t.uint8().default(3),
  },
  "ForestAnimal",
);
export type ForestAnimal = SchemaType<typeof ForestAnimal>;

export const HubState = schema(
  {
    zone: t.string().default("hub"),
    players: t.map(Player),
    /** Session ID of the authoritative Cinema Host (1st person in the Cinema Hall). */
    cinemaHostId: t.string().default(""),
    /** Display name of the current Cinema Host. */
    cinemaHostName: t.string().default(""),
    /** Direct video or YouTube URL set by the Cinema Host (empty when idle). */
    movieUrl: t.string().default(""),
    /** Actual duration of the current video in seconds (0 until detected). */
    movieDurationSec: t.float32().default(0),
    /** Epoch timestamp (ms) when current playback started (for sync). */
    movieStartedAt: t.float64().default(0),
    /** 1 if movie is paused, 0 if playing. */
    moviePaused: t.uint8().default(0),
    /** Playback offset in seconds when paused. */
    moviePausedAtSec: t.float32().default(0),
    /** West Football Stadium ball & scoreboard. */
    ballX: t.float32().default(-82),
    ballZ: t.float32().default(0),
    scoreRed: t.uint8().default(0),
    scoreBlue: t.uint8().default(0),
    /** South Forest roaming wildlife (including slithering snakes). */
    animals: t.map(ForestAnimal),
    /** Shifting Cave Dungeon state (changes dynamically as players make decisions). */
    dungeonVariant: t.uint8().default(0),
    /** Chamber 1 Decision: 1 = Left Corridor (Trial of Blades), 2 = Right Corridor (Trial of Shadows). */
    dungeonChoice1: t.uint8().default(1),
    /** Chamber 3 Decision: 1 = Pendulum Speed Mode, 2 = Rolling Boulder Surge Mode. */
    dungeonChoice2: t.uint8().default(1),
    /** 1 when the Sanctum Treasure Vault gate is unlocked, 0 when sealed. */
    dungeonGateOpen: t.uint8().default(0),
    /** Current Z coordinate of the rolling boulder trap in Chamber 3 (162..185). */
    boulderZ: t.float32().default(164),
    /** Current X lane of the rolling boulder (-3.2, 0, or +3.2 relative to cave center). */
    boulderLaneX: t.float32().default(48),
  },
  "HubState",
);
export type HubState = SchemaType<typeof HubState>;
