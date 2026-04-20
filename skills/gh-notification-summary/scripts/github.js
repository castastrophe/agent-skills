/**
 * GitHub notifications: helpers, enrichment cache, HTML build, HTTP handler bits.
 * CLI lives in `bin/cli.js`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { Octokit } from "@octokit/rest";
import { createMockOctokit, loadOctokitFixtures } from "../tests/fixtures/octokit-mock.js";
import { getCache } from "./caching.js";

import "colors";
import "dotenv/config";

/**
 * Mask a token for console output.
 *
 * @param {string} token
 * @returns {string}
 */
export function maskToken(token) {
	return token.slice(0, 4) + (token.length - 4 > 0 ? Array(token.length - 4).fill("*").join("") : "");
}

/**
 * @typedef {object} NotificationsOptions
 * @property {string | undefined} [token] - The GitHub token to use, or undefined to use the default from the environment.
 * @property {boolean} [debug = false]
 */
export class Notifications {
	/** @type {boolean} */
	#debug = false;

	/** @type {Record<string, unknown> | null} */
	#testFixtures = null;

	/** @type {NotificationItem[] | undefined} */
	#notifications = [];

	/** @type {import("./caching").Cache | null} */
	#cache = null;

	/** @type {number} */
	#maximumAwait = 1000;

	/**
	 * Get the maximum await time.
	 *
	 * @returns {number}
	 */
	get maximumAwait() {
		return this.#maximumAwait;
	}

	/** @type {Anthropic | null} */
	ai = null;

	/**
	 * Get the notifications.
	 *
	 * @returns {NotificationItem[]}
	 */
	get notifications() {
		return this.#notifications;
	}

	/**
	 * Set the notifications.
	 *
	 * @param {NotificationItem[]} value
	 * @returns {void}
	 */
	set notifications(value) {
		this.#notifications = value;
	}

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
	 * @param {{ owner: string, name: string }} repo
	 * @param {string} number
	 * @returns {string | undefined}
	 */
	getAISummaryFixture(repo, number) {
		const map = this.#testFixtures?.getAISummaryByIssue;
		if (!map || typeof map !== "object") return undefined;
		const key = `${repo.owner}/${repo.name}#${number}`;
		const v = /** @type {Record<string, string>} */ (map)[key];
		return typeof v === "string" ? v : undefined;
	}

	/**
	 * @type {(type: "info" | "debug" | "error" | "warn", message: string, functionName?: string) => Error | void}
	 */
	#log = (type, message, functionName = "") => {
		const icon = type in ["info", "debug"] ? "i".blue : type === "error" ? "x".red : "!".yellow;
		const prefix = `[Notifications${functionName ? `:${functionName}` : ""}]`.dim;
		if (this.#debug && type in ["info", "debug"]) return `${prefix} ${icon} ${message}`;
		else if (type in ["warn", "error"]) return `${prefix} ${icon} ${message}`;
		return undefined;
	};

	/**
	 * Connect to the GitHub API.
	 *
	 * @param {string} token - The GitHub token to use.
	 * @returns {import("@octokit/rest").Octokit | void}
	 */
	connect(token) {
		if (!token) {
			const error = this.#log("error", "GitHub token is required to fetch notifications from the API.", "connect");
			if (error) throw new Error(error);
			return;
		}

		const log = this.#log("debug", `connecting to the GitHub API with token: ${maskToken(token)}`, "connect");
		if (log) console.log(log);

		try {
			this.octokit = new Octokit({ auth: token });
		} catch (e) {
			const error = this.#log("error", `failed to connect to the GitHub API: ${e?.message ?? String(e)}`, "connect");
			if (error) throw new Error(error, { cause: e });
			return;
		}

		return this.octokit;
	}

