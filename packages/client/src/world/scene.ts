import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  ARCADE_HALL,
  BRICK_DUNGEON,
  CAMPFIRE_BASE,
  CINEMA_HALL,
  CINEMA_SEATS,
  FOOTBALL_STADIUM,
  GRAFFITI_MURAL,
  HAUNTED_GATE,
  OPEN_MIC_STAGE,
  SOCIAL_ZONE,
  WORLD,
  getDungeonFloorY,
  getIndianHourFloat,
  isInBrickDungeon,
} from "@vi/shared";
import { Colliders } from "./collision";
import { addArcadeHall } from "./arcadeHall";
import type { PokerTableView } from "./pokerTable";
import { createBrickDungeon, type DungeonRig, type DungeonView } from "./dungeon";

export type { DungeonView };
export type TimeMode = "ist" | "day" | "sunset" | "night";

export interface AnimalRenderState {
  id: string;
  species: string;
  x: number;
  z: number;
  rot: number;
  hp: number;
  maxHp: number;
}

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  colliders: Colliders;
  dungeonColliders: Colliders;
  screenMesh: THREE.Mesh;
  screenLight: THREE.PointLight;
  muralCanvas: HTMLCanvasElement;
  muralTexture: THREE.CanvasTexture;
  timeMode: TimeMode;
  isNight: boolean;
  pokerTable: PokerTableView;
  setScreenTexture(tex: THREE.Texture, accentColor?: string): void;
  setFootballState(ballX: number, ballZ: number, scoreRed: number, scoreBlue: number): void;
  setDungeonState(view: DungeonView): void;
  ensureDungeonLoaded(): void;
  syncAnimals(animals: AnimalRenderState[]): void;
  paintMuralData(pixels: number[]): void;
  paintMuralPixel(x: number, y: number, colorIdx: number): void;
  updateAtmosphere(nowMs: number): void;
  resize(): void;
  render(): void;
}

const PALETTE = {
  skyDay: "#bfd9f2",
  skySunset: "#d97b66",
  skyNight: "#090d1c",
  grass: "#6fa86a",
  forestGrass: "#355e37",
  hillGrass: "#3f6d3e",
  mountainRock: "#4b5563",
  caveStone: "#27272a",
  ruinStone: "#94a3b8",
  stone: "#cfc8bb",
  road: "#484d59",
  path: "#bdb5a6",
  water: "#3b8ec2",
  trunk: "#7a4e33",
  birchTrunk: "#e2e8f0",
  leaves: ["#3f8f4f", "#4ea35a", "#5fb86a", "#2e6b3b", "#84a93c", "#22543d"],
  buildings: ["#e9c4a8", "#c8d8e8", "#f1e0a6", "#d9c3e6", "#bfe0c9", "#f3c6c6", "#dcd3c2"],
  roof: "#6b5b53",
  lamp: "#3b3f46",
  bench: "#9a7351",
} as const;

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

/**
 * Upgraded Three.js PBR Procedural Stone-Brick & Flagstone Texture Generator:
 * Generates both a high-detail Albedo Map and a 3D Height/Bump Map so every
 * stone brick, mortar groove, and floor crack catches dynamic Torch PointLights!
 */
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

  // Deep recessed mortar grooves
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

      // Beveled stone highlight & shadow for 3D relief
      bCtx.fillStyle = "#d8d8d8";
      bCtx.fillRect(bx, by, bw, bh);
      bCtx.fillStyle = "#f4f4f4";
      bCtx.fillRect(bx + 4, by + 4, bw - 8, bh - 8);

      // Surface grain & weathered pitting
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

  // If this is a Cracked Booby-Trap Floor Brick, draw jagged dark fracture lines across the slab!
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
 * Creates a physical 3D wooden notice board in the world (matching the exact
 * style of the Idea Wall) with a CanvasTexture painted on its face—no floating
 * HTML tags cluttering the screen!
 */
function createNoticeBoard(
  scene: THREE.Scene,
  colliders: Colliders,
  opts: {
    x: number;
    z: number;
    yaw?: number;
    title: string;
    lines: string[];
    scale?: number;
  },
): (newTitle: string, newLines: string[]) => void {
  const scale = opts.scale ?? 0.68;
  const group = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const wood = new THREE.MeshStandardMaterial({ color: "#7a5a3e", roughness: 0.9, flatShading: true });

  for (const px of [-2.7, 2.7]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.22), wood);
    post.position.set(px, 1.8, 0);
    post.castShadow = true;
    group.add(post);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.2, 0.18), wood);
  frame.position.set(0, 2.1, 0);
  frame.castShadow = true;
  group.add(frame);

  const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: texture }));
  board.position.set(0, 2.1, 0.1);
  group.add(board);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.14, 1.2), wood);
  roof.position.set(0, 3.8, 0.2);
  roof.castShadow = true;
  group.add(roof);

  group.scale.setScalar(scale);
  group.position.set(opts.x, 0, opts.z);
  group.rotation.y = opts.yaw ?? 0;
  scene.add(group);
  colliders.circles.push({ x: opts.x, z: opts.z, r: 1.8 * scale });

  const draw = (title: string, lines: string[]) => {
    const c = canvas.getContext("2d")!;
    const w = canvas.width;
    const h = canvas.height;

    c.fillStyle = "#d9b98a";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0.05)";
    for (let i = 0; i < 250; i++) {
      c.fillRect((i * 97) % w, (i * 57) % h, 3, 3);
    }

    c.fillStyle = "#2b2118";
    c.font = "bold 46px system-ui, sans-serif";
    c.textBaseline = "top";
    c.fillText(title, 36, 28);

    c.fillStyle = "rgba(43,33,24,0.18)";
    c.fillRect(36, 92, w - 72, 3);

    lines.forEach((line, idx) => {
      const y = 114 + idx * 58;
      c.fillStyle = "#fff3a8";
      c.fillRect(36, y, w - 72, 46);
      c.fillStyle = "#2b2118";
      c.font = "600 25px system-ui, sans-serif";
      c.fillText(line, 52, y + 10);
    });

    texture.needsUpdate = true;
  };

  draw(opts.title, opts.lines);
  return draw;
}

interface AnimalMeshEntry {
  group: THREE.Group;
  species: string;
  segments?: THREE.Mesh[];
  targetX: number;
  targetZ: number;
  targetRot: number;
}

