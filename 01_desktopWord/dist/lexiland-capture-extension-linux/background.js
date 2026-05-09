const STORAGE_KEY = "lexilandCapturedWords";
const SOURCE = "chrome_double_click";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true,
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "capture-selection") {
    return false;
  }

  void handleCapture(message.payload, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("Capture failed", error);
      sendResponse({
        status: "error",
        message: "Save failed",
      });
    });

  return true;
});

async function handleCapture(payload, sender) {
  const item = buildCaptureItem(payload);
  if (!item) {
    return {
      status: "ignored",
      message: "Ignored",
    };
  }

  const stored = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  const captures = Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];

  if (captures.some((existing) => isDuplicate(existing, item))) {
    await openPanelForTab(sender.tab?.id);
    return {
      status: "duplicate",
      message: "Already saved",
    };
  }

  await chrome.storage.local.set({
    [STORAGE_KEY]: [item, ...captures],
  });

  await openPanelForTab(sender.tab?.id);

  return {
    status: "saved",
    message: "Saved",
    item,
  };
}

function buildCaptureItem(payload) {
  const word = normalizeWord(payload?.word);
  const sentenceContext = cleanText(payload?.sentenceContext, 300);
  const pageUrl = cleanText(payload?.pageUrl, 2048);

  if (!word || !sentenceContext || !pageUrl) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    word,
    sentenceContext,
    pageTitle: cleanText(payload?.pageTitle, 200) || "(untitled page)",
    pageUrl,
    source: SOURCE,
    createdAt: formatLocalIsoString(new Date()),
  };
}

function normalizeWord(value) {
  return String(value || "")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .toLowerCase();
}

function cleanText(value, maxLength) {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return cleaned.slice(0, maxLength - 1).trimEnd() + "…";
}

function isDuplicate(existing, incoming) {
  return (
    normalizeWord(existing?.word) === incoming.word &&
    normalizeForCompare(existing?.sentenceContext) === normalizeForCompare(incoming.sentenceContext) &&
    cleanText(existing?.pageUrl, 2048) === incoming.pageUrl
  );
}

function normalizeForCompare(value) {
  return cleanText(value, 500).toLowerCase();
}

function formatLocalIsoString(date) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offsetHours = padNumber(Math.floor(absMinutes / 60));
  const offsetRemainder = padNumber(absMinutes % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetRemainder}`;
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

async function openPanelForTab(tabId) {
  if (!tabId) {
    return;
  }

  try {
    await chrome.sidePanel.open({ tabId });
  } catch (error) {
    console.warn("Failed to open side panel", error);
  }
}
