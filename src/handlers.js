const api = require("./api");
const db = require("./db");
const tg = require("./telegram");

const LEVELS = {
  1: { id: 149, name: "Lil Pudgy #21432" },
  2: { id: 206, name: "Pudgy Penguin #5837" },
  3: { id: 160, name: "Azuki #5589" },
};

const SLOT_MS = 7 * 60 * 1000;
const MAX_BUYS = 5;

function fmt(v) { return parseFloat(v || 0).toFixed(2); }

function secs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Top-level menu: shown on /startbot, and after "Main Menu" / logout.
function topKb() {
  return tg.keyboard([
    ["🔑 Login", "🎲 Poll"],
    ["🔒 Close Poll", "🎯 Pick Winner"],
  ]);
}

// Account submenu: shown only after the user is logged in.
function accountKb() {
  return tg.keyboard([
    ["🆕 New Order", "📊 Status"],
    ["📅 Daily", "📋 History"],
    ["🚪 Logout"],
    ["🏠 Main Menu"],
  ]);
}

// Backwards-compatible alias (older code / callers may still reference mainKb).
function mainKb() {
  return topKb();
}

// Checks if the user is logged in. If not, sends a login prompt and
// returns false so the calling handler can stop early.
async function requireLogin(chatId) {
  const s = db.get(chatId);
  if (!s) {
    await tg.send(chatId, "🔒 *Ei feature use korte age login korun*\n\nEnter account and password:\n`account password`", { reply_markup: tg.removeKeyboard() });
    return false;
  }
  return true;
}

// Sends the user back to whichever menu fits their login state.
async function goBack(chatId) {
  const s = db.get(chatId);
  if (s) {
    await tg.send(chatId, `*Account:* \`${s.display_name || s.account}\``, { reply_markup: accountKb() });
  } else {
    await showMenu(chatId);
  }
}

async function showMenu(chatId) {
  const s = db.get(chatId);
  const text = s
    ? `*Smart-NFT Bot* 🚀\n\nLogged in as: \`${s.display_name || s.account}\`\n\n🔑 Login → account menu\n🎲 Poll → send a poll\n🔒 Close Poll → lock the latest poll\n🎯 Pick Winner → roll dice & mention the winner`
    : `*Smart-NFT Bot* 🚀\n\n🔑 Login → sign in to your account\n🎲 Poll → send a poll\n🔒 Close Poll → lock the latest poll\n🎯 Pick Winner → roll dice & mention the winner`;
  await tg.send(chatId, text, { reply_markup: topKb() });
}

// Handles the "🔑 Login" button on the top menu.
async function showLogin(chatId) {
  const s = db.get(chatId);
  if (s) {
    await tg.send(chatId, `✅ *Already logged in*\nAccount: \`${s.display_name || s.account}\``, { reply_markup: accountKb() });
  } else {
    await tg.send(chatId, "Enter account and password:\n`account password`", { reply_markup: tg.removeKeyboard() });
  }
}

async function showLevelPicker(chatId) {
  if (!(await requireLogin(chatId))) return;
  const s = db.get(chatId);
  if (s.cycle_active) {
    await tg.send(chatId, `⚠️ Cycle running (${s.buy_count}/${MAX_BUYS}).`, { reply_markup: accountKb() });
    return;
  }
  await tg.send(chatId, "Select level:", {
    reply_markup: tg.keyboard([
      ["Level 1 — Lil Pudgy #21432"],
      ["Level 2 — Pudgy Penguin #5837"],
      ["Level 3 — Azuki #5589"],
      ["« Back"],
    ]),
  });
}

async function confirmLevel(chatId, level) {
  const lv = LEVELS[level];
  if (!lv) return;
  await tg.send(chatId,
    `*Confirm Level ${level}: ${lv.name}*\n` +
    `Buy \`${MAX_BUYS}\` slots × \`7 min\` each\n` +
    `Proceed?`, {
    reply_markup: tg.keyboard([["✅ Confirm"], ["❌ Cancel"]]),
  });
}

async function startCycle(chatId, level) {
  const lv = LEVELS[level];
  if (!lv) return;
  const s = db.get(chatId);
  if (!s) return;
  s.cycle_level = level;
  s.buy_count = 0;
  s.cycle_active = true;
  s.cycle_start = Date.now();
  s.last_buy_time = 0;
  db.set(chatId, s);
  await doBuy(chatId);
}