export function createWorld(container: HTMLElement, labelContainer: HTMLElement): World {
  const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
  const renderer = new THREE.WebGLRenderer({
    antialias: !isTouchDevice,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.0 : 1.75));
  renderer.shadowMap.enabled = !isTouchDevice;
  renderer.shadowMap.type = isTouchDevice ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelContainer });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyDay);
  scene.fog = new THREE.Fog(PALETTE.skyDay, isTouchDevice ? 55 : 75, isTouchDevice ? 175 : 235);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, isTouchDevice ? 220 : 480);
  camera.position.set(0, 6, 12);

  const colliders = new Colliders();
  const dungeonColliders = new Colliders(false);
  const lampHeads: THREE.Mesh[] = [];
  const streetLights: THREE.PointLight[] = [];
  const windowMaterials: THREE.MeshStandardMaterial[] = [];

  const { hemi, sun, moonGroup, stars } = addAtmosphereAndLights(scene);
  const { ground, forestGround } = addGroundAndRingRoad(scene);
  addPlaza(scene, colliders, lampHeads, streetLights);
  addOpenSocialZoneRing(scene);
  addAvenues(scene, colliders, lampHeads, streetLights);

  // North District: Cinema Hall, Open-Mic Stage, and Shared Pixel Graffiti Mural
  const { screenMesh, screenLight } = addCinemaHall(scene, colliders);
  addOpenMicStage(scene, colliders);
  const { muralCanvas, muralTexture, drawPixel, drawAllPixels } = addGraffitiMuralWall(scene, colliders);

  // West District: Team Football (Soccer) Stadium
  const { ballMesh, updateFootballBoard } = addFootballStadium(scene, colliders);

  // East District: the Royal Arcade Hall (poker table + classic cabinets)
  const { pokerTable } = addArcadeHall(scene, colliders);

  // South District: Foothill Ridge, Deep Campfire Valley, Haunted Castle Gatehouse (dungeon lazy-loads on entry!)
  const { campfireLight, flameGroup, fireflies, dragonflies } = addCampfireAndForestWilderness(scene, colliders);
  const hauntedCastle = addHauntedCastleGatehouse(scene, colliders);

  let dungeonRig: DungeonRig | null = null;
  let lastDungeonView: DungeonView | null = null;

  const ensureDungeonLoaded = () => {
    if (dungeonRig) return;
    dungeonRig = createBrickDungeon(scene);
    dungeonColliders.boxes.push(...dungeonRig.colliders.boxes);
    dungeonColliders.circles.push(...dungeonRig.colliders.circles);
    if (lastDungeonView) dungeonRig.update(lastDungeonView);
  };

  const unloadDungeon = () => {
    if (!dungeonRig) return;
    dungeonRig.dispose();
    dungeonRig = null;
    dungeonColliders.boxes.length = 0;
    dungeonColliders.circles.length = 0;
    dungeonColliders.dynamic = [];
  };

  addBuildings(scene, colliders, windowMaterials);
  addCityAndForestTrees(scene, colliders);

  const animalEntries = new Map<string, AnimalMeshEntry>();
  let lastScoreRed = -1;
  let lastScoreBlue = -1;
  let lastAtmoMs = -1000;
  const skyDayColor = new THREE.Color(PALETTE.skyDay);
  const skySunsetColor = new THREE.Color(PALETTE.skySunset);
  const skyNightColor = new THREE.Color(PALETTE.skyNight);
  const surfaceSkyColor = new THREE.Color(PALETTE.skyDay);
  const abyssBgColor = new THREE.Color("#06040d");

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
  };
  resize();
  window.addEventListener("resize", resize);

  const worldObj: World = {
    scene,
    camera,
    renderer,
    labelRenderer,
    colliders,
    dungeonColliders,
    screenMesh,
    screenLight,
    muralCanvas,
    muralTexture,
    timeMode: "ist",
    isNight: false,
    pokerTable,
    setScreenTexture(tex: THREE.Texture, accentColor = "#5b8def") {
      const mat = screenMesh.material as THREE.MeshBasicMaterial;
      mat.map = tex;
      mat.color.set("#ffffff");
      mat.needsUpdate = true;
      screenLight.color.set(accentColor);
    },
    setFootballState(ballX: number, ballZ: number, scoreRed: number, scoreBlue: number) {
      if (!Number.isFinite(ballX) || !Number.isFinite(ballZ)) return;
      ballMesh.position.x += (ballX - ballMesh.position.x) * 0.35;
      ballMesh.position.z += (ballZ - ballMesh.position.z) * 0.35;
      ballMesh.rotation.x += 0.08;
      ballMesh.rotation.z += 0.06;
      if (scoreRed !== lastScoreRed || scoreBlue !== lastScoreBlue) {
        lastScoreRed = scoreRed;
        lastScoreBlue = scoreBlue;
        updateFootballBoard(scoreRed, scoreBlue);
      }
    },
    setDungeonState(view: DungeonView) {
      lastDungeonView = view;
      if (dungeonRig) dungeonRig.update(view);
    },
    ensureDungeonLoaded,
    syncAnimals(animals: AnimalRenderState[]) {
      const now = performance.now();
      const playerInDungeon = isInBrickDungeon(camera.position.x, camera.position.z);
      for (const a of animals) {
        let entry = animalEntries.get(a.id);
        if (!entry) {
          entry = createAnimalMesh(a.species);
          entry.group.position.set(a.x, getDungeonFloorY(a.x, a.z), a.z);
          scene.add(entry.group);
          animalEntries.set(a.id, entry);
        }
        entry.targetX = a.x;
        entry.targetZ = a.z;
        entry.targetRot = a.rot;
        const animalInDungeon = isInBrickDungeon(a.x, a.z);
        // Hide underground dungeon monsters when outside in the surface world!
        entry.group.visible = a.hp > 0 && (!animalInDungeon || playerInDungeon);
      }
      for (const entry of animalEntries.values()) {
        if (!entry.group.visible) continue;
        entry.group.position.x += (entry.targetX - entry.group.position.x) * 0.18;
        entry.group.position.z += (entry.targetZ - entry.group.position.z) * 0.18;
        entry.group.rotation.y = entry.targetRot;
        const baseY = getDungeonFloorY(entry.group.position.x, entry.group.position.z);

        if (entry.species === "snake" && entry.segments) {
          entry.group.position.y = baseY + 0.02;
          entry.segments.forEach((seg, idx) => {
            seg.position.x = Math.sin(now * 0.011 + idx * 0.85 + entry.targetX) * 0.16;
          });
        } else if (entry.species === "cerberus" && entry.segments) {
          entry.group.position.y = baseY + Math.abs(Math.sin(now * 0.006)) * 0.18;
          entry.segments.forEach((headMesh, idx) => {
            headMesh.rotation.y = Math.sin(now * 0.005 + idx * 1.4) * 0.25;
            headMesh.rotation.x = Math.cos(now * 0.007 + idx * 1.1) * 0.14;
          });
        } else {
          entry.group.position.y = baseY + Math.abs(Math.sin(now * 0.008 + entry.targetX)) * 0.12;
        }
      }
    },
    paintMuralData(pixels: number[]) {
      drawAllPixels(pixels);
    },
    paintMuralPixel(x: number, y: number, colorIdx: number) {
      drawPixel(x, y, colorIdx);
    },
    updateAtmosphere(nowMs: number) {
      const tSec = nowMs / 1000;
      const inSouthForestView = camera.position.z > 25 && camera.position.z < 260;
      if (inSouthForestView) {
        flameGroup.scale.y = 0.92 + Math.sin(tSec * 11) * 0.12 + Math.cos(tSec * 17) * 0.06;
        flameGroup.rotation.y = tSec * 1.5;
        hauntedCastle.update(tSec);

        // Animate forest fireflies & river dragonflies only when in/near the south forest
        fireflies.position.y = Math.sin(tSec * 1.8) * 0.35;
        fireflies.rotation.y = Math.sin(tSec * 0.15) * 0.08;
        dragonflies.forEach((df, i) => {
          const angle = tSec * 1.9 + i * 1.3;
          df.position.x = df.userData.homeX + Math.cos(angle) * 3.8;
          df.position.z = df.userData.homeZ + Math.sin(angle * 1.4) * 2.2;
          df.position.y = 0.85 + Math.sin(tSec * 6 + i) * 0.22;
          df.rotation.y = -angle;
        });
      }

      // Throttle sky/fog/lamp/window updates to 4Hz with zero per-frame Color allocations
      if (nowMs - lastAtmoMs < 250) return;
      lastAtmoMs = nowMs;

      const hour =
        worldObj.timeMode === "ist"
          ? getIndianHourFloat()
          : worldObj.timeMode === "day"
            ? 12.5
            : worldObj.timeMode === "sunset"
              ? 18.0
              : 22.5;

      let nightFactor = 0;
      if (hour >= 19.2 || hour < 5.2) {
        nightFactor = 1;
      } else if (hour >= 17.2 && hour < 19.2) {
        nightFactor = (hour - 17.2) / 2.0;
      } else if (hour >= 5.2 && hour < 6.8) {
        nightFactor = 1 - (hour - 5.2) / 1.6;
      }

      worldObj.isNight = nightFactor > 0.45;

      if (nightFactor <= 0.5) {
        surfaceSkyColor.lerpColors(skyDayColor, skySunsetColor, nightFactor * 2);
      } else {
        surfaceSkyColor.lerpColors(skySunsetColor, skyNightColor, (nightFactor - 0.5) * 2);
      }

      const inUndergroundDungeon = isInBrickDungeon(camera.position.x, camera.position.z);

      if (inUndergroundDungeon) {
        scene.background = abyssBgColor;
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.color.copy(abyssBgColor);
          scene.fog.near = 26;
          scene.fog.far = 115;
        }
        sun.intensity = 0.35;
        hemi.intensity = 0.42;
        moonGroup.visible = false;
        stars.visible = false;
      } else {
        scene.background = surfaceSkyColor;
        if (scene.fog instanceof THREE.Fog) {
          scene.fog.color.copy(surfaceSkyColor);
          scene.fog.near = THREE.MathUtils.lerp(isTouchDevice ? 55 : 80, 44, nightFactor);
          scene.fog.far = THREE.MathUtils.lerp(isTouchDevice ? 175 : 245, 160, nightFactor);
        }
        sun.intensity = THREE.MathUtils.lerp(2.2, 0.22, nightFactor);
        sun.color.set(nightFactor > 0.3 && nightFactor < 0.8 ? "#ff9e66" : nightFactor >= 0.8 ? "#6b8cff" : "#fff4e0");
        hemi.intensity = THREE.MathUtils.lerp(0.9, 0.26, nightFactor);
        moonGroup.visible = nightFactor > 0.25;
        stars.visible = nightFactor > 0.35;
      }

      const lampEmissive = THREE.MathUtils.lerp(0.4, 2.2, nightFactor);
      for (const h of lampHeads) {
        (h.material as THREE.MeshStandardMaterial).emissiveIntensity = lampEmissive;
      }
      const lightPower = THREE.MathUtils.lerp(0, 3.8, nightFactor);
      for (const pl of streetLights) {
        pl.intensity = lightPower;
      }
      for (const wm of windowMaterials) {
        wm.emissiveIntensity = THREE.MathUtils.lerp(0.12, 1.35, nightFactor);
      }
      campfireLight.intensity = THREE.MathUtils.lerp(3.2, 8.2, nightFactor) + Math.sin(tSec * 9) * 0.4;
    },
    resize,
    render() {
      const insideDungeon = isInBrickDungeon(camera.position.x, camera.position.z);
      if (insideDungeon) {
        ensureDungeonLoaded();
      } else if (dungeonRig) {
        unloadDungeon();
      }
      ground.visible = !insideDungeon;
      forestGround.visible = !insideDungeon;

      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
  };

  return worldObj;
}

function addAtmosphereAndLights(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight("#dcecff", "#4a6b3e", 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#fff4e0", 2.2);
  sun.position.set(55, 75, 35);
  sun.castShadow = true;
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const shadowSize = isTouch ? 512 : 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 240;
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  const moonGroup = new THREE.Group();
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(6.5, 16, 14),
    standard("#f8fafc", { emissive: "#dbeafe", emissiveIntensity: 1.6 }),
  );
  moonMesh.position.set(-65, 88, -80);
  moonGroup.add(moonMesh);
  moonGroup.visible = false;
  scene.add(moonGroup);

  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(300 * 3);
  const rand = mulberry32(991122);
  for (let i = 0; i < 300; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = rand() * Math.PI * 0.42;
    const r = 220;
    starPositions[i * 3] = Math.cos(theta) * Math.sin(phi) * r;
    starPositions[i * 3 + 1] = Math.cos(phi) * r + 25;
    starPositions[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: "#ffffff", size: 1.4, sizeAttenuation: false }),
  );
  stars.visible = false;
  scene.add(stars);

  return { hemi, sun, moonGroup, stars };
}

function addGroundAndRingRoad(scene: THREE.Scene) {
  const size = WORLD.size + 120;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), standard(PALETTE.grass));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const forestGround = new THREE.Mesh(new THREE.PlaneGeometry(420, 210), standard(PALETTE.forestGrass));
  forestGround.rotation.x = -Math.PI / 2;
  forestGround.position.set(0, 0.008, 138);
  forestGround.receiveShadow = true;
  scene.add(forestGround);

  const ringRoad = new THREE.Mesh(
    new THREE.RingGeometry(28.5, 34.5, 64),
    standard(PALETTE.road, { roughness: 0.92 }),
  );
  ringRoad.rotation.x = -Math.PI / 2;
  ringRoad.position.y = 0.018;
  ringRoad.receiveShadow = true;
  scene.add(ringRoad);

  const dashLine = new THREE.Mesh(
    new THREE.RingGeometry(31.35, 31.65, 64),
    new THREE.MeshBasicMaterial({ color: "#f8fafc", side: THREE.DoubleSide }),
  );
  dashLine.rotation.x = -Math.PI / 2;
  dashLine.position.y = 0.024;
  scene.add(dashLine);

  return { ground, forestGround };
}

