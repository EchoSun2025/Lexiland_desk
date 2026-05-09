# Lexiland Linux Usage

This Chrome extension is offline and cross-platform. For Linux, use the packaged extension directory or the zip built from it.

## Linux Load Steps

1. Copy `dist/lexiland-capture-extension-linux.zip` to the Linux machine.
2. Unzip it anywhere, for example:

```bash
unzip lexiland-capture-extension-linux.zip -d lexiland-capture-extension-linux
```

3. Open Chrome or Chromium.
4. Go to `chrome://extensions/`.
5. Turn on `Developer mode`.
6. Click `Load unpacked`.
7. Select the unzipped folder.

## Notes

- After reloading the extension, refresh the target webpage once before testing double-click capture.
- Content scripts do not run on `chrome://` pages, the Chrome Web Store, or other protected browser pages.
- All data stays in `chrome.storage.local`.
