import * as THREE from "three";
import { CINEMA_HALL } from "@vi/shared";

/**
 * Keyboard + Mobile Touch movement & camera controller:
 * - Desktop: WASD / Arrow keys + mouse drag-to-orbit + scroll wheel zoom.
 * - Mobile / Touch: Virtual thumb joystick vector + single-finger drag-to-orbit
 *   + two-finger pinch-to-zoom (supports simultaneous left-thumb joystick and right-thumb camera look).
 * - Also supports Cinema Seated View and Poker Table Seated View.
 */
export class Controls {
  private keys = new Set<string>();
  private activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDist = 0;

  private joyX = 0;
  private joyY = 0;
  private joyRunning = false;
  private mobileRunLock = false;

  yaw = Math.PI; // camera behind the player, player facing -z on spawn
  pitch = 0.35;
  distance = 7;

  /** When true (e.g. chat input focused) movement keys are ignored. */
  blocked = false;
  /** True when the player is sitting in a Cinema Hall seat. */
  seatedInCinema = false;
  /** True when seated at the poker table: camera stays behind your own seat. */
  seatedAtPoker = false;
  private pokerBaseYaw = 0;

  constructor(private readonly canvas: HTMLElement) {
    window.addEventListener("keydown", (e) => {
      if (this.blocked) return;
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.activePointers.clear();
      this.lastPinchDist = 0;
    });

    canvas.addEventListener("pointerdown", (e) => {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        this.lastPinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      const prev = this.activePointers.get(e.pointerId);
      if (!prev) return;

      if (this.activePointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        prev.x = e.clientX;
        prev.y = e.clientY;
        const sens = e.pointerType === "touch" ? 0.0065 : 0.005;
        this.yaw -= dx * sens;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * sens, -0.08, 1.25);
      } else if (this.activePointers.size >= 2) {
        prev.x = e.clientX;
        prev.y = e.clientY;
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (this.lastPinchDist > 0) {
          const delta = this.lastPinchDist - dist;
          this.distance = THREE.MathUtils.clamp(this.distance + delta * 0.025, 2.5, 14);
        }
        this.lastPinchDist = dist;
      }
    });

    const stopPointer = (e: PointerEvent) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) {
        this.lastPinchDist = 0;
      }
    };
    canvas.addEventListener("pointerup", stopPointer);
    canvas.addEventListener("pointercancel", stopPointer);

    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.01, 2.5, 14);
      },
      { passive: false },
    );
  }

  /** Updates the virtual mobile thumbstick state (-1..1 for x and y). */
  setJoystick(x: number, y: number, running: boolean) {
    this.joyX = x;
    this.joyY = y;
    this.joyRunning = running;
  }

  toggleMobileRun(): boolean {
    this.mobileRunLock = !this.mobileRunLock;
    return this.mobileRunLock;
  }

  get running(): boolean {
    return (
      this.keys.has("ShiftLeft") ||
      this.keys.has("ShiftRight") ||
      this.joyRunning ||
      this.mobileRunLock
    );
  }

  /** Desired movement direction in world XZ, unit length or zero. */
  moveVector(out: THREE.Vector2): THREE.Vector2 {
    if (this.blocked) return out.set(0, 0);

    let f = -this.joyY;
    let s = this.joyX;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) f += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) f -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) s += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) s -= 1;
    if (Math.abs(f) < 0.05 && Math.abs(s) < 0.05) return out.set(0, 0);

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = -fz;
    const rz = fx;
    out.set(fx * f + rx * s, fz * f + rz * s);
    return out.normalize();
  }

  /** Snap camera smoothly when sitting down in a cinema seat. */
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

  /**
   * Sit at the poker table: the camera settles over your shoulder, looking down
   * at your cards and across the felt. You can glance left and right at your
   * neighbours but never swing around behind another player's cards.
   */
  enterPokerSeatView(seat: { x: number; z: number }, table: { x: number; z: number }) {
    this.seatedAtPoker = true;
    this.seatedInCinema = false;
    // Camera sits on the far side of the seat from the table.
    this.pokerBaseYaw = Math.atan2(seat.x - table.x, seat.z - table.z);
    this.yaw = this.pokerBaseYaw;
    // Steep and high, so your own head never sits between the camera and the felt.
    this.pitch = 0.95;
    this.distance = 2.4;
  }

  exitPokerSeatView() {
    if (!this.seatedAtPoker) return;
    this.seatedAtPoker = false;
    this.pitch = 0.35;
    this.distance = 7;
  }

  /** Places the camera behind and above the target, or in auditorium view when seated. */
  updateCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3) {
    if (this.seatedAtPoker) {
      // Clamp the look-around so you can't peek over a neighbour's shoulder.
      let d = this.yaw - this.pokerBaseYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      d = THREE.MathUtils.clamp(d, -1.0, 1.0);
      this.yaw = this.pokerBaseYaw + d;
      this.pitch = THREE.MathUtils.clamp(this.pitch, 0.6, 1.35);
      this.distance = THREE.MathUtils.clamp(this.distance, 1.8, 3.4);
      const cp = Math.cos(this.pitch);
      const x = target.x + Math.sin(this.yaw) * cp * this.distance;
      const z = target.z + Math.cos(this.yaw) * cp * this.distance;
      const y = target.y + 0.15 + Math.sin(this.pitch) * this.distance;
      camera.position.set(x, y, z);
      // Look a little past the player, at the felt in front of them.
      // Aim between your cards and the middle of the table so the board is always in view.
      camera.lookAt(target.x - Math.sin(this.yaw) * 2.2, target.y - 0.75, target.z - Math.cos(this.yaw) * 2.2);
      return;
    }
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