async function doBuy(chatId) {
  const s = db.get(chatId);
  if (!s) return;
  const lv = LEVELS[s.cycle_level];
  if (!lv) return;

  const resp = await api.authed(chatId, "nft/buyNft", { nft_id: lv.id });

  if (resp.code === -2) {
    await tg.send(chatId, `❌ ${resp.msg}`, { reply_markup: accountKb() });
    s.cycle_active = false;
    db.set(chatId, s);
    return;
  }

  if (resp.code !== 1) {
    const waitMatch = resp.msg ? resp.msg.match(/(\d+)\s*seconds?/) : null;
    if (waitMatch) {
      await tg.send(chatId, `⏳ Slot busy — wait \`${secs(parseInt(waitMatch[1]) * 1000)}\``, { reply_markup: accountKb() });
    } else {
      await tg.send(chatId, `❌ Buy failed: ${resp.msg || "error"}`, { reply_markup: accountKb() });
      s.cycle_active = false;
      db.set(chatId, s);
    }
    return;
  }

  s.buy_count = (s.buy_count || 0) + 1;
  s.last_buy_time = Date.now();
  s.history = s.history || [];
  s.history.push({ time: Date.now(), buy: s.buy_count, level: s.cycle_level, name: lv.name });
  db.set(chatId, s);

  const userResp = await api.authed(chatId, "user/Info");
  const bal = userResp.code === 1 ? userResp.data.money : "?";

  if (s.buy_count >= MAX_BUYS) {
    s.cycle_active = false;
    db.set(chatId, s);
    await tg.send(chatId,
      `✅ *Cycle Complete!* 🎉\n` +
      `Level ${s.cycle_level}: ${lv.name}\n` +
      `All \`${MAX_BUYS}\` buys done\n` +
      `Balance: \`${fmt(bal)} TRX\``, { reply_markup: accountKb() });
  } else {
    await tg.send(chatId,
      `✅ *Buy #${s.buy_count} done!* ✅\n` +
      `Balance: \`${fmt(bal)} TRX\`\n` +
      `⏳ Next in \`7 min\`\n` +
      `Progress: ${s.buy_count}/${MAX_BUYS}`, { reply_markup: accountKb() });
  }
}

async function showStatus(chatId) {
  if (!(await requireLogin(chatId))) return;
  const userResp = await api.authed(chatId, "user/Info");
  if (userResp.code === -2) {
    await tg.send(chatId, `❌ ${userResp.msg}`, { reply_markup: accountKb() });
    return;
  }
  if (userResp.code !== 1) {
    await tg.send(chatId, "Failed to fetch status", { reply_markup: accountKb() });
    return;
  }

  const u = userResp.data;
  const s = db.get(chatId);

  const ordersResp = await api.authed(chatId, "nft/getMyNftList", { level_id: 1, page: 1, limit: 50 });
  let activeCount = 0, completedCount = 0;
  if (ordersResp.code === 1 && ordersResp.data && ordersResp.data.list) {
    activeCount = ordersResp.data.list.filter(o => o.status == 0).length;
    completedCount = ordersResp.data.list.filter(o => o.status == 1).length;
  }

  let cycleText = "";
  if (s && s.cycle_active) {
    const elapsed = Date.now() - (s.last_buy_time || s.cycle_start);
    const remaining = Math.max(0, SLOT_MS - elapsed);
    cycleText = `\n*Cycle:* ${s.buy_count}/${MAX_BUYS} | ⏳ \`${secs(remaining)}\``;
  }

  const l1 = await api.authed(chatId, "nft/l1status");
  let slotText = "";
  if (l1.code === 1 && l1.data) {
    slotText = `\nSlot: \`${l1.data.count || "?"}/5\``;
  }

  const dailyStatus = u.today_sign == 1 ? "✅ Done" : "⏳ Available";

  await tg.send(chatId,
    `*📊 Status*\n\n` +
    `👤 \`${u.username || "User"}\`\n` +
    `💰 Balance: \`${fmt(u.money)} TRX\`\n` +
    `💎 Total: \`${fmt(u.all_amount || 0)} TRX\`\n` +
    `🔰 Level: \`${u.level}\` | Score: \`${fmt(u.score || 0)}\`\n` +
    `🏆 Total revenue: \`${fmt(u.total_revenue)} TRX\`\n` +
    `📈 Today: \`${fmt(u.today_revenue)} TRX\`\n` +
    `📅 Daily: ${dailyStatus}\n` +
    `🟢 Active: \`${activeCount}\` | ✅ Completed: \`${completedCount}\`` +
    slotText + cycleText, { reply_markup: accountKb() });
}

