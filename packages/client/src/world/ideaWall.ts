import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { IDEA, sortIdeas, type Idea } from "@vi/shared";
import type { Colliders } from "./collision";

/**
 * The Idea Wall: a board in the hub that shows what people want this place to
 * have. Walk up to it and press E to post, vote or claim. Its texture is a
 * canvas redrawn whenever an idea changes, so the world itself shows the list.
 */
export class IdeaWall {
  readonly group = new THREE.Group();
  readonly position = this.group.position;
  /** Metres from the wall within which the prompt shows and E opens it. */
  readonly reach = 4.5;

  private canvas = document.createElement("canvas");
  private texture: THREE.CanvasTexture;
  private prompt: HTMLDivElement;
  private ideas: Idea[] = [];

  constructor(scene: THREE.Scene, colliders: Colliders, x: number, z: number) {
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    const wood = new THREE.MeshStandardMaterial({ color: "#7a5a3e", roughness: 0.9, flatShading: true });

    for (const px of [-2.7, 2.7]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.6, 0.22), wood);
      post.position.set(px, 1.8, 0);
      post.castShadow = true;
      this.group.add(post);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.2, 0.18), wood);
    frame.position.set(0, 2.1, 0);
    frame.castShadow = true;
    this.group.add(frame);

    const board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: this.texture }));
    board.position.set(0, 2.1, 0.1);
    this.group.add(board);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.14, 1.2), wood);
    roof.position.set(0, 3.8, 0.2);
    roof.castShadow = true;
    this.group.add(roof);

    // Floating prompt, shown only when someone is close.
    this.prompt = document.createElement("div");
    this.prompt.className = "label";
    this.prompt.innerHTML = `<span class="label-name">Idea Wall</span><div class="label-prompt">Press <kbd>E</kbd> to open</div>`;
    const label = new CSS2DObject(this.prompt);
    label.position.set(0, 4.3, 0);
    this.group.add(label);
    this.setNear(false);

    this.group.position.set(x, 0, z);
    this.group.rotation.y = Math.atan2(-x, -z); // face the fountain
    scene.add(this.group);
    colliders.circles.push({ x, z, r: 3.3 });

    this.draw();
  }

  setIdeas(ideas: Idea[]) {
    this.ideas = ideas;
    this.draw();
  }

  upsert(idea: Idea) {
    const i = this.ideas.findIndex((x) => x.id === idea.id);
    if (i >= 0) this.ideas[i] = idea;
    else this.ideas.push(idea);
    this.draw();
  }

  isNear(p: { x: number; z: number }): boolean {
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    return dx * dx + dz * dz < this.reach * this.reach;
  }

  setNear(near: boolean) {
    this.prompt.classList.toggle("near", near);
  }

  private draw() {
    const c = this.canvas.getContext("2d")!;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Cork board.
    c.fillStyle = "#d9b98a";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0.06)";
    for (let i = 0; i < 400; i++) {
      c.fillRect((i * 97) % w, (i * 57) % h, 3, 3);
    }

    c.fillStyle = "#2b2118";
    c.font = "bold 54px system-ui, sans-serif";
    c.textBaseline = "top";
    c.fillText("IDEA WALL", 40, 28);
    c.font = "26px system-ui, sans-serif";
    c.fillStyle = "#4a3a2c";
    c.fillText("What should this place have? Post it, vote, build it.", 40, 92);

    const shown = sortIdeas(this.ideas)
      .filter((i) => i.status !== "built")
      .slice(0, IDEA.boardSize);

    if (shown.length === 0) {
      c.font = "italic 30px system-ui, sans-serif";
      c.fillStyle = "#5a4a3c";
      c.fillText("Nothing here yet. Walk up, press E, and be the first.", 40, 190);
    }

    const rowH = 60;
    shown.forEach((idea, i) => {
      const y = 150 + i * rowH;
      // Sticky note.
      c.fillStyle = idea.status === "building" ? "#bfe6c6" : "#fff3a8";
      c.fillRect(40, y, w - 80, rowH - 10);
      c.fillStyle = "rgba(0,0,0,0.12)";
      c.fillRect(40, y + rowH - 12, w - 80, 3);

      c.fillStyle = "#2b2118";
      c.font = "bold 30px system-ui, sans-serif";
      c.fillText(`▲ ${idea.votes.length}`, 56, y + 11);

      c.font = "30px system-ui, sans-serif";
      const title = this.fit(c, idea.title, w - 80 - 160 - (idea.status === "building" ? 230 : 60));
      c.fillText(title, 170, y + 11);

      if (idea.status === "building") {
        c.font = "22px system-ui, sans-serif";
        c.fillStyle = "#1f6b3a";
        const who = idea.builders.map((b) => b.name).join(", ");
        c.textAlign = "right";
        c.fillText(this.fit(c, `building: ${who}`, 300), w - 56, y + 16);
        c.textAlign = "left";
      }
    });

    this.texture.needsUpdate = true;
  }

  private fit(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (c.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && c.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
    return t + "…";
  }
}
