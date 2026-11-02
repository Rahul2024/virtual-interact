import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  ARCADE_ZONE,
  BRICK_DUNGEON,
  CAMPFIRE_BASE,
  CINEMA_HALL,
  CINEMA_SEATS,
  FOOTBALL_STADIUM,
  GRAFFITI_MURAL,
  OPEN_MIC_STAGE,
  SOCIAL_ZONE,
  WORLD,
  getCinemaFloorY,
  getDungeonFloorY,
  getWorldFloorY,
  getIndianHourFloat,
} from "@vi/shared";
import { Colliders } from "./collision";

export type TimeMode = "ist" | "day" | "sunset" | "night";

/**
 * Everything the dungeon rig needs to draw the current server state.
 * Named fields on purpose: an earlier positional version of this call had
 * its arguments in the wrong order, and TypeScript cannot tell two numbers apart.
 */
export interface DungeonView {
  dungeonWing: number;
  dungeonSeed: number;
  grimoireFound: number;
  gateLeftOpen: number;
  gateRightOpen: number;
  vaultUnlocked: number;
  arrowVolleyZ: number;
  fireBoulderZ: number;
  /** Bitmask of Floor-2 web curtains already burned (bit 0 = web 1). */
  websBurned: number;
  /** Bitmask of mimic chests currently chomping someone (bit 0 = chest 1). */
  chompingChests: number;
  nowMs: number;
}

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
  screenMesh: THREE.Mesh;
  screenLight: THREE.PointLight;
  muralCanvas: HTMLCanvasElement;
  muralTexture: THREE.CanvasTexture;
  timeMode: TimeMode;
  isNight: boolean;
  setScreenTexture(tex: THREE.Texture, accentColor?: string): void;
  setFootballState(ballX: number, ballZ: number, scoreRed: number, scoreBlue: number): void;
  setDungeonState(view: DungeonView): void;
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelContainer });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyDay);
  scene.fog = new THREE.Fog(PALETTE.skyDay, 75, 235);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 480);
  camera.position.set(0, 6, 12);

  const colliders = new Colliders();
  const lampHeads: THREE.Mesh[] = [];
  const streetLights: THREE.PointLight[] = [];
  const windowMaterials: THREE.MeshStandardMaterial[] = [];

  const { hemi, sun, moonGroup, stars } = addAtmosphereAndLights(scene);
  addGroundAndRingRoad(scene);
  addPlaza(scene, colliders, lampHeads, streetLights);
  addOpenSocialZoneRing(scene);
  addAvenues(scene, colliders, lampHeads, streetLights);

  // North District: Cinema Hall, Open-Mic Stage, and Shared Pixel Graffiti Mural
  const { screenMesh, screenLight } = addCinemaHall(scene, colliders);
  addOpenMicStage(scene, colliders);
  const { muralCanvas, muralTexture, drawPixel, drawAllPixels } = addGraffitiMuralWall(scene, colliders);

  // West District: Team Football (Soccer) Stadium
  const { ballMesh, updateFootballBoard } = addFootballStadium(scene, colliders);

  // East District: Multiplayer Neon Arcade Plaza
  addArcadePlaza(scene, colliders);

  // South District: Foothill Ridge, Deep Campfire Valley, Dunes, Insects & Frieren Square Stone-Brick Dungeon
  const { campfireLight, flameGroup, fireflies, dragonflies } = addCampfireAndForestWilderness(scene, colliders);
  const dungeonRig = addFrierenBrickDungeon(scene, colliders);

  addBuildings(scene, colliders, windowMaterials);
  addCityAndForestTrees(scene, colliders);

  const animalEntries = new Map<string, AnimalMeshEntry>();
  let lastScoreRed = -1;
  let lastScoreBlue = -1;

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
    screenMesh,
    screenLight,
    muralCanvas,
    muralTexture,
    timeMode: "ist",
    isNight: false,
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
      dungeonRig.update(view);
    },
    syncAnimals(animals: AnimalRenderState[]) {
      const now = performance.now();
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
        entry.group.visible = a.hp > 0;
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
      flameGroup.scale.y = 0.92 + Math.sin(tSec * 11) * 0.12 + Math.cos(tSec * 17) * 0.06;
      flameGroup.rotation.y = tSec * 1.5;

      // Animate forest fireflies & river dragonflies
      fireflies.position.y = Math.sin(tSec * 1.8) * 0.35;
      fireflies.rotation.y = Math.sin(tSec * 0.15) * 0.08;
      dragonflies.forEach((df, i) => {
        const angle = tSec * 1.9 + i * 1.3;
        df.position.x = df.userData.homeX + Math.cos(angle) * 3.8;
        df.position.z = df.userData.homeZ + Math.sin(angle * 1.4) * 2.2;
        df.position.y = 0.85 + Math.sin(tSec * 6 + i) * 0.22;
        df.rotation.y = -angle;
      });

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

      const skyColor = new THREE.Color();
      if (nightFactor <= 0.5) {
        skyColor.lerpColors(new THREE.Color(PALETTE.skyDay), new THREE.Color(PALETTE.skySunset), nightFactor * 2);
      } else {
        skyColor.lerpColors(new THREE.Color(PALETTE.skySunset), new THREE.Color(PALETTE.skyNight), (nightFactor - 0.5) * 2);
      }
      scene.background = skyColor;
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.copy(skyColor);
        scene.fog.near = THREE.MathUtils.lerp(80, 44, nightFactor);
        scene.fog.far = THREE.MathUtils.lerp(245, 160, nightFactor);
      }

      sun.intensity = THREE.MathUtils.lerp(2.2, 0.22, nightFactor);
      sun.color.set(nightFactor > 0.3 && nightFactor < 0.8 ? "#ff9e66" : nightFactor >= 0.8 ? "#6b8cff" : "#fff4e0");
      hemi.intensity = THREE.MathUtils.lerp(0.9, 0.26, nightFactor);

      moonGroup.visible = nightFactor > 0.25;
      stars.visible = nightFactor > 0.35;

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
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
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
    if (i % 2 === 0) addLamp(scene, colliders, x, z, lampHeads, streetLights, true);
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
    [5, -26, true],
    [-5, -26, false],
    [5, 26, true],
    [-5, 26, false],
    [-35, 4, true],
    [-35, -4, false],
    [35, 4, true],
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

