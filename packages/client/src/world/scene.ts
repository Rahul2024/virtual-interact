import * as THREE from "three";
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { WORLD } from "@vi/shared";
import { Colliders } from "./collision";

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  colliders: Colliders;
  resize(): void;
  render(): void;
}

const PALETTE = {
  sky: "#bfd9f2",
  grass: "#6fa86a",
  stone: "#cfc8bb",
  path: "#bdb5a6",
  water: "#4fa3d9",
  trunk: "#8a5a3c",
  leaves: ["#3f8f4f", "#4ea35a", "#5fb86a", "#3a7f47"],
  buildings: ["#e9c4a8", "#c8d8e8", "#f1e0a6", "#d9c3e6", "#bfe0c9", "#f3c6c6", "#dcd3c2"],
  roof: "#6b5b53",
  lamp: "#3b3f46",
  bench: "#9a7351",
} as const;

/** Deterministic pseudo-random so everyone sees the same trees. */
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

export function createWorld(container: HTMLElement, labelContainer: HTMLElement): World {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelContainer });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 70, 170);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  camera.position.set(0, 6, 12);

  const colliders = new Colliders();

  addLights(scene);
  addGround(scene);
  addPlaza(scene, colliders);
  addPaths(scene);
  addStage(scene, colliders);
  addBuildings(scene, colliders);
  addTrees(scene, colliders);

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

  return {
    scene,
    camera,
    renderer,
    labelRenderer,
    colliders,
    resize,
    render() {
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    },
  };
}

function addLights(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight("#dcecff", "#5f7f4f", 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#fff4e0", 2.2);
  sun.position.set(40, 60, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -75;
  sun.shadow.camera.right = 75;
  sun.shadow.camera.top = 75;
  sun.shadow.camera.bottom = -75;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);
}

function addGround(scene: THREE.Scene) {
  const size = WORLD.size + 80; // grass extends past the walkable bounds into the fog
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), standard(PALETTE.grass));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function addPlaza(scene: THREE.Scene, colliders: Colliders) {
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(15, 48), standard(PALETTE.stone));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  scene.add(plaza);

  // Fountain: basin, water, column.
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 24), standard("#b9b2a5"));
  basin.position.y = 0.35;
  basin.castShadow = basin.receiveShadow = true;
  scene.add(basin);

  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 0.1, 24),
    standard(PALETTE.water, { roughness: 0.3, emissive: "#1b5f8f", emissiveIntensity: 0.25 }),
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

  // Lamp posts and benches around the plaza.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 13;
    const z = Math.sin(a) * 13;
    if (i % 2 === 0) addLamp(scene, colliders, x, z);
    else addBench(scene, colliders, x, z, a + Math.PI / 2);
  }
}

function addLamp(scene: THREE.Scene, colliders: Colliders, x: number, z: number) {
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

function addPaths(scene: THREE.Scene) {
  const mat = standard(PALETTE.path);
  const length = WORLD.half - 14;
  const mid = 14 + length / 2;
  const specs: Array<[number, number, number, number]> = [
    [0, -mid, 5, length], // north
    [0, mid, 5, length], // south
    [mid, 0, length, 5], // east
    [-mid, 0, length, 5], // west
  ];
  for (const [x, z, w, d] of specs) {
    const path = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    path.rotation.x = -Math.PI / 2;
    path.position.set(x, 0.015, z);
    path.receiveShadow = true;
    scene.add(path);
  }
}

/** A small stage at the north end: the first event venue. */
function addStage(scene: THREE.Scene, colliders: Colliders) {
  const x = 0;
  const z = -52;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 7), standard("#8c7b6b"));
  floor.position.set(x, 0.4, z);
  floor.castShadow = floor.receiveShadow = true;
  scene.add(floor);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 0.4), standard("#5a4f47"));
  wall.position.set(x, 3.3, z - 3.3);
  wall.castShadow = true;
  scene.add(wall);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 3.2),
    standard("#1c2230", { emissive: "#2b3a55", emissiveIntensity: 0.5, flatShading: false }),
  );
  screen.position.set(x, 3.4, z - 3.09);
  scene.add(screen);

  colliders.boxes.push({ x, z, hw: 7, hd: 3.5 });
  colliders.boxes.push({ x, z: z - 3.3, hw: 7, hd: 0.2 });
}

function addBuildings(scene: THREE.Scene, colliders: Colliders) {
  // [x, z, width, depth, height]
  const specs: Array<[number, number, number, number, number]> = [
    [26, -26, 12, 10, 9],
    [40, -12, 9, 9, 13],
    [-26, -26, 11, 11, 7],
    [-42, -14, 10, 8, 10],
    [26, 26, 12, 9, 8],
    [42, 14, 9, 11, 12],
    [-26, 26, 10, 10, 9],
    [-40, 16, 12, 8, 6],
    [14, -44, 9, 8, 7],
    [-16, -44, 9, 8, 11],
    [16, 44, 10, 8, 8],
    [-16, 44, 10, 8, 6],
  ];
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

    // Windows: a strip of darker quads on the side facing the plaza.
    const facing = Math.abs(x) > Math.abs(z) ? "x" : "z";
    const rows = Math.max(1, Math.floor(h / 3));
    const cols = Math.max(2, Math.floor((facing === "x" ? d : w) / 2.5));
    const winMat = standard("#28364d", { emissive: "#ffd98a", emissiveIntensity: 0.15, flatShading: false });
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

function addTrees(scene: THREE.Scene, colliders: Colliders) {
  const rand = mulberry32(20261020);
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 7);
  const trunkMat = standard(PALETTE.trunk);
  const leafGeos = [new THREE.ConeGeometry(1.4, 2.6, 7), new THREE.ConeGeometry(1.1, 2.2, 7)];
  const leafMats = PALETTE.leaves.map((c) => standard(c));

  let placed = 0;
  let attempts = 0;
  while (placed < 70 && attempts < 600) {
    attempts++;
    const x = (rand() * 2 - 1) * (WORLD.half - 4);
    const z = (rand() * 2 - 1) * (WORLD.half - 4);
    if (Math.hypot(x, z) < 18) continue; // plaza
    if (Math.abs(x) < 4 || Math.abs(z) < 4) continue; // paths
    if (z < -44 && Math.abs(x) < 10) continue; // stage
    if (colliders.boxes.some((b) => Math.abs(x - b.x) < b.hw + 2.5 && Math.abs(z - b.z) < b.hd + 2.5)) continue;
    if (colliders.circles.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 2.5)) continue;

    const tree = new THREE.Group();
    const scale = 0.8 + rand() * 0.7;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.8;
    trunk.castShadow = true;
    tree.add(trunk);
    const leaves = new THREE.Mesh(leafGeos[placed % 2]!, leafMats[placed % leafMats.length]!);
    leaves.position.y = 2.6;
    leaves.castShadow = true;
    tree.add(leaves);
    const crown = new THREE.Mesh(leafGeos[1]!, leafMats[(placed + 1) % leafMats.length]!);
    crown.position.y = 3.8;
    crown.castShadow = true;
    tree.add(crown);
    tree.scale.setScalar(scale);
    tree.rotation.y = rand() * Math.PI * 2;
    tree.position.set(x, 0, z);
    scene.add(tree);

    colliders.circles.push({ x, z, r: 0.35 * scale });
    placed++;
  }
}
