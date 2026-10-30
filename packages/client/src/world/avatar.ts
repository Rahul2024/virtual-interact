import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { ANIM, PLAYER, TEAM, TOOL, type Anim, type TeamId, type ToolId } from "@vi/shared";

const SKIN = "#f1c9a5";

/**
 * A low-poly person built from primitives. Supports walking, running, sitting
 * in cinema or campfire seats, theater emotes, hunting attack lunges,
 * hand-held tools (Torch with real PointLight, Hunting Spear, Wooden Bow),
 * Football Team jersey badges, Friend badges, and clickable nameplates.
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
  seatId = -1;
  tool: ToolId = TOOL.none;
  team: TeamId = TEAM.none;
  mimicTrapped = 0;

  private body: THREE.Mesh;
  private headGroup: THREE.Group;
  private mouth!: THREE.Mesh;
  private speaking = false;
  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private popcornTub: THREE.Group;
  private torchGroup: THREE.Group;
  private torchLight: THREE.PointLight;
  private spearGroup: THREE.Group;
  private bowGroup: THREE.Group;
  private phase = Math.random() * Math.PI * 2;
  private swing = 0;

  private nameEl: HTMLDivElement;
  private teamBadgeEl: HTMLSpanElement;
  private friendBadgeEl: HTMLSpanElement;
  private nameText!: HTMLSpanElement;
  private micEl!: HTMLSpanElement;
  private bubbleEl: HTMLDivElement;
  private reactionEl: HTMLDivElement;
  private bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  private reactionTimer: ReturnType<typeof setTimeout> | undefined;

  onClick: (() => void) | undefined;

  constructor(name: string, color: string, isMe = false) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.9, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: "#1f2328", roughness: 0.6 });
    const woodMat = new THREE.MeshStandardMaterial({ color: "#8a5a3c", roughness: 0.85, flatShading: true });
    const steelMat = new THREE.MeshStandardMaterial({ color: "#cfd8e3", roughness: 0.4, metalness: 0.5, flatShading: true });

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

    // 3D Popcorn Tub attached to left hand
    this.popcornTub = new THREE.Group();
    const tub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.08, 0.22, 8),
      new THREE.MeshStandardMaterial({ color: "#e63946", roughness: 0.7, flatShading: true }),
    );
    const kernels = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      new THREE.MeshStandardMaterial({ color: "#ffe66d", roughness: 0.8, flatShading: true }),
    );
    kernels.position.y = 0.1;
    this.popcornTub.add(tub, kernels);
    this.popcornTub.position.set(0.08, -0.62, 0.12);
    this.popcornTub.visible = false;
    this.armL.add(this.popcornTub);

    // 1. Hand-held Night Torch (with real PointLight for dark forest exploration!)
    this.torchGroup = new THREE.Group();
    const torchStick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.55, 7), woodMat);
    torchStick.position.y = 0.2;
    const torchFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.24, 7),
      new THREE.MeshStandardMaterial({ color: "#ffae33", emissive: "#ff6b00", emissiveIntensity: 1.8, flatShading: true }),
    );
    torchFlame.position.y = 0.52;
    this.torchLight = new THREE.PointLight("#ff9e3b", 0, 18, 1.4);
    this.torchLight.position.set(0, 0.6, 0.1);
    this.torchGroup.add(torchStick, torchFlame, this.torchLight);
    this.torchGroup.position.set(0, -0.62, 0.08);
    this.torchGroup.rotation.x = Math.PI / 3;
    this.torchGroup.visible = false;
    this.armR.add(this.torchGroup);

    // 2. Hand-held Hunting Spear
    this.spearGroup = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.55, 7), woodMat);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.26, 6), steelMat);
    tip.position.y = 0.88;
    this.spearGroup.add(shaft, tip);
    this.spearGroup.position.set(0, -0.62, 0.15);
    this.spearGroup.rotation.x = Math.PI / 2.2;
    this.spearGroup.visible = false;
    this.armR.add(this.spearGroup);

    // 3. Hand-held Wooden Bow
    this.bowGroup = new THREE.Group();
    const bowArc = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.028, 6, 14, Math.PI), woodMat);
    bowArc.rotation.z = -Math.PI / 2;
    const bowString = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.76, 4),
      new THREE.MeshBasicMaterial({ color: "#e2e8f0" }),
    );
    this.bowGroup.add(bowArc, bowString);
    this.bowGroup.position.set(0, -0.62, 0.18);
    this.bowGroup.rotation.y = Math.PI / 2;
    this.bowGroup.visible = false;
    this.armR.add(this.bowGroup);

    // Head group with two eyes on the +z side.
    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 1.74;
    this.group.add(this.headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), skin);
    head.castShadow = true;
    this.headGroup.add(head);
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), dark);
      eye.position.set(ex, 0.04, 0.19);
      this.headGroup.add(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), dark);
    this.mouth.position.set(0, -0.06, 0.21);
    this.headGroup.add(this.mouth);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), mat);
    cap.position.y = 0.02;
    this.headGroup.add(cap);

    // Nameplate, floating emoji reaction, and chat bubble as DOM.
    const label = document.createElement("div");
    label.className = "label";

    this.reactionEl = document.createElement("div");
    this.reactionEl.className = "label-reaction";

    this.bubbleEl = document.createElement("div");
    this.bubbleEl.className = "label-bubble";

    this.nameEl = document.createElement("div");
    this.nameEl.className = "label-name" + (isMe ? " me" : " clickable");
    if (!isMe) {
      this.nameEl.title = "Click to Add Friend or interact";
      this.nameEl.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onClick?.();
      });
    }

    this.teamBadgeEl = document.createElement("span");
    this.teamBadgeEl.className = "label-team";

    this.friendBadgeEl = document.createElement("span");
    this.friendBadgeEl.className = "label-friend";
    this.friendBadgeEl.textContent = "★ ";
    this.friendBadgeEl.title = "Friend (Voice connected anywhere)";

    this.nameText = document.createElement("span");
    this.nameText.textContent = name;

    this.micEl = document.createElement("span");
    this.micEl.className = "label-mic";
    this.micEl.title = "Microphone on";

    this.nameEl.append(this.micEl, this.teamBadgeEl, this.friendBadgeEl, this.nameText);
    label.append(this.reactionEl, this.bubbleEl, this.nameEl);

    const labelObj = new CSS2DObject(label);
    labelObj.position.set(0, PLAYER.height + 0.55, 0);
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

  setFriend(isFriend: boolean) {
    this.friendBadgeEl.classList.toggle("on", isFriend);
    this.nameEl.classList.toggle("friend", isFriend);
  }

  setTeam(team: TeamId) {
    this.team = team;
    this.teamBadgeEl.textContent = team === TEAM.red ? "🔴 " : team === TEAM.blue ? "🔵 " : "";
  }

  setTool(tool: ToolId) {
    this.tool = tool;
    this.torchGroup.visible = tool === TOOL.torch;
    this.torchLight.intensity = tool === TOOL.torch ? 4.5 : 0;
    this.spearGroup.visible = tool === TOOL.spear;
    this.bowGroup.visible = tool === TOOL.bow;
  }

  setMic(on: boolean) {
    this.micEl.classList.toggle("on", on);
  }

  setSpeaking(speaking: boolean) {
    this.speaking = speaking;
    this.nameEl.classList.toggle("speaking", speaking);
    if (!speaking) this.mouth.scale.set(1, 1, 1);
  }

  say(text: string, ms = 6000, hiddenByFilter = false) {
    if (hiddenByFilter) return;
    this.bubbleEl.textContent = text;
    this.bubbleEl.classList.add("show");
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.bubbleEl.classList.remove("show"), ms);
  }

  react(emoji: string, ms = 3200) {
    this.reactionEl.textContent = emoji;
    this.reactionEl.classList.remove("show");
    void this.reactionEl.offsetWidth;
    this.reactionEl.classList.add("show");
    if (this.reactionTimer) clearTimeout(this.reactionTimer);
    this.reactionTimer = setTimeout(() => this.reactionEl.classList.remove("show"), ms);
  }

  /** Advance the procedural animation. `dt` in seconds. */
  update(dt: number) {
    const t = performance.now() / 1000;
    const isSeated = this.seatId >= 0 || this.anim === ANIM.sit;
    const isCinemaSeat = this.seatId >= 0 && this.seatId < 24;

    this.popcornTub.visible = this.anim === ANIM.popcorn || isCinemaSeat;
    this.setTool(this.tool);
    if (this.tool === TOOL.torch) {
      this.torchLight.intensity = 6.2 + Math.sin(t * 14) * 0.65 + Math.cos(t * 23) * 0.35;
      this.torchLight.distance = 24;
    }

    // Frieren-style Mimic Chest Trap! Avatar is pitched head-first into the chest with legs kicking wildly!
    if (this.mimicTrapped > 0) {
      this.body.position.y = 0.72;
      this.body.rotation.x = Math.PI * 0.58;
      this.headGroup.position.y = 0.42;
      this.legL.position.y = 1.05;
      this.legR.position.y = 1.05;
      this.legL.rotation.x = Math.PI * 0.48 + Math.sin(t * 19) * 0.55;
      this.legR.rotation.x = Math.PI * 0.48 - Math.sin(t * 19) * 0.55;
      this.armL.position.y = 0.65;
      this.armR.position.y = 0.65;
      this.armL.rotation.x = -Math.PI * 0.4;
      this.armR.rotation.x = -Math.PI * 0.4;
      return;
    }
    this.body.rotation.x = 0;

    if (isSeated) {
      this.body.position.y = 0.86;
      this.headGroup.position.y = 1.47;
      this.legL.position.y = 0.55;
      this.legR.position.y = 0.55;
      this.legL.rotation.x = -Math.PI / 2.2;
      this.legR.rotation.x = -Math.PI / 2.2;
      this.armL.position.y = 1.22;
      this.armR.position.y = 1.22;

      if (this.anim === ANIM.wave) {
        this.armR.rotation.x = -Math.PI * 0.75;
        this.armR.rotation.z = Math.sin(t * 10) * 0.35;
        this.armL.rotation.x = -0.5;
        this.armL.rotation.z = 0;
      } else if (this.anim === ANIM.cheer) {
        this.armL.rotation.x = -Math.PI * 0.8 + Math.sin(t * 12) * 0.2;
        this.armR.rotation.x = -Math.PI * 0.8 - Math.sin(t * 12) * 0.2;
        this.armL.rotation.z = 0.15;
        this.armR.rotation.z = -0.15;
      } else if (this.anim === ANIM.popcorn) {
        this.armL.rotation.x = -0.7;
        this.armR.rotation.x = -1.1 - Math.abs(Math.sin(t * 5)) * 0.85;
        this.armL.rotation.z = 0;
        this.armR.rotation.z = -0.2;
      } else {
        this.armL.rotation.x = -0.55;
        this.armR.rotation.x = -0.45;
        this.armL.rotation.z = 0;
        this.armR.rotation.z = 0;
      }
    } else {
      this.legL.position.y = 0.75;
      this.legR.position.y = 0.75;
      this.armL.position.y = 1.5;
      this.armR.position.y = 1.5;
      this.armL.rotation.z = 0;
      this.armR.rotation.z = 0;

      const moving = this.anim === ANIM.walk || this.anim === ANIM.run;
      const targetSwing = this.anim === ANIM.run ? 1 : this.anim === ANIM.walk ? 0.6 : 0;
      this.swing += (targetSwing - this.swing) * Math.min(1, dt * 12);

      if (moving) this.phase += dt * (this.anim === ANIM.run ? 15 : 9.5);
      const s = Math.sin(this.phase) * this.swing;

      this.legL.rotation.x = s;
      this.legR.rotation.x = -s;

      if (this.anim === ANIM.wave) {
        this.armL.rotation.x = 0;
        this.armR.rotation.x = -Math.PI * 0.82;
        this.armR.rotation.z = Math.sin(t * 10) * 0.35;
      } else if (this.anim === ANIM.cheer) {
        this.armL.rotation.x = -Math.PI * 0.85 + Math.sin(t * 12) * 0.25;
        this.armR.rotation.x = -Math.PI * 0.85 - Math.sin(t * 12) * 0.25;
      } else if (this.anim === ANIM.popcorn) {
        this.armL.rotation.x = -0.75;
        this.armR.rotation.x = -1.1 - Math.abs(Math.sin(t * 5.5)) * 0.85;
        this.armR.rotation.z = -0.2;
      } else if (this.anim === ANIM.mindblown) {
        this.armL.rotation.x = -Math.PI * 0.7;
        this.armR.rotation.x = -Math.PI * 0.7;
        this.armL.rotation.z = 0.3 + Math.sin(t * 9) * 0.15;
        this.armR.rotation.z = -0.3 - Math.sin(t * 9) * 0.15;
      } else if (this.anim === ANIM.attack) {
        this.armL.rotation.x = -0.4;
        this.armR.rotation.x = -Math.PI * 0.55 - Math.sin(t * 18) * 0.45;
      } else {
        this.armL.rotation.x = -s * 0.8;
        this.armR.rotation.x = this.tool !== TOOL.none ? -0.65 + s * 0.25 : s * 0.8;
      }

      const bob = moving
        ? Math.abs(Math.cos(this.phase)) * 0.05 * this.swing
        : this.anim === ANIM.cheer
          ? Math.abs(Math.sin(t * 8)) * 0.08
          : Math.sin(t * 1.8) * 0.01;
      this.body.position.y = 1.13 + bob;
      this.headGroup.position.y = 1.74 + bob;
    }

    if (this.speaking) {
      const open = 1 + Math.max(0, Math.sin(t * 17) * 0.6 + Math.sin(t * 23) * 0.4) * 3;
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
    if (this.reactionTimer) clearTimeout(this.reactionTimer);
  }
}
