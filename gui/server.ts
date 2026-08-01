/**
 * server.js — ETharness GUI server (zero dependencies).
 *
 * Spawns a pi RPC subprocess for chat, and reuses the agent-mft kernel
 * directly (Node 24 type-stripping imports) for memory addressing.
 *
 * Run:  node server.js [--project <path>] [--port <port>]
 * Open: http://127.0.0.1:8787
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MftRuntime } from "../agent-mft/src/runtime.ts";
import { parseQuery } from "../agent-mft/src/query.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.MFT_PORT ?? 8787);
const PROJECT = resolve(process.argv.includes("--project") ? process.argv[process.argv.indexOf("--project") + 1] : process.cwd());

function findPiCli(): string {
  if (process.env.PI_CLI) return process.env.PI_CLI;
  const candidates = [
    join(process.env.APPDATA ?? "", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
    join(process.env.USERPROFILE ?? "", "AppData", "Roaming", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "pi";
}

const PI_CLI = findPiCli();

// ── memory kernel ──────────────────────────────────────────────────────────

const mft = MftRuntime.open(PROJECT);

// ── pi RPC subprocess ──────────────────────────────────────────────────────

const pi = spawn(process.execPath, [PI_CLI, "--mode", "rpc", "--name", "ETharness"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let reqId = 0;
const pending = new Map();
const sseClients = new Set();

pi.stdout.setEncoding("utf8");
pi.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === "response") {
        const cb = pending.get(msg.id);
        if (cb) {
          pending.delete(msg.id);
          cb(msg);
        }
      } else {
        broadcast(msg);
      }
    } catch {
      // skip malformed
    }
  }
});

pi.stderr.setEncoding("utf8");
pi.stderr.on("data", (chunk) => {
  const text = chunk.trim();
  if (text) broadcast({ type: "pi_stderr", text: text.slice(-2000) });
});

pi.on("exit", (code) => {
  broadcast({ type: "pi_exit", code });
});

function sendCommand(cmd) {
  return new Promise((resolve) => {
    const id = "req-" + ++reqId;
    pending.set(id, resolve);
    pi.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
  });
}

// ── SSE ────────────────────────────────────────────────────────────────────

function broadcast(msg) {
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      // drop
    }
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // static
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(join(__dirname, "public", "index.html")));
      return;
    }
    if (path.startsWith("/static/")) {
      const file = join(__dirname, "public", path.slice("/static/".length));
      if (!file.startsWith(join(__dirname, "public"))) {
        sendJson(res, { error: "forbidden" }, 403);
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(await readFile(file));
      return;
    }

    // api: memory query
    if (path === "/api/memory" && req.method === "GET") {
      const expr = url.searchParams.get("expr") ?? "";
      let filter;
      try {
        filter = parseQuery(expr);
      } catch (e) {
        sendJson(res, { error: e.message }, 400);
        return;
      }
      const records = mft.query(filter, 100);
      sendJson(res, { records, expr });
      return;
    }

    // api: memory mutations
    if (path === "/api/memory" && req.method === "POST") {
      const body = await readBody(req);
      const { action } = body;
      let result;
      switch (action) {
        case "add":
          result = mft.addManual({
            filename: body.filename,
            kind: body.kind ?? "note",
            entity: body.entity,
            path: body.path,
            importance: body.importance,
            content: body.content,
          });
          sendJson(res, { ok: true, addr: result.addr, record: result });
          return;
        case "pin":
          result = mft.pin(String(body.addr ?? "").toUpperCase());
          sendJson(res, { ok: result });
          return;
        case "unpin":
          result = mft.unpin(String(body.addr ?? "").toUpperCase());
          sendJson(res, { ok: result });
          return;
        case "supersede":
          result = mft.supersede(String(body.old_addr ?? "").toUpperCase(), String(body.new_addr ?? "").toUpperCase());
          sendJson(res, { ok: result });
          return;
        case "revoke":
          result = mft.revoke(String(body.addr ?? "").toUpperCase());
          sendJson(res, { ok: result });
          return;
        default:
          sendJson(res, { error: `unknown action: ${action}` }, 400);
      }
      return;
    }

    // api: resident set
    if (path === "/api/resident") {
      sendJson(res, { records: mft.residentRecords() });
      return;
    }

    // api: cache telemetry
    if (path === "/api/cache") {
      sendJson(res, mft.cacheStats());
      return;
    }

    // api: stats
    if (path === "/api/stats") {
      sendJson(res, { stats: mft.stats(), project: PROJECT, piCli: PI_CLI });
      return;
    }

    // api: chat (SSE stream)
    if (path === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const message = String(body.message ?? "").trim();
      if (!message) {
        sendJson(res, { error: "empty message" }, 400);
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      await sendCommand({ type: "prompt", message });
      // keep the stream open; events flow via broadcast
      return;
    }

    sendJson(res, { error: "not found" }, 404);
  } catch (e) {
    if (!res.headersSent) {
      sendJson(res, { error: e instanceof Error ? e.message : String(e) }, 500);
    } else {
      try {
        res.end();
      } catch {
        // already closed
      }
    }
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ETharness GUI: http://127.0.0.1:${PORT}`);
  console.log(`project: ${PROJECT}`);
  console.log(`pi CLI: ${PI_CLI}`);
});

process.on("SIGINT", () => {
  try {
    pi.kill();
  } catch {}
  try {
    mft.close();
  } catch {}
  process.exit(0);
});
