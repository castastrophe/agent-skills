import assert from "node:assert/strict";
import { mock } from "node:test";
import test from "node:test";

import * as caching from "../scripts/caching.js";
import * as core from "../scripts/github.js";

test("relativeTime empty input", () => {
	assert.equal(core.relativeTime(""), "");
	assert.equal(core.relativeTime(null), "");
});

test("relativeTime formats UTC string", () => {
	const s = core.relativeTime("2024-06-01T15:30:00.000Z");
	assert.ok(s.includes("2024"));
	assert.ok(s.includes("UTC"));
});

test("relativeTime formats date object", () => {
	const d = new Date("2024-06-01T15:30:00.000Z");
	const s = core.relativeTime(d);
	assert.ok(s.includes("2024"));
	assert.ok(s.includes("UTC"));
});

test("relativeTime formats date object with format", () => {
	const d = new Date("2024-06-01T15:30:00.000Z");
	const s = core.relativeTime(d);
	assert.equal(s, "June 1, 2024 at 3:30 PM UTC");
	const s2 = core.relativeTime(d, "YYYY-MM-DD");
	assert.equal(s2, "2024-06-01");
	const s3 = core.relativeTime(d, "YYYY-MM-DDTHH:mm:ssZ");
	assert.equal(s3, "2024-06-01T15:30:00.000Z");
	const s4 = core.relativeTime(d, "YYYY-MM-DDTHH:mm:ss");
	assert.equal(s4, "2024-06-01T15:30:00");
	const s5 = core.relativeTime(d, "YYYY-MM-DDTHH:mm:ss.SSS");
	assert.equal(s5, "2024-06-01T15:30:00.000Z");
	const s6 = core.relativeTime(d, "YYYY-MM-DDTHH:mm:ss.SSSZ");
	assert.equal(s6, "2024-06-01T15:30:00.000Z");
});

test("date formats date object with format", () => {
	const d = new Date("2024-06-01T15:30:00.000Z");
	const s = core.date(d);
	assert.equal(s, "2024-06-01T15:30:00.000Z");
	const s2 = core.date(d, "YYYY-MM-DD");
	assert.equal(s2, "2024-06-01");
	const s3 = core.date(d, "YYYY-MM-DDTHH:mm:ssZ");
	assert.equal(s3, "2024-06-01T15:30:00.000Z");
	const s4 = core.date(d, "YYYY-MM-DDTHH:mm:ss");
	assert.equal(s4, "2024-06-01T15:30:00");
	const s5 = core.date(d, "YYYY-MM-DDTHH:mm:ss.SSS");
	assert.equal(s5, "2024-06-01T15:30:00.000Z");
});

test("date_relative formats date string with format", () => {
	const s = core.date_relative("2024-06-01T15:30:00.000Z");
	assert.equal(s, "2024-06-01T15:30:00.000Z");
});


test("subjectNumber and subjectHtmlUrl", () => {
	assert.equal(
		core.subjectNumber("https://api.github.com/repos/o/r/issues/42"),
		"42",
	);
	assert.equal(
		core.subjectHtmlUrl("https://api.github.com/repos/o/r/pulls/99"),
		"https://github.com/o/r/pull/99",
	);
});

test("parseRepo", () => {
	assert.deepEqual(core.parseRepo("owner/repo"), { owner: "owner", repo: "repo" });
	assert.deepEqual(core.parseRepo("nope"), { owner: "", repo: "" });
	assert.deepEqual(core.parseRepo("/only"), { owner: "", repo: "" });
});

test("commentSinceCutoff invalid date falls back to now", () => {
	const d = core.commentSinceCutoff("not-a-date");
	assert.ok(d instanceof Date);
	assert.ok(!Number.isNaN(d.getTime()));
});

test("latestCommentIdFromNotification", () => {
	const u =
		"https://api.github.com/repos/octocat/Hello-World/issues/comments/99";
	assert.equal(
		core.latestCommentIdFromNotification({
			subject: { latest_comment_url: u },
		}),
		99,
	);
	assert.equal(
		core.latestCommentIdFromNotification({ subject: {} }),
		0,
	);
});

test("cacheKey normalizes repo case", () => {
	const s = new Date("2024-01-01T12:00:00.000Z");
	const k1 = core.cacheKey("Owner/Repo", "42", s, 0);
	const k2 = core.cacheKey("owner/repo", "42", s, 0);
	assert.equal(k1, k2);
});

