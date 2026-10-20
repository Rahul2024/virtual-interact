import { resolve } from "node:path";
import { IdeaStore } from "./IdeaStore.js";
import { FilePersistence, MemoryPersistence, UpstashPersistence, type Persistence } from "./persistence.js";

/**
 * One store per process. Where it lives, in order of preference:
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  → Upstash Redis (free hosts with no disk)
 *   IDEAS_FILE=<path>                                  → that JSON file
 *   IDEAS_FILE=  (empty)                               → memory only (tests)
 *   nothing set                                        → ./data/ideas.json
 */
function choosePersistence(env: NodeJS.ProcessEnv): Persistence {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashPersistence(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  }
  if (env.IDEAS_FILE === "") return new MemoryPersistence();
  return new FilePersistence(env.IDEAS_FILE ?? resolve(process.cwd(), "data/ideas.json"));
}

export const ideas = new IdeaStore(choosePersistence(process.env));
export const ideasReady = ideas.load();

export { IdeaStore, IdeaRejected, type IdeaError } from "./IdeaStore.js";
export * from "./persistence.js";
