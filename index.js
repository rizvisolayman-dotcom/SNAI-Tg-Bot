const https = require("https");
const TOKEN = process.env.BOT_TOKEN || (() => { try { return require("./config.json").BOT_TOKEN; } catch { return null; } })();
const db = require("./src/db");
const api = require("./src/api");
const tg = require("./src/telegram");
const handlers = require("./src/handlers");
const poll = require("./src/poll");

const API = `https://api.telegram.org/bot${TOKEN}`;
const OFFSET_FILE = "./offset.txt";

process.on("uncaughtException", (e) => console.error("UNCAUGHT:", e));
process.on("unhandledRejection", (e) => console.error("UNHANDLED:", e));

function getOffset() {
  try { return parseInt(require("fs").readFileSync(OFFSET_FILE, "utf8")) || 0; }
  catch { return 0; }
}
function saveOffset(n) {
  require("fs").writeFileSync(OFFSET_FILE, String(n));
}

const awaitingLevelConfirm = {};
const awaitingLogout = {};

function fetchUpdates(offset, cb) {
  const u = new URL(`${API}/getUpdates`);
  u.searchParams.set("offset", offset);
  u.searchParams.set("timeout", 30);
  u.searchParams.set("allowed_updates", JSON.stringify(["message"]));

  https.get(u.toString(), (res) => {
    let d = "";
    res.on("data", c => d += c);
    res.on("end", () => {
      try {
        const body = JSON.parse(d);
        if (!body.ok || !body.result || !body.result.length) { cb && cb(); return; }
        const last = body.result[body.result.length - 1];
        saveOffset(last.update_id + 1);
        body.result.forEach(handleUpdate);
      } catch {}
      cb && cb();
    });
  }).on("error", () => { cb && cb(); });
}

function handleUpdate(upd) {
  if (!upd.message || !upd.message.text) return;
  const chatId = String(upd.message.chat.id);
  const text = upd.message.text.trim();
  const s = db.get(chatId);

  console.log(`[${chatId}] ${text}`);

  if (text.startsWith("/menu") || text.startsWith("/start")) {
    handlers.showMenu(chatId);
    return;
  }

  if (text.startsWith("/login")) {
    const rest = text.slice(7).trim();
    const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      const account = parts[0];
      const password = parts.slice(1).join(" ");
      tg.send(chatId, "🔄 Logging in...");
      api.login(chatId, account, password).then(resp => {
        if (resp.code === 1) {
          tg.send(chatId, `✅ *Logged in as ${resp.data.userinfo.username || account}!*`, { reply_markup: handlers.mainKb() });
        } else {
          tg.send(chatId, `❌ Login failed: ${resp.msg || "error"}`);
        }
      });
    } else {
      tg.send(chatId, "Format: `/login account password`");
    }
    return;
  }

  if (!s) {
    const parts = text.split(/\s+/);
    if (parts.length >= 2) {
      tg.send(chatId, "🔄 Logging in...");
      const account = parts[0];
      const password = parts.slice(1).join(" ");
      api.login(chatId, account, password).then(resp => {
        if (resp.code === 1) {
          tg.send(chatId, `✅ *Logged in as ${resp.data.userinfo.username || account}!*`, { reply_markup: handlers.mainKb() });
        } else {
          tg.send(chatId, `❌ Login failed: ${resp.msg || "error"}`);
        }
      });
    } else {
      tg.send(chatId, "*Smart-NFT Bot* 🚀\n\nEnter account and password:\n`account password`", { reply_markup: tg.removeKeyboard() });
    }
    return;
  }

  if (awaitingLevelConfirm[chatId]) {
    const level = awaitingLevelConfirm[chatId];
    delete awaitingLevelConfirm[chatId];
    if (text === "✅ Confirm") {
      handlers.startCycle(chatId, level);
    } else {
      handlers.showMenu(chatId);
    }
    return;
  }

  if (awaitingLogout[chatId]) {
    delete awaitingLogout[chatId];
    if (text === "✅ Yes, logout") {
      handlers.forceLogout(chatId);
    } else {
      handlers.showMenu(chatId);
    }
    return;
  }

  switch (text) {
    case "🆕 New Order":
      handlers.showLevelPicker(chatId);
      break;

    case "Level 1 — Lil Pudgy #21432":
    case "Level 2 — Pudgy Penguin #5837":
    case "Level 3 — Azuki #5589": {
      const lvNum = parseInt(text.match(/Level (\d)/)[1]);
      awaitingLevelConfirm[chatId] = lvNum;
      handlers.confirmLevel(chatId, lvNum);
      break;
    }

    case "📊 Status":
      handlers.showStatus(chatId);
      break;

    case "📅 Daily":
      handlers.showDaily(chatId);
      break;

    case "🎁 Claim Now":
      handlers.doDailyClaim(chatId);
      break;

    case "📋 History":
      handlers.showHistoryMenu(chatId);
      break;

    case "📦 NFT Orders":
      handlers.showNftHistory(chatId);
      break;

    case "📅 Daily Log":
      handlers.showDailyLog(chatId);
      break;

    case "💰 Withdrawals":
      handlers.showWithdrawHistory(chatId);
      break;

    case "💳 Deposits":
      handlers.showDepositHistory(chatId);
      break;

    case "🚪 Logout":
      handlers.doLogout(chatId);
      break;

    case "✅ Yes, logout":
      awaitingLogout[chatId] = true;
      break;

    case "« Back":
    case "❌ Cancel":
      handlers.showMenu(chatId);
      break;

    default:
      handlers.showMenu(chatId);
      break;
  }
}

function setWebhook() {
  const u = new URL(`${API}/deleteWebhook`);
  https.get(u.toString(), () => {});
}

setWebhook();

let fetching = false;
setInterval(() => {
  if (!fetching) {
    fetching = true;
    fetchUpdates(getOffset(), () => { fetching = false; });
  }
}, 1000);

poll.start();

require("./src/dashboard").start(process.env.DASH_PORT || 3000);

console.log("Bot started (polling mode)");
