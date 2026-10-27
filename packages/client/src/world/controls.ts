import * as THREE from "three";
import { CINEMA_HALL } from "@vi/shared";

/**
 * Keyboard movement plus a drag-to-orbit third-person camera.
 * Also supports Cinema Seated View: when seated in the auditorium, the camera
 * frames both the big cinema screen ahead and the people sitting beside you.
 */
export class Controls {
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  yaw = Math.PI; // camera behind the player, player facing -z on spawn
  pitch = 0.35;
  distance = 7;

  /** When true (e.g. chat input focused) movement keys are ignored. */
  blocked = false;
  /** True when the player is sitting in a Cinema Hall seat. */
  seatedInCinema = false;

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (this.blocked) return;
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, -0.08, 1.25);
    });
    const stop = () => (this.dragging = false);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.01, 2.5, 14);
      },
      { passive: false },
    );
  }

  get running(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }

  /** Desired movement direction in world XZ, unit length or zero. */
  moveVector(out: THREE.Vector2): THREE.Vector2 {
    let f = 0;
    let s = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) f += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) f -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) s += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) s -= 1;
    if (f === 0 && s === 0) return out.set(0, 0);

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    out.set(fx * f + rx * s, fz * f + rz * s);
    return out.normalize();
  }

  /**Snap camera smoothly when sitting down in a cinema seat. */
  enterCinemaSeatView() {
    this.seatedInCinema = true;
    this.yaw = 0; // Camera placed +Z behind seated avatar, looking -Z at the screen
    this.pitch = 0.08;
    this.distance = 4.2;
  }

  exitCinemaSeatView() {
    if (!this.seatedInCinema) return;
    this.seatedInCinema = false;
    this.pitch = 0.32;
    this.distance = 7;
  }

  /** Places the camera behind and above the target, or in auditorium view when seated. */
  updateCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    if (this.seatedInCinema) {
      // Allow looking around at neighbors to your left/right while keeping the screen in view
      const cp = Math.cos(this.pitch);
      const x = target.x + Math.sin(this.yaw) * cp * this.distance;
      const z = target.z + Math.cos(this.yaw) * cp * this.distance;
      const y = Math.max(1.2, target.y + 0.35 + Math.sin(this.pitch) * this.distance);
      camera.position.set(x, y, z);

      // Blend lookAt between the player's row and the big cinema screen
      const lookX = target.x * 0.65 - Math.sin(this.yaw) * 6;
      const lookY = THREE.MathUtils.lerp(CINEMA_HALL.screenY * 0.72, 1.5, Math.max(0, this.pitch));
      const lookZ = CINEMA_HALL.screenZ * 0.6 + target.z * 0.4;
      camera.lookAt(lookX, lookY, lookZ);
      return;
    }

    const cp = Math.cos(this.pitch);
    const x = target.x + Math.sin(this.yaw) * cp * this.distance;
    const z = target.z + Math.cos(this.yaw) * cp * this.distance;
    const y = Math.max(0.6, target.y + Math.sin(this.pitch) * this.distance);
    camera.position.set(x, y, z);
    camera.lookAt(target);
  }
}