function addPlaza(
  scene: THREE.Scene,
  colliders: Colliders,
  lampHeads: THREE.Mesh[],
  streetLights: THREE.PointLight[],
) {
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(15, 48), standard(PALETTE.stone));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  scene.add(plaza);

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 24), standard("#b9b2a5"));
  basin.position.y = 0.35;
  basin.castShadow = basin.receiveShadow = true;
  scene.add(basin);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 0.1, 24),
    standard(PALETTE.water, { roughness: 0.3, emissive: "#1b5f8f", emissiveIntensity: 0.35 }),
  );
  water.position.y = 0.7;
  scene.add(water);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 12), standard("#b9b2a5"));
  column.position.y = 1.8;
  column.castShadow = true;
  scene.add(column);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 0.9, 0.3, 12), standard("#b9b2a5"));
  top.position.y = 3.0;
  top.castShadow = true;
  scene.add(top);

  colliders.circles.push({ x: 0, z: 0, r: 3.4 });

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 13;
    const z = Math.sin(a) * 13;
    if (i % 2 === 0) addLamp(scene, colliders, x, z, lampHeads, streetLights, i === 0 || i === 4);
    else addBench(scene, colliders, x, z, a + Math.PI / 2);
  }
}

function addOpenSocialZoneRing(scene: THREE.Scene) {
  const ringGeo = new THREE.RingGeometry(SOCIAL_ZONE.radius - 0.18, SOCIAL_ZONE.radius, 64);
  const ringMat = new THREE.MeshBasicMaterial({
    color: "#4fc3d9",
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.032;
  scene.add(ring);
}

function addLamp(
  scene: THREE.Scene,
  colliders: Colliders,
  x: number,
  z: number,
  lampHeads: THREE.Mesh[],
  streetLights: THREE.PointLight[],
  withPointLight = false,
) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 8), standard(PALETTE.lamp));
  post.position.set(x, 1.8, z);
  post.castShadow = true;
  scene.add(post);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 10, 8),
    standard("#fff2c4", { emissive: "#ffe29a", emissiveIntensity: 0.6 }),
  );
  head.position.set(x, 3.7, z);
  scene.add(head);
  lampHeads.push(head);

  if (withPointLight) {
    const light = new THREE.PointLight("#ffd685", 0, 18, 1.5);
    light.position.set(x, 3.5, z);
    scene.add(light);
    streetLights.push(light);
  }
  colliders.circles.push({ x, z, r: 0.25 });
}

function addBench(scene: THREE.Scene, colliders: Colliders, x: number, z: number, yaw: number) {
  const bench = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 0.5), standard(PALETTE.bench));
  seat.position.y = 0.45;
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.08), standard(PALETTE.bench));
  back.position.set(0, 0.75, -0.22);
  for (const m of [seat, back]) {
    m.castShadow = m.receiveShadow = true;
    bench.add(m);
  }
  for (const sx of [-0.75, 0.75]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.45), standard(PALETTE.lamp));
    leg.position.set(sx, 0.22, 0);
    bench.add(leg);
  }
  bench.position.set(x, 0, z);
  bench.rotation.y = -yaw;
  scene.add(bench);
  colliders.circles.push({ x, z, r: 0.9 });
}

function addAvenues(
  scene: THREE.Scene,
  colliders: Colliders,
  lampHeads: THREE.Mesh[],
  streetLights: THREE.PointLight[],
) {
  const mat = standard(PALETTE.path);
  const specs: Array<[number, number, number, number]> = [
    [0, -24, 5.5, 22],
    [0, 35, 5.0, 42],
    [-38, 0, 48, 5.5],
    [38, 0, 48, 5.5],
  ];
  for (const [x, z, w, d] of specs) {
    const path = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(x, 0.015, z);
    path.receiveShadow = true;
    scene.add(path);
  }

  const lampCoords: Array<[number, number, boolean]> = [
    [5, -26, false],
    [-5, -26, false],
    [5, 26, false],
    [-5, 26, false],
    [-35, 4, false],
    [-35, -4, false],
    [35, 4, false],
    [35, -4, false],
  ];
  for (const [lx, lz, hasLight] of lampCoords) {
    addLamp(scene, colliders, lx, lz, lampHeads, streetLights, hasLight);
  }
}

function addOpenMicStage(scene: THREE.Scene, colliders: Colliders) {
  const g = new THREE.Group();
  const cx = OPEN_MIC_STAGE.x;
  const cz = OPEN_MIC_STAGE.z;

  const deck = new THREE.Mesh(
    new THREE.CylinderGeometry(OPEN_MIC_STAGE.stageRadius, OPEN_MIC_STAGE.stageRadius + 0.3, 0.55, 24),
    standard("#7c5841"),
  );
  deck.position.set(cx, 0.28, cz);
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(OPEN_MIC_STAGE.stageRadius - 0.15, OPEN_MIC_STAGE.stageRadius + 0.05, 32),
    new THREE.MeshBasicMaterial({ color: "#f2a33a", side: THREE.DoubleSide }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(cx, 0.57, cz);
  g.add(rim);

  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.35, 8), standard("#22262e"));
  stand.position.set(cx, 1.25, cz + 0.8);
  const micHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    standard("#e2e8f0", { emissive: "#f26d6d", emissiveIntensity: 0.8 }),
  );
  micHead.position.set(cx, 1.95, cz + 0.8);
  g.add(stand, micHead);

  for (const angle of [-0.45, 0, 0.45]) {
    const bx = cx + Math.sin(angle) * 6.8;
    const bz = cz + Math.cos(angle) * 6.8;
    addBench(scene, colliders, bx, bz, -angle + Math.PI / 2);
  }

  scene.add(g);

  createNoticeBoard(scene, colliders, {
    x: cx - 5.2,
    z: cz + 3.5,
    yaw: -0.35,
    title: "OPEN-MIC STAGE",
    lines: [
      "Step onto the stage to broadcast your voice",
      "Everyone on the benches around can hear you",
      "Audience: use keys 1-4 to cheer and react",
    ],
  });
}

function addGraffitiMuralWall(scene: THREE.Scene, colliders: Colliders) {
  const cx = GRAFFITI_MURAL.x;
  const cz = GRAFFITI_MURAL.z;

  const muralCanvas = document.createElement("canvas");
  muralCanvas.width = 512;
  muralCanvas.height = 256;
  const ctx = muralCanvas.getContext("2d")!;
  ctx.fillStyle = GRAFFITI_MURAL.palette[0]!;
  ctx.fillRect(0, 0, 512, 256);

  const muralTexture = new THREE.CanvasTexture(muralCanvas);
  muralTexture.colorSpace = THREE.SRGBColorSpace;
  muralTexture.minFilter = THREE.NearestFilter;
  muralTexture.magFilter = THREE.NearestFilter;

  const drawPixel = (x: number, y: number, colorIdx: number) => {
    const pw = 512 / GRAFFITI_MURAL.width;
    const ph = 256 / GRAFFITI_MURAL.height;
    ctx.fillStyle = GRAFFITI_MURAL.palette[colorIdx] ?? "#ffffff";
    ctx.fillRect(x * pw, y * ph, pw, ph);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.strokeRect(x * pw, y * ph, pw, ph);
    muralTexture.needsUpdate = true;
  };

  const drawAllPixels = (pixels: number[]) => {
    for (let y = 0; y < GRAFFITI_MURAL.height; y++) {
      for (let x = 0; x < GRAFFITI_MURAL.width; x++) {
        const idx = pixels[y * GRAFFITI_MURAL.width + x] ?? 0;
        drawPixel(x, y, idx);
      }
    }
  };

  const wallFrame = new THREE.Mesh(new THREE.BoxGeometry(10.8, 5.4, 0.5), standard("#252834"));
  wallFrame.position.set(cx, 2.7, cz);
  wallFrame.castShadow = true;
  scene.add(wallFrame);

  const canvasPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 4.8),
    new THREE.MeshBasicMaterial({ map: muralTexture }),
  );
  canvasPlane.position.set(cx, 2.7, cz + 0.27);
  scene.add(canvasPlane);

  colliders.boxes.push({ x: cx, z: cz, hw: 5.4, hd: 0.35 });

  createNoticeBoard(scene, colliders, {
    x: cx + 7.2,
    z: cz + 1.8,
    yaw: 0.25,
    title: "PIXEL MURAL",
    lines: [
      "Shared 32x16 community graffiti wall",
      "Walk up to the wall and press E to paint",
      "Every pixel updates live for everyone",
    ],
  });

  return { muralCanvas, muralTexture, drawPixel, drawAllPixels };
}

function addFootballStadium(scene: THREE.Scene, colliders: Colliders) {
  const cx = FOOTBALL_STADIUM.centerX;
  const cz = FOOTBALL_STADIUM.centerZ;
  const w = FOOTBALL_STADIUM.halfW * 2;
  const d = FOOTBALL_STADIUM.halfD * 2;

  const group = new THREE.Group();

  const turf = new THREE.Mesh(new THREE.PlaneGeometry(w, d), standard("#2f8546"));
  turf.rotation.x = -Math.PI / 2;
  turf.position.set(cx, 0.025, cz);
  turf.receiveShadow = true;
  group.add(turf);

  const lineMat = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide });
  const midLine = new THREE.Mesh(new THREE.PlaneGeometry(0.22, d), lineMat);
  midLine.rotation.x = -Math.PI / 2;
  midLine.position.set(cx, 0.032, cz);
  const centerCircle = new THREE.Mesh(new THREE.RingGeometry(3.8, 4.0, 32), lineMat);
  centerCircle.rotation.x = -Math.PI / 2;
  centerCircle.position.set(cx, 0.032, cz);
  group.add(midLine, centerCircle);

  const gw = FOOTBALL_STADIUM.goalHalfZ * 2;
  for (const [side, color] of [
    [-1, "#e63946"],
    [1, "#3b82f6"],
  ] as const) {
    const gx = cx + side * FOOTBALL_STADIUM.halfW;
    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.25, gw),
      standard(color, { emissive: color, emissiveIntensity: 0.6 }),
    );
    crossbar.position.set(gx, 2.5, cz);
    group.add(crossbar);
    for (const sz of [-FOOTBALL_STADIUM.goalHalfZ, FOOTBALL_STADIUM.goalHalfZ]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 2.5, 8),
        standard(color, { emissive: color, emissiveIntensity: 0.6 }),
      );
      post.position.set(gx, 1.25, cz + sz);
      group.add(post);
      colliders.circles.push({ x: gx, z: cz + sz, r: 0.2 });
    }
  }

  for (let tier = 0; tier < 3; tier++) {
    const bleacher = new THREE.Mesh(new THREE.BoxGeometry(24, 0.55 + tier * 0.55, 1.1), standard("#64748b"));
    bleacher.position.set(cx, (0.55 + tier * 0.55) / 2, cz - FOOTBALL_STADIUM.halfD - 2.2 - tier * 1.15);
    bleacher.castShadow = true;
    group.add(bleacher);
  }

  const ballMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(FOOTBALL_STADIUM.ballRadius, 1),
    standard("#ffffff", { emissive: "#cbd5e1", emissiveIntensity: 0.2 }),
  );
  ballMesh.position.set(cx, FOOTBALL_STADIUM.ballRadius, cz);
  ballMesh.castShadow = true;
  group.add(ballMesh);

  scene.add(group);

  const drawBoard = createNoticeBoard(scene, colliders, {
    x: cx + 15,
    z: cz + FOOTBALL_STADIUM.halfD + 2.2,
    yaw: Math.PI,
    scale: 0.8,
    title: "FOOTBALL STADIUM",
    lines: [
      "SCORE:  RED 0  —  0 BLUE",
      "Run into the ball to dribble across the pitch",
      "Press SPACE near the ball to kick / shoot",
    ],
  });

  const updateFootballBoard = (scoreRed: number, scoreBlue: number) => {
    drawBoard("FOOTBALL STADIUM", [
      `SCORE:  RED ${scoreRed}  —  ${scoreBlue} BLUE`,
      "Run into the ball to dribble across the pitch",
      "Press SPACE near the ball to kick / shoot",
    ]);
  };

  return { ballMesh, updateFootballBoard };
}

