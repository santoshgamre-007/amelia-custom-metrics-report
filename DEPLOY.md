# Hosting the Custom Metrics Report as one link

People open the link, type an **access code**, then sign in to **Amelia with their own account**. Each person gets a private workspace (their own Amelia session, reports and transcripts), deleted after 45 idle minutes or when they click **Sign out and delete my data**. No password or call data is ever written to a repository or config file.

## Before you deploy (needs your approval)
- Real call transcripts will pass through, and be held in memory and temporary disk on, the host you choose. Get your manager's and the customer's / security team's OK for **that host and region**.
- Your Amelia instance must be reachable from the host (it may be restricted to a VPN or IP list).

## Settings (environment variables)
| Name | Required | Meaning |
|---|---|---|
| `HOSTED` | yes | `1` turns on hosted mode (the Dockerfile sets it) |
| `ACCESS_CODE` | yes | The code you give colleagues. Use 16+ random characters. The app will not start without it. |
| `ALLOWED_AMELIA_HOSTS` | yes | Amelia addresses people may connect to, comma separated, e.g. `amelia.example.com,*.corp.example.com`. Anything else is refused (this stops the tool being used to reach other systems). |
| `IDLE_MINUTES` | no | Delete a visitor's data after this many idle minutes (default 45) |
| `MAX_VISITORS` | no | Simultaneous workspaces (default 20) |
| `MAX_UPLOAD_MB` | no | Largest uploaded export (default 100) |

Always serve it over **https** (Render and Azure do this for you). Change the access code whenever someone leaves the team.

## Option 1 — Render (simplest, about 10 minutes)
1. Sign up at render.com and choose **New → Blueprint**. Connect your GitHub account and pick the `amelia-custom-metrics-report` repository (it reads `render.yaml`).
2. When it asks, enter `ACCESS_CODE` and `ALLOWED_AMELIA_HOSTS`.
3. Click **Apply**. After a few minutes Render shows your link, like `https://amelia-custom-metrics.onrender.com`.
4. Share the link and the access code (send the code separately, e.g. by phone or a chat message).

## Option 2 — Azure Container Apps (if your company standard is Azure)
1. `az login`, then from this folder: `az containerapp up --name amelia-custom-metrics --source . --ingress external --target-port 8740 --env-vars HOSTED=1 ALLOWED_AMELIA_HOSTS=<your Amelia host> ACCESS_CODE=secretref:access-code`
   (create the secret first: `az containerapp secret set …`, or set `ACCESS_CODE` in the portal under *Secrets*).
2. Keep **min replicas = 1** and **max replicas = 1**: visitors' workspaces live in the app's memory, so it must run as a single instance.
3. Share the app URL and the access code.

## Run it yourself to check
```
docker build -t amelia-metrics .
docker run -p 8740:8740 -e ACCESS_CODE=test-code-123456 -e ALLOWED_AMELIA_HOSTS=your-host.example.com amelia-metrics
```
Open http://localhost:8740 and enter the code.

## What it does and does not protect
- Protects: nothing opens without the code (10 wrong tries locks that address for 15 minutes); visitors cannot see each other's reports or transcripts; only allow-listed Amelia hosts are contacted; passwords are used only to sign in to Amelia, are kept in memory for that visit and never logged.
- Does not: replace your company's single sign-on. The access code is shared. If you need per-person accounts, put the app behind your identity provider (Azure Front Door or App Service Authentication).
- It runs as one instance. If it restarts, everyone signs in again and unsaved reports are gone.
