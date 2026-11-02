import { WORLD } from "@vi/shared";

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

export interface BoxCollider {
  x: number;
  z: number;
  /** half width (x) */
  hw: number;
  /** half depth (z) */
  hd: number;
}

export class Colliders {
  readonly circles: CircleCollider[] = [];
  readonly boxes: BoxCollider[] = [];
  /** Boxes that come and go with game state (dungeon doors). Replaced wholesale each frame. */
  dynamic: BoxCollider[] = [];

  /**
   * Pushes a point with the given radius out of every collider and the world
   * bounds. Good enough for a plaza; a real physics engine is a later plug-in.
   */
  resolve(pos: { x: number; z: number }, radius: number): void {
    for (const c of this.circles) {
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const min = c.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.0001;
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
    this.resolveBoxes(this.boxes, pos, radius);
    this.resolveBoxes(this.dynamic, pos, radius);
    const limit = WORLD.half - radius;
    if (pos.x > limit) pos.x = limit;
    if (pos.x < -limit) pos.x = -limit;
    if (pos.z > limit) pos.z = limit;
    if (pos.z < -limit) pos.z = -limit;
  }

  private resolveBoxes(boxes: BoxCollider[], pos: { x: number; z: number }, radius: number): void {
    for (const b of boxes) {
      const hw = b.hw + radius;
      const hd = b.hd + radius;
      const dx = pos.x - b.x;
      const dz = pos.z - b.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
        const px = hw - Math.abs(dx);
        const pz = hd - Math.abs(dz);
        if (px < pz) pos.x = b.x + Math.sign(dx || 1) * hw;
        else pos.z = b.z + Math.sign(dz || 1) * hd;
      }
    }
  }
}