	/**
	 * Create an AI client.
	 * @todo - Fetch the API key from the environment.
	 * @todo - Let the user specify the AI API of their choice.
	 *
	 * @returns {Anthropic | void}
	 */
	createAIClient() {
		if (!process.env.ANTHROPIC_API_KEY?.trim()) {
			const warn = this.#log("warn", "Anthropic API key is required to create a client.", "createAIClient");
			if (warn) console.warn(warn);
			return;
		}

		try {
			this.ai = new Anthropic({
				apiKey: process.env.ANTHROPIC_API_KEY,
				max_tokens: 1000,
			});
		} catch (e) {
			const warn = this.#log("warn", `failed to create Anthropic client: ${e?.message ?? String(e)}`, "createAIClient");
			if (warn) console.warn(warn);
			return;
		}

		return this.ai;
	}

	/**
	 * Constructor.
	 *
	 * @param {string} token - The GitHub token to use.
	 * @param {object} [opts]
	 * @param {boolean} [opts.debug = false] - Whether to enable debug mode.
	 * @param {boolean} [opts.cache = true] - Whether to enable caching.
	 */
	constructor(token, { debug = false, cache = true, skipAI = true, testMode = false } = {}) {
		this.debug = debug;

		if (!token && !testMode) {
			const error = this.#log("error", "GitHub token is required to fetch from the API.", "constructor");
			if (error) throw new Error(error);
			return;
		}

		if (testMode) {
			const fixturePath = process.env.GITHUB_TEST_FIXTURE_PATH?.trim() || undefined;
			this.#testFixtures = loadOctokitFixtures(fixturePath);
			this.ai = this.getAISummaryFixture;
			this.octokit = createMockOctokit(this.#testFixtures);
		} else {
			this.connect(token);
		}

		const info = this.#log("info", `initialized with token: ${maskToken(token || "fixture").dim}`, "constructor");
		if (info) console.info(info);

		if (!skipAI) this.createAIClient();


		// Check the cache for a hit if caching is enabled.
		if (cache) {
			this.#cache = getCache();
			const info = this.#log("info", `initialized with cache: ${this.#cache.debug ? "true" : "false"}`, "constructor");
			if (info) console.info(info);
		}
	}

	/**
	 * Initialize the Notifications instance.
	 *
	 * @returns {Promise<void>}
	 */
	async initialize() {
		return this.getUser().then(() => this.getNotifications()).then(() => {
			const debug = this.#log("debug", `initialized`, "initialize");
			if (debug) console.debug(debug);
		}).catch((e) => {
			const error = this.#log("error", `failed to initialize: ${e?.message ?? String(e)}`, "initialize");
			if (error) throw new Error(error);
			return Promise.reject(e);
		});
	}

	/**
	 * Allow a title-case or kebab-case repository name to be passed in, and return a normalized repository name for the Rest API.
	 * Return the value split into an object with owner and repo parts.
	 *
	 * @param {string} string - The repository string to convert to a normalized repository name.
	 * @returns {{ owner: string, name: string } | undefined}
	 */
	normalizeRepositoryString(string) {
		if (typeof string === "object" && string?.owner && string?.name) {
			const debug = this.#log("debug", `repository is already normalized: ${JSON.stringify(string, null, 2)}`, "normalizeRepositoryString");
			if (debug) console.debug(debug);
			return string;
		} else if (typeof string !== "string") {
			const error = this.#log("error", `repository must be a string: ${typeof string} (${string})`, "normalizeRepositoryString");
			if (error) throw new Error(error);
			return undefined;
		}

		const cleanString = string.trim()?.toLowerCase().replace(/^https?:\/\//, "").replace(/^\//, "").replace(/\/$/, "").replace(/^api\.github\.com\/repos\//, "");
		const parts = cleanString?.split("/");
		if (parts.length === 2) {
			const obj = { owner: parts[0], name: parts[1] };
			const debug = this.#log("debug", `repository normalized: ${JSON.stringify(obj, null, 2)}`, "normalizeRepositoryString");
			if (debug) console.debug(debug);
			return obj;
		}

		const error = this.#log("error", `invalid repository format. provided: ${string}, cleaned: ${cleanString}`, "normalizeRepositoryString");
		if (error) throw new Error(error);

		return undefined;
	}

	/**
	 * Get the user information from the authenticated instance.
	 *
	 * @returns {Promise<string>}
	 * @throws {Error}
	 */
	async getUser() {
		if (this.user) {
			const debug = this.#log("debug", `user already set: ${this.user}`, "getUser");
			if (debug) console.debug(debug);
			return Promise.resolve(this.user);
		}

		// If the user is not set, fetch it from the API.
		return this.octokit.rest.users.getAuthenticated().then((result) => {
			const { status, data: user, ...metadata } = result;

			if (status !== 200) {
				const error = this.#log("error", `failed to get user information from the authenticated instance: ${status} ${JSON.stringify(metadata, null, 2)}`, "getUser");
				if (error) throw new Error(error);
				return Promise.resolve(undefined);
			}

			const debug = this.#log("debug", `fetched user information: ${JSON.stringify(user, null, 2)}`, "getUser");
			if (debug) console.debug(debug);

			if (!user?.login) {
				const error = this.#log("error", "failed to get user information from the authenticated instance, no login found.", "getUser");
				if (error) throw new Error(error);
				return Promise.resolve(undefined);
			}

			this.user = user.login;

			const confirmed = this.#log("debug", `user set: ${this.user}`, "getUser");
			if (confirmed) console.debug(confirmed);
			return Promise.resolve(this.user);
		}).catch((e) => {
			const error = this.#log("error", `failed to get user information from the authenticated instance: ${e?.message ?? String(e)}`, "getUser");
			if (error) throw new Error(error, { cause: e });
			return Promise.resolve(undefined);
		});
	}

	/**
	 * Get the notifications from the API, optionally resetting the notifications if they are already cached.
	 *
	 * @returns {Promise<object[] | undefined>}
	 */
	async getNotifications() {
		if (this.notifications && this.notifications.length > 0) {
			const debug = this.#log("debug", `notifications already set: ${this.notifications.length}`, "getNotifications");
			if (debug) console.debug(debug);
			return Promise.resolve(this.notifications);
		}

		let cacheKey;

		// Check the cache for a hit if caching is enabled.
		if (this.#cache) {
			cacheKey = this.#cache.createKey(this.user);

			if (!cacheKey) {
				const warn = this.#log("warn", "failed to create cache key", "getNotifications");
				if (warn) console.warn(warn);
			} else {
				const debug = this.#log("debug", `cache key: ${cacheKey}`, "getNotifications");
				if (debug) console.debug(debug);
				const cached = this.#cache.get(cacheKey);
				if (Array.isArray(cached) && cached?.length > 0) {
					const debug = this.#log("debug", `cache hit for ${cacheKey}: ${cached?.length ?? 0} notifications`, "getNotifications");
					if (debug) console.debug(debug);
					this.notifications = cached;
					return Promise.resolve(this.notifications);
				}
			}
		}

		const debug = this.#log("debug", `fetching notifications from API`, "getNotifications");
		if (debug) console.debug(debug);

		return this.octokit.paginate(
			this.octokit.rest.activity.listNotificationsForAuthenticatedUser,
			{ per_page: 100 }
		).then(async (notifications) => {
			const debug = this.#log("debug", `fetched ${notifications?.length ?? 0} notifications: ${JSON.stringify(notifications, null, 2)}`, "getNotifications");
			if (debug) console.debug(debug);

			if (!Array.isArray(notifications) || notifications?.length === 0) {
				const info = this.#log("info", `no notifications found`, "getNotifications");
				if (info) console.info(info);
				if (this.#cache && cacheKey) {
					this.#cache.set(cacheKey, []);
				}
				this.notifications = [];
				return Promise.resolve([]);
			}

			// Enhance the notifications with the labels and comments if they are not already set (via a cache hit).
			const promises = notifications.map(async (n) => {
				if (!n.repo || !n.repo.owner || !n.repo.name) {
					n.repo = await this.normalizeRepositoryString(n.repository?.full_name);
					const debug = this.#log("debug", `normalized repository for notification ${n.issue?.number ?? ""} in ${n.repository?.full_name}: ${JSON.stringify(n.repo, null, 2)}`, "getNotifications");
					if (debug) console.debug(debug);
				}

				if (n && !n.issue) {
					const item = new NotificationItem(this, n);
					const debug = this.#log("debug", `created notification item for ${n.issue?.number ?? ""} in ${n.repository?.full_name}`, "getNotifications");
					if (debug) console.debug(debug);
					// Await fetching of the labels and comments.
					return item.initialize().then(() => {
						const debug = this.#log("debug", `await promises for notification item ${n.issue?.number ?? ""} in ${n.repository?.full_name} completed`, "getNotifications");
						if (debug) console.debug(debug);
						return Promise.resolve(item);
					}).catch((e) => {
						const error = this.#log("error", `failed to await promises for notification item ${n.issue?.number ?? ""} in ${n.repository?.full_name}: ${e?.message ?? String(e)}`, "getNotifications");
						if (error) throw new Error(error, { cause: e });
						return Promise.resolve(undefined);
					});
				}

				const debug = this.#log("debug", `notification ${n.issue?.number ?? ""} in ${n.repository?.full_name} is already processed`, "getNotifications");
				if (debug) console.debug(debug);
				return Promise.resolve(n);
			});

			return Promise.all(promises).then((results) => {
				this.notifications = Array.isArray(results) ? results.filter(Boolean) : [];
				const debug = this.#log("debug", `processed ${this.notifications?.length ?? 0} notifications`, "getNotifications");
				if (debug) console.debug(debug);

				if (this.#cache && cacheKey) {
					this.#cache.set(cacheKey, this.notifications);
					const debug = this.#log("debug", `cached ${this.notifications?.length ?? 0} notifications`, "getNotifications");
					if (debug) console.debug(debug);
				}

				return Promise.resolve(this.notifications);
			}).catch((e) => {
				const error = this.#log("error", `failed to await promises for notifications: ${e?.message ?? String(e)}`, "getNotifications");
				if (error) throw new Error(error, { cause: e });
				return Promise.resolve([]);
			});
		}).catch((e) => {
			const error = this.#log("error", `failed to fetch: ${e?.message ?? String(e)}`, "getNotifications");
			if (error) throw new Error(error, { cause: e });
			return Promise.resolve([]);
		});
	}

	/**
	 * Find a notification item by its thread ID.
	 *
	 * @param {string} id - The thread ID of the notification to find.
	 * @returns {NotificationItem|undefined}
	 */
	findItemById(id) {
		const item = Array.isArray(this.notifications) ? this.notifications.find((n) => String(n.thread_id) === String(id)) : undefined;
		if (!item) {
			const error = this.#log("error", `notification item not found by provided id: ${String(id)}`, "findItemById");
			if (error) throw new Error(error, { cause: id });
			return;
		}
		return item;
	}

	/**
	 * Mark all notifications as done.
	 *
	 * @returns {Promise<void>}
	 */
	async markAllAsDone() {
		const status = Array.isArray(this.notifications) ? this.notifications.filter((n) => n.status !== "done") : [];

		if (status?.length === 0) {
			const info = this.#log("info", `all notifications are already flagged as done.`, "markAllAsDone");
			if (info) console.info(info);
			return Promise.resolve();
		}

		return this.octokit.paginate(
			this.octokit.rest.activity.markNotificationsAsRead,
			{ per_page: 100 }
		).then(async (result) => {
			const status = result && typeof result === "object" && "status" in result ? /** @type {{ status?: number }} */ (result).status : undefined;
			if (status !== undefined && (status < 200 || status >= 300)) {
				const error = this.#log("error", `failed to mark notifications as read: ${status}`, "markAllAsDone");
				if (error) throw new Error(error, { cause: result });
			}
			const debug = this.#log("debug", `notifications marked as read: ${status}`, "markAllAsDone");
			if (debug) console.debug(debug);
		}).catch((e) => {
			const error = this.#log("error", `failed to mark notifications as read: ${e?.message ?? String(e)}`, "markAllAsDone");
			if (error) throw new Error(error, { cause: e });
		});
	}

	/**
	 * Mark a specific notification as done.
	 *
	 * @param {string} id - The id of the notification to mark as done.
	 * @returns {Promise<void>}
	 */
	async markAsDone(id) {
		/** @type {NotificationItem | undefined} */
		const notification = this.findItemById(id);
		if (!notification) {
			const error = this.#log("error", `notification not found by provided id: ${String(id)}`, "markAsDone");
			if (error) throw new Error(error, { cause: id });
			return;
		}

		return notification.markAsDone().then(() => {
			const debug = this.#log("debug", `notification ${String(id)} marked as done`, "markAsDone");
			if (debug) console.debug(debug);
			return Promise.resolve();
		}).catch((e) => {
			const error = this.#log("error", `failed to mark notification ${String(id)} as done: ${e?.message ?? String(e)}`, "markAsDone");
			if (error) throw new Error(error, { cause: e });
			return Promise.reject(new Error(error ?? e));
		}).finally(() => {
			const debug = this.#log("debug", `notification ${String(id)} marked as done`, "markAsDone");
			if (debug) console.debug(debug);
		});
	}
}

export class NotificationItem {
	/** @type {boolean} */
	#debug = false;

	/**
	 * Get the debug mode.
	 *
	 * @returns {boolean}
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

	/** @type {Notifications} */
	#parent = undefined;

	/** @type {Octokit} */
	#octokit;

	/**
	 * @type {(type: "info" | "debug" | "error" | "warn", message: string, functionName?: string) => void}
	 */
	#log = (type, message, functionName = "") => {
		const icon = type in ["info", "debug"] ? "i".blue : type === "error" ? "x".red : "!".yellow;
		const prefix = `[NotificationItem${functionName ? `:${functionName}` : ""}]`.dim;
		if (this.#debug && type in ["info", "debug"]) return `${prefix} ${icon} ${message}`;
		else if (type in ["warn", "error"]) return `${prefix} ${icon} ${message}`;
		return undefined;
	};

	/**
	 * Constructor.
	 *
	 * @param {Notifications} parent
	 * @param {import("@octokit/rest").RestEndpointMethodTypes["activity"]["listNotificationsForAuthenticatedUser"]["response"]["data"]} notification
	 * @returns {void}
	 */
	constructor(parent, data) {
		this.#debug = parent.debug;
		this.#parent = parent;
		this.#octokit = parent.octokit;

		if (!data || typeof data !== "object") {
			const error = this.#log("error", `invalid notification data: ${JSON.stringify(data, null, 2)}`, "constructor");
			if (error) throw new Error(error, { cause: data });
			return;
		}

		// This stores the original, raw data from the API response.
		this.raw = data;
		const debug = this.#log("debug", `raw notification data: ${JSON.stringify(this.raw, null, 2)}`, "constructor");
		if (debug) console.debug(debug);

		// Derived by the parent before instantiating the NotificationItem.
		this.repo = data.repo;

		// The following properties are derived from the original data.
		this.title = data.subject?.title;
		this.type = data.subject?.type;
		this.url = data.subject?.url;

		if (data.subject?.latest_comment_url) {
			this.latest_comment_id = String(data.subject?.latest_comment_url).replace(/\/$/, "").split("/").pop();
		}

		this.number = String(this.url).replace(/\/$/, "").split("/").pop();
		this.updated_at = data.updated_at;
		this.last_read_at = data.last_read_at;
		this.id = data.id;
		this.thread_id = data.id;
		this.isUnread = data.unread;
		this.reason = data.reason;
	}

	/**
	 * Await the promises for the labels and comments.
	 *
	 * @returns {Promise<void>}
	 */
	async initialize() {
		return Promise.all([
			this.fetchIssueDetails(),
			this.fetchComments().then((comments) => this.getAISummary(comments)),
		]).then(() => {
			const debug = this.#log("debug", `initialized`, "initialize");
			if (debug) console.debug(debug);
		}).catch((e) => {
			const error = this.#log("error", `failed to initialize: ${e?.message ?? String(e)}`, "initialize");
			if (error) throw new Error(error, { cause: e });
			return Promise.reject(e);
		});
	}

	/**
	 * Get the issue details for the issue/pull request.
	 *
	 * @returns {Promise<void>}
	 */
	async fetchIssueDetails() {
		const debug = this.#log("debug", `fetching issue details for ${this.repo?.owner}/${this.repo?.name}#${this.number}`, "fetchIssueDetails");
		if (debug) console.debug(debug);

		return this.#octokit.issues.get({
			owner: this.repo.owner,
			repo: this.repo.name,
			issue_number: this.number,
		}).then((result) => {
			const { status, data: issue, ...metadata } = result;
			if (status !== 200) {
				const error = this.#log("error", `failed to fetch issue details for ${this.repo?.owner}/${this.repo?.name}#${this.number}: ${status} ${JSON.stringify(metadata, null, 2)}`, "fetchIssueDetails");
				if (error) throw new Error(error, { cause: result });
				return;
			}

			const debug = this.#log("debug", `fetched issue details for ${this.repo?.owner}/${this.repo?.name}#${this.number}: ${JSON.stringify(issue, null, 2)}`, "fetchIssueDetails");
			if (debug) console.debug(debug);
			if (!issue) return;

			Object.entries(issue).forEach(([key, value]) => {
				if (key === "labels") return;
				if (key.includes("url")) return;
				if (key.includes("id")) return;
				const debug = this.#log("debug", `setting ${key} to ${JSON.stringify(value, null, 2)}`, "fetchIssueDetails");
				if (debug) console.debug(debug);
				this[key] = value;
			});

			this.labels = issue?.labels.map((l) => {
				let color = typeof l === "object" && l?.color ? String(l.color) : "ededed";
				color = color.replace(/^#/, "");
				if (color.length !== 6) color = "ededed";
				return { name: typeof l === "string" ? l : l.name, color };
			}) ?? [];

			return;
		}).catch((e) => {
			const warn = this.#log("warn", `failed to fetch issue details for ${this.repo?.owner}/${this.repo?.name}#${this.number}: ${e?.message ?? String(e)}`, "fetchIssueDetails");
			if (warn) console.warn(warn);
			return;
		});
	}

	/**
	 * Get the comments for an issue since a given date.
	 *
	 * @returns {Promise<object[]>}
	 */
	async fetchComments() {
		let since = new Date(this.updated_at ?? this.last_read_at);
		// Check if since exists and if it is a valid date.
		if (!since || Number.isNaN(since.getTime())) since = undefined;

		const debug = this.#log("debug", `fetching comments${since ? ` since ${since.toISOString()}` : ""}`, "fetchComments");
		if (debug) console.debug(debug);

		// Fetch the comments from the API.
		return this.#octokit.paginate(
			this.#octokit.rest.issues.listComments,
			{
				owner: this.repo.owner,
				repo: this.repo.name,
				issue_number: this.number,
				// since: since ? since.toISOString() : undefined,
				per_page: 100,
			}
		).then((commentList) => {
			const sinceLabel = since && !Number.isNaN(since.getTime()) ? since.toISOString() : "(none)";
			const debug = this.#log("debug", `fetched ${commentList.length} comments from ${this.repo.owner}/${this.repo.name}#${this.number} since ${sinceLabel}`, "fetchComments");
			if (debug) console.debug(debug);
			if (commentList.length === 0) {
				const debug = this.#log("debug", `no comments found for ${this.repo.owner}/${this.repo.name}#${this.number}`, "fetchComments");
				if (debug) console.debug(debug);
				this.comments = [];
				return Promise.resolve(this.comments);
			}

			// filter out all comments that show up before the latest comment.
			const matchesLatest = (c) => String(c.id) === String(this.latest_comment_id);
			let shouldFilter = false;
			let foundLatestComment = false;
			if (this.latest_comment_id && commentList.some(matchesLatest)) {
				const debug = this.#log("debug", `found latest comment ${this.latest_comment_id} in comments`, "fetchComments");
				if (debug) console.debug(debug);
				shouldFilter = true;
			}
			const comments = commentList.filter((c) => {
				if (!shouldFilter) return true;
				if (matchesLatest(c)) foundLatestComment = true;
				if (shouldFilter && foundLatestComment) return true;
				return false;
			}).map((c) => ({
				url: c.html_url,
				author: c.user?.login,
				author_url: c.user?.html_url,
				author_avatar_url: c.user?.avatar_url,
				author_type: c.user?.type,
				created_at: c.created_at,
				updated_at: c.updated_at,
				body: c.body ?? "",
				reactions: c.reactions.total_count > 0 ? c.reactions : undefined,
			}));

			this.comments = comments;

			return comments;
		}).catch((e) => {
			const warn = this.#log("warn", `failed to fetch comments: ${e?.message ?? String(e)}`, "fetchComments");
			if (warn) console.warn(warn);
			return [];
		});
	}