async function showDaily(chatId) {
  if (!(await requireLogin(chatId))) return;
  const userResp = await api.authed(chatId, "user/Info");
  if (userResp.code === -2) {
    await tg.send(chatId, `❌ ${userResp.msg}`, { reply_markup: accountKb() });
    return;
  }
  if (userResp.code !== 1) {
    await tg.send(chatId, "Failed to load info", { reply_markup: accountKb() });
    return;
  }

  const u = userResp.data;
  const already = u.today_sign == 1;
  const score = fmt(u.score || 0);

  let text = already
    ? `*📅 Daily*\n\n✅ Already checked in\nScore: \`${score}\``
    : `*📅 Daily*\n\n⏳ Not yet claimed\nScore: \`${score}\``;

  const kb = already ? accountKb() : tg.keyboard([["🎁 Claim Now"], ["« Back"]]);
  await tg.send(chatId, text, { reply_markup: kb });
}

async function doDailyClaim(chatId) {
  if (!(await requireLogin(chatId))) return;
  const userResp = await api.authed(chatId, "user/Info");
  if (userResp.code !== 1) return;
  const scoreBefore = fmt(userResp.data.score || 0);

  const resp = await api.authed(chatId, "wheel/daysign");
  if (resp.code === -2) {
    await tg.send(chatId, `❌ ${resp.msg}`, { reply_markup: accountKb() });
    return;
  }
  if (resp.code !== 1) {
    await tg.send(chatId, `⚠️ ${resp.msg || "Check-in failed"}`, { reply_markup: accountKb() });
    return;
  }

  const userResp2 = await api.authed(chatId, "user/Info");
  const scoreAfter = fmt(userResp2.code === 1 ? userResp2.data.score || 0 : "?");
  await tg.send(chatId, `✅ *Check-in done!*\n\nScore: \`${scoreBefore}\` → \`${scoreAfter}\``, { reply_markup: accountKb() });
}

async function showHistoryMenu(chatId) {
  if (!(await requireLogin(chatId))) return;
  await tg.send(chatId, "*📋 History*\n\nChoose:", {
    reply_markup: tg.keyboard([
      ["📦 NFT Orders"],
      ["📅 Daily Log"],
      ["💰 Withdrawals"],
      ["💳 Deposits"],
      ["« Back"],
    ]),
  });
}

async function showNftHistory(chatId) {
  if (!(await requireLogin(chatId))) return;
  const s = db.get(chatId);
  const orders = await api.authed(chatId, "nft/getMyNftList", { level_id: 1, page: 1, limit: 50 });
  if (orders.code === -2) {
    await tg.send(chatId, `❌ ${orders.msg}`, { reply_markup: accountKb() });
    return;
  }

  let text = "*📦 NFT Orders*\n\n";
  if (orders.code === 1 && orders.data && orders.data.list) {
    const activeOrders = orders.data.list.filter(o => o.status == 0);
    const completed = orders.data.list.filter(o => o.status == 1);
    text += `🟢 Active: \`${activeOrders.length}\` | ✅ Completed: \`${completed.length}\`\n\n`;
    if (activeOrders.length) {
      text += `*Active:*\n`;
      activeOrders.slice(0, 5).forEach((o, i) => {
        text += `${i + 1}. ${o.name} — \`${fmt(o.principal)} TRX\``;
        if (o.profit_rate) text += ` | ${o.profit_rate}%`;
        if (o.total_profit && parseFloat(o.total_profit) > 0) text += ` | +${fmt(o.total_profit)} TRX`;
        text += `\n   ⏳ Ends: ${o.staking_end_time_text || ""}\n`;
      });
      if (activeOrders.length > 5) text += `   ... +${activeOrders.length - 5} more\n`;
      text += "\n";
    }
    if (completed.length) {
      text += `*Completed:*\n`;
      completed.slice(0, 5).forEach((o, i) => {
        text += `${i + 1}. ${o.name} — \`${fmt(o.principal)} TRX\``;
        if (o.profit_rate) text += ` | ${o.profit_rate}%`;
        if (o.total_profit && parseFloat(o.total_profit) > 0) text += ` | +${fmt(o.total_profit)} TRX`;
        text += "\n";
      });
      if (completed.length > 5) text += `   ... +${completed.length - 5} more\n`;
    }
  } else {
    text += "No orders found.\n";
  }

  if (s && s.history && s.history.length) {
    text += `\n*Bot cycles:* ${s.history.length} buys\n`;
  }

  await tg.send(chatId, text, { reply_markup: accountKb() });
}