/**
 * South District:
 * 1. Foothill Ridge & Canyon Trail (`z = +36..+56`) that screens off the city buildings
 *    so the Campfire Valley at `z = +68` feels completely immersed in the wilderness!
 * 2. Rolling Terrain Dunes & Mountain Backdrop (`18m–32m` tall peaks)
 * 3. Glowing Firefly Swarms & Flying Dragonflies
 */
function addCampfireAndForestWilderness(scene: THREE.Scene, colliders: Colliders) {
  const cx = CAMPFIRE_BASE.x;
  const cz = CAMPFIRE_BASE.z;
  const g = new THREE.Group();

  // 1. Foothill Ridge screening the city from the Campfire Valley (leaving a 7m central canyon pass)
  const hillMat = standard(PALETTE.hillGrass);
  const rockMat = standard(PALETTE.mountainRock);
  const ridgeMounds: Array<[number, number, number, number]> = [
    [-16, 46, 12, 8.5],
    [-32, 48, 15, 10.5],
    [-52, 50, 18, 12.0],
    [-76, 52, 20, 11.0],
    [16, 46, 12, 8.5],
    [32, 48, 15, 10.5],
    [52, 50, 18, 12.0],
    [76, 52, 20, 11.0],
  ];
  for (const [hx, hz, radius, height] of ridgeMounds) {
    const mound = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 9), hillMat);
    mound.position.set(hx, height * 0.45, hz);
    mound.castShadow = mound.receiveShadow = true;
    g.add(mound);
    const crag = new THREE.Mesh(new THREE.DodecahedronGeometry(radius * 0.42, 0), rockMat);
    crag.position.set(hx * 0.96, height * 0.65, hz + 1.5);
    g.add(crag);
    colliders.circles.push({ x: hx, z: hz, r: radius * 0.72 });
  }

  // 2. Rolling Forest Terrain Dunes & Mountain Backdrop along the West, South, and East horizons
  const duneSpecs: Array<[number, number, number, number]> = [
    [-34, 88, 14, 3.2],
    [28, 92, 13, 2.8],
    [-38, 135, 16, 3.8],
    [38, 142, 16, 3.8],
    [-68, 105, 18, 5.5],
    [68, 108, 18, 5.5],
    [-88, 145, 24, 18.0],
    [88, 148, 24, 18.0],
    [-75, 185, 28, 24.0],
    [75, 185, 28, 24.0],
    [-52, 212, 26, 26.0],
    [52, 212, 26, 26.0],
    [-60, 260, 34, 30.0],
    [60, 260, 34, 30.0],
  ];
  for (const [dx, dz, rad, h] of duneSpecs) {
    const isPeak = h >= 12;
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(rad, h, isPeak ? 7 : 12),
      isPeak ? rockMat : hillMat,
    );
    mesh.position.set(dx, h * 0.42, dz);
    mesh.receiveShadow = true;
    if (isPeak) {
      mesh.castShadow = true;
      colliders.circles.push({ x: dx, z: dz, r: rad * 0.65 });
    }
    g.add(mesh);
  }

  // 3. Deep Forest Campfire Clearing at z = +68
  const clearing = new THREE.Mesh(new THREE.CircleGeometry(12.5, 36), standard("#7d6549"));
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.set(cx, 0.02, cz);
  clearing.receiveShadow = true;
  g.add(clearing);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), standard("#6b7280"));
    rock.position.set(cx + Math.cos(a) * 1.2, 0.2, cz + Math.sin(a) * 1.2);
    g.add(rock);
  }

  const flameGroup = new THREE.Group();
  flameGroup.position.set(cx, 0.2, cz);
  const outerFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 1.75, 7),
    standard("#ff7b00", { emissive: "#ff5500", emissiveIntensity: 1.8 }),
  );
  outerFlame.position.y = 0.85;
  const innerFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.48, 1.15, 6),
    standard("#ffe66d", { emissive: "#ffcf33", emissiveIntensity: 2.2 }),
  );
  innerFlame.position.y = 0.58;
  flameGroup.add(outerFlame, innerFlame);
  g.add(flameGroup);

  const campfireLight = new THREE.PointLight("#ff8c2b", 5.2, 32, 1.3);
  campfireLight.position.set(cx, 2.4, cz);
  g.add(campfireLight);
  colliders.circles.push({ x: cx, z: cz, r: 1.4 });

  const logMat = standard("#6e472b");
  for (let i = CINEMA_HALL.seatCount; i < CINEMA_SEATS.length; i++) {
    const s = CINEMA_SEATS[i]!;
    if (s.row !== 10) continue;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 8), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = -s.rot;
    log.position.set(s.x, 0.28, s.z);
    log.castShadow = log.receiveShadow = true;
    g.add(log);
  }

  const spit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 0.8), standard("#3f2e21"));
  spit.position.set(CAMPFIRE_BASE.cookPos.x, 0.55, CAMPFIRE_BASE.cookPos.z);
  g.add(spit);

  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.5), standard("#5c3d28"));
  rack.position.set(CAMPFIRE_BASE.toolRackPos.x, 0.9, CAMPFIRE_BASE.toolRackPos.z);
  g.add(rack);

  // Winding Forest River at z = +112 with Three Bridges (leading to the Haunted Castle Gatehouse)
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(380, 8.5),
    standard(PALETTE.water, { roughness: 0.25, emissive: "#164e78", emissiveIntensity: 0.32 }),
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.02, 112);
  g.add(river);

  for (const bx of [-46, 0, 48]) {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.38, 10.5), standard("#7c5234"));
    bridge.position.set(bx, 0.19, 112);
    bridge.receiveShadow = true;
    g.add(bridge);
  }

  // 4. Glowing Forest Fireflies & Flying River Dragonflies
  const ffGeo = new THREE.BufferGeometry();
  const ffCount = 200;
  const ffPositions = new Float32Array(ffCount * 3);
  const rand = mulberry32(774411);
  for (let i = 0; i < 200; i++) {
    ffPositions[i * 3] = (rand() * 2 - 1) * 115;
    ffPositions[i * 3 + 1] = 0.6 + rand() * 3.8;
    ffPositions[i * 3 + 2] = 58 + rand() * 135;
  }
  ffGeo.setAttribute("position", new THREE.BufferAttribute(ffPositions, 3));
  const fireflies = new THREE.Points(
    ffGeo,
    new THREE.PointsMaterial({ color: "#bef264", size: 2.2, sizeAttenuation: false }),
  );
  g.add(fireflies);

  const dragonflies: THREE.Group[] = [];
  const wingMat = new THREE.MeshBasicMaterial({ color: "#67e8f9", side: THREE.DoubleSide, transparent: true, opacity: 0.75 });
  const bodyMat = standard("#06b6d4", { emissive: "#0891b2", emissiveIntensity: 0.8 });
  for (let i = 0; i < 14; i++) {
    const df = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.42), bodyMat);
    const w1 = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14), wingMat);
    w1.rotation.x = -Math.PI / 2;
    df.add(b, w1);
    const hx = (rand() * 2 - 1) * 65;
    const hz = 74 + rand() * 85;
    df.userData = { homeX: hx, homeZ: hz };
    df.position.set(hx, 1.1, hz);
    g.add(df);
    dragonflies.push(df);
  }

  scene.add(g);

  createNoticeBoard(scene, colliders, {
    x: cx + 6.5,
    z: cz - 6.8,
    yaw: Math.PI,
    title: "DEEP FOREST CAMP",
    lines: [
      "Press E near logs to sit & talk around the fire",
      "Grab a Torch, Spear, or Bow from the tool rack",
      "Cross the south bridge to the Haunted Castle Door",
    ],
  });

  return { campfireLight, flameGroup, fireflies, dragonflies };
}

/**
 * Surface Landmark: Compact Haunted Castle Gatehouse & Ominous Haunted Door (`z = 115..121, y = 0m`).
 * Conceals the true scale of the 360m-long 4-Depth Underground Dungeon from the outside world!
 * Features twin crenellated dark-stone watchtowers, gothic spire roofs, iron portcullis fangs,
 * flickering violet/emerald soul-fire sconces, gnarled dead trees, and a swirling Abyssal Mist Door.
 */
