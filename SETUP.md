# Bill's Living Junk Drawer — repaired package

This package contains the two pieces that actually belong together:

- `Code.gs`: the Google Apps Script backend that stores the shared drawer in Google Drive.
- `index.html`: the Junk Drawer interface for GitHub Pages or another static host.
- `rolltop-desk-skin.png`: the photographic roll-top desk skin used by `index.html`. Keep this image in the same published folder as `index.html`.

The roll-top version changes only the presentation layer. Note, Link, File, connection, expiration, pinning, deletion, and cleanup still use the same repaired backend contract.

The older `app-maker-bridge.html`, `index(4).html`, and original `Code.gs` are a separate Image Lab → App Maker prototype. They use a different API and cannot operate the Living Junk Drawer backend.

## One-time Google setup

1. In Google Drive, open the folder you want to use for the drawer.
2. Copy the folder ID from its address. It is the text after `/folders/`.
3. Open [Google Apps Script](https://script.google.com/) and create a new project.
4. Delete the default code and paste in the complete contents of `Code.gs`.
5. At the top of `Code.gs`, set `JUNK_FOLDER_ID` to your folder ID.
6. Change `SECRET_TOKEN` to a private passcode. Use letters, numbers, and dashes; do not use a password you use elsewhere.
7. Save the project.
8. In the function selector, choose `testBackendSetup`, then press **Run**.
9. Approve the requested Google Drive and Sheets permissions. The result should say `Setup looks good.` This also creates the index spreadsheet inside your folder.
10. Choose **Deploy → New deployment → Web app**.
11. Set **Execute as** to **Me** and **Who has access** to **Anyone**. If Google only shows **Anyone with Google account**, this can still work for your signed-in devices, but a public GitHub Pages app may encounter a sign-in redirect.
12. Deploy and copy the URL ending in `/exec`. Do not use the `/dev` test URL for the finished app.

## Put the interface online

1. Upload `index.html` to the GitHub Pages repository/folder for Bill's Junk Drawer.
2. Open the published page.
3. Open **Connection settings**.
4. Paste the Apps Script `/exec` URL and the exact `SECRET_TOKEN` from `Code.gs`.
5. Press **Save & test**.
6. Repeat steps 2–5 on each phone or computer. The settings are stored separately in each browser.

## Testing checklist

1. Add a short note. Refresh on the other device; the note should appear.
2. Add a link beginning with `https://`; open it on the other device.
3. Upload a small image or PDF; open it from the other device.
4. Pin the item and verify it stays pinned after refresh.
5. Delete the test item and verify it disappears.

## When you change `Code.gs` later

Saving the script does **not** update an existing production deployment automatically. Use **Deploy → Manage deployments → Edit**, select **New version**, and deploy. Keep the same `/exec` URL so the HTML settings do not need to change.

## What was broken

1. The Junk Drawer backend began with `* Bill's...` instead of `/**`. That is a fatal JavaScript syntax error.
2. No Junk Drawer frontend was included. The supplied HTML files send Image Lab asset actions such as `uploadAsset`, while the Junk Drawer backend only accepts `createText`, `createFile`, `list`, `pin`, `delete`, and `cleanup`.
3. The separate Asset Bridge `Code.gs` still contains placeholder Sheet and Drive IDs; it is not configured and is not the Junk Drawer backend.
4. The old index-spreadsheet move used legacy folder-parent calls. This repaired backend uses `File.moveTo(folder)` and remembers the index spreadsheet ID to avoid duplicate indexes.

## Privacy note

The passcode is lightweight protection for a personal utility, not account-grade authentication. Uploaded files are set to “anyone with the link” when Google permits it, so they can open across devices. Do not use this drawer for passwords, medical records, financial documents, or other sensitive material.
