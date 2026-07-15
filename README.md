# xme-mail

Self-hosted **email control panel** for custom domains — **without port 25**.

Send mail with [Resend](https://resend.com). Receive mail with **Cloudflare Email Routing → Worker → webhook**. Manage aliases, inbox, API keys, and optional **auto-sync** of routing rules to Cloudflare.

> Not a full mail server (no IMAP/SMTP stack). Think “email ops panel + API”, not Gmail clone.

---

## Features

- Admin panel (dark UI): dashboard, inbox, send, aliases, domains, API keys
- **Send** via Resend (`from` must be an active alias)
- **Receive** via Cloudflare Email Worker webhook
- Inbox: unread badges, mark read/unread, search, reply
- Public API: `POST /api/v1/send` with `xme_…` API keys (hashed at rest)
- Optional **Cloudflare Email Routing auto-sync**
  - create alias in panel → CF routing rule to Worker
  - delete alias → CF rule removed
  - disable catch-all so random addresses don’t land in inbox
- SQLite + Prisma (simple single-node deploy)
- systemd unit + Docker Compose examples
- Security basics: session cookies, rate limits, security headers, bcrypt passwords

---

## Architecture

```text
Internet mail
    │
    ▼
Cloudflare Email Routing  (MX)
    │
    ▼
Cloudflare Email Worker   (mail)
    │  POST + X-Webhook-Secret
    ▼
xme-mail  ─────────────────────►  Resend API  ──► recipients
  Next.js panel + API
  SQLite
```

No inbound/outbound port **25** on your VPS.

---

## Requirements

- Node.js 20+ (22/24 OK)
- A domain on **Cloudflare**
- [Resend](https://resend.com) account (free tier works for low volume)
- Public HTTPS URL for the panel (Cloudflare Tunnel, reverse proxy, etc.)

---

## Quick start

```bash
git clone git@github.com:masjeho2/xme-mail.git
cd xme-mail
cp .env.example .env
# edit .env — at least AUTH_SECRET, ADMIN_PASSWORD, WEBHOOK_SECRET

npm install
npx prisma migrate dev
npx tsx prisma/seed.ts
npm run dev
```

Open: http://localhost:3110

### Default seed (change these)

| Key | Default example |
|---|---|
| Admin email | `admin@your-domain.com` (`ADMIN_EMAIL`) |
| Admin password | from `ADMIN_PASSWORD` in `.env` |
| Domain | `DEFAULT_DOMAIN` |
| Aliases | `admin@`, `noreply@` |

---

## Environment variables

Copy `.env.example` → `.env`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | SQLite path, e.g. `file:./dev.db` |
| `ADMIN_EMAIL` | seed | Bootstrap admin email |
| `ADMIN_PASSWORD` | seed | Bootstrap admin password |
| `DEFAULT_DOMAIN` | seed | First domain (e.g. `example.com`) |
| `AUTH_SECRET` | yes | Session secret, **≥ 32 chars** |
| `WEBHOOK_SECRET` | yes | Shared secret for CF Worker → app |
| `RESEND_API_KEY` | for real send | Resend API key |
| `APP_URL` | recommended | Public URL, e.g. `https://mail.example.com` |
| `PORT` | no | Default `3110` |
| `COOKIE_SECURE` | prod HTTPS | `true` behind HTTPS |
| `CLOUDFLARE_API_TOKEN` | auto-sync | Token with Email Routing Rules Edit + Zone Read |
| `CLOUDFLARE_ZONE_ID` | auto-sync | Zone ID of your domain |
| `CLOUDFLARE_EMAIL_WORKER` | auto-sync | Worker name, default `mail` |
| `CLOUDFLARE_DISABLE_CATCHALL` | auto-sync | `true` to disable catch-all on sync |
| `STRICT_ALIAS_INBOUND` | no | `true` = ignore inbound for unknown aliases |

**Never commit `.env`.**

---

## Production (systemd)

```bash
npm install
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run build

# install unit (edit paths if needed)
sudo cp deploy/xme-mail.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xme-mail
sudo systemctl status xme-mail
```

Service defaults to port **3110** and restarts on failure.

Logs:

```bash
journalctl -u xme-mail -f
```

---

## Docker

```bash
cp .env.example .env   # fill secrets
docker compose up -d --build
```

Panel: http://localhost:3110

---

## Setup: receive mail (Cloudflare)

1. Cloudflare dashboard → your domain → **Email** → **Email Routing** → enable  
2. Let Cloudflare create MX records  
3. Create an **Email Worker** (script in `cloudflare/email-worker.ts` or `src/worker/email-worker.ts`)  
4. Worker secrets/vars:
   - `WEBHOOK_URL` = `https://mail.example.com/api/inbound/cloudflare`
   - `WEBHOOK_SECRET` = same as app `.env`
5. Routing rules → **Send to a Worker** (per-address and/or catch-all)

### Test webhook without Worker

```bash
curl -X POST http://localhost:3110/api/inbound/cloudflare \
  -H "X-Webhook-Secret: YOUR_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "someone@gmail.com",
    "to": "admin@example.com",
    "subject": "Hello",
    "text": "Inbound test"
  }'
```

Check **Inbox** in the panel.

---

## Setup: send mail (Resend)

1. [Resend](https://resend.com) → add your domain  
2. Add SPF/DKIM (and optional DMARC) DNS records in Cloudflare  
3. Put `RESEND_API_KEY` in `.env` and restart  
4. Send from panel **Send** page using an alias that has **can send**

Without `RESEND_API_KEY`, outbound messages are stored as `queued` (local simulation only).

---

## Cloudflare alias auto-sync (optional)

When `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` are set:

| Panel action | Cloudflare |
|---|---|
| Add alias `info@domain` | Create routing rule → Worker |
| Delete alias | Delete that rule |
| **Sync all to Cloudflare** | Upsert all active aliases + disable catch-all |

### Create API token

Cloudflare → **My Profile** → **API Tokens** → **Create Custom Token**:

| Permission | Access |
|---|---|
| Zone → Email Routing Rules | Edit |
| Zone → Zone | Read |

Zone Resources: include only your zone.

Then in `.env`:

```env
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=...          # domain Overview → Zone ID
CLOUDFLARE_EMAIL_WORKER=mail
CLOUDFLARE_DISABLE_CATCHALL=true
```

Restart app, open **Aliases** → should show **Cloudflare auto-sync ON**.

---

## Public send API

Create a key under **API Keys**, then:

```bash
curl -X POST https://mail.example.com/api/v1/send \
  -H "Authorization: Bearer xme_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "noreply@example.com",
    "to": "user@gmail.com",
    "subject": "OTP",
    "text": "Code: 123456"
  }'
```

- `from` must be an **active** alias with `canSend=true`
- Raw keys are shown **once**; only SHA-256 hashes are stored

---

## Project layout

```text
src/app/                 # Next.js App Router (UI + API routes)
src/components/          # Sidebar, shell
src/lib/                 # auth, db, resend, cloudflare-email, security
src/worker/              # CF Email Worker source (reference)
cloudflare/              # Worker copy for deploy
prisma/                  # schema + migrations + seed
deploy/xme-mail.service  # systemd unit
docker-compose.yml
.env.example
```

---

## Security notes

- Change all defaults (`ADMIN_PASSWORD`, `AUTH_SECRET`, `WEBHOOK_SECRET`)
- Use `COOKIE_SECURE=true` on HTTPS
- Keep `.env` mode `600`
- Rotate tokens if they ever appear in chat/logs
- This is a single-admin panel; not multi-tenant SaaS RBAC yet

---

## Limitations (v1)

- Not full IMAP/webmail (Roundcube-style)
- Worker body parsing is best-effort (MIME can be messy)
- Attachments / antivirus not handled
- Rate limits are in-memory (per process)

---

## Scripts

```bash
npm run dev          # dev server :3110
npm run build        # production build
npm run start        # production server :3110
npm run db:migrate   # prisma migrate dev
npm run db:seed      # seed admin + default domain
```

---

## License

Private / your choice — add a `LICENSE` if you open-source it formally.

---

## Credits

Built for practical custom-domain email without running Postfix on port 25.  
Stack: Next.js, Prisma, SQLite, Resend, Cloudflare Email Routing.
