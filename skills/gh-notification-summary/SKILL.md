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
- `GITHUB_REPO` (optional) — used as the default repository when the user omits one

## CLI

All actions go through a single script with subcommands:

```bash
python <skill-path>/scripts/gh_notifications.py <command> [options]
```

## Workflow

1. Run `gh_notifications.py fetch` to open the dashboard in the user's browser.
2. The user reviews their notifications at `http://localhost:8000`.
3. Ask whether they want to take any actions — unsubscribe from issues or mark notifications as done.
4. Execute the appropriate subcommand (see Quick Actions below) and confirm the result.

## Launching the dashboard

```bash
python <skill-path>/scripts/gh_notifications.py fetch
```

This fetches all unread notifications via the GitHub API, starts a local HTTP server on port 8000, and opens the dashboard automatically. The dashboard shows each notification as a card with labels, latest comments, and copy-paste quick-action commands.

## Quick Actions

### Unsubscribe from an issue

When the user says `/unsub <number>` or asks to unsubscribe from an issue:

```bash
python <skill-path>/scripts/gh_notifications.py unsub <number> --repo <owner/repo>
```

Unsubscribes from the thread and marks the notification as done. If `--repo` is omitted, `GITHUB_REPO` is used as the default.

### Mark notifications as done

To mark **all** notifications as done:

```bash
python <skill-path>/scripts/gh_notifications.py done
```

To mark a **specific** issue as done:

```bash
python <skill-path>/scripts/gh_notifications.py done <number> --repo <owner/repo>
```

## Dashboard template

The HTML dashboard is rendered from a Jinja2 template at `<skill-path>/scripts/templates/dashboard.html`. To customize the dashboard appearance, edit that template directly. The template receives:

- `repo_name` — the repository name string
- `now` — the current UTC datetime
- `cards` — a list of notification dicts, each with `title`, `reason`, `issue_number`, `issue_url`, `labels`, `comments`, etc.

Custom Jinja2 filters available in the template: `relative_time`, `summarize`, `label_text_color`.

## Scheduled use

This skill is well-suited for a daily morning routine. When running on a schedule:

1. Launch the dashboard.
2. Present the URL to the user.
3. Ask whether they want to take any actions before wrapping up.
