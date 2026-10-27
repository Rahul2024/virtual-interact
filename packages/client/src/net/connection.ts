import { Client, Callbacks, type Room } from "@colyseus/sdk";
import { ROOMS, type JoinOptions } from "@vi/shared";
import type { HubState } from "@vi/world-server/state";

export type HubRoom = Room<any, HubState>;
export type HubCallbacks = ReturnType<typeof Callbacks.get<HubState>>;

/**
 * Where the world server is. In order:
 *   VITE_SERVER_URL   a full URL, e.g. wss://world.example.com or ws://10.0.0.5:2567
 *   VITE_SERVER_HOST  just a hostname (what a hosting blueprint hands us); wss:// is assumed
 *   otherwise         proxied through the same host at /colyseus so a single tunnel link works globally
 */
export function serverUrl(): string {
  const url = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (url) return url.includes("://") ? url : `wss://${url}`;
  const host = (import.meta.env.VITE_SERVER_HOST as string | undefined)?.trim();
  if (host) return host.includes("://") ? host : `wss://${host}`;
  if (location.hostname.endsWith(".onrender.com")) {
    return "wss://virtual-interact-server.onrender.com";
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/colyseus`;
}

/** The http(s) twin of the ws(s) URL, for /health. */
function httpUrl(): string {
  return serverUrl().replace(/^ws/, "http");
}

/**
 * Free hosts put the server to sleep when nobody is around and take up to a
 * minute to wake it. Poll /health until it answers, telling the person why
 * they're waiting, so the join itself doesn't fail on a loading page.
 */
export async function waitForServer(onStatus: (text: string) => void, maxMs = 120_000): Promise<void> {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const res = await fetch(`${httpUrl()}/health`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (body.ok) return;
      }
    } catch {
      /* not up yet */
    }
    const waited = Math.round((Date.now() - started) / 1000);
    if (Date.now() - started > maxMs) throw new Error("server did not wake up in time");
    onStatus(
      attempt === 1
        ? "Waking the world server up… free hosting sleeps when it's quiet. Up to a minute."
        : `Still waking the server up… ${waited}s`,
    );
    await new Promise((r) => setTimeout(r, 4000));
  }
}

/**
 * A random id this browser keeps, so Idea Wall votes and claims survive a
 * reload. The server prefixes it ("c:<id>"); accounts replace it later.
 */
export function clientId(): string {
  try {
    const saved = localStorage.getItem("vi.clientId");
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem("vi.clientId", fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

export async function joinHub(options: JoinOptions): Promise<{ room: HubRoom; callbacks: HubCallbacks; myId: string }> {
  const client = new Client(serverUrl());
  const id = options.clientId ?? clientId();
  const room = await client.joinOrCreate<HubState>(ROOMS.hub, { ...options, clientId: id });
  const callbacks = Callbacks.get(room);
  return { room, callbacks, myId: `c:${id}` };
}
