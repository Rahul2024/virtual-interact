import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Idea } from "@vi/shared";

/**
 * Where the Idea Wall is kept between restarts. The store calls `load` once
 * at boot and `save` (debounced) after every change with the full list, so
 * any key-value shaped thing works. Postgres can slot in here later.
 */
export interface Persistence {
  readonly name: string;
  load(): Promise<Idea[]>;
  save(ideas: Idea[]): Promise<void>;
}

/** Nothing survives a restart. Used by tests. */
export class MemoryPersistence implements Persistence {
  readonly name = "memory";
  async load(): Promise<Idea[]> {
    return [];
  }
  async save(): Promise<void> {}
}

/** One JSON file, written atomically. Right for a laptop or a VM with a disk. */
export class FilePersistence implements Persistence {
  readonly name: string;
  constructor(private readonly file: string) {
    this.name = `file ${file}`;
  }

  async load(): Promise<Idea[]> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { ideas?: Idea[] };
      return raw.ideas ?? [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async save(ideas: Idea[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, ideas }, null, 2), "utf8");
    await rename(tmp, this.file); // atomic on the same filesystem
  }
}

/**
 * Upstash Redis over its REST API: one key holding the whole list. Right for
 * free hosts whose disk is wiped on every restart (Render, Koyeb). The free
 * Upstash tier allows 500k commands a month; we use a few per idea.
 */
export class UpstashPersistence implements Persistence {
  readonly name = "upstash redis";
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly key = "vi:ideas",
  ) {}

  async load(): Promise<Idea[]> {
    const result = await this.command<string | null>(["GET", this.key]);
    if (!result) return [];
    const raw = JSON.parse(result) as { ideas?: Idea[] };
    return raw.ideas ?? [];
  }

  async save(ideas: Idea[]): Promise<void> {
    await this.command(["SET", this.key, JSON.stringify({ version: 1, ideas })]);
  }

  private async command<T>(args: string[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`upstash ${args[0]} failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: string };
    if (body.error) throw new Error(`upstash ${args[0]} failed: ${body.error}`);
    return body.result as T;
  }
}
