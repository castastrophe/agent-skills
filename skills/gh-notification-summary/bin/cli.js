#!/usr/bin/env node
/**
 * Manage GitHub notifications: dashboard, mark-done, unsubscribe.
 *
 *   node scripts/gh-notifications.js fetch [--repo OWNER/REPO]
 *   node scripts/gh-notifications.js done [<issue>] [--repo REPO]
 *   node scripts/gh-notifications.js unsub <issue> [--repo REPO]
 *
 * Requires GITHUB_TOKEN in the environment or skills/gh-notification-summary/.env
 */

import "colors";
import dotenv from "dotenv";
// import inquirer from "inquirer";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { Notifications, maskToken } from "../scripts/github.js";
import * as server from "../scripts/server.js";

/** @type {Notifications | undefined} */
let _notificationsInstance;

/** @type {boolean} */
let _debug = false;

/**
 * @param {("info" | "debug" | "error" | "warn")} type
 * @param {string} message
 * @param {string} [context]
 * @returns {void}
 */
const log = (type, message, context = "") => {
	const icon = type in ["info", "debug"] ? "i".blue : type === "error" ? "x".red : "!".yellow;
	const prefix = `${context ? `[${context}]` : ""}`.dim;
	if (_debug && type in ["info", "debug"]) console[type](`${prefix} ${icon} ${message}`);
	else if (type in ["warn", "error"]) console[type](`${prefix} ${icon} ${message}`);
};

dotenv.config();

/**
 * Initialize the Notifications instance, try to share it across commands if possible.
 *
 * @param {object} argv
 * @param {string | undefined} [argv.token]
 * @param {string | undefined} [argv.user]
 * @param {boolean} [argv.debug = false]
 * @param {boolean} [argv.cache = true]
 * @returns {Notifications | undefined}
 */
function init(argv) {
	const {
		token,
		user,
		debug = false,
		cache = true,
		testMode = false,
	} = argv;

	_debug = debug;
	log("info", "Debug mode is enabled", "init");

	if (_notificationsInstance) {
		// Check if the Notification values are the same as the provided values.
		if (_notificationsInstance.token !== token) {
			// If the token doesn't match, we need to create a new instance.
			log("info", `GitHub token does not match (got ${maskToken(token)?.magenta ?? "undefined".magenta})`, "init");
			_notificationsInstance = undefined;
		} else if (_notificationsInstance.user !== user) {
			// If the user doesn't match, we need to create a new instance.
			log("info", `GitHub token does not belong to user ${user?.magenta ?? "undefined".magenta} (got ${String(_notificationsInstance.user)?.dim ?? "undefined".dim})`, "init");
			_notificationsInstance = undefined;
		} else if (_notificationsInstance.debug !== debug) {
			// If the debug mode doesn't match, just update it and keep the existing instance.
			log("info", `Debug mode does not match (got ${debug ? "true" : "false"}), updating instance`, "init");
			_notificationsInstance.debug = debug;
		} else if (_notificationsInstance.shouldCache !== cache) {
			// If the cache mode doesn't match, just update it and keep the existing instance.
			log("info", `Cache mode does not match (got ${cache ? "true" : "false"}), updating instance`, "init");
			_notificationsInstance.shouldCache = cache;
		}
	}

	// If no instance exists, create a new one.
	if (!_notificationsInstance) {
		_notificationsInstance = new Notifications(token, { debug: true, cache: true, testMode: true });
		log("info", `Initialized new Notifications instance with token: ${maskToken(token)?.magenta ?? "undefined".magenta}`, "init");
		return _notificationsInstance;
	}

	// If an instance exists, return it.
	log("info", `Reusing existing Notifications instance`, "init");
	return _notificationsInstance;
}

/**
 * Create the CLI.
 *
 * @returns {yargs.Argv}
 */
