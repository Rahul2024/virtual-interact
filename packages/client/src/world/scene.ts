import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  ARCADE_ZONE,
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
  forestGrass: "#456e43",
  stone: "#cfc8bb",
  road: "#484d59",
  path: "#bdb5a6",
  water: "#3b8ec2",
  trunk: "#7a4e33",
  leaves: ["#3f8f4f", "#4ea35a", "#5fb86a", "#2e6b3b"],
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
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra });
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
  targetX: number;
  targetZ: number;
  targetRot: number;
}

export function createWorld(container: HTMLElement, labelContainer: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelContainer });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.skyDay);
  scene.fog = new THREE.Fog(PALETTE.skyDay, 75, 210);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 450);
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

  // South District: Campfire Basecamp & Deep Forest Wilderness
  const { campfireLight, flameGroup } = addCampfireAndForestWilderness(scene, colliders);

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
    syncAnimals(animals: AnimalRenderState[]) {
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
        entry.group.position.y = Math.abs(Math.sin(performance.now() * 0.008 + entry.targetX)) * 0.12;
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

      const hour =
        worldObj.timeMode === "day"
          ? 12.5
          : worldObj.timeMode === "sunset"
            ? 18.0
            : worldObj.timeMode === "night"
              ? 22.5
              : getIndianHourFloat();

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
        scene.fog.near = THREE.MathUtils.lerp(75, 42, nightFactor);
        scene.fog.far = THREE.MathUtils.lerp(215, 145, nightFactor);
      }

      sun.intensity = THREE.MathUtils.lerp(2.2, 0.22, nightFactor);
      sun.color.set(nightFactor > 0.3 && nightFactor < 0.8 ? "#ff9e66" : nightFactor >= 0.8 ? "#6b8cff" : "#fff4e0");
      hemi.intensity = THREE.MathUtils.lerp(0.9, 0.24, nightFactor);

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
      campfireLight.intensity = THREE.MathUtils.lerp(2.8, 7.5, nightFactor) + Math.sin(tSec * 9) * 0.4;
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
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -125;
  sun.shadow.camera.right = 125;
  sun.shadow.camera.top = 125;
  sun.shadow.camera.bottom = -125;
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
    const r = 190;
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

function Float232ArrayOrFloat32(n: number) {
  return new Float32Array(n);
}

function addGroundAndRingRoad(scene: THREE.Scene) {
  const size = WORLD.size + 100;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), standard(PALETTE.grass));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const forestGround = new THREE.Mesh(new THREE.PlaneGeometry(320, 145), standard(PALETTE.forestGrass));
  forestGround.rotation.x = -Math.PI / 2;
  forestGround.position.set(0, 0.008, 104);
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

/** Subtle floor ring marking the Open Voice Zone around the fountain (no floating HTML banner!). */
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
  colliders.circles.push({ x: z, z: x, r: 0 }); // no-op placeholder
  colliders.circles.pop();
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
    [0, 29, 5.5, 30],
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

/** North-East Open-Mic Stage (`x = 24, z = -42`) with a 3D wooden notice board. */
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

/** North-West Shared Pixel Graffiti Mural Wall (`x = -24, z = -42`) with a 3D notice board. */
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

/** West District: Team Football (Soccer) Stadium (`x = -82, z = 0`) with a 3D Scoreboard Notice Board. */
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

/** East District: Multiplayer Neon Arcade Plaza (`x = +82, z = 0`) with a 3D wooden notice board. */
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
 * South District: Campfire Basecamp (`z = +44`) + Deep Forest Wilderness
 * with a single physical 3D wooden notice board (no floating HTML tags!).
 */