function addArcadePlaza(scene: THREE.Scene, colliders: Colliders) {
  const cx = ARCADE_ZONE.centerX;
  const cz = ARCADE_ZONE.centerZ;
  const g = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(14, 32),
    standard("#1e1b2e", { emissive: "#3b1d5e", emissiveIntensity: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.025, cz);
  floor.receiveShadow = true;
  g.add(floor);

  const arcadeColors = ["#a66ce8", "#4fc3d9", "#f28ac9", "#6fcf7a"];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ax = cx + Math.cos(a) * 6.5;
    const az = cz + Math.sin(a) * 6.5;
    const col = arcadeColors[i]!;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 2.3, 1.2),
      standard("#1a1d29", { emissive: col, emissiveIntensity: 0.45 }),
    );
    cab.position.set(ax, 1.15, az);
    cab.castShadow = true;
    g.add(cab);
    colliders.circles.push({ x: ax, z: az, r: 1.0 });
  }

  scene.add(g);

  createNoticeBoard(scene, colliders, {
    x: cx - 12.5,
    z: cz - 5.5,
    yaw: -Math.PI / 2,
    title: "ARCADE PLAZA",
    lines: [
      "Walk inside & press E to open Arcade Games",
      "Play 2-Player Connect 4 & Tic-Tac-Toe",
      "Compete on the live Speed Trivia board",
    ],
  });
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
    // Keep rock peaks clear of the dungeon hallway (|x| < 23, z 120..480):
    // a peak at (0, 224) used to block the Floor 1 → 2 staircase entirely.
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

  // Winding Forest River at z = +112 with Three Bridges (leading to Ruins & Mountain Cave)
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
  for (let i = 0; i < ffCount; i++) {
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
      "Cross the south bridge to the King's Tomb Brick Dungeon",
    ],
  });

  return { campfireLight, flameGroup, fireflies, dragonflies };
}

/**
 * Frieren: Beyond Journey's End–Style Square Stone-Brick Hallway Dungeon ("Ruins of the King's Tomb"):
 * Located at `x = -22..+22, z = +120..+480` across the central forest river bridge.
 * Built as a 360-meter-long, continuous ascending 4-Floor Stone-Brick Hallway Dungeon
 * (`y = 0m -> +6m -> +12m -> +18m`) themed after the 3 Elemental Heads of the Final Boss:
 * - Floor 1 (`z = 120..210`, `y = 0m` — ❄️ Ice Head): Flooded ice-water canal, slippery ice stepping stones,
 *   West/East raised brick side-walkways, waterfall wall grates, frost arrow volleys, T-junction levers,
 *   3 Mimic/Grimoire chests, and the secret sliding brick bookcase wall.
 * - Floor 2 (`z = 226..316`, `y = +6m` — 🔥 Fire Head): Crimson-ember hallway with magma trenches,
 *   3 sticky Cinder-Spider web curtains (burnable with a Torch), swinging molten pendulum blades,
 *   and a rolling fire-boulder.
 * - Floor 3 (`z = 332..404`, `y = +12m` — 🌑 Shadow Head): Shadow-mana chasm bridge & outer catwalks,
 *   parallel iron-bar corridors, loose brick switches, portcullis gates, and prowling Shadow Wolves.
 * - Floor 4 (`z = 420..480`, `y = +18m` — 👑 3-Faced Dire Wolf Sanctum): Vaulted boss arena,
 *   Golden Royal Vault, and Waterfall Escape Slide back to Floor 1.
 */
