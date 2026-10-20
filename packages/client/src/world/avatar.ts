import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { ANIM, PLAYER, type Anim } from "@vi/shared";

const SKIN = "#f1c9a5";

/**
 * A low-poly person built from primitives: the placeholder for the modular
 * avatar system in the design doc. Everything animates procedurally, so there
 * are no animation files to load.
 */
export class Avatar {
  readonly group = new THREE.Group();
  readonly position = this.group.position;

  /** Yaw in radians; rot = 0 faces +z. */
  get rot(): number {
    return this.group.rotation.y;
  }
  set rot(value: number) {
    this.group.rotation.y = value;
  }

  anim: Anim = ANIM.idle;

  private body: THREE.Mesh;
  private mouth!: THREE.Mesh;
  private speaking = false;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private phase = Math.random() * Math.PI * 2;
  private swing = 0;

  private nameEl: HTMLDivElement;
  private nameText!: HTMLSpanElement;
  private micEl!: HTMLSpanElement;
  private bubbleEl: HTMLDivElement;
  private bubbleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(name: string, color: string, isMe = false) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.9, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: "#1f2328", roughness: 0.6 });

    // Legs pivot at the hip.
    const legGeo = new THREE.CylinderGeometry(0.11, 0.1, 0.75, 8);
    this.legL = this.limb(legGeo, mat, -0.14, 0.75, -0.375);
    this.legR = this.limb(legGeo, mat, 0.14, 0.75, -0.375);

    // Torso.
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.45, 4, 10), mat);
    this.body.position.y = 1.13;
    this.body.castShadow = true;
    this.group.add(this.body);

    // Arms pivot at the shoulder.
    const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.6, 8);
    this.armL = this.limb(armGeo, mat, -0.34, 1.5, -0.3);
    this.armR = this.limb(armGeo, mat, 0.34, 1.5, -0.3);
    for (const arm of [this.armL, this.armR]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), skin);
      hand.position.y = -0.62;
      arm.add(hand);
    }

    // Head with two eyes on the +z side.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
    head.position.y = 1.74;
    head.castShadow = true;
    this.group.add(head);
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), dark);
      eye.position.set(ex, 1.78, 0.19);
      this.group.add(eye);
    }
    // Mouth: a thin dark line that opens while speaking.
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), dark);
    this.mouth.position.set(0, 1.68, 0.21);
    this.group.add(this.mouth);
    // A little hair cap in the body colour so the silhouette reads from behind.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), mat);
    cap.position.y = 1.76;
    this.group.add(cap);

    // Nameplate and chat bubble as DOM, so text stays crisp at any zoom.
    const label = document.createElement("div");
    label.className = "label";
    this.bubbleEl = document.createElement("div");
    this.bubbleEl.className = "label-bubble";
    this.nameEl = document.createElement("div");
    this.nameEl.className = "label-name" + (isMe ? " me" : "");
    this.nameText = document.createElement("span");
    this.nameText.textContent = name;
    this.micEl = document.createElement("span");
    this.micEl.className = "label-mic";
    this.micEl.title = "Microphone on";
    this.nameEl.append(this.micEl, this.nameText);
    label.append(this.bubbleEl, this.nameEl);
    const labelObj = new CSS2DObject(label);
    labelObj.position.set(0, PLAYER.height + 0.5, 0);
    this.group.add(labelObj);
  }

  private limb(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, pivotY: number, offsetY: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, pivotY, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = offsetY;
    mesh.castShadow = true;
    pivot.add(mesh);
    this.group.add(pivot);
    return pivot;
  }

  setName(name: string) {
    this.nameText.textContent = name;
  }

  /** Shows the little microphone dot on the nameplate. */
  setMic(on: boolean) {
    this.micEl.classList.toggle("on", on);
  }

  /** Opens the mouth and lights the nameplate while this person talks. */
  setSpeaking(speaking: boolean) {
    this.speaking = speaking;
    this.nameEl.classList.toggle("speaking", speaking);
    if (!speaking) this.mouth.scale.set(1, 1, 1);
  }

  say(text: string, ms = 6000) {
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.add("show");
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.bubbleEl.classList.remove("show"), ms);
  }

  /** Advance the procedural animation. `dt` in seconds. */
  update(dt: number) {
    const moving = this.anim !== ANIM.idle;
    const targetSwing = this.anim === ANIM.run ? 1 : this.anim === ANIM.walk ? 0.6 : 0;
    this.swing += (targetSwing - this.swing) * Math.min(1, dt * 12);

    if (moving) this.phase += dt * (this.anim === ANIM.run ? 15 : 9.5);
    const s = Math.sin(this.phase) * this.swing;

    this.legL.rotation.x = s;
    this.legR.rotation.x = -s;
    this.armL.rotation.x = -s * 0.8;
    this.armR.rotation.x = s * 0.8;

    // Bob when moving, breathe when idle.
    const bob = moving ? Math.abs(Math.cos(this.phase)) * 0.05 * this.swing : Math.sin(performance.now() / 600) * 0.01;
    this.body.position.y = 1.13 + bob;

    if (this.speaking) {
      // A quick irregular open/close reads as talking from a distance.
      const n = performance.now() / 1000;
      const open = 1 + Math.max(0, Math.sin(n * 17) * 0.6 + Math.sin(n * 23) * 0.4) * 3;
      this.mouth.scale.set(1, open, 1);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((obj) => {
      if (obj instanceof CSS2DObject) obj.element.remove();
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      }
    });
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
  }
}
