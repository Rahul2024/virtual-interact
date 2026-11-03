import { ADMIN_MSG, type ServerTimeMode } from "@vi/shared";
import type { HubRoom } from "../net/connection";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/**
 * Developer panel (Ctrl+Shift+A). Logging in sends the ADMIN_KEY to the
 * server once; every command after that is checked server-side, so the panel
 * is just buttons.
 */
export class AdminPanel {
  private root = el<HTMLDivElement>("admin");
  private closeBtn = el<HTMLButtonElement>("admin-close");
  private loginBox = el<HTMLDivElement>("admin-login");
  private keyInput = el<HTMLInputElement>("admin-key");
  private loginBtn = el<HTMLButtonElement>("admin-login-btn");
  private status = el<HTMLDivElement>("admin-status");
  private tools = el<HTMLDivElement>("admin-tools");
  private list = el<HTMLDivElement>("admin-players");
  private timeBtns = el<HTMLDivElement>("admin-time");
  private room: HubRoom | undefined;
  private loggedIn = false;
  private lastKey = "";

  onOpenChange: (open: boolean) => void = () => {};

  constructor() {
    this.closeBtn.addEventListener("click", () => this.close());
    this.loginBtn.addEventListener("click", () => void this.login());
    this.keyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.login();
    });
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
    for (const mode of ["auto", "ist", "day", "sunset", "night"] as ServerTimeMode[]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = mode;
      b.dataset.mode = mode;
      b.addEventListener("click", () => this.room?.send(ADMIN_MSG.time, { mode }));
      this.timeBtns.appendChild(b);
    }
  }

  attach(room: HubRoom) {
    this.room = room;
    this.loggedIn = false;
    this.render();
  }

  detach() {
    this.room = undefined;
    this.loggedIn = false;
    this.close();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.root.hidden = false;
    this.render();
    if (!this.loggedIn) this.keyInput.focus();
    this.onOpenChange(true);
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onOpenChange(false);
  }

  private async login() {
    if (!this.room) return;
    const key = this.keyInput.value.trim();
    if (!key) return;
    this.status.textContent = "Checking…";
    try {
      const res = await this.room.request<unknown, { ok: boolean; reason?: string }>(ADMIN_MSG.login, { key });
      this.loggedIn = res.ok;
      this.status.textContent = res.ok ? "Logged in as moderator." : `No: ${res.reason ?? "wrong key"}`;
      if (res.ok) this.keyInput.value = "";
    } catch (err) {
      this.status.textContent = `Error: ${(err as Error).message}`;
    }
    this.render();
  }

  /** Call every frame while open: refreshes the list when it changes. */
  render() {
    if (!this.isOpen) return;
    const room = this.room;
    this.loginBox.hidden = this.loggedIn;
    this.tools.hidden = !this.loggedIn;
    if (!room || !this.loggedIn) return;
    const st = room.state;
    const now = Date.now();
    const rows = [...st.players.entries()].map(([sid, p]) => ({ sid, name: p.name, clientId: p.clientId, x: p.x, z: p.z, me: sid === room.sessionId }));
    const key = JSON.stringify(rows) + st.timeMode;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.timeBtns.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === st.timeMode));
    this.list.replaceChildren(
      ...rows.map((r) => {
        const row = document.createElement("div");
        row.className = "admin-row";
        const who = document.createElement("span");
        who.textContent = `${r.name}${r.me ? " (you)" : ""} · ${Math.round(r.x)},${Math.round(r.z)}`;
        who.title = r.clientId;
        row.appendChild(who);
        if (!r.me) {
          const kick = document.createElement("button");
          kick.type = "button";
          kick.textContent = "Kick";
          kick.addEventListener("click", () => room.send(ADMIN_MSG.kick, { sessionId: r.sid }));
          const ban = document.createElement("button");
          ban.type = "button";
          ban.textContent = "Ban";
          ban.className = "danger";
          ban.addEventListener("click", () => {
            if (confirm(`Remove ${r.name} for the rest of this server session?`)) room.send(ADMIN_MSG.ban, { sessionId: r.sid });
          });
          row.append(kick, ban);
        }
        return row;
      }),
    );
    void now;
  }
}
