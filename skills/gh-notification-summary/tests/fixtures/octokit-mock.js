/**
 * Test-only Octokit stand-in: returns data from `octokit-responses.json` so
 * `Notifications` can run full enrichment without calling GitHub.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_FIXTURE_FILE = join(__dirname, "octokit-responses.json");

/**
 * Load JSON fixtures (same shape as Octokit responses / paginate outputs).
 *
 * @param {string} [fixturePath]
 * @returns {Record<string, unknown>}
 */
export function loadOctokitFixtures(fixturePath = DEFAULT_FIXTURE_FILE) {
	return JSON.parse(readFileSync(fixturePath, "utf8"));
}

/**
 * @param {Record<string, unknown>} fixtures
 */
export function createMockOctokit(fixtures) {
	const notifications = fixtures.listNotificationsForAuthenticatedUser;

	const rest = {
		users: {
			getAuthenticated: async () => fixtures.usersGetAuthenticated,
		},
		activity: {
			listNotificationsForAuthenticatedUser: async () => ({ data: notifications }),
			markNotificationsAsRead: async () => ({
				status: fixtures.markNotificationsAsRead?.status ?? 205,
				data: fixtures.markNotificationsAsRead?.data ?? {},
				url: fixtures.markNotificationsAsRead?.url ?? "https://api.github.com/notifications",
			}),
			deleteThreadSubscription: async () => ({ status: 204, statusText: "No Content", url: "", headers: {} }),
			markThreadAsDone: async () => ({ status: 204, statusText: "No Content", url: "", headers: {} }),
			markThreadAsRead: async () => ({ status: 204, statusText: "No Content", url: "", headers: {} }),
		},
		issues: {
			listComments: async (params) => {
				const key = issueKey(params.owner, params.repo, params.issue_number);
				const rows = fixtures.issueListComments[key] ?? [];
				return { data: rows };
			},
		},
	};

	rest.activity.listNotificationsForAuthenticatedUser = Object.assign(
		rest.activity.listNotificationsForAuthenticatedUser,
		{ __fixtureName: "listNotificationsForAuthenticatedUser" },
	);
	rest.issues.listComments = Object.assign(rest.issues.listComments, { __fixtureName: "listComments" });
	rest.activity.markNotificationsAsRead = Object.assign(rest.activity.markNotificationsAsRead, {
		__fixtureName: "markNotificationsAsRead",
	});

	/**
	 * @param {string} owner
	 * @param {string} repo
	 * @param {string | number} issue_number
	 */
	function issueKey(owner, repo, issue_number) {
		return `${owner}/${repo}#${issue_number}`;
	}

	const issuesGet = async (params) => {
		const key = issueKey(params.owner, params.repo, params.issue_number);
		const hit = fixtures.issuesGet[key];
		if (!hit) {
			throw new Error(`[octokit mock] missing issues.get fixture for ${key}`);
		}
		return hit;
	};

	const paginate = async (method, params) => {
		if (method === rest.activity.listNotificationsForAuthenticatedUser) {
			return notifications;
		}
		if (method === rest.issues.listComments) {
			const key = issueKey(params.owner, params.repo, params.issue_number);
			return fixtures.issueListComments[key] ?? [];
		}
		if (method === rest.activity.markNotificationsAsRead) {
			return { status: fixtures.markNotificationsAsRead?.status ?? 205 };
		}
		throw new Error("[octokit mock] paginate: unhandled method (extend octokit-mock.js)");
	};

	return {
		...rest,
		rest,
		issues: { get: issuesGet },
		paginate,
	};
}
