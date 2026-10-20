import { defineServer, defineRoom, createEndpoint, createRouter, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOMS } from "@vi/shared";
import { HubRoom } from "./rooms/HubRoom.js";

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
    // WebRTC offers can exceed the default 4 KB message limit.
    transport: new WebSocketTransport({ maxPayload: 16 * 1024 }),
    rooms: {
      [ROOMS.hub]: defineRoom(HubRoom),
    },
    routes: createRouter({ health }),
  });
}
