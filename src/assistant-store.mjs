import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Serialise read/modify/write as well as the atomic rename, so simultaneous
// alias selections and card actions cannot overwrite one another.
export class AssistantStore {
  #queue = Promise.resolve();
  constructor(dataDir) { this.dir = resolve(dataDir, "assistant"); }
  async read(name, fallback = {}) {
    try { return JSON.parse(await readFile(resolve(this.dir, `${name}.json`), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return structuredClone(fallback); throw error; }
  }
  update(name, mutate, fallback = {}) {
    const run = this.#queue.then(async () => {
      const value = await mutate(await this.read(name, fallback));
      const path = resolve(this.dir, `${name}.json`);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, path);
      return value;
    });
    this.#queue = run.catch(() => {});
    return run;
  }
}
