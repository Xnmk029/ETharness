/* app.js — ETharness GUI frontend */
"use strict";

const $ = (sel) => document.querySelector(sel);

const KIND_LABELS = {
  decision: "决策", fact: "事实", preference: "偏好", task_state: "任务",
  entity_rel: "关系", commit: "提交", note: "笔记",
  character: "人物", world: "世界观", idea: "灵感", material: "素材",
  plan: "计划", event: "事件", style: "风格",
};
const KIND_ORDER = ["character", "world", "idea", "material", "event", "plan", "style", "decision", "fact", "preference", "task_state", "note", "entity_rel", "commit"];

let activeKind = "";
let currentExpr = "";
let chatStream = null;

// ── memory browser ─────────────────────────────────────────────────────────

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

async function loadMemory() {
  const parts = [];
  if (activeKind) parts.push(`type:${activeKind}`);
  if (currentExpr) parts.push(currentExpr);
  const expr = parts.join(" ");
  try {
    const { records } = await api(`/api/memory?expr=${encodeURIComponent(expr)}`);
    renderMemoryList(records);
    renderResidentSummary();
  } catch (e) {
    renderMemoryList([], e.message);
  }
}

function renderMemoryList(records, error) {
  const list = $("#memory-list");
  list.innerHTML = "";
  if (error) {
    const div = document.createElement("div");
    div.className = "hint";
    div.textContent = error;
    list.appendChild(div);
    return;
  }
  if (records.length === 0) {
    const div = document.createElement("div");
    div.className = "hint";
    div.textContent = "没有匹配的记忆。试试 /mft:add 或在对话中说「记住这条」。";
    list.appendChild(div);
    return;
  }
  for (const r of records) {
    const item = document.createElement("div");
    item.className = "mem-item" + (r.pinned ? " pinned" : "");
    const rel = r.ts ? relTime(r.ts) : "";
    item.innerHTML = `
      <div class="row1">
        <span class="addr">#${r.addr}</span>
        <span class="kind">${KIND_LABELS[r.kind] ?? r.kind}</span>
        <button class="pin ${r.pinned ? "pinned" : ""}" data-addr="${r.addr}" title="${r.pinned ? "取消钉住" : "钉住（常驻，缓存免费在场）"}">${r.pinned ? "已钉" : "钉住"}</button>
      </div>
      <div class="filename"></div>
      <div class="meta"><span>${rel}</span><span>imp ${r.importance.toFixed(1)}</span><span>${r.backend}</span>${r.entity ? `<span>${r.entity}</span>` : ""}</div>`;
    item.querySelector(".filename").textContent = r.filename;
    item.querySelector(".pin").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await api("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: r.pinned ? "unpin" : "pin", addr: r.addr }),
      });
      loadMemory();
    });
    item.addEventListener("click", () => showDetail(r));
    list.appendChild(item);
  }
}

function relTime(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 个月前`;
}

function renderKindTabs() {
  const tabs = $("#kind-tabs");
  tabs.innerHTML = "";
  const all = document.createElement("button");
  all.textContent = "全部";
  all.className = activeKind === "" ? "active" : "";
  all.addEventListener("click", () => { activeKind = ""; renderKindTabs(); loadMemory(); });
  tabs.appendChild(all);
  for (const k of KIND_ORDER) {
    const b = document.createElement("button");
    b.textContent = KIND_LABELS[k] ?? k;
    b.className = activeKind === k ? "active" : "";
    b.addEventListener("click", () => { activeKind = k; renderKindTabs(); loadMemory(); });
    tabs.appendChild(b);
  }
}

async function renderResidentSummary() {
  try {
    const { records } = await api("/api/resident");
    const el = $("#resident-summary");
    el.textContent = records.length > 0
      ? `常驻 ${records.length} 条：${records.slice(0, 3).map((r) => r.filename.slice(0, 12)).join("、")}${records.length > 3 ? "…" : ""}（稳定前缀，缓存免费在场）`
      : "";
  } catch { /* ignore */ }
}

// ── detail panel ───────────────────────────────────────────────────────────

async function showDetail(r) {
  const body = $("#detail-body");
  body.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = `#${r.addr} [${KIND_LABELS[r.kind] ?? r.kind}]`;
  body.appendChild(h);
  const meta = document.createElement("div");
  meta.className = "meta-row";
  meta.innerHTML = [
    `backend: ${r.backend}`,
    `status: ${r.status}`,
    r.pinned ? "pinned" : "",
    r.entity ? `entity: ${r.entity}` : "",
    r.ts ? `ts: ${r.ts}` : "",
    `src: ${r.src}`,
  ].filter(Boolean).join(" | ");
  body.appendChild(meta);
  const pre = document.createElement("pre");
  pre.textContent = r.filename;
  body.appendChild(pre);
  // try expand via chat-independent source: show what we have locally
  const actions = document.createElement("div");
  actions.className = "composer-row";
  actions.style.marginTop = "10px";
  const pinBtn = document.createElement("button");
  pinBtn.className = "btn";
  pinBtn.textContent = r.pinned ? "取消钉住" : "钉住（常驻）";
  pinBtn.addEventListener("click", async () => {
    await api("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: r.pinned ? "unpin" : "pin", addr: r.addr }),
    });
    showDetail(r);
    loadMemory();
  });
  actions.appendChild(pinBtn);
  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.textContent = "撤销";
  delBtn.style.color = "var(--danger)";
  delBtn.addEventListener("click", async () => {
    await api("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", addr: r.addr }),
    });
    loadMemory();
    $("#detail-body").innerHTML = '<p class="hint">已撤销。</p>';
  });
  actions.appendChild(delBtn);
  body.appendChild(actions);
  $("#dashboard").classList.add("hidden");
}

