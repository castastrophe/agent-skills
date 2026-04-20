// ---------------------------------------------------------------------------
// enrichment cache (TTL + LRU, optional disk persistence)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.join(__dirname, "..");

const CACHE_FILE_NAME = "enrichment-cache.json";
const CACHE_FORMAT_VERSION = 1;

/** @type {Cache | null} */
let _cacheSingleton = null;
/** @type {string} */
let _cacheCfgKey = "";

/**
 * Read the cache settings from the environment.
 *
 * @returns {{ ttl: number, persistPath: string | null }}
 */
export function readCacheSettings() {
	dotenv.config({ path: path.join(SKILL_ROOT, ".env") });
	dotenv.config();

	// Default to 24 hours.
	let ttl = 86400;
	// Check if the environment variable is set and validate it if it is.
	const parsedEnvTtl = process.env.GH_NOTIFICATION_CACHE_TTL ? parseFloat(process.env.GH_NOTIFICATION_CACHE_TTL?.trim()) : undefined;
	if (typeof parsedEnvTtl === "number" && !Number.isNaN(parsedEnvTtl)) ttl = parsedEnvTtl;

	const dir = process.env.GH_NOTIFICATION_CACHE_DIR?.trim() ? path.resolve(process.env.GH_NOTIFICATION_CACHE_DIR) : process.env.XDG_CACHE_HOME?.trim() ? path.join(path.resolve(process.env.XDG_CACHE_HOME), "gh-notification-summary") : path.join(os.homedir(), ".cache", "gh-notification-summary");

	return { ttl, persistPath: dir ? path.join(dir, CACHE_FILE_NAME) : null };
}

/**
 * Reset the enrichment cache.
 */
export function resetCache() {
	_cacheSingleton = null;
	_cacheCfgKey = "";
}

/**
 * Get the enrichment cache instance.
 *
 * @returns {Cache | null}
 */
export function getCache() {
	const { ttl, persistPath } = readCacheSettings();
	if (ttl <= 0) {
		_cacheSingleton = null;
		_cacheCfgKey = "";
		return null;
	}
	const key = `${ttl}:${persistPath ?? "mem"}`;
	if (!_cacheSingleton || _cacheCfgKey !== key) {
		_cacheSingleton = new Cache(ttl, persistPath);
		_cacheCfgKey = key;
	}
	return _cacheSingleton;
}

/**
 * Enrichment cache implementation.
 *
 * @param {number} ttlSeconds
 * @param {string} [persistPath] — JSON file path; when set, entries survive process restarts until TTL
 */
export class Cache {

	/**
	 * Get the debug mode.
	 *
	 * @param {boolean} value
	 * @returns {void}
	 */
	get debug() {
		return this.#debug;
	}

	/**
	 * Set the debug mode.
	 *
	 * @param {boolean} value
	 * @returns {void}
	 */
	set debug(value) {
		this.#debug = value;
	}

	/**
	 * @type {{ error: (message: string) => void, warn: (message: string) => void, info: (message: string) => void, debug: (message: string) => void }}
	 */


	/**
	 * @type {(type: "info" | "debug" | "error" | "warn", message: string, functionName?: string) => void}
	 */
	#log = (type, message, functionName = "") => {
		const icon = type in ["info", "debug"] ? "i".blue : type === "error" ? "x".red : "!".yellow;
		const prefix = `[Cache${functionName ? `:${functionName}` : ""}]`.dim;
		if (this.#debug && type in ["info", "debug"]) console[type](`${prefix} ${icon} ${message}`);
		else if (type in ["error", "warn"]) console[type](`${prefix} ${icon} ${message}`);

		if (type === "error") throw new Error(`${prefix} ${icon} ${message}`);
	};

	/** @type {boolean} */
	#debug = false;