async function showDailyLog(chatId) {
  if (!(await requireLogin(chatId))) return;
  const resp = await api.authed(chatId, "wheel/signLog");
  if (resp.code === -2) {
    await tg.send(chatId, `❌ ${resp.msg}`, { reply_markup: accountKb() });
    return;
  }

  let text = "*📅 Daily Log*\n\n";
  if (resp.code === 1 && resp.data && resp.data.length) {
    resp.data.slice(0, 15).forEach((o, i) => {
      text += `${i + 1}. ${fmtDate(o.createtime)} — \`${o.before}\` → \`${o.after}\` (+${o.money})\n`;
    });
    text += `\nTotal: \`${resp.data.length}\` check-ins`;
  } else {
    text += "No check-in history.";
  }

  await tg.send(chatId, text, { reply_markup: accountKb() });
}

async function showWithdrawHistory(chatId) {
  if (!(await requireLogin(chatId))) return;
  const resp = await api.authed(chatId, "Withdrawal/List", { page: 1 });
  if (resp.code === -2) {
    await tg.send(chatId, `❌ ${resp.msg}`, { reply_markup: accountKb() });
    return;
  }

  let text = "*💰 Withdrawals*\n\n";
  if (resp.code === 1 && resp.data && resp.data.length) {
    resp.data.slice(0, 50).forEach((o, i) => {
      text += `${i + 1}. \`${fmt(o.money || 0)} TRX\` — ${fmtDate(o.createtime)}\n`;
      if (o.status_text) text += `   Status: ${o.status_text}\n`;
    });
  } else {
    text += "No withdrawals yet.";
  }

  await tg.send(chatId, text, { reply_markup: accountKb() });
}

async function showDepositHistory(chatId) {
  if (!(await requireLogin(chatId))) return;
  const resp = await api.authed(chatId, "recharge/List", { page: 1 });
  if (resp.code === -2) {
    await tg.send(chatId, `❌ ${resp.msg}`, { reply_markup: accountKb() });
    return;
  }

  let text = "*💳 Deposits*\n\n";
  if (resp.code === 1 && resp.data && resp.data.length) {
    resp.data.slice(0, 50).forEach((o, i) => {
      text += `${i + 1}. \`${fmt(o.money || 0)} TRX\` — ${fmtDate(o.createtime)}\n`;
      if (o.status_text) text += `   Status: ${o.status_text}\n`;
    });
  } else {
    text += "No deposits yet.";
  }

  await tg.send(chatId, text, { reply_markup: accountKb() });
}

async function doLogout(chatId) {
  if (!(await requireLogin(chatId))) return;
  await tg.send(chatId, "Sure you want to logout?", {
    reply_markup: tg.keyboard([["✅ Yes, logout"], ["« Back"]]),
  });
}

async function forceLogout(chatId) {
  db.del(chatId);
  await tg.send(chatId, "✅ Logged out.\n\nEnter account and password, or tap 🔑 Login:", { reply_markup: topKb() });
}

function isPollEnabled() {
  try { return require("../config.json").pollEnabled !== false; }
  catch { return true; }
}

// Fixed option list used for every Ludo poll. Index in this array matches
// Telegram's option_ids used in poll_answer updates.
const POLL_OPTIONS = ["4", "5", "6", "7", "8", "9", "10", "11", "12"];

// poll_id -> { optionIndex: [{ id, name }] }
// Tracks who voted for which option, per poll, so we can announce a winner later.
const pollVotes = {};

// userId = Telegram user id of whoever pressed "🎲 Poll" — saved so we know
// who is allowed to close it / pick a winner later.
async function showPoll(chatId, userId) {
  if (!isPollEnabled()) {
    await tg.send(chatId, "❌ Poll feature bondho ache.", { reply_markup: topKb() });
    return;
  }
  const respText = await tg.sendPoll(chatId, "Ludo", POLL_OPTIONS, {
    is_anonymous: false,
  });
  try {
    const resp = JSON.parse(respText);
    if (resp.ok && resp.result) {
      // Track poll message id, poll id (for votes) and who started it, per
      // chat, independent of login state, so it survives even if the user
      // isn't logged in.
      const s = db.get(chatId) || {};
      s.lastPollMessageId = resp.result.message_id;
      s.lastPollStarterId = userId;
      if (resp.result.poll && resp.result.poll.id) {
        s.lastPollId = resp.result.poll.id;
        pollVotes[resp.result.poll.id] = {};
      }
      db.set(chatId, s, { skipIfNoSession: true });
    }
  } catch {}
}

