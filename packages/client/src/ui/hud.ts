import { AVATAR_COLORS, type JoinOptions } from "@vi/shared";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

/** The join screen: name + colour, then a promise that resolves when they click Enter. */
export class JoinScreen {
  private root = el<HTMLDivElement>("join");
  private form = el<HTMLFormElement>("join-form");
  private name = el<HTMLInputElement>("join-name");
  private colors = el<HTMLDivElement>("join-colors");
  private button = el<HTMLButtonElement>("join-button");
  private status = el<HTMLParagraphElement>("join-status");
  private color: string;

  constructor() {
    this.color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!;
    try {
      this.name.value = localStorage.getItem("vi.name") ?? "";
      const saved = localStorage.getItem("vi.color");
      if (saved && (AVATAR_COLORS as readonly string[]).includes(saved)) this.color = saved;
    } catch {
      /* private mode: fine */
    }
    for (const c of AVATAR_COLORS) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "swatch" + (c === this.color ? " selected" : "");
      swatch.style.background = c;
      swatch.title = c;
      swatch.addEventListener("click", () => {
        this.color = c;
        this.colors.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("selected", s === swatch));
      });
      this.colors.appendChild(swatch);
    }
    this.name.focus();
  }

  /** Resolves each time the user submits; the caller decides whether to hide. */
  waitForSubmit(): Promise<JoinOptions> {
    return new Promise((resolve) => {
      const onSubmit = (e: Event) => {
        e.preventDefault();
        this.form.removeEventListener("submit", onSubmit);
        const name = this.name.value.trim();
        try {
          localStorage.setItem("vi.name", name);
          localStorage.setItem("vi.color", this.color);
        } catch {
          /* ignore */
        }
        resolve({ name, color: this.color });
      };
      this.form.addEventListener("submit", onSubmit);
    });
  }

  setBusy(busy: boolean, message = "") {
    this.button.disabled = busy;
    this.status.textContent = message;
    this.status.classList.remove("error");
  }

  setError(message: string) {
    this.button.disabled = false;
    this.status.textContent = message;
    this.status.classList.add("error");
  }

  show() {
    this.root.hidden = false;
    this.name.focus();
  }

  hide() {
    this.root.hidden = true;
  }
}

export type MicUiStatus = "off" | "requesting" | "on" | "muted" | "denied" | "no-mic" | "unsupported" | "error";

const MIC_LABELS: Record<MicUiStatus, string> = {
  off: "Turn on mic",
  requesting: "Asking for mic…",
  on: "Mic on",
  muted: "Muted",
  denied: "Mic blocked",
  "no-mic": "No microphone",
  unsupported: "Voice unavailable",
  error: "Mic error",
};

const MIC_NOTES: Partial<Record<MicUiStatus, string>> = {
  denied: "The browser blocked the microphone. Click the camera/mic icon in the address bar to allow it, then try again.",
  "no-mic": "No microphone was found. Plug one in (or check system sound settings) and try again.",
  unsupported:
    "Voice needs a secure page: it works on http://localhost or https://. Over a plain http:// network address the browser refuses the mic.",
  error: "Something went wrong opening the microphone. Reload and try again.",
};

/** In-world overlay: headcount, chat and the mic button. */
export class Hud {
  private root = el<HTMLDivElement>("hud");
  private count = el<HTMLSpanElement>("count");
  private countPill = document.getElementById("count-pill") as HTMLSpanElement | null;
  private topToggle = document.getElementById("hud-top-toggle") as HTMLButtonElement | null;
  private topCard = document.getElementById("hud-top-card") as HTMLDivElement | null;

  private chatWrap = document.getElementById("chat") ?? el<HTMLDivElement>("chat");
  private log = el<HTMLDivElement>("chat-log");
  private form = el<HTMLFormElement>("chat-form");
  private input = el<HTMLInputElement>("chat-input");
  private chatToggleBtn = document.getElementById("chat-toggle-btn") as HTMLButtonElement | null;
  private chatCloseBtn = document.getElementById("chat-close-btn") as HTMLButtonElement | null;
  private chatPreview = document.getElementById("chat-preview") as HTMLDivElement | null;
  private chatUnreadBadge = document.getElementById("chat-unread-badge") as HTMLSpanElement | null;

  private mic = el<HTMLButtonElement>("mic");
  private micLabel = el<HTMLSpanElement>("mic-label");
  private micNote = el<HTMLDivElement>("mic-note");

  private chatOpenMobile = false;
  private unreadCount = 0;
  private previewTimer: ReturnType<typeof setTimeout> | undefined;

  /** Fires when the chat input gains or loses focus, so movement keys can be paused. */
  onFocusChange: (focused: boolean) => void = () => {};
  onSend: (text: string) => void = () => {};
  onMicClick: () => void = () => {};

