import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class CodexThreadWriterRegistry {
  #activeTurns = new Map();
  #completedTurnIds = new Set();
  #lsofImpl;

  constructor({ lsofImpl = null } = {}) {
    this.#lsofImpl = lsofImpl;
  }

  markActive(rawId, info = {}) {
    const turnId = String(info.turnId || "");
    if (turnId && this.#completedTurnIds.has(turnId)) return;
    this.#activeTurns.set(rawId, {
      turnId,
      startedAt: Date.now(),
      ...info,
    });
  }

  clearActive(rawId, turnId = "") {
    const cleanTurnId = String(turnId || "");
    if (cleanTurnId) {
      if (this.#completedTurnIds.size > 500) {
        const first = this.#completedTurnIds.values().next().value;
        if (first !== undefined) this.#completedTurnIds.delete(first);
      }
      this.#completedTurnIds.add(cleanTurnId);
    }
    const existing = this.#activeTurns.get(rawId);
    if (!existing) return;
    if (cleanTurnId && existing.turnId && existing.turnId !== cleanTurnId) return;
    this.#activeTurns.delete(rawId);
  }

  getActive(rawId) {
    return this.#activeTurns.get(rawId) || null;
  }

  async detectExternalWriter({ rolloutPath = "", thread = null, ignorePids = [] } = {}) {
    const activeTurn = Array.isArray(thread?.turns)
      && thread.turns.some((turn) => turn?.status === "inProgress");
    if (activeTurn) {
      return { busy: true, source: "active_turn", message: "当前会话有正在进行的任务" };
    }
    if (!rolloutPath) return { busy: false };

    const ignoreSet = new Set((ignorePids || []).map((p) => String(p)).filter(Boolean));

    try {
      const info = await stat(rolloutPath);
      const recentlyModified = Date.now() - info.mtimeMs < 2_500;
      if (!recentlyModified) return { busy: false };
      if (this.#lsofImpl) {
        const rawPids = await this.#lsofImpl(rolloutPath);
        const pids = (Array.isArray(rawPids) ? rawPids : []).filter((p) => !ignoreSet.has(String(p)));
        if (pids.length > 0) {
          return { busy: true, source: "external_writer", pids, message: "本地 Codex 客户端正在写入该会话" };
        }
      } else {
        const { stdout } = await execFileAsync("lsof", ["-t", "--", rolloutPath], {
          timeout: 800,
          maxBuffer: 16 * 1024,
        }).catch(() => ({ stdout: "" }));
        const pids = String(stdout || "")
          .trim()
          .split(/\s+/)
          .filter((p) => p && !ignoreSet.has(p));
        if (pids.length > 0) {
          return { busy: true, source: "external_writer", pids, message: "本地 Codex 客户端正在写入该会话" };
        }
      }
    } catch {
      // Ignore stat/lsof failure.
    }
    return { busy: false };
  }
}
