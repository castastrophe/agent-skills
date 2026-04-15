/**
 * @typedef {import("../scripts/github.js").Notifications} Notifications
 */

if (window) {
    /** @type {{ focusedRepositories: string[], focusedReasons: string[] }} */
    window.__states = { focusedRepositories: [], focusedReasons: [] };
    window.__repositories = [];
    window.__reasons = [];
}

/**
 * Update the dashboard count.
 */
function updateDashboardCount() {
  const count = document.getElementById("notification-count");
  const visibleCountEl = count.querySelector(".show-count");
  const descriptorEl = count.querySelector(".descriptor");
  const pluralEl = count.querySelector(".plural");
  const outOfEl = count.querySelector(".out-of");
  const subscribedCountEl = outOfEl.querySelector(".show-count");

  const subscribedOnly = [...document.querySelectorAll(".card:not([data-unsubscribed])")];
  const visibleOnly = subscribedOnly.filter(item => !item.hidden);

  if (window.__states.focusedRepositories.length > 0 || window.__states.focusedReasons.length > 0) {
    count.dataset.total = visibleOnly.length;
    if (visibleCountEl) visibleCountEl.textContent = visibleOnly.length;
    if (descriptorEl) descriptorEl.hidden = true;
    if (pluralEl) pluralEl.hidden = visibleOnly.length === 1;
    if (subscribedCountEl) subscribedCountEl.textContent = subscribedOnly.length;
    if (outOfEl) outOfEl.hidden = false;
  } else {
    count.dataset.total = subscribedOnly.length;
    if (visibleCountEl) visibleCountEl.textContent = subscribedOnly.length;
    if (descriptorEl) descriptorEl.hidden = false;
    if (pluralEl) pluralEl.hidden = subscribedOnly.length === 1;
    if (outOfEl) outOfEl.hidden = true;
  }
}

/**
 * Update the dashboard filters.
 */
function applyFilters() {
  const emptyState = document.getElementById("empty-state");
  const container = document.getElementById("cards");
  const cards = container.querySelectorAll(".card");

  window.__repositories = [...new Set([...cards].filter(card => !card.dataset.unsubscribed).map(card => card.dataset.repository))];
  window.__reasons = [...new Set([...cards].filter(card => !card.dataset.unsubscribed).map(card => card.dataset.reason))];

  const repoClearButton = document.querySelector("button[data-action='clear'][data-filter='repository']");
  const reasonClearButton = document.querySelector("button[data-action='clear'][data-filter='reason']");
  const availableFilters = document.getElementById("available-filters");

  const count = { cards: 0, repositories: 0, reasons: 0 };
  let refreshDashboard = false;

  const filterTriggers = document.querySelectorAll("button[data-action='filter']");
  filterTriggers.forEach(trigger => {
    const wasHidden = trigger.hidden;
    const type = trigger?.dataset?.filter;
    if (type === "repository") {
      const value = trigger?.dataset?.repository ?? trigger?.closest(".card")?.dataset?.repository;
      if (value && !window.__repositories.includes(value)) {
        trigger.hidden = true;
      } else if (value) {
        trigger.disabled = window.__states.focusedRepositories.length > 0 && window.__states.focusedRepositories.includes(value);
      }
    } else if (type === "reason") {
      const value = trigger?.dataset?.reason ?? trigger?.closest(".card")?.dataset?.reason;
      if (value && !window.__reasons.includes(value)) {
        trigger.hidden = true;
      } else if (value) {
        trigger.disabled = window.__states.focusedReasons.length > 0 && window.__states.focusedReasons.includes(value);
      }
    }
    if (wasHidden !== trigger.hidden) refreshDashboard = true;
  });

  [...cards].forEach(item => {
    // check if the item matches any of the focused repositories or reasons
    const repoOk = window.__states.focusedRepositories.length === 0 || window.__states.focusedRepositories.includes(item.dataset.repository);
    const reasonOk = window.__states.focusedReasons.length === 0 || window.__states.focusedReasons.includes(item.dataset.reason);
    const isUnsubscribed = item.dataset.unsubscribed;
    const wasHidden = item.hidden;
    // show the item if it matches any of the focused repositories or reasons
    item.hidden = isUnsubscribed || !(repoOk && reasonOk);
    if (!isUnsubscribed) count.cards++;
    if (wasHidden !== item.hidden) refreshDashboard = true;
  });

  if (availableFilters) {
    const filterBadges = availableFilters.querySelectorAll("button[data-action='filter']");
    filterBadges.forEach(badge => {
      const isHidden = badge.hidden;
      if (badge.dataset.filter === "repository") {
        if (!isHidden) count.repositories++;
      } else if (badge.dataset.filter === "reason") {
        if (!isHidden) count.reasons++;
      }
    });

    if (count.repositories <= 1 && count.reasons <= 1) availableFilters.hidden = true;
    else availableFilters.hidden = false;

    if (count.cards === 0) {
      emptyState.hidden = false;
      refreshDashboard = true;
    } else if (count.cards > 0) emptyState.hidden = true;
  }

  // update the filter status labels
  if (repoClearButton && window.__states.focusedRepositories.length > 0) {
    repoClearButton.hidden = false;
  } else if (repoClearButton) repoClearButton.hidden = true;

  // update the reason filter status labels
  if (reasonClearButton && window.__states.focusedReasons.length > 0) {
    reasonClearButton.hidden = false;
  } else if (reasonClearButton) reasonClearButton.hidden = true;

  if (refreshDashboard) {
    // dispatch an event to update the notification count
    document.body.dispatchEvent(new CustomEvent("update-dashboard"));
  }
}

