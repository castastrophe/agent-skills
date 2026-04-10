from datetime import datetime, timezone
from io import BytesIO
from unittest.mock import MagicMock, patch

from scripts.gh_notifications import (
    _DashboardHandler,
    build_html,
    cmd_done,
    cmd_fetch,
    cmd_unsub,
    get_github_client,
    label_text_color,
    main,
    relative_time,
    start_http_server,
    summarize_comment,
)


def test_summarize_comment():
    assert summarize_comment("Short comment") == "Short comment"

    long_comment = (
        "This is a very long comment that should be truncated because it exceeds the maximum length of two hundred and eighty characters. "
        * 5
    )
    summary = summarize_comment(long_comment, max_len=50)
    assert summary.endswith("...")
    assert len(summary) <= 53  # 50 + "..."


def test_relative_time():
    dt = datetime(2023, 10, 27, 10, 30, 0)
    expected = "Friday, October 27, 2023 at 10:30 AM"
    assert relative_time(dt) == expected


def test_relative_time_error():
    """Covers the exception branch when strftime fails."""
    bad_dt = MagicMock()
    bad_dt.strftime.side_effect = ValueError("bad format")
    result = relative_time(bad_dt)
    assert "bad format" in result


@patch("scripts.gh_notifications.load_dotenv")
@patch("scripts.gh_notifications.os.getenv", return_value="test-token")
def test_get_github_client(mock_getenv, mock_dotenv):
    client = get_github_client()
    mock_dotenv.assert_called_once()
    assert client is not None


def test_label_text_color_dark_background():
    assert label_text_color("000000") == "#fff"


def test_label_text_color_light_background():
    assert label_text_color("ffffff") == "#000"


# ---------------------------------------------------------------------------
# _DashboardHandler and start_http_server
# ---------------------------------------------------------------------------


def test_dashboard_handler_do_GET():
    html_content = "<html><body>test</body></html>"
    wfile = BytesIO()

    handler = MagicMock(spec=_DashboardHandler)
    handler.html_content = html_content
    handler.wfile = wfile

    _DashboardHandler.do_GET(handler)

    handler.send_response.assert_called_once_with(200)
    handler.send_header.assert_called_once_with("Content-type", "text/html")
    handler.end_headers.assert_called_once()
    assert wfile.getvalue() == html_content.encode("utf-8")


@patch("scripts.gh_notifications.webbrowser.open")
@patch("scripts.gh_notifications.threading.Thread")
@patch("scripts.gh_notifications.socketserver.TCPServer")
def test_start_http_server(mock_tcp, mock_thread, mock_browser):
    start_http_server("<html></html>")
    mock_tcp.assert_called_once()
    mock_thread.assert_called_once()
    mock_thread.return_value.start.assert_called_once()
    mock_browser.assert_called_once_with("http://localhost:8000")


def test_build_html_empty():
    now = datetime.now(timezone.utc)
    repo_name = "test/repo"
    result = build_html([], now, repo_name)
    assert "No unread notifications for test/repo" in result
    assert "0 unread notifications" in result


def test_build_html_with_notifications():
    now = datetime.now(timezone.utc)
    repo_name = "test/repo"

    mock_notif = MagicMock()
    mock_notif.id = "123"
    mock_notif.reason = "mention"
    mock_notif.updated_at = now
    mock_notif.subject.title = "Test Issue"
    mock_notif.subject.number = 42
    mock_notif.subject.html_url = "https://github.com/test/repo/issues/42"
    mock_notif.subject.labels = [MagicMock(name="bug", color="ff0000")]
    mock_notif.subject.labels[0].name = "bug"
    mock_notif.subject.labels[0].color = "ff0000"

    mock_comment = MagicMock()
    mock_comment.user.login = "testuser"
    mock_comment.created_at = now
    mock_comment.body = "This is a comment"
    mock_notif.subject.comments = [mock_comment]

    result = build_html([mock_notif], now, repo_name)

    assert "Test Issue" in result
    assert "#42" in result
    assert "mention" in result
    assert "@testuser" in result
    assert "This is a comment" in result
    assert "bug" in result


