/**
 * index.ts — agent-mft entry point.
 *
 * Surface:
 *   events   : session_start (open runtime + auto-rebuild if empty),
 *              before_agent_start (first-turn memory map injection),
 *              session_shutdown (close runtime)
 *   tools    : mem_query / mem_get / mem_add / mem_supersede / mem_revoke
 *   commands : /mft, /mft:add, /mft:inject, /mft:rebuild, /mft:stats
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MftRuntime } from "./runtime.ts";
import { ChendpocAdapter } from "./adapters/chendpoc.ts";
import { ObsAdapter } from "./adapters/obs.ts";
import { ManualAdapter } from "./adapters/manual.ts";
import { rebuild } from "./rebuild.ts";
import { registerMemoryTools } from "./tools.ts";
import { registerCommands } from "./commands.ts";

export default function agentMft(pi: ExtensionAPI) {
  let runtime: MftRuntime | null = null;

  function getRuntime(): MftRuntime | null {
    return runtime;
  }

  async function runRebuild(): Promise<Record<string, unknown>> {
    const rt = runtime;
    if (!rt) return { error: "runtime not available" };
    const result = await rebuild(rt.globalMirror, [
      new ChendpocAdapter(),
      new ObsAdapter(),
      new ManualAdapter(),
    ]);
    rt.adapters = [new ChendpocAdapter(), new ObsAdapter(), new ManualAdapter()];
    return { ...result, project: rt.projectMirror?.count() ?? 0 };
  }

  async function manualInject(cwd: string): Promise<void> {
    const rt = runtime;
    if (!rt) return;
    const records = rt.query({ keywords: [], excludes: [], raw: "" }, rt.config.injectLimit);
    if (records.length === 0) {
      pi.sendMessage({
        customType: "agent-mft:memory-map",
        content: "## Memory Map（agent-mft）\n当前没有已记录的匹配记忆。",
        display: true,
      }, { deliverAs: "nextTurn" });
      return;
    }
    const map = rt.renderMemoryMap(records);
    pi.sendMessage({ customType: "agent-mft:memory-map", content: map, display: true }, {
      deliverAs: "nextTurn",
    });
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    runtime?.close();
    runtime = MftRuntime.open(ctx.cwd);
    const adapters = [new ChendpocAdapter(), new ObsAdapter(), new ManualAdapter()];
    runtime.adapters = adapters;

    // auto-rebuild once when the mirror is empty but backends may have data
    if (runtime.config.autoRebuildOnEmpty && runtime.globalMirror.count() === 0) {
      try {
        await rebuild(runtime.globalMirror, adapters);
      } catch {
        // non-fatal: user can /mft:rebuild
      }
    }
  });

  pi.on("session_shutdown", () => {
    runtime?.close();
    runtime = null;
  });

  // ── resident + dynamic injection ────────────────────────────────────────
  //
  // Resident block: appended to the system prompt on EVERY turn. Content is
  // byte-stable (pinned ∪ high-importance, addr order) so the DeepSeek disk
  // cache treats it as a persistent prefix unit — free across sessions.
  // Dynamic block: injected as a message only on the FIRST turn.

  pi.on("before_agent_start", async (event, ctx) => {
    const rt = runtime;
    if (!rt) return;

    let result: { message?: unknown; systemPrompt?: string } | undefined;

    // resident block → system prompt tail (every turn, byte-stable)
    try {
      const resident = rt.renderResidentBlock();
      if (resident) {
        result = { ...result, systemPrompt: `${event.systemPrompt}\n\n${resident}` };
      }
    } catch {
      // non-fatal
    }

    // dynamic block → message, only first turn
    if (rt.isFirstTurn) {
      rt.isFirstTurn = false;
      const prompt = String(event.prompt ?? "").trim();
      if (prompt) {
        try {
          const records = rt.evaluateInjection(prompt);
          if (records.length > 0) {
            const map = rt.renderMemoryMap(records);
            result = {
              ...result,
              message: {
                customType: "agent-mft:memory-map",
                content: map,
                display: true,
              },
            };
          }
        } catch {
          // non-fatal: memory injection must never break a turn
        }
      }
    }

    return result;
  });

  // ── cache telemetry ─────────────────────────────────────────────────────

  pi.on("message_end", (event) => {
    const rt = runtime;
    if (!rt || event.message.role !== "assistant") return;
    const usage = (event.message as { usage?: { input?: number; cacheRead?: number; cacheWrite?: number } }).usage;
    if (!usage || typeof usage.input !== "number") return;
    try {
      rt.recordCacheUsage({
        sessionId: undefined,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        inputTokens: usage.input,
      });
    } catch {
      // non-fatal
    }
  });

  // ── surfaces ─────────────────────────────────────────────────────────────

  registerMemoryTools(pi, getRuntime);
  registerCommands(pi, getRuntime, runRebuild, manualInject);
}
