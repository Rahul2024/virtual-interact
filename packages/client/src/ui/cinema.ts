import * as THREE from "three";
import {
  ANIM,
  CINEMA_HALL,
  type Anim,
  type FriendIncomingMessage,
} from "@vi/shared";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname.startsWith("/embed/") || u.pathname.startsWith("/live/") || u.pathname.startsWith("/shorts/")) {
        return u.pathname.split("/")[2] ?? null;
      }
      return u.searchParams.get("v");
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type VideoQualityLevel = "auto" | "hd1080" | "hd720" | "large" | "medium" | "small";

const QUALITY_RESOLUTIONS: Record<VideoQualityLevel, [number, number]> = {
  auto: [1280, 720],
  hd1080: [1920, 1080],
  hd720: [1280, 720],
  large: [854, 480],
  medium: [640, 360],
  small: [426, 240],
};

export interface CinemaFriendPeer {
  sessionId: string;
  clientId: string;
  name: string;
  color: string;
  isFriend: boolean;
  inCinema: boolean;
  seatId: number;
  speaking: boolean;
  distance: number;
}

/**
 * Minimal, clean Cinema Controller:
 * 1. Automatically detects exact video duration from both YouTube IFrame API
 *    (`infoDelivery.info.duration`) and HTML5 `<video>.duration` so the scrub
 *    slider (`00:00 / 20:00`) always matches the real video length!
 * 2. Provides a Video Quality Selector (`Auto / 1080p / 720p / 480p / 360p / 240p`)
 *    plus a `⚙️ Player Controls` toggle for accessing native player settings gears.
 * 3. Strictly cuts off and unloads audio when the player walks outside the Cinema Hall.
 */
export class CinemaController {
  readonly screenCanvas: HTMLCanvasElement;
  readonly screenTexture: THREE.CanvasTexture;

  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private posterImg: HTMLImageElement;
  private posterReady = false;

  // Synced state from HubState
  private movieUrl = "";
  private syncedDurationSec = 0;
  private localDurationSec = 0;
  private ytReportedCurrentTime = 0;
  private startedAt = 0;
  private paused = false;
  private pausedAtSec = 0;
  private isHost = false;
  private hostName = "";
  private videoReady = false;
  private usingEmbed = false;
  private isYouTubeEmbed = false;
  private activeEmbedSrc = "";
  private isDraggingScrub = false;
  private selectedQuality: VideoQualityLevel = "auto";
  private interactivePlayerGear = false;
  private ytHandshakeTimer: ReturnType<typeof setInterval> | undefined;

  // Spatial audio & ducking
  private userVolume = 0.8;
  private isDucked = false;
  private inCinemaEarshot = false;
  private distanceGain = 0;

  // Dual-mode state
  expanded = false;
  hideStrangerBubbles = false;

  // Persistent Embed Host & Shield
  private embedHost = el<HTMLDivElement>("cinema-embed-host");
  private ytIframe = el<HTMLIFrameElement>("cinema-yt-iframe");
  private embedUnmuteBtn = el<HTMLButtonElement>("cinema-embed-unmute");

  // DOM Elements — Friends
  private friendsBtn = el<HTMLButtonElement>("friends-open");
  private friendsCountBadge = el<HTMLSpanElement>("friends-badge");
  private friendToast = el<HTMLDivElement>("friend-toast");
  private friendToastText = el<HTMLSpanElement>("friend-toast-text");
  private friendToastAccept = el<HTMLButtonElement>("friend-toast-accept");
  private friendToastDismiss = el<HTMLButtonElement>("friend-toast-dismiss");
  private friendsModal = el<HTMLDivElement>("friends-modal");
  private friendsClose = el<HTMLButtonElement>("friends-close");
  private friendsListEl = el<HTMLDivElement>("friends-list");
  private nearbyListEl = el<HTMLDivElement>("nearby-list");
  private incomingListEl = el<HTMLDivElement>("incoming-list");

  // DOM Elements — Minimal Cinema Dock
  private dock = el<HTMLDivElement>("cinema-dock");
  private dockHostBadge = el<HTMLSpanElement>("cinema-dock-host-badge");
  private dockUrlForm = el<HTMLFormElement>("cinema-url-form");
  private dockUrlInput = el<HTMLInputElement>("cinema-url-input");
  private dockPlayPauseBtn = el<HTMLButtonElement>("cinema-dock-playpause");
  private dockBackBtn = el<HTMLButtonElement>("cinema-dock-back");
  private dockScrub = el<HTMLInputElement>("cinema-dock-scrub");
  private dockFwdBtn = el<HTMLButtonElement>("cinema-dock-fwd");
  private dockTime = el<HTMLSpanElement>("cinema-dock-time");
  private dockQuality = el<HTMLSelectElement>("cinema-dock-quality");
  private sitBtn = el<HTMLButtonElement>("cinema-sit-btn");
  private sitFriendsBtn = el<HTMLButtonElement>("cinema-sit-friends-btn");
  private expandBtn = el<HTMLButtonElement>("cinema-expand-btn");
  private bubblesBtn = el<HTMLButtonElement>("cinema-bubbles-btn");

