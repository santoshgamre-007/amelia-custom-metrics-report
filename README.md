# SoundHound | Amelia Custom Metrics Report 

Pulls a domain's conversations from Amelia (or reads an export file), **reads every transcript**, maps everything to the customer's **custom-metrics dictionary**, and produces:

* a **dashboard** (one self-contained HTML file, shown in the app, printable to PDF),
* a **PowerPoint** built from the customer's own template deck (same look as the "Since Go Live" conversation-analysis deck, native charts and tables),
* a per-conversation **CSV** of the analysis (ids, outcome, handle time, signals — no names, phone numbers or caller words).

## Run it
```
npm install
node server.js          # then open http://127.0.0.1:8740
```
Copy `config.example.yaml` to `config.yaml` to save the connection (or set `AMELIA_URL`, `AMELIA_USER`, `AMELIA_PASSWORD`, `AMELIA_COOKIE`). Hands-free: `node cli.js --domain <code> --days 7` or `node cli.js --file export.csv`.
For an instance with a private certificate, start with `NODE_TLS_REJECT_UNAUTHORIZED=0` (only on a trusted network).

**Sign-in:** user name + password, or — for SSO instances — the `amelia_s` session cookie copied from the browser after signing in. **Export:** the app asks Amelia for a CSV export *with transcripts*, waits for it and downloads it. If the console refuses the download, the message says exactly what was tried; download the export in the console (Conversations → Export, with transcripts) and use **Use an exported file** instead.

## What the dashboard shows
* **Six tiles:** Conversations analysed · Contained by Amelia · Escalated to an agent · Abandoned or dropped · Caller says "resolved" · Answered the survey.
* **Four outcome tiles** (count and %): Total conversations · Contained · Abandoned · Escalated.
* **Average handle time** for Contained calls, Abandoned calls, Escalated and All calls.
* How calls end (outcome bar, calls over time, the abandoned calls broken down from their transcripts, what drove escalations) · the **six dictionary categories** (Call & Caller Context · Recognition & Knowledge · Interaction Quality · Outcome & Escalation · Survey & Feedback · Telephony & Messaging) · why calls were not contained · data readiness · definitions.

## The rules
* **Outcome** of every conversation, counted once: the recorded *Final Disposition* (Contained / Escalated / Abandoned). If it is not recorded, it is read from the platform flags (escalated, resolved) and the transcript.
* **Escalation by Design:** a call whose outcome is **Abandoned** but whose **transcript mentions an agent transfer** (Amelia or the agent saying "agent transfer", "transferring you", "connecting you with…", "live agent"…) becomes **Escalation by Design**. It is its own category and is **counted as contained**. A caller merely *saying* "agent transfer" does not count; escalated calls stay escalated.
* **Transcript → dictionary categories:** every dictionary metric takes its value from the recorded custom metric; where the flow did not record it, the value is worked out from the transcript (final disposition, escalation trigger, repeat and rephrase counts, whether the caller stated a request, resolution and recommendation answers, survey status). Each metric is labelled *Recorded*, *From transcript*, or *Recorded + transcript*. The transcript-derived outcome is also **checked against the recorded one** and any disagreement is reported.
* **Names the flows really write** (e.g. `ANI`, `DNIS`, `Text Delivery Status`) are matched to the dictionary names and shown as "written as …".
* **Contained** = Amelia gave steps or a link, the caller accepted it, and the call was not transferred.

## One folder per customer — `dictionaries/`
* `<domain code>.xlsx` — the customer's dictionary (category rows, then *Recommended Name · Technical Key · Data Type · Possible / Example Values · Description*). **Required.** `pennstatehealth.xlsx` is included.
* `<domain code>.taxonomy.json` — optional rules for reading transcripts: the calling reasons (keywords), KB article titles, the deck header, the time label. The Penn State file is included. Reasons are keyword rules, so treat the counts as a well-organised first pass and tune the rules against a larger export.
* `templates/report_template.pptx` — the PowerPoint template (the customer's own deck). The three static flow-screenshot slides are not used.

## Privacy
Transcripts are read in memory and reduced to signals; the caller's words, name, phone number and any location typed only once never appear in the dashboard, the deck or the CSV. Credentials stay in memory. Reports are the only thing written to disk (`reports/`). The server listens on 127.0.0.1 only.

## Tests
`npm test` — 72 checks on a synthetic dataset with known answers: the CSV, dictionary and transcript readers, every rule above, the ten tiles and the handle times, the PowerPoint (slides, numbers, charts and their "Edit Data" workbooks, package soundness), the Amelia connection against a pretend console that enforces the real console's header rules, the server, and the command line.

## Sharing this repository

- Keep it **private** (SoundHound organisation). It contains customer material: the Penn State Health metrics workbook and report template.
- `config.yaml` (passwords, session cookies), `reports/` (dashboards, decks and data from real conversations) and any exported `.csv` are in `.gitignore`. Never commit them.
- Each colleague: `git clone <repo>`, `npm install`, copy `config.example.yaml` to `config.yaml`, fill in their own Amelia address and sign-in, then `npm start` and open http://127.0.0.1:8740.

## Running it in GitHub Codespaces

1. On the repository page: **Code → Codespaces → Create codespace on main** (needs Write access to the repository).
2. Before the first start, add your own Amelia details as Codespaces secrets (GitHub → Settings → Codespaces → Secrets, give this repository access): `AMELIA_URL`, `AMELIA_USER`, `AMELIA_PASSWORD`. Or leave them out and type them into the app.
3. The app starts by itself and opens in the browser. Keep the forwarded port **Private** (never Public): it has no sign-in of its own.
4. Reports and transcripts are held in the codespace. When you finish, **delete the codespace** (github.com/codespaces) so the data goes with it.
