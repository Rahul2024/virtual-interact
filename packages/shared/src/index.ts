/**
 * Constants and message contracts shared by the world server and the client.
 * Keep this file dependency-free: it is imported by both sides.
 */

/**
 * Where the code lives. Shown as the "Source" link in the client (the AGPL
 * asks a network service to offer its source). Replace OWNER after publishing.
 */
export const REPO_URL = "https://github.com/OWNER/virtual-interact";

/** World units are metres. The hub is a square centred on the origin. */
export const WORLD = {
  /** Full edge length of the walkable area. */
  size: 120,
  /** Half edge: positions are clamped to [-half, half] on x and z. */
  half: 60,
} as const;

export const PLAYER = {
  walkSpeed: 4, // m/s
  runSpeed: 7, // m/s
  /** Server rejects movement faster than this (with some slack for jitter). */
  maxSpeed: 8, // m/s
  radius: 0.4, // collision radius, m
  height: 1.7, // m
  maxNameLength: 20,
  maxChatLength: 240,
} as const;

export const NET = {
  /** How often the client sends its position. */
  sendHz: 10,
  /** How often the server broadcasts state patches (ms). */
  patchMs: 50,
  /** Maximum messages a client may send per second before being disconnected. */
  maxMessagesPerSecond: 30,
} as const;

/** Animation states. Kept numeric so they fit in one byte on the wire. */
export const ANIM = {
  idle: 0,
  walk: 1,
  run: 2,
} as const;
export type Anim = (typeof ANIM)[keyof typeof ANIM];

/** Proximity voice. Distances in metres; volumes 0..1. */
export const VOICE = {
  /** Full volume inside this radius. */
  nearRadius: 8,
  /** Silent beyond this radius. Linear falloff in between. */
  farRadius: 20,
  /** Peers beyond this are not connected at all (saves bandwidth). */
  connectRadius: 26,
  /** Peer connections are (re)evaluated this often. */
  reviewMs: 500,
  /** Mic level above this counts as speaking (RMS, 0..1). */
  speakingThreshold: 0.02,
} as const;

/** Room names registered on the world server. */
export const ROOMS = {
  hub: "hub",
} as const;

/** Message types. Client → server and server → client share one namespace. */
export const MSG = {
  /** client → server: my new position */
  move: "move",
  /** client → server: say something; server → everyone: someone said something */
  chat: "chat",
  /** server → client: something went wrong with your last message */
  notice: "notice",
  /** client → server: my microphone is open / closed */
  mic: "mic",
} as const;

export interface MicMessage {
  on: boolean;
}

export interface JoinOptions {
  name: string;
  /** Hex colour like "#ff8800". */
  color: string;
  /**
   * A random id the browser keeps in localStorage, so votes and claims on the
   * Idea Wall survive a reload. Accounts replace this later.
   */
  clientId?: string;
}

export interface MoveMessage {
  x: number;
  z: number;
  /** Yaw in radians. */
  rot: number;
  anim: Anim;
}

export interface ChatSend {
  text: string;
}

export interface ChatBroadcast {
  /** Session id of the speaker. */
  id: string;
  name: string;
  text: string;
  /** Server timestamp, ms since epoch. */
  at: number;
}

export interface NoticeMessage {
  text: string;
}

// ---- Idea Wall ------------------------------------------------------------
//
// The city is built by the people in it. Anyone can post what they want the
// place to have, anyone can vote, and anyone can say "I'll build this".

export const IDEA = {
  maxTitle: 80,
  maxDetails: 500,
  /** Ideas kept per server; the oldest "built" ones are dropped past this. */
  maxIdeas: 500,
  /** Minimum ms between two ideas from the same person. */
  postCooldownMs: 30_000,
  /** How many ideas the in-world board shows. */
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
  /** clientIds that upvoted. */
  votes: string[];
  builders: IdeaBuilder[];
  createdAt: number;
  updatedAt: number;
}

/** Request/response message types for the Idea Wall. */
export const IDEA_MSG = {
  list: "ideas:list",
  create: "ideas:create",
  vote: "ideas:vote",
  join: "ideas:join",
  leave: "ideas:leave",
  status: "ideas:status",
  /** server → everyone: one idea changed (or was created). */
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

/** Open first, then by votes, then newest. */
export function sortIdeas(ideas: Idea[]): Idea[] {
  const rank: Record<IdeaStatus, number> = { open: 0, building: 1, built: 2 };
  return [...ideas].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.votes.length - a.votes.length || b.createdAt - a.createdAt,
  );
}

/** Palette offered in the join screen; the server accepts any valid hex though. */
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
