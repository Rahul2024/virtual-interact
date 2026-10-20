import * as THREE from "three";

/**
 * Keyboard movement plus a drag-to-orbit third-person camera.
 * Movement is expressed relative to where the camera looks, so "W" is always
 * "away from me" no matter how the camera is turned.
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
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, -0.05, 1.25);
    });
    const stop = () => (this.dragging = false);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.01, 3, 14);
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

    // Camera forward on the ground plane.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // Right-hand side.
    const rx = -fz;
    const rz = fx;
    out.set(fx * f + rx * s, fz * f + rz * s);
    return out.normalize();
  }

  /** Places the camera behind and above the target, never below the ground. */
  updateCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    const cp = Math.cos(this.pitch);
    const x = target.x + Math.sin(this.yaw) * cp * this.distance;
    const z = target.z + Math.cos(this.yaw) * cp * this.distance;
    const y = Math.max(0.6, target.y + Math.sin(this.pitch) * this.distance);
    camera.position.set(x, y, z);
    camera.lookAt(target);
  }
}