function addFrierenBrickDungeon(scene: THREE.Scene, colliders: Colliders) {
  const cx = BRICK_DUNGEON.centerX;
  const startZ = BRICK_DUNGEON.startZ;
  const endZ = BRICK_DUNGEON.endZ;
  const hw = BRICK_DUNGEON.halfW;
  const bossHw = BRICK_DUNGEON.bossHalfW;

  const g = new THREE.Group();

  // PBR Stone-Brick & Flagstone Materials with 3D Bump Map relief
  const wallBrickMat = createBrickPBRMaterial({ repeatX: 28, repeatY: 3, mossy: true, bumpScale: 0.095 });
  const shortWallBrickMat = createBrickPBRMaterial({ repeatX: 4, repeatY: 3, mossy: true, bumpScale: 0.09 });
  const iceFloorMat = createBrickPBRMaterial({
    repeatX: 8,
    repeatY: 22,
    baseColor: "#2c3d4f",
    mossy: true,
    bumpScale: 0.065,
  });
  const fireFloorMat = createBrickPBRMaterial({
    repeatX: 8,
    repeatY: 22,
    baseColor: "#422826",
    bumpScale: 0.075,
  });
  const shadowFloorMat = createBrickPBRMaterial({
    repeatX: 8,
    repeatY: 18,
    baseColor: "#28213b",
    bumpScale: 0.07,
  });
  const bossFloorMat = createBrickPBRMaterial({
    repeatX: 10,
    repeatY: 16,
    baseColor: "#332940",
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

  // Helper to build a continuous stone-brick hallway enclosure for a floor segment
  const addHallwaySegment = (
    z0: number,
    z1: number,
    y0: number,
    segHalfW: number,
    floorMat: THREE.Material,
    sconceColor: string,
    hasFloor = true,
  ) => {
    const segLen = z1 - z0;
    const segMidZ = (z0 + z1) / 2;

    if (hasFloor) {
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(segHalfW * 2 + 2, segLen + 1.5), floorMat);
      fl.rotation.x = -Math.PI / 2;
      fl.position.set(cx, y0 + 0.028, segMidZ);
      fl.receiveShadow = true;
      g.add(fl);
    }

    const ceil = new THREE.Mesh(new THREE.BoxGeometry(segHalfW * 2 + 2.8, 1.2, segLen + 1.5), wallBrickMat);
    ceil.position.set(cx, y0 + 6.9, segMidZ);
    ceil.castShadow = true;
    g.add(ceil);

    for (const side of [-1, 1]) {
      const wallX = cx + side * (segHalfW + 0.9);
      const outerWall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 7.0, segLen + 1.5), wallBrickMat);
      outerWall.position.set(wallX, y0 + 3.5, segMidZ);
      outerWall.castShadow = outerWall.receiveShadow = true;
      g.add(outerWall);
      colliders.boxes.push({ x: wallX, z: segMidZ, hw: 0.9, hd: segLen / 2 });
    }

    // Rectangular Stone-Brick Pilasters, Overhead Vault Ribs & Elemental Sconces
    for (let z = z0 + 6; z <= z1 - 4; z += 12) {
      const overheadRib = new THREE.Mesh(new THREE.BoxGeometry(segHalfW * 2, 0.7, 0.9), shortWallBrickMat);
      overheadRib.position.set(cx, y0 + 6.0, z);
      g.add(overheadRib);

      for (const side of [-1, 1]) {
        const pilaster = new THREE.Mesh(new THREE.BoxGeometry(1.1, 6.2, 0.95), shortWallBrickMat);
        pilaster.position.set(cx + side * (segHalfW - 0.55), y0 + 3.1, z);
        g.add(pilaster);

        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.25), ironMat);
        bracket.position.set(cx + side * (segHalfW - 0.15), y0 + 3.6, z);
        const flameOrb = new THREE.Mesh(
          new THREE.ConeGeometry(0.22, 0.48, 6),
          standard(sconceColor, { emissive: sconceColor, emissiveIntensity: 2.1 }),
        );
        flameOrb.position.set(cx + side * (segHalfW - 0.25), y0 + 3.95, z);
        g.add(bracket, flameOrb);
      }

      if ((z - z0) % 24 === 6) {
        const sconceLight = new THREE.PointLight(sconceColor, 2.9, 26, 1.4);
        sconceLight.position.set(cx, y0 + 4.6, z);
        g.add(sconceLight);
      }
    }
  };

  // Helper to build a grand ascending stone-brick staircase between floors
  const addAscendingStaircase = (z0: number, z1: number, y0: number, y1: number, tintColor: string) => {
    const steps = 16;
    const stepD = (z1 - z0) / steps;
    const stepH = (y1 - y0) / steps;
    for (let i = 0; i < steps; i++) {
      const sz = z0 + (i + 0.5) * stepD;
      const sy = y0 + (i + 0.5) * stepH;
      const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 - 2, stepH + 0.35, stepD + 0.15), intactSlabMat);
      stepMesh.position.set(cx, sy - 0.15, sz);
      stepMesh.receiveShadow = true;
      g.add(stepMesh);
    }
    for (const side of [-1, 1]) {
      const wallX = cx + side * (hw + 0.9);
      const stairWall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 12.5, z1 - z0 + 2), wallBrickMat);
      stairWall.position.set(wallX, (y0 + y1) / 2 + 3.5, (z0 + z1) / 2);
      g.add(stairWall);
      colliders.boxes.push({ x: wallX, z: (z0 + z1) / 2, hw: 0.9, hd: (z1 - z0) / 2 });
    }
    const stairCeil = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2.8, 1.2, z1 - z0 + 2), wallBrickMat);
    stairCeil.position.set(cx, y1 + 6.9, (z0 + z1) / 2);
    g.add(stairCeil);

    const stairLight = new THREE.PointLight(tintColor, 2.6, 22, 1.4);
    stairLight.position.set(cx, (y0 + y1) / 2 + 4.2, (z0 + z1) / 2);
    g.add(stairLight);
  };

  // =========================================================================
  // FLOOR 1 (z = 120..210, y = 0m — ❄️ ICE HEAD THEME: Frost-Fang Aqueduct)
  // =========================================================================
  addHallwaySegment(120, 210, 0, hw, iceFloorMat, "#38bdf8", true);

  // Grand Stone-Brick Entrance Archway at z = 120
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(6.4, 7.2, 2.4), shortWallBrickMat);
    pillar.position.set(cx + side * 12.2, 3.6, startZ);
    pillar.castShadow = pillar.receiveShadow = true;
    g.add(pillar);
    colliders.boxes.push({ x: cx + side * 12.2, z: startZ, hw: 3.2, hd: 1.2 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 3.2, 1.8, 2.6), shortWallBrickMat);
  lintel.position.set(cx, 6.6, startZ);
  g.add(lintel);

  // Flooded Underground Ice-Water Canal (z = 132..172)
  const canalWater = new THREE.Mesh(
    new THREE.BoxGeometry(20.8, 0.18, 40),
    standard("#0284c7", { emissive: "#0369a1", emissiveIntensity: 0.65, roughness: 0.2 }),
  );
  canalWater.position.set(cx, 0.08, 152);
  g.add(canalWater);

  // Central Slippery Ice Stepping-Stones across the Flooded Canal (|x| <= 2.9)
  for (let sz = 134; sz <= 170; sz += 4) {
    const iceStone = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.5, 0.32, 8), iceCrystalMat);
    iceStone.position.set(cx, 0.16, sz);
    g.add(iceStone);
  }

  // West & East Raised Stone-Brick Side-Walkways (|x| >= 10.8) flanking the canal
  for (const side of [-1, 1]) {
    const walkway = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.55, 42), intactSlabMat);
    walkway.position.set(cx + side * 14.6, 0.28, 152);
    walkway.receiveShadow = true;
    g.add(walkway);
  }

  // Waterfalls pouring from Wall Grates & Dripping Ceiling Icicles at z = 138, 152, 166
  // The curtain is drawn where the drip actually douses torches (one side per row).
  BRICK_DUNGEON.grateZs.forEach((wz, gi) => {
    const dripX = cx + (gi % 2 === 1 ? 1 : -1) * BRICK_DUNGEON.grateDripX;
    const waterfallCurtain = new THREE.Mesh(
      new THREE.BoxGeometry(BRICK_DUNGEON.grateDripHalfW * 2, 6.2, 0.55),
      new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.42 }),
    );
    waterfallCurtain.position.set(dripX, 3.1, wz);
    g.add(waterfallCurtain);

    for (let ix = -8; ix <= 8; ix += 4) {
      const icicle = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.3, 6), iceCrystalMat);
      icicle.rotation.x = Math.PI;
      icicle.position.set(cx + ix, 5.8, wz);
      g.add(icicle);
    }
  });

  // Cracked Frost-Slab Booby Traps
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

  // Sweeping Frost-Arrow Volley Bar
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

  // T-Junction Iron Wall Levers & Shifting Brick Partition at z = 186..190
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

  // 3-Chest Frost Mimic Alcove at z = 201.5 & Secret Sliding Brick Bookcase at z = 210
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

  // STAIRCASE 1 -> 2 (z = 210..226, y = 0m -> +6.0m)
  addAscendingStaircase(
    BRICK_DUNGEON.stairs1StartZ,
    BRICK_DUNGEON.stairs1EndZ,
    0,
    BRICK_DUNGEON.floor2Y,
    "#38bdf8",
  );

  // =========================================================================
  // FLOOR 2 (z = 226..316, y = +6.0m — 🔥 FIRE HEAD THEME: Ember & Spider-Web Hallway)
  // =========================================================================
  const y2 = BRICK_DUNGEON.floor2Y;
  addHallwaySegment(226, 316, y2, hw, fireFloorMat, "#f97316", true);

  // Glowing Magma Side Trenches & West/East Raised Stone-Brick Galleries
  for (const side of [-1, 1]) {
    const lavaStrip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 84), magmaMat);
    lavaStrip.position.set(cx + side * 8.6, y2 + 0.08, 271);
    g.add(lavaStrip);

    const sideGallery = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.4, 84), intactSlabMat);
    sideGallery.position.set(cx + side * 14.5, y2 + 0.2, 271);
    g.add(sideGallery);
  }

  // 3 Sticky Cinder-Spider Web Curtains at z = 238, 256, 274 (burnable with Torch!)
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
    // Only the centre lane is webbed; the galleries past webHalfW stay clear.
    const mainSheet = new THREE.Mesh(new THREE.PlaneGeometry(BRICK_DUNGEON.webHalfW * 2, 5.8), webMat);
    mainSheet.position.y = 2.9;
    webGroup.add(mainSheet);
    for (let a = 0; a < 6; a++) {
      const strand = new THREE.Mesh(new THREE.BoxGeometry(BRICK_DUNGEON.webHalfW * 2 + 0.6, 0.08, 0.08), webMat);
      strand.position.y = 3.0;
      strand.rotation.z = (a / 6) * Math.PI;
      webGroup.add(strand);
    }
    g.add(webGroup);
    webMeshes.push(webGroup);
  });

  // 3 Swinging Molten Pendulum Scythe Blades at z = 262, 278, 294
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

  // Rolling Fire-Boulder in the Central Groove (z = 280..314)
  const fireBoulderMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(BRICK_DUNGEON.boulderRadius, 1), magmaMat);
  fireBoulderMesh.position.set(cx, y2 + BRICK_DUNGEON.boulderRadius, BRICK_DUNGEON.boulderEndZ);
  fireBoulderMesh.castShadow = true;
  g.add(fireBoulderMesh);

  // STAIRCASE 2 -> 3 (z = 316..332, y = +6.0m -> +12.0m)
  addAscendingStaircase(
    BRICK_DUNGEON.stairs2StartZ,
    BRICK_DUNGEON.stairs2EndZ,
    BRICK_DUNGEON.floor2Y,
    BRICK_DUNGEON.floor3Y,
    "#f97316",
  );

  // =========================================================================
  // FLOOR 3 (z = 332..404, y = +12.0m — 🌑 SHADOW HEAD THEME: Chasm & Wolf Den)
  // =========================================================================
  const y3 = BRICK_DUNGEON.floor3Y;
  addHallwaySegment(332, 340, y3, hw, shadowFloorMat, "#a855f7", true);
  addHallwaySegment(340, 368, y3, hw, shadowFloorMat, "#a855f7", false);
  addHallwaySegment(368, 404, y3, hw, shadowFloorMat, "#a855f7", true);

  // Bottomless Shadow-Mana Chasm (z = 340..368) with Central Stone Bridge & Outer Catwalks
  const chasmVoid = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 28), shadowVoidMat);
  chasmVoid.rotation.x = -Math.PI / 2;
  chasmVoid.position.set(cx, y3 - 3.5, 354);
  g.add(chasmVoid);

  const centralBridge = new THREE.Mesh(new THREE.BoxGeometry(BRICK_DUNGEON.chasmBridgeHalfW * 2, 0.45, 29), intactSlabMat);
  centralBridge.position.set(cx, y3 + 0.15, 354);
  centralBridge.receiveShadow = true;
  g.add(centralBridge);

  for (const side of [-1, 1]) {
    const outerCatwalk = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.45, 29), intactSlabMat);
    outerCatwalk.position.set(cx + side * 14.6, y3 + 0.15, 354);
    outerCatwalk.receiveShadow = true;
    g.add(outerCatwalk);
  }

  // Parallel Iron-Bar Corridors (z = 372..392), Loose Brick Switches (z = 382) & Portcullis Gates (z = 388)
  for (let z = BRICK_DUNGEON.ironBarsStartZ; z <= BRICK_DUNGEON.ironBarsEndZ; z += 1.4) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6.2, 8), ironMat);
    bar.position.set(cx, y3 + 3.1, z);
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
  looseBrickWest.position.set(cx - hw + 0.45, y3 + 1.6, BRICK_DUNGEON.switchZ);
  const looseBrickEast = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.95), switchMat);
  looseBrickEast.position.set(cx + hw - 0.45, y3 + 1.6, BRICK_DUNGEON.switchZ);
  g.add(looseBrickWest, looseBrickEast);

  // Each gate fills its half of the hallway, x from gateInnerX out to the wall.
  const gateW = hw - BRICK_DUNGEON.gateInnerX;
  const gateCenterOffset = BRICK_DUNGEON.gateInnerX + gateW / 2;
  const buildPortcullis = (gateCenterX: number) => {
    const gateGroup = new THREE.Group();
    gateGroup.position.set(gateCenterX, y3, BRICK_DUNGEON.gateZ);
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(gateW, 0.38, 0.38), ironMat);
    topBeam.position.y = 5.6;
    const midBeam = new THREE.Mesh(new THREE.BoxGeometry(gateW, 0.3, 0.38), ironMat);
    midBeam.position.y = 2.8;
    gateGroup.add(topBeam, midBeam);
    for (let bx = -gateW / 2 + 0.5; bx <= gateW / 2 - 0.5; bx += 1.15) {
      const vBar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 5.8, 8), ironMat);
      vBar.position.set(bx, 2.9, 0);
      gateGroup.add(vBar);
    }
    g.add(gateGroup);
    return gateGroup;
  };
  const leftPortcullis = buildPortcullis(cx - gateCenterOffset);
  const rightPortcullis = buildPortcullis(cx + gateCenterOffset);

  // STAIRCASE 3 -> 4 (z = 404..420, y = +12.0m -> +18.0m)
  addAscendingStaircase(
    BRICK_DUNGEON.stairs3StartZ,
    BRICK_DUNGEON.stairs3EndZ,
    BRICK_DUNGEON.floor3Y,
    BRICK_DUNGEON.floor4Y,
    "#a855f7",
  );

  // =========================================================================
  // FLOOR 4 (z = 420..480, y = +18.0m — 👑 SANCTUM OF THE 3-FACED DIRE WOLF)
  // =========================================================================
  const y4 = BRICK_DUNGEON.floor4Y;
  addHallwaySegment(420, 480, y4, bossHw, bossFloorMat, "#fbbf24", true);

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(bossHw * 2 + 3.2, 7.2, 1.8), shortWallBrickMat);
  backWall.position.set(cx, y4 + 3.6, endZ + 0.9);
  g.add(backWall);
  colliders.boxes.push({ x: cx, z: endZ + 0.9, hw: bossHw + 1.6, hd: 0.95 });

  // 3 Elemental Rune Circles on the Boss Sanctum Floor (❄️ Frost, 🔥 Fire, 🌑 Shadow)
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

  // Golden Royal Vault Dais & Chest at z = 470
  const vaultDais = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.55, 6.5), intactSlabMat);
  vaultDais.position.set(cx, y4 + 0.28, BRICK_DUNGEON.vaultChestZ);
  g.add(vaultDais);

  const royalVaultChest = new THREE.Group();
  royalVaultChest.position.set(cx, y4 + 0.55, BRICK_DUNGEON.vaultChestZ);
  const vBox = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.45, 2.0), goldMat);
  vBox.position.y = 0.72;
  vBox.castShadow = true;
  const vGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.6, 0),
    standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 2.2 }),
  );
  vGem.position.set(0, 1.95, 0);
  royalVaultChest.add(vBox, vGem);
  g.add(royalVaultChest);

  // Waterfall Escape Slide Portal at z = 476 (slides players back to Floor 1!)
  const escapeArch = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.28, 10, 24),
    standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 1.5 }),
  );
  escapeArch.position.set(cx, y4 + 2.4, BRICK_DUNGEON.escapeSlideZ);
  g.add(escapeArch);

  scene.add(g);

  createNoticeBoard(scene, colliders, {
    x: cx - 10.5,
    z: startZ - 3.5,
    yaw: Math.PI,
    title: "4-FLOOR ELEMENTAL BRICK DUNGEON",
    lines: [
      "F1 ❄️ ICE: Cross Ice Canal, dodge waterfalls, solve 3 Mimic Chests",
      "F2 🔥 FIRE: Burn Spiderwebs with 🔥 Torch, dodge Pendulums & Boulder",
      "F3 🌑 SHADOW & F4 👑 BOSS: Fight Shadow Wolves & 3-Faced Dire Wolf!",
    ],
  });

  return {
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

      // 1. Floor 1 Cracked vs Intact Frost Slabs
      for (const pair of slabPairs) {
        const crackedOnLeft = (pair.rowIdx + dungeonSeed) % 2 === 0;
        pair.left.material = crackedOnLeft ? crackedSlabMat : intactSlabMat;
        pair.right.material = crackedOnLeft ? intactSlabMat : crackedSlabMat;
      }

      // 2. Floor 1 Arrow Volley
      if (Number.isFinite(arrowVolleyZ)) {
        arrowVolleyGroup.position.z = arrowVolleyZ;
      }

      // 3. Floor 1 T-Junction Shifting Brick Wall
      const targetWallX = dungeonWing === 1 ? cx + partitionCenterOffset : cx - partitionCenterOffset;
      shiftingBrickWall.position.x += (targetWallX - shiftingBrickWall.position.x) * 0.14;
      leverWestRod.rotation.x = dungeonWing === 1 ? -0.45 : 0.45;
      leverEastRod.rotation.x = dungeonWing === 2 ? -0.45 : 0.45;

      // 4. Floor 1 Mimic Chests & Secret Bookcase Wall
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

      // 5. Floor 2 Burnable Spiderweb Curtains, Swinging Molten Pendulums & Rolling Fire-Boulder
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

      // 6. Floor 3 Parallel Iron Portcullis Gates
      const leftGateY = y3 + (gateLeftOpen === 1 ? 5.2 : 0);
      const rightGateY = y3 + (gateRightOpen === 1 ? 5.2 : 0);
      leftPortcullis.position.y += (leftGateY - leftPortcullis.position.y) * 0.14;
      rightPortcullis.position.y += (rightGateY - rightPortcullis.position.y) * 0.14;

      // 7. Floor 4 Royal Vault Gem & Escape Portal
      vGem.rotation.y = tSec * 1.8;
      vGem.position.y = 1.95 + (vaultUnlocked === 1 ? 0.55 : 0) + Math.sin(tSec * 3) * 0.14;
      escapeArch.rotation.z = tSec * 1.2;
    },
  };
}

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

  // Floor 2: Giant Cinder-Spider with 8 jointed legs, glowing magma abdomen & ceiling silk thread
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

  // Floor 4 Final Boss: Colossal 3-Faced Dire Wolf (❄️ Left Ice Head, 🔥 Center Fire Head, 🌑 Right Shadow Head)
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

    const bossAura = new THREE.PointLight("#f97316", 3.6, 18, 1.4);
    bossAura.position.set(0, 3.8, 1.5);
    group.add(bossAura);

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

    // Red carpet runner down the center of the exterior steps
    const runner = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, Math.abs(stairZEnd - stairZStart) / stairSteps + 0.05),
      carpetRunnerMat,
    );
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, stepY + 0.035, stepZ);
    runner.receiveShadow = true;
    group.add(runner);
  }

  // Brass railings along exterior entrance staircase
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
  // Left and Right front walls flanking the central entrance opening
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

  // Grand Entrance Archway lintel over the doors
  const archLintel = new THREE.Mesh(new THREE.BoxGeometry(11.2, 2.2, 1.6), mahoganyTrimMat);
  archLintel.position.set(0, 8.8, -25.6);
  archLintel.castShadow = true;
  group.add(archLintel);

  // Big Illuminated Retro Marquee Board: "CINEMA"
  const marqueeCanvas = document.createElement("canvas");
  marqueeCanvas.width = 1024;
  marqueeCanvas.height = 256;
  const mCtx = marqueeCanvas.getContext("2d")!;
  mCtx.fillStyle = "#180910";
  mCtx.fillRect(0, 0, 1024, 256);

  // Decorative inner gold frame
  mCtx.strokeStyle = "#eab308";
  mCtx.lineWidth = 8;
  mCtx.strokeRect(16, 16, 1024 - 32, 256 - 32);

  // Retro incandescent chase bulb dots around the marquee border
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

  // Glowing Neon "C I N E M A" text
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

  const marqueeLight = new THREE.PointLight("#f59e0b", 3.2, 24, 1.4);
  marqueeLight.position.set(0, 9.8, -23.4);
  group.add(marqueeLight);

  // 3. Fully Enclosed Walls & Acoustic Ceiling Roof
  const hallLen = Math.abs(CINEMA_HALL.minZ - CINEMA_HALL.maxZ); // 48.5m
  const midZ = (CINEMA_HALL.minZ + CINEMA_HALL.maxZ) / 2; // -50.25m
  const halfW = 16.5;

  // Outer Side Walls (West & East)
  for (const side of [-1, 1]) {
    const sideWallX = side * halfW;
    const outerSideWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12.2, hallLen), wallAcousticMat);
    outerSideWall.position.set(sideWallX, 6.1, midZ);
    outerSideWall.castShadow = outerSideWall.receiveShadow = true;
    group.add(outerSideWall);
    colliders.boxes.push({ x: sideWallX, z: midZ, hw: 0.6, hd: hallLen / 2 });

    // Decorative wall sconces & mahogany acoustic pilasters every 7m
    for (let sz = -32; sz >= -68; sz -= 7) {
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.35, 11.5, 0.95), mahoganyTrimMat);
      pilaster.position.set(side * (halfW - 0.45), 5.8, sz);
      group.add(pilaster);

      const sconce = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), neonGoldMat);
      sconce.position.set(side * (halfW - 0.75), 4.8, sz);
      group.add(sconce);

      if ((sz + 32) % 14 === 0) {
        const sconceLight = new THREE.PointLight("#ffae42", 1.8, 18, 1.5);
        sconceLight.position.set(side * (halfW - 1.2), 5.0, sz);
        group.add(sconceLight);
      }
    }
  }

  // Front Screen Wall at z = -74.5
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 1.2, 12.2, 1.4), wallAcousticMat);
  frontWall.position.set(0, 6.1, -74.5);
  frontWall.castShadow = true;
  group.add(frontWall);
  colliders.boxes.push({ x: 0, z: -74.5, hw: halfW + 0.6, hd: 0.7 });

  // Closed Acoustic Roof with Crossbeam Coffers
  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 2.0, 0.9, hallLen + 1.5), ceilingAcousticMat);
  ceiling.position.set(0, 12.2, midZ);
  ceiling.castShadow = true;
  group.add(ceiling);

  for (let bz = -34; bz >= -68; bz -= 8) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 0.5, 0.65, 0.85), mahoganyTrimMat);
    beam.position.set(0, 11.75, bz);
    group.add(beam);
  }

  // 4. Stepped "Ladder" Stadium Seating Tiers (High at entrance -> Low at screen)
  // Entrance Lobby & Top Walkway: y = 3.6m (z = -26 to -32)
  const lobbyPromenade = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 - 2, 0.6, 6.0), concreteRiserMat);
  lobbyPromenade.position.set(0, 3.3, -29.0);
  lobbyPromenade.receiveShadow = true;
  group.add(lobbyPromenade);

  const lobbyCarpet = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2 - 2.5, 5.8), carpetAisleMat);
  lobbyCarpet.rotation.x = -Math.PI / 2;
  lobbyCarpet.position.set(0, 3.62, -29.0);
  lobbyCarpet.receiveShadow = true;
  group.add(lobbyCarpet);

  // 6 Descending Stadium Tiers
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

    // Illuminated step guide lights along aisle risers
    for (const ax of [-1.4, 1.4, -10.5, 10.5]) {
      const stepLight = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.12), stepLightMat);
      stepLight.position.set(ax, tier.y + 0.15, tier.z0);
      group.add(stepLight);
    }
  }

  // Central Aisle Carpet Runner leading down the center
  for (const tier of tierSpecs) {
    const tierD = Math.abs(tier.z1 - tier.z0);
    const tierMidZ = (tier.z0 + tier.z1) / 2;
    const aisleRunner = new THREE.Mesh(new THREE.PlaneGeometry(2.4, tierD), carpetRunnerMat);
    aisleRunner.rotation.x = -Math.PI / 2;
    aisleRunner.position.set(0, tier.y + 0.035, tierMidZ);
    aisleRunner.receiveShadow = true;
    group.add(aisleRunner);
  }

  // 5. 60 Luxury Cinema Recliner Seats (10 per tier x 6 tiers)
  const seatGeo = new THREE.BoxGeometry(0.9, 0.16, 0.78);
  const backGeo = new THREE.BoxGeometry(0.9, 0.82, 0.16);
  const armGeo = new THREE.BoxGeometry(0.12, 0.38, 0.75);
  const cupGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 8);
  const pedestalGeo = new THREE.CylinderGeometry(0.16, 0.24, 0.38, 8);

  for (let i = 0; i < CINEMA_HALL.seatCount; i++) {
    const s = CINEMA_SEATS[i]!;
    const chairY = s.y ?? 0;
    const chair = new THREE.Group();
    chair.position.set(s.x, chairY, s.z);

    const ped = new THREE.Mesh(pedestalGeo, armMat);
    ped.position.y = 0.19;
    chair.add(ped);

    const cushion = new THREE.Mesh(seatGeo, cushionMat);
    cushion.position.y = 0.44;
    cushion.castShadow = cushion.receiveShadow = true;
    chair.add(cushion);

    const back = new THREE.Mesh(backGeo, cushionMat);
    back.position.set(0, 0.84, 0.32);
    back.castShadow = back.receiveShadow = true;
    chair.add(back);

    for (const ax of [-0.46, 0.46]) {
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(ax, 0.58, 0.04);
      const cup = new THREE.Mesh(cupGeo, brassGoldMat);
      cup.position.set(ax, 0.76, -0.25);
      chair.add(arm, cup);
    }

    group.add(chair);
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

  // Colossal Silver Screen (22m x 9.5m)
  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CINEMA_HALL.screenWidth, CINEMA_HALL.screenHeight),
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
  );
  screenMesh.position.set(0, CINEMA_HALL.screenY, CINEMA_HALL.screenZ);
  group.add(screenMesh);

  // Glowing Outer Neon Trim around Screen
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(CINEMA_HALL.screenWidth + 0.6, CINEMA_HALL.screenHeight + 0.6, 0.12),
    neonBlueMat,
  );
  trim.position.set(0, CINEMA_HALL.screenY, CINEMA_HALL.screenZ - 0.08);
  group.add(trim);

  // Heavy Velvet Stage Drapes & Curtains flanking the screen
  for (const side of [-1, 1]) {
    const drape = new THREE.Mesh(new THREE.BoxGeometry(4.2, 10.5, 0.8), curtainVelvetMat);
    drape.position.set(side * 13.2, 6.2, -71.8);
    drape.castShadow = true;
    group.add(drape);
  }
  const topValance = new THREE.Mesh(new THREE.BoxGeometry(28.0, 1.4, 0.8), curtainVelvetMat);
  topValance.position.set(0, 11.4, -71.8);
  group.add(topValance);

  // Dynamic Ambient Screen Light
  const screenLight = new THREE.PointLight("#5b8def", 4.5, 34, 1.45);
  screenLight.position.set(0, CINEMA_HALL.screenY, -64.0);
  group.add(screenLight);

  scene.add(group);

  // Exterior Notice Board outside near the entrance stairs
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
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.6), winMat);
        const along = (c - (cols - 1) / 2) * 2.5;
        const y = 2 + r * 3;
        if (facing === "x") {
          const side = x > 0 ? -1 : 1;
          win.position.set(x + side * (w / 2 + 0.01), y, z + along);
          win.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          const side = z > 0 ? -1 : 1;
          win.position.set(x + along, y, z + side * (d / 2 + 0.01));
          win.rotation.y = side > 0 ? 0 : Math.PI;
        }
        scene.add(win);
      }
    }

    colliders.boxes.push({ x, z, hw: w / 2, hd: d / 2 });
  });
}

