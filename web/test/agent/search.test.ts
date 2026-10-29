import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDuckDuckGoHtml, resolveDuckDuckGoHref } from "../../src/lib/agent/tools/search";

const fixture = readFileSync(join(__dirname, "fixtures", "ddg.html"), "utf8");

test("parseDuckDuckGoHtml extracts organic results and skips ads", () => {
  const results = parseDuckDuckGoHtml(fixture);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.url), [
    "https://www.tooljunction.io/blog/vector-database-comparison",
    "https://qdrant.tech/benchmarks/?ref=ddg",
    "https://github.com/pgvector/pgvector",
  ]);
  assert.equal(results[0].snippet, "A vector database comparison should not start with a benchmark winner.");
  assert.equal(results[1].title, "Qdrant & friends – Benchmarks");
  assert.equal(results[1].snippet, 'Open-source "vector search" benchmarks.');
  assert.ok(results.every((r) => !/Sponsored|y\.js/.test(r.url + r.snippet)));
});

test("parseDuckDuckGoHtml honours max and tolerates empty pages", () => {
  assert.equal(parseDuckDuckGoHtml(fixture, 1).length, 1);
  assert.deepEqual(parseDuckDuckGoHtml("<html><body>No results.</body></html>"), []);
});

test("resolveDuckDuckGoHref decodes uddg redirect links", () => {
  assert.equal(resolveDuckDuckGoHref("//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx&amp;rut=1"), "https://a.example/x");
  assert.equal(resolveDuckDuckGoHref("https://b.example/"), "https://b.example/");
  assert.equal(resolveDuckDuckGoHref("/settings"), null);
});