const cli = yargs(hideBin(process.argv))
	.scriptName("gh-notifications")
	.usage("$0 <command> [options]")
	.env("GITHUB")
	.options({
		token: {
			type: "string",
			default: process.env.GITHUB_TOKEN,
			demandOption: true,
			alias: "t",
			describe: "GitHub token (default: GITHUB_TOKEN) (alias: t)",
			global: true,
		},
		user: {
			type: "string",
			default: process.env.GITHUB_USER,
			alias: "u",
			describe: "GitHub user (default: GITHUB_USER) (alias: u)",
			global: true,
		},
		filters: {
			type: "array",
			default: [],
			alias: "f",
			describe: "Filters to apply to the notifications (default: []) (alias: f)",
			global: true,
		},
		cache: {
			type: "boolean",
			default: true,
			alias: "c",
			describe: "Use the cache (default: true) (alias: c)",
			global: true,
		},
		verbose: {
			type: "boolean",
			default: process.env.VERBOSE ?? false,
			alias: "v",
			implies: "debug",
			describe: "Verbose output (default: false) (alias: v)",
			global: true,
		},
		debug: {
			type: "boolean",
			default: true, // process.env.VERBOSE ?? false,
			implies: "verbose",
			describe: "Debug output (default: false) (alias: d)",
			global: true,
			hidden: true,
		},
	})
	.command(
		"fetch",
		"Open the notification dashboard in a browser",
		(y) => y,
		async (argv) => {
			_debug = argv.debug;

			const instance = init(argv);

			// Start by loading the user and notifications if they are not already loaded.
			return instance.initialize().then(() =>
				server.startHttpServer(instance, { filters: argv.filters, port: argv.port, hostname: argv.hostname })
			).catch((e) => {
				log("error", String(e?.message ?? e), "fetch");
				process.exit(1);
			});
		},
	)
	.command(
		"done [issue]",
		"Mark a notification as done",
		(y) => y.positional("issue", { type: "string", describe: "Issue number (omit for all)" }),
		async (argv) => {
			_debug = argv.debug;

			const instance = init(argv);

			return instance.initialize().then(async () => {
				if (argv.issue) {
					log("info", `Marking notification ${String(argv.issue)} as done for ${instance.user}...`, "done");
					return instance.markAsDone(String(argv.issue)).then(() => {
						log("info", "Notification marked as done.", "done");
						process.exit(0);
					});
				}

				log("info", `Marking all notifications as done for ${instance.user}...`, "done");
				return instance.markAllAsDone().then(() => {
					log("info", "All notifications marked as done.", "done");
					process.exit(0);
				});
			}).catch((e) => {
				log("error", String(e?.message ?? e), "done");
				process.exit(1);
			});
		},
	)
	.command(
		"unsub <issue>",
		"Unsubscribe from a notification",
		(y) => y.positional("issue", { type: "string", demandOption: true }),
		async (argv) => {
			_debug = argv.debug;

			const instance = init(argv);

			return instance.initialize().then(() => {
				// Find the notification item connected with the issue number and repo.
				const notificationItem = instance?.notifications.find((n) => String(n.issue?.number) === String(argv.issue));
				if (!notificationItem) {
					log("error", `Notification item not found for issue ${String(argv.issue)}`, "unsub");
					process.exit(1);
				}

				return notificationItem.unsubscribe().then(() => {
					log("info", "Unsubscribed from the notification.", "unsub");
					process.exit(0);
				}).catch((e) => {
					log("error", String(e?.message ?? e), "unsub");
					process.exit(1);
				});
			}).catch((e) => {
				log("error", String(e?.message ?? e), "unsub");
				process.exit(1);
			});
		},
	)
	.demandCommand(1, "Please choose a command: fetch, done, unsub")
	.strict()
	.help();

/**
 * Main entrypoint.
 *
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function main() {
	// @todo - Can we allow the user to run multiple commands in a single invocation? Prompt for another action after each command completes?

	return cli.parseAsync().catch((e) => {
		log("error", String(e?.message ?? e), "main");
		process.exit(1);
	});
}

/**
 * Main entrypoint.
 *
 * @returns {Promise<void>}
 * @throws {Error}
 */
main().catch((err) => {
	log("error", String(err?.message ?? err), "main");
	process.exit(1);
});