	/**
	 * @param {number} [ttlSeconds = 86400]
	 * @param {string} [persistPath]
	 * @param {object} [options]
	 * @param {boolean} [options.debug = false]
	 */
	constructor(ttlSeconds = 86400, persistPath = path.join(os.homedir(), ".cache", "gh-notification-summary", CACHE_FILE_NAME), { debug = false } = {}) {
		this._ttl = ttlSeconds;
		this._persistPath = String(persistPath ?? "").trim();
		this.debug = debug;
		this.#log("debug", `initialized with TTL: ${this._ttl} seconds, persist path: ${this._persistPath}`, "constructor");

		/** @type {Map<string, { expire: number, labels: object[], comments: object[] }>} */
		this._store = new Map();
		if (this._persistPath) {
			if (!fs.existsSync(path.dirname(this._persistPath))) {
				this.#log("debug", `Creating cache directory: ${path.dirname(this._persistPath)}`, "constructor");
				fs.mkdirSync(path.dirname(this._persistPath), { recursive: true });
			}
			this.#log("debug", `Loading cache from disk: ${this._persistPath}`, "constructor");
			this.loadFromDisk();
		}
		this.#log("debug", `initialized with ${this._store.size} entries`, "constructor");
	}

	/**
	 * Get a value from the cache.
	 *
	 * @param {string} key
	 * @template T
	 * @returns {T | undefined}
	 */
	get(key) {
		this.#log("debug", `getting entry: ${key}`, "get");
		const store = this._store.get(key);
		this.#log("debug", `getting entry: ${key} -> ${JSON.stringify(store, null, 2)}`, "get");

		if (!store) return;
		const { expire, value } = store;

		const now = Date.now() / 1000;
		if (expire && expire < now) {
			this.#log("debug", `entry expired: ${key}`, "get");
			this._store.delete(key);
			this.persistToDisk();

			return;
		}

		this.#log("debug", `entry hit: ${key}`, "get");
		this._store.delete(key);
		this._store.set(key, { expire, value });

		return value;
	}

	/**
	 * @param {string} key
	 * @param {object[]} value
	 */
	set(key, value) {
		this.#log("debug", `setting entry: ${key}`, "set");
		const now = Date.now() / 1000;
		const expire = now + this._ttl;

		this.#log("debug", `setting entry: ${key} -> ${expire} (now: ${now})`, "set");
		this.#log("debug", `setting payload: ${value}`, "set");
		this._store.set(key, { expire, value });
		this.#log("debug", `entry persisted to disk`, "set");
		this.persistToDisk();
	}

	/**
	 * Create a cache key for a notification.
	 *
	 * @param {string} user
	 * @param {{ owner: string, repo: string }[]} repoFilter
	 * @param {number | undefined} issueNumber
	 * @param {Date | undefined} since
	 * @param {number | undefined} latestCommentId
	 * @returns {string}
	 */
	createKey(user, ...identifiers) {
		// We can't fetch the cache for someone else's authenticated user...
		if (!user) {
			this.#log("error", "user is required to generate a cache key", "createKey");
			return;
		}

		// Some of these values are optional, so we need to include them in the key if they are present.
		const key = [user?.trim(), ...identifiers]
			.map((k) => String(k)?.trim()?.toLowerCase())
			.filter(Boolean)
			.join("#");
		this.#log("debug", `created key: ${key}`, "createKey");
		return key;
	}

