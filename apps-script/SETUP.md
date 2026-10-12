# Google Sheet sync: setup (about 5 minutes)

Sync is optional. The app saves everything on your phone first and works fully without it.

1. **Make the sheet.** In Google Drive, create a new Google Sheet (for example "Exercise Log").
2. **Open Apps Script.** In the sheet, choose **Extensions → Apps Script**.
3. **Paste the code.** Delete what's in `Code.gs` and paste in everything from `Code.gs` in this folder. Click **Save**.
4. **Deploy it.** Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**. Set:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy**. Google asks you to authorise the script the first time: choose your account, then **Advanced → Go to (project name)** → **Allow**.
5. **Copy the URL.** Copy the **Web app URL** (it ends in `/exec`).
6. **Paste it into the app.** In the app, open **Settings → Google Sheet sync**, paste the URL, tap **Save**, then **Sync now**.

The script creates two tabs, **Sessions** and **Sets**, with headers, one row per session and one row per set. If a record is sent again (after you fix a typo, or after a retry), its row is updated instead of duplicated. Deleted sets stay as rows with `deleted` = TRUE.

## Load your full programmes file from Google Drive

The same web app can hand your programmes file to the app, so a new phone gets everything with one tap.

1. **Put the file in Drive.** Upload `exercise-programmes-import.json` anywhere in your Google Drive (keep that exact name, or pin a file with `FILE_ID`, see below).
2. **Update the script.** Open the Apps Script project, replace all of `Code.gs` with the new `Code.gs` from this folder, click **Save**.
3. **Authorise Drive access.** In the toolbar, pick **authorizeDrive** in the function list and click **Run**. Google asks for permission: choose your account → **Advanced → Go to (project name)** → **Allow**. The log should say `Found exercise-programmes-import.json`.
4. **Redeploy as a new version.** **Deploy → Manage deployments**, select the web app, click the pencil (**Edit**), set **Version: New version**, click **Deploy**. The URL stays the same, so nothing changes in the app.
5. **Load it.** In the app: **Settings → Google Sheet sync → Load my full file from Drive**. It is merged like a normal import: nothing is duplicated and your own logs stay.

Check: opening `<your web app URL>?action=import` in a browser should show the file's JSON (with `"ok":true`).

To use a specific file instead of searching by name, paste its ID into `var FILE_ID = '';` at the top of `Code.gs` (the ID is the long part of the file link `…/file/d/<FILE_ID>/view`), then redeploy a new version (step 4).

**Good to know**
- Anyone who has the URL can add rows to this sheet, and (with the Drive step) download your programmes file, so keep it private.
- If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → Version: New version** so the same URL keeps working.
- Offline? Records wait on the phone and are sent automatically when you're back online (and whenever you open the app).
- To check the script is live, open the URL in a browser: it should say "Exercise Log sync endpoint is running."
