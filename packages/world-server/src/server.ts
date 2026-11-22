import { defineServer, defineRoom, createEndpoint, createRouter, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOMS } from "@vi/shared";
import { HubRoom } from "./rooms/HubRoom.js";
import { PokerRoom } from "./rooms/PokerRoom.js";
import { POKER_ROOM } from "@vi/shared/poker";

const startedAt = Date.now();

/** Hosts poll this to know we're alive; the client polls it to wake a sleeping free host. */
const health = createEndpoint("/health", { method: "GET" }, async () => {
  const rooms = await matchMaker.query({ name: ROOMS.hub });
  return {
    ok: true,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    hubs: rooms.length,
    people: rooms.reduce((n, r) => n + r.clients, 0),
  };
});

/**
 * Builds the world server without starting it, so tests can boot one on a
 * spare port and main.ts can boot the real one.
 */
export function createWorldServer() {
  return defineServer({
    // Multi-peer WebRTC offers and ICE bursts can exceed 16 KB.
    // beforeUpgrade calls checkReconnectionToken so half-open stale sockets are closed immediately on reconnect.
    transport: new WebSocketTransport({
      maxPayload: 64 * 1024,
      pingInterval: 10_000,
      pingMaxRetries: 5,
      beforeUpgrade(request) {
        try {
          const url = new URL(request.url);
          const reconnectionToken = url.searchParams.get("reconnectionToken");
          const m = url.pathname.match(/\/[a-zA-Z0-9_-]+\/([a-zA-Z0-9_-]+)$/);
          const roomId = m?.[1];
          if (reconnectionToken && roomId) {
            const room = matchMaker.getLocalRoomById(roomId);
            room?.checkReconnectionToken(reconnectionToken);
          }
        } catch {
          /* ignore malformed upgrade URLs */
        }
      },
    }),
    rooms: {
      [ROOMS.hub]: defineRoom(HubRoom),
      [POKER_ROOM]: defineRoom(PokerRoom).filterBy(["tableId"]),
    },
    routes: createRouter({ health }),
  });
}
