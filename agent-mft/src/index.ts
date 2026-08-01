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

  // ── first-turn injection ─────────────────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    const rt = runtime;
    if (!rt || !rt.isFirstTurn) return;
    rt.isFirstTurn = false;

    const prompt = String(event.prompt ?? "").trim();
    if (!prompt) return;

    try {
      const records = rt.evaluateInjection(prompt);
      if (records.length === 0) return;

      const map = rt.renderMemoryMap(records);
      return {
        message: {
          customType: "agent-mft:memory-map",
          content: map,
          display: true,
        },
      };
    } catch {
      // non-fatal: memory injection must never break a turn
      return;
    }
  });

  // ── surfaces ─────────────────────────────────────────────────────────────

  registerMemoryTools(pi, getRuntime);
  registerCommands(pi, getRuntime, runRebuild, manualInject);
}