function addHauntedCastleGatehouse(scene: THREE.Scene, colliders: Colliders) {
  const cx = HAUNTED_GATE.x;
  const doorZ = HAUNTED_GATE.z; // 120
  const group = new THREE.Group();

  const darkCastleStone = createBrickPBRMaterial({
    repeatX: 6,
    repeatY: 4,
    baseColor: "#1f222d",
    mossy: true,
    bumpScale: 0.11,
  });
  const spireRoofMat = standard("#161224", { roughness: 0.7 });
  const ironMat = new THREE.MeshStandardMaterial({ color: "#18181b", roughness: 0.35, metalness: 0.82 });
  const soulVioletMat = standard("#c084fc", { emissive: "#9333ea", emissiveIntensity: 2.4 });
  const soulGreenMat = standard("#4ade80", { emissive: "#16a34a", emissiveIntensity: 2.2 });
  const deadWoodMat = standard("#271c19", { roughness: 0.95 });

  // Cobblestone approach causeway from the river bridge (z = 115..120)
  const causeway = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.18, 6.2), darkCastleStone);
  causeway.position.set(cx, 0.09, doorZ - 2.6);
  causeway.receiveShadow = true;
  group.add(causeway);

  // Twin Crenellated Gothic Watchtowers flanking the Haunted Door (x = ±9.6, z = 119.2)
  const soulFlames: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const tx = cx + side * 9.6;
    const tz = doorZ - 0.6;
    const towerBody = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 11.2, 10), darkCastleStone);
    towerBody.position.set(tx, 5.6, tz);
    towerBody.castShadow = towerBody.receiveShadow = true;
    group.add(towerBody);
    colliders.circles.push({ x: tx, z: tz, r: 3.6 });

    // Battlement parapet ring & merlons
    const parapet = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.6, 1.1, 10), darkCastleStone);
    parapet.position.set(tx, 11.4, tz);
    group.add(parapet);

    // Pointed Witch-Spire Roof
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4.1, 5.4, 10), spireRoofMat);
    spire.position.set(tx, 14.6, tz);
    spire.castShadow = true;
    group.add(spire);

    // Narrow glowing lancet window slit facing north
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.4, 0.2), soulVioletMat);
    slit.position.set(tx, 7.2, tz - 3.55);
    group.add(slit);

    // Soul-Fire Brazier Sconce flanking the gatehouse archway
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.5, 8), darkCastleStone);
    pedestal.position.set(cx + side * 5.2, 0.75, doorZ - 2.1);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 8), ironMat);
    bowl.position.set(cx + side * 5.2, 1.6, doorZ - 2.1);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.42, 1.05, 7),
      side < 0 ? soulVioletMat : soulGreenMat,
    );
    flame.position.set(cx + side * 5.2, 2.25, doorZ - 2.1);
    group.add(pedestal, bowl, flame);
    soulFlames.push(flame);

    // Gnarled Dead Haunted Trees & Ancient Gravestones outside the gatehouse
    const deadTree = new THREE.Group();
    deadTree.position.set(cx + side * 15.5, 0, doorZ - 3.2);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.52, 4.2, 6), deadWoodMat);
    trunk.position.y = 2.1;
    trunk.rotation.z = side * -0.14;
    const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 2.4, 5), deadWoodMat);
    b1.position.set(side * 0.7, 3.6, 0.2);
    b1.rotation.z = side * -0.65;
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.18, 2.0, 5), deadWoodMat);
    b2.position.set(side * -0.55, 3.2, -0.3);
    b2.rotation.z = side * 0.55;
    deadTree.add(trunk, b1, b2);
    group.add(deadTree);
    colliders.circles.push({ x: cx + side * 15.5, z: doorZ - 3.2, r: 0.65 });
  }

  // Central Gatehouse Curtain Wall & Gothic Battlements over the Ominous Door
  const upperKeep = new THREE.Mesh(new THREE.BoxGeometry(16.0, 4.6, 3.8), darkCastleStone);
  upperKeep.position.set(cx, 8.1, doorZ - 0.2);
  upperKeep.castShadow = true;
  group.add(upperKeep);

  for (let mx = -6.4; mx <= 6.4; mx += 2.1) {
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.8), darkCastleStone);
    merlon.position.set(cx + mx, 10.9, doorZ - 1.8);
    group.add(merlon);
  }

  // Enclosed Stone Back-Keep Mound (z = 120..124) so from outside it looks like a small self-contained castle keep!
  const keepBackRoof = new THREE.Mesh(new THREE.BoxGeometry(18.0, 7.2, 5.0), darkCastleStone);
  keepBackRoof.position.set(cx, 3.6, doorZ + 2.2);
  group.add(keepBackRoof);
  colliders.boxes.push({ x: cx, z: doorZ + 2.4, hw: 9.0, hd: 1.4 });

  // Iron Portcullis Fangs & Heavy Gothic Door Frame at z = 119.5
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(2.2, 6.2, 2.6), darkCastleStone);
    jamb.position.set(cx + side * 5.2, 3.1, doorZ - 0.2);
    group.add(jamb);
  }
  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.55, 0.55), ironMat);
  topBeam.position.set(cx, 5.65, doorZ - 0.85);
  group.add(topBeam);
  for (let fx = -3.6; fx <= 3.6; fx += 0.9) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.95, 5), ironMat);
    spike.rotation.x = Math.PI;
    spike.position.set(cx + fx, 5.1, doorZ - 0.85);
    group.add(spike);
  }

  // Ominous Swirling Abyssal Portal Veil inside the doorway (players walk right through it into the underground!)
  const portalVeil = new THREE.Mesh(
    new THREE.PlaneGeometry(8.2, 5.8),
    new THREE.MeshBasicMaterial({
      color: "#0b0518",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    }),
  );
  portalVeil.position.set(cx, 2.9, doorZ - 0.35);
  group.add(portalVeil);

  const portalRunes = new THREE.Mesh(
    new THREE.RingGeometry(2.1, 2.45, 32),
    new THREE.MeshBasicMaterial({
      color: "#a855f7",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
    }),
  );
  portalRunes.position.set(cx, 2.9, doorZ - 0.42);
  group.add(portalRunes);

  const gateLight = new THREE.PointLight("#a855f7", 4.5, 22, 1.4);
  gateLight.position.set(cx, 3.8, doorZ - 2.2);
  group.add(gateLight);

  scene.add(group);

  createNoticeBoard(scene, colliders, {
    x: cx - 9.2,
    z: doorZ - 4.8,
    yaw: Math.PI,
    title: "THE HAUNTED CASTLE DOOR",
    lines: [
      "Step through the Ominous Door into the Underground!",
      "4 Descending Depths (0m -> -6m -> -12m -> -18m)",
      "Alternating tight trap crypts & colossal rotundas!",
    ],
  });

  return {
    group,
    update(tSec: number) {
      portalRunes.rotation.z = tSec * 0.85;
      portalRunes.scale.setScalar(0.95 + Math.sin(tSec * 2.6) * 0.06);
      soulFlames.forEach((fl, i) => {
        fl.scale.y = 0.88 + Math.sin(tSec * 12 + i * 2.1) * 0.16;
        fl.rotation.y = tSec * 2.2;
      });
    },
  };
}

// Underground dungeon is lazy-loaded from ./dungeon when entering the Haunted Gate.

/**
 * Pure 3D low-poly forest animal, slithering snake, Giant Ember Spider,
 * Shadow Wolf, or Colossal 3-Faced Dire Wolf Boss ("cerberus") mesh!
 */