# ---------------------------------------------------------------------------
# cmd_done
# ---------------------------------------------------------------------------


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_done_all(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_g.get_user().mark_notifications_done.return_value = True
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = None
    args.repo = None

    assert cmd_done(args) == 0
    mock_g.get_user().mark_notifications_done.assert_called_once()


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_done_single_issue(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_g.get_repo("owner/repo").get_issue(42).mark_done.return_value = True
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = "42"
    args.repo = "owner/repo"

    assert cmd_done(args) == 0
    mock_g.get_repo("owner/repo").get_issue(42).mark_done.assert_called_once()


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_done_single_requires_repo(mock_client):
    args = MagicMock()
    args.issue = "42"
    args.repo = None

    assert cmd_done(args) == 1


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_done_rejects_non_numeric_issue(mock_client):
    args = MagicMock()
    args.issue = "abc"
    args.repo = "owner/repo"

    assert cmd_done(args) == 1


# ---------------------------------------------------------------------------
# cmd_unsub
# ---------------------------------------------------------------------------


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_unsub_success(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_issue = MagicMock()
    mock_issue.unsubscribe.return_value = True
    mock_issue.mark_done.return_value = True
    mock_g.get_repo("owner/repo").get_issue.return_value = mock_issue
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = "42"
    args.repo = "owner/repo"

    assert cmd_unsub(args) == 0
    mock_issue.unsubscribe.assert_called_once()
    mock_issue.mark_done.assert_called_once()


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_unsub_requires_repo(mock_client):
    args = MagicMock()
    args.issue = "42"
    args.repo = None

    assert cmd_unsub(args) == 1


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_unsub_rejects_non_numeric_issue(mock_client):
    args = MagicMock()
    args.issue = "abc"
    args.repo = "owner/repo"

    assert cmd_unsub(args) == 1


# ---------------------------------------------------------------------------
# cmd_fetch
# ---------------------------------------------------------------------------


@patch.dict("os.environ", {}, clear=True)
def test_cmd_fetch_missing_repo():
    args = MagicMock()
    assert cmd_fetch(args) == 1


@patch("scripts.gh_notifications.start_http_server")
@patch("scripts.gh_notifications.get_github_client")
@patch.dict("os.environ", {"GITHUB_REPO": "owner/repo"})
def test_cmd_fetch_success(mock_client, mock_server):
    mock_g = MagicMock()
    mock_g.get_user().get_notifications.return_value = []
    mock_client.return_value = mock_g

    args = MagicMock()
    assert cmd_fetch(args) == 0
    mock_server.assert_called_once()


# ---------------------------------------------------------------------------
# cmd_done failure paths
# ---------------------------------------------------------------------------


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_done_single_issue_mark_fails(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_g.get_repo("owner/repo").get_issue(42).mark_done.return_value = False
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = "42"
    args.repo = "owner/repo"

    assert cmd_done(args) == 1


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_done_all_mark_fails(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_g.get_user().mark_notifications_done.return_value = False
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = None
    args.repo = None

    assert cmd_done(args) == 1


# ---------------------------------------------------------------------------
# cmd_unsub failure paths
# ---------------------------------------------------------------------------


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_unsub_unsubscribe_fails(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_issue = MagicMock()
    mock_issue.unsubscribe.return_value = False
    mock_g.get_repo("owner/repo").get_issue.return_value = mock_issue
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = "42"
    args.repo = "owner/repo"

    assert cmd_unsub(args) == 1


@patch("scripts.gh_notifications.get_github_client")
def test_cmd_unsub_mark_done_fails(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_issue = MagicMock()
    mock_issue.unsubscribe.return_value = True
    mock_issue.mark_done.return_value = False
    mock_g.get_repo("owner/repo").get_issue.return_value = mock_issue
    mock_client.return_value = mock_g

    args = MagicMock()
    args.issue = "42"
    args.repo = "owner/repo"

    assert cmd_unsub(args) == 1


# ---------------------------------------------------------------------------
# main() CLI entry point
# ---------------------------------------------------------------------------


@patch("scripts.gh_notifications.start_http_server")
@patch("scripts.gh_notifications.get_github_client")
@patch.dict("os.environ", {"GITHUB_REPO": "owner/repo"})
def test_main_fetch(mock_client, mock_server):
    mock_g = MagicMock()
    mock_g.get_user().get_notifications.return_value = []
    mock_client.return_value = mock_g

    with patch("sys.argv", ["gh_notifications.py", "fetch"]):
        assert main() == 0


@patch("scripts.gh_notifications.get_github_client")
def test_main_done(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_g.get_user().mark_notifications_done.return_value = True
    mock_client.return_value = mock_g

    with patch("sys.argv", ["gh_notifications.py", "done"]):
        assert main() == 0


@patch("scripts.gh_notifications.get_github_client")
@patch.dict("os.environ", {"GITHUB_REPO": "owner/repo"})
def test_main_unsub(mock_client):
    mock_g = MagicMock()
    mock_g.get_user().login = "testuser"
    mock_issue = MagicMock()
    mock_issue.unsubscribe.return_value = True
    mock_issue.mark_done.return_value = True
    mock_g.get_repo("owner/repo").get_issue.return_value = mock_issue
    mock_client.return_value = mock_g

    with patch("sys.argv", ["gh_notifications.py", "unsub", "42"]):
        assert main() == 0
