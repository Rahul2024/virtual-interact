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
  private log = el<HTMLDivElement>("chat-log");
  private form = el<HTMLFormElement>("chat-form");
  private input = el<HTMLInputElement>("chat-input");
  private mic = el<HTMLButtonElement>("mic");
  private micLabel = el<HTMLSpanElement>("mic-label");
  private micNote = el<HTMLDivElement>("mic-note");

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
      this.input.blur();
    });
    this.input.addEventListener("focus", () => this.onFocusChange(true));
    this.input.addEventListener("blur", () => this.onFocusChange(false));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.input.blur();
      e.stopPropagation();
    });
    window.addEventListener("keydown", (e) => {
      if (this.root.hidden) return;
      if (e.key === "Enter" && document.activeElement !== this.input) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }

  setCount(n: number) {
    this.count.textContent = String(n);
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
  }

  addSystem(text: string) {
    const line = document.createElement("div");
    line.className = "chat-line system";
    line.textContent = text;
    this.push(line);
  }

  private push(line: HTMLElement) {
    this.log.appendChild(line);
    while (this.log.childElementCount > 60) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
