import * as THREE from "three";
import { BRICK_DUNGEON } from "@vi/shared";
import { Colliders } from "./collision";

export interface DungeonView {
  dungeonWing: number;
  dungeonSeed: number;
  grimoireFound: number;
  gateLeftOpen: number;
  gateRightOpen: number;
  vaultUnlocked: number;
  arrowVolleyZ: number;
  fireBoulderZ: number;
  websBurned: number;
  chompingChests: number;
  nowMs: number;
}

export interface DungeonRig {
  group: THREE.Group;
  colliders: Colliders;
  update(view: DungeonView): void;
  dispose(): void;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standard(color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, flatShading: true, ...extra });
}

function createBrickPBRMaterial(opts: {
  repeatX: number;
  repeatY: number;
  baseColor?: string;
  mossy?: boolean;
  cracked?: boolean;
  bumpScale?: number;
}): THREE.MeshStandardMaterial {
  const colorCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  colorCanvas.width = bumpCanvas.width = 256;
  colorCanvas.height = bumpCanvas.height = 256;

  const cCtx = colorCanvas.getContext("2d")!;
  const bCtx = bumpCanvas.getContext("2d")!;

  cCtx.fillStyle = "#1b1e24";
  cCtx.fillRect(0, 0, 256, 256);
  bCtx.fillStyle = "#181818";
  bCtx.fillRect(0, 0, 256, 256);

  const rows = 4;
  const cols = 2;
  const rowH = 256 / rows;
  const colW = 256 / cols;
  const rand = mulberry32(opts.cracked ? 7712 : 4409);

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const bx = c * colW + offset + 4;
      const by = r * rowH + 4;
      const bw = colW - 8;
      const bh = rowH - 8;

      const shade = Math.floor(66 + rand() * 26);
      cCtx.fillStyle = opts.baseColor ?? `rgb(${shade}, ${shade + 4}, ${shade + 11})`;
      cCtx.fillRect(bx, by, bw, bh);

      bCtx.fillStyle = "#d8d8d8";
      bCtx.fillRect(bx, by, bw, bh);
      bCtx.fillStyle = "#f4f4f4";
      bCtx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);

      for (let p = 0; p < 18; p++) {
        const px = bx + rand() * bw;
        const py = by + rand() * bh;
        cCtx.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.14)";
        cCtx.fillRect(px, py, 5, 4);
        bCtx.fillStyle = rand() > 0.5 ? "#ffffff" : "#777777";
        bCtx.fillRect(px, py, 5, 4);
      }

      if (opts.mossy && rand() > 0.52) {
        cCtx.fillStyle = "rgba(46, 107, 59, 0.36)";
        cCtx.fillRect(bx + rand() * (bw * 0.5), by + bh - 12, bw * 0.45, 10);
      }
    }
  }

  if (opts.cracked) {
    cCtx.strokeStyle = "#090a0f";
    cCtx.lineWidth = 5;
    bCtx.strokeStyle = "#000000";
    bCtx.lineWidth = 7;
    for (const ctx of [cCtx, bCtx]) {
      ctx.beginPath();
      ctx.moveTo(28, 22);
      ctx.lineTo(96, 88);
      ctx.lineTo(74, 148);
      ctx.lineTo(168, 205);
      ctx.lineTo(228, 240);
      ctx.moveTo(195, 35);
      ctx.lineTo(132, 118);
      ctx.lineTo(82, 195);
      ctx.stroke();
    }
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(opts.repeatX, opts.repeatY);

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(opts.repeatX, opts.repeatY);

  return new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: opts.bumpScale ?? 0.085,
    roughness: 0.82,
    metalness: 0.08,
  });
}

/**
 * Lazy-loaded off-map 4-Depth Descending Underground Dungeon (`z = 1200..1560`).
 * Built only when the player steps through the Haunted Castle Doorway, and
 * disposed when they exit back to the surface world.
 */
