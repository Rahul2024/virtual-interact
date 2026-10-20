import { randomUUID } from "node:crypto";
import { IDEA, sanitizeIdeaText, sortIdeas, type Idea, type IdeaStatus } from "@vi/shared";
import { MemoryPersistence, type Persistence } from "./persistence.js";

/** Why a change was refused; the client shows these as-is. */
export type IdeaError =
  | "not-found"
  | "empty-title"
  | "too-soon"
  | "not-a-builder"
  | "already-builder"
  | "bad-status"
  | "full";

export class IdeaRejected extends Error {
  constructor(readonly code: IdeaError) {
    super(code);
  }
}

interface Person {
  id: string;
  name: string;
}

/**
 * All the ideas, kept in memory and mirrored to a Persistence (file, Redis,
 * later Postgres). Every hub instance on this process shares it.
 */
export class IdeaStore {
  private ideas = new Map<string, Idea>();
  private lastPostAt = new Map<string, number>();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<void> = Promise.resolve();
  private readonly persistence: Persistence;

  constructor(persistence: Persistence = new MemoryPersistence()) {
    this.persistence = persistence;
  }

  async load(): Promise<void> {
    try {
      for (const idea of await this.persistence.load()) this.ideas.set(idea.id, idea);
      console.log(`[ideas] ${this.ideas.size} ideas loaded (${this.persistence.name})`);
    } catch (err) {
      console.warn(`[ideas] could not load from ${this.persistence.name}:`, err);
    }
  }

  list(): Idea[] {
    return sortIdeas([...this.ideas.values()]);
  }

  get(id: string): Idea | undefined {
    return this.ideas.get(id);
  }

  create(author: Person, input: { title: unknown; details: unknown }, now = Date.now()): Idea {
    const title = sanitizeIdeaText(input.title, IDEA.maxTitle);
    const details = sanitizeIdeaText(input.details, IDEA.maxDetails);
    if (!title) throw new IdeaRejected("empty-title");

    const last = this.lastPostAt.get(author.id);
    if (last !== undefined && now - last < IDEA.postCooldownMs) throw new IdeaRejected("too-soon");

    if (this.ideas.size >= IDEA.maxIdeas && !this.evictOne()) throw new IdeaRejected("full");

    const idea: Idea = {
      id: randomUUID(),
      title,
      details,
      authorId: author.id,
      authorName: author.name,
      status: "open",
      votes: [author.id],
      builders: [],
      createdAt: now,
      updatedAt: now,
    };
    this.ideas.set(idea.id, idea);
    this.lastPostAt.set(author.id, now);
    this.scheduleSave();
    return idea;
  }

  /** Toggles the voter's upvote. */
  vote(voter: Person, id: string, now = Date.now()): Idea {
    const idea = this.require(id);
    const i = idea.votes.indexOf(voter.id);
    if (i >= 0) idea.votes.splice(i, 1);
    else idea.votes.push(voter.id);
    return this.touch(idea, now);
  }

  /** "I'll build this." Several people can; the idea becomes `building`. */
  join(builder: Person, id: string, now = Date.now()): Idea {
    const idea = this.require(id);
    if (idea.builders.some((b) => b.id === builder.id)) throw new IdeaRejected("already-builder");
    idea.builders.push({ id: builder.id, name: builder.name });
    if (idea.status === "open") idea.status = "building";
    return this.touch(idea, now);
  }

  leave(builder: Person, id: string, now = Date.now()): Idea {
    const idea = this.require(id);
    const i = idea.builders.findIndex((b) => b.id === builder.id);
    if (i < 0) throw new IdeaRejected("not-a-builder");
    idea.builders.splice(i, 1);
    if (idea.builders.length === 0 && idea.status === "building") idea.status = "open";
    return this.touch(idea, now);
  }

  /** Builders (or the author) move an idea between building and built. */
  setStatus(actor: Person, id: string, status: IdeaStatus, now = Date.now()): Idea {
    const idea = this.require(id);
    const allowed = idea.builders.some((b) => b.id === actor.id) || idea.authorId === actor.id;
    if (!allowed) throw new IdeaRejected("not-a-builder");
    if (status !== "open" && status !== "building" && status !== "built") throw new IdeaRejected("bad-status");
    if (status === "building" && idea.builders.length === 0) throw new IdeaRejected("not-a-builder");
    idea.status = status;
    return this.touch(idea, now);
  }

  /** Waits for any pending write. Call before shutdown. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      await this.save();
    }
    await this.saving;
  }

  private require(id: string): Idea {
    const idea = this.ideas.get(typeof id === "string" ? id : "");
    if (!idea) throw new IdeaRejected("not-found");
    return idea;
  }

  private touch(idea: Idea, now: number): Idea {
    idea.updatedAt = now;
    this.scheduleSave();
    return idea;
  }

  /** Drops the oldest built idea to make room. Returns false if none. */
  private evictOne(): boolean {
    let oldest: Idea | undefined;
    for (const idea of this.ideas.values()) {
      if (idea.status === "built" && (!oldest || idea.updatedAt < oldest.updatedAt)) oldest = idea;
    }
    if (!oldest) return false;
    this.ideas.delete(oldest.id);
    return true;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, 500);
  }

  private save(): Promise<void> {
    const snapshot = [...this.ideas.values()].map((i) => ({ ...i, votes: [...i.votes], builders: i.builders.map((b) => ({ ...b })) }));
    this.saving = this.saving
      .then(() => this.persistence.save(snapshot))
      .catch((err) => console.error(`[ideas] save to ${this.persistence.name} failed`, err));
    return this.saving;
  }
}
