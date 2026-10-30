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
  getIndianHourFloat,
} from "@vi/shared";
import { Colliders } from "./collision";

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
  screenMesh: THREE.Mesh;
  screenLight: THREE.PointLight;
  muralCanvas: HTMLCanvasElement;
  muralTexture: THREE.CanvasTexture;
  timeMode: TimeMode;
  isNight: boolean;
  setScreenTexture(tex: THREE.Texture, accentColor?: string): void;
  setFootballState(ballX: number, ballZ: number, scoreRed: number, scoreBlue: number): void;
  setDungeonState(
    dungeonWing: number,
    dungeonSeed: number,
    grimoireFound: number,
    gateLeftOpen: number,
    gateRightOpen: number,
    vaultUnlocked: number,
    arrowVolleyZ: number,
    mimicTrapped: number,
    nowMs: number,
  ): void;
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
    setDungeonState(
      dungeonWing: number,
      dungeonSeed: number,
      grimoireFound: number,
      gateLeftOpen: number,
      gateRightOpen: number,
      vaultUnlocked: number,
      arrowVolleyZ: number,
      mimicTrapped: number,
      nowMs: number,
    ) {
      dungeonRig.update(
        dungeonWing,
        dungeonSeed,
        grimoireFound,
        gateLeftOpen,
        gateRightOpen,
        vaultUnlocked,
        arrowVolleyZ,
        mimicTrapped,
        nowMs,
      );
    },
    syncAnimals(animals: AnimalRenderState[]) {
      const now = performance.now();
      for (const a of animals) {
        let entry = animalEntries.get(a.id);
        if (!entry) {
          entry = createAnimalMesh(a.species);
          entry.group.position.set(a.x, 0, a.z);
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

        if (entry.species === "snake" && entry.segments) {
          entry.group.position.y = 0.02;
          entry.segments.forEach((seg, idx) => {
            seg.position.x = Math.sin(now * 0.011 + idx * 0.85 + entry.targetX) * 0.16;
          });
        } else {
          entry.group.position.y = Math.abs(Math.sin(now * 0.008 + entry.targetX)) * 0.12;
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
    [-42, 212, 30, 26.0],
    [42, 212, 30, 26.0],
    [0, 224, 34, 30.0],
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
  for (let i = 24; i < CINEMA_SEATS.length; i++) {
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
 * Located at `x = 0, z = +120..+208` across the central forest river bridge.
 * Built with custom 3D bump-mapped PBR stone-brick walls, vaulted ceiling ribs, recessed wall niches,
 * cracked floor brick booby traps, shifting brick T-junction walls, 3 ornate Mimic/Grimoire chests,
 * a secret sliding brick bookcase wall, parallel iron-bar corridors with loose brick switches,
 * rising iron portcullis gates, and the King's Tomb Golden Vault!
 */
function addFrierenBrickDungeon(scene: THREE.Scene, colliders: Colliders) {
  const cx = BRICK_DUNGEON.centerX;
  const startZ = BRICK_DUNGEON.startZ;
  const endZ = BRICK_DUNGEON.endZ;
  const hw = BRICK_DUNGEON.halfW;
  const len = endZ - startZ;
  const midZ = (startZ + endZ) / 2;

  const g = new THREE.Group();

  // PBR Stone-Brick & Flagstone Materials with 3D Bump Map relief
  const wallBrickMat = createBrickPBRMaterial({ repeatX: 16, repeatY: 3, mossy: true, bumpScale: 0.095 });
  const shortWallBrickMat = createBrickPBRMaterial({ repeatX: 4, repeatY: 3, mossy: true, bumpScale: 0.09 });
  const floorFlagstoneMat = createBrickPBRMaterial({
    repeatX: 6,
    repeatY: 22,
    baseColor: "#333946",
    mossy: true,
    bumpScale: 0.065,
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

  // 1. Grand Square Stone-Brick Entrance Archway at z = 120
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(5.2, 6.4, 2.2), shortWallBrickMat);
    pillar.position.set(cx + side * 6.8, 3.2, startZ);
    pillar.castShadow = pillar.receiveShadow = true;
    g.add(pillar);
    colliders.boxes.push({ x: cx + side * 6.8, z: startZ, hw: 2.6, hd: 1.1 });
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 3.2, 1.8, 2.6), shortWallBrickMat);
  lintel.position.set(cx, 6.2, startZ);
  lintel.castShadow = true;
  g.add(lintel);

  // 2. Flagstone Dungeon Floor & Vaulted Stone-Brick Ceiling
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 + 2, len + 4), floorFlagstoneMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.028, midZ);
  floor.receiveShadow = true;
  g.add(floor);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 2.8, 1.2, len), wallBrickMat);
  ceiling.position.set(cx, 6.4, midZ);
  ceiling.castShadow = true;
  g.add(ceiling);

  // Outer Square Masonry Walls + Interior Vaulted Stone Ribs (leaving recessed wall niches at |x| > 4.5 in Hallway 1!)
  for (const side of [-1, 1]) {
    const wallX = cx + side * (hw + 0.9);
    const outerWall = new THREE.Mesh(new THREE.BoxGeometry(1.8, 6.2, len), wallBrickMat);
    outerWall.position.set(wallX, 3.1, midZ);
    outerWall.castShadow = outerWall.receiveShadow = true;
    g.add(outerWall);
    colliders.boxes.push({ x: wallX, z: midZ, hw: 0.9, hd: len / 2 });
  }
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 3.2, 6.2, 1.8), shortWallBrickMat);
  backWall.position.set(cx, 3.1, endZ + 0.9);
  g.add(backWall);
  colliders.boxes.push({ x: cx, z: endZ + 0.9, hw: hw + 1.6, hd: 0.95 });

  // Rectangular Stone-Brick Pilasters & Ceiling Ribs every 8m for authentic Frieren hallway geometry
  for (let z = startZ + 6; z <= endZ - 4; z += 8) {
    const overheadRib = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.7, 0.9), shortWallBrickMat);
    overheadRib.position.set(cx, 5.55, z);
    g.add(overheadRib);

    for (const side of [-1, 1]) {
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5.6, 0.95), shortWallBrickMat);
      pilaster.position.set(cx + side * (hw - 0.55), 2.8, z);
      pilaster.castShadow = pilaster.receiveShadow = true;
      g.add(pilaster);
    }
  }

  // Warm Torch & Blue Mana Sconces along the Brick Corridor
  for (let z = startZ + 5; z <= endZ - 3; z += 12) {
    const isSanctum = z >= BRICK_DUNGEON.sanctumStartZ;
    const flameCol = isSanctum ? "#38bdf8" : "#ff9e3b";
    for (const side of [-1, 1]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.25), ironMat);
      bracket.position.set(cx + side * (hw - 0.15), 3.3, z);
      const flameOrb = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.42, 6),
        standard(flameCol, { emissive: flameCol, emissiveIntensity: 2.1 }),
      );
      flameOrb.position.set(cx + side * (hw - 0.25), 3.6, z);
      g.add(bracket, flameOrb);
    }
    const sconceLight = new THREE.PointLight(flameCol, 2.8, 17, 1.45);
    sconceLight.position.set(cx, 4.1, z);
    g.add(sconceLight);
  }

  // ---- HALLWAY 1 (z = 120..146): Cracked Floor Brick Slabs & Wall-Slit Arrow Volley ----
  const slabRows = [127, 132, 137, 142];
  const slabPairs: Array<{ left: THREE.Mesh; right: THREE.Mesh; rowIdx: number }> = [];
  slabRows.forEach((rz, rIdx) => {
    const leftSlab = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 2.1), crackedSlabMat);
    leftSlab.position.set(cx - 2.1, 0.08, rz);
    leftSlab.receiveShadow = true;
    const rightSlab = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.16, 2.1), intactSlabMat);
    rightSlab.position.set(cx + 2.1, 0.08, rz);
    rightSlab.receiveShadow = true;
    g.add(leftSlab, rightSlab);
    slabPairs.push({ left: leftSlab, right: rightSlab, rowIdx: rIdx });
  });

  // Sweeping 3D Arrow Volley Bar firing down the central hallway
  const arrowVolleyGroup = new THREE.Group();
  for (const ax of [-2.4, -1.2, 0, 1.2, 2.4]) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 6), standard("#d97706"));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(ax, 1.25, 0);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.25, 6),
      standard("#ef4444", { emissive: "#dc2626", emissiveIntensity: 1.4 }),
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(ax, 1.25, -0.72);
    arrowVolleyGroup.add(shaft, tip);
  }
  arrowVolleyGroup.position.set(cx, 0, BRICK_DUNGEON.hall1EndZ);
  g.add(arrowVolleyGroup);

  // ---- DECISION 1 (z = 148..154): T-Junction Iron Wall Levers & Shifting Brick Partition ----
  const leverBaseGeo = new THREE.BoxGeometry(0.45, 0.45, 0.35);
  const leverRodGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8);
  const leverWestBase = new THREE.Mesh(leverBaseGeo, ironMat);
  leverWestBase.position.set(cx - 3.6, 0.25, BRICK_DUNGEON.junctionZ);
  const leverWestRod = new THREE.Mesh(
    leverRodGeo,
    standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 1.1 }),
  );
  leverWestRod.position.set(cx - 3.6, 0.75, BRICK_DUNGEON.junctionZ);

  const leverEastBase = new THREE.Mesh(leverBaseGeo, ironMat);
  leverEastBase.position.set(cx + 3.6, 0.25, BRICK_DUNGEON.junctionZ);
  const leverEastRod = new THREE.Mesh(
    leverRodGeo,
    standard("#f59e0b", { emissive: "#d97706", emissiveIntensity: 1.1 }),
  );
  leverEastRod.position.set(cx + 3.6, 0.75, BRICK_DUNGEON.junctionZ);
  g.add(leverWestBase, leverWestRod, leverEastBase, leverEastRod);

  // Central Brick Pier at T-Junction + Sliding Stone-Brick Partition Wall
  const centerPier = new THREE.Mesh(new THREE.BoxGeometry(2.2, 5.8, 3.6), shortWallBrickMat);
  centerPier.position.set(cx, 2.9, 153);
  g.add(centerPier);
  colliders.boxes.push({ x: cx, z: 153, hw: 1.1, hd: 1.8 });

  const shiftingBrickWall = new THREE.Mesh(new THREE.BoxGeometry(7.6, 5.6, 1.2), shortWallBrickMat);
  shiftingBrickWall.position.set(cx + 4.4, 2.8, 152.5);
  shiftingBrickWall.castShadow = shiftingBrickWall.receiveShadow = true;
  g.add(shiftingBrickWall);

  // ---- DECISION 2 (z = 156..174): Frieren's 3-Chest Mimic Alcove Room & Secret Bookcase Wall ----
  const chestEntries: Array<{
    lidGroup: THREE.Group;
    teethGroup: THREE.Group;
    tongueMesh: THREE.Mesh;
  }> = [];
  const chestXPositions = [cx - 4.8, cx, cx + 4.8];

  chestXPositions.forEach((chX) => {
    const chestGroup = new THREE.Group();
    chestGroup.position.set(chX, 0, 165.5);

    // Raised stone dais under each chest
    const dais = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.28, 2.0), intactSlabMat);
    dais.position.y = 0.14;
    chestGroup.add(dais);

    // Lower wooden chest box + gold trim bands
    const baseBox = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 1.15), chestWoodMat);
    baseBox.position.y = 0.65;
    baseBox.castShadow = true;
    const goldBand = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.77, 0.22), goldMat);
    goldBand.position.y = 0.65;
    chestGroup.add(baseBox, goldBand);

    // Hinged Chest Lid (rotates open to reveal either Mimic Fangs or Golden Grimoire light!)
    const lidGroup = new THREE.Group();
    lidGroup.position.set(0, 1.02, -0.55);
    const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.45, 1.15), chestWoodMat);
    lidMesh.position.set(0, 0.22, 0.55);
    const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.12), goldMat);
    lockPlate.position.set(0, 0.1, 1.14);
    lidGroup.add(lidMesh, lockPlate);
    chestGroup.add(lidGroup);

    // Hidden Mimic Fangs & Red Monster Tongue inside the chest
    const teethGroup = new THREE.Group();
    teethGroup.position.set(0, 0.98, 0);
    const fangMat = standard("#f8fafc");
    for (const fx of [-0.55, -0.28, 0, 0.28, 0.55]) {
      const topFang = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 5), fangMat);
      topFang.rotation.x = Math.PI;
      topFang.position.set(fx, 0.18, 0.45);
      const botFang = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 5), fangMat);
      botFang.position.set(fx, -0.05, 0.45);
      teethGroup.add(topFang, botFang);
    }
    const tongueMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.95),
      standard("#e11d48", { emissive: "#be123c", emissiveIntensity: 0.7 }),
    );
    tongueMesh.position.set(0, 0.05, 0.45);
    teethGroup.add(tongueMesh);
    teethGroup.visible = false;
    chestGroup.add(teethGroup);

    g.add(chestGroup);
    chestEntries.push({ lidGroup, teethGroup, tongueMesh });
  });

  // Secret Sliding Brick Bookcase Wall at z = 174
  const secretBookcaseWall = new THREE.Group();
  secretBookcaseWall.position.set(cx, 0, BRICK_DUNGEON.secretWallZ);
  const bookcaseBacking = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 5.8, 1.1), shortWallBrickMat);
  bookcaseBacking.position.y = 2.9;
  secretBookcaseWall.add(bookcaseBacking);
  const shelfColors = ["#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea"];
  for (const sy of [1.2, 2.4, 3.6]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.16, 1.25), chestWoodMat);
    shelf.position.y = sy;
    secretBookcaseWall.add(shelf);
    for (let b = -3; b <= 3; b++) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.75, 1.22),
        standard(shelfColors[Math.abs(b + Math.round(sy)) % shelfColors.length]!),
      );
      book.position.set(b * 0.9, sy + 0.46, 0);
      secretBookcaseWall.add(book);
    }
  }
  g.add(secretBookcaseWall);

  // ---- DECISION 3 (z = 175..194): Parallel Iron-Bar Hallways, Loose Brick Switches & Portcullis Gates ----
  for (let z = 176; z <= 192; z += 1.2) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 5.8, 8), ironMat);
    bar.position.set(cx, 2.9, z);
    g.add(bar);
  }
  colliders.boxes.push({ x: cx, z: 184, hw: 0.35, hd: 8.2 });

  // Protruding Loose Brick Switches on the West & East masonry walls at z = 183
  const switchMat = standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 0.95 });
  const looseBrickWest = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.85), switchMat);
  looseBrickWest.position.set(cx - hw + 0.35, 1.5, 183);
  const looseBrickEast = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.85), switchMat);
  looseBrickEast.position.set(cx + hw - 0.35, 1.5, 183);
  g.add(looseBrickWest, looseBrickEast);

  // Left & Right Iron Portcullis Gates at z = 188
  const buildPortcullis = (gateCenterX: number) => {
    const gateGroup = new THREE.Group();
    gateGroup.position.set(gateCenterX, 0, BRICK_DUNGEON.gateZ);
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.35, 0.35), ironMat);
    topBeam.position.y = 5.2;
    const midBeam = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.28, 0.35), ironMat);
    midBeam.position.y = 2.6;
    gateGroup.add(topBeam, midBeam);
    for (let bx = -3.4; bx <= 3.4; bx += 0.85) {
      const vBar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.4, 8), ironMat);
      vBar.position.set(bx, 2.7, 0);
      gateGroup.add(vBar);
    }
    g.add(gateGroup);
    return gateGroup;
  };
  const leftPortcullis = buildPortcullis(cx - 4.4);
  const rightPortcullis = buildPortcullis(cx + 4.4);

  // ---- SANCTUM 4 (z = 194..208): The King's Tomb Golden Vault ----
  const vaultDais = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.45, 5.5), intactSlabMat);
  vaultDais.position.set(cx, 0.22, BRICK_DUNGEON.vaultChestZ);
  g.add(vaultDais);

  const royalVaultChest = new THREE.Group();
  royalVaultChest.position.set(cx, 0.45, BRICK_DUNGEON.vaultChestZ);
  const vBox = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.25, 1.65), goldMat);
  vBox.position.y = 0.62;
  vBox.castShadow = true;
  const vGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45, 0),
    standard("#38bdf8", { emissive: "#0284c7", emissiveIntensity: 2.0 }),
  );
  vGem.position.set(0, 1.65, 0);
  royalVaultChest.add(vBox, vGem);
  g.add(royalVaultChest);

  scene.add(g);

  createNoticeBoard(scene, colliders, {
    x: cx - 7.8,
    z: startZ - 3.0,
    yaw: Math.PI,
    title: "KING'S TOMB BRICK DUNGEON",
    lines: [
      "1. Equip 🔥 Torch to spot Cracked Floor Bricks & Arrow Niches",
      "2. Pull Levers to shift brick walls; open 3 Chests (Beware Mimics!)",
      "3. Press Loose Bricks to raise Portcullis Gates & claim the Vault",
    ],
  });

  return {
    update(
      dungeonWing: number,
      dungeonSeed: number,
      grimoireFound: number,
      gateLeftOpen: number,
      gateRightOpen: number,
      vaultUnlocked: number,
      arrowVolleyZ: number,
      mimicTrapped: number,
      nowMs: number,
    ) {
      const tSec = nowMs / 1000;

      // 1. Update Cracked vs Intact Floor Brick Slabs based on dungeonSeed
      for (const pair of slabPairs) {
        const crackedOnLeft = (pair.rowIdx + dungeonSeed) % 2 === 0;
        pair.left.material = crackedOnLeft ? crackedSlabMat : intactSlabMat;
        pair.right.material = crackedOnLeft ? intactSlabMat : crackedSlabMat;
      }

      // 2. Move Hallway 1 Arrow Volley
      if (Number.isFinite(arrowVolleyZ)) {
        arrowVolleyGroup.position.z = arrowVolleyZ;
      }

      // 3. Slide T-Junction Brick Partition Wall (dungeonWing === 1 opens West, blocks East)
      const targetWallX = dungeonWing === 1 ? cx + 4.4 : cx - 4.4;
      shiftingBrickWall.position.x += (targetWallX - shiftingBrickWall.position.x) * 0.14;
      leverWestRod.rotation.x = dungeonWing === 1 ? -0.45 : 0.45;
      leverEastRod.rotation.x = dungeonWing === 2 ? -0.45 : 0.45;

      // 4. Animate the 3 Ornate Chests (Mimic chomping jaws vs Grimoire found)
      const realChestIdx = dungeonSeed % 3;
      chestEntries.forEach((entry, idx) => {
        const isReal = idx === realChestIdx;
        if (isReal && grimoireFound === 1) {
          entry.lidGroup.rotation.x += (-1.15 - entry.lidGroup.rotation.x) * 0.15;
          entry.teethGroup.visible = false;
        } else if (!isReal && mimicTrapped > 0) {
          entry.lidGroup.rotation.x = -0.85 + Math.sin(tSec * 16) * 0.32;
          entry.teethGroup.visible = true;
          entry.tongueMesh.rotation.y = Math.sin(tSec * 14) * 0.35;
        } else {
          entry.lidGroup.rotation.x += (0 - entry.lidGroup.rotation.x) * 0.15;
          entry.teethGroup.visible = false;
        }
      });

      // 5. Slide Secret Brick Bookcase Wall open when the Grimoire Key is found
      const bookcaseTargetX = grimoireFound === 1 ? cx + 8.6 : cx;
      secretBookcaseWall.position.x += (bookcaseTargetX - secretBookcaseWall.position.x) * 0.1;

      // 6. Raise Parallel Iron Portcullis Gates when Loose Brick Switches are pressed
      const leftGateY = gateLeftOpen === 1 ? 4.8 : 0;
      const rightGateY = gateRightOpen === 1 ? 4.8 : 0;
      leftPortcullis.position.y += (leftGateY - leftPortcullis.position.y) * 0.14;
      rightPortcullis.position.y += (rightGateY - rightPortcullis.position.y) * 0.14;

      // 7. Rotate the Royal Vault Gem
      vGem.rotation.y = tSec * 1.8;
      vGem.position.y = 1.65 + (vaultUnlocked === 1 ? 0.45 : 0) + Math.sin(tSec * 3) * 0.12;
    },
  };
}