	/**
	 * Load the cache from disk.
	 */
	loadFromDisk() {
		this.#log("debug", `Cache loading from disk: ${this._persistPath}`, "loadFromDisk");
		if (!this._persistPath) {
			this.#log("debug", `Cache loading from disk: no persist path, skipping`, "loadFromDisk");
			return;
		}

		let raw;
		try {
			raw = fs.readFileSync(this._persistPath, "utf8");
		} catch (e) {
			if (e instanceof Error && e.code === "ENOENT") {
				this.#log("debug", `Cache loading from disk: file not found, skipping`, "loadFromDisk");
				return;
			}
			this.#log("debug", `Cache loading from disk: error reading file: ${e.message}`, "loadFromDisk");
			throw new Error(`Failed to read cache file: ${this._persistPath}`, { cause: e });
		}

		/** @type {{ v: number, order: string[], entries: Record<string, { expire: number, value: any }> }} */
		let parsed;
		try {
			parsed = JSON.parse(raw);
		} catch (e) {
			this.#log("debug", `Cache loading from disk: error parsing file: ${raw}`, "loadFromDisk");
			throw new Error(`Failed to parse cache file: ${this._persistPath}: ${e.message}`, { cause: e });
		}

		if (!parsed || parsed.v !== CACHE_FORMAT_VERSION || typeof parsed.entries !== "object") {
			this.#log("debug", `Cache loading from disk: invalid file format: ${raw}`, "loadFromDisk");
			throw new Error(`Failed to parse cache file: ${this._persistPath}: invalid file format`);
		}

		this.#log("debug", `Cache loading from disk: file parsed: ${JSON.stringify(parsed)}`, "loadFromDisk");

		const now = Date.now() / 1000;
		const order = Array.isArray(parsed.order) ? parsed.order : Object.keys(parsed.entries);

		this.#log("debug", `Cache loading from disk: order: ${JSON.stringify(order)}`, "loadFromDisk");
		for (const k of order) {
			this.#log("debug", `Cache loading from disk: processing entry: ${k}`, "loadFromDisk");
			const row = parsed.entries[k];
			if (!row || typeof row.expire !== "number" || row.expire < now) {
				this.#log("debug", `Cache loading from disk: entry expired: ${k}`, "loadFromDisk");
				continue;
			}
			if (!Array.isArray(row.labels) || !Array.isArray(row.comments)) {
				this.#log("debug", `Cache loading from disk: entry invalid: ${k}`, "loadFromDisk");
				continue;
			}
			this.#log("debug", `Cache loading from disk: setting entry: ${k}`, "loadFromDisk");
			this._store.set(k, {
				expire: row.expire,
				labels: structuredClone(row.labels),
				comments: structuredClone(row.comments),
			});
			this.#log("debug", `Cache loading from disk: entry set: ${k}`, "loadFromDisk");
		}
		this.#log("debug", `Cache loading from disk: done`, "loadFromDisk");
	}

	persistToDisk() {
		this.#log("debug", `Cache persisting to disk: ${this._persistPath}`, "persistToDisk");
		if (!this._persistPath) {
			this.#log("debug", `Cache persisting to disk: no persist path, skipping`, "persistToDisk");
			return;
		}
		const dir = path.dirname(this._persistPath);
		if (!fs.existsSync(dir)) {
			this.#log("debug", `Cache persisting to disk: creating directory: ${dir}`, "persistToDisk");
			fs.mkdirSync(dir, { recursive: true });
		}

		/** @type {Record<string, { expire: number, labels: object[], comments: object[] }>} */
		const entries = {};
		for (const [k, row] of this._store) {
			this.#log("debug", `Cache persisting to disk: processing entry: ${k}`, "persistToDisk");
			entries[k] = {
				expire: row.expire,
				labels: structuredClone(row.labels),
				comments: structuredClone(row.comments),
			};
		}
		this.#log("debug", `Cache persisting to disk: payload: ${JSON.stringify({
			v: CACHE_FORMAT_VERSION,
			order: [...this._store.keys()],
			entries,
		})}`);

		const payload = JSON.stringify({
			v: CACHE_FORMAT_VERSION,
			order: [...this._store.keys()],
			entries,
		});

		this.#log("debug", `Cache persisting to disk: payload: ${payload}`, "persistToDisk");
		const tmp = `${this._persistPath}.${process.pid}.tmp`;
		try {
			fs.writeFileSync(tmp, payload, "utf8");
			fs.renameSync(tmp, this._persistPath);
		} catch (e) {
			this.#log("debug", `Cache persisting to disk: error writing file: ${tmp}`, "persistToDisk");
			try {
				fs.unlinkSync(tmp);
			} catch {
				this.#log("debug", `Cache persisting to disk: error deleting tmp file: ${tmp}`, "persistToDisk");
				// ignore error
			}
			throw new Error(`Failed to persist cache to disk`, { cause: e });
		}
	}
}
