import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { POKER_DEALER_SPOT, POKER_SEAT_SPOTS, POKER_TABLE } from "@vi/shared";
import { CHIP_DENOMS, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf, type ChipStack } from "@vi/shared/poker";
import type { Colliders } from "./collision";
import { Avatar } from "./avatar";

/** What the view needs each frame; filled from the poker room state by main.ts. */
export interface PokerSeatView {
  index: number;
  occupied: boolean;
  name: string;
  status: string;
  chips: ChipStack;
  frontChips: ChipStack;
  front: number;
  /** My own hole cards (only I have them) or another player's shown cards. */
  cards: number[];
  faceDown: boolean;
  isButton: boolean;
  isTurn: boolean;
  lastAction: string;
}

export interface PokerTableSnapshot {
  seats: PokerSeatView[];
  board: number[];
  potChips: ChipStack;
  potTotal: number;
  dealerLine: string;
  /** -1 if I'm not seated. */
  mySeat: number;
  peeking: boolean;
}

const CARD_W = 0.082;
const CARD_H = 0.115;
const CHIP_R = 0.0195;
const CHIP_H = 0.0034;

/**
 * The oval poker table and everything on it, rebuilt only when the state
 * string changes so idle frames cost nothing.
 */
export class PokerTableView {
  readonly group = new THREE.Group();
  private dynamic = new THREE.Group();
  private lastKey = "";
  private cardMats = new Map<string, THREE.MeshStandardMaterial>();
  private backMat: THREE.MeshStandardMaterial;
  private chipMats = new Map<number, THREE.MeshStandardMaterial>();
  private cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  private chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 18);
  private myCardGroup: THREE.Group | undefined;
  private peekT = 0;
  private dealerLineEl: HTMLDivElement;
  private seatLabels: HTMLDivElement[] = [];
  private turnRing: THREE.Mesh;
  private dealer: Avatar;
  private tableY = 0.78;

  constructor(scene: THREE.Scene, colliders: Colliders) {
    const T = POKER_TABLE;
    const cx = T.centerX;
    const cz = T.centerZ;
    this.group.position.set(cx, 0, cz);

    // Table: a stadium shape = box + two half cylinders. Felt on top, padded rail, wood base.
    const feltMat = new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 1 });
    const railMat = new THREE.MeshStandardMaterial({ color: "#2a1410", roughness: 0.6 });
    const baseMat = new THREE.MeshStandardMaterial({ color: "#3b2416", roughness: 0.55, metalness: 0.05 });
    const gold = new THREE.MeshStandardMaterial({ color: "#c9a24a", roughness: 0.3, metalness: 0.8 });

    const top = new THREE.Mesh(stadiumGeometry(T.halfLength, T.halfWidth, 0.06), feltMat);
    top.position.y = this.tableY;
    top.receiveShadow = true;
    this.group.add(top);
    const rail = new THREE.Mesh(stadiumRingGeometry(T.halfLength, T.halfWidth, 0.22, 0.11), railMat);
    rail.position.y = this.tableY + 0.03;
    rail.castShadow = true;
    this.group.add(rail);
    const trim = new THREE.Mesh(stadiumRingGeometry(T.halfLength, T.halfWidth, 0.235, 0.02), gold);
    trim.position.y = this.tableY - 0.02;
    this.group.add(trim);
    const apron = new THREE.Mesh(stadiumGeometry(T.halfLength + 0.2, T.halfWidth + 0.2, 0.16), baseMat);
    apron.position.y = this.tableY - 0.12;
    apron.castShadow = true;
    this.group.add(apron);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, this.tableY - 0.2, 16), baseMat);
    pedestal.position.y = (this.tableY - 0.2) / 2;
    this.group.add(pedestal);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.08, 24), baseMat);
    foot.position.y = 0.04;
    this.group.add(foot);

    // Cup holders in the rail at each seat.
    for (const s of POKER_SEAT_SPOTS) {
      const dir = new THREE.Vector2(s.x - cx, s.z - cz).normalize();
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.03, 12), gold);
      const edge = stadiumPoint(dir, T.halfLength + 0.13, T.halfWidth + 0.13);
      cup.position.set(edge.x, this.tableY + 0.135, edge.y);
      this.group.add(cup);
    }

    // Dealer: shoe, chip tray, and the NPC avatar on a stool.
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.19), new THREE.MeshStandardMaterial({ color: "#0f0f12", roughness: 0.3 }));
    shoe.position.set(0.55, this.tableY + 0.06, T.halfWidth - 0.22);
    this.group.add(shoe);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.14), new THREE.MeshStandardMaterial({ color: "#1a1a1d", roughness: 0.4 }));
    tray.position.set(-0.2, this.tableY + 0.045, T.halfWidth - 0.2);
    this.group.add(tray);
    for (let i = 0; i < 5; i++) {
      const d = CHIP_DENOMS[i]!;
      const stack = this.chipStack(d.value, 20);
      stack.position.set(-0.4 + i * 0.1, this.tableY + 0.06, T.halfWidth - 0.2);
      this.group.add(stack);
    }
    this.dealer = new Avatar("Dealer", "#15151a");
    this.dealer.position.set(POKER_DEALER_SPOT.x - cx, 0, POKER_DEALER_SPOT.z - cz);
    this.dealer.rot = POKER_DEALER_SPOT.rot;
    this.dealer.seatId = 999;
    this.dealer.anim = 3; // sit
    this.group.add(this.dealer.group);

    // Turn indicator ring on the felt in front of the acting seat.
    this.turnRing = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.13, 24), new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.turnRing.rotation.x = -Math.PI / 2;
    this.turnRing.visible = false;
    this.group.add(this.turnRing);

    // Dealer line floating above the table.
    this.dealerLineEl = document.createElement("div");
    this.dealerLineEl.className = "label poker-dealer-line";
    const lineObj = new CSS2DObject(this.dealerLineEl);
    lineObj.position.set(0, this.tableY + 1.45, 0);
    this.group.add(lineObj);

    // Per-seat name/stack labels.
    for (const s of POKER_SEAT_SPOTS) {
      const el = document.createElement("div");
      el.className = "label poker-seat-label";
      const obj = new CSS2DObject(el);
      const dir = new THREE.Vector2(s.x - cx, s.z - cz).normalize();
      const p = stadiumPoint(dir, T.halfLength - 0.32, T.halfWidth - 0.32);
      obj.position.set(p.x, this.tableY + 0.02, p.y);
      this.group.add(obj);
      this.seatLabels.push(el);
    }

    this.backMat = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.55, side: THREE.DoubleSide });
    this.group.add(this.dynamic);
    scene.add(this.group);
    colliders.boxes.push({ x: cx, z: cz, hw: T.halfLength + T.halfWidth + 0.25, hd: T.halfWidth + 0.25 });
  }

  /** Speech bubble over the dealer's head. */
  dealerSay(text: string, ms = 5000) {
    this.dealer.say(text, ms);
  }

  /** Animate the dealer and the peek; cheap. */
  tick(dt: number, peeking: boolean) {
    this.dealer.update(dt);
    const target = peeking ? 1 : 0;
    this.peekT += (target - this.peekT) * Math.min(1, dt * 10);
    if (this.myCardGroup) {
      // Lift the near edge of your two cards towards you, like cupping them at a live table.
      this.myCardGroup.rotation.x = -Math.PI / 2 + this.peekT * 1.05;
      this.myCardGroup.position.y = this.tableY + 0.065 + this.peekT * 0.06;
      this.myCardGroup.children.forEach((c, i) => {
        if (i === 1) c.rotation.z = -0.18 * this.peekT; // fan the second card a little
        const mesh = c as THREE.Mesh;
        const face = mesh.userData.face as THREE.Material | undefined;
        if (face) mesh.material = this.peekT > 0.45 ? face : this.backMat;
      });
    }
    const t = performance.now() / 1000;
    (this.turnRing.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t * 4) * 0.3;
  }

  /** Rebuilds cards and chips from the snapshot when anything changed. */
  update(snap: PokerTableSnapshot) {
    const key = JSON.stringify({ s: snap.seats, b: snap.board, p: snap.potChips, m: snap.mySeat });
    this.dealerLineEl.textContent = snap.dealerLine;
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.dynamic.clear();
    this.myCardGroup = undefined;
    const T = POKER_TABLE;
    const cx = T.centerX;
    const cz = T.centerZ;
    const y = this.tableY + 0.062;

    // Community cards.
    snap.board.forEach((card, i) => {
      const m = this.cardMesh(card, false);
      m.position.set(-0.19 + i * 0.095, y, -0.05);
      m.rotation.x = -Math.PI / 2;
      this.dynamic.add(m);
    });

    // Pot chips in the middle.
    this.placeChips(snap.potChips, new THREE.Vector2(0, 0.18), y);

    this.turnRing.visible = false;
    for (const sv of snap.seats) {
      const spot = POKER_SEAT_SPOTS[sv.index]!;
      const label = this.seatLabels[sv.index]!;
      const dir = new THREE.Vector2(spot.x - cx, spot.z - cz).normalize();
      if (!sv.occupied) {
        label.innerHTML = `<span class="poker-seat-empty">Seat ${sv.index + 1}<br>press E</span>`;
        continue;
      }
      const statusTag = sv.status === "folded" ? " · folded" : sv.status === "allin" ? " · all in" : sv.status === "out" ? " · sitting out" : sv.status === "sitting" ? " · next hand" : "";
      label.innerHTML = `<span class="poker-seat-name${sv.isTurn ? " turn" : ""}">${sv.isButton ? "<b class='btn-puck'>D</b> " : ""}${escapeHtml(sv.name)}${statusTag}</span>${sv.lastAction ? `<span class="poker-seat-action">${escapeHtml(sv.lastAction)}</span>` : ""}`;

      // Chips behind: on the rail edge in front of the player.
      const behind = stadiumPoint(dir, T.halfLength - 0.2, T.halfWidth - 0.2);
      this.placeChips(sv.chips, behind, y, 0.045);

      // Bet in front: across the betting line, towards the middle.
      if (sv.front > 0) {
        const frontPos = stadiumPoint(dir, T.halfLength - 0.7, T.halfWidth - 0.6);
        this.placeChips(sv.frontChips, frontPos, y, 0.04);
      }

      // Hole cards: mine face-down in front of me (peekable), others as backs, shown cards face-up.
      if (sv.cards.length > 0 || sv.status === "in" || sv.status === "allin") {
        const cardPos = stadiumPoint(dir, T.halfLength - 0.42, T.halfWidth - 0.4);
        const grp = new THREE.Group();
        grp.position.set(cardPos.x, y, cardPos.y);
        grp.rotation.y = Math.atan2(-dir.x, -dir.y) + Math.PI;
        const n = sv.cards.length > 0 ? sv.cards.length : 2;
        for (let i = 0; i < n; i++) {
          const card = sv.cards[i];
          const showFace = card !== undefined && !sv.faceDown && sv.index !== snap.mySeat;
          const mesh = this.cardMesh(showFace ? card : -1, !showFace);
          mesh.position.set((i - (n - 1) / 2) * 0.05, i * 0.001, 0);
          grp.add(mesh);
        }
        grp.rotation.x = -Math.PI / 2;
        if (sv.index === snap.mySeat && sv.cards.length > 0) {
          // My cards lie face-down like everyone else's; peeking lifts them and
          // swaps in the faces, so nothing readable is ever flat on the felt.
          grp.children.forEach((c, i) => {
            const mesh = c as THREE.Mesh;
            mesh.material = this.backMat;
            mesh.userData.face = this.cardMat(sv.cards[i]!);
          });
          this.myCardGroup = grp;
        }
        this.dynamic.add(grp);
      }

      if (sv.isTurn) {
        const ringPos = stadiumPoint(dir, T.halfLength - 0.55, T.halfWidth - 0.5);
        this.turnRing.position.set(ringPos.x, y + 0.002, ringPos.y);
        this.turnRing.visible = true;
      }
    }
  }

  private placeChips(chips: ChipStack, at: THREE.Vector2, y: number, spread = 0.045) {
    const denoms = Object.keys(chips)
      .map(Number)
      .filter((v) => chips[v]! > 0)
      .sort((a, b) => b - a);
    let col = 0;
    for (const v of denoms) {
      let left = chips[v]!;
      while (left > 0) {
        const n = Math.min(left, 20);
        const stack = this.chipStack(v, n);
        stack.position.set(at.x + (col % 4) * spread - spread * 1.5, y, at.y + Math.floor(col / 4) * spread);
        this.dynamic.add(stack);
        left -= n;
        col++;
      }
    }
  }

  private chipStack(value: number, count: number): THREE.Group {
    const g = new THREE.Group();
    const mat = this.chipMat(value);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.chipGeo, mat);
      m.position.y = CHIP_H / 2 + i * CHIP_H;
      m.rotation.y = (i * 0.7) % Math.PI;
      m.castShadow = i === count - 1;
      g.add(m);
    }
    return g;
  }

  private chipMat(value: number): THREE.MeshStandardMaterial {
    let m = this.chipMats.get(value);
    if (!m) {
      const d = CHIP_DENOMS.find((x) => x.value === value) ?? CHIP_DENOMS[0]!;
      m = new THREE.MeshStandardMaterial({ map: chipTexture(d.color, d.label), roughness: 0.5 });
      this.chipMats.set(value, m);
    }
    return m;
  }

  private cardMesh(card: number, back: boolean): THREE.Mesh {
    const mat = back ? this.backMat : this.cardMat(card);
    const m = new THREE.Mesh(this.cardGeo, mat);
    return m;
  }

  private cardMat(card: number): THREE.MeshStandardMaterial {
    const key = String(card);
    let m = this.cardMats.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: cardFaceTexture(card), roughness: 0.55, side: THREE.DoubleSide });
      this.cardMats.set(key, m);
    }
    return m;
  }
}