  constructor() {
    this.mic.addEventListener("click", () => this.onMicClick());
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      this.input.value = "";
      if (text) this.onSend(text);
      if (window.innerWidth <= 768) {
        this.closeMobileChat();
      } else {
        this.input.blur();
      }
    });

    // Top-left compact info pill toggle on mobile
    this.topToggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = this.topCard?.classList.toggle("open") ?? false;
      this.topToggle?.setAttribute("aria-expanded", String(isOpen));
    });

    document.addEventListener("click", (e) => {
      const target = e.target as Node;
      if (this.topCard && !this.topCard.contains(target) && !this.topToggle?.contains(target)) {
        this.topCard.classList.remove("open");
        this.topToggle?.setAttribute("aria-expanded", "false");
      }
    });

    // Mobile chat toggle and close buttons
    this.chatToggleBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.chatOpenMobile) {
        this.closeMobileChat();
      } else {
        this.openMobileChat();
      }
    });

    this.chatCloseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeMobileChat();
    });

    this.input.addEventListener("focus", () => this.onFocusChange(true));
    this.input.addEventListener("blur", () => {
      if (!this.chatOpenMobile) this.onFocusChange(false);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.chatOpenMobile) this.closeMobileChat();
        else this.input.blur();
      }
      e.stopPropagation();
    });

    window.addEventListener("keydown", (e) => {
      if (this.root.hidden) return;
      if (e.key === "Enter" && document.activeElement !== this.input) {
        e.preventDefault();
        if (window.innerWidth <= 768) {
          this.openMobileChat();
        } else {
          this.input.focus();
        }
      }
    });
  }

  openMobileChat() {
    this.chatOpenMobile = true;
    this.chatWrap.classList.add("mobile-open");
    this.unreadCount = 0;
    if (this.chatUnreadBadge) {
      this.chatUnreadBadge.hidden = true;
      this.chatUnreadBadge.textContent = "0";
    }
    if (this.chatPreview) this.chatPreview.hidden = true;
    this.input.focus();
    this.onFocusChange(true);
  }

  closeMobileChat() {
    this.chatOpenMobile = false;
    this.chatWrap.classList.remove("mobile-open");
    this.input.blur();
    this.onFocusChange(false);
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
    this.closeMobileChat();
  }

  setCount(n: number) {
    this.count.textContent = String(n);
    if (this.countPill) this.countPill.textContent = String(n);
  }

  setMic(status: MicUiStatus, listeners = 0) {
    this.mic.dataset.status = status;
    let label = MIC_LABELS[status];
    if (status === "on") label = listeners === 0 ? "Mic on · nobody near" : `Mic on · ${listeners} can hear you`;
    this.micLabel.textContent = label;
    this.mic.title =
      status === "on" ? "Click or press M to mute" : status === "muted" ? "Click or press M to unmute" : "Click or press M to turn the mic on";
    const note = MIC_NOTES[status];
    this.micNote.hidden = !note;
    this.micNote.textContent = note ?? "";
  }

  addChat(name: string, text: string, color?: string) {
    const line = document.createElement("div");
    line.className = "chat-line";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = name;
    if (color) who.style.color = color;
    const body = document.createElement("span");
    body.textContent = text;
    line.append(who, body);
    this.push(line);
    this.showPreview(name, text, color);
  }

  addSystem(text: string) {
    const line = document.createElement("div");
    line.className = "chat-line system";
    line.textContent = text;
    this.push(line);
    this.showPreview("", text);
  }

  private showPreview(whoName: string, text: string, color?: string) {
    if (window.innerWidth > 768 || this.chatOpenMobile || !this.chatPreview) return;
    this.unreadCount++;
    if (this.chatUnreadBadge) {
      this.chatUnreadBadge.hidden = false;
      this.chatUnreadBadge.textContent = String(this.unreadCount);
    }
    this.chatPreview.innerHTML = "";
    if (whoName) {
      const w = document.createElement("span");
      w.className = "preview-who";
      w.textContent = `${whoName}: `;
      if (color) w.style.color = color;
      this.chatPreview.appendChild(w);
    }
    const msg = document.createElement("span");
    msg.className = "preview-msg";
    msg.textContent = text;
    this.chatPreview.appendChild(msg);

    this.chatPreview.hidden = false;
    this.chatPreview.classList.add("show");
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.chatPreview?.classList.remove("show");
      if (this.chatPreview) this.chatPreview.hidden = true;
    }, 4500);
  }

  private push(line: HTMLElement) {
    this.log.appendChild(line);
    while (this.log.childElementCount > 60) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