function createAnimalMesh(species: string): AnimalMeshEntry {
  const group = new THREE.Group();

  if (species === "snake") {
    const snakeGreen = standard("#16a34a", { emissive: "#14532d", emissiveIntensity: 0.35 });
    const bellyMat = standard("#bef264");
    const eyeMat = standard("#facc15", { emissive: "#eab308", emissiveIntensity: 1.2 });
    const tongueMat = standard("#ef4444", { emissive: "#dc2626", emissiveIntensity: 0.9 });
    const segments: THREE.Mesh[] = [];

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.24, 0.38), snakeGreen);
    head.position.set(0, 0.22, 0.65);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.32, 0.16), bellyMat);
    hood.position.set(0, 0.22, 0.52);
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), eyeMat);
    eyeL.position.set(-0.12, 0.28, 0.78);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.12;
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.24), tongueMat);
    tongue.position.set(0, 0.18, 0.92);
    group.add(head, hood, eyeL, eyeR, tongue);
    segments.push(head);

    for (let i = 0; i < 6; i++) {
      const r = 0.16 * (1 - i * 0.11);
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 6), i % 2 === 0 ? snakeGreen : bellyMat);
      seg.position.set(0, r, 0.35 - i * 0.26);
      seg.castShadow = true;
      group.add(seg);
      segments.push(seg);
    }

    return {
      group,
      species,
      segments,
      targetX: 0,
      targetZ: 95,
      targetRot: 0,
    };
  }

  // Depth 2: Giant Cinder-Spider with 8 jointed legs, glowing magma abdomen & ceiling silk thread
  if (species === "spider") {
    const chitinMat = standard("#1c1917");
    const emberMat = standard("#f97316", { emissive: "#ea580c", emissiveIntensity: 1.35 });
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.58, 10, 8), chitinMat);
    abdomen.position.set(0, 0.55, -0.35);
    const emberStripe = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), emberMat);
    emberStripe.position.set(0, 0.72, -0.35);
    const thorax = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.55), chitinMat);
    thorax.position.set(0, 0.48, 0.28);
    group.add(abdomen, emberStripe, thorax);

    for (const ex of [-0.16, -0.06, 0.06, 0.16]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), emberMat);
      eye.position.set(ex, 0.56, 0.56);
      group.add(eye);
    }
    for (const side of [-1, 1]) {
      for (const lz of [-0.25, -0.05, 0.15, 0.35]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.1), chitinMat);
        leg.position.set(side * 0.58, 0.36, lz);
        leg.rotation.z = side * -0.42;
        group.add(leg);
      }
    }
    const silkLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 5.5, 6),
      new THREE.MeshBasicMaterial({ color: "#e2e8f0", transparent: true, opacity: 0.45 }),
    );
    silkLine.position.set(0, 3.2, 0);
    group.add(silkLine);

    return { group, species, targetX: 0, targetZ: 250, targetRot: 0 };
  }

  // Depth 4 Final Boss: Colossal 3-Faced Dire Wolf (❄️ Left Ice Head, 🔥 Center Fire Head, 🌑 Right Shadow Head)
  if (species === "cerberus") {
    const furMat = standard("#1e1b2e", { roughness: 0.75 });
    const iceMat = standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 1.4 });
    const fireMat = standard("#f97316", { emissive: "#ea580c", emissiveIntensity: 1.5 });
    const shadowMat = standard("#a855f7", { emissive: "#7e22ce", emissiveIntensity: 1.4 });
    const fangMat = standard("#f8fafc");

    const torso = new THREE.Mesh(new THREE.BoxGeometry(2.8, 2.2, 4.2), furMat);
    torso.position.set(0, 2.1, 0);
    torso.castShadow = true;
    const mane = new THREE.Mesh(new THREE.BoxGeometry(3.3, 2.5, 1.8), furMat);
    mane.position.set(0, 2.5, 1.4);
    group.add(torso, mane);

    for (const lx of [-1.05, 1.05]) {
      for (const lz of [-1.45, 1.45]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.8, 0.62), furMat);
        leg.position.set(lx, 0.9, lz);
        leg.castShadow = true;
        group.add(leg);
      }
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 6), shadowMat);
    tail.rotation.x = -Math.PI / 3;
    tail.position.set(0, 2.3, -2.5);
    group.add(tail);

    const heads: THREE.Mesh[] = [];
    const headConfigs: Array<{ x: number; y: number; yaw: number; mat: THREE.Material }> = [
      { x: -1.25, y: 3.1, yaw: 0.28, mat: iceMat },
      { x: 0, y: 3.45, yaw: 0, mat: fireMat },
      { x: 1.25, y: 3.1, yaw: -0.28, mat: shadowMat },
    ];
    for (const hc of headConfigs) {
      const skull = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.0, 1.35), furMat);
      skull.position.set(hc.x, hc.y, 2.45);
      skull.rotation.y = hc.yaw;

      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.56, 0.95), hc.mat);
      snout.position.set(0, -0.12, 0.85);
      skull.add(snout);

      for (const ex of [-0.32, 0.32]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.58, 4), hc.mat);
        ear.position.set(ex, 0.68, -0.15);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), hc.mat);
        eye.position.set(ex * 0.85, 0.18, 0.66);
        const fang = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 5), fangMat);
        fang.rotation.x = Math.PI;
        fang.position.set(ex * 0.65, -0.38, 1.05);
        skull.add(ear, eye, fang);
      }
      group.add(skull);
      heads.push(skull);
    }

    return {
      group,
      species,
      segments: heads,
      targetX: 0,
      targetZ: BRICK_DUNGEON.bossHomeZ,
      targetRot: Math.PI,
    };
  }

  const isShadowWolf = species === "shadow_wolf";
  const color =
    species === "rabbit"
      ? "#f1f5f9"
      : species === "deer"
        ? "#b57c4a"
        : species === "boar"
          ? "#4b382a"
          : isShadowWolf
            ? "#2e1065"
            : "#64748b";
  const scale =
    species === "rabbit"
      ? 0.55
      : species === "deer"
        ? 1.05
        : species === "boar"
          ? 0.9
          : isShadowWolf
            ? 1.18
            : 0.95;

  const mat = isShadowWolf
    ? standard(color, { emissive: "#581c87", emissiveIntensity: 0.75 })
    : standard(color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7 * scale, 0.55 * scale, 1.15 * scale), mat);
  body.position.y = 0.55 * scale;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45 * scale, 0.45 * scale, 0.5 * scale), mat);
  head.position.set(0, 0.85 * scale, 0.55 * scale);
  group.add(body, head);

  if (isShadowWolf) {
    const eyeMat = standard("#c084fc", { emissive: "#a855f7", emissiveIntensity: 1.8 });
    for (const ex of [-0.14 * scale, 0.14 * scale]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06 * scale, 6, 6), eyeMat);
      eye.position.set(ex, 0.92 * scale, 0.82 * scale);
      group.add(eye);
    }
  }

  for (const lx of [-0.22 * scale, 0.22 * scale]) {
    for (const lz of [-0.38 * scale, 0.38 * scale]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14 * scale, 0.45 * scale, 0.14 * scale), mat);
      leg.position.set(lx, 0.22 * scale, lz);
      group.add(leg);
    }
  }

  return {
    group,
    species,
    targetX: 0,
    targetZ: 85,
    targetRot: 0,
  };
}

