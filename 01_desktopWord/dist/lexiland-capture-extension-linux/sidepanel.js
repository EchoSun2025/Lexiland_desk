const STORAGE_KEY = "lexilandCapturedWords";

const state = {
  captures: [],
  searchQuery: "",
  collapsedGroups: {
    Today: false,
    Yesterday: false,
    Earlier: false,
  },
  expandedItems: new Set(),
};

const captureCountEl = document.querySelector("#captureCount");
const resultsRootEl = document.querySelector("#resultsRoot");
const searchInputEl = document.querySelector("#searchInput");
const exportButtonEl = document.querySelector("#exportButton");

searchInputEl.addEventListener("input", (event) => {
  state.searchQuery = String(event.target.value || "").trim().toLowerCase();
  render();
});

exportButtonEl.addEventListener("click", () => {
  exportCaptures();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  state.captures = Array.isArray(changes[STORAGE_KEY].newValue) ? changes[STORAGE_KEY].newValue : [];
  pruneExpandedItems();
  render();
});

void loadCaptures();

async function loadCaptures() {
  const stored = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  state.captures = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
  render();
}

function render() {
  const visibleCaptures = getFilteredCaptures();
  const groupedCaptures = groupCaptures(visibleCaptures);

  captureCountEl.textContent = `captured ${state.captures.length} words`;

  if (visibleCaptures.length === 0) {
    resultsRootEl.innerHTML = `
      <section class="empty-state">
        ${
          state.searchQuery
            ? "No results match the current search."
            : "Double-click a word on any English webpage. Lexiland will save the word, sentence, page title, URL, and time here."
        }
      </section>
    `;
    bindPanelActions();
    return;
  }

  resultsRootEl.innerHTML = ["Today", "Yesterday", "Earlier"]
    .map((groupName) => renderGroup(groupName, groupedCaptures[groupName] || []))
    .join("");

  bindPanelActions();
}

function getFilteredCaptures() {
  const captures = [...state.captures].sort(compareCapturesDesc);
  if (!state.searchQuery) {
    return captures;
  }

  return captures.filter((item) => {
    const haystack = `${item.word} ${item.sentenceContext} ${item.pageTitle}`.toLowerCase();
    return haystack.includes(state.searchQuery);
  });
}

function compareCapturesDesc(left, right) {
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function groupCaptures(captures) {
  const groups = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };

  captures.forEach((item) => {
    groups[getRelativeDayGroup(item.createdAt)].push(item);
  });

  return groups;
}

function getRelativeDayGroup(createdAt) {
  const createdDate = new Date(createdAt);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfCreated = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
  const diffDays = Math.round((startOfToday - startOfCreated) / 86400000);

  if (diffDays <= 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  return "Earlier";
}

function renderGroup(groupName, items) {
  const isCollapsed = Boolean(state.collapsedGroups[groupName]);
  const groupItemsHtml = isCollapsed
    ? ""
    : items.length > 0
      ? items.map(renderCaptureItem).join("")
      : `<div class="empty-copy">No captured words in this group.</div>`;

  return `
    <section class="group" data-group="${groupName}">
      <button class="group-toggle" type="button" data-action="toggle-group" data-group="${groupName}">
        <span class="group-label">
          <h2 class="group-title">${groupName}</h2>
          <span class="group-count">${items.length}</span>
        </span>
        <span class="chevron">${isCollapsed ? ">" : "v"}</span>
      </button>
      ${isCollapsed ? "" : `<div class="group-items">${groupItemsHtml}</div>`}
    </section>
  `;
}

function renderCaptureItem(item) {
  const isExpanded = state.expandedItems.has(item.id);

  return `
    <article class="capture-item" data-item-id="${escapeHtml(item.id)}">
      <button class="item-toggle" type="button" data-action="toggle-item" data-item-id="${escapeHtml(item.id)}">
        <div class="item-topline">
          <h3 class="item-word">${escapeHtml(item.word)}</h3>
          <span class="item-meta">${escapeHtml(formatTime(item.createdAt))}</span>
        </div>
        <div class="item-page-title">${escapeHtml(item.pageTitle || "(untitled page)")}</div>
      </button>
      ${
        isExpanded
          ? `
            <div class="detail">
              <div class="detail-grid">
                <div class="detail-row">
                  <div class="detail-label">Added</div>
                  <div class="detail-value">${escapeHtml(formatFullDate(item.createdAt))}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Source</div>
                  <div class="detail-value">${escapeHtml(item.pageTitle || "(untitled page)")}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">Sentence</div>
                  <div class="detail-value">${escapeHtml(item.sentenceContext)}</div>
                </div>
                <div class="detail-row">
                  <div class="detail-label">URL</div>
                  <div class="detail-value">${escapeHtml(item.pageUrl)}</div>
                </div>
              </div>
              <div class="action-row">
                <button class="chip-button" type="button" data-action="open-page" data-item-id="${escapeHtml(item.id)}">Open page</button>
                <button class="icon-button danger" type="button" data-action="delete-item" data-item-id="${escapeHtml(item.id)}">Delete</button>
              </div>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function bindPanelActions() {
  document.querySelectorAll("[data-action='toggle-group']").forEach((button) => {
    button.addEventListener("click", () => {
      const groupName = button.dataset.group;
      state.collapsedGroups[groupName] = !state.collapsedGroups[groupName];
      render();
    });
  });

  document.querySelectorAll("[data-action='toggle-item']").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.itemId;
      if (!itemId) {
        return;
      }

      if (state.expandedItems.has(itemId)) {
        state.expandedItems.delete(itemId);
      } else {
        state.expandedItems.add(itemId);
      }
      render();
    });
  });

  document.querySelectorAll("[data-action='open-page']").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const item = findCapture(button.dataset.itemId);
      if (!item?.pageUrl) {
        return;
      }
      await chrome.tabs.create({ url: item.pageUrl });
    });
  });

  document.querySelectorAll("[data-action='delete-item']").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const itemId = button.dataset.itemId;
      if (!itemId) {
        return;
      }

      state.captures = state.captures.filter((item) => item.id !== itemId);
      state.expandedItems.delete(itemId);
      await chrome.storage.local.set({ [STORAGE_KEY]: state.captures });
      render();
    });
  });
}

function findCapture(itemId) {
  return state.captures.find((item) => item.id === itemId) || null;
}

function pruneExpandedItems() {
  const validIds = new Set(state.captures.map((item) => item.id));
  state.expandedItems.forEach((itemId) => {
    if (!validIds.has(itemId)) {
      state.expandedItems.delete(itemId);
    }
  });
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(createdAt) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

function formatFullDate(createdAt) {
  return new Intl.DateTimeFormat([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

function exportCaptures() {
  const payload = [...state.captures].sort(compareCapturesDesc);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lexiland-captured-words-${getLocalDateStamp(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function getLocalDateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
