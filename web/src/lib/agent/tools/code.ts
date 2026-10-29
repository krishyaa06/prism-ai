import { z } from "zod";
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten";
import { truncate } from "../safety";
import { defineTool, errorMessage, shortSummary } from "./types";

export type CodeResult = { ok: boolean; output: string; result?: string; error?: string; durationMs: number };
export type RunCodeFn = (language: "javascript" | "python", code: string, signal: AbortSignal) => Promise<CodeResult>;

const MAX_OUTPUT = 20_000;

export type JsSandboxOptions = { timeoutMs?: number; memoryBytes?: number; stackBytes?: number };

function formatValue(vm: QuickJSContext, handle: QuickJSHandle) {
  const value = vm.dump(handle);
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Runs JavaScript in a QuickJS WASM interpreter: no network, filesystem, env, or Node APIs. */
export async function runJavaScript(code: string, options: JsSandboxOptions = {}): Promise<CodeResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(options.memoryBytes ?? 64 * 1024 * 1024);
  runtime.setMaxStackSize(options.stackBytes ?? 1024 * 1024);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const vm = runtime.newContext();
  const lines: string[] = [];
  let outputSize = 0;
  const push = (prefix: string, args: QuickJSHandle[]) => {
    if (outputSize > MAX_OUTPUT) return;
    const text = args.map((arg) => {
      const type = vm.typeof(arg);
      if (type === "string") return vm.getString(arg);
      return formatValue(vm, arg) ?? "undefined";
    }).join(" ");
    const line = prefix + text;
    outputSize += line.length + 1;
    lines.push(line);
  };

  try {
    const consoleObj = vm.newObject();
    for (const [method, prefix] of [["log", ""], ["info", ""], ["debug", ""], ["warn", "[warn] "], ["error", "[error] "]] as const) {
      const fn = vm.newFunction(method, (...args) => { push(prefix, args); });
      vm.setProp(consoleObj, method, fn);
      fn.dispose();
    }
    vm.setProp(vm.global, "console", consoleObj);
    consoleObj.dispose();

    const evaluated = vm.evalCode(code, "task.js");
    let resultText: string | undefined;
    let errorText: string | undefined;
    if (evaluated.error) {
      errorText = describeError(vm.dump(evaluated.error));
      evaluated.error.dispose();
    } else {
      // Drain microtasks (async functions / promises).
      runtime.executePendingJobs();
      const handle = evaluated.value;
      const state = vm.getPromiseState(handle);
      if (state.type === "rejected") {
        errorText = describeError(vm.dump(state.error));
        state.error.dispose();
      } else if (state.type === "pending") {
        errorText = "Promise did not settle (no timers or I/O are available in the sandbox).";
      } else {
        resultText = formatValue(vm, state.value);
        if (!state.notAPromise) state.value.dispose();
      }
      handle.dispose();
    }
    if (Date.now() >= deadline && errorText && /interrupted/i.test(errorText)) {
      errorText = `Execution timed out after ${Math.round(timeoutMs / 1000)} s.`;
    }
    const output = truncate(lines.join("\n"), MAX_OUTPUT);
    return { ok: !errorText, output, result: resultText === undefined ? undefined : truncate(resultText, MAX_OUTPUT), error: errorText, durationMs: Date.now() - started };
  } catch (error) {
    const message = errorMessage(error);
    return {
      ok: false,
      output: truncate(lines.join("\n"), MAX_OUTPUT),
      error: /out of memory|memory/i.test(message) ? "Out of memory (64 MB limit)." : message,
      durationMs: Date.now() - started,
    };
  } finally {
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A runtime that ran out of memory may fail to dispose cleanly; it is garbage collected with the WASM module.
    }
  }
}

function describeError(value: unknown) {
  if (value && typeof value === "object") {
    const err = value as { name?: string; message?: string; stack?: string };
    const head = `${err.name ?? "Error"}: ${err.message ?? JSON.stringify(value)}`;
    const stack = err.stack ? `\n${String(err.stack).split("\n").slice(0, 4).join("\n")}` : "";
    return truncate(head + stack, 2_000);
  }
  return String(value);
}

/* ------------------------------------------------------------------------ */
/* Python via E2B (optional)                                                */
/* ------------------------------------------------------------------------ */

export function isPythonConfigured() {
  return Boolean(process.env.E2B_API_KEY);
}

