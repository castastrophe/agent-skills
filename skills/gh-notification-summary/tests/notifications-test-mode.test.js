import assert from "node:assert/strict";
import test from "node:test";

import { Notifications } from "../scripts/github.js";

test("testMode uses octokit fixtures (no network)", async () => {
	const n = new Notifications("fixture-token", {
		testMode: true,
		cache: false,
		skipAI: true,
	});
	await n.awaitPromises();

	assert.equal(n.user, "fixture-user");
	assert.equal(n.notifications.length, 2);

	const issue = n.notifications[0];
	assert.ok(issue.labels?.some((l) => l.name === "bug"));
	assert.ok(issue.summary?.includes("CDN"));

	const pr = n.notifications[1];
	assert.equal(pr.number, "7");
	assert.ok(pr.summary?.includes("CI"));
});