test("enrichmentProgressRef prefers repo#num", () => {
	const n = { subject: { title: "T" } };
	const card = { repo_full_name: "o/r", issue_number: "7", notif_id: "1" };
	assert.equal(core.enrichmentProgressRef(n, card, 0), "o/r#7");
});

test("renderDashboardHtml empty cards", () => {
	const html = core.renderDashboardHtml({ notifications: [] }, "");
	assert.ok(html.includes("All clear"));
});

test("renderDashboardHtml single notification shape", () => {
	const instance = { notifications: [
		{
			title: "T",
			reason: "mention",
			updated_at: new Date().toISOString(),
			notif_id: "1",
			issue_number: "42",
			issue_url: "https://api.github.com/repos/o/r/issues/42",
			subject_type: "Issue",
			repo_full_name: "o/r",
			labels: [{ name: "bug", color: "ff0000" }],
			comments: [{ id: 1, created_at: "2024-01-01T00:00:00Z", user: { login: "u1" }, body: "c1" }],
			unread: true,
		},
	] };
	const html = core.renderDashboardHtml(instance, "o/r");
	assert.ok(html.includes("T"));
	assert.ok(html.includes("#42"));
	assert.ok(html.includes("mention"));
	assert.ok(html.includes("bug"));
	assert.ok(html.includes("c1"));
	assert.ok(html.includes("u1"));
	assert.ok(html.includes("2024-01-01T00:00:00Z"));
});

test("getNotificationContext returns null when subject not enrichable", async () => {
	const card = { repo_full_name: "o/r", issue_number: "1", labels: [], comments: [] };
	const r = await core.getNotificationContext(
		{},
		{ subject: { type: "Release" }, updated_at: new Date().toISOString() },
		card,
		{ useCache: false },
	);
	assert.equal(r, null);
});

test("getNotificationContext returns null when issue number missing", async () => {
	const card = { repo_full_name: "o/r", issue_number: "", labels: [], comments: [] };
	const r = await core.getNotificationContext(
		{},
		{
			subject: { type: "Issue", url: "https://api.github.com/repos/o/r/issues/1" },
			updated_at: new Date().toISOString(),
		},
		card,
		{ useCache: false },
	);
	assert.equal(r, null);
});

test("getNotificationContext fetches issue and caches", async () => {
	caching.resetCache();
	const cache = new caching.Cache(300, 32);
	const octokit = {
		rest: {
			issues: {
				get: mock.fn(async () => ({
					data: { labels: [{ name: "bug", color: "ff0000" }] },
				})),
				listComments: mock.fn(async () => ({
					data: [
						{
							id: 1,
							created_at: "2024-01-01T00:00:00Z",
							user: { login: "u1" },
							body: "c1",
						},
					],
				})),
			},
		},
	};
	const n = {
		subject: {
			type: "Issue",
			url: "https://api.github.com/repos/o/r/issues/5",
			latest_comment_url: null,
		},
		updated_at: new Date().toISOString(),
	};
	const card = {
		repo_full_name: "o/r",
		issue_number: "5",
		labels: [],
		comments: [],
	};
	const r1 = await core.getNotificationContext(octokit, n, card, {
		useCache: true,
		cache: cache,
	});
	assert.equal(r1?.cached, false);
	assert.equal(card.labels[0].name, "bug");
	assert.equal(card.comments.length, 1);

	const r2 = await core.getNotificationContext(octokit, n, card, {
		useCache: true,
		cache: cache,
	});
	assert.equal(r2?.cached, true);
	assert.ok(octokit.rest.issues.get.mock.callCount() >= 1);
});

test("getNotificationContext fetches latest comment when not in list", async () => {
	const octokit = {
		rest: {
			issues: {
				get: mock.fn(async () => ({ data: { labels: [] } })),
				listComments: mock.fn(async () => ({ data: [] })),
				getComment: mock.fn(async () => ({
					data: {
						id: 50,
						created_at: "2024-01-02T00:00:00Z",
						user: { login: "ghost" },
						body: "extra",
					},
				})),
			},
		},
	};
	const lc =
		"https://api.github.com/repos/o/r/issues/comments/50";
	const n = {
		subject: {
			type: "Issue",
			url: "https://api.github.com/repos/o/r/issues/5",
			latest_comment_url: lc,
		},
		updated_at: new Date().toISOString(),
	};
	const card = {
		repo_full_name: "o/r",
		issue_number: "5",
		labels: [],
		comments: [],
	};
	await core.getNotificationContext(octokit, n, card, { useCache: false });
	assert.equal(octokit.rest.issues.getComment.mock.callCount(), 1);
	assert.ok(card.comments.some((c) => c.body === "extra"));
});

