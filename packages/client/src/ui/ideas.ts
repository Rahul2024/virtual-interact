import { sortIdeas, type Idea, type IdeaStatus } from "@vi/shared";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/** What the server's rejection codes mean to a person. */
const REASONS: Record<string, string> = {
  "empty-title": "Give the idea a title first.",
  "too-soon": "One idea every 30 seconds, so people can read them.",
  "not-found": "That idea is gone.",
  "not-a-builder": "Only its builders (or the author) can change that.",
  "already-builder": "You're already on it.",
  "bad-status": "That status doesn't exist.",
  full: "The wall is full. Mark some ideas built to make room.",
  "not-in-room": "You're not in the hub any more.",
};

export interface IdeaActions {
  create(title: string, details: string): Promise<Idea>;
  vote(id: string): Promise<Idea>;
  join(id: string): Promise<Idea>;
  leave(id: string): Promise<Idea>;
  setStatus(id: string, status: IdeaStatus): Promise<Idea>;
}

/**
 * The Idea Wall as a panel: post, vote, "I'll build this", mark built.
 * It keeps its own copy of the ideas and re-renders on every change.
 */
export class IdeasPanel {
  private root = el<HTMLDivElement>("ideas");
  private closeBtn = el<HTMLButtonElement>("ideas-close");
  private form = el<HTMLFormElement>("ideas-form");
  private title = el<HTMLInputElement>("ideas-title");
  private details = el<HTMLTextAreaElement>("ideas-details");
  private status = el<HTMLSpanElement>("ideas-form-status");
  private tabs = el<HTMLElement>("ideas-tabs");
  private list = el<HTMLDivElement>("ideas-list");

  private ideas = new Map<string, Idea>();
  private tab: IdeaStatus = "open";
  private actions: IdeaActions | undefined;
  private myId = "";

  onOpenChange: (open: boolean) => void = () => {};

  constructor() {
    this.closeBtn.addEventListener("click", () => this.close());
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
    // Esc closes; nothing typed in here reaches the movement keys or the chat.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };
    window.addEventListener("keydown", onKey);
    this.root.addEventListener("keydown", (e) => {
      onKey(e);
      e.stopPropagation();
    });

    this.tabs.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((b) => {
      b.addEventListener("click", () => {
        this.tab = b.dataset.tab as IdeaStatus;
        this.tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
        this.render();
      });
    });

    this.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!this.actions) return;
      const title = this.title.value.trim();
      const details = this.details.value.trim();
      if (!title) return;
      this.setStatus("Posting…");
      try {
        const idea = await this.actions.create(title, details);
        this.upsert(idea);
        this.title.value = "";
        this.details.value = "";
        this.setStatus("Posted. Now find someone to build it with.");
      } catch (err) {
        this.setStatus(this.explain(err), true);
      }
    });
  }

  /** Call once per session: who am I (for vote/builder state) and how to act. */
  bind(myId: string, actions: IdeaActions) {
    this.myId = myId;
    this.actions = actions;
  }

  unbind() {
    this.actions = undefined;
    this.ideas.clear();
    this.close();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open() {
    if (this.isOpen) return;
    this.root.hidden = false;
    this.render();
    this.title.focus();
    this.onOpenChange(true);
  }

  close() {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.setStatus("");
    this.onOpenChange(false);
  }

  setIdeas(ideas: Idea[]) {
    this.ideas.clear();
    for (const idea of ideas) this.ideas.set(idea.id, idea);
    this.render();
  }

  upsert(idea: Idea) {
    this.ideas.set(idea.id, idea);
    this.render();
  }

  all(): Idea[] {
    return [...this.ideas.values()];
  }

  private setStatus(text: string, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle("error", error);
  }

  private explain(err: unknown): string {
    const reason = (err as { reason?: unknown })?.reason;
    if (typeof reason === "string" && REASONS[reason]) return REASONS[reason]!;
    return "That didn't work. Try again in a moment.";
  }

  private async act(run: () => Promise<Idea>) {
    try {
      this.upsert(await run());
    } catch (err) {
      this.setStatus(this.explain(err), true);
    }
  }

  private render() {
    if (!this.isOpen) return;
    const sorted = sortIdeas(this.all());
    const counts = { open: 0, building: 0, built: 0 };
    for (const i of sorted) counts[i.status]++;
    el("ideas-n-open").textContent = counts.open ? String(counts.open) : "";
    el("ideas-n-building").textContent = counts.building ? String(counts.building) : "";
    el("ideas-n-built").textContent = counts.built ? String(counts.built) : "";

    const shown = sorted.filter((i) => i.status === this.tab);
    this.list.replaceChildren();
    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ideas-empty";
      empty.textContent =
        this.tab === "open"
          ? "No open ideas. Post the first one above."
          : this.tab === "building"
            ? "Nothing is being built yet. Pick an open idea and say you'll build it."
            : "Nothing built yet. It starts with one.";
      this.list.appendChild(empty);
      return;
    }
    for (const idea of shown) this.list.appendChild(this.renderIdea(idea));
  }

  private renderIdea(idea: Idea): HTMLElement {
    const me = this.myId;
    const voted = idea.votes.includes(me);
    const isBuilder = idea.builders.some((b) => b.id === me);
    const isAuthor = idea.authorId === me;
    const a = this.actions;

    const item = document.createElement("article");
    item.className = "idea";

    const vote = document.createElement("button");
    vote.type = "button";
    vote.className = "idea-vote" + (voted ? " voted" : "");
    vote.innerHTML = `▲<br>${idea.votes.length}`;
    vote.title = voted ? "Remove your vote" : "Vote for this";
    vote.addEventListener("click", () => a && this.act(() => a.vote(idea.id)));

    const body = document.createElement("div");
    body.className = "idea-body";
    const h = document.createElement("h3");
    h.textContent = idea.title;
    body.appendChild(h);
    if (idea.details) {
      const p = document.createElement("p");
      p.textContent = idea.details;
      body.appendChild(p);
    }

    const meta = document.createElement("div");
    meta.className = "idea-meta";
    const tag = document.createElement("span");
    tag.className = `tag ${idea.status}`;
    tag.textContent = idea.status === "open" ? "open" : idea.status === "building" ? "being built" : "built";
    meta.appendChild(tag);
    const by = document.createElement("span");
    const builders = idea.builders.map((b) => b.name).join(", ");
    by.textContent = `by ${idea.authorName}` + (builders ? ` · builders: ${builders}` : "");
    meta.appendChild(by);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "idea-actions";
    if (idea.status !== "built") {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = isBuilder ? "secondary" : "";
      claim.textContent = isBuilder ? "Leave the build" : idea.builders.length ? "Join the builders" : "I'll build this";
      claim.addEventListener("click", () => a && this.act(() => (isBuilder ? a.leave(idea.id) : a.join(idea.id))));
      actions.appendChild(claim);
    }
    if ((isBuilder || isAuthor) && idea.status === "building") {
      const done = document.createElement("button");
      done.type = "button";
      done.className = "secondary";
      done.textContent = "Mark built";
      done.addEventListener("click", () => a && this.act(() => a.setStatus(idea.id, "built")));
      actions.appendChild(done);
    }
    if ((isBuilder || isAuthor) && idea.status === "built") {
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "secondary";
      reopen.textContent = "Reopen";
      reopen.addEventListener("click", () => a && this.act(() => a.setStatus(idea.id, idea.builders.length ? "building" : "open")));
      actions.appendChild(reopen);
    }
    if (actions.childElementCount) body.appendChild(actions);

    item.append(vote, body);
    return item;
  }
}
