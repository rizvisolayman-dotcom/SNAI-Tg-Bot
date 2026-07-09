const db = require("./db");
const api = require("./api");
const tg = require("./telegram");
const { SLOT_MS, MAX_BUYS, mainKb } = require("./handlers");

const POLL_MS = 15_000;

function start() {
  setInterval(async () => {
    try {
      const data = db.load();
      if (!data.users) return;
      for (const [chatId, s] of Object.entries(data.users)) {
        if (!s.cycle_active || !s.token) continue;
        const elapsed = Date.now() - (s.last_buy_time || s.cycle_start);
        if (elapsed < SLOT_MS) continue;
        if (s.buy_count >= MAX_BUYS) {
          s.cycle_active = false;
          db.set(chatId, s);
          continue;
        }
        try {
          const lv = { 1: { id: 149 }, 2: { id: 206 }, 3: { id: 160 } }[s.cycle_level];
          if (!lv) continue;
          const resp = await api.authed(chatId, "nft/buyNft", { nft_id: lv.id });
          if (resp.code === 1) {
            s.buy_count += 1;
            s.last_buy_time = Date.now();
            if (s.buy_count >= MAX_BUYS) {
              s.cycle_active = false;
              db.set(chatId, s);
              await tg.send(chatId, `✅ *Cycle Complete!* 🎉`, { reply_markup: mainKb() });
            } else {
              db.set(chatId, s);
              await tg.send(chatId, `✅ *Auto Buy #${s.buy_count}/5 done!* ✅\n⏳ Next in \`6.5 min\``, { reply_markup: mainKb() });
            }
          }
        } catch {}
      }
    } catch {}
  }, POLL_MS);
}

module.exports = { start };