export async function runPythonE2B(code: string, signal: AbortSignal): Promise<CodeResult> {
  const started = Date.now();
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    return { ok: false, output: "", error: "Python is not available: the server has no E2B_API_KEY configured. Use language \"javascript\" instead.", durationMs: 0 };
  }
  const domain = process.env.E2B_DOMAIN || "e2b.app";
  const api = `https://api.${domain}`;
  const timed = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const created = await fetch(`${api}/sandboxes`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ templateID: process.env.E2B_TEMPLATE || "code-interpreter-v1", timeout: 120 }),
    signal: timed,
  });
  if (!created.ok) return { ok: false, output: "", error: `Could not start the Python sandbox (HTTP ${created.status}).`, durationMs: Date.now() - started };
  const sandbox = await created.json() as { sandboxID: string; domain?: string | null; envdAccessToken?: string; trafficAccessToken?: string };
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "E2b-Sandbox-Id": sandbox.sandboxID,
      "E2b-Sandbox-Port": "49999",
    };
    if (sandbox.envdAccessToken) headers["X-Access-Token"] = sandbox.envdAccessToken;
    if (sandbox.trafficAccessToken) headers["E2B-Traffic-Access-Token"] = sandbox.trafficAccessToken;
    const response = await fetch(`https://49999-${sandbox.sandboxID}.${sandbox.domain || domain}/execute`, {
      method: "POST", headers, body: JSON.stringify({ code, language: "python" }), signal: timed,
    });
    if (!response.ok || !response.body) {
      return { ok: false, output: "", error: `Python execution failed (HTTP ${response.status}).`, durationMs: Date.now() - started };
    }
    const text = await response.text();
    const out: string[] = [];
    const results: string[] = [];
    let error: string | undefined;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as { type: string; text?: string; name?: string; value?: string; traceback?: string; is_main_result?: boolean };
        if (msg.type === "stdout" || msg.type === "stderr") out.push(msg.type === "stderr" ? `[stderr] ${msg.text ?? ""}` : msg.text ?? "");
        else if (msg.type === "result" && msg.text) results.push(msg.text);
        else if (msg.type === "error") error = `${msg.name}: ${msg.value}\n${(msg.traceback ?? "").slice(-1500)}`;
      } catch {
        // ignore malformed lines
      }
    }
    return {
      ok: !error,
      output: truncate(out.join("").replace(/\n$/, ""), MAX_OUTPUT),
      result: results.length ? truncate(results.join("\n"), MAX_OUTPUT) : undefined,
      error,
      durationMs: Date.now() - started,
    };
  } finally {
    fetch(`${api}/sandboxes/${encodeURIComponent(sandbox.sandboxID)}`, { method: "DELETE", headers: { "X-API-KEY": apiKey } }).catch(() => undefined);
  }
}

export const runCode: RunCodeFn = async (language, code, signal) => {
  if (language === "python") {
    try {
      return await runPythonE2B(code, signal);
    } catch (error) {
      return { ok: false, output: "", error: `Python sandbox error: ${errorMessage(error)}`, durationMs: 0 };
    }
  }
  return runJavaScript(code);
};

export const runCodeTool = defineTool({
  name: "run_code",
  description:
    "Execute code for calculations, data processing, parsing, statistics or generating content. JavaScript runs in an isolated QuickJS sandbox (ES2023, no network/filesystem/timers/Node APIs, 5 s, 64 MB); print with console.log, and the value of the last expression is returned. Python is only available when the server enables it.",
  parameters: {
    type: "object",
    properties: {
      language: { type: "string", enum: ["javascript", "python"] },
      code: { type: "string", description: "Complete program." },
    },
    required: ["language", "code"],
    additionalProperties: false,
  },
  schema: z.object({ language: z.enum(["javascript", "python"]).default("javascript"), code: z.string().min(1).max(100_000) }),
  label: (args) => `Running ${args.language === "python" ? "Python" : "JavaScript"}`,
  run: async (args, ctx) => {
    const result = await ctx.deps.runCode(args.language, args.code, ctx.signal);
    const parts = [
      result.output ? `stdout:\n${result.output}` : "",
      result.result !== undefined ? `result:\n${result.result}` : "",
      result.error ? `error:\n${result.error}` : "",
    ].filter(Boolean);
    const content = parts.join("\n\n") || "(no output)";
    return {
      ok: result.ok,
      summary: shortSummary(result.ok ? `Done in ${result.durationMs} ms. ${result.output || result.result || ""}` : `Error: ${result.error ?? "failed"}`),
      content,
      untrusted: true,
      data: { output: result.output.slice(0, 4000), result: result.result?.slice(0, 4000), error: result.error },
    };
  },
});
