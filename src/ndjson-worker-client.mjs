import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * Manages a long-lived child process speaking line-delimited JSON (NDJSON)
 * over stdin/stdout with a `{ ready: true }` startup handshake.
 */
export class NdjsonWorkerClient {
  #label;
  #readyTimeoutMs;
  #defaultRequestTimeoutMs;
  #stderrLimit;
  #spawnImpl;
  #isClosed;
  #resolveLaunch;
  #child = null;
  #readyPromise = null;
  #stdoutBuf = "";
  #pending = new Map();

  constructor({
    label = "worker",
    readyTimeoutMs = 30_000,
    defaultRequestTimeoutMs = 20_000,
    stderrLimit = 600,
    spawnImpl = spawn,
    isClosed = () => false,
    resolveLaunch,
  } = {}) {
    if (typeof resolveLaunch !== "function") {
      throw new TypeError("NdjsonWorkerClient requires a resolveLaunch function");
    }
    this.#label = label;
    this.#readyTimeoutMs = Math.max(200, Number(readyTimeoutMs) || 30_000);
    this.#defaultRequestTimeoutMs = Math.max(200, Number(defaultRequestTimeoutMs) || 20_000);
    this.#stderrLimit = Math.max(128, Number(stderrLimit) || 600);
    this.#spawnImpl = spawnImpl;
    this.#isClosed = isClosed;
    this.#resolveLaunch = resolveLaunch;
  }

  reset(reason = `${this.#label} 进程已关闭`) {
    const child = this.#child;
    this.#child = null;
    this.#readyPromise = null;
    this.#stdoutBuf = "";
    if (child && !child.killed) {
      try { child.kill("SIGTERM"); } catch {}
    }
    for (const [reqId, entry] of this.#pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.#pending.delete(reqId);
    }
  }

  ensureReady(launchArg = undefined) {
    if (this.#isClosed()) {
      return Promise.reject(Object.assign(new Error("语音服务已关闭"), { status: 503 }));
    }
    if (this.#readyPromise && this.#child && !this.#child.killed) {
      return this.#readyPromise;
    }

    let launch;
    try {
      launch = this.#resolveLaunch(launchArg);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!launch?.cmd) {
      return Promise.reject(new Error(`未检测到 ${this.#label} 启动命令`));
    }

    const readyPromise = new Promise((resolveReady, rejectReady) => {
      let settledReady = false;
      const readyTimer = setTimeout(() => {
        if (!settledReady) {
          settledReady = true;
          const msg = `${this.#label} 启动超时`;
          this.reset(msg);
          rejectReady(new Error(msg));
        }
      }, this.#readyTimeoutMs);
      readyTimer.unref?.();

      let child;
      try {
        child = this.#spawnImpl(launch.cmd, Array.isArray(launch.args) ? launch.args : [], {
          env: launch.env || process.env,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        clearTimeout(readyTimer);
        this.#readyPromise = null;
        rejectReady(error);
        return;
      }

      this.#child = child;
      child.stdin?.on?.("error", () => {});
      let stderrTail = "";

      child.stderr?.on?.("data", (chunk) => {
        stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-this.#stderrLimit);
      });

      child.stdout.on("data", (chunk) => {
        if (this.#child !== child) return;
        this.#stdoutBuf += chunk.toString("utf8");
        while (true) {
          const nl = this.#stdoutBuf.indexOf("\n");
          if (nl === -1) break;
          const line = this.#stdoutBuf.slice(0, nl).trim();
          this.#stdoutBuf = this.#stdoutBuf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (Object.hasOwn(msg, "ready") && !settledReady) {
            settledReady = true;
            clearTimeout(readyTimer);
            if (msg.ready) {
              resolveReady(child);
            } else {
              const errMsg = msg.error || `${this.#label} 初始化失败`;
              this.reset(errMsg);
              rejectReady(new Error(errMsg));
            }
            continue;
          }
          const reqId = String(msg?.id || "");
          if (reqId && this.#pending.has(reqId)) {
            const pending = this.#pending.get(reqId);
            this.#pending.delete(reqId);
            clearTimeout(pending.timer);
            if (msg.ok) {
              pending.resolve(msg);
            } else {
              pending.reject(new Error(msg.error || pending.errorMessage || `${this.#label} 请求失败`));
            }
          }
        }
      });

      child.on("error", (err) => {
        if (this.#child !== child) return;
        clearTimeout(readyTimer);
        if (!settledReady) {
          settledReady = true;
          rejectReady(err);
        }
        this.reset(err?.message || `${this.#label} 进程启动失败`);
      });

      child.on("exit", (code, signal) => {
        if (this.#child !== child) return;
        clearTimeout(readyTimer);
        const reason = stderrTail.trim() || `${this.#label} 进程退出 (${code ?? signal ?? "unknown"})`;
        if (!settledReady) {
          settledReady = true;
          rejectReady(new Error(reason));
        }
        this.reset(reason);
      });
    });

    this.#readyPromise = readyPromise;
    return readyPromise;
  }

  async request(payload = {}, {
    id = "",
    idPrefix = "",
    timeoutMs = this.#defaultRequestTimeoutMs,
    timeoutMessage = `${this.#label} 请求超时`,
    errorMessage = `${this.#label} 请求失败`,
    launchArg = undefined,
  } = {}) {
    const child = await this.ensureReady(launchArg);
    const reqId = id || (idPrefix ? `${idPrefix}${randomUUID().slice(0, 10)}` : randomUUID());
    const encoded = `${JSON.stringify({ id: reqId, ...payload })}\n`;
    const effectiveTimeout = Math.max(200, Number(timeoutMs) || this.#defaultRequestTimeoutMs);
    return new Promise((resolveDone, rejectDone) => {
      const timer = setTimeout(() => {
        this.#pending.delete(reqId);
        this.reset(timeoutMessage);
        rejectDone(new Error(timeoutMessage));
      }, effectiveTimeout);
      timer.unref?.();
      this.#pending.set(reqId, { resolve: resolveDone, reject: rejectDone, timer, errorMessage });
      try {
        child.stdin.write(encoded);
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(reqId);
        rejectDone(err);
      }
    });
  }
}
