import { Room, definePlugins, type Client } from "colyseus";
import { WebRTCPlugin } from "colyseus/plugins/webrtc";
import type { MessageContext } from "@colyseus/shared-types";
import {
  ANIM,
  IDEA_MSG,
  MSG,
  NET,
  PLAYER,
  WORLD,
  clamp,
  isHexColor,
  sanitizeChat,
  sanitizeName,
  type ChatBroadcast,
  type ChatSend,
  type Idea,
  type IdeaCreate,
  type IdeaRef,
  type IdeaStatusChange,
  type JoinOptions,
  type MicMessage,
  type MoveMessage,
  type NoticeMessage,
} from "@vi/shared";
import { HubState, Player } from "./HubState.js";
import { ideas, ideasReady, IdeaRejected } from "../ideas/index.js";

/** Per-client bookkeeping that never leaves the server. */
interface Session {
  lastMoveAt: number;
  lastChatAt: number;
  /** Stable per-browser id for votes and claims; falls back to the session id. */
  clientId: string;
}

/** Slack on top of maxSpeed so a jittery connection is not treated as cheating. */
const SPEED_SLACK = 1.5;

/**
 * The hub zone. One instance holds up to `maxClients` people; Colyseus spins
 * up another instance when it fills, which is the "shard" from the design doc.
 */
export class HubRoom extends Room<{ state: HubState }> {
  override maxClients = 100;
  override patchRate = NET.patchMs;
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;
  override autoDispose = true;

  override state = new HubState();

  /**
   * Voice is peer-to-peer for now: browsers send audio straight to each other
   * and only the signaling (offer/answer/ICE) passes through here. This is
   * fine for a handful of people near each other; LiveKit replaces it when a
   * plaza fills up (see the design doc).
   */
  override plugins = definePlugins([new WebRTCPlugin()]);

  private sessions = new Map<string, Session>();

  override messages = {
    [MSG.move]: (client: Client, payload: MoveMessage) => this.onMove(client, payload),
    [MSG.chat]: (client: Client, payload: ChatSend) => this.onChat(client, payload),
    [MSG.mic]: (client: Client, payload: MicMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.mic = payload?.on ? 1 : 0;
    },

    // Idea Wall: request/response. Return a value to answer, ctx.reject to refuse.
    [IDEA_MSG.list]: (): Idea[] => ideas.list(),
    [IDEA_MSG.create]: (client: Client, payload: IdeaCreate, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.create(who, { title: payload?.title, details: payload?.details })),
    [IDEA_MSG.vote]: (client: Client, payload: IdeaRef, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.vote(who, payload?.id)),
    [IDEA_MSG.join]: (client: Client, payload: IdeaRef, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.join(who, payload?.id)),
    [IDEA_MSG.leave]: (client: Client, payload: IdeaRef, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.leave(who, payload?.id)),
    [IDEA_MSG.status]: (client: Client, payload: IdeaStatusChange, ctx: MessageContext) =>
      this.ideaAction(client, ctx, (who) => ideas.setStatus(who, payload?.id, payload?.status)),
  };

  override async onCreate(): Promise<void> {
    await ideasReady;
    console.log(`[hub] room ${this.roomId} created`);
  }

  override onJoin(client: Client, options: Partial<JoinOptions> | undefined): void {
    const player = new Player();
    player.name = sanitizeName(options?.name);
    player.color = isHexColor(options?.color) ? options.color : "#5b8def";

    // Spawn on a ring around the fountain so people don't pile up on one spot.
    const angle = Math.random() * Math.PI * 2;
    const radius = 7 + Math.random() * 3;
    player.x = Math.cos(angle) * radius;
    player.z = Math.sin(angle) * radius;
    player.rot = Math.atan2(-player.x, -player.z); // face the centre
    player.anim = ANIM.idle;

    const rawId = options?.clientId;
    const clientId =
      typeof rawId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(rawId) ? `c:${rawId}` : `s:${client.sessionId}`;

    this.state.players.set(client.sessionId, player);
    this.sessions.set(client.sessionId, { lastMoveAt: Date.now(), lastChatAt: 0, clientId });

    console.log(`[hub] ${player.name} joined (${this.clients.length} in room)`);
  }

  override onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    console.log(`[hub] ${player?.name ?? client.sessionId} left (${this.clients.length} in room)`);
  }

  override onDispose(): void {
    console.log(`[hub] room ${this.roomId} disposed`);
  }

  /**
   * Movement is client-predicted and server-validated: the client tells us
   * where it is, we make sure that is physically plausible (speed, bounds) and
   * if not, we pull it back. Everyone else sees the validated position.
   */
  private onMove(client: Client, payload: MoveMessage): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;
    if (!isFinite(payload?.x) || !isFinite(payload?.z) || !isFinite(payload?.rot)) return;

    const now = Date.now();
    const dt = Math.max((now - session.lastMoveAt) / 1000, 1 / 60);
    session.lastMoveAt = now;

    let x = clamp(payload.x, -WORLD.half, WORLD.half);
    let z = clamp(payload.z, -WORLD.half, WORLD.half);

    const dx = x - player.x;
    const dz = z - player.z;
    const dist = Math.hypot(dx, dz);
    const allowed = PLAYER.maxSpeed * SPEED_SLACK * dt;
    if (dist > allowed && dist > 0) {
      // Too fast: move as far as allowed in that direction, no further.
      const k = allowed / dist;
      x = player.x + dx * k;
      z = player.z + dz * k;
    }

    player.x = x;
    player.z = z;
    player.rot = payload.rot;
    player.anim = payload.anim === ANIM.run ? ANIM.run : payload.anim === ANIM.walk ? ANIM.walk : ANIM.idle;
  }

  private onChat(client: Client, payload: ChatSend): void {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return;

    const text = sanitizeChat(payload?.text);
    if (text.length === 0) return;

    const now = Date.now();
    if (now - session.lastChatAt < 500) {
      client.send(MSG.notice, { text: "Slow down a little." } satisfies NoticeMessage);
      return;
    }
    session.lastChatAt = now;

    const message: ChatBroadcast = { id: client.sessionId, name: player.name, text, at: now };
    this.broadcast(MSG.chat, message);
  }

  /**
   * Runs one Idea Wall change as the calling person, answers the request with
   * the updated idea, and tells everyone in the room about it. Other hub
   * instances on this process share the store, so they see it on next list.
   */
  private ideaAction(client: Client, ctx: MessageContext, action: (who: { id: string; name: string }) => Idea) {
    const player = this.state.players.get(client.sessionId);
    const session = this.sessions.get(client.sessionId);
    if (!player || !session) return ctx.reject("not-in-room");
    try {
      const idea = action({ id: session.clientId, name: player.name });
      this.broadcast(IDEA_MSG.changed, idea);
      return idea;
    } catch (err) {
      if (err instanceof IdeaRejected) return ctx.reject(err.code);
      throw err;
    }
  }
}
