# Google Sheets setup (free, no GCP project)

This uses a small script that lives inside your Google Sheet, deployed as a free
"Web App". The Next.js backend just sends it a POST request — no service account,
no JSON key file, no Google Cloud Console.

## 1. Create the Sheet

Create a new Google Sheet (any name, e.g. "Bikers Cafe — Garba Night"). You don't
need to create any tabs yourself — the script creates `Leads` and `Bookings`
automatically on first use.

## 2. Add the script

- In the Sheet, go to **Extensions → Apps Script**.
- Delete the placeholder code and paste in the contents of
  [`google-apps-script/Code.gs`](google-apps-script/Code.gs) from this project.
- Near the top, replace:
  ```js
  var SECRET = 'replace-with-a-long-random-string';
  ```
  with a long random string of your own (this is a shared password between your
  site and the script — anyone who knows it could write rows, so keep it private).
- Save the project (Ctrl+S / Cmd+S), name it something like "Bikers Cafe webhook".

## 3. Deploy it as a Web App

- Click **Deploy → New deployment**.
- Click the gear icon next to "Select type" → choose **Web app**.
- Settings:
  - **Execute as**: Me (your Google account)
  - **Who has access**: Anyone
- Click **Deploy**.
- The first time, Google will ask you to authorize the script — click through
  (it'll warn "Google hasn't verified this app" since it's your own script; click
  **Advanced → Go to (project name)** to proceed).
- Copy the **Web app URL** it gives you — it looks like:
  `https://script.google.com/macros/s/AKfycb.../exec`

## 4. Add it to your env file

In `.env.local`:

```
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfycb.../exec
SHEETS_WEBHOOK_SECRET=the-same-long-random-string-you-put-in-the-script
```

## 5. Test it

With the dev server running (`npm run dev`), fill out the booking form on the
site until it becomes valid — a row should appear in a new `Leads` tab within a
few seconds. Complete a test payment and a `Bookings` tab will appear with one
row per guest, and the matching `Leads` row's status will flip to `Paid`.

You can also sanity-check the deployment is reachable by opening the Web app URL
directly in a browser — it should return `{"ok":true,"message":"..."}`.

## Updating the script later

If you ever edit `Code.gs` in the Apps Script editor, you must create a **new
deployment version** (Deploy → Manage deployments → edit → New version) for the
changes to take effect on the existing URL — otherwise it keeps running the old
code.
