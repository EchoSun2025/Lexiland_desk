(function bootstrapLexilandCapture() {
  const TOAST_ID = "lexiland-capture-toast";
  const TOAST_DURATION_MS = 1400;

  document.addEventListener("dblclick", () => {
    window.setTimeout(() => {
      void captureSelection();
    }, 0);
  });

  async function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const rawSelection = selection.toString();
    const cleanedSelection = sanitizeSelection(rawSelection);
    if (!isReasonableSelection(cleanedSelection)) {
      return;
    }

    const range = selection.getRangeAt(0);
    const anchorNode = range.startContainer;
    if (isEditableNode(anchorNode)) {
      return;
    }

    const textContainer = findClosestTextContainer(anchorNode);
    const containerText = extractReadableText(textContainer);
    if (!containerText) {
      return;
    }

    const sentenceContext = extractSentenceContext(containerText, cleanedSelection);
    if (!sentenceContext) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "capture-selection",
      payload: {
        word: cleanedSelection,
        sentenceContext,
        pageTitle: document.title || "",
        pageUrl: location.href,
      },
    });

    if (response?.message) {
      showToast(response.message, response.status);
    }
  }

  function sanitizeSelection(value) {
    return String(value || "")
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSelection(value) {
    return sanitizeSelection(value)
      .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
      .toLowerCase();
  }

  function isReasonableSelection(value) {
    if (!value || value.length > 80 || /\n/.test(value)) {
      return false;
    }

    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 5) {
      return false;
    }

    const normalized = normalizeSelection(value);
    if (!normalized || normalized.length < 2) {
      return false;
    }

    const letters = (value.match(/[A-Za-z]/g) || []).length;
    if (letters < 2 || letters / value.length < 0.5) {
      return false;
    }

    return tokens.every((token) => {
      const trimmed = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
      return /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(trimmed);
    });
  }

  function isEditableNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(
      element?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']"),
    );
  }

  function findClosestTextContainer(node) {
    const startElement = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const readableSelector = "p, li, blockquote, article, section, div, td, main, aside";

    let current = startElement;
    while (current && current !== document.body) {
      if (current.matches?.(readableSelector)) {
        const text = extractReadableText(current);
        if (text.length >= 20) {
          return current;
        }
      }
      current = current.parentElement;
    }

    return document.body;
  }

  function extractReadableText(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractSentenceContext(containerText, selectedText) {
    const normalizedSelection = normalizeSelection(selectedText);
    const sentences = splitSentences(containerText);

    const matchedSentence = sentences.find((sentence) =>
      normalizeForMatch(sentence).includes(normalizedSelection),
    );

    if (matchedSentence) {
      return trimContext(matchedSentence, normalizedSelection);
    }

    const fallbackSnippet = buildSnippet(containerText, normalizedSelection);
    return trimContext(fallbackSnippet, normalizedSelection);
  }

  function splitSentences(text) {
    const matches = text.match(/[^.!?]+(?:[.!?]+|$)/g);
    return (matches || [text]).map((entry) => entry.trim()).filter(Boolean);
  }

  function normalizeForMatch(value) {
    return String(value || "")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function buildSnippet(text, normalizedSelection) {
    const normalizedText = normalizeForMatch(text);
    const matchIndex = normalizedText.indexOf(normalizedSelection);
    if (matchIndex === -1) {
      return text.slice(0, 300).trim();
    }

    const start = Math.max(0, matchIndex - 90);
    const end = Math.min(text.length, matchIndex + normalizedSelection.length + 140);
    return text.slice(start, end).trim();
  }

  function trimContext(text, normalizedSelection) {
    const cleaned = sanitizeSelection(text);
    if (cleaned.length <= 300) {
      return cleaned;
    }

    const normalized = normalizeForMatch(cleaned);
    const matchIndex = normalized.indexOf(normalizedSelection);
    if (matchIndex === -1) {
      return cleaned.slice(0, 299).trimEnd() + "…";
    }

    const start = Math.max(0, matchIndex - 110);
    const end = Math.min(cleaned.length, matchIndex + normalizedSelection.length + 150);
    const snippet = cleaned.slice(start, end).trim();
    return snippet.length <= 300 ? snippet : snippet.slice(0, 299).trimEnd() + "…";
  }

  function showToast(message, status) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.style.position = "fixed";
      toast.style.top = "18px";
      toast.style.right = "18px";
      toast.style.zIndex = "2147483647";
      toast.style.padding = "10px 14px";
      toast.style.borderRadius = "999px";
      toast.style.fontFamily = "\"Segoe UI Variable\", Aptos, sans-serif";
      toast.style.fontSize = "13px";
      toast.style.fontWeight = "600";
      toast.style.boxShadow = "0 14px 30px rgba(0, 0, 0, 0.16)";
      toast.style.transition = "opacity 120ms ease, transform 120ms ease";
      document.documentElement.appendChild(toast);
    }

    const isSaved = status === "saved";
    toast.textContent = message;
    toast.style.background = isSaved ? "#1d6c57" : "#fff7e1";
    toast.style.color = isSaved ? "#ffffff" : "#544118";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";

    window.clearTimeout(showToast.hideTimer);
    showToast.hideTimer = window.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-6px)";
    }, TOAST_DURATION_MS);
  }
})();