	/**
	 * Get a summary of the comments using AI.
	 *
	 * @param {object[]} [comments = this.comments]
	 * @returns {Promise<string | undefined>}
	 */
	async getAISummary(comments = this.comments) {
		if (!this.#parent?.ai) {
			const debug = this.#log("debug", `AI client not found, waiting for 1 second`, "getAISummary");
			if (debug) console.debug(debug);
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve(this.getAISummary(comments));
				}, 1000);
			});
		}

		if (!comments?.length) {
			// Attempt to wait for the comments to be fetched.
			comments = await this.fetchComments();
			if (!comments?.length) {
				const warn = this.#log("warn", `no comments found for notification ${this.number} in ${this.repo.owner}/${this.repo.name}`, "getAISummary");
				if (warn) console.warn(warn);
				return Promise.resolve(undefined);
			}
		}

		const prompt = comments.length > 0 ? `Summarize the following GitHub comments to help me understand what has occurred in the conversation since I last read it: ${comments.map((c) => {
			return `on ${c?.updated_at ?? c?.created_at ?? ""}, ${c?.author ? `@${c?.author}` : ""} commented:\n${c?.body}\n\nwith the following reactions: ${c?.reactions ? Object.entries(c?.reactions)?.map(([content, count]) => content !== "total_count" && count > 0 ? `${content} (${count})` : null).filter(Boolean).join(", ") : ""}`;
		}).join("\n")}\n\nPlease provide a concise summary of the conversation, including any new insights, decisions, or actions taken that would assist me in understanding the conversation and any follow-up actions I should take. Specifically call out any follow-up actions I need to take.` : undefined;

		if (!prompt) {
			const debug = this.#log("debug", `no comments found for notification ${this.number} in ${this.repo.owner}/${this.repo.name}`, "getAISummary");
			if (debug) console.debug(debug);
			return Promise.resolve(undefined);
		}

		let response;
		try {
			// Fetch the summary from the AI API of the user's choice.
			response = await this.#parent.ai.messages.create({
				model: "claude-haiku-4-5",
				messages: [
					{
						role: "user",
						content: prompt,
					},
				],
			});
		} catch (e) {
			const warn = this.#log("warn", `failed to get AI summary: ${e?.message ?? String(e)}`, "getAISummary");
			if (warn) console.warn(warn);
			return Promise.resolve(undefined);
		}

		this.summary = response?.content?.[0]?.text ?? undefined;
		const debug = this.#log("debug", `AI summary set: ${this.summary}`, "getAISummary");
		if (debug) console.debug(debug);
		return Promise.resolve(this.summary);
	}

	/**
	 * Unsubscribe from the issue.
	 *
	 * @returns {Promise<{ ok: boolean, error?: string }>}
	 */
	async unsubscribe() {
		const ret = { ok: false };
		if (!this.thread_id) {
			const error = this.#log("warn", `no thread ID found for notification ${this.number} in ${this.repo.owner}/${this.repo.name}`, "unsubscribe");
			if (error) ret.error = error;
			return Promise.resolve(ret);
		}

		return this.#octokit.rest.activity.deleteThreadSubscription({ thread_id: this.thread_id }).then(result => {
			const debug = this.#log("debug", `unsubscribed from notification ${this.number} in ${this.repo.owner}/${this.repo.name}`, "unsubscribe");
			if (debug) console.debug(debug);
			if (result.status !== 204) {
				const error = this.#log("warn", `failed to unsubscribe from notification ${this.number} in ${this.repo.owner}/${this.repo.name}: ${result.status} ${result.statusText}`, "unsubscribe");
				if (error) ret.error = error;
			} else {
				ret.ok = true;
			}

			return Promise.resolve(ret);
		}).catch((e) => {
			const error = this.#log("error", `failed to unsubscribe from notification ${this.number} in ${this.repo.owner}/${this.repo.name}: ${e?.message ?? String(e)}`, "unsubscribe");
			if (error) ret.error = error;
			return Promise.resolve(ret);
		});
	}

	/**
	 * Mark the notification as done.
	 *
	 * @returns {Promise<void>}
	 */
	async markAsDone() {
		if (!this.thread_id) {
			const error = this.#log("error", `no thread ID found for notification ${this.number} in ${this.repo.owner}/${this.repo.name}`, "markAsDone");
			if (error) throw new Error(error);
			return Promise.reject(new Error(error));
		}

		return this.#octokit.rest.activity.markThreadAsDone({ thread_id: this.thread_id }).then(result => {
			const debug = this.#log("debug", `marked notification ${this.number} in ${this.repo.owner}/${this.repo.name} as done`, "markAsDone");
			if (debug) console.debug(debug);
			if (result.status !== 204) {
				const error = this.#log("error", `failed to mark notification ${this.number} in ${this.repo.owner}/${this.repo.name} as done: ${result.status} ${result.statusText}`, "markAsDone");
				if (error) throw new Error(error);
				return Promise.reject(new Error(`failed to mark notification ${this.number} in ${this.repo.owner}/${this.repo.name} as done: ${result.status} ${result.statusText}`));
			}
			return Promise.resolve();
		}).catch((e) => {
			const error = this.#log("error", `failed to mark notification ${this.number} in ${this.repo.owner}/${this.repo.name} as done: ${e?.message ?? String(e)}`, "markAsDone");
			if (error) throw new Error(error);
			return Promise.reject(new Error(error ?? e));
		}).finally(() => {
			const debug = this.#log("debug", `marked notification ${this.number} in ${this.repo.owner}/${this.repo.name} as done`, "markAsDone");
			if (debug) console.debug(debug);
		});
	}

	/**
	 * Mark the notification as read.
	 *
	 * @returns {Promise<void>}
	 */
	async markAsRead() {
		if (!this.thread_id) {
			const error = this.#log("error", `no thread ID found for notification ${this.number} in ${this.repo.owner}/${this.repo.name}`, "markAsRead");
			if (error) throw new Error(error);
			return Promise.reject(new Error(error));
		}

		return this.#octokit.rest.activity.markThreadAsRead({ thread_id: this.thread_id }).then(result => {
			const debug = this.#log("debug", `marked notification ${this.number} in ${this.repo.owner}/${this.repo.name} as read`, "markAsRead");
			if (debug) console.debug(debug);
			if (result.status !== 204) {
				const error = this.#log("error", `failed to mark notification ${this.number} in ${this.repo.owner}/${this.repo.name} as read: ${result.status} ${result.statusText}`, "markAsRead");
				if (error) throw new Error(error);
				return Promise.reject(new Error(error));
			}
			return Promise.resolve();
		}).catch((e) => {
			const error = this.#log("error", `failed to mark notification ${this.number} in ${this.repo.owner}/${this.repo.name} as read: ${e?.message ?? String(e)}`, "markAsRead");
			if (error) throw new Error(error);
			return Promise.reject(new Error(error ?? e));
		}).finally(() => {
			const debug = this.#log("debug", `marked notification ${this.number} in ${this.repo.owner}/${this.repo.name} as read`, "markAsRead");
			if (debug) console.debug(debug);
		});
	}
}
