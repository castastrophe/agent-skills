import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, "..", "bin", "cli.js");

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
function runCli(args, extraEnv = {}) {
	return spawnSync(process.execPath, [cliPath, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...extraEnv },
	});
}

test("CLI requires a subcommand", () => {
	const r = runCli([], { GITHUB_REPO: "" });
	assert.notEqual(r.status, 0);
	assert.ok(
		(r.stderr || r.stdout || "").includes("fetch") ||
			(r.stderr || r.stdout || "").includes("command"),
	);
});

test("CLI --help includes fetch and done", () => {
	const r = runCli(["--help"]);
	assert.equal(r.status, 0);
	const out = r.stdout + r.stderr;
	assert.ok(out.includes("fetch"));
	assert.ok(out.includes("done"));
});

test("CLI done rejects non-numeric issue", () => {
	const r = runCli(["done", "abc"], { GITHUB_REPO: "" });
	assert.notEqual(r.status, 0);
	assert.ok((r.stderr || "").includes("number") || (r.stdout || "").includes("number"));
});

test("CLI done with issue requires --repo when GITHUB_REPO unset", () => {
	const r = runCli(["done", "5"], { GITHUB_REPO: "" });
	assert.notEqual(r.status, 0);
	assert.ok((r.stderr || "").includes("repo") || (r.stderr || "").includes("Repo"));
});

test("CLI unsub requires --repo when GITHUB_REPO unset", () => {
	const r = runCli(["unsub", "3"], { GITHUB_REPO: "" });
	assert.notEqual(r.status, 0);
	assert.ok((r.stderr || "").includes("repo") || (r.stderr || "").includes("Repo"));
});
