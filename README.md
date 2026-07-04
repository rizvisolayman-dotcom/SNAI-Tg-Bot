# Smart-NFT Telegram Bot

Automated NFT buy cycles, check-ins, and account management for [smart-nft.com](https://smart-nft.com).

## Features

- **New Order** — 5-slot NFT buy cycle (7 min per slot) with auto retry
- **Auto Buy** — background poll completes cycles without manual input
- **Daily Check-in** — claim daily score rewards
- **Status** — balance, level, score, active/completed orders, slot status
- **History** — NFT orders, daily log, withdrawals, deposits
- **Dashboard** — live uptime & stats at `http://localhost:3000`

## Requirements

- Node.js 18+

## Setup

```bash
cd tg-bot
cp config.example.json config.json
```

Create a bot via [@BotFather](https://t.me/BotFather) and set the token:

```bash
export BOT_TOKEN=your_bot_token_here
node index.js
```

Or pass inline:

```bash
BOT_TOKEN=xxx node index.js
```

## Usage

| Command | Action |
|---------|--------|
| `/menu` or `/start` | Show menu |
| `/login <account> <password>` | Login |
| `🆕 New Order` | Start buy cycle |
| `📊 Status` | View account status |
| `📅 Daily` → `🎁 Claim Now` | Daily check-in |
| `📋 History` → submenu | View orders / logs |
| `🚪 Logout` | Logout |

## Dashboard

```
http://localhost:3000        → HTML dashboard
http://localhost:3000/api/status  → JSON endpoint
```

Port via `DASH_PORT` env var (default 3000).

## Project Structure

```
tg-bot/
├── index.js              Entry point, polling loop, routing
├── config.json           Bot token (gitignored)
├── config.example.json   Token template
├── data.json             User sessions (gitignored)
├── src/
│   ├── db.js             Flat JSON file storage
│   ├── api.js            HTTP client + auto re-login (2h expiry)
│   ├── telegram.js       Telegram sendMessage helper
│   ├── handlers.js       All button handlers, keyboard menus
│   ├── poll.js           Background 15s auto-buy poll
│   └── dashboard.js      HTTP status dashboard
└── .gitignore
```

## API

Base: `https://api.smart-nft.com/api/`
Auth: header `token: <jwt>`, form-urlencoded POST.

## Notes

- Buy cost ~7 TRX per slot regardless of NFT
- Token auto-refreshes on expiry (2h)
- No npm dependencies — Node.js built-in modules only
