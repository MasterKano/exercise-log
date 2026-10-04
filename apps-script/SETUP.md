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

**Good to know**
- Anyone who has the URL can add rows to this sheet, so keep it private.
- If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → Version: New version** so the same URL keeps working.
- Offline? Records wait on the phone and are sent automatically when you're back online (and whenever you open the app).
- To check the script is live, open the URL in a browser: it should say "Exercise Log sync endpoint is running."
