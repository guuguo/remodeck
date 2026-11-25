import { apiGet, apiPost } from "./api-client.js?v=20261118demo";

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function initHumanVerifyOverlay() {
  if (typeof document === "undefined" || !document.body) {
    return {
      syncList() {},
      upsert() {},
      remove() {},
      async refreshFromServer() {},
    };
  }

  let backdrop = document.getElementById("humanVerifyBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "humanVerifyBackdrop";
    backdrop.className = "hv-backdrop";
    backdrop.hidden = true;
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "hvTitle");
    backdrop.innerHTML = `
      <div class="hv-card">
        <div class="hv-head">
          <div class="hv-head-meta">
            <span id="hvSource" class="hv-source">Agent</span>
            <span id="hvQueueBadge" class="hv-queue-badge" hidden>1 / 1</span>
          </div>
          <div class="hv-head-right">
            <span id="hvCountdown" class="hv-countdown">剩余 120s</span>
            <button type="button" id="hvCloseBtn" class="hv-close-btn" title="取消验证 (Esc)" aria-label="取消验证">×</button>
          </div>
        </div>
        <h3 id="hvTitle" class="hv-title">需要人工动态验证</h3>
        <p id="hvSubtitle" class="hv-subtitle" hidden></p>
        <div id="hvImageWrap" class="hv-image-wrap" hidden>
          <img id="hvImage" class="hv-image" alt="动态验证码图片" />
          <button type="button" id="hvRefreshBtn" class="hv-refresh-btn" hidden>刷新图片</button>
        </div>
        <form id="hvForm" class="hv-form" novalidate>
          <div id="hvFields" class="hv-fields"></div>
          <div id="hvError" class="hv-error" role="alert" hidden></div>
          <div class="hv-actions">
            <button type="button" id="hvCancelBtn" class="hv-btn hv-btn-secondary">取消</button>
            <button type="submit" id="hvSubmitBtn" class="hv-btn hv-btn-primary">提交验证</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(backdrop);
  }

  const sourceEl = backdrop.querySelector("#hvSource");
  const queueEl = backdrop.querySelector("#hvQueueBadge");
  const countdownEl = backdrop.querySelector("#hvCountdown");
  const titleEl = backdrop.querySelector("#hvTitle");
  const subtitleEl = backdrop.querySelector("#hvSubtitle");
  const imageWrapEl = backdrop.querySelector("#hvImageWrap");
  const imageEl = backdrop.querySelector("#hvImage");
  const refreshBtnEl = backdrop.querySelector("#hvRefreshBtn");
  const formEl = backdrop.querySelector("#hvForm");
  const fieldsEl = backdrop.querySelector("#hvFields");
  const errorEl = backdrop.querySelector("#hvError");
  const cancelBtnEl = backdrop.querySelector("#hvCancelBtn");
  const closeBtnEl = backdrop.querySelector("#hvCloseBtn");
  const submitBtnEl = backdrop.querySelector("#hvSubmitBtn");

  /** @type {Array<any>} */
  let queue = [];
  /** @type {Map<string, Record<string, string>>} */
  const draftsById = new Map();
  let renderedId = "";
  let renderedImageUrl = "";
  let countdownTimer = null;
  let busySubmit = false;
  let busyRefresh = false;

  function currentItem() {
    return queue[0] || null;
  }

  function showError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } else {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }
  }

  function updateCountdown() {
    const item = currentItem();
    if (!item || !countdownEl) return;
    const remain = Math.max(0, Math.ceil((Number(item.expiresAt || 0) - Date.now()) / 1000));
    countdownEl.textContent = `剩余 ${remain}s`;
    countdownEl.classList.toggle("is-warn", remain <= 30 && remain > 10);
    countdownEl.classList.toggle("is-danger", remain <= 10);
  }

  function ensureCountdownTimer() {
    if (queue.length > 0 && !countdownTimer) {
      countdownTimer = setInterval(updateCountdown, 1000);
    } else if (queue.length === 0 && countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function saveCurrentDraft() {
    if (!renderedId || !fieldsEl) return;
    const map = draftsById.get(renderedId) || {};
    for (const input of fieldsEl.querySelectorAll("input[data-hv-field]")) {
      map[input.dataset.hvField] = input.value;
    }
    draftsById.set(renderedId, map);
  }

  function focusPrimaryField() {
    if (!fieldsEl) return;
    const target = fieldsEl.querySelector("input[data-hv-field]");
    if (target) {
      requestAnimationFrame(() => {
        try {
          target.focus({ preventScroll: true });
          target.select?.();
        } catch {}
      });
    }
  }

  function renderFields(item) {
    if (!fieldsEl) return;
    const saved = draftsById.get(item.id) || {};
    const fields = Array.isArray(item.fields) && item.fields.length > 0
      ? item.fields
      : [{ name: "code", label: "验证码", type: "text", placeholder: "输入结果后回车提交", value: "", required: true }];

    fieldsEl.innerHTML = fields.map((f, idx) => {
      const val = Object.hasOwn(saved, f.name) ? saved[f.name] : String(f.value ?? "");
      const inputType = f.type === "password" ? "password" : "text";
      const reqMark = f.required ? '<span class="hv-req">*</span>' : "";
      return `
        <label class="hv-field">
          <span class="hv-field-label">${escapeHtml(f.label)}${reqMark}</span>
          <input
            class="hv-input"
            type="${inputType}"
            data-hv-field="${escapeHtml(f.name)}"
            data-hv-required="${f.required ? "1" : "0"}"
            placeholder="${escapeHtml(f.placeholder || "")}"
            value="${escapeHtml(val)}"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            ${idx === 0 ? "autofocus" : ""}
          />
        </label>
      `;
    }).join("");

    for (const input of fieldsEl.querySelectorAll("input[data-hv-field]")) {
      input.addEventListener("input", () => {
        saveCurrentDraft();
        showError("");
      });
    }
  }

  function render() {
    const item = currentItem();
    ensureCountdownTimer();
    if (!item) {
      backdrop.hidden = true;
      renderedId = "";
      renderedImageUrl = "";
      showError("");
      return;
    }

    const switchingItem = renderedId !== item.id;
    if (switchingItem && renderedId) {
      saveCurrentDraft();
    }

    backdrop.hidden = false;
    sourceEl.textContent = item.source || "Agent";
    titleEl.textContent = item.title || "需要人工动态验证";

    if (queue.length > 1) {
      queueEl.hidden = false;
      queueEl.textContent = `1 / ${queue.length}`;
    } else {
      queueEl.hidden = true;
    }

    if (item.subtitle) {
      subtitleEl.hidden = false;
      subtitleEl.textContent = item.subtitle;
    } else {
      subtitleEl.hidden = true;
      subtitleEl.textContent = "";
    }

    if (item.imageDataUrl) {
      imageWrapEl.hidden = false;
      if (renderedImageUrl !== item.imageDataUrl) {
        imageEl.src = item.imageDataUrl;
        renderedImageUrl = item.imageDataUrl;
      }
      refreshBtnEl.hidden = !item.canRefresh;
      imageEl.classList.toggle("is-clickable", Boolean(item.canRefresh));
      imageEl.title = item.canRefresh ? "点击刷新图片" : "";
    } else {
      imageWrapEl.hidden = true;
      imageEl.removeAttribute("src");
      renderedImageUrl = "";
      refreshBtnEl.hidden = true;
    }

    if (switchingItem) {
      renderedId = item.id;
      showError("");
      renderFields(item);
      focusPrimaryField();
    }
    updateCountdown();
  }

  function syncList(list) {
    const next = Array.isArray(list) ? list.filter((it) => it && it.id) : [];
    const activeIds = new Set(next.map((it) => it.id));
    for (const key of draftsById.keys()) {
      if (!activeIds.has(key)) draftsById.delete(key);
    }
    queue = next;
    render();
  }

  function upsert(item) {
    if (!item?.id) return;
    const idx = queue.findIndex((x) => x.id === item.id);
    if (idx >= 0) {
      queue[idx] = item;
    } else {
      queue.push(item);
    }
    render();
  }

  function remove(id) {
    const key = String(id || "").trim();
    if (!key) return;
    draftsById.delete(key);
    queue = queue.filter((x) => x.id !== key);
    render();
  }

  async function doRefresh() {
    const item = currentItem();
    if (!item?.canRefresh || busyRefresh || busySubmit) return;
    busyRefresh = true;
    refreshBtnEl.disabled = true;
    showError("");
    try {
      const res = await apiPost(`api/human-verify/${encodeURIComponent(item.id)}/refresh`, {});
      if (res?.item) {
        const draft = draftsById.get(item.id) || {};
        const primary = item.fields?.[0]?.name || "code";
        draft[primary] = "";
        draftsById.set(item.id, draft);
        const primaryInput = [...(fieldsEl?.querySelectorAll("input[data-hv-field]") || [])]
          .find((el) => el.dataset.hvField === primary);
        if (primaryInput) {
          primaryInput.value = "";
        }
        upsert(res.item);
        focusPrimaryField();
      }
    } catch (err) {
      showError(err?.message || "刷新验证码失败");
    } finally {
      busyRefresh = false;
      refreshBtnEl.disabled = false;
    }
  }

  async function doSubmit() {
    const item = currentItem();
    if (!item || busySubmit) return;
    showError("");

    const values = {};
    const inputs = [...(fieldsEl?.querySelectorAll("input[data-hv-field]") || [])];
    for (const input of inputs) {
      const name = input.dataset.hvField;
      const required = input.dataset.hvRequired === "1";
      const val = input.type === "password" ? input.value : input.value.trim();
      if (required && !val.trim()) {
        const label = input.closest(".hv-field")?.querySelector(".hv-field-label")?.textContent?.replace(/\*$/, "") || name;
        showError(`请填写「${label}」`);
        input.focus();
        return;
      }
      values[name] = val;
    }

    const primaryName = item.fields?.[0]?.name || "code";
    busySubmit = true;
    submitBtnEl.disabled = true;
    submitBtnEl.textContent = "提交中…";
    try {
      await apiPost(`api/human-verify/${encodeURIComponent(item.id)}/submit`, {
        value: values[primaryName] ?? "",
        values,
        submittedBy: "web",
      });
      remove(item.id);
    } catch (err) {
      if (Number(err?.status) === 404) {
        remove(item.id);
      } else {
        showError(err?.message || "提交失败，请重试");
      }
    } finally {
      busySubmit = false;
      submitBtnEl.disabled = false;
      submitBtnEl.textContent = "提交验证";
    }
  }

  async function doCancel() {
    const item = currentItem();
    if (!item || busySubmit) return;
    try {
      await apiPost(`api/human-verify/${encodeURIComponent(item.id)}/cancel`, {
        reason: "cancelled",
        submittedBy: "web",
      });
    } catch {}
    remove(item.id);
  }

  async function refreshFromServer() {
    try {
      const data = await apiGet("api/human-verify", { useEtagCache: false });
      if (Array.isArray(data?.items)) {
        syncList(data.items);
      }
    } catch {}
  }

  formEl?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void doSubmit();
  });

  cancelBtnEl?.addEventListener("click", () => {
    void doCancel();
  });

  closeBtnEl?.addEventListener("click", () => {
    void doCancel();
  });

  refreshBtnEl?.addEventListener("click", () => {
    void doRefresh();
  });

  imageEl?.addEventListener("click", () => {
    if (currentItem()?.canRefresh) {
      void doRefresh();
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !backdrop.hidden && currentItem()) {
      ev.preventDefault();
      ev.stopPropagation();
      void doCancel();
    }
  });

  return {
    syncList,
    upsert,
    remove,
    refreshFromServer,
  };
}
