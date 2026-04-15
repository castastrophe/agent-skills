import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";

import * as server from "../scripts/server.js";

/**
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<{ code: number, headers: Record<string, unknown>, body: string }>}
 */
function handleRequest(req) {
	const handler = server.createHandler("<html>ok</html>");
	return new Promise((resolve, reject) => {
		const res = {
			_code: 200,
			_headers: /** @type {Record<string, unknown>} */ ({}),
			writeHead(c, h) {
				this._code = c;
				this._headers = h ?? {};
			},
			end(b) {
				resolve({
					code: this._code,
					headers: this._headers,
					body: typeof b === "string" ? b : Buffer.from(b ?? "").toString("utf8"),
				});
			},
		};
		handler(req, res).catch(reject);
	});
}

test("createHandler GET / returns HTML", async () => {
	const res = await handleRequest({ method: "GET", url: "/" });
	assert.equal(res.code, 200);
	assert.equal(res.headers["Content-Type"], "text/html; charset=utf-8");
	assert.ok(res.body.includes("ok"));
});

test("createHandler GET empty path returns HTML", async () => {
	const res = await handleRequest({ method: "GET", url: "" });
	assert.equal(res.code, 200);
});

test("createHandler GET unknown path returns 404", async () => {
	const res = await handleRequest({ method: "GET", url: "/nope" });
	assert.equal(res.code, 404);
	assert.equal(res.body, "Not found");
});

test("createHandler POST /api/unsub rejects invalid JSON", async () => {
	const req = {
		method: "POST",
		url: "/api/unsub",
		async *[Symbol.asyncIterator]() {
			yield "not-json{";
		},
	};
	const res = await handleRequest(req);
	assert.equal(res.code, 400);
	const j = JSON.parse(res.body);
	assert.equal(j.ok, false);
	assert.ok(String(j.error).includes("Invalid JSON"));
});

test("createHandler POST /api/unsub 400 when repo missing", async () => {
	const req = {
		method: "POST",
		url: "/api/unsub",
		async *[Symbol.asyncIterator]() {
			yield JSON.stringify({ repo: "", issue: "1" });
		},
	};
	const res = await handleRequest(req);
	assert.equal(res.code, 400);
});

test("createHandler POST /api/unsub 400 when issue not numeric", async () => {
	const req = {
		method: "POST",
		url: "/api/unsub",
		async *[Symbol.asyncIterator]() {
			yield JSON.stringify({ repo: "o/r", issue: "x" });
		},
	};
	const res = await handleRequest(req);
	assert.equal(res.code, 400);
});

test("createHandler POST /api/unsub 502 when thread not found", async () => {
	const performUnsub = mock.fn(async () => ({
		ok: false,
		error: "No matching notification thread for this issue",
	}));
	const handler = server.createHandler("<html></html>", {
		createOctokit: () => ({}),
		performUnsub,
	});
	const res = await new Promise((resolve, reject) => {
		const req = {
			method: "POST",
			url: "/api/unsub",
			async *[Symbol.asyncIterator]() {
				yield JSON.stringify({ repo: "o/r", issue: "1" });
			},
		};
		const resStub = {
			_code: 200,
			_headers: {},
			writeHead(c, h) {
				this._code = c;
				this._headers = h ?? {};
			},
			end(b) {
				resolve({
					code: this._code,
					body: typeof b === "string" ? b : String(b),
				});
			},
		};
		handler(req, resStub).catch(reject);
	});
	assert.equal(res.code, 502);
	assert.equal(performUnsub.mock.callCount(), 1);
});

test("createHandler POST /api/unsub 200 when unsub succeeds", async () => {
	const performUnsub = mock.fn(async () => ({ ok: true, error: "" }));
	const handler = server.createHandler("<html></html>", {
		createOctokit: () => ({}),
		performUnsub,
	});
	const res = await new Promise((resolve, reject) => {
		const req = {
			method: "POST",
			url: "/api/unsub",
			async *[Symbol.asyncIterator]() {
				yield JSON.stringify({ repo: "o/r", issue: "1" });
			},
		};
		const resStub = {
			_code: 200,
			writeHead(c, h) {
				this._code = c;
				this._headers = h ?? {};
			},
			end(b) {
				resolve({ code: this._code, body: String(b) });
			},
		};
		handler(req, resStub).catch(reject);
	});
	assert.equal(res.code, 200);
	assert.deepEqual(JSON.parse(res.body), { ok: true });
});
