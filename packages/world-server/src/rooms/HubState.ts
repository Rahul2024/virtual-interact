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
    /** 1..3 when chomped head-first inside Mimic Chest #1..#3, 0 when free. */
    mimicTrapped: t.uint8().default(0),
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
    /** Set by an admin for everyone; "auto" lets each client pick. */
    timeMode: t.string().default("auto" as string),
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
    /** South Forest & 4-Floor Dungeon creatures (snakes, spiders, shadow wolves, 3-Faced Dire Wolf boss). */
    animals: t.map(ForestAnimal),
    /** Floor 1 Brick Dungeon state: 1 = West Brick Wing open, 2 = East Brick Wing open. */
    dungeonWing: t.uint8().default(1),
    /** Seed (0..2) controlling which floor bricks are cracked and which Chest holds the Grimoire Key. */
    dungeonSeed: t.uint8().default(0),
    /** 1 when the Grimoire Key chest has been found, sliding open the secret brick wall at z = 210. */
    grimoireFound: t.uint8().default(0),
    /** Bitmask (0..7) of burned Spider-Web Curtains on Floor 2 (bit 1 = web1, bit 2 = web2, bit 4 = web3). */
    websBurned: t.uint8().default(0),
    /** 1 when Left Iron Portcullis Gate at z = 388 (Floor 3) is raised. */
    gateLeftOpen: t.uint8().default(0),
    /** 1 when Right Iron Portcullis Gate at z = 388 (Floor 3) is raised. */
    gateRightOpen: t.uint8().default(0),
    /** 1 when the King's Tomb Golden Vault at z = 470 (Floor 4) is unlocked. */
    vaultUnlocked: t.uint8().default(0),
    /** Current Z coordinate of the Frost-Arrow Volley sweeping down Floor 1. */
    arrowVolleyZ: t.float32().default(184),
    /** Current Z coordinate of the Rolling Fire-Boulder rumbling down Floor 2. */
    fireBoulderZ: t.float32().default(314),
  },
  "HubState",
);
export type HubState = SchemaType<typeof HubState>;