/**
 * Dense, Multi-Species Forest & Undergrowth:
 * - 5 tree varieties: Tall Pine/Spruce, Broad Oak Canopy, Twisted Jungle Banyan with hanging vines,
 *   Weeping White Birch, and Fallen Mossy Logs.
 * - Undergrowth plants: Ferns, Tall Reed Grass, Wild Berry Bushes, and Glowing Bioluminescent Mushrooms!
 */
function addCityAndForestTrees(scene: THREE.Scene, colliders: Colliders) {
  const rand = mulberry32(20261029);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.8, 7);
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
    // Keep main north-south trail to Campfire clear
    if (Math.abs(x) < 4.8 && z > -40 && z < 78) continue;
    if (Math.abs(z) < 5 && Math.abs(x) < 70) continue;
    if (z < -30 && Math.abs(x) < 35) continue;
    if (Math.abs(x - FOOTBALL_STADIUM.centerX) < 26 && Math.abs(z) < 20) continue;
    if (Math.hypot(x - ARCADE_ZONE.centerX, z - ARCADE_ZONE.centerZ) < 17) continue;
    if (Math.hypot(x - CAMPFIRE_BASE.x, z - CAMPFIRE_BASE.z) < 14.5) continue;
    // Keep the trail from Campfire (z=68) across the Central Bridge (z=112) to the Brick Dungeon (z=120) clear
    if (Math.abs(x) < 5.8 && z >= 68 && z <= BRICK_DUNGEON.startZ + 2) continue;
    if (
      Math.abs(x - BRICK_DUNGEON.centerX) < BRICK_DUNGEON.halfW + 9 &&
      z > BRICK_DUNGEON.startZ - 8 &&
      z < BRICK_DUNGEON.endZ + 12
    ) {
      continue;
    }
    if (Math.abs(z - 112) < 6.5) continue;

    if (colliders.boxes.some((b) => Math.abs(x - b.x) < b.hw + 2.2 && Math.abs(z - b.z) < b.hd + 2.2)) continue;
    if (colliders.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.6)) continue;

    const tree = new THREE.Group();
    const scale = inSouthForest ? 1.0 + rand() * 1.15 : 0.8 + rand() * 0.65;
    const speciesRoll = inSouthForest ? placed % 5 : placed % 2;

    if (speciesRoll === 0) {
      // 1. Tall Pine / Spruce
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      const l1 = new THREE.Mesh(leafGeos[0]!, leafMats[placed % leafMats.length]!);
      l1.position.y = 2.6;
      l1.castShadow = true;
      const l2 = new THREE.Mesh(leafGeos[1]!, leafMats[(placed + 1) % leafMats.length]!);
      l2.position.y = 3.9;
      l2.castShadow = true;
      tree.add(trunk, l1, l2);
    } else if (speciesRoll === 1) {
      // 2. Broad Oak Canopy
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      const canopy = new THREE.Mesh(leafGeos[2]!, leafMats[(placed + 2) % leafMats.length]!);
      canopy.position.y = 2.9;
      canopy.castShadow = true;
      const subCanopy = new THREE.Mesh(leafGeos[2]!, leafMats[(placed + 3) % leafMats.length]!);
      subCanopy.scale.setScalar(0.72);
      subCanopy.position.set(0.85, 2.4, 0.4);
      tree.add(trunk, canopy, subCanopy);
    } else if (speciesRoll === 2) {
      // 3. Twisted Jungle Banyan with Hanging Vines
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 2.2, 7), trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      const crown = new THREE.Mesh(leafGeos[2]!, leafMats[5]!);
      crown.scale.set(1.35, 0.85, 1.35);
      crown.position.y = 3.1;
      crown.castShadow = true;
      tree.add(trunk, crown);
      for (const vx of [-0.9, 0.9]) {
        const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 5), vineMat);
        vine.position.set(vx, 1.9, 0.5);
        tree.add(vine);
      }
    } else if (speciesRoll === 3) {
      // 4. White Weeping Birch
      const trunk = new THREE.Mesh(trunkGeo, birchMat);
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      const crown = new THREE.Mesh(leafGeos[1]!, leafMats[4]!);
      crown.position.y = 2.8;
      crown.castShadow = true;
      tree.add(trunk, crown);
    } else {
      // 5. Fallen Mossy Hollow Log + Glowing Mushrooms
      const fallenLog = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 2.8, 8), trunkMat);
      fallenLog.rotation.z = Math.PI / 2;
      fallenLog.position.y = 0.3;
      fallenLog.castShadow = true;
      tree.add(fallenLog);
    }

    // Undergrowth Plants: Ferns, Berry Bushes & Bioluminescent Mushrooms
    if (inSouthForest) {
      if (placed % 4 === 0) {
        const fern = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.75, 5), leafMats[2]!);
        fern.position.set(0.95, 0.35, -0.5);
        tree.add(fern);
      }
      if (placed % 6 === 0) {
        const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), leafMats[0]!);
        bush.position.set(1.1, 0.35, 0.4);
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), berryMat);
        berry.position.set(1.1, 0.75, 0.55);
        tree.add(bush, berry);
      }
      if (placed % 5 === 0) {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.28, 6), stemMat);
        stem.position.set(-0.85, 0.14, 0.65);
        const cap = new THREE.Mesh(
          new THREE.ConeGeometry(0.22, 0.18, 7),
          placed % 10 === 0 ? mushroomPurpleMat : mushroomCapMat,
        );
        cap.position.set(-0.85, 0.3, 0.65);
        tree.add(stem, cap);
      }
    }

    tree.scale.setScalar(scale);
    tree.rotation.y = rand() * Math.PI * 2;
    tree.position.set(x, 0, z);
    scene.add(tree);

    colliders.circles.push({ x, z, r: 0.36 * scale });
    placed++;
  }
}
