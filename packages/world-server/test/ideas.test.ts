import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@colyseus/sdk";
import { IDEA_MSG, ROOMS, type Idea } from "@vi/shared";
import { IdeaStore, IdeaRejected } from "../src/ideas/IdeaStore.js";
import { FilePersistence, UpstashPersistence } from "../src/ideas/persistence.js";
import { createWorldServer } from "../src/server.js";
import type { HubState } from "../src/rooms/HubState.js";

// ---- Store ------------------------------------------------------------------

test("ideas: post, vote, team up, mark built, persist and reload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vi-ideas-"));
  const file = join(dir, "ideas.json");
  const store = new IdeaStore(new FilePersistence(file));
  await store.load();

  const rahul = { id: "c:rahul", name: "Rahul" };
  const mina = { id: "c:mina", name: "Mina" };

  const idea = store.create(rahul, { title: "  A cinema   hall  ", details: "Seat pairs, silent unless both agree" });
  assert.equal(idea.title, "A cinema hall");
  assert.equal(idea.status, "open");
  assert.deepEqual(idea.votes, ["c:rahul"], "the author's own vote counts");

  assert.throws(() => store.create(rahul, { title: "Another one", details: "" }), (e: unknown) => (e as IdeaRejected).code === "too-soon");
  assert.throws(() => store.create(mina, { title: "   ", details: "" }), (e: unknown) => (e as IdeaRejected).code === "empty-title");

  store.vote(mina, idea.id);
  assert.equal(store.get(idea.id)!.votes.length, 2);
  store.vote(mina, idea.id);
  assert.equal(store.get(idea.id)!.votes.length, 1, "voting again removes the vote");

  store.join(mina, idea.id);
  assert.equal(store.get(idea.id)!.status, "building");
  assert.throws(() => store.join(mina, idea.id), (e: unknown) => (e as IdeaRejected).code === "already-builder");
  assert.throws(() => store.setStatus({ id: "c:stranger", name: "?" }, idea.id, "built"), (e: unknown) => (e as IdeaRejected).code === "not-a-builder");

  store.join(rahul, idea.id);
  assert.equal(store.get(idea.id)!.builders.length, 2, "several people can build one idea");
  store.leave(mina, idea.id);
  assert.equal(store.get(idea.id)!.status, "building", "still building while someone is on it");
  store.setStatus(rahul, idea.id, "built");
  assert.equal(store.get(idea.id)!.status, "built");

  await store.flush();
  const onDisk = JSON.parse(await readFile(file, "utf8")) as { ideas: Idea[] };
  assert.equal(onDisk.ideas.length, 1);

  const reloaded = new IdeaStore(new FilePersistence(file));
  await reloaded.load();
  assert.equal(reloaded.get(idea.id)?.title, "A cinema hall");
  assert.equal(reloaded.get(idea.id)?.status, "built");

  await rm(dir, { recursive: true, force: true });
});

test("ideas: upstash persistence speaks the REST protocol", async () => {
  // A fake Upstash: records commands, answers GET from what SET stored.
  const calls: string[][] = [];
  let stored: string | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const args = JSON.parse(String(init?.body)) as string[];
    calls.push(args);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer tok");
    if (args[0] === "SET") stored = args[2]!;
    return new Response(JSON.stringify({ result: args[0] === "GET" ? stored : "OK" }), { status: 200 });
  }) as typeof fetch;
  try {
    const store = new IdeaStore(new UpstashPersistence("https://example.upstash.io", "tok"));
    await store.load();
    store.create({ id: "c:a", name: "A" }, { title: "Persist me", details: "" });
    await store.flush();
    assert.deepEqual(calls.map((c) => c[0]), ["GET", "SET"]);

    const again = new IdeaStore(new UpstashPersistence("https://example.upstash.io", "tok"));
    await again.load();
    assert.equal(again.list()[0]?.title, "Persist me");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("ideas: open ideas sort first, then by votes", () => {
  const store = new IdeaStore();
  const a = { id: "a", name: "A" };
  const b = { id: "b", name: "B" };
  const c = { id: "c", name: "C" };
  const low = store.create(a, { title: "low", details: "" }, 1000);
  const high = store.create(b, { title: "high", details: "" }, 2000);
  const done = store.create(c, { title: "done", details: "" }, 3000);
  store.vote(a, high.id);
  store.vote(c, high.id);
  store.join(c, done.id);
  store.setStatus(c, done.id, "built");
  assert.deepEqual(
    store.list().map((i) => i.title),
    ["high", "low", "done"],
  );
});

// ---- Through the room ---------------------------------------------------------

const PORT = 20000 + Math.floor(Math.random() * 10000);
const server = createWorldServer();

before(async () => {
  await server.listen(PORT);
});

after(async () => {
  await server.gracefullyShutdown(false);
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

test("ideas over the wire: request/response, broadcast, stable identity", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const rahul = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Rahul", color: "#f26d6d", clientId: "rahul-browser-1" });
  const mina = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Mina", color: "#5b8def", clientId: "mina-browser-1" });

  const heard: Idea[] = [];
  mina.onMessage(IDEA_MSG.changed, (idea: Idea) => heard.push(idea));
  rahul.onMessage(IDEA_MSG.changed, () => {});

  const created = await rahul.request<unknown, Idea>(IDEA_MSG.create, { title: "Anime expo district", details: "Watch rooms and panels" });
  assert.equal(created.authorName, "Rahul");
  assert.equal(created.authorId, "c:rahul-browser-1", "identity comes from the browser id, not the session");

  await sleep(100);
  assert.equal(heard.length, 1, "everyone in the room hears about the new idea");

  const joined = await mina.request<unknown, Idea>(IDEA_MSG.join, { id: created.id });
  assert.equal(joined.status, "building");
  assert.deepEqual(joined.builders.map((b) => b.name), ["Mina"]);

  const list = await rahul.request<unknown, Idea[]>(IDEA_MSG.list);
  assert.ok(list.some((i) => i.id === created.id));

  // A stranger cannot mark it built; the request rejects with a reason.
  await assert.rejects(
    rahul.request(IDEA_MSG.status, { id: "nope", status: "built" }),
    (err: Error & { reason?: string }) => err.reason === "not-found",
  );

  await rahul.leave();
  await mina.leave();
});