  // DOM Elements — Expanded Fullscreen Overlay
  private overlay = el<HTMLDivElement>("cinema-overlay");
  private overlayCanvas = el<HTMLCanvasElement>("cinema-overlay-canvas");
  private overlayEmbedSlot = el<HTMLDivElement>("cinema-overlay-embed-slot");
  private overlayCtx: CanvasRenderingContext2D;
  private overlayTime = el<HTMLSpanElement>("cinema-overlay-time");
  private overlayHostBadge = el<HTMLSpanElement>("cinema-overlay-host-badge");
  private overlayPlayPauseBtn = el<HTMLButtonElement>("cinema-overlay-playpause");
  private overlayBackBtn = el<HTMLButtonElement>("cinema-overlay-back");
  private overlayScrub = el<HTMLInputElement>("cinema-overlay-scrub");
  private overlayFwdBtn = el<HTMLButtonElement>("cinema-overlay-fwd");
  private overlayQuality = el<HTMLSelectElement>("cinema-overlay-quality");
  private playerGearBtn = el<HTMLButtonElement>("cinema-player-gear-btn");
  private volumeSlider = el<HTMLInputElement>("cinema-volume");
  private minimizeBtn = el<HTMLButtonElement>("cinema-minimize-btn");
  private overlayChatLog = el<HTMLDivElement>("cinema-overlay-chat-log");
  private overlayChatForm = el<HTMLFormElement>("cinema-overlay-chat-form");
  private overlayChatInput = el<HTMLInputElement>("cinema-overlay-chat-input");

  private incomingRequests = new Map<string, FriendIncomingMessage>();
  private latestToastRequester: string | undefined;
  private cornerVec = new THREE.Vector3();

  // Callbacks wired by main.ts
  onToggleSeat: () => void = () => {};
  onSitWithFriends: () => void = () => {};
  onEmote: (anim: Anim, emoji: string) => void = () => {};
  onSetMovieUrl: (url: string) => void = () => {};
  onReportDuration: (durationSec: number) => void = () => {};
  onControlMovie: (action: "toggle" | "restart" | "seek", seekSec?: number) => void = () => {};
  onTransferHost: (targetSessionId: string) => void = () => {};
  onSendChat: (text: string) => void = () => {};
  onFriendRequest: (toSessionId: string) => void = () => {};
  onFriendAccept: (fromClientId: string) => void = () => {};
  onFriendRemove: (friendClientId: string) => void = () => {};
  onModalOpenChange: (open: boolean) => void = () => {};

  constructor() {
    this.screenCanvas = document.createElement("canvas");
    this.screenCanvas.width = 1280;
    this.screenCanvas.height = 720;
    this.ctx = this.screenCanvas.getContext("2d")!;

    this.overlayCanvas.width = 1280;
    this.overlayCanvas.height = 720;
    this.overlayCtx = this.overlayCanvas.getContext("2d")!;

    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.magFilter = THREE.LinearFilter;

    this.posterImg = new Image();
    this.posterImg.crossOrigin = "anonymous";
    this.posterImg.addEventListener("load", () => {
      this.posterReady = true;
    });
    this.posterImg.addEventListener("error", () => {
      this.posterReady = false;
    });

    this.video = document.createElement("video");
    this.video.crossOrigin = "anonymous";
    this.video.playsInline = true;
    this.video.loop = true;
    this.video.preload = "auto";
    this.video.volume = 0;
    this.video.muted = true;

    const handleVideoDuration = () => {
      if (isFinite(this.video.duration) && this.video.duration > 1) {
        const d = Math.round(this.video.duration);
        if (d !== this.localDurationSec) {
          this.localDurationSec = d;
          this.onReportDuration(d);
        }
      }
    };
    this.video.addEventListener("loadedmetadata", handleVideoDuration);
    this.video.addEventListener("durationchange", handleVideoDuration);

    this.video.addEventListener("canplay", () => {
      this.videoReady = true;
      handleVideoDuration();
      if (!this.paused && !this.usingEmbed && this.inCinemaEarshot) {
        void this.video.play().catch(() => {});
      }
    });

    this.setupYouTubeMessageBridge();
    this.bindEvents();
  }

