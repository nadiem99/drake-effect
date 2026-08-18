# Dune: Part Three — IMAX 70mm ticket bot

Watches showtimes for **AMC Lincoln Square 13** on **Fandango** for
Dune: Part Three in IMAX 70mm and, when a drop appears, buys up to
**3 tickets** (never more) on the owner's Fandango account using their saved
payment method.

Built for a one-time, personal-use purchase authorized by the account owner.
It deliberately does **not** bypass bot detection: if the site shows a
human-verification page or waiting room, the bot screenshots it, marks itself
`blocked`, and stops.

## Behavior

- **Watcher** (`watch`): resolves the theatre's Fandango page (via search,
  since the URL slug is opaque), then polls its showtimes every ~30–40 s
  (jittered) across the configured date window, matching movie title +
  `70mm` format.
- **Seat policy**: maximize ticket count among decent seats — 3 together, else
  3 split, else 2, else 1. Decent = standard seat, not the front 3 rows.
  Front rows only if literally nothing else exists. Prefers the center block,
  ~60 % back. Evening showtimes ranked first; any showtime beats no ticket.
- **Safety rails**:
  - Hard cap: `tickets.max` (3) and an order-total cap `tickets.maxTotalUsd`.
  - `state/state.json` is a one-way purchase latch: an attempt marks
    `in_flight` before any click, and once the purchase button has ever been
    clicked, no retry can happen without a human resetting state.
  - `DRY_RUN=1` runs the whole flow but stops one click before purchase.
  - Screenshots + HTML dumps of every step land in `screenshots/`.

## Setup (before the drop)

Secrets live in `secrets/env` (git-ignored, chmod 600), loaded automatically:

```
TICKET_EMAIL=...
TICKET_PASSWORD=...
TICKET_CVV=...        # only if checkout re-asks for it
```

```bash
cd ticket-bot && npm install
node src/main.js login        # capture the Fandango session
node src/main.js scan         # verify scraping; fix VERIFY-marked selectors
DRY_RUN=1 node src/main.js buy "<any live showtime url>"   # full rehearsal
```

## The real run

```bash
node src/main.js watch
node src/main.js status       # inspect the purchase latch
```

## Environment notes

- Chromium: preinstalled at `/opt/pw-browsers/chromium`; `src/browser.js`
  pins it and passes `HTTPS_PROXY` explicitly (Chromium ignores the env var).
- The egress proxy re-terminates TLS: its CA must be in the NSS store —
  `certutil -A -d sql:$HOME/.pki/nssdb -n ccr-agent-proxy -t "C,," -i /root/.ccr/agent-proxy-ca.crt`
- The session's network policy must allow `fandango.com` and subdomains
  (plus its payment/CDN domains — in practice, allow-all is the safe choice)
  or every request dies at the proxy with a CONNECT 403.

## Known limits (by design)

- Selectors marked `VERIFY` in the source are best-effort until checked against
  the live site — the `scan` and `DRY_RUN` steps exist to shake these out.
- No CAPTCHA solving, no fingerprint spoofing, no parallel sessions. If the
  vendor blocks the flow, the run ends with evidence in `screenshots/`.
- Automated checkout likely violates the vendor's ToS; the account owner
  accepted that risk for this personal, 3-ticket purchase.