/**
 * Unsubscribe from an issue.
 *
 * @param {HTMLButtonElement} btn - The button that was clicked.
 * @returns {void}
 */
async function unsubscribe(btn) {
  let failMessage = (message, ...args) => {
    console.warn(message, ...args);
  };
  let successMessage = (message, ...args) => {
    console.log(message, ...args);
  };

  const container = btn.closest(".card");
  if (!container?.dataset.threadId) {
    failMessage("No thread ID found", btn);
    return;
  }

  const status = btn.nextElementSibling;

  if (status) {
    /* clear the status while the request is in progress */
    status.textContent = "";
    status.classList.remove("success", "error");

    failMessage = (message, ...args) => {
      status.textContent = message;
      status.classList.add("error");
      console.warn(message, ...args);
    };

    successMessage = (message) => {
      status.textContent = message;
      status.classList.add("success");
    };
  }

  /* todo: should there be some kind of loading indicator? */
  // disable the button while the request is in progress
  btn.disabled = true;

  const response = await fetch("/api/unsub", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ thread_id: container?.dataset.threadId }),
  });

  const data = await response.json();
  if (!data.ok) {
    failMessage(`Failed to unsubscribe from thread ${container?.dataset.threadId}: ${data.error}`);
    return;
  }

  /* if there is a relevant status element, update it to indicate success */
  /** @todo: wouldn't the card be removed before the user could see the success message? **/
  successMessage(`Unsubscribed from thread ${container?.dataset.threadId}.`);

  /* hide the card */
  if (container) {
    container.dataset.unsubscribed = true;
    document.body.dispatchEvent(new CustomEvent("apply-filters"));
  }
}

/**
 * Initialize the dashboard.
 */
document.addEventListener("DOMContentLoaded", function () {
  document.body.addEventListener("update-dashboard", updateDashboardCount);
  document.body.addEventListener("apply-filters", applyFilters);

  [...document.querySelectorAll("button")].forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;

      const action = btn.dataset?.action;
      let shouldApply = false;
      if (action === "unsubscribe") {
        unsubscribe(btn);
      } else if (action === "filter") {
        const filter = btn.dataset?.filter;
        if (filter === "repository") {
          const repo = btn.dataset?.repository ?? btn.closest(".card")?.dataset?.repository;
          if (repo && !window.__states.focusedRepositories.includes(repo)) {
            window.__states.focusedRepositories.push(repo);
            shouldApply = true;
          } else if (repo && window.__states.focusedRepositories.includes(repo)) {
            // remove the repository from the focused repositories
            window.__states.focusedRepositories = window.__states.focusedRepositories.filter(r => r !== repo);
            shouldApply = true;
          }
        } else if (filter === "reason") {
          const reason = btn.dataset?.reason ?? btn.closest(".card")?.dataset?.reason;
          if (reason && !window.__states.focusedReasons.includes(reason)) {
            window.__states.focusedReasons.push(reason);
            shouldApply = true;
          } else if (reason && window.__states.focusedReasons.includes(reason)) {
            // remove the reason from the focused reasons
            window.__states.focusedReasons = window.__states.focusedReasons.filter(r => r !== reason);
            shouldApply = true;
          }
        } else {
          console.warn("Unknown filter:", filter, "for button:", btn);
        }
      } else if (action === "clear") {
        const filter = btn.dataset?.filter;
        if (filter === "repository") {
          window.__states.focusedRepositories = [];
        } else if (filter === "reason") {
          window.__states.focusedReasons = [];
        } else {
          console.warn("Unknown clear filter:", filter, "for button:", btn);
        }
        shouldApply = true;
      } else {
        console.warn("Unknown action:", action, "for button:", btn);
      }

      if (shouldApply) {
        document.body.dispatchEvent(new CustomEvent("apply-filters"));
      }
    });
  });
});
