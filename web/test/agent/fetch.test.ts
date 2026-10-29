import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchReadable, type HttpFetch } from "../../src/lib/agent/tools/fetch";
import { BlockedUrlError } from "../../src/lib/agent/safety";

const DNS: Record<string, string> = {
  "example.com": "93.184.216.34",
  "redirector.example": "93.184.216.35",
  "rebind.example": "192.168.0.10",
  "docs.example": "93.184.216.36",
};
const lookup = async (host: string) => {
  const address = DNS[host];
  if (!address) throw new Error("ENOTFOUND");
  return [{ address, family: 4 }];
};

function response(status: number, headers: Record<string, string>, body = "") {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    body: new Response(body).body,
  };
}

function server(routes: Record<string, () => ReturnType<typeof response>>) {
  const hits: string[] = [];
  const httpFetch: HttpFetch = async (url) => {
    hits.push(url);
    const route = routes[url];
    if (!route) return response(404, {});
    return route();
  };
  return { httpFetch, hits };
}

test("fetch_url follows safe redirects and extracts readable HTML", async () => {
  const { httpFetch, hits } = server({
    "https://redirector.example/go": () => response(301, { location: "https://example.com/page" }),
    "https://example.com/page": () => response(200, { "content-type": "text/html; charset=utf-8" },
      "<html><head><title>Example</title></head><body><h1>Hello</h1><p>World</p></body></html>"),
  });
  const page = await fetchReadable("https://redirector.example/go", { httpFetch, lookup });
  assert.deepEqual(hits, ["https://redirector.example/go", "https://example.com/page"]);
  assert.equal(page.url, "https://example.com/page");
  assert.equal(page.title, "Example");
  assert.match(page.text, /# Hello\n\nWorld/);
});

test("fetch_url blocks redirects to the cloud metadata IP", async () => {
  const { httpFetch, hits } = server({
    "https://redirector.example/meta": () => response(302, { location: "http://169.254.169.254/latest/meta-data/" }),
  });
  await assert.rejects(fetchReadable("https://redirector.example/meta", { httpFetch, lookup }), BlockedUrlError);
  assert.equal(hits.length, 1);
});

test("fetch_url blocks redirects to hosts that resolve to private IPs and to localhost", async () => {
  const { httpFetch, hits } = server({
    "https://redirector.example/a": () => response(302, { location: "https://rebind.example/admin" }),
    "https://redirector.example/b": () => response(307, { location: "http://localhost:8080/" }),
  });
  await assert.rejects(fetchReadable("https://redirector.example/a", { httpFetch, lookup }), /non-public/);
  await assert.rejects(fetchReadable("https://redirector.example/b", { httpFetch, lookup }), BlockedUrlError);
  assert.deepEqual(hits, ["https://redirector.example/a", "https://redirector.example/b"]);
});

test("fetch_url stops after 5 redirects", async () => {
  let n = 0;
  const httpFetch: HttpFetch = async () => response(302, { location: `https://example.com/loop${++n}` });
  await assert.rejects(fetchReadable("https://example.com/start", { httpFetch, lookup }), /Too many redirects/);
  assert.equal(n, 6);
});

test("fetch_url rejects private literal IPs before any request", async () => {
  const { httpFetch, hits } = server({});
  for (const url of ["http://10.0.0.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/"]) {
    await assert.rejects(fetchReadable(url, { httpFetch, lookup }), BlockedUrlError, url);
  }
  assert.equal(hits.length, 0);
});

test("fetch_url handles JSON, plain text and PDF gracefully", async () => {
  const { httpFetch } = server({
    "https://docs.example/data.json": () => response(200, { "content-type": "application/json" }, '{"a":1,"b":[1,2]}'),
    "https://docs.example/readme.txt": () => response(200, { "content-type": "text/plain" }, "plain text body"),
    "https://docs.example/paper.pdf": () => response(200, { "content-type": "application/pdf" }, "%PDF-1.7"),
    "https://docs.example/image.png": () => response(200, { "content-type": "image/png" }, "x"),
  });
  const json = await fetchReadable("https://docs.example/data.json", { httpFetch, lookup });
  assert.equal(JSON.parse(json.text).b[1], 2);
  const text = await fetchReadable("https://docs.example/readme.txt", { httpFetch, lookup });
  assert.equal(text.text, "plain text body");
  const pdf = await fetchReadable("https://docs.example/paper.pdf", { httpFetch, lookup });
  assert.match(pdf.text, /PDF not supported yet/);
  await assert.rejects(fetchReadable("https://docs.example/image.png", { httpFetch, lookup }), /Unsupported content type/);
});

test("fetch_url truncates long pages to max_chars", async () => {
  const { httpFetch } = server({
    "https://docs.example/long.txt": () => response(200, { "content-type": "text/plain" }, "a".repeat(10_000)),
  });
  const page = await fetchReadable("https://docs.example/long.txt", { httpFetch, lookup, maxChars: 1000 });
  assert.ok(page.text.length <= 1000);
  assert.equal(page.truncated, true);
});