function addCinemaHall(scene: THREE.Scene, colliders: Colliders) {
  const group = new THREE.Group();

  const carpetAisleMat = standard("#38141e", { roughness: 0.95 });
  const carpetRunnerMat = standard("#801428", { roughness: 0.88 });
  const concreteRiserMat = standard("#1f1c26", { roughness: 0.85 });
  const wallAcousticMat = standard("#14111c", { roughness: 0.95 });
  const mahoganyTrimMat = standard("#4a2818", { roughness: 0.65 });
  const brassGoldMat = standard("#c99a3e", { roughness: 0.35, metalness: 0.8 });
  const neonGoldMat = standard("#fbbf24", { emissive: "#d97706", emissiveIntensity: 2.2 });
  const neonBlueMat = standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 1.8 });
  const ceilingAcousticMat = standard("#0d0b12", { roughness: 0.98 });
  const curtainVelvetMat = standard("#6b0e24", { roughness: 0.82 });
  const stepLightMat = standard("#fde047", { emissive: "#eab308", emissiveIntensity: 1.8 });
  const cushionMat = standard("#a11d38", { roughness: 0.72 });
  const armMat = standard("#1e2029", { roughness: 0.65, metalness: 0.2 });

  // 1. Exterior Grand Entrance Staircase & Facade (z = -20m to -26m)
  const stairSteps = 10;
  const stairW = 11.0;
  const stairZStart = -20.0;
  const stairZEnd = -26.0;
  const stairH = 3.6;
  for (let i = 0; i < stairSteps; i++) {
    const stepZ = stairZStart + ((i + 0.5) / stairSteps) * (stairZEnd - stairZStart);
    const stepY = ((i + 0.5) / stairSteps) * stairH;
    const stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(stairW, 0.45, Math.abs(stairZEnd - stairZStart) / stairSteps + 0.1),
      concreteRiserMat,
    );
    stepMesh.position.set(0, stepY - 0.2, stepZ);
    stepMesh.receiveShadow = true;
    group.add(stepMesh);

    const runner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, Math.abs(stairZEnd - stairZStart) / stairSteps + 0.05),
      carpetRunnerMat,
    );
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, stepY + 0.035, stepZ);
    runner.receiveShadow = true;
    group.add(runner);
  }

  for (const side of [-1, 1]) {
    const railX = side * 5.6;
    for (let rz = -20.5; rz >= -25.5; rz -= 1.6) {
      const stepY = ((-20 - rz) / 6) * stairH;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 8), brassGoldMat);
      post.position.set(railX, stepY + 0.55, rz);
      group.add(post);
    }
    const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 7.2, 8), brassGoldMat);
    handrail.rotation.x = -Math.atan2(stairH, 6.0);
    handrail.position.set(railX, stairH / 2 + 0.95, -23.0);
    group.add(handrail);
  }

  // 2. Front Facade & Big Illuminated "CINEMA" Marquee Billboard at z = -26
  for (const side of [-1, 1]) {
    const facadeWall = new THREE.Mesh(new THREE.BoxGeometry(11.0, 12.2, 1.2), wallAcousticMat);
    facadeWall.position.set(side * 11.0, 6.1, -26.0);
    facadeWall.castShadow = facadeWall.receiveShadow = true;
    group.add(facadeWall);
    colliders.boxes.push({ x: side * 11.0, z: -26.0, hw: 5.5, hd: 0.6 });

    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12.2, 1.6), mahoganyTrimMat);
    pillar.position.set(side * 5.0, 6.1, -25.6);
    pillar.castShadow = true;
    group.add(pillar);
  }

  const archLintel = new THREE.Mesh(new THREE.BoxGeometry(11.2, 2.2, 1.6), mahoganyTrimMat);
  archLintel.position.set(0, 8.8, -25.6);
  archLintel.castShadow = true;
  group.add(archLintel);

  const marqueeCanvas = document.createElement("canvas");
  marqueeCanvas.width = 1024;
  marqueeCanvas.height = 256;
  const mCtx = marqueeCanvas.getContext("2d")!;
  mCtx.fillStyle = "#180910";
  mCtx.fillRect(0, 0, 1024, 256);

  mCtx.strokeStyle = "#eab308";
  mCtx.lineWidth = 8;
  mCtx.strokeRect(16, 16, 1024 - 32, 256 - 32);

  for (let bx = 28; bx <= 1024 - 28; bx += 32) {
    for (const by of [28, 256 - 28]) {
      mCtx.beginPath();
      mCtx.arc(bx, by, 7, 0, Math.PI * 2);
      mCtx.fillStyle = "#fef08a";
      mCtx.fill();
    }
  }
  for (let by = 28; by <= 256 - 28; by += 28) {
    for (const bx of [28, 1024 - 28]) {
      mCtx.beginPath();
      mCtx.arc(bx, by, 7, 0, Math.PI * 2);
      mCtx.fillStyle = "#fef08a";
      mCtx.fill();
    }
  }

  mCtx.textAlign = "center";
  mCtx.textBaseline = "middle";
  mCtx.font = "900 115px system-ui, -apple-system, sans-serif";
  mCtx.shadowColor = "#f59e0b";
  mCtx.shadowBlur = 24;
  mCtx.fillStyle = "#ffedd5";
  mCtx.fillText("C  I  N  E  M  A", 512, 128);
  mCtx.shadowBlur = 0;

  const marqueeTexture = new THREE.CanvasTexture(marqueeCanvas);
  marqueeTexture.colorSpace = THREE.SRGBColorSpace;

  const marqueeBox = new THREE.Mesh(new THREE.BoxGeometry(13.6, 3.4, 0.8), brassGoldMat);
  marqueeBox.position.set(0, 9.8, -24.8);
  marqueeBox.castShadow = true;
  group.add(marqueeBox);

  const marqueeFace = new THREE.Mesh(
    new THREE.PlaneGeometry(13.2, 3.0),
    new THREE.MeshBasicMaterial({ map: marqueeTexture }),
  );
  marqueeFace.position.set(0, 9.8, -24.38);
  group.add(marqueeFace);

  // 3. Fully Enclosed Walls & Acoustic Ceiling Roof
  const hallLen = Math.abs(CINEMA_HALL.minZ - CINEMA_HALL.maxZ);
  const midZ = (CINEMA_HALL.minZ + CINEMA_HALL.maxZ) / 2;
  const halfW = 16.5;

  for (const side of [-1, 1]) {
    const sideWallX = side * halfW;
    const outerSideWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12.2, hallLen), wallAcousticMat);
    outerSideWall.position.set(sideWallX, 6.1, midZ);
    outerSideWall.castShadow = outerSideWall.receiveShadow = true;
    group.add(outerSideWall);
    colliders.boxes.push({ x: sideWallX, z: midZ, hw: 0.6, hd: hallLen / 2 });

    for (let sz = -32; sz >= -68; sz -= 7) {
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.35, 11.5, 0.95), mahoganyTrimMat);
      pilaster.position.set(side * (halfW - 0.45), 5.8, sz);
      group.add(pilaster);

      const sconce = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), neonGoldMat);
      sconce.position.set(side * (halfW - 0.75), 4.8, sz);
      group.add(sconce);
    }
  }

  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 1.2, 12.2, 1.4), wallAcousticMat);
  frontWall.position.set(0, 6.1, -74.5);
  frontWall.castShadow = true;
  group.add(frontWall);
  colliders.boxes.push({ x: 0, z: -74.5, hw: halfW + 0.6, hd: 0.7 });

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 2.0, 0.9, hallLen + 1.5), ceilingAcousticMat);
  ceiling.position.set(0, 12.2, midZ);
  ceiling.castShadow = true;
  group.add(ceiling);

  for (let bz = -34; bz >= -68; bz -= 8) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 0.5, 0.65, 0.85), mahoganyTrimMat);
    beam.position.set(0, 11.75, bz);
    group.add(beam);
  }

  // 4. Stepped "Ladder" Stadium Seating Tiers
  const lobbyPromenade = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 2, 0.6, 6.0), concreteRiserMat);
  lobbyPromenade.position.set(0, 3.3, -29.0);
  lobbyPromenade.receiveShadow = true;
  group.add(lobbyPromenade);

  const lobbyCarpet = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2 - 2.5, 5.8), carpetAisleMat);
  lobbyCarpet.rotation.x = -Math.PI / 2;
  lobbyCarpet.position.set(0, 3.62, -29.0);
  lobbyCarpet.receiveShadow = true;
  group.add(lobbyCarpet);

  const tierSpecs: Array<{ tierIdx: number; y: number; z0: number; z1: number; seatZ: number }> = [
    { tierIdx: 5, y: 3.0, z0: -32.0, z1: -38.0, seatZ: -35.0 },
    { tierIdx: 4, y: 2.4, z0: -38.0, z1: -44.0, seatZ: -41.0 },
    { tierIdx: 3, y: 1.8, z0: -44.0, z1: -50.0, seatZ: -47.0 },
    { tierIdx: 2, y: 1.2, z0: -50.0, z1: -56.0, seatZ: -53.0 },
    { tierIdx: 1, y: 0.6, z0: -56.0, z1: -62.0, seatZ: -59.0 },
    { tierIdx: 0, y: 0.0, z0: -62.0, z1: -67.0, seatZ: -65.0 },
  ];

  for (const tier of tierSpecs) {
    const tierD = Math.abs(tier.z1 - tier.z0);
    const tierMidZ = (tier.z0 + tier.z1) / 2;

    if (tier.y > 0) {
      const riserMesh = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 2 - 2.0, tier.y, tierD),
        concreteRiserMat,
      );
      riserMesh.position.set(0, tier.y / 2, tierMidZ);
      riserMesh.receiveShadow = true;
      group.add(riserMesh);
    }

    const tierCarpet = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2 - 2.4, tierD - 0.1), carpetAisleMat);
    tierCarpet.rotation.x = -Math.PI / 2;
    tierCarpet.position.set(0, tier.y + 0.025, tierMidZ);
    tierCarpet.receiveShadow = true;
    group.add(tierCarpet);

    for (const ax of [-1.4, 1.4, -10.5, 10.5]) {
      const stepLight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.12), stepLightMat);
      stepLight.position.set(ax, tier.y + 0.15, tier.z0);
      group.add(stepLight);
    }
  }

  for (const tier of tierSpecs) {
    const tierD = Math.abs(tier.z1 - tier.z0);
    const tierMidZ = (tier.z0 + tier.z1) / 2;
    const aisleRunner = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tierD), carpetRunnerMat);
    aisleRunner.rotation.x = -Math.PI / 2;
    aisleRunner.position.set(0, tier.y + 0.035, tierMidZ);
    aisleRunner.receiveShadow = true;
    group.add(aisleRunner);
  }

  // 5. 60 Luxury Cinema Recliner Seats (batched into 5 InstancedMeshes -> 5 draw calls instead of 420)
  const seatGeo = new THREE.BoxGeometry(0.9, 0.16, 0.78);
  const backGeo = new THREE.BoxGeometry(0.9, 0.82, 0.16);
  const armGeo = new THREE.BoxGeometry(0.12, 0.38, 0.75);
  const cupGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8);
  const pedestalGeo = new THREE.CylinderGeometry(0.16, 0.24, 0.38, 8);

  const seatCount = CINEMA_HALL.seatCount;
  const pedInst = new THREE.InstancedMesh(pedestalGeo, armMat, seatCount);
  const cushionInst = new THREE.InstancedMesh(seatGeo, cushionMat, seatCount);
  const backInst = new THREE.InstancedMesh(backGeo, cushionMat, seatCount);
  const armInst = new THREE.InstancedMesh(armGeo, armMat, seatCount * 2);
  const cupInst = new THREE.InstancedMesh(cupGeo, brassGoldMat, seatCount * 2);
  const chairMat4 = new THREE.Matrix4();

  for (let i = 0; i < seatCount; i++) {
    const s = CINEMA_SEATS[i]!;
    const chairY = s.y ?? 0;
    pedInst.setMatrixAt(i, chairMat4.makeTranslation(s.x, chairY + 0.19, s.z));
    cushionInst.setMatrixAt(i, chairMat4.makeTranslation(s.x, chairY + 0.44, s.z));
    backInst.setMatrixAt(i, chairMat4.makeTranslation(s.x, chairY + 0.84, s.z + 0.32));
    armInst.setMatrixAt(i * 2, chairMat4.makeTranslation(s.x - 0.46, chairY + 0.58, s.z + 0.04));
    armInst.setMatrixAt(i * 2 + 1, chairMat4.makeTranslation(s.x + 0.46, chairY + 0.58, s.z + 0.04));
    cupInst.setMatrixAt(i * 2, chairMat4.makeTranslation(s.x - 0.46, chairY + 0.76, s.z - 0.25));
    cupInst.setMatrixAt(i * 2 + 1, chairMat4.makeTranslation(s.x + 0.46, chairY + 0.76, s.z - 0.25));
  }
  for (const inst of [pedInst, cushionInst, backInst, armInst, cupInst]) {
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // 6. Colossal Screen, Elevated Stage & Velvet Curtains
  const stageDeck = new THREE.Mesh(new THREE.BoxGeometry(26.0, 0.65, 5.5), concreteRiserMat);
  stageDeck.position.set(0, 0.325, -70.5);
  stageDeck.castShadow = stageDeck.receiveShadow = true;
  group.add(stageDeck);
  colliders.boxes.push({ x: 0, z: -70.5, hw: 13.0, hd: 2.75 });

  const stageCarpet = new THREE.Mesh(new THREE.PlaneGeometry(25.5, 5.2), carpetRunnerMat);
  stageCarpet.rotation.x = -Math.PI / 2;
  stageCarpet.position.set(0, 0.66, -70.5);
  stageCarpet.receiveShadow = true;
  group.add(stageCarpet);

  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CINEMA_HALL.screenWidth, CINEMA_HALL.screenHeight),
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
  );
  screenMesh.position.set(0, CINEMA_HALL.screenY, CINEMA_HALL.screenZ);
  group.add(screenMesh);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(CINEMA_HALL.screenWidth + 0.6, CINEMA_HALL.screenHeight + 0.6, 0.12),
    neonBlueMat,
  );
  trim.position.set(0, CINEMA_HALL.screenY, CINEMA_HALL.screenZ - 0.08);
  group.add(trim);

  for (const side of [-1, 1]) {
    const drape = new THREE.Mesh(new THREE.BoxGeometry(4.2, 10.5, 0.8), curtainVelvetMat);
    drape.position.set(side * 13.2, 6.2, -71.8);
    drape.castShadow = true;
    group.add(drape);
  }
  const topValance = new THREE.Mesh(new THREE.BoxGeometry(28.0, 1.4, 0.8), curtainVelvetMat);
  topValance.position.set(0, 11.4, -71.8);
  group.add(topValance);

  const screenLight = new THREE.PointLight("#5b8def", 4.5, 34, 1.45);
  screenLight.position.set(0, CINEMA_HALL.screenY, -64.0);
  group.add(screenLight);

  scene.add(group);

  createNoticeBoard(scene, colliders, {
    x: -8.8,
    z: -19.5,
    yaw: 0,
    title: "GRAND CINEMA HALL",
    lines: [
      "Climb stairs & enter the Grand Cinema Hall",
      "Seats step down high to low (ladder tiers) - Press E to sit",
      "1st inside is Host & pastes video/YT link · Press F to expand",
    ],
  });

  return { screenMesh, screenLight };
}

function addBuildings(
  scene: THREE.Scene,
  colliders: Colliders,
  windowMaterials: THREE.MeshStandardMaterial[],
) {
  const specs: Array<[number, number, number, number, number]> = [
    [22, -22, 11, 9, 9],
    [40, -18, 9, 9, 13],
    [-22, -22, 10, 10, 8],
    [-40, -18, 10, 8, 11],
    [22, 22, 11, 9, 8],
    [40, 18, 9, 10, 12],
    [-22, 22, 10, 9, 9],
    [-40, 18, 11, 8, 7],
  ];
  const winMat = standard("#28364d", { emissive: "#ffd98a", emissiveIntensity: 0.15, flatShading: false });
  windowMaterials.push(winMat);

  const winGeo = new THREE.PlaneGeometry(1.2, 1.6);
  const winMatrices: THREE.Matrix4[] = [];
  const winPos = new THREE.Vector3();
  const winQuat = new THREE.Quaternion();
  const winScale = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);

  specs.forEach(([x, z, w, d, h], i) => {
    const color = PALETTE.buildings[i % PALETTE.buildings.length]!;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), standard(color));
    body.position.set(x, h / 2, z);
    body.castShadow = body.receiveShadow = true;
    scene.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.5, d + 0.8), standard(PALETTE.roof));
    roof.position.set(x, h + 0.25, z);
    roof.castShadow = true;
    scene.add(roof);

    const facing = Math.abs(x) > Math.abs(z) ? "x" : "z";
    const rows = Math.max(1, Math.floor(h / 3));
    const cols = Math.max(2, Math.floor((facing === "x" ? d : w) / 2.5));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const along = (c - (cols - 1) / 2) * 2.5;
        const y = 2 + r * 3;
        let rotY = 0;
        if (facing === "x") {
          const side = x > 0 ? -1 : 1;
          winPos.set(x + side * (w / 2 + 0.01), y, z + along);
          rotY = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          const side = z > 0 ? -1 : 1;
          winPos.set(x + along, y, z + side * (d / 2 + 0.01));
          rotY = side > 0 ? 0 : Math.PI;
        }
        winQuat.setFromAxisAngle(yAxis, rotY);
        winMatrices.push(new THREE.Matrix4().compose(winPos, winQuat, winScale));
      }
    }

    colliders.boxes.push({ x, z, hw: w / 2, hd: d / 2 });
  });

  if (winMatrices.length > 0) {
    const winInst = new THREE.InstancedMesh(winGeo, winMat, winMatrices.length);
    for (let i = 0; i < winMatrices.length; i++) {
      winInst.setMatrixAt(i, winMatrices[i]!);
    }
    winInst.instanceMatrix.needsUpdate = true;
    scene.add(winInst);
  }
}