// ── dashboard / cache ──────────────────────────────────────────────────────

async function refreshCache() {
  try {
    const s = await api("/api/cache");
    const chip = $("#cache-chip");
    chip.textContent = `命中 ${(s.hitRate * 100).toFixed(1)}%`;
    const dash = $("#dashboard");
    dash.classList.remove("hidden");
    $("#dash-body").innerHTML = `
      <div class="row"><span>请求数</span><b>${s.requests}</b></div>
      <div class="row"><span>输入 tokens</span><b>${s.totalInput.toLocaleString()}</b></div>
      <div class="row"><span>缓存命中</span><b>${s.totalCacheRead.toLocaleString()} (${(s.hitRate * 100).toFixed(1)}%)</b></div>
      <div class="row"><span>估算节省</span><b>$${s.estimatedSavedUsd.toFixed(4)}</b></div>
      <p style="font-size:11px;color:var(--dim);margin-top:8px">按 DeepSeek V4-Flash 价差 $0.1372/M 估算。常驻记忆 = 稳定前缀 = 缓存免费在场。</p>`;
  } catch { /* ignore */ }
}

async function loadPresence() {
  try {
    const { records } = await api("/api/resident");
    const el = $("#presence");
    el.textContent = records.length > 0
      ? `${records.length} 条记忆在场 · 稳定前缀缓存免费`
      : "暂无常驻记忆";
  } catch { /* ignore */ }
}

// ── chat (SSE) ─────────────────────────────────────────────────────────────

function addMessage(role, text) {
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  msg.textContent = text;
  $("#messages").appendChild(msg);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  return msg;
}

function appendDelta(el, delta) {
  el.textContent += delta;
  $("#messages").scrollTop = $("#messages").scrollHeight;
}

async function sendChat() {
  const input = $("#input");
  const message = input.value.trim();
  if (!message || chatStream) return;
  input.value = "";
  addMessage("user", message);

  const holder = document.createElement("div");
  holder.className = "msg assistant";
  $("#messages").appendChild(holder);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  const thinkingEl = document.createElement("div");
  thinkingEl.className = "thinking";
  const textEl = document.createElement("div");
  holder.appendChild(thinkingEl);
  holder.appendChild(textEl);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) throw new Error("chat failed");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    chatStream = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          handleEvent(ev, thinkingEl, textEl, holder);
        }
      }
    }
  } catch (e) {
    textEl.textContent = `（错误：${e.message}）`;
  } finally {
    chatStream = null;
    refreshCache();
    loadPresence();
    loadMemory();
  }
}

function handleEvent(ev, thinkingEl, textEl, holder) {
  switch (ev.type) {
    case "message_update": {
      const d = ev.assistantMessageEvent;
      if (!d) break;
      if (d.type === "thinking_delta") thinkingEl.textContent += d.delta;
      else if (d.type === "text_delta") appendDelta(textEl, d.delta);
      else if (d.type === "text_start" || d.type === "thinking_start") {
        // clear placeholders
      }
      break;
    }
    case "tool_execution_start": {
      const row = document.createElement("div");
      row.className = "msg tool";
      row.textContent = `⚙ ${ev.toolName} …`;
      $("#messages").appendChild(row);
      break;
    }
    case "message_end": {
      const m = ev.message;
      if (m?.role === "assistant") {
        // finalize: ensure text present
        const text = extractText(m);
        if (text && !textEl.textContent.trim()) textEl.textContent = text;
      }
      break;
    }
    case "pi_stderr":
      console.warn("[pi]", ev.text);
      break;
    default:
      break;
  }
}

function extractText(message) {
  const blocks = message?.content ?? [];
  return blocks
    .map((c) => (c?.type === "text" ? c.text : c?.type === "thinking" ? "" : ""))
    .filter(Boolean)
    .join("\n");
}

// ── quick memory ───────────────────────────────────────────────────────────

async function quickMemory() {
  const input = $("#input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    const { ok, addr } = await api("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", filename: text.slice(0, 120), kind: "idea", content: text, importance: 0.6 }),
    });
    addMessage("tool", ok ? `已记录为 #${addr} [灵感]（可用「记住这条」的同类操作管理）` : "记录失败");
    loadMemory();
    refreshCache();
  } catch (e) {
    addMessage("tool", `记录失败：${e.message}`);
  }
}

// ── init ───────────────────────────────────────────────────────────────────

$("#expr-go").addEventListener("click", () => {
  currentExpr = $("#expr-input").value.trim();
  loadMemory();
});
$("#expr-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    currentExpr = e.target.value.trim();
    loadMemory();
  }
});
$("#btn-send").addEventListener("click", sendChat);
$("#input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
$("#btn-quick-memory").addEventListener("click", quickMemory);
$("#btn-resident").addEventListener("click", () => {
  currentExpr = "status:active";
  $("#expr-input").value = "";
  activeKind = "";
  renderKindTabs();
  loadMemory();
});
$("#btn-cache").addEventListener("click", () => {
  $("#dashboard").classList.toggle("hidden");
  refreshCache();
});

renderKindTabs();
loadMemory();
refreshCache();
loadPresence();
