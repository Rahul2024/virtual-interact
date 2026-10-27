import { MSG, VOICE, type MicMessage } from "@vi/shared";
import type { HubRoom } from "../net/connection";

/**
 * Proximity voice with Smart Social Privacy Gate:
 * - Inside the Open Social Zone (Central Fountain): open proximity voice with
 *   anyone nearby so you can meet new people and send Friend Requests.
 * - Outside the Open Social Zone (including inside the Cinema Hall): you only
 *   hear and speak to players who have accepted your Friend Request. Strangers
 *   are 100% voice-muted so there is zero noise chaos during movies.
 */

export type VoiceStatus = "off" | "requesting" | "on" | "muted" | "denied" | "no-mic" | "unsupported" | "error";

export interface Locator {
  myPosition(): { x: number; z: number };
  /** Camera yaw in radians, used to pan voices left/right. */
  listenerYaw(): number;
  peerPosition(id: string): { x: number; z: number } | undefined;
  /**
   * Returns true if voice is allowed with this peer (either both in the Open
   * Social Zone, or the peer is an accepted Friend).
   */
  canHearPeer(id: string): boolean;
}

interface Peer {
  pc: RTCPeerConnection;
  initiator: boolean;
  stream?: MediaStream;
  el?: HTMLAudioElement;
  source?: MediaStreamAudioSourceNode;
  gain?: GainNode;
  pan?: StereoPannerNode;
  analyser?: AnalyserNode;
  speaking: boolean;
  pendingIce: RTCIceCandidateInit[];
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

function plain(desc: RTCSessionDescription | null): RTCSessionDescriptionInit {
  return { type: desc?.type ?? "offer", sdp: desc?.sdp ?? "" };
}

export class Voice {
  status: VoiceStatus = "off";
  onStatus: (status: VoiceStatus) => void = () => {};
  /** `id` is a peer session id, or "me". */
  onSpeaking: (id: string, speaking: boolean) => void = () => {};

  private ctx: AudioContext | undefined;
  private local: MediaStream | undefined;
  private localAnalyser: AnalyserNode | undefined;
  private localSpeaking = false;
  private members = new Set<string>();
  private peers = new Map<string, Peer>();
  private lastReview = 0;
  private lastLevel = 0;
  private unbind: Array<() => void> = [];
  private sample = new Float32Array(1024);

  constructor(
    private readonly room: HubRoom,
    private readonly locator: Locator,
  ) {
    const on = (type: string, fn: (m: any) => void) => this.unbind.push(room.onMessage(type, fn));
    on("webrtc:peers", (ids: string[]) => {
      for (const id of ids) this.members.add(id);
      this.review(true);
    });
    on("webrtc:peer-joined", (id: string) => {
      this.members.add(id);
      this.review(true);
    });
    on("webrtc:peer-left", (id: string) => {
      this.members.delete(id);
      this.drop(id);
    });
    on("webrtc:offer", (m: { peerId: string; sdp: RTCSessionDescriptionInit }) => void this.onOffer(m.peerId, m.sdp));
    on("webrtc:answer", (m: { peerId: string; sdp: RTCSessionDescriptionInit }) => void this.onAnswer(m.peerId, m.sdp));
    on("webrtc:ice-candidate", (m: { peerId: string; candidate: RTCIceCandidateInit }) => void this.onIce(m.peerId, m.candidate));
  }

  get isOn(): boolean {
    return this.status === "on" || this.status === "muted";
  }

  /** How many audible people (allowed by zone/friend rules) are within range right now. */
  get listeners(): number {
    let n = 0;
    for (const id of this.peers.keys()) {
      if (!this.locator.canHearPeer(id)) continue;
      const d = this.distanceTo(id);
      if (d !== undefined && d < VOICE.farRadius) n++;
    }
    return n;
  }

  /** True if any connected friend/peer is currently speaking audibly (used for movie audio ducking). */
  get isAnyPeerSpeaking(): boolean {
    for (const peer of this.peers.values()) {
      if (peer.speaking) return true;
    }
    return false;
  }

