import { test } from "node:test";
import assert from "node:assert/strict";
import { runJavaScript, runPythonE2B } from "../../src/lib/agent/tools/code";

test("QuickJS captures console output and the last expression value", async () => {
  const r = await runJavaScript("const xs=[1,2,3,4]; console.log('sum', xs.reduce((a,b)=>a+b,0)); console.warn('careful'); ({ mean: 2.5 })");
  assert.equal(r.ok, true);
  assert.equal(r.output, "sum 10\n[warn] careful");
  assert.deepEqual(JSON.parse(r.result!), { mean: 2.5 });
});

test("QuickJS interrupts infinite loops at the deadline", async () => {
  const started = Date.now();
  const r = await runJavaScript("while (true) {}", { timeoutMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /timed out/);
  assert.ok(Date.now() - started < 3000);
});

test("QuickJS has no process, require, fetch or filesystem", async () => {
  const r = await runJavaScript("[typeof process, typeof require, typeof fetch, typeof globalThis.Deno, typeof XMLHttpRequest].join(',')");
  assert.equal(r.result, "undefined,undefined,undefined,undefined,undefined");
  const imp = await runJavaScript("import('fs')");
  assert.equal(imp.ok, false);
});

test("QuickJS reports thrown errors and resolves async results", async () => {
  const err = await runJavaScript("throw new TypeError('bad input')");
  assert.equal(err.ok, false);
  assert.match(err.error!, /TypeError: bad input/);
  const asyncResult = await runJavaScript("(async () => { console.log('a'); return 6 * 7 })()");
  assert.equal(asyncResult.result, "42");
  assert.equal(asyncResult.output, "a");
  const syntax = await runJavaScript("let = ;");
  assert.match(syntax.error!, /SyntaxError/);
});

test("Python without E2B_API_KEY returns a clear error", async () => {
  const saved = process.env.E2B_API_KEY;
  delete process.env.E2B_API_KEY;
  const r = await runPythonE2B("print(1)", new AbortController().signal);
  if (saved) process.env.E2B_API_KEY = saved;
  assert.equal(r.ok, false);
  assert.match(r.error!, /E2B_API_KEY/);
});