  /**
   * Listens to YouTube IFrame API `infoDelivery` postMessages so we automatically
   * capture the exact video duration (e.g. 20:00 instead of 1:00:00) and keep
   * playback quality & timeline position in sync!
   */
  private setupYouTubeMessageBridge() {
    this.ytIframe.addEventListener("load", () => {
      if (!this.isYouTubeEmbed || !this.ytIframe.src) return;
      this.postYouTubeListeningHandshake();
      if (this.ytHandshakeTimer) clearInterval(this.ytHandshakeTimer);
      let tries = 0;
      this.ytHandshakeTimer = setInterval(() => {
        tries++;
        if (tries > 12 || !this.isYouTubeEmbed || !this.ytIframe.src) {
          if (this.ytHandshakeTimer) clearInterval(this.ytHandshakeTimer);
          return;
        }
        this.postYouTubeListeningHandshake();
        if (this.selectedQuality !== "auto") {
          this.sendYouTubeCommand("setPlaybackQuality", [this.selectedQuality]);
          this.sendYouTubeCommand("setPlaybackQualityRange", [this.selectedQuality, this.selectedQuality]);
        }
      }, 800);
    });

    window.addEventListener("message", (e) => {
      if (!this.isYouTubeEmbed || typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data) as {
          event?: string;
          info?: {
            duration?: number;
            currentTime?: number;
            playerState?: number;
          };
        };
        if (msg.event === "infoDelivery" && msg.info) {
          if (typeof msg.info.duration === "number" && msg.info.duration > 1) {
            const d = Math.round(msg.info.duration);
            if (d !== this.localDurationSec) {
              this.localDurationSec = d;
              this.onReportDuration(d);
            }
          }
          if (typeof msg.info.currentTime === "number" && isFinite(msg.info.currentTime)) {
            this.ytReportedCurrentTime = msg.info.currentTime;
            // If non-host unlocked player gear to change quality and accidentally scrubbed, snap back to server clock!
            const expected = this.getCurrentElapsedSec();
            const dur = this.getEffectiveDurationSec();
            const target = dur > 0 ? expected % dur : expected;
            if (!this.isHost && Math.abs(this.ytReportedCurrentTime - target) > 3.5) {
              this.sendYouTubeCommand("seekTo", [Math.floor(target), true]);
            }
          }
        }
      } catch {
        /* ignore non-JSON messages */
      }
    });
  }

  private postYouTubeListeningHandshake() {
    try {
      this.ytIframe.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: 1, channel: "widget" }),
        "*",
      );
    } catch {
      /* ignore */
    }
  }

  private bindEvents() {
    this.sitBtn.addEventListener("click", () => this.onToggleSeat());
    this.sitFriendsBtn.addEventListener("click", () => this.onSitWithFriends());
    this.expandBtn.addEventListener("click", () => this.setExpanded(true));
    this.minimizeBtn.addEventListener("click", () => this.setExpanded(false));

    this.dockUrlForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!this.isHost) return;
      const url = this.dockUrlInput.value.trim();
      if (url) {
        this.onSetMovieUrl(url);
        this.dockUrlInput.value = "";
        this.dockUrlInput.blur();
      }
    });
    this.dockUrlInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.dockUrlInput.blur();
      e.stopPropagation();
    });

    const bindTimeline = (
      playPause: HTMLButtonElement,
      back: HTMLButtonElement,
      scrub: HTMLInputElement,
      fwd: HTMLButtonElement,
    ) => {
      playPause.addEventListener("click", () => {
        if (this.isHost) this.onControlMovie("toggle");
      });
      back.addEventListener("click", () => {
        if (this.isHost) {
          const target = Math.max(0, this.getCurrentElapsedSec() - 15);
          this.onControlMovie("seek", target);
        }
      });
      fwd.addEventListener("click", () => {
        if (this.isHost) {
          const dur = this.getEffectiveDurationSec();
          const target = Math.min(dur, this.getCurrentElapsedSec() + 15);
          this.onControlMovie("seek", target);
        }
      });
      scrub.addEventListener("pointerdown", () => {
        if (this.isHost) this.isDraggingScrub = true;
      });
      scrub.addEventListener("input", () => {
        if (this.isHost && this.isDraggingScrub) {
          const dur = this.getEffectiveDurationSec();
          const previewSec = parseFloat(scrub.value);
          const label = `${fmtTime(previewSec)} / ${fmtTime(dur)}`;
          this.dockTime.textContent = label;
          this.overlayTime.textContent = label;
        }
      });
      scrub.addEventListener("change", () => {
        this.isDraggingScrub = false;
        if (this.isHost) {
          this.onControlMovie("seek", parseFloat(scrub.value));
        }
      });
    };

    bindTimeline(this.dockPlayPauseBtn, this.dockBackBtn, this.dockScrub, this.dockFwdBtn);
    bindTimeline(this.overlayPlayPauseBtn, this.overlayBackBtn, this.overlayScrub, this.overlayFwdBtn);

    // Video Quality Selector (works in both Minimized Dock and Expanded Fullscreen)
    const onQualityChange = (q: VideoQualityLevel) => {
      this.selectedQuality = q;
      this.dockQuality.value = q;
      this.overlayQuality.value = q;
      this.applyQualitySetting(q);
    };
    this.dockQuality.addEventListener("change", () => onQualityChange(this.dockQuality.value as VideoQualityLevel));
    this.overlayQuality.addEventListener("change", () =>
      onQualityChange(this.overlayQuality.value as VideoQualityLevel),
    );

    // Toggle native player controls (so user can also click YouTube's internal ⚙️ quality gear directly)
    this.playerGearBtn.addEventListener("click", () => {
      this.interactivePlayerGear = !this.interactivePlayerGear;
      this.embedHost.classList.toggle("interactive", this.interactivePlayerGear);
      this.playerGearBtn.classList.toggle("accent", this.interactivePlayerGear);
      this.playerGearBtn.textContent = this.interactivePlayerGear
        ? "🔒 Lock Player Click"
        : "⚙️ Player Controls";
    });

    this.embedUnmuteBtn.addEventListener("click", () => {
      this.sendYouTubeCommand("unMute", []);
      this.applyVolume();
      this.sendYouTubeCommand("playVideo", []);
      this.embedUnmuteBtn.hidden = true;
    });

    this.bubblesBtn.addEventListener("click", () => {
      this.hideStrangerBubbles = !this.hideStrangerBubbles;
      this.bubblesBtn.textContent = this.hideStrangerBubbles ? "💬 Bubbles: Off" : "💬 Bubbles: On";
      this.bubblesBtn.classList.toggle("muted", this.hideStrangerBubbles);
    });

    this.volumeSlider.addEventListener("input", () => {
      this.userVolume = parseFloat(this.volumeSlider.value);
      this.applyVolume();
    });

    this.overlayChatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.overlayChatInput.value.trim();
      this.overlayChatInput.value = "";
      if (text) this.onSendChat(text);
    });
    this.overlayChatInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.overlayChatInput.blur();
      e.stopPropagation();
    });

    this.friendsBtn.addEventListener("click", () => this.openFriendsModal());
    this.friendsClose.addEventListener("click", () => this.closeFriendsModal());
    this.friendsModal.addEventListener("click", (e) => {
      if (e.target === this.friendsModal) this.closeFriendsModal();
    });

    this.friendToastAccept.addEventListener("click", () => {
      if (this.latestToastRequester) {
        this.onFriendAccept(this.latestToastRequester);
        this.incomingRequests.delete(this.latestToastRequester);
        this.latestToastRequester = undefined;
      }
      this.friendToast.hidden = true;
    });
    this.friendToastDismiss.addEventListener("click", () => {
      this.friendToast.hidden = true;
    });
  }

  /**
   * Applies the selected video quality to:
   * 1. YouTube IFrame Player (`setPlaybackQuality` + `setPlaybackQualityRange` + `&vq=`)
   * 2. Direct video / 3D Screen & Overlay Canvas internal resolution (`1920x1080` down to `426x240`)
   */
  private applyQualitySetting(q: VideoQualityLevel) {
    const [resW, resH] = QUALITY_RESOLUTIONS[q] ?? [1280, 720];
    this.screenCanvas.width = resW;
    this.screenCanvas.height = resH;
    this.overlayCanvas.width = resW;
    this.overlayCanvas.height = resH;
    this.screenTexture.dispose();
    this.screenTexture.needsUpdate = true;

    if (this.isYouTubeEmbed && this.ytIframe.src) {
      const ytQ = q === "auto" ? "default" : q;
      this.sendYouTubeCommand("setPlaybackQuality", [ytQ]);
      this.sendYouTubeCommand("setPlaybackQualityRange", [ytQ, ytQ]);
      // Also update vq parameter in the embed URL at the current second so YouTube honors the cap
      const ytId = extractYouTubeId(this.movieUrl);
      if (ytId && this.inCinemaEarshot) {
        const startSec = Math.max(0, Math.floor(this.getCurrentElapsedSec()));
        const origin = encodeURIComponent(window.location.origin);
        this.activeEmbedSrc = `https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&enablejsapi=1&controls=1&rel=0&vq=${ytQ}&start=${startSec}&origin=${origin}`;
        this.ytIframe.src = this.activeEmbedSrc;
      }
    }
  }

  private getEffectiveDurationSec(): number {
    if (this.localDurationSec > 1) return this.localDurationSec;
    if (this.syncedDurationSec > 1) return this.syncedDurationSec;
    if (this.videoReady && !this.usingEmbed && isFinite(this.video.duration) && this.video.duration > 1) {
      return Math.round(this.video.duration);
    }
    return 0;
  }

  private getCurrentElapsedSec(): number {
    if (!this.movieUrl || this.startedAt <= 0) return 0;
    return this.paused ? this.pausedAtSec : Math.max(0, (Date.now() - this.startedAt) / 1000);
  }

  syncState(opts: {
    movieUrl: string;
    movieDurationSec: number;
    startedAt: number;
    paused: boolean;
    pausedAtSec: number;
    isHost: boolean;
    hostName: string;
  }) {
    const changedUrl = opts.movieUrl !== this.movieUrl;
    const changedHost = opts.isHost !== this.isHost || opts.hostName !== this.hostName;

    this.movieUrl = opts.movieUrl;
    this.syncedDurationSec = opts.movieDurationSec || 0;
    this.startedAt = opts.startedAt;
    this.paused = opts.paused;
    this.pausedAtSec = opts.pausedAtSec;
    this.isHost = opts.isHost;
    this.hostName = opts.hostName || "Host";

    if (changedUrl) {
      this.localDurationSec = 0;
      this.loadMovieUrl(opts.movieUrl);
    }
    if (changedHost) {
      this.updateHostPermissionsUI();
    }

    this.applyImmediateSyncSeek(this.getCurrentElapsedSec(), this.paused);
  }

  applyImmediateSyncSeek(seekSec: number, paused: boolean) {
    this.paused = paused;
    this.pausedAtSec = seekSec;
    if (this.movieUrl) {
      this.startedAt = Date.now() - seekSec * 1000;
    }

    const icon = paused ? "▶" : "⏸";
    this.dockPlayPauseBtn.textContent = icon;
    this.overlayPlayPauseBtn.textContent = icon;

    if (!this.inCinemaEarshot) return;

    if (this.usingEmbed && this.isYouTubeEmbed && this.ytIframe.src) {
      this.sendYouTubeCommand("seekTo", [Math.floor(seekSec), true]);
      this.sendYouTubeCommand(paused ? "pauseVideo" : "playVideo", []);
      return;
    }

    if (this.videoReady && !this.usingEmbed) {
      const dur = this.getEffectiveDurationSec();
      const target = dur > 0 ? seekSec % dur : seekSec;
      if (Math.abs(this.video.currentTime - target) > 0.8) {
        try {
          this.video.currentTime = target;
        } catch {
          /* ignore */
        }
      }
      if (paused) {
        this.video.pause();
      } else if (this.video.paused) {
        void this.video.play().catch(() => {});
      }
    }
  }

  private sendYouTubeCommand(func: string, args: unknown[]) {
    try {
      this.ytIframe.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
    } catch {
      /* ignore */
    }
  }

  private updateHostPermissionsUI() {
    const badgeText = this.isHost ? "👑 Host: You" : `👑 Host: ${this.hostName}`;
    for (const badge of [this.dockHostBadge, this.overlayHostBadge]) {
      badge.textContent = badgeText;
      badge.classList.toggle("locked", !this.isHost);
    }
    this.dockUrlForm.hidden = !this.isHost;
    for (const ctrl of [
      this.dockPlayPauseBtn,
      this.dockBackBtn,
      this.dockScrub,
      this.dockFwdBtn,
      this.overlayPlayPauseBtn,
      this.overlayBackBtn,
      this.overlayScrub,
      this.overlayFwdBtn,
    ]) {
      ctrl.disabled = !this.isHost;
    }
  }

  private loadMovieUrl(url: string) {
    this.posterReady = false;
    if (!url) {
      this.usingEmbed = false;
      this.isYouTubeEmbed = false;
      this.activeEmbedSrc = "";
      this.ytIframe.src = "";
      this.video.pause();
      this.video.removeAttribute("src");
      this.videoReady = false;
      this.embedHost.hidden = true;
      return;
    }

    const ytId = extractYouTubeId(url);
    if (ytId) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.videoReady = false;
      this.usingEmbed = true;
      this.isYouTubeEmbed = true;
      this.posterImg.src = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;

      const startSec = Math.max(0, Math.floor(this.getCurrentElapsedSec()));
      const origin = encodeURIComponent(window.location.origin);
      const ytQ = this.selectedQuality === "auto" ? "default" : this.selectedQuality;
      this.activeEmbedSrc = `https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&enablejsapi=1&controls=1&rel=0&vq=${ytQ}&start=${startSec}&origin=${origin}`;

      if (this.inCinemaEarshot) {
        this.ytIframe.src = this.activeEmbedSrc;
        this.embedUnmuteBtn.hidden = false;
      } else {
        this.ytIframe.src = "";
      }
      this.syncStageVisibility();
      return;
    }

    this.isYouTubeEmbed = false;
    this.embedUnmuteBtn.hidden = true;
    this.usingEmbed = false;
    this.activeEmbedSrc = "";
    this.ytIframe.src = "";
    this.syncStageVisibility();

    this.videoReady = false;
    this.video.onerror = () => {
      this.videoReady = false;
      this.usingEmbed = true;
      this.activeEmbedSrc = url;
      if (this.inCinemaEarshot) {
        this.ytIframe.src = url;
      }
      this.syncStageVisibility();
    };
    this.video.src = url;
    this.video.load();
    if (!this.paused && this.inCinemaEarshot) {
      void this.video.play().catch(() => {});
    }
  }

  private syncStageVisibility() {
    if (this.expanded) {
      this.overlayCanvas.hidden = this.usingEmbed;
      this.overlayEmbedSlot.hidden = !this.usingEmbed;
    }
    if (!this.usingEmbed || !this.inCinemaEarshot) {
      this.embedHost.hidden = true;
    }
  }

  updateScreenProjection(camera: THREE.PerspectiveCamera, isJoinScreenOpen: boolean) {
    if (!this.usingEmbed || !this.inCinemaEarshot || isJoinScreenOpen || !this.friendsModal.hidden) {
      this.embedHost.hidden = true;
      return;
    }

    const modeClass = this.expanded ? "mode-expanded" : "mode-minimized";
    const interactiveClass = this.interactivePlayerGear ? " interactive" : "";

    if (this.expanded) {
      this.overlayCanvas.hidden = true;
      this.overlayEmbedSlot.hidden = false;
      const rect = this.overlayEmbedSlot.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        this.embedHost.hidden = false;
        this.embedHost.className = `cinema-embed-host ${modeClass}${interactiveClass}`;
        this.embedHost.style.left = `${Math.round(rect.left)}px`;
        this.embedHost.style.top = `${Math.round(rect.top)}px`;
        this.embedHost.style.width = `${Math.round(rect.width)}px`;
        this.embedHost.style.height = `${Math.round(rect.height)}px`;
      }
      return;
    }

    const hw = CINEMA_HALL.screenWidth / 2;
    const hh = CINEMA_HALL.screenHeight / 2;
    const cy = CINEMA_HALL.screenY;
    const cz = CINEMA_HALL.screenZ;

    const distZ = camera.position.z - cz;
    if (distZ < 1.5 || distZ > 32) {
      this.embedHost.hidden = true;
      return;
    }

    const corners: Array<[number, number, number]> = [
      [-hw, cy + hh, cz],
      [hw, cy + hh, cz],
      [-hw, cy - hh, cz],
      [hw, cy - hh, cz],
    ];

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [x, y, z] of corners) {
      this.cornerVec.set(x, y, z).project(camera);
      if (this.cornerVec.z > 1 || this.cornerVec.z < -1) {
        this.embedHost.hidden = true;
        return;
      }
      const sx = (this.cornerVec.x * 0.5 + 0.5) * vw;
      const sy = (-this.cornerVec.y * 0.5 + 0.5) * vh;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
    }

    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 90 || h < 50 || maxX < 0 || minX > vw || maxY < 0 || minY > vh) {
      this.embedHost.hidden = true;
      return;
    }

    this.embedHost.hidden = false;
    this.embedHost.className = `cinema-embed-host ${modeClass}${interactiveClass}`;
    this.embedHost.style.left = `${Math.round(minX)}px`;
    this.embedHost.style.top = `${Math.round(minY)}px`;
    this.embedHost.style.width = `${Math.round(w)}px`;
    this.embedHost.style.height = `${Math.round(h)}px`;
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    this.overlay.hidden = !expanded;
    this.syncStageVisibility();
    this.onModalOpenChange(expanded || !this.friendsModal.hidden);
  }

  openFriendsModal() {
    this.friendsModal.hidden = false;
    this.onModalOpenChange(true);
  }

  closeFriendsModal() {
    this.friendsModal.hidden = true;
    this.onModalOpenChange(this.expanded);
  }

  updateHudState(opts: {
    playerX: number;
    playerZ: number;
    inCinema: boolean;
    isSeated: boolean;
    friendSpeaking: boolean;
    friendsCount: number;
    peers: CinemaFriendPeer[];
  }) {
    const pendingCount = this.incomingRequests.size;
    this.friendsCountBadge.textContent =
      pendingCount > 0 ? `${opts.friendsCount} · ${pendingCount}!` : String(opts.friendsCount);
    this.friendsBtn.classList.toggle("has-pending", pendingCount > 0);

    const nowInEarshot = opts.inCinema || opts.isSeated || this.expanded;
    const distToScreen = Math.hypot(opts.playerX - CINEMA_HALL.centerX, opts.playerZ - CINEMA_HALL.screenZ);
    this.distanceGain = this.expanded
      ? 1
      : !nowInEarshot
        ? 0
        : distToScreen <= 14
          ? 1
          : Math.max(0, 1 - (distToScreen - 14) / 10);

    if (nowInEarshot !== this.inCinemaEarshot) {
      this.inCinemaEarshot = nowInEarshot;
      if (!nowInEarshot) {
        this.video.muted = true;
        this.video.volume = 0;
        this.video.pause();
        if (this.usingEmbed && this.ytIframe.src) {
          this.ytIframe.src = "";
        }
        this.embedHost.hidden = true;
      } else if (this.movieUrl) {
        if (this.usingEmbed) {
          const ytId = extractYouTubeId(this.movieUrl);
          const startSec = Math.max(0, Math.floor(this.getCurrentElapsedSec()));
          const origin = encodeURIComponent(window.location.origin);
          const ytQ = this.selectedQuality === "auto" ? "default" : this.selectedQuality;
          this.ytIframe.src = ytId
            ? `https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&enablejsapi=1&controls=1&rel=0&vq=${ytQ}&start=${startSec}&origin=${origin}`
            : this.activeEmbedSrc;
        } else if (this.videoReady && !this.paused) {
          this.video.muted = false;
          void this.video.play().catch(() => {});
        }
      }
    }

    this.isDucked = opts.friendSpeaking;
    this.applyVolume();

    const showDock = (opts.inCinema || opts.isSeated) && !this.expanded;
    this.dock.hidden = !showDock;
    this.sitBtn.textContent = opts.isSeated ? "🪑 Stand (E)" : "🪑 Sit (E)";
    this.sitBtn.classList.toggle("active", opts.isSeated);

    if (!this.friendsModal.hidden) {
      this.renderFriendsModalLists(opts.peers);
    }
  }

  private applyVolume() {
    if (!this.inCinemaEarshot || this.distanceGain <= 0.01) {
      this.video.muted = true;
      this.video.volume = 0;
      if (this.isYouTubeEmbed && this.ytIframe.src) {
        this.sendYouTubeCommand("setVolume", [0]);
      }
      return;
    }
    this.video.muted = false;
    const duckFactor = this.isDucked ? 0.35 : 1.0;
    const finalVol = Math.max(0, Math.min(1, this.userVolume * this.distanceGain * duckFactor));
    this.video.volume = finalVol;
    if (this.isYouTubeEmbed && this.ytIframe.src) {
      this.sendYouTubeCommand("setVolume", [Math.round(finalVol * 100)]);
    }
  }

  updateFrame(_nowMs: number) {
    const elapsedSec = this.getCurrentElapsedSec();
    const detectedDur = this.getEffectiveDurationSec();
    const sliderMax = detectedDur > 0 ? detectedDur : Math.max(60, Math.ceil(elapsedSec + 60));
    const currentPos = detectedDur > 0 ? Math.min(detectedDur, elapsedSec % detectedDur) : elapsedSec;

    if (!this.isDraggingScrub) {
      const maxStr = String(Math.ceil(sliderMax));
      const valStr = String(Math.floor(currentPos));
      this.dockScrub.max = maxStr;
      this.dockScrub.value = valStr;
      this.overlayScrub.max = maxStr;
      this.overlayScrub.value = valStr;

      const timeDisplay = !this.movieUrl
        ? "00:00 / 00:00"
        : detectedDur > 0
          ? `${fmtTime(currentPos)} / ${fmtTime(detectedDur)}`
          : `${fmtTime(currentPos)} / --:--`;
      this.dockTime.textContent = timeDisplay;
      this.overlayTime.textContent = timeDisplay;
    }

    if (
      this.inCinemaEarshot &&
      this.videoReady &&
      !this.usingEmbed &&
      !this.paused &&
      isFinite(this.video.duration) &&
      this.video.duration > 0
    ) {
      const targetTime = elapsedSec % this.video.duration;
      if (Math.abs(this.video.currentTime - targetTime) > 2.0) {
        try {
          this.video.currentTime = targetTime;
        } catch {
          /* ignore */
        }
      }
    }

    const w = this.screenCanvas.width;
    const h = this.screenCanvas.height;
    const ctx = this.ctx;

    if (this.movieUrl && this.videoReady && !this.usingEmbed && this.video.readyState >= 2) {
      ctx.drawImage(this.video, 0, 0, w, h);
    } else {
      this.drawStandbyScreen(ctx, w, h);
    }

    this.screenTexture.needsUpdate = true;

    if (this.expanded && !this.usingEmbed) {
      this.overlayCtx.drawImage(this.screenCanvas, 0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
  }

  private drawStandbyScreen(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = "#121624";
    ctx.fillRect(0, 0, w, h);

    if (this.posterReady && this.posterImg.naturalWidth > 0 && this.movieUrl) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.posterImg, 0, 0, w, h);
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#eef1f6";
    ctx.font = `700 ${Math.round(w * 0.032)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText("CINEMA HALL", w / 2, h / 2 - 16);

    ctx.fillStyle = "#9aa3b2";
    ctx.font = `500 ${Math.round(w * 0.017)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(
      this.movieUrl
        ? "Walk inside the Cinema Hall to hear & watch the stream"
        : `Host (${this.hostName || "1st in hall"}): paste a video or YouTube link below to play`,
      w / 2,
      h / 2 + 24,
    );
    ctx.textAlign = "left";
  }

  addOverlayComment(name: string, text: string, color?: string, isFriend = false, isMe = false) {
    if (!isMe && !isFriend && this.hideStrangerBubbles) return;
    const item = document.createElement("div");
    item.className = "cinema-comment" + (isFriend ? " friend" : "");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = isFriend ? `★ ${name}` : name;
    if (color) who.style.color = color;
    const body = document.createElement("span");
    body.textContent = text;
    item.append(who, body);
    this.overlayChatLog.appendChild(item);
    while (this.overlayChatLog.childElementCount > 20) {
      this.overlayChatLog.firstElementChild?.remove();
    }
    this.overlayChatLog.scrollTop = this.overlayChatLog.scrollHeight;
  }

  handleIncomingFriendRequest(req: FriendIncomingMessage) {
    this.incomingRequests.set(req.fromClientId, req);
    this.latestToastRequester = req.fromClientId;
    this.friendToastText.textContent = `👋 ${req.fromName} sent you a Friend Request!`;
    this.friendToast.hidden = false;
  }

  private renderFriendsModalLists(peers: CinemaFriendPeer[]) {
    this.incomingListEl.innerHTML = "";
    if (this.incomingRequests.size === 0) {
      const none = document.createElement("div");
      none.className = "friends-empty";
      none.textContent = "No pending friend requests.";
      this.incomingListEl.appendChild(none);
    } else {
      for (const req of this.incomingRequests.values()) {
        const row = document.createElement("div");
        row.className = "friend-row";
        const info = document.createElement("div");
        info.className = "friend-info";
        const dot = document.createElement("span");
        dot.className = "swatch-dot";
        dot.style.background = req.fromColor;
        const name = document.createElement("strong");
        name.textContent = req.fromName;
        info.append(dot, name);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Accept Friend";
        btn.addEventListener("click", () => {
          this.onFriendAccept(req.fromClientId);
          this.incomingRequests.delete(req.fromClientId);
          if (this.latestToastRequester === req.fromClientId) this.friendToast.hidden = true;
          this.renderFriendsModalLists(peers);
        });
        row.append(info, btn);
        this.incomingListEl.appendChild(row);
      }
    }

    const friends = peers.filter((p) => p.isFriend);
    this.friendsListEl.innerHTML = "";
    if (friends.length === 0) {
      const none = document.createElement("div");
      none.className = "friends-empty";
      none.textContent = "No friends in the room yet. Send a request to someone below!";
      this.friendsListEl.appendChild(none);
    } else {
      for (const f of friends) {
        const row = document.createElement("div");
        row.className = "friend-row";
        const info = document.createElement("div");
        info.className = "friend-info";
        const dot = document.createElement("span");
        dot.className = "swatch-dot";
        dot.style.background = f.color;
        const name = document.createElement("strong");
        name.textContent = `★ ${f.name}`;
        const sub = document.createElement("span");
        sub.className = "friend-sub";
        sub.textContent = f.seatId >= 0 ? `Seat #${f.seatId + 1}` : `${Math.round(f.distance)}m away`;
        info.append(dot, name, sub);

        const actions = document.createElement("div");
        actions.className = "friend-actions";
        if (this.isHost) {
          const crownBtn = document.createElement("button");
          crownBtn.type = "button";
          crownBtn.className = "secondary";
          crownBtn.textContent = "👑 Make Host";
          crownBtn.addEventListener("click", () => {
            this.onTransferHost(f.sessionId);
            this.closeFriendsModal();
          });
          actions.appendChild(crownBtn);
        }
        const rmBtn = document.createElement("button");
        rmBtn.type = "button";
        rmBtn.className = "secondary";
        rmBtn.textContent = "Remove";
        rmBtn.addEventListener("click", () => this.onFriendRemove(f.clientId));
        actions.appendChild(rmBtn);

        row.append(info, actions);
        this.friendsListEl.appendChild(row);
      }
    }

    const others = peers.filter((p) => !p.isFriend);
    this.nearbyListEl.innerHTML = "";
    if (others.length === 0) {
      const none = document.createElement("div");
      none.className = "friends-empty";
      none.textContent = "Nobody else is in the room right now.";
      this.nearbyListEl.appendChild(none);
    } else {
      for (const p of others) {
        const row = document.createElement("div");
        row.className = "friend-row";
        const info = document.createElement("div");
        info.className = "friend-info";
        const dot = document.createElement("span");
        dot.className = "swatch-dot";
        dot.style.background = p.color;
        const name = document.createElement("strong");
        name.textContent = p.name;
        const sub = document.createElement("span");
        sub.className = "friend-sub";
        sub.textContent = `${Math.round(p.distance)}m away`;
        info.append(dot, name, sub);

        const actions = document.createElement("div");
        actions.className = "friend-actions";
        if (this.isHost) {
          const crownBtn = document.createElement("button");
          crownBtn.type = "button";
          crownBtn.className = "secondary";
          crownBtn.textContent = "👑 Make Host";
          crownBtn.addEventListener("click", () => {
            this.onTransferHost(p.sessionId);
            this.closeFriendsModal();
          });
          actions.appendChild(crownBtn);
        }
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.textContent = "+ Add Friend";
        addBtn.addEventListener("click", () => {
          this.onFriendRequest(p.sessionId);
          addBtn.textContent = "Sent ✓";
          addBtn.disabled = true;
        });
        actions.appendChild(addBtn);

        row.append(info, actions);
        this.nearbyListEl.appendChild(row);
      }
    }
  }
}