export function createBrickDungeon(scene: THREE.Scene): DungeonRig {
  const cx = BRICK_DUNGEON.centerX;
  const startZ = BRICK_DUNGEON.startZ;
  const endZ = BRICK_DUNGEON.endZ;
  const dz = startZ - 120;
  const hw = BRICK_DUNGEON.halfW;
  const bossHw = BRICK_DUNGEON.bossHalfW;

  const colliders = new Colliders();
  const g = new THREE.Group();

  const wallBrickMat = createBrickPBRMaterial({ repeatX: 28, repeatY: 3, mossy: true, bumpScale: 0.095 });
  const shortWallBrickMat = createBrickPBRMaterial({ repeatX: 4, repeatY: 3, mossy: true, bumpScale: 0.09 });
  const iceFloorMat = createBrickPBRMaterial({
    repeatX: 8,
    repeatY: 22,
    baseColor: "#253545",
    mossy: true,
    bumpScale: 0.065,
  });
  const fireFloorMat = createBrickPBRMaterial({
    repeatX: 8,
    repeatY: 22,
    baseColor: "#3d2220",
    bumpScale: 0.075,
  });
  const shadowFloorMat = createBrickPBRMaterial({
    repeatX: 8,
    repeatY: 18,
    baseColor: "#221b36",
    bumpScale: 0.07,
  });
  const bossFloorMat = createBrickPBRMaterial({
    repeatX: 10,
    repeatY: 16,
    baseColor: "#2c223b",
    bumpScale: 0.08,
  });
  const intactSlabMat = createBrickPBRMaterial({
    repeatX: 2,
    repeatY: 2,
    baseColor: "#434b5c",
    bumpScale: 0.06,
  });
  const crackedSlabMat = createBrickPBRMaterial({
    repeatX: 2,
    repeatY: 2,
    baseColor: "#38313a",
    cracked: true,
    bumpScale: 0.12,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: "#272b33",
    roughness: 0.38,
    metalness: 0.78,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: "#fbbf24",
    emissive: "#b45309",
    emissiveIntensity: 0.55,
    roughness: 0.28,
    metalness: 0.85,
  });
  const chestWoodMat = new THREE.MeshStandardMaterial({
    color: "#6d3b1e",
    roughness: 0.72,
    metalness: 0.1,
  });
  const iceCrystalMat = standard("#7dd3fc", {
    emissive: "#0284c7",
    emissiveIntensity: 0.75,
    roughness: 0.18,
  });
  const magmaMat = standard("#f97316", {
    emissive: "#ea580c",
    emissiveIntensity: 1.6,
    roughness: 0.35,
  });
  const shadowVoidMat = standard("#090514", {
    emissive: "#3b0764",
    emissiveIntensity: 0.45,
    roughness: 0.95,
  });
  const amethystMat = standard("#c084fc", {
    emissive: "#7e22ce",
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });

  const addUndergroundChamber = (opts: {
    z0: number;
    z1: number;
    y0: number;
    visHalfW: number;
    ceilH: number;
    floorMat: THREE.Material;
    sconceColor: string;
    hasFloor?: boolean;
    addPillars?: boolean;
    sideAlcoves?: boolean;
    colliderHalfW?: number;
  }) => {
    const {
      z0,
      z1,
      y0,
      visHalfW,
      ceilH,
      floorMat,
      sconceColor,
      hasFloor = true,
      addPillars = false,
      sideAlcoves = false,
      colliderHalfW = hw,
    } = opts;
    const segLen = z1 - z0;
    const segMidZ = (z0 + z1) / 2;

    if (hasFloor) {
      const fl = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(visHalfW, colliderHalfW) * 2 + 6, segLen + 1.5),
        floorMat,
      );
      fl.rotation.x = -Math.PI / 2;
      fl.position.set(cx, y0 + 0.028, segMidZ);
      fl.receiveShadow = true;
      g.add(fl);
    }

    const ceil = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(visHalfW, colliderHalfW) * 2 + 8, 1.4, segLen + 1.8),
      wallBrickMat,
    );
    ceil.position.set(cx, y0 + ceilH + 0.6, segMidZ);
    g.add(ceil);

    for (const side of [-1, 1]) {
      const physWallX = cx + side * (colliderHalfW + 0.9);
      colliders.boxes.push({ x: physWallX, z: segMidZ, hw: 0.9, hd: segLen / 2 });

      const visWallX = cx + side * (visHalfW + 0.9);
      const outerWall = new THREE.Mesh(new THREE.BoxGeometry(1.8, ceilH + 1.2, segLen + 1.5), wallBrickMat);
      outerWall.position.set(visWallX, y0 + ceilH / 2, segMidZ);
      outerWall.receiveShadow = true;
      g.add(outerWall);
    }

    for (const az of [z0, z1]) {
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(visHalfW * 2 + 2, 1.6, 1.4), shortWallBrickMat);
      lintel.position.set(cx, y0 + ceilH - 0.4, az);
      g.add(lintel);
      for (const side of [-1, 1]) {
        const buttress = new THREE.Mesh(new THREE.BoxGeometry(2.6, ceilH, 1.5), shortWallBrickMat);
        buttress.position.set(cx + side * (visHalfW - 1.1), y0 + ceilH / 2, az);
        g.add(buttress);
      }
    }

    if (sideAlcoves) {
      for (const side of [-1, 1]) {
        const alcoveX = cx + side * (visHalfW + 4.2);
        const alcoveFloor = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.35, segLen * 0.55), intactSlabMat);
        alcoveFloor.position.set(alcoveX, y0 + 0.18, segMidZ);
        const alcoveBack = new THREE.Mesh(new THREE.BoxGeometry(1.4, ceilH, segLen * 0.58), shortWallBrickMat);
        alcoveBack.position.set(alcoveX + side * 3.6, y0 + ceilH / 2, segMidZ);
        const sarcophagus = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 3.8), intactSlabMat);
        sarcophagus.position.set(alcoveX, y0 + 0.72, segMidZ);
        const crystal = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.55, 0),
          standard(sconceColor, { emissive: sconceColor, emissiveIntensity: 1.8 }),
        );
        crystal.position.set(alcoveX, y0 + 2.1, segMidZ);
        g.add(alcoveFloor, alcoveBack, sarcophagus, crystal);
      }
    }

    for (let z = z0 + 6; z <= z1 - 4; z += 10) {
      const overheadRib = new THREE.Mesh(new THREE.BoxGeometry(visHalfW * 2, 0.75, 0.95), shortWallBrickMat);
      overheadRib.position.set(cx, y0 + ceilH - 0.2, z);
      g.add(overheadRib);

      for (const side of [-1, 1]) {
        const pilaster = new THREE.Mesh(new THREE.BoxGeometry(1.1, ceilH, 0.95), shortWallBrickMat);
        pilaster.position.set(cx + side * (visHalfW - 0.55), y0 + ceilH / 2, z);
        g.add(pilaster);

        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.25), ironMat);
        bracket.position.set(cx + side * (visHalfW - 0.15), y0 + 3.6, z);
        const flameOrb = new THREE.Mesh(
          new THREE.ConeGeometry(0.22, 0.48, 6),
          standard(sconceColor, { emissive: sconceColor, emissiveIntensity: 2.1 }),
        );
        flameOrb.position.set(cx + side * (visHalfW - 0.25), y0 + 3.95, z);
        g.add(bracket, flameOrb);

        if (addPillars) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.05, ceilH, 10), shortWallBrickMat);
          col.position.set(cx + side * 9.6, y0 + ceilH / 2, z);
          g.add(col);
        }
      }
    }
  };

  const addDescendingStairwell = (z0: number, z1: number, y0: number, y1: number, sconceColor: string) => {
    const steps = 18;
    const stepD = (z1 - z0) / steps;
    const stepH = (y1 - y0) / steps;
    for (let i = 0; i < steps; i++) {
      const sz = z0 + (i + 0.5) * stepD;
      const sy = y0 + (i + 0.5) * stepH;
      const stepMesh = new THREE.Mesh(
        new THREE.BoxGeometry(hw * 2 - 2, Math.abs(stepH) + 0.45, stepD + 0.18),
        intactSlabMat,
      );
      stepMesh.position.set(cx, sy - 0.2, sz);
      stepMesh.receiveShadow = true;
      g.add(stepMesh);
    }
    const midY = (y0 + y1) / 2;
    const midZ = (z0 + z1) / 2;
    for (const side of [-1, 1]) {
      const wallX = cx + side * (hw + 0.9);
      const stairWall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 15.0, z1 - z0 + 2.5), wallBrickMat);
      stairWall.position.set(wallX, midY + 4.0, midZ);
      g.add(stairWall);
      colliders.boxes.push({ x: wallX, z: midZ, hw: 0.9, hd: (z1 - z0) / 2 });

      const torchOrb = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 0.52, 6),
        standard(sconceColor, { emissive: sconceColor, emissiveIntensity: 2.2 }),
      );
      torchOrb.position.set(cx + side * (hw - 0.4), midY + 3.4, midZ);
      g.add(torchOrb);
    }
    const stairCeil = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 3.2, 1.4, z1 - z0 + 3.0), wallBrickMat);
    stairCeil.position.set(cx, Math.max(y0, y1) + 6.8, midZ);
    g.add(stairCeil);
  };

  // DEPTH 1 (y = 0m — Frost-Fang Crypts & Aqueduct Rotunda)
  addUndergroundChamber({ z0: 120 + dz, z1: 132 + dz, y0: 0, visHalfW: 15.5, ceilH: 5.2, floorMat: iceFloorMat, sconceColor: "#38bdf8" });
  addUndergroundChamber({ z0: 132 + dz, z1: 172 + dz, y0: 0, visHalfW: 21.5, ceilH: 9.8, floorMat: iceFloorMat, sconceColor: "#38bdf8", addPillars: true });
  addUndergroundChamber({ z0: 172 + dz, z1: 189 + dz, y0: 0, visHalfW: 16.5, ceilH: 5.4, floorMat: iceFloorMat, sconceColor: "#38bdf8" });
  addUndergroundChamber({ z0: 189 + dz, z1: 210 + dz, y0: 0, visHalfW: 19.5, ceilH: 8.6, floorMat: iceFloorMat, sconceColor: "#38bdf8", sideAlcoves: true });

  // Glowing Exit Portal Arch at startZ so players can walk right back out to the Haunted Castle Gatehouse
  const exitPortalRing = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 2.55, 32),
    new THREE.MeshBasicMaterial({ color: "#a855f7", side: THREE.DoubleSide, transparent: true, opacity: 0.72 }),
  );
  exitPortalRing.position.set(cx, 2.6, startZ + 0.15);
  g.add(exitPortalRing);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(6.4, 7.2, 2.4), shortWallBrickMat);
    pillar.position.set(cx + side * 12.2, 3.6, startZ);
    g.add(pillar);
    colliders.boxes.push({ x: cx + side * 12.2, z: startZ, hw: 3.2, hd: 1.2 });
  }

  const canalWater = new THREE.Mesh(
    new THREE.BoxGeometry(20.8, 0.18, 40),
    standard("#0284c7", { emissive: "#0369a1", emissiveIntensity: 0.65, roughness: 0.2 }),
  );
  canalWater.position.set(cx, 0.08, 152 + dz);
  g.add(canalWater);

  for (let sz = 134 + dz; sz <= 170 + dz; sz += 4) {
    const iceStone = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.32, 8), iceCrystalMat);
    iceStone.position.set(cx, 0.16, sz);
    g.add(iceStone);
  }

  for (const side of [-1, 1]) {
    const walkway = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.55, 42), intactSlabMat);
    walkway.position.set(cx + side * 14.6, 0.28, 152 + dz);
    walkway.receiveShadow = true;
    g.add(walkway);
  }

  BRICK_DUNGEON.grateZs.forEach((wz, gi) => {
    const dripX = cx + (gi % 2 === 1 ? 1 : -1) * BRICK_DUNGEON.grateDripX;
    const waterfallCurtain = new THREE.Mesh(
      new THREE.BoxGeometry(BRICK_DUNGEON.grateDripHalfW * 2, 8.8, 0.55),
      new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.42 }),
    );
    waterfallCurtain.position.set(dripX, 4.4, wz);
    g.add(waterfallCurtain);

    for (let ix = -8; ix <= 8; ix += 4) {
      const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.26, 1.5, 6), iceCrystalMat);
      icicle.rotation.x = Math.PI;
      icicle.position.set(cx + ix, 8.8, wz);
      g.add(icicle);
    }
  });

  const slabPairs: Array<{ left: THREE.Mesh; right: THREE.Mesh; rowIdx: number }> = [];
  const slabGeo = new THREE.BoxGeometry(BRICK_DUNGEON.slabHalfW * 2, 0.16, BRICK_DUNGEON.slabHalfD * 2);
  BRICK_DUNGEON.slabRowZs.forEach((rz, rIdx) => {
    const leftSlab = new THREE.Mesh(slabGeo, crackedSlabMat);
    leftSlab.position.set(cx - BRICK_DUNGEON.slabCenterX, 0.08, rz);
    const rightSlab = new THREE.Mesh(slabGeo, intactSlabMat);
    rightSlab.position.set(cx + BRICK_DUNGEON.slabCenterX, 0.08, rz);
    g.add(leftSlab, rightSlab);
    slabPairs.push({ left: leftSlab, right: rightSlab, rowIdx: rIdx });
  });

  const arrowVolleyGroup = new THREE.Group();
  for (const ax of [-3.6, -1.8, 0, 1.8, 3.6]) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), iceCrystalMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(ax, 1.3, 0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 6), iceCrystalMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(ax, 1.3, -0.78);
    arrowVolleyGroup.add(shaft, tip);
  }
  arrowVolleyGroup.position.set(cx, 0, BRICK_DUNGEON.hall1EndZ);
  g.add(arrowVolleyGroup);

  const leverBaseGeo = new THREE.BoxGeometry(0.5, 0.5, 0.4);
  const leverRodGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8);
  const leverWestBase = new THREE.Mesh(leverBaseGeo, ironMat);
  leverWestBase.position.set(cx - 5.2, 0.25, BRICK_DUNGEON.junctionZ);
  const leverWestRod = new THREE.Mesh(leverRodGeo, iceCrystalMat);
  leverWestRod.position.set(cx - 5.2, 0.8, BRICK_DUNGEON.junctionZ);

  const leverEastBase = new THREE.Mesh(leverBaseGeo, ironMat);
  leverEastBase.position.set(cx + 5.2, 0.25, BRICK_DUNGEON.junctionZ);
  const leverEastRod = new THREE.Mesh(
    leverRodGeo,
    standard("#f59e0b", { emissive: "#d97706", emissiveIntensity: 1.1 }),
  );
  leverEastRod.position.set(cx + 5.2, 0.8, BRICK_DUNGEON.junctionZ);
  g.add(leverWestBase, leverWestRod, leverEastBase, leverEastRod);

  const partitionW = BRICK_DUNGEON.partitionOuterX - BRICK_DUNGEON.partitionInnerX;
  const partitionCenterOffset = BRICK_DUNGEON.partitionInnerX + partitionW / 2;
  const shiftingBrickWall = new THREE.Mesh(
    new THREE.BoxGeometry(partitionW, 6.2, BRICK_DUNGEON.partitionHalfD * 2),
    shortWallBrickMat,
  );
  shiftingBrickWall.position.set(cx + partitionCenterOffset, 3.1, BRICK_DUNGEON.partitionZ);
  g.add(shiftingBrickWall);

  const chestEntries: Array<{
    lidGroup: THREE.Group;
    teethGroup: THREE.Group;
    tongueMesh: THREE.Mesh;
  }> = [];
  const chestXPositions = BRICK_DUNGEON.chestXs.map((x) => cx + x);

  chestXPositions.forEach((chX) => {
    const chestGroup = new THREE.Group();
    chestGroup.position.set(chX, 0, BRICK_DUNGEON.chestZ);

    const dais = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.28, 2.2), intactSlabMat);
    dais.position.y = 0.14;
    chestGroup.add(dais);

    const baseBox = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.78, 1.2), chestWoodMat);
    baseBox.position.y = 0.66;
    const goldBand = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.8, 0.24), goldMat);
    goldBand.position.y = 0.66;
    chestGroup.add(baseBox, goldBand);

    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, 1.04, -0.58);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.46, 1.2), chestWoodMat);
    lidMesh.position.set(0, 0.23, 0.58);
    const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.14), goldMat);
    lockPlate.position.set(0, 0.1, 1.18);
    lidGroup.add(lidMesh, lockPlate);
    chestGroup.add(lidGroup);

    const teethGroup = new THREE.Group();
    teethGroup.position.set(0, 1.0, 0);
    const fangMat = standard("#f8fafc");
    for (const fx of [-0.6, -0.3, 0, 0.3, 0.6]) {
      const topFang = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 5), fangMat);
      topFang.rotation.x = Math.PI;
      topFang.position.set(fx, 0.18, 0.48);
      const botFang = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 5), fangMat);
      botFang.position.set(fx, -0.05, 0.48);
      teethGroup.add(topFang, botFang);
    }
    const tongueMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.12, 1.0),
      standard("#e11d48", { emissive: "#be123c", emissiveIntensity: 0.7 }),
    );
    tongueMesh.position.set(0, 0.05, 0.48);
    teethGroup.add(tongueMesh);
    teethGroup.visible = false;
    chestGroup.add(teethGroup);

    g.add(chestGroup);
    chestEntries.push({ lidGroup, teethGroup, tongueMesh });
  });

  const secretBookcaseWall = new THREE.Group();
  secretBookcaseWall.position.set(cx, 0, BRICK_DUNGEON.secretWallZ);
  const bookcaseBacking = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 6.2, 1.2), shortWallBrickMat);
  bookcaseBacking.position.y = 3.1;
  secretBookcaseWall.add(bookcaseBacking);
  const shelfColors = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea"];
  for (const sy of [1.3, 2.6, 3.9]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.18, 1.35), chestWoodMat);
    shelf.position.y = sy;
    secretBookcaseWall.add(shelf);
    for (let b = -4; b <= 4; b++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.82, 1.3),
        standard(shelfColors[Math.abs(b + Math.round(sy)) % shelfColors.length]!),
      );
      book.position.set(b * 1.05, sy + 0.48, 0);
      secretBookcaseWall.add(book);
    }
  }
  g.add(secretBookcaseWall);

  addDescendingStairwell(
    BRICK_DUNGEON.stairs1StartZ,
    BRICK_DUNGEON.stairs1EndZ,
    0,
    BRICK_DUNGEON.floor2Y,
    "#38bdf8",
  );

  // DEPTH 2 (y = -6.0m — Cinder-Web Catacombs & Molten Forge)
  const y2 = BRICK_DUNGEON.floor2Y;
  addUndergroundChamber({ z0: 226 + dz, z1: 258 + dz, y0: y2, visHalfW: 17.5, ceilH: 5.5, floorMat: fireFloorMat, sconceColor: "#f97316" });
  addUndergroundChamber({ z0: 258 + dz, z1: 296 + dz, y0: y2, visHalfW: 22.5, ceilH: 10.5, floorMat: fireFloorMat, sconceColor: "#f97316", addPillars: true, sideAlcoves: true });
  addUndergroundChamber({ z0: 296 + dz, z1: 316 + dz, y0: y2, visHalfW: 16.0, ceilH: 5.6, floorMat: fireFloorMat, sconceColor: "#f97316" });

  for (const side of [-1, 1]) {
    const lavaStrip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 84), magmaMat);
    lavaStrip.position.set(cx + side * 8.6, y2 + 0.08, 271 + dz);
    g.add(lavaStrip);

    const sideGallery = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.4, 84), intactSlabMat);
    sideGallery.position.set(cx + side * 14.5, y2 + 0.2, 271 + dz);
    g.add(sideGallery);
  }

  const webZPositions = [BRICK_DUNGEON.web1Z, BRICK_DUNGEON.web2Z, BRICK_DUNGEON.web3Z];
  const webMeshes: THREE.Group[] = [];
  const webMat = new THREE.MeshBasicMaterial({
    color: "#e2e8f0",
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
  });
  webZPositions.forEach((wz) => {
    const webGroup = new THREE.Group();
    webGroup.position.set(cx, y2, wz);
    const mainSheet = new THREE.Mesh(new THREE.PlaneGeometry(BRICK_DUNGEON.webHalfW * 2, 5.4), webMat);
    mainSheet.position.y = 2.7;
    webGroup.add(mainSheet);
    for (let a = 0; a < 6; a++) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(BRICK_DUNGEON.webHalfW * 2 + 0.6, 0.08, 0.08), webMat);
      strand.position.y = 2.8;
      strand.rotation.z = (a / 6) * Math.PI;
      webGroup.add(strand);
    }
    g.add(webGroup);
    webMeshes.push(webGroup);
  });

  const pendulumZPositions = [BRICK_DUNGEON.pendulum1Z, BRICK_DUNGEON.pendulum2Z, BRICK_DUNGEON.pendulum3Z];
  const pendulumPivots: THREE.Group[] = [];
  pendulumZPositions.forEach((pz) => {
    const pivot = new THREE.Group();
    pivot.position.set(cx, y2 + 6.2, pz);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4.8, 8), ironMat);
    rod.position.y = -2.4;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.3, 0.22), magmaMat);
    blade.position.y = -4.6;
    pivot.add(rod, blade);
    g.add(pivot);
    pendulumPivots.push(pivot);
  });

  const fireBoulderMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(BRICK_DUNGEON.boulderRadius, 1), magmaMat);
  fireBoulderMesh.position.set(cx, y2 + BRICK_DUNGEON.boulderRadius, BRICK_DUNGEON.boulderEndZ);
  g.add(fireBoulderMesh);

  addDescendingStairwell(
    BRICK_DUNGEON.stairs2StartZ,
    BRICK_DUNGEON.stairs2EndZ,
    BRICK_DUNGEON.floor2Y,
    BRICK_DUNGEON.floor3Y,
    "#f97316",
  );

  // DEPTH 3 (y = -12.0m — Abyssal Shadow Chasm & Twin Iron Gaol)
  const y3 = BRICK_DUNGEON.floor3Y;
  addUndergroundChamber({ z0: 332 + dz, z1: 340 + dz, y0: y3, visHalfW: 19.5, ceilH: 8.5, floorMat: shadowFloorMat, sconceColor: "#a855f7", hasFloor: true });
  addUndergroundChamber({ z0: 340 + dz, z1: 368 + dz, y0: y3, visHalfW: 22.0, ceilH: 11.2, floorMat: shadowFloorMat, sconceColor: "#a855f7", hasFloor: false });
  addUndergroundChamber({ z0: 368 + dz, z1: 404 + dz, y0: y3, visHalfW: 17.5, ceilH: 5.6, floorMat: shadowFloorMat, sconceColor: "#a855f7", hasFloor: true, sideAlcoves: true });

  const chasmVoid = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 8, 28), shadowVoidMat);
  chasmVoid.rotation.x = -Math.PI / 2;
  chasmVoid.position.set(cx, y3 - 4.2, 354 + dz);
  g.add(chasmVoid);

  for (const [sx, sz, sh] of [
    [-7.2, 346 + dz, 5.2],
    [7.4, 351 + dz, 6.0],
    [-6.8, 361 + dz, 5.6],
    [6.9, 364 + dz, 4.8],
  ] as const) {
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1, sh, 6), amethystMat);
    spire.position.set(cx + sx, y3 - 4.2 + sh / 2, sz);
    g.add(spire);
  }

  const centralBridge = new THREE.Mesh(new THREE.BoxGeometry(BRICK_DUNGEON.chasmBridgeHalfW * 2, 0.45, 29), intactSlabMat);
  centralBridge.position.set(cx, y3 + 0.15, 354 + dz);
  centralBridge.receiveShadow = true;
  g.add(centralBridge);

  for (const side of [-1, 1]) {
    const outerCatwalk = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.45, 29), intactSlabMat);
    outerCatwalk.position.set(cx + side * 14.6, y3 + 0.15, 354 + dz);
    outerCatwalk.receiveShadow = true;
    g.add(outerCatwalk);
  }

  for (let z = BRICK_DUNGEON.ironBarsStartZ; z <= BRICK_DUNGEON.ironBarsEndZ; z += 1.4) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.6, 8), ironMat);
    bar.position.set(cx, y3 + 2.8, z);
    g.add(bar);
  }
  colliders.boxes.push({
    x: cx,
    z: (BRICK_DUNGEON.ironBarsStartZ + BRICK_DUNGEON.ironBarsEndZ) / 2,
    hw: BRICK_DUNGEON.ironBarsHalfW,
    hd: (BRICK_DUNGEON.ironBarsEndZ - BRICK_DUNGEON.ironBarsStartZ) / 2,
  });

  const switchMat = standard("#a855f7", { emissive: "#9333ea", emissiveIntensity: 1.2 });
  const looseBrickWest = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.95), switchMat);
  looseBrickWest.position.set(cx - 17.0, y3 + 1.6, BRICK_DUNGEON.switchZ);
  const looseBrickEast = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.95), switchMat);
  looseBrickEast.position.set(cx + 17.0, y3 + 1.6, BRICK_DUNGEON.switchZ);
  g.add(looseBrickWest, looseBrickEast);

  const gateW = hw - BRICK_DUNGEON.gateInnerX;
  const gateCenterOffset = BRICK_DUNGEON.gateInnerX + gateW / 2;
  const buildPortcullis = (gateCenterX: number) => {
    const gateGroup = new THREE.Group();
    gateGroup.position.set(gateCenterX, y3, BRICK_DUNGEON.gateZ);
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(gateW, 0.38, 0.38), ironMat);
    topBeam.position.y = 5.4;
    const midBeam = new THREE.Mesh(new THREE.BoxGeometry(gateW, 0.3, 0.38), ironMat);
    midBeam.position.y = 2.7;
    gateGroup.add(topBeam, midBeam);
    for (let bx = -gateW / 2 + 0.5; bx <= gateW / 2 - 0.5; bx += 1.15) {
      const vBar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.5, 8), ironMat);
      vBar.position.set(bx, 2.75, 0);
      gateGroup.add(vBar);
    }
    g.add(gateGroup);
    return gateGroup;
  };
  const leftPortcullis = buildPortcullis(cx - gateCenterOffset);
  const rightPortcullis = buildPortcullis(cx + gateCenterOffset);

  addDescendingStairwell(
    BRICK_DUNGEON.stairs3StartZ,
    BRICK_DUNGEON.stairs3EndZ,
    BRICK_DUNGEON.floor3Y,
    BRICK_DUNGEON.floor4Y,
    "#a855f7",
  );

  // DEPTH 4 (y = -18.0m — Subterranean Cathedral of the 3-Faced Dire Wolf)
  const y4 = BRICK_DUNGEON.floor4Y;
  addUndergroundChamber({ z0: 420 + dz, z1: 432 + dz, y0: y4, visHalfW: 15.0, ceilH: 5.6, floorMat: bossFloorMat, sconceColor: "#fbbf24", colliderHalfW: bossHw });
  addUndergroundChamber({ z0: 432 + dz, z1: 480 + dz, y0: y4, visHalfW: bossHw, ceilH: 11.6, floorMat: bossFloorMat, sconceColor: "#fbbf24", addPillars: true, sideAlcoves: true, colliderHalfW: bossHw });

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(bossHw * 2 + 3.2, 11.8, 1.8), shortWallBrickMat);
  backWall.position.set(cx, y4 + 5.9, endZ + 0.9);
  g.add(backWall);
  colliders.boxes.push({ x: cx, z: endZ + 0.9, hw: bossHw + 1.6, hd: 0.95 });

  const runeSpecs: Array<[number, string]> = [
    [-9.5, "#38bdf8"],
    [0, "#f97316"],
    [9.5, "#a855f7"],
  ];
  for (const [rx, rCol] of runeSpecs) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.9, 32),
      new THREE.MeshBasicMaterial({ color: rCol, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx + rx, y4 + 0.05, BRICK_DUNGEON.bossHomeZ);
    g.add(ring);
  }

  const vaultDais = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.55, 6.5), intactSlabMat);
  vaultDais.position.set(cx, y4 + 0.28, BRICK_DUNGEON.vaultChestZ);
  g.add(vaultDais);

  const royalVaultChest = new THREE.Group();
  royalVaultChest.position.set(cx, y4 + 0.55, BRICK_DUNGEON.vaultChestZ);
  const vBox = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.45, 2.0), goldMat);
  vBox.position.y = 0.72;
  const vGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.6, 0),
    standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 2.2 }),
  );
  vGem.position.set(0, 1.95, 0);
  royalVaultChest.add(vBox, vGem);
  g.add(royalVaultChest);

  const escapeArch = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.28, 10, 24),
    standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 1.5 }),
  );
  escapeArch.position.set(cx, y4 + 2.4, BRICK_DUNGEON.escapeSlideZ);
  g.add(escapeArch);

  scene.add(g);

  return {
    group: g,
    colliders,
    update(view: DungeonView) {
      const {
        dungeonWing,
        dungeonSeed,
        grimoireFound,
        gateLeftOpen,
        gateRightOpen,
        vaultUnlocked,
        arrowVolleyZ,
        chompingChests,
        websBurned,
        fireBoulderZ,
        nowMs,
      } = view;
      const tSec = nowMs / 1000;

      exitPortalRing.rotation.z = tSec * 0.9;

      for (const pair of slabPairs) {
        const crackedOnLeft = (pair.rowIdx + dungeonSeed) % 2 === 0;
        pair.left.material = crackedOnLeft ? crackedSlabMat : intactSlabMat;
        pair.right.material = crackedOnLeft ? intactSlabMat : crackedSlabMat;
      }

      if (Number.isFinite(arrowVolleyZ)) {
        arrowVolleyGroup.position.z = arrowVolleyZ;
      }

      const targetWallX = dungeonWing === 1 ? cx + partitionCenterOffset : cx - partitionCenterOffset;
      shiftingBrickWall.position.x += (targetWallX - shiftingBrickWall.position.x) * 0.14;
      leverWestRod.rotation.x = dungeonWing === 1 ? -0.45 : 0.45;
      leverEastRod.rotation.x = dungeonWing === 2 ? -0.45 : 0.45;

      const realChestIdx = dungeonSeed % 3;
      chestEntries.forEach((entry, idx) => {
        const isReal = idx === realChestIdx;
        if (isReal && grimoireFound === 1) {
          entry.lidGroup.rotation.x += (-1.15 - entry.lidGroup.rotation.x) * 0.15;
          entry.teethGroup.visible = false;
        } else if (!isReal && (chompingChests & (1 << idx)) !== 0) {
          entry.lidGroup.rotation.x = -0.85 + Math.sin(tSec * 16) * 0.32;
          entry.teethGroup.visible = true;
          entry.tongueMesh.rotation.y = Math.sin(tSec * 14) * 0.35;
        } else {
          entry.lidGroup.rotation.x += (0 - entry.lidGroup.rotation.x) * 0.15;
          entry.teethGroup.visible = false;
        }
      });

      const bookcaseTargetX = grimoireFound === 1 ? cx + 16.5 : cx;
      secretBookcaseWall.position.x += (bookcaseTargetX - secretBookcaseWall.position.x) * 0.1;

      webMeshes.forEach((wm, idx) => {
        const bit = 1 << idx;
        wm.visible = (websBurned & bit) === 0;
      });
      pendulumPivots.forEach((piv, idx) => {
        const dir = idx % 2 === 0 ? 1 : -1;
        piv.rotation.z = Math.sin(tSec * 2.4 + idx) * 0.65 * dir;
      });
      if (Number.isFinite(fireBoulderZ)) {
        fireBoulderMesh.position.z = fireBoulderZ;
        fireBoulderMesh.rotation.x -= 0.14;
      }

      const leftGateY = y3 + (gateLeftOpen === 1 ? 5.2 : 0);
      const rightGateY = y3 + (gateRightOpen === 1 ? 5.2 : 0);
      leftPortcullis.position.y += (leftGateY - leftPortcullis.position.y) * 0.14;
      rightPortcullis.position.y += (rightGateY - rightPortcullis.position.y) * 0.14;

      vGem.rotation.y = tSec * 1.8;
      vGem.position.y = 1.95 + (vaultUnlocked === 1 ? 0.55 : 0) + Math.sin(tSec * 3) * 0.14;
      escapeArch.rotation.z = tSec * 1.2;
    },
    dispose() {
      scene.remove(g);
      const disposedMats = new Set<THREE.Material>();
      const disposedGeos = new Set<THREE.BufferGeometry>();
      g.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry && !disposedGeos.has(obj.geometry)) {
            disposedGeos.add(obj.geometry);
            obj.geometry.dispose();
          }
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) {
            if (m && !disposedMats.has(m)) {
              disposedMats.add(m);
              if (m instanceof THREE.MeshStandardMaterial) {
                m.map?.dispose();
                m.bumpMap?.dispose();
              }
              m.dispose();
            }
          }
        }
      });
    },
  };
}
