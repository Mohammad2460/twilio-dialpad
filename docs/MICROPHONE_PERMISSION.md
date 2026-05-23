# Microphone permission

Chrome treats extension microphone access separately from page-level prompts. If the wizard's Step 4 fails to get audio:

1. Open `chrome://settings/content/microphone` in a new tab.
2. Under **Allowed to use your microphone**, click **Add** and paste your extension's URL:
   `chrome-extension://<your-extension-id>`
   You can find the ID at `chrome://extensions`.
3. Reload the extension (the reload icon on the extension card).
4. Re-run Step 4 of the wizard.

If you still see "Permission denied" inside the offscreen document, check that nothing else is holding the microphone (Zoom, Teams, OBS).