/** Pure 3D low-poly forest animal or multi-segment slithering snake mesh! */
function createAnimalMesh(species: string): AnimalMeshEntry {
  const group = new THREE.Group();

  if (species === "snake") {
    const snakeGreen = standard("#16a34a", { emissive: "#14532d", emissiveIntensity: 0.35 });
    const bellyMat = standard("#bef264");
    const eyeMat = standard("#facc15", { emissive: "#eab308", emissiveIntensity: 1.2 });
    const tongueMat = standard("#ef4444", { emissive: "#dc2626", emissiveIntensity: 0.9 });
    const segments: THREE.Mesh[] = [];

    // Cobra hood & head
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

  const color =
    species === "rabbit"
      ? "#f1f5f9"
      : species === "deer"
        ? "#b57c4a"
        : species === "boar"
          ? "#4b382a"
          : "#64748b";
  const scale = species === "rabbit" ? 0.55 : species === "deer" ? 1.05 : species === "boar" ? 0.9 : 0.95;

  const mat = standard(color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7 * scale, 0.55 * scale, 1.15 * scale), mat);
  body.position.y = 0.55 * scale;
  body.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45 * scale, 0.45 * scale, 0.5 * scale), mat);
  head.position.set(0, 0.85 * scale, 0.55 * scale);
  group.add(body, head);

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

  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(18, 21), standard("#3a1d28", { roughness: 0.95 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.025, -44.5);
  carpet.receiveShadow = true;
  group.add(carpet);

  for (const ax of [-0.65, 0.65]) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 16),
      standard("#ffcf70", { emissive: "#ffae33", emissiveIntensity: 0.8 }),
    );
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(ax, 0.032, -43);
    group.add(strip);
  }

  const stageDeck = new THREE.Mesh(new THREE.BoxGeometry(17, 0.7, 5.5), standard("#25212e"));
  stageDeck.position.set(0, 0.35, -52.5);
  stageDeck.castShadow = stageDeck.receiveShadow = true;
  group.add(stageDeck);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(16.6, 7.6, 0.6), standard("#191822"));
  wall.position.set(0, 3.8, -54.9);
  wall.castShadow = true;
  group.add(wall);

  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(CINEMA_HALL.screenWidth + 0.45, CINEMA_HALL.screenHeight + 0.45, 0.1),
    standard("#5b8def", { emissive: "#5b8def", emissiveIntensity: 0.7 }),
  );
  trim.position.set(0, CINEMA_HALL.screenY, CINEMA_HALL.screenZ - 0.08);
  group.add(trim);

  for (const side of [-1, 1]) {
    const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.8, 19), standard("#262030"));
    sideWall.position.set(side * 9.2, 2.4, -44.5);
    sideWall.castShadow = sideWall.receiveShadow = true;
    group.add(sideWall);

    for (const sz of [-38, -43, -48]) {
      const sconce = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 8, 8),
        standard("#ffe4a0", { emissive: "#ffae42", emissiveIntensity: 0.9 }),
      );
      sconce.position.set(side * 8.85, 3.1, sz);
      group.add(sconce);
    }

    colliders.boxes.push({ x: side * 9.2, z: -44.5, hw: 0.35, hd: 9.5 });
  }

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 5.2, 1.1), standard("#2d2538"));
    pillar.position.set(side * 4.2, 2.6, -34.5);
    pillar.castShadow = true;
    group.add(pillar);
    colliders.boxes.push({ x: side * 4.2, z: -34.5, hw: 0.55, hd: 0.55 });
  }
  const archTop = new THREE.Mesh(
    new THREE.BoxGeometry(9.6, 0.9, 1.2),
    standard("#241d2f", { emissive: "#3b2d54", emissiveIntensity: 0.35 }),
  );
  archTop.position.set(0, 5.4, -34.5);
  group.add(archTop);

  const screenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CINEMA_HALL.screenWidth, CINEMA_HALL.screenHeight),
    new THREE.MeshBasicMaterial({ color: "#ffffff" }),
  );
  screenMesh.position.set(0, CINEMA_HALL.screenY, CINEMA_HALL.screenZ);
  group.add(screenMesh);

  const screenLight = new THREE.PointLight("#5b8def", 3.5, 24, 1.5);
  screenLight.position.set(0, 3.8, -50);
  group.add(screenLight);

  const cushionMat = standard("#b8324f", { roughness: 0.75 });
  const armMat = standard("#252730", { roughness: 0.6 });
  const seatGeo = new THREE.BoxGeometry(0.85, 0.14, 0.75);
  const backGeo = new THREE.BoxGeometry(0.85, 0.72, 0.14);
  const armGeo = new THREE.BoxGeometry(0.1, 0.35, 0.72);
  const pedestalGeo = new THREE.CylinderGeometry(0.14, 0.22, 0.4, 8);

  for (let i = 0; i < 24; i++) {
    const s = CINEMA_SEATS[i]!;
    const chair = new THREE.Group();
    chair.position.set(s.x, 0, s.z);

    const ped = new THREE.Mesh(pedestalGeo, armMat);
    ped.position.y = 0.2;
    chair.add(ped);

    const cushion = new THREE.Mesh(seatGeo, cushionMat);
    cushion.position.y = 0.42;
    cushion.castShadow = cushion.receiveShadow = true;
    chair.add(cushion);

    const back = new THREE.Mesh(backGeo, cushionMat);
    back.position.set(0, 0.78, 0.32);
    back.castShadow = back.receiveShadow = true;
    chair.add(back);

    for (const ax of [-0.42, 0.42]) {
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(ax, 0.56, 0.02);
      chair.add(arm);
    }

    group.add(chair);
  }

  colliders.boxes.push({ x: 0, z: -52.8, hw: 8.5, hd: 2.6 });
  scene.add(group);

  createNoticeBoard(scene, colliders, {
    x: -6.8,
    z: -33.2,
    yaw: 0,
    title: "CINEMA HALL",
    lines: [
      "Walk inside & press E to sit in a seat",
      "1st person inside is Host & pastes link to play",
      "Press F to expand screen · Friend-only voice",
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
