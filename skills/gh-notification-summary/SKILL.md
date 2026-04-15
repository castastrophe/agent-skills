---
name: gh-notification-summary
description: "Review, summarize, and manage GitHub notifications. Use this skill whenever the user mentions GitHub notifications, unread GitHub activity, open issues on their repos, or wants to catch up on project discussions — even if they don't use the word 'notifications'. Also trigger for /unsub <number>, 'mark all done', 'clear my GitHub inbox', or any request to triage, dismiss, or act on GitHub notifications."
---

# GitHub Notification Reviewer

Fetch unread GitHub notifications, present them in an interactive local dashboard, and execute follow-up actions the user requests.

> **Runtime path**: Resolve `<skill-path>` as the directory containing this `SKILL.md` file.
> All script paths below are relative to that directory.

## Environment requirements

- `GITHUB_TOKEN` set in the environment or a `.env` file at `<skill-path>`
- `GITHUB_REPO` (optional) — when set, `fetch` shows only notifications for this repository (`owner/repo`); also used as the default `--repo` for `done` / `unsub` when omitted. If unset, `fetch` lists all unread notifications across your account.

## Local preview

To run the dashboard against your own GitHub account:

```bash
# 1. Copy the example env file and fill in your token
cp <skill-path>/.env.example <skill-path>/.env

# 2. Launch the dashboard
yarn workspace @allons-y/skill-gh-notification-summary preview
```

Your browser will open automatically at `http://localhost:8000`. The command keeps running until you stop it with **Ctrl+C** (that shuts down the server and frees the port).

## CLI

All actions go through a single script with subcommands:

```bash
node <skill-path>/scripts/gh-notifications.js <command> [options]
```

## Workflow

1. Run `gh-notifications.js fetch` to open the dashboard in the user's browser (the process blocks until **Ctrl+C**).
2. The user reviews their notifications at `http://localhost:8000`.
3. Ask whether they want to take any actions — unsubscribe from issues or mark notifications as done.
4. Execute the appropriate subcommand (see Quick Actions below) and confirm the result.

## Launching the dashboard

```bash
node <skill-path>/scripts/gh-notifications.js fetch
```

Optional: limit to one repository (CLI overrides `GITHUB_REPO` when both are set):

```bash
node <skill-path>/scripts/gh-notifications.js fetch --repo owner/repo
```

This fetches unread notifications from the GitHub API. With no `GITHUB_REPO` and no `--repo`, every unread notification is shown. With `GITHUB_REPO` or `--repo`, only notifications for that repository are shown. A local HTTP server listens on port 8000 and the dashboard opens in the browser; **press Ctrl+C** to stop the server and release the port. Each notification is a card with copy-paste quick-action commands.

## Quick Actions

### Unsubscribe from an issue

When the user says `/unsub <number>` or asks to unsubscribe from an issue:

```bash
node <skill-path>/scripts/gh-notifications.js unsub <number> --repo <owner/repo>
```

Unsubscribes from the thread and marks the notification as done. If `--repo` is omitted, `GITHUB_REPO` is used as the default.

### Mark notifications as done

To mark **all** notifications as done:

```bash
node <skill-path>/scripts/gh-notifications.js done
```

To mark a **specific** issue as done:

```bash
node <skill-path>/scripts/gh-notifications.js done <number> --repo <owner/repo>
```

## Dashboard template

The HTML dashboard is rendered from a Nunjucks template at `<skill-path>/scripts/templates/dashboard.html`. To customize the dashboard appearance, edit that template directly. The template receives the parsed notification object.

## Scheduled use

This skill is well-suited for a daily morning routine. When running on a schedule:

1. Launch the dashboard.
2. Present the URL to the user.
3. Ask whether they want to take any actions before wrapping up.
