import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as caching from "../scripts/caching.js";

/**
 * @param {Record<string, string | undefined>} env
 * @returns {() => void}
 */
function withEnv(env) {
	const prev = {};
	for (const k of Object.keys(env)) {
		prev[k] = process.env[k];
		if (env[k] === undefined) delete process.env[k];
		else process.env[k] = env[k];
	}
	return () => {
		for (const k of Object.keys(env)) {
			if (prev[k] === undefined) delete process.env[k];
			else process.env[k] = prev[k];
		}
	};
}

test("readCacheSettings parses TTL and max entries from env", () => {
	const restore = withEnv({
		GH_NOTIFICATION_CACHE_TTL: "90",
		GH_NOTIFICATION_CACHE_MAX: "10",
		GH_NOTIFICATION_CACHE_PERSIST: "0",
	});
	try {
		const s = caching.readCacheSettings();
		assert.equal(s.ttl, 90);
		assert.equal(s.maxEntries, 10);
		assert.equal(s.persistPath, null);
	} finally {
		restore();
	}
});

test("readCacheSettings falls back when env is invalid", () => {
	const restore = withEnv({
		GH_NOTIFICATION_CACHE_TTL: "not-a-number",
		GH_NOTIFICATION_CACHE_MAX: "x",
		GH_NOTIFICATION_CACHE_PERSIST: "0",
	});
	try {
		const s = caching.readCacheSettings();
		assert.equal(s.ttl, 3600);
		assert.equal(s.maxEntries, 256);
	} finally {
		restore();
	}
});

test("readCacheSettings clamps max entries to at least 1", () => {
	const restore = withEnv({
		GH_NOTIFICATION_CACHE_MAX: "0",
		GH_NOTIFICATION_CACHE_PERSIST: "0",
	});
	try {
		const s = caching.readCacheSettings();
		assert.equal(s.maxEntries, 1);
	} finally {
		restore();
	}
});

test("getCache returns null when TTL is zero", () => {
	const restore = withEnv({
		GH_NOTIFICATION_CACHE_TTL: "0",
		GH_NOTIFICATION_CACHE_PERSIST: "0",
	});
	try {
		caching.resetCache();
		assert.equal(caching.getCache(), null);
	} finally {
		restore();
		caching.resetCache();
	}
});

test("getCache recreates when settings key changes", () => {
	const restore = withEnv({
		GH_NOTIFICATION_CACHE_TTL: "120",
		GH_NOTIFICATION_CACHE_MAX: "256",
		GH_NOTIFICATION_CACHE_PERSIST: "0",
	});
	try {
		caching.resetCache();
		const a = caching.getCache();
		assert.ok(a);
		process.env.GH_NOTIFICATION_CACHE_TTL = "121";
		const b = caching.getCache();
		assert.notEqual(a, b);
	} finally {
		restore();
		caching.resetCache();
	}
});

test("Cache get returns null for missing key", () => {
	const cache = new caching.Cache(300, 32);
	assert.equal(cache.get("nope"), null);
});

test("Cache set and get returns cloned data", () => {
	const cache = new caching.Cache(300, 32);
	const labels = [{ name: "a", color: "ff0000" }];
	const comments = [{ author: "u", when: "t", body: "x" }];
	cache.set("k", labels, comments);
	const hit = cache.get("k");
	assert.ok(hit);
	assert.notEqual(hit.labels, labels);
	hit.labels[0].name = "mutated";
	assert.equal(labels[0].name, "a");
});

test("Cache LRU evicts oldest when at capacity", () => {
	const cache = new caching.Cache(300, 2);
	cache.set("a", [], []);
	cache.set("b", [], []);
	cache.set("c", [], []);
	assert.equal(cache.get("a"), null);
	assert.ok(cache.get("b"));
	assert.ok(cache.get("c"));
});

test("Cache get refreshes LRU order", () => {
	const cache = new caching.Cache(300, 2);
	cache.set("a", [], []);
	cache.set("b", [], []);
	cache.get("a");
	cache.set("c", [], []);
	assert.ok(cache.get("a"));
	assert.equal(cache.get("b"), null);
	assert.ok(cache.get("c"));
});

test("Cache expires entries after TTL", async () => {
	const cache = new caching.Cache(0.05, 32);
	cache.set("k", [], []);
	await new Promise((r) => setTimeout(r, 80));
	assert.equal(cache.get("k"), null);
});

test("readCacheSettings resolves persist path when enabled", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-notif-cache-"));
	const restore = withEnv({
		GH_NOTIFICATION_CACHE_PERSIST: "1",
		GH_NOTIFICATION_CACHE_DIR: dir,
	});
	try {
		const s = caching.readCacheSettings();
		assert.equal(s.persistPath, path.join(dir, "enrichment-cache.json"));
	} finally {
		restore();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("Cache persists entries across instances", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-notif-cache-"));
	const file = path.join(dir, "enrichment-cache.json");
	try {
		const labels = [{ name: "bug", color: "ff0000" }];
		const c1 = new caching.Cache(3600, 32, file);
		c1.set("owner/repo#42:2024-01-01T00:00:00.000Z:0", labels, []);
		const c2 = new caching.Cache(3600, 32, file);
		const hit = c2.get("owner/repo#42:2024-01-01T00:00:00.000Z:0");
		assert.ok(hit);
		assert.equal(hit.labels[0].name, "bug");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("Cache drops expired rows when loading from disk", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-notif-cache-"));
	const file = path.join(dir, "enrichment-cache.json");
	try {
		const c1 = new caching.Cache(0.05, 32, file);
		c1.set("stale", [], []);
		await new Promise((r) => setTimeout(r, 80));
		const c2 = new caching.Cache(300, 32, file);
		assert.equal(c2.get("stale"), null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
