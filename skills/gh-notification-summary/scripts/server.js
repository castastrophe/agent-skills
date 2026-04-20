// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { URL } from "url";
import { execFile } from "child_process";
import http from "http";

import prettier from "@prettier/sync";
import nunjucks from "nunjucks";
import randomColor from "randomcolor";
import markdownIt from "markdown-it";

import "colors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

/**
 * Create a dashboard handler.
 *
 * @param {string} htmlContent
 * @param {Notifications} instance
 * @returns {import("http").RequestListener}
 */
export function createHandler(htmlContent, instance) {
	return async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		const pathname = url.pathname;

		if (req.method === "GET" && (pathname === "/" || pathname === "")) {
			const buf = Buffer.from(htmlContent, "utf8");
			res.writeHead(200, {
				"Content-Type": "text/html; charset=utf-8",
				"Content-Length": String(buf.length),
			});
			res.end(buf);
			return;
		}

		if (req.method === "POST" && pathname === "/api/unsub") {
			let body = "";
			req.on("data", (chunk) => { body += chunk; });
			req.on("end", () => {
				const data = JSON.parse(body);
				const thread_id = data?.thread_id;
				if (!thread_id) {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: "No thread ID provided" }));
					return;
				}

				return instance?.findItemById(thread_id)?.unsubscribe().then((result) => {
					if (!result?.ok) {
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ ok: false, error: result?.error ?? "Unknown error" }));
						return;
					}

					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result));
				}).catch((e) => {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }));
				});
			});

			return;
		}

		res.writeHead(404, { "Content-Type": "text/plain" });
		res.end("Not found");
	};
}

/**
 * Start an HTTP server for the dashboard.
 *
 * @param {Notifications} instance
 * @param {object} [options = {}]
 * @param {string[]} [options.filters = []]
 * @param {number} [options.port = 8000]
 * @param {string} [options.hostname = "localhost"]
 * @returns {void}
 * @throws {Error}
 */
export function startHttpServer(instance, { filters = [], port = 8000, hostname = "localhost" } = {}) {
	/**
	 * The HTML content of the dashboard.
	 *
	 * @type {string}
	 */
	const htmlContent = renderDashboardHtml(instance, filters);
	/**
	 * Create the server.
	 *
	 * @returns {http.Server}
	 */
	const server = http.createServer(createHandler(htmlContent, instance));

	/**
	 * Handle errors.
	 *
	 * @param {Error} err
	 * @returns {void}
	 */
	server.on("error", (err) => {
		console.error(err);
		process.exit(1);
	});

	/**
	 * Start the server.
	 *
	 * @returns {void}
	 */
	server.listen(port, hostname, () => {
		console.log(`Dashboard at http://${hostname}:${port} — press Ctrl+C to stop`);
	});
	/**
	 * Open the dashboard in the browser.
	 *
	 * @returns {void}
	 */
	setTimeout(() => {
		const url = `http://${hostname}:${port}`;
		if (process.platform === "darwin") execFile("open", [url], () => {});
		else if (process.platform === "win32")
			execFile("cmd", ["/c", "start", "", url], { windowsHide: true }, () => {});
		else execFile("xdg-open", [url], () => {});
	}, 250);

	/**
	 * Shutdown the server.
	 *
	 * @returns {void}
	 */
	const shutdown = () => {
		server.close();
		process.exit(0);
	};

	/**
	 * Handle SIGINT.
	 *
	 * @returns {void}
	 */
	process.on("SIGINT", () => {
		console.log("\nStopping server…");
		shutdown();
	});

	/**
	 * Handle SIGTERM.
	 *
	 * @returns {void}
	 */
	process.on("SIGTERM", shutdown);
}

// ---------------------------------------------------------------------------
// Converting to HTML
// ---------------------------------------------------------------------------

/**
 * Render the dashboard HTML.
 *
 * @param {Notifications} instance
 * @param {string[]} filters
 * @returns {string}
 */
export function renderDashboardHtml(instance, filters) {
	const minifyOptions = { proseWrap: "never", tabWidth: 0, useTabs: false, bracketSpacing: false, objectWrap: "collapse" };
	const repositories = new Set(instance.notifications.map((c) => `${c.repo?.owner}/${c.repo?.name}`).filter(Boolean));
	const reasons = new Set(instance.notifications.map((c) => c.reason).filter(Boolean));

	const env = getNunjucksEnv();

	function fetchAndFormat(ext) {
		const file = readFileSync(path.join(TEMPLATES_DIR, `dashboard.${ext}`), "utf-8");
		return prettier.format(file, { ...minifyOptions, parser: ext === "css" ? "css" : "babel" });
	}
	return env.render("dashboard.html", {
		styles: fetchAndFormat("css"),
		script: fetchAndFormat("js"),
		filters: filters?.map((r) => r?.trim()).filter(Boolean),
		now: new Date().toISOString(),
		Notifications: instance,
		// sort by owner/name, then updated date
		cards: instance.notifications.sort((a, b) => {
			if (a.repo?.owner !== b.repo?.owner) return a.repo?.owner?.localeCompare(b.repo?.owner);
			if (a.repo?.name !== b.repo?.name) return a.repo?.name?.localeCompare(b.repo?.name);
			return b.updated_at?.getTime() - a.updated_at?.getTime();
		}),
		reasons: [...reasons].sort((a, b) => a?.localeCompare(b)),
		repositories: [...repositories].sort((a, b) => a?.localeCompare(b)),
	});
}

/**
 * Get a Nunjucks environment configured for the skill.
 *
 * @returns {nunjucks.Environment}
 */
function getNunjucksEnv() {
	const env = nunjucks.configure(TEMPLATES_DIR, {
		autoescape: true,
		noCache: true,
	});
	const markdown = markdownIt();
	function plural(n) {
		return n === 1 ? "" : "s";
	}
	env.addFilter("plural", (v) => plural(v));
	env.addFilter("markdown", (v) => markdown.render(v));
	env.addFilter("date", (string, formatOptions) => string ? relativeTime(string, formatOptions) : "");
	env.addFilter("datetime", (string) => string ? new Date(String(string)).toISOString() : "");
	env.addFilter("printify", (v) => String(v ?? "").replace(/-/g, " "));
	env.addFilter("classify", (v) => String(v ?? "").toLowerCase().replace(/[\s/_]/g, "-"));
	env.addFilter("randomColor", (seed, luminosity = "light") => randomColor({ seed, luminosity }));
	return env;
}


/**
 * Format a date as a relative time.
 *
 * @param {Date | string} dt
 * @param {Intl.DateTimeFormatOptions} [formatOptions]
 * @returns {string}
 */
export function relativeTime(dt, formatOptions = {
	weekday: "long",
	year: "numeric",
	month: "long",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
}) {
	if (!dt || !(dt instanceof Date || typeof dt === "string")) return "";
	const d = dt instanceof Date ? dt : new Date(dt);
	const fmt = new Intl.DateTimeFormat("en-GB", formatOptions);
	return d && fmt.format(d) ? `${fmt.format(d)} UTC` : String(d);
}
