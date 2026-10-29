# SoundHound | Amelia Custom Metrics Report — quick start

No GitHub account needed. The app runs on **your own computer**; call data never leaves it.

## One-time
1. Install **Node.js (LTS)** from https://nodejs.org (accept the defaults).
2. Download this app: on the repository page click **Code → Download ZIP**, then unzip it anywhere.

## Every time
- **Windows:** double-click **Start Custom Metrics Report.bat**. The first start installs the app (about a minute, needs internet).
- **Mac / Linux:** open a terminal in the folder and run `sh start.sh`.

Your browser opens at http://127.0.0.1:8740. Close the black window (or press Ctrl+C) to stop the app.

## Make a report
1. Type your **Amelia address** and your own **Amelia user name and password** (or the browser session cookie for SSO).
2. Click **Connect**, choose the **domain** and the **dates**, and click **Generate the report**.
3. Open the dashboard, download the PowerPoint, or use **Check a transcript** to read any call.

The password is typed into the page each time and is never saved to a file. The address and user name are remembered in your browser for next time. Reports are saved in the `reports` folder next to the app, so delete them when you no longer need them (they contain call data).

## If something does not work
- *"Node.js is not installed"*: do step 1, then start again.
- *Amelia does not connect*: check the address (the part before /admin), your user name and password, and that you are on the network or VPN your Amelia instance requires.
- *Domain has no workbook*: the app uses the default workbook in the `dictionaries` folder and says so in the report.