// ---- Geometry helpers -------------------------------------------------------------

/** Point on a stadium (box with semicircular ends) of half-length a (x) and half-width b (z) in direction dir. */
function stadiumPoint(dir: THREE.Vector2, a: number, b: number): THREE.Vector2 {
  // Treat as an ellipse with the stadium's extents; close enough for placing objects.
  const t = Math.atan2(dir.y / b, dir.x / a);
  return new THREE.Vector2(Math.cos(t) * a, Math.sin(t) * b);
}

function stadiumShape(a: number, b: number): THREE.Shape {
  const s = new THREE.Shape();
  const straight = a - b;
  s.moveTo(-straight, -b);
  s.lineTo(straight, -b);
  s.absarc(straight, 0, b, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-straight, b);
  s.absarc(-straight, 0, b, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

function stadiumGeometry(a: number, b: number, depth: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(stadiumShape(a, b), { depth, bevelEnabled: false, curveSegments: 24 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, 0);
  // Map UVs to 0..1 over the top so the felt texture fits.
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * a) + 0.5, uv.getY(i) / (2 * b) + 0.5);
  return geo;
}

function stadiumRingGeometry(a: number, b: number, width: number, height: number): THREE.BufferGeometry {
  const outer = stadiumShape(a + width, b + width);
  outer.holes.push(stadiumShape(a, b));
  const geo = new THREE.ExtrudeGeometry(outer, { depth: height, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, curveSegments: 24 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ---- Textures --------------------------------------------------------------------------

function feltTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 700;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0f5e3a";
  ctx.fillRect(0, 0, c.width, c.height);
  // Subtle fibre noise.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  // Betting line.
  ctx.strokeStyle = "rgba(255,230,160,0.55)";
  ctx.lineWidth = 4;
  roundedRect(ctx, 140, 110, c.width - 280, c.height - 220, 220);
  ctx.stroke();
  // Community card spots.
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const w = 52;
    const h = 74;
    ctx.strokeRect(c.width / 2 - 2.5 * 62 + i * 62 + 5, c.height / 2 - h / 2 - 18, w, h);
  }
  // Centre crest.
  ctx.fillStyle = "rgba(255,230,160,0.35)";
  ctx.font = "bold 46px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("ROYAL ARCADE", c.width / 2, c.height / 2 + 120);
  ctx.font = "22px Georgia, serif";
  ctx.fillText("NO-LIMIT HOLD'EM", c.width / 2, c.height / 2 + 150);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + h / 2, h / 2, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h / 2, h / 2, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

function cardFaceTexture(card: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 358;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fbfbf7";
  roundedRectSimple(ctx, 0, 0, c.width, c.height, 22);
  ctx.fill();
  const rank = RANK_CHARS[rankOf(card)] === "T" ? "10" : RANK_CHARS[rankOf(card)]!;
  const suit = SUIT_SYMBOLS[suitOf(card)]!;
  const red = suitOf(card) === 1 || suitOf(card) === 2;
  ctx.fillStyle = red ? "#c8102e" : "#111";
  ctx.font = "bold 64px Georgia, serif";
  ctx.textAlign = "left";
  ctx.fillText(rank, 18, 70);
  ctx.font = "54px serif";
  ctx.fillText(suit, 20, 126);
  ctx.save();
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  ctx.font = "bold 64px Georgia, serif";
  ctx.fillText(rank, 18, 70);
  ctx.font = "54px serif";
  ctx.fillText(suit, 20, 126);
  ctx.restore();
  ctx.font = "150px serif";
  ctx.textAlign = "center";
  ctx.fillText(suit, c.width / 2, c.height / 2 + 52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function cardBackTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 358;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fbfbf7";
  roundedRectSimple(ctx, 0, 0, c.width, c.height, 22);
  ctx.fill();
  ctx.fillStyle = "#7a1021";
  roundedRectSimple(ctx, 14, 14, c.width - 28, c.height - 28, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(201,162,74,0.8)";
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(20, 20 + i * 28);
    ctx.lineTo(c.width - 20, c.height - 20 - i * 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.width - 20, 20 + i * 28);
    ctx.lineTo(20, c.height - 20 - i * 28);
    ctx.stroke();
  }
  ctx.fillStyle = "#c9a24a";
  ctx.font = "bold 40px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText("RA", c.width / 2, c.height / 2 + 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function chipTexture(color: string, label: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  // Edge spots.
  ctx.fillStyle = color === "#f5f5f5" ? "#1e40af" : "#f5f5f5";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(64, 64, 34, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.font = "bold 30px Georgia, serif";
  ctx.textAlign = "center";
  ctx.fillText(label, 64, 75);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundedRectSimple(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
