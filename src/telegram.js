const https = require("https");

const TOKEN = process.env.BOT_TOKEN || (() => { try { return require("../config.json").BOT_TOKEN; } catch { return null; } })();
const API = `https://api.telegram.org/bot${TOKEN}`;

function send(chatId, text, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = { chat_id: chatId, text, parse_mode: "Markdown", ...opts };
    const b = JSON.stringify(payload);
    const u = new URL(`${API}/sendMessage`);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.write(b);
    req.end();
  });
}

function keyboard(rows) {
  return { keyboard: rows.map(r => r.map(c => ({ text: c }))), resize_keyboard: true };
}
function sendPoll(chatId, question, options, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = {
      chat_id: chatId,
      question,
      options: JSON.stringify(options),
      is_anonymous: false,
      allows_multiple_answers: false,
      ...opts,
    };
    const b = JSON.stringify(payload);
    const u = new URL(`${API}/sendPoll`);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve(d));
    });
    req.on("error", reject);
    req.write(b);
    req.end();
  });
}
const removeKeyboard = () => ({ remove_keyboard: true });

module.exports = { send, sendPoll, keyboard, removeKeyboard };