test("getNotificationRows single worker calls progress", async () => {
	const octokit = {
		rest: {
			issues: {
				get: async () => ({ data: { labels: [] } }),
				listComments: async () => ({ data: [] }),
			},
		},
	};
	const now = new Date().toISOString();
	const notifications = [
		{
			subject: {
				type: "Issue",
				url: "https://api.github.com/repos/o/r/issues/1",
			},
			updated_at: now,
		},
	];
	const cards = [
		{
			repo_full_name: "o/r",
			issue_number: "1",
			labels: [],
			comments: [],
		},
	];
	const progress = mock.fn();
	await core.getNotificationRows(octokit, notifications, cards, {
		enrichMaxWorkers: 1,
		useCache: false,
		onEnrichProgress: progress,
	});
	assert.equal(progress.mock.callCount(), 1);
	assert.equal(progress.mock.calls[0].arguments[0].cached, false);
});

test("findThreadIdForIssue matches issue URL", async () => {
	const octokit = {
		paginate: {
			iterator: () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						data: [
							{
								id: "thread-1",
								repository: { full_name: "o/r" },
								subject: {
									url: "https://api.github.com/repos/o/r/issues/42",
								},
							},
						],
					};
				},
			}),
		},
		rest: {
			activity: {
				listNotificationsForAuthenticatedUser: () => {},
			},
		},
	};
	const tid = await core.findThreadIdForIssue(octokit, "o/r", 42);
	assert.equal(tid, "thread-1");
});

test("findThreadIdForIssue returns null when no match", async () => {
	const octokit = {
		paginate: {
			iterator: () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { data: [] };
				},
			}),
		},
		rest: {
			activity: {
				listNotificationsForAuthenticatedUser: () => {},
			},
		},
	};
	const tid = await core.findThreadIdForIssue(octokit, "o/r", 99);
	assert.equal(tid, null);
});

test("performUnsub validation errors without network", async () => {
	const octokit = {};
	assert.deepEqual(await core.performUnsub(octokit, "r", "x"), {
		ok: false,
		error: "Issue number must be a number",
	});
	assert.deepEqual(await core.performUnsub(octokit, "", "1"), {
		ok: false,
		error: "Repository is required",
	});
});

test("performUnsub deletes subscription and thread on match", async () => {
	const requests = [];
	const octokit = {
		paginate: {
			iterator: () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						data: [
							{
								id: "tid",
								repository: { full_name: "O/R" },
								subject: {
									url: "https://api.github.com/repos/O/R/issues/7",
								},
							},
						],
					};
				},
			}),
		},
		rest: {
			activity: {
				listNotificationsForAuthenticatedUser: () => {},
			},
		},
		request: mock.fn(async (opts) => {
			requests.push(opts);
		}),
	};
	const r = await core.performUnsub(octokit, "o/r", "7");
	assert.equal(r.ok, true);
	assert.equal(requests.length, 2);
});

test("markIssueNotificationDone deletes thread", async () => {
	const octokit = {
		paginate: {
			iterator: () => ({
				[Symbol.asyncIterator]: async function* () {
					yield {
						data: [
							{
								id: "z",
								repository: { full_name: "a/b" },
								subject: {
									url: "https://api.github.com/repos/a/b/issues/2",
								},
							},
						],
					};
				},
			}),
		},
		rest: {
			activity: {
				listNotificationsForAuthenticatedUser: () => {},
			},
		},
		request: mock.fn(async () => {}),
	};
	const r = await core.markIssueNotificationDone(octokit, "a/b", "2");
	assert.equal(r.ok, true);
	assert.equal(octokit.request.mock.callCount(), 1);
});

test("markAllNotificationsDone iterates and deletes", async () => {
	const octokit = {
		paginate: {
			iterator: () => ({
				[Symbol.asyncIterator]: async function* () {
					yield { data: [{ id: "a" }, { id: "b" }] };
				},
			}),
		},
		rest: {
			activity: {
				listNotificationsForAuthenticatedUser: () => {},
			},
		},
		request: mock.fn(async () => {}),
	};
	const r = await core.markAllNotificationsDone(octokit);
	assert.equal(r.ok, true);
	assert.equal(octokit.request.mock.callCount(), 2);
});
