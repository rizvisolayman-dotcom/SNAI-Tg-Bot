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
process.on("SIGINT", () => { console.log("Shutting down (SIGINT)..."); process.exit(0); });
process.on("SIGTERM", () => { console.log("Shutting down (SIGTERM)..."); process.exit(0); });

function getOffset() {
  try { return parseInt(require("fs").readFileSync(OFFSET_FILE, "utf8")) || 0; }
  catch { return 0; }
}

function saveOffset(n) {
  require("fs").writeFileSync(OFFSET_FILE, String(n));
}

const awaitingLevelConfirm = {};
const awaitingLogout = {};

const KNOWN_BUTTONS = new Set([
  "🔑 Login", "🎲 Poll", "🔒 Close Poll", "🎯 Pick Winner",
  "🆕 New Order", "📊 Status", "📅 Daily", "📋 History", "🔁 Auto Order",
  "Level 1 — Lil Pudgy #21432", "Level 2 — Pudgy Penguin #5837", "Level 3 — Azuki #5589",
  "🎁 Claim Now", "📦 NFT Orders", "📅 Daily Log", "💰 Withdrawals", "💳 Deposits",
  "🚪 Logout", "✅ Yes, logout", "🏠 Main Menu", "« Back", "❌ Cancel",
]);

const WINNER_REPLY_RE = /^(4|5|6|7|8|9|10|11|12)$/;

function fetchUpdates(offset, cb) {
  const u = new URL(`${API}/getUpdates`);
  u.searchParams.set("offset", offset);
  u.searchParams.set("timeout", 30);
  u.searchParams.set("allowed_updates", JSON.stringify(["message", "poll_answer"]));
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

function attemptLogin(chatId, account, password) {
  tg.send(chatId, "🔄 Logging in...");

  api.login(chatId, account, password)
    .then(resp => {
      if (resp && resp.code === 1) {
        tg.send(
          chatId,
          `✅ *Logged in as ${resp.data.userinfo.username || account}!*`,
          { reply_markup: handlers.accountKb() }
        );
      } else {
        tg.send(
          chatId,
          `❌ Login failed: ${resp?.msg || "Unknown error"}`,
          { reply_markup: handlers.topKb() }
        );
      }
    })
    .catch(err => {
      console.error("LOGIN ERROR:", err);

      tg.send(
        chatId,
        `❌ Login error:\n${String(err)}`,
        { reply_markup: handlers.topKb() }
      );
    });
}
function handleUpdate(upd) {
  if (upd.poll_answer) {
    handlers.recordPollAnswer(upd.poll_answer);
    return;
  }

  if (!upd.message || !upd.message.text) return;
  const chatId = String(upd.message.chat.id);
  const text = upd.message.text.trim();
  const userId = upd.message.from && upd.message.from.id;
  const s = db.get(chatId);

  console.log(`[${chatId}] ${text}`);

  if (text.startsWith("/start")) {
    handlers.showMenu(chatId);
    return;
  }

  if (text.startsWith("/login")) {
    const rest = text.slice(7).trim();
    const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      const account = parts[0];
      const password = parts.slice(1).join(" ");
      attemptLogin(chatId, account, password);
    } else {
      tg.send(chatId, "Format: `/login account password`");
    }
    return;
  }

  if (awaitingLevelConfirm[chatId]) {
    const level = awaitingLevelConfirm[chatId];
    delete awaitingLevelConfirm[chatId];
    if (text === "✅ Confirm") {
      handlers.startCycle(chatId, level);
    } else {
      handlers.goBack(chatId);
    }
    return;
  }

  if (awaitingLogout[chatId]) {
    delete awaitingLogout[chatId];
    if (text === "✅ Yes, logout") {
      handlers.forceLogout(chatId);
    } else {
      handlers.goBack(chatId);
    }
    return;
  }

  const replyMsg = upd.message.reply_to_message;
  if (replyMsg && replyMsg.poll && WINNER_REPLY_RE.test(text)) {
    handlers.announcePollWinner(chatId, replyMsg.poll.id, text);
    return;
  }

  if (!KNOWN_BUTTONS.has(text)) {
    return;
  }

  switch (text) {
    case "🔑 Login":
      handlers.showLogin(chatId);
      break;
    case "🎲 Poll":
      handlers.showPoll(chatId, userId);
      break;
    case "🔒 Close Poll":
      handlers.closePoll(chatId, userId);
      break;
    case "🎯 Pick Winner":
      handlers.pickWinner(chatId, userId);
      break;
    case "🆕 New Order":
      handlers.showLevelPicker(chatId);
      break;
    case "🔁 Auto Order":
      handlers.toggleAutoOrder(chatId);
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
    case "🏠 Main Menu":
      handlers.showMenu(chatId);
      break;
    case "« Back":
    case "❌ Cancel":
      handlers.goBack(chatId);
      break;
    default:
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
require("./src/dailyTask").start();
require("./src/autoOrder").start();
require("./src/dashboard").start(process.env.DASH_PORT || 3000);
console.log("Bot started (polling mode)");
