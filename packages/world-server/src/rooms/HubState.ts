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
    /** South Forest roaming wildlife. */
    animals: t.map(ForestAnimal),
  },
  "HubState",
);
export type HubState = SchemaType<typeof HubState>;
