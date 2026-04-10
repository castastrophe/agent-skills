#!/usr/bin/env python3
"""
Manage GitHub notifications: dashboard, mark-done, unsubscribe.

Usage:
    python gh_notifications.py fetch
    python gh_notifications.py done [<issue>] [--repo REPO]
    python gh_notifications.py unsub <issue> [--repo REPO]

Requires: GITHUB_TOKEN set in the environment or a .env file.
"""

from __future__ import annotations

import argparse
import http.server
import os
import socketserver
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from github import Auth, Github
from jinja2 import Environment, FileSystemLoader, select_autoescape

TEMPLATES_DIR = Path(__file__).parent / "templates"


def get_github_client() -> Github:
    """Create and return an authenticated GitHub client."""
    load_dotenv()
    token = os.getenv("GITHUB_TOKEN", "")
    return Github(auth=Auth.Token(token))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def summarize_comment(comment: str, max_len: int = 280) -> str:
    """Truncate a comment body to a readable summary."""
    if len(comment) > max_len:
        return comment[:max_len].split(" ", 1)[0] + "..."
    return comment


def relative_time(dt: datetime) -> str:
    """Convert a datetime to a human-friendly string."""
    try:
        return dt.strftime("%A, %B %d, %Y at %I:%M %p")
    except Exception as e:
        return str(e)


class _DashboardHandler(http.server.SimpleHTTPRequestHandler):
    """Serves a single HTML page for the notification dashboard."""

    def __init__(self, html_content: str, *args: Any, **kwargs: Any):
        self.html_content = html_content
        super().__init__(*args, **kwargs)

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.write(self.html_content.encode("utf-8"))


def start_http_server(html_content: str) -> None:
    """Start a local HTTP server on port 8000 and open the browser."""
    server_address = ("", 8000)
    httpd = socketserver.TCPServer(
        server_address,
        lambda *args: _DashboardHandler(html_content, *args),
    )
    threading.Thread(target=httpd.serve_forever).start()
    webbrowser.open("http://localhost:8000")


def label_text_color(hex_color: str) -> str:
    """Return #fff or #000 for readable text on the given background."""
    r = int(hex_color[:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return "#fff" if (r * 0.299 + g * 0.587 + b * 0.114) < 140 else "#000"


def _get_template_env() -> Environment:
    """Build a Jinja2 environment pointed at the templates directory."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(["html"]),
    )
    env.filters["relative_time"] = relative_time
    env.filters["summarize"] = summarize_comment
    env.filters["label_text_color"] = label_text_color
    return env


def build_html(notifications_data: list[Any], now: datetime, repo_name: str) -> str:
    """Shape notification objects into template-friendly dicts and render."""
    cards = []
    for n in notifications_data:
        reason = n.reason if n.reason else "subscribed"

        issue_number = ""
        issue_url = "#"
        if n.subject:
            issue_number = str(n.subject.number)
            issue_url = n.subject.html_url

        labels = []
        if n.subject and n.subject.labels:
            for label in n.subject.labels[:5]:
                labels.append({"name": label.name, "color": label.color})

        comments = []
        if n.subject and n.subject.comments:
            for c in n.subject.comments:
                comments.append(
                    {
                        "author": c.user.login if c.user else "unknown",
                        "when": relative_time(c.created_at if c.created_at else now),
                        "body": c.body if c.body else "",
                    }
                )

        cards.append(
            {
                "title": n.subject.title,
                "reason": reason,
                "reason_class": reason.lower().replace(" ", "-"),
                "updated": relative_time(n.updated_at if n.updated_at else now),
                "notif_id": str(n.id) if n.id else "",
                "issue_number": issue_number,
                "issue_url": issue_url,
                "labels": labels,
                "comments": comments,
            }
        )

    env = _get_template_env()
    template = env.get_template("dashboard.html")
    return template.render(repo_name=repo_name, now=now, cards=cards)


# ---------------------------------------------------------------------------
# Subcommand handlers
# ---------------------------------------------------------------------------


def cmd_fetch(args: argparse.Namespace) -> int:
    """Fetch all unread notifications and open the HTML dashboard."""
    now = datetime.now(timezone.utc)
    repo_name = os.getenv("GITHUB_REPO")
    if not repo_name:
        print("Error: GITHUB_REPO environment variable is required", file=sys.stderr)
        return 1

    g = get_github_client()
    notifications = g.get_user().get_notifications()  # type: ignore[union-attr]
    html_content = build_html(list(notifications), now, repo_name)
    if not html_content:
        print("Error: Failed to build HTML content", file=sys.stderr)
        return 1

    start_http_server(html_content)
    print("Server started at http://localhost:8000")
    return 0


def cmd_done(args: argparse.Namespace) -> int:
    """Mark one or all notifications as done."""
    g = get_github_client()
    user = g.get_user()

    if args.issue:
        if not args.issue.isdigit():
            print("Error: issue number must be a number", file=sys.stderr)
            return 1
        if not args.repo:
            print("Error: --repo is required when marking a specific issue done", file=sys.stderr)
            return 1
        print(f"Marking notification {args.issue} as done for {user.login}...")
        result = g.get_repo(args.repo).get_issue(int(args.issue)).mark_done()  # type: ignore[attr-defined]
        if result:
            print("Notification marked as done.")
            return 0
        print("Error: Failed to mark notification as done", file=sys.stderr)
        return 1

    print(f"Marking all notifications as done for {user.login}...")
    result = user.mark_notifications_done()  # type: ignore[union-attr]
    if result:
        print("All notifications marked as done.")
        return 0
    print("Error: Failed to mark all notifications as done", file=sys.stderr)
    return 1


def cmd_unsub(args: argparse.Namespace) -> int:
    """Unsubscribe from an issue thread and mark its notification done."""
    if not args.issue.isdigit():
        print("Error: issue number must be a number", file=sys.stderr)
        return 1
    if not args.repo:
        print("Error: --repo is required (or set GITHUB_REPO)", file=sys.stderr)
        return 1

    g = get_github_client()
    user = g.get_user()

    issue_number = int(args.issue)
    repo = args.repo

    print(f"Unsubscribing from {repo}#{issue_number}...")
    issue_obj = g.get_repo(repo).get_issue(issue_number)

    result = issue_obj.unsubscribe()  # type: ignore[attr-defined]
    if not result:
        print("Error: Failed to unsubscribe from issue thread", file=sys.stderr)
        return 1
    print("Unsubscribed from issue thread.")

    print(f"Marking notification {issue_number} as done for {user.login}...")
    result = issue_obj.mark_done()  # type: ignore[attr-defined]
    if not result:
        print("Error: Failed to mark notification as done", file=sys.stderr)
        return 1

    print(f"Unsubscribed from {repo}#{issue_number} and marked notification as done.")
    return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Manage GitHub notifications: dashboard, mark-done, unsubscribe.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("fetch", help="Open the notification dashboard in a browser")

    p_done = sub.add_parser("done", help="Mark notifications as done")
    p_done.add_argument("issue", nargs="?", default=None, help="Issue number (omit to mark all done)")
    p_done.add_argument("--repo", default=os.getenv("GITHUB_REPO"), help="Repository (owner/name)")

    p_unsub = sub.add_parser("unsub", help="Unsubscribe from an issue thread")
    p_unsub.add_argument("issue", help="Issue number")
    p_unsub.add_argument("--repo", default=os.getenv("GITHUB_REPO"), help="Repository (owner/name)")

    args = parser.parse_args()

    handlers = {
        "fetch": cmd_fetch,
        "done": cmd_done,
        "unsub": cmd_unsub,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
