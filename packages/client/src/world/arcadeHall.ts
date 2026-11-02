import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { ARCADE_HALL, POKER_DEALER_SPOT, POKER_SEAT_SPOTS, POKER_TABLE } from "@vi/shared";
import type { Colliders } from "./collision";
import { PokerTableView } from "./pokerTable";

/**
 * The Royal Arcade Hall: an enclosed room with burgundy walls, gold trim and
 * warm chandelier light, so the inside reads as a private club rather than a
 * plaza. The roof casts shadow, which is what makes the warm lights matter.
 */
export function addArcadeHall(scene: THREE.Scene, colliders: Colliders): { pokerTable: PokerTableView } {
  const H = ARCADE_HALL;
  const g = new THREE.Group();
  const cx = (H.minX + H.maxX) / 2;
  const cz = (H.minZ + H.maxZ) / 2;
  const w = H.maxX - H.minX;
  const d = H.maxZ - H.minZ;
  const h = H.wallHeight;

  const wallMat = new THREE.MeshStandardMaterial({ color: "#4a1c24", roughness: 0.95, metalness: 0 });
  const trimMat = new THREE.MeshStandardMaterial({ color: "#c9a24a", roughness: 0.35, metalness: 0.7, emissive: "#6b4f12", emissiveIntensity: 0.25 });
  const darkWood = new THREE.MeshStandardMaterial({ color: "#2b1a12", roughness: 0.7 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: "#1b1016", roughness: 1 });

  // Floor: patterned carpet from a canvas.
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(cx, 0.03, cz);
  carpet.receiveShadow = true;
  g.add(carpet);

  // Walls, with a doorway in the west wall facing the plaza.
  const wallT = 0.5;
  const wall = (x: number, z: number, sx: number, sz: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    colliders.boxes.push({ x, z, hw: sx / 2, hd: sz / 2 });
    // Gold dado rail and cornice.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.04, 0.12, sz + 0.04), trimMat);
    rail.position.set(x, 1.1, z);
    g.add(rail);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.06, 0.2, sz + 0.06), trimMat);
    cornice.position.set(x, h - 0.1, z);
    g.add(cornice);
  };
  wall(cx, H.minZ, w, wallT); // north
  wall(cx, H.maxZ, w, wallT); // south
  wall(H.maxX, cz, wallT, d); // east
  // West wall in two pieces around the door.
  const doorSide = (H.maxZ - H.doorHalfW - (H.minZ + H.doorHalfW)) / 2; // unused helper kept simple below
  void doorSide;
  const westLenEach = d / 2 - H.doorHalfW;
  wall(H.minX, H.minZ + westLenEach / 2, wallT, westLenEach);
  wall(H.minX, H.maxZ - westLenEach / 2, wallT, westLenEach);
  // Door frame and lintel.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.3, h - 3.6, H.doorHalfW * 2 + 0.4), wallMat);
  lintel.position.set(H.minX, 3.6 + (h - 3.6) / 2, cz);
  g.add(lintel);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(wallT + 0.5, 0.25, H.doorHalfW * 2 + 0.6), trimMat);
  frame.position.set(H.minX, 3.6, cz);
  g.add(frame);

  // Roof: casts shadow so the interior is lit by the chandeliers.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.4, d + 1.2), ceilingMat);
  roof.position.set(cx, h + 0.2, cz);
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);
  // Ceiling coffers (gold frames) for depth.
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const coffer = new THREE.Mesh(new THREE.BoxGeometry(9, 0.15, 7.5), trimMat);
      coffer.position.set(cx + i * 11, h - 0.08, cz + j * 9);
      g.add(coffer);
    }
  }

  // Chandeliers: warm point lights with glowing crystal bodies.
  const glowMat = new THREE.MeshStandardMaterial({ color: "#ffe9b0", emissive: "#ffcf6a", emissiveIntensity: 2.4 });
  const chandelierAt = (x: number, z: number, intensity: number) => {
    const light = new THREE.PointLight("#ffd27a", intensity, 22, 2);
    light.position.set(x, h - 1.6, z);
    light.castShadow = false;
    g.add(light);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), glowMat);
    body.position.set(x, h - 1.6, z);
    g.add(body);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.06, 8, 24), trimMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, h - 1.3, z);
    g.add(ring);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), trimMat);
    chain.position.set(x, h - 0.6, z);
    g.add(chain);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const candle = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat);
      candle.position.set(x + Math.cos(a) * 0.9, h - 1.25, z + Math.sin(a) * 0.9);
      g.add(candle);
    }
  };
  chandelierAt(POKER_TABLE.centerX, POKER_TABLE.centerZ, 90); // over the poker table
  chandelierAt(cx - 10, cz - 7, 55);
  chandelierAt(cx - 10, cz + 7, 55);
  chandelierAt(cx + 12, cz - 8, 45);
  chandelierAt(cx + 12, cz + 8, 45);
  // Soft fill so corners aren't black.
  const fill = new THREE.PointLight("#b88a4a", 25, 40, 2);
  fill.position.set(cx, 3.5, cz);
  g.add(fill);

  // Wall sconces along the long walls.
  for (let i = 0; i < 5; i++) {
    const x = H.minX + 5 + i * (w - 10) / 4;
    for (const z of [H.minZ + 0.35, H.maxZ - 0.35]) {
      const sconce = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 8, 1, true), trimMat);
      sconce.rotation.x = Math.PI;
      sconce.position.set(x, 3.2, z);
      g.add(sconce);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat);
      bulb.position.set(x, 3.35, z);
      g.add(bulb);
    }
  }

  // A velvet rope and brass posts at the entrance.
  for (const z of [cz - H.doorHalfW - 0.6, cz + H.doorHalfW + 0.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.0, 8), trimMat);
    post.position.set(H.minX + 1.2, 0.5, z);
    g.add(post);
  }

  // Sign over the door.
  const sign = document.createElement("div");
  sign.className = "label";
  sign.innerHTML = `<span class="label-name hall-sign">ROYAL ARCADE</span>`;
  const signObj = new CSS2DObject(sign);
  signObj.position.set(H.minX - 0.6, 4.6, cz);
  g.add(signObj);

  // Classic cabinets along the north wall (Connect 4, Tic-Tac-Toe, Trivia keep living here).
  const cabColors = ["#a66ce8", "#4fc3d9", "#f28ac9", "#6fcf7a"];
  cabColors.forEach((col, i) => {
    const x = H.minX + 6 + i * 3.2;
    const z = H.minZ + 1.3;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 1.1), new THREE.MeshStandardMaterial({ color: "#14161c", emissive: col, emissiveIntensity: 0.35, roughness: 0.5 }));
    cab.position.set(x, 1.05, z);
    cab.castShadow = true;
    g.add(cab);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), new THREE.MeshBasicMaterial({ color: col }));
    screen.position.set(x, 1.5, z + 0.56);
    screen.rotation.x = -0.25;
    g.add(screen);
    colliders.boxes.push({ x, z, hw: 0.7, hd: 0.55 });
  });

  // Bar counter along the east wall with bottles (set dressing).
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 10), darkWood);
  bar.position.set(H.maxX - 2.2, 0.55, cz);
  bar.castShadow = true;
  g.add(bar);
  colliders.boxes.push({ x: H.maxX - 2.2, z: cz, hw: 0.6, hd: 5 });
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 10.2), trimMat);
  barTop.position.set(H.maxX - 2.2, 1.14, cz);
  g.add(barTop);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 9), darkWood);
  shelf.position.set(H.maxX - 0.45, 1.9, cz);
  g.add(shelf);
  const bottleColors = ["#7c2d12", "#064e3b", "#1e3a8a", "#78350f", "#4c1d95"];
  for (let i = 0; i < 14; i++) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.32, 8),
      new THREE.MeshStandardMaterial({ color: bottleColors[i % bottleColors.length]!, roughness: 0.2, metalness: 0.1 }),
    );
    b.position.set(H.maxX - 0.45, 2.09, cz - 4 + i * 0.6);
    g.add(b);
  }

  scene.add(g);

  // The poker table itself.
  const pokerTable = new PokerTableView(scene, colliders);

  // Seat stools (the hub seats avatars on them).
  const stoolMat = new THREE.MeshStandardMaterial({ color: "#5b1d27", roughness: 0.8 });
  for (const s of POKER_SEAT_SPOTS) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.1, 14), stoolMat);
    seat.position.set(s.x, 0.52, s.z);
    seat.castShadow = true;
    g.add(seat);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 8), trimMat);
    leg.position.set(s.x, 0.25, s.z);
    g.add(leg);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14), trimMat);
    base.position.set(s.x, 0.015, s.z);
    g.add(base);
  }
  // Dealer's stool.
  const dealerStool = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.1, 14), darkWood);
  dealerStool.position.set(POKER_DEALER_SPOT.x, 0.6, POKER_DEALER_SPOT.z);
  g.add(dealerStool);

  return { pokerTable };
}

function carpetTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#5a1b22";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(201,162,74,0.55)";
  ctx.lineWidth = 3;
  const step = 64;
  for (let x = 0; x <= 512; x += step) {
    for (let y = 0; y <= 512; y += step) {
      ctx.beginPath();
      ctx.moveTo(x, y - step / 2);
      ctx.lineTo(x + step / 2, y);
      ctx.lineTo(x, y + step / 2);
      ctx.lineTo(x - step / 2, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(201,162,74,0.35)";
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