  /** Ask for the microphone and join the mesh. Call from a click. */
  async start(): Promise<void> {
    if (this.isOn || this.status === "requesting") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      this.setStatus("unsupported");
      return;
    }
    this.setStatus("requesting");
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      const name = (err as DOMException)?.name;
      this.setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-mic" : "error");
      return;
    }

    this.ctx = new AudioContext();
    await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.local);
    this.localAnalyser = this.ctx.createAnalyser();
    this.localAnalyser.fftSize = 1024;
    src.connect(this.localAnalyser);

    this.setStatus("on");
    this.room.send(MSG.mic, { on: true } satisfies MicMessage);
    this.room.send("webrtc:join");
    for (const peer of this.peers.values()) this.attachLocal(peer.pc);
  }

  setMuted(muted: boolean) {
    if (!this.isOn || !this.local) return;
    for (const t of this.local.getAudioTracks()) t.enabled = !muted;
    this.setStatus(muted ? "muted" : "on");
    this.room.send(MSG.mic, { on: !muted } satisfies MicMessage);
    if (muted && this.localSpeaking) {
      this.localSpeaking = false;
      this.onSpeaking("me", false);
    }
  }

  toggleMuted() {
    this.setMuted(this.status !== "muted");
  }

  update(now: number) {
    if (now - this.lastReview > VOICE.reviewMs) {
      this.lastReview = now;
      this.review(false);
    }
    if (now - this.lastLevel > 80) {
      this.lastLevel = now;
      this.measureLevels();
    }
    this.mix();
  }

  dispose() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const fn of this.unbind) fn();
    this.unbind = [];
    this.members.clear();
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
    this.setStatus("off");
  }

  // ---- Mesh management --------------------------------------------------------

  private review(immediate: boolean) {
    if (!this.isOn) return;
    for (const id of this.members) {
      const d = this.distanceTo(id);
      const peer = this.peers.get(id);
      const initiator = this.room.sessionId < id;
      if (!peer) {
        if (initiator && d !== undefined && d < VOICE.connectRadius) void this.connect(id);
      } else if (peer.initiator && d !== undefined && d > VOICE.connectRadius * 1.3) {
        this.drop(id);
      }
    }
    if (immediate) this.mix();
  }

  private newPeer(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, initiator, speaking: false, pendingIce: [] };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.room.send("webrtc:ice-candidate", { targetId: id, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.attachRemote(peer, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
        if (pc.connectionState === "disconnected") {
          setTimeout(() => {
            if (pc.connectionState === "disconnected") this.drop(id);
          }, 3000);
        } else this.drop(id);
      }
    };
    this.attachLocal(pc);
    return peer;
  }

  private attachLocal(pc: RTCPeerConnection) {
    if (!this.local) return;
    const have = new Set(pc.getSenders().map((s) => s.track));
    for (const track of this.local.getAudioTracks()) if (!have.has(track)) pc.addTrack(track, this.local);
  }

  private async connect(id: string) {
    const peer = this.newPeer(id, true);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
      await peer.pc.setLocalDescription(offer);
      this.room.send("webrtc:offer", { targetId: id, sdp: plain(peer.pc.localDescription) });
    } catch (err) {
      console.warn("voice: offer failed", err);
      this.drop(id);
    }
  }

  private async onOffer(id: string, sdp: RTCSessionDescriptionInit) {
    if (!this.isOn) return;
    if (this.peers.has(id)) this.drop(id);
    this.members.add(id);
    const peer = this.newPeer(id, false);
    try {
      await peer.pc.setRemoteDescription(sdp);
      await this.flushIce(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.room.send("webrtc:answer", { targetId: id, sdp: plain(peer.pc.localDescription) });
    } catch (err) {
      console.warn("voice: answer failed", err);
      this.drop(id);
    }
  }

  private async onAnswer(id: string, sdp: RTCSessionDescriptionInit) {
    const peer = this.peers.get(id);
    if (!peer || peer.pc.signalingState !== "have-local-offer") return;
    try {
      await peer.pc.setRemoteDescription(sdp);
      await this.flushIce(peer);
    } catch (err) {
      console.warn("voice: bad answer", err);
      this.drop(id);
    }
  }

  private async onIce(id: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (!peer.pc.remoteDescription) {
      peer.pendingIce.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn("voice: ice candidate rejected", err);
    }
  }

  private async flushIce(peer: Peer) {
    const pending = peer.pendingIce.splice(0);
    for (const c of pending) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch {
        /* stale candidate */
      }
    }
  }

  private drop(id: string) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    if (peer.speaking) this.onSpeaking(id, false);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.source?.disconnect();
    peer.gain?.disconnect();
    peer.pan?.disconnect();
    peer.analyser?.disconnect();
    if (peer.el) {
      peer.el.srcObject = null;
      peer.el.remove();
    }
  }

  // ---- Audio graph ----------------------------------------------------------

  private attachRemote(peer: Peer, stream: MediaStream) {
    if (!this.ctx) return;
    peer.stream = stream;
    const el = document.createElement("audio");
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    document.body.appendChild(el);
    void el.play().catch(() => {});
    peer.el = el;

    peer.source = this.ctx.createMediaStreamSource(stream);
    peer.gain = this.ctx.createGain();
    peer.gain.gain.value = 0;
    peer.pan = this.ctx.createStereoPanner();
    peer.analyser = this.ctx.createAnalyser();
    peer.analyser.fftSize = 1024;
    peer.source.connect(peer.gain);
    peer.gain.connect(peer.pan);
    peer.pan.connect(this.ctx.destination);
    peer.source.connect(peer.analyser);
  }

  /**
   * Volume by distance, pan by direction, and strictly gated by Open Social
   * Zone vs. Friend-Only status.
   */
  private mix() {
    if (!this.ctx) return;
    const me = this.locator.myPosition();
    const yaw = this.locator.listenerYaw();
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const t = this.ctx.currentTime;
    for (const [id, peer] of this.peers) {
      if (!peer.gain || !peer.pan) continue;
      const p = this.locator.peerPosition(id);
      const allowed = this.locator.canHearPeer(id);
      if (!p || !allowed) {
        peer.gain.gain.setTargetAtTime(0, t, 0.04);
        continue;
      }
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      const d = Math.hypot(dx, dz);
      const vol = d <= VOICE.nearRadius ? 1 : d >= VOICE.farRadius ? 0 : 1 - (d - VOICE.nearRadius) / (VOICE.farRadius - VOICE.nearRadius);
      peer.gain.gain.setTargetAtTime(vol, t, 0.05);
      const pan = d > 0.5 ? (dx * -fz + dz * fx) / d : 0;
      peer.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)) * 0.8, t, 0.05);
    }
  }

  private measureLevels() {
    if (this.localAnalyser && this.status === "on") {
      const speaking = this.rms(this.localAnalyser) > VOICE.speakingThreshold;
      if (speaking !== this.localSpeaking) {
        this.localSpeaking = speaking;
        this.onSpeaking("me", speaking);
      }
    }
    for (const [id, peer] of this.peers) {
      if (!peer.analyser) continue;
      const audible = (peer.gain?.gain.value ?? 0) > 0.02;
      const speaking = audible && this.rms(peer.analyser) > VOICE.speakingThreshold;
      if (speaking !== peer.speaking) {
        peer.speaking = speaking;
        this.onSpeaking(id, speaking);
      }
    }
  }

  private rms(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.sample);
    let sum = 0;
    for (let i = 0; i < this.sample.length; i++) sum += this.sample[i]! * this.sample[i]!;
    return Math.sqrt(sum / this.sample.length);
  }

  private distanceTo(id: string): number | undefined {
    const p = this.locator.peerPosition(id);
    if (!p) return undefined;
    const me = this.locator.myPosition();
    return Math.hypot(p.x - me.x, p.z - me.z);
  }

  private setStatus(status: VoiceStatus) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }
}
