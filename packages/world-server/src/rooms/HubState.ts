import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * One person in a zone. Everything here is broadcast to every client in the
 * zone on each patch, so keep it small: the client derives everything else.
 */
export const Player = schema(
  {
    name: t.string().default(""),
    color: t.string().default("#ffffff"),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    /** Yaw in radians. */
    rot: t.float32().default(0),
    /** 0 idle, 1 walk, 2 run (see ANIM in @vi/shared). */
    anim: t.uint8().default(0),
    /** Microphone is open (0/1). Shown as a small icon on the nameplate. */
    mic: t.uint8().default(0),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

export const HubState = schema(
  {
    zone: t.string().default("hub"),
    players: t.map(Player),
  },
  "HubState",
);
export type HubState = SchemaType<typeof HubState>;