function addCampfireAndForestWilderness(scene: THREE.Scene, colliders: Colliders) {
  const cx = CAMPFIRE_BASE.x;
  const cz = CAMPFIRE_BASE.z;
  const g = new THREE.Group();

  const clearing = new THREE.Mesh(new THREE.CircleGeometry(11.5, 36), standard("#8c7355"));
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.set(cx, 0.02, cz);
  clearing.receiveShadow = true;
  g.add(clearing);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32, 0), standard("#6b7280"));
    rock.position.set(cx + Math.cos(a) * 1.15, 0.2, cz + Math.sin(a) * 1.15);
    g.add(rock);
  }

  const flameGroup = new THREE.Group();
  flameGroup.position.set(cx, 0.2, cz);
  const outerFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.75, 1.65, 7),
    standard("#ff7b00", { emissive: "#ff5500", emissiveIntensity: 1.8 }),
  );
  outerFlame.position.y = 0.8;
  const innerFlame = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 1.1, 6),
    standard("#ffe66d", { emissive: "#ffcf33", emissiveIntensity: 2.2 }),
  );
  innerFlame.position.y = 0.55;
  flameGroup.add(outerFlame, innerFlame);
  g.add(flameGroup);

  const campfireLight = new THREE.PointLight("#ff8c2b", 4.5, 28, 1.3);
  campfireLight.position.set(cx, 2.2, cz);
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

  // Winding Forest River at z = +108 with Two Wooden Bridges
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 9),
    standard(PALETTE.water, { roughness: 0.25, emissive: "#164e78", emissiveIntensity: 0.3 }),
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.02, 108);
  g.add(river);

  for (const bx of [-22, 22]) {
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.35, 11), standard("#7c5234"));
    bridge.position.set(bx, 0.18, 108);
    bridge.receiveShadow = true;
    g.add(bridge);
  }

  for (const rx of [-38, 38]) {
    for (let p = 0; p < 4; p++) {
      const a = (p / 4) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 4.5, 8), standard("#94a3b8"));
      col.position.set(rx + Math.cos(a) * 4.5, 2.25, 136 + Math.sin(a) * 4.5);
      col.castShadow = true;
      g.add(col);
    }
  }

  scene.add(g);

  createNoticeBoard(scene, colliders, {
    x: cx + 6.2,
    z: cz - 6.5,
    yaw: Math.PI,
    title: "CAMPFIRE & FOREST",
    lines: [
      "Press E near logs to sit & talk in the circle",
      "Grab a Torch, Spear, or Bow from the rack",
      "Hunt animals south (SPACE) & roast meat here",
    ],
  });

  return { campfireLight, flameGroup };
}

/** Pure 3D low-poly forest animal mesh (no floating HTML tags!). */
function createAnimalMesh(species: string): AnimalMeshEntry {
  const group = new THREE.Group();
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
    targetX: 0,
    targetZ: 75,
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

  // Physical 3D wooden Notice Board outside the Cinema Hall entrance
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

function addCityAndForestTrees(scene: THREE.Scene, colliders: Colliders) {
  const rand = mulberry32(20261027);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.7, 7);
  const trunkMat = standard(PALETTE.trunk);
  const leafGeos = [new THREE.ConeGeometry(1.5, 2.8, 7), new THREE.ConeGeometry(1.2, 2.3, 7)];
  const leafMats = PALETTE.leaves.map((c) => standard(c));
  const berryMat = standard("#e63946", { emissive: "#b91c1c", emissiveIntensity: 0.3 });

  let placed = 0;
  let attempts = 0;
  while (placed < 165 && attempts < 1400) {
    attempts++;
    const inSouthForest = placed >= 55;
    const x = inSouthForest ? (rand() * 2 - 1) * 125 : (rand() * 2 - 1) * 95;
    const z = inSouthForest ? 50 + rand() * 102 : (rand() * 2 - 1) * 85;

    const distOrigin = Math.hypot(x, z);
    if (distOrigin < 18) continue;
    if (distOrigin > 27 && distOrigin < 36) continue;
    if (Math.abs(x) < 5 && z > -40 && z < 48) continue;
    if (Math.abs(z) < 5 && Math.abs(x) < 70) continue;
    if (z < -30 && Math.abs(x) < 35) continue;
    if (Math.abs(x - FOOTBALL_STADIUM.centerX) < 26 && Math.abs(z) < 20) continue;
    if (Math.hypot(x - ARCADE_ZONE.centerX, z - ARCADE_ZONE.centerZ) < 17) continue;
    if (Math.hypot(x - CAMPFIRE_BASE.x, z - CAMPFIRE_BASE.z) < 15) continue;
    if (Math.abs(z - 108) < 7) continue;

    if (colliders.boxes.some((b) => Math.abs(x - b.x) < b.hw + 2.5 && Math.abs(z - b.z) < b.hd + 2.5)) continue;
    if (colliders.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 2.2)) continue;

    const tree = new THREE.Group();
    const scale = inSouthForest ? 0.95 + rand() * 0.95 : 0.8 + rand() * 0.65;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.85;
    trunk.castShadow = true;
    tree.add(trunk);
    const leaves = new THREE.Mesh(leafGeos[placed % 2]!, leafMats[placed % leafMats.length]!);
    leaves.position.y = 2.6;
    leaves.castShadow = true;
    tree.add(leaves);
    const crown = new THREE.Mesh(leafGeos[1]!, leafMats[(placed + 1) % leafMats.length]!);
    crown.position.y = 3.85;
    crown.castShadow = true;
    tree.add(crown);

    if (inSouthForest && placed % 7 === 0) {
      const bush = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 1), leafMats[0]!);
      bush.position.set(1.1, 0.35, 0.4);
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), berryMat);
      berry.position.set(1.1, 0.75, 0.55);
      tree.add(bush, berry);
    }

    tree.scale.setScalar(scale);
    tree.rotation.y = rand() * Math.PI * 2;
    tree.position.set(x, 0, z);
    scene.add(tree);

    colliders.circles.push({ x, z, r: 0.35 * scale });
    placed++;
  }
}