function addCityAndForestTrees(scene: THREE.Scene, colliders: Colliders) {
  const rand = mulberry32(20261029);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.8, 7);
  const banyanTrunkGeo = new THREE.CylinderGeometry(0.28, 0.45, 2.2, 7);
  const fallenLogGeo = new THREE.CylinderGeometry(0.32, 0.36, 2.8, 8);
  const vineGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5);
  const fernGeo = new THREE.ConeGeometry(0.65, 0.75, 5);
  const bushGeo = new THREE.DodecahedronGeometry(0.55, 1);
  const berryGeo = new THREE.SphereGeometry(0.15, 6, 6);
  const stemGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.28, 6);
  const capGeo = new THREE.ConeGeometry(0.22, 0.18, 7);

  const trunkMat = standard(PALETTE.trunk);
  const birchMat = standard(PALETTE.birchTrunk);
  const leafGeos = [
    new THREE.ConeGeometry(1.55, 2.9, 7),
    new THREE.ConeGeometry(1.25, 2.4, 7),
    new THREE.DodecahedronGeometry(1.65, 1),
  ];
  const leafMats = PALETTE.leaves.map((c) => standard(c));
  const vineMat = standard("#4d7c0f");
  const berryMat = standard("#e63946", { emissive: "#b91c1c", emissiveIntensity: 0.35 });
  const mushroomCapMat = standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 1.4 });
  const mushroomPurpleMat = standard("#c084fc", { emissive: "#9333ea", emissiveIntensity: 1.4 });
  const stemMat = standard("#f1f5f9");

  // Batched InstancedMesh buckets so 340 trees render in ~25 draw calls instead of ~900+.
  const trunkMatrices: THREE.Matrix4[] = [];
  const birchMatrices: THREE.Matrix4[] = [];
  const banyanTrunkMatrices: THREE.Matrix4[] = [];
  const fallenLogMatrices: THREE.Matrix4[] = [];
  const vineMatrices: THREE.Matrix4[] = [];
  const fernMatrices: THREE.Matrix4[] = [];
  const bushMatrices: THREE.Matrix4[] = [];
  const berryMatrices: THREE.Matrix4[] = [];
  const stemMatrices: THREE.Matrix4[] = [];
  const capBlueMatrices: THREE.Matrix4[] = [];
  const capPurpleMatrices: THREE.Matrix4[] = [];
  const leafBuckets: THREE.Matrix4[][][] = leafGeos.map(() => leafMats.map(() => []));

  const treeMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const treePos = new THREE.Vector3();
  const treeQuat = new THREE.Quaternion();
  const treeScale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const localPos = new THREE.Vector3();
  const localQuat = new THREE.Quaternion();
  const localScale = new THREE.Vector3();
  const logQuat = new THREE.Quaternion().setFromAxisAngle(zAxis, Math.PI / 2);

  const pushPart = (
    bucket: THREE.Matrix4[],
    lx: number,
    ly: number,
    lz: number,
    sx = 1,
    sy = 1,
    sz = 1,
    quat?: THREE.Quaternion,
  ) => {
    localPos.set(lx, ly, lz);
    localScale.set(sx, sy, sz);
    localMatrix.compose(localPos, quat ?? localQuat, localScale);
    bucket.push(new THREE.Matrix4().multiplyMatrices(treeMatrix, localMatrix));
  };

  let placed = 0;
  let attempts = 0;
  while (placed < 340 && attempts < 2800) {
    attempts++;
    const inSouthForest = placed >= 48;
    const x = inSouthForest ? (rand() * 2 - 1) * 145 : (rand() * 2 - 1) * 95;
    const z = inSouthForest ? 42 + rand() * 155 : (rand() * 2 - 1) * 85;

    const distOrigin = Math.hypot(x, z);
    if (distOrigin < 18) continue;
    if (distOrigin > 27 && distOrigin < 36) continue;
    if (Math.abs(x) < 4.8 && z > -40 && z < 78) continue;
    if (Math.abs(z) < 5 && Math.abs(x) < 70) continue;
    if (z < -30 && Math.abs(x) < 35) continue;
    if (Math.abs(x - FOOTBALL_STADIUM.centerX) < 26 && Math.abs(z) < 20) continue;
    if (x > ARCADE_HALL.minX - 3 && x < ARCADE_HALL.maxX + 3 && z > ARCADE_HALL.minZ - 3 && z < ARCADE_HALL.maxZ + 3) continue;
    if (Math.hypot(x - CAMPFIRE_BASE.x, z - CAMPFIRE_BASE.z) < 14.5) continue;
    if (Math.abs(x) < 5.8 && z >= 68 && z <= HAUNTED_GATE.z + 2) continue;
    if (
      Math.abs(x - HAUNTED_GATE.x) < 22 &&
      z > HAUNTED_GATE.z - 8 &&
      z < HAUNTED_GATE.z + 12
    ) {
      continue;
    }
    if (Math.abs(z - 112) < 6.5) continue;

    if (colliders.boxes.some((b) => Math.abs(x - b.x) < b.hw + 2.2 && Math.abs(z - b.z) < b.hd + 2.2)) continue;
    if (colliders.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.6)) continue;

    const scale = inSouthForest ? 1.0 + rand() * 1.15 : 0.8 + rand() * 0.65;
    const speciesRoll = inSouthForest ? placed % 5 : placed % 2;
    const yaw = rand() * Math.PI * 2;

    treePos.set(x, 0, z);
    treeQuat.setFromAxisAngle(yAxis, yaw);
    treeScale.setScalar(scale);
    treeMatrix.compose(treePos, treeQuat, treeScale);

    if (speciesRoll === 0) {
      pushPart(trunkMatrices, 0, 0.9, 0);
      pushPart(leafBuckets[0]![placed % leafMats.length]!, 0, 2.6, 0);
      pushPart(leafBuckets[1]![(placed + 1) % leafMats.length]!, 0, 3.9, 0);
    } else if (speciesRoll === 1) {
      pushPart(trunkMatrices, 0, 0.9, 0);
      pushPart(leafBuckets[2]![(placed + 2) % leafMats.length]!, 0, 2.9, 0);
      pushPart(leafBuckets[2]![(placed + 3) % leafMats.length]!, 0.85, 2.4, 0.4, 0.72, 0.72, 0.72);
    } else if (speciesRoll === 2) {
      pushPart(banyanTrunkMatrices, 0, 1.1, 0);
      pushPart(leafBuckets[2]![5]!, 0, 3.1, 0, 1.35, 0.85, 1.35);
      pushPart(vineMatrices, -0.9, 1.9, 0.5);
      pushPart(vineMatrices, 0.9, 1.9, 0.5);
    } else if (speciesRoll === 3) {
      pushPart(birchMatrices, 0, 0.9, 0);
      pushPart(leafBuckets[1]![4]!, 0, 2.8, 0);
    } else {
      pushPart(fallenLogMatrices, 0, 0.3, 0, 1, 1, 1, logQuat);
    }

    if (inSouthForest) {
      if (placed % 4 === 0) {
        pushPart(fernMatrices, 0.95, 0.35, -0.5);
      }
      if (placed % 6 === 0) {
        pushPart(bushMatrices, 1.1, 0.35, 0.4);
        pushPart(berryMatrices, 1.1, 0.75, 0.55);
      }
      if (placed % 5 === 0) {
        pushPart(stemMatrices, -0.85, 0.14, 0.65);
        pushPart(placed % 10 === 0 ? capPurpleMatrices : capBlueMatrices, -0.85, 0.3, 0.65);
      }
    }

    colliders.circles.push({ x, z, r: 0.36 * scale });
    placed++;
  }

  const flushInstanced = (geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[]) => {
    if (matrices.length === 0) return;
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    inst.castShadow = false;
    inst.receiveShadow = false;
    for (let i = 0; i < matrices.length; i++) {
      inst.setMatrixAt(i, matrices[i]!);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  };

  flushInstanced(trunkGeo, trunkMat, trunkMatrices);
  flushInstanced(trunkGeo, birchMat, birchMatrices);
  flushInstanced(banyanTrunkGeo, trunkMat, banyanTrunkMatrices);
  flushInstanced(fallenLogGeo, trunkMat, fallenLogMatrices);
  flushInstanced(vineGeo, vineMat, vineMatrices);
  flushInstanced(fernGeo, leafMats[2]!, fernMatrices);
  flushInstanced(bushGeo, leafMats[0]!, bushMatrices);
  flushInstanced(berryGeo, berryMat, berryMatrices);
  flushInstanced(stemGeo, stemMat, stemMatrices);
  flushInstanced(capGeo, mushroomCapMat, capBlueMatrices);
  flushInstanced(capGeo, mushroomPurpleMat, capPurpleMatrices);

  for (let gIdx = 0; gIdx < leafGeos.length; gIdx++) {
    for (let mIdx = 0; mIdx < leafMats.length; mIdx++) {
      flushInstanced(leafGeos[gIdx]!, leafMats[mIdx]!, leafBuckets[gIdx]![mIdx]!);
    }
  }
}