// userId = Telegram user id of whoever pressed "🔒 Close Poll" — only allowed
// through if it matches the user who started the poll. Only closes the poll
// (locks voting) — does NOT roll dice or pick a winner.
async function closePoll(chatId, userId) {
  const s = db.get(chatId);
  if (!s || !s.lastPollMessageId) {
    await tg.send(chatId, "❌ Kono active poll paoa jayni.", { reply_markup: topKb() });
    return;
  }
  if (s.lastPollStarterId && String(s.lastPollStarterId) !== String(userId)) {
    await tg.send(chatId, "⚠️ Shudhu jei poll shuru korche, shei ei poll close korte parbe.", { reply_markup: topKb() });
    return;
  }
  await tg.stopPoll(chatId, s.lastPollMessageId);
  s.lastPollMessageId = null; // prevents closing the same poll twice
  db.set(chatId, s);
  await tg.send(chatId, "🔒 Poll bondho kora hoyeche. Ekhon r keu vote dite parbe na.", { reply_markup: topKb() });
}

// Rolls one Telegram dice (🎲) and resolves with its value (1-6).
async function rollDice(chatId) {
  const respText = await tg.sendDice(chatId);
  try {
    const resp = JSON.parse(respText);
    if (resp.ok && resp.result && resp.result.dice) {
      return resp.result.dice.value;
    }
  } catch {}
  return 1;
}

// userId = Telegram user id of whoever pressed "🎯 Pick Winner" — only the
// person who started the poll can do this. Can be called repeatedly
// (re-dice) to reroll and reselect a winner.
async function pickWinner(chatId, userId) {
  const s = db.get(chatId);
  if (!s || !s.lastPollId) {
    await tg.send(chatId, "❌ Kono poll paoa jayni. Age ✔️ Poll shuru korun.", { reply_markup: topKb() });
    return;
  }
  if (s.lastPollStarterId && String(s.lastPollStarterId) !== String(userId)) {
    await tg.send(chatId, "⚠️ Shudhu jei poll shuru korche, shei winner pick korte parbe.", { reply_markup: topKb() });
    return;
  }

  // Roll 2 dice, reroll if the sum lands below the lowest poll option (4).
  let sum = 0;
  let attempts = 0;
  do {
    const d1 = await rollDice(chatId);
    const d2 = await rollDice(chatId);
    sum = d1 + d2;
    attempts++;
  } while (sum < 4 && attempts < 20);

  await announcePollWinner(chatId, s.lastPollId, String(sum));
}

// Called for every incoming poll_answer update from Telegram. Records or
// updates which option a user voted for (handles vote changes/retractions).
function recordPollAnswer(pollAnswer) {
  const { poll_id, user, option_ids } = pollAnswer;
  if (!poll_id || !user) return;
  if (!pollVotes[poll_id]) pollVotes[poll_id] = {};

  // Remove this user from any option they may have picked before.
  for (const idx of Object.keys(pollVotes[poll_id])) {
    pollVotes[poll_id][idx] = pollVotes[poll_id][idx].filter(v => v.id !== user.id);
  }

  if (option_ids && option_ids.length) {
    const idx = option_ids[0];
    if (!pollVotes[poll_id][idx]) pollVotes[poll_id][idx] = [];
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "User";
    pollVotes[poll_id][idx].push({ id: user.id, name });
  }
}

// Mentions everyone who voted for the given option (e.g. "6").
async function announcePollWinner(chatId, pollId, optionText) {
  const idx = POLL_OPTIONS.indexOf(String(optionText).trim());
  if (idx === -1) return;

  const voters = (pollVotes[pollId] && pollVotes[pollId][idx]) || [];
  if (!voters.length) {
    await tg.send(chatId, `🎲 Winning number: *${optionText}*\n❌ Kew ei number-e vote deyni.`);
    return;
  }

  const mentions = voters.map(v => `[${v.name}](tg://user?id=${v.id})`).join(", ");
  await tg.send(chatId, `🎲 Winning number: *${optionText}*\n🎉 ${mentions} — *You win today!*`);
}

module.exports = {
  showMenu,
  showLogin,
  goBack,
  showLevelPicker,
  confirmLevel,
  startCycle,
  doBuy,
  showStatus,
  showDaily,
  doDailyClaim,
  showHistoryMenu,
  showNftHistory,
  showDailyLog,
  showWithdrawHistory,
  showDepositHistory,
  doLogout,
  forceLogout,
  showPoll,
  closePoll,
  pickWinner,
  recordPollAnswer,
  announcePollWinner,
  topKb,
  accountKb,
  mainKb,
  LEVELS,
  SLOT_MS,
  MAX_BUYS,
};
