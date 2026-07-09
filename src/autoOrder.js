const db = require("./db");
const handlers = require("./handlers");

const CHECK_MS = 60_000;
const GRACE_MS = 5 * 60 * 1000; // 5 minutes after the watched order ends

function start() {
  setInterval(async () => {
    try {
      for (const [chatId, s] of db.getAll()) {
        if (!s.autoOrderEnabled || !s.token) continue;
        if (s.cycle_active) continue; // a buy cycle is already running

        const level = s.autoOrderLevel || s.cycle_level;
        if (!level) continue;

        if (!s.autoWatchEndTs) {
          await handlers.refreshAutoWatch(chatId, level);
          continue;
        }

        if (Date.now() < s.autoWatchEndTs + GRACE_MS) continue;

        // Order matured + grace period passed -> buy again at the same level.
        const fresh = db.get(chatId);
        if (!fresh) continue;
        fresh.autoWatchEndTs = null;
        db.set(chatId, fresh);
        await handlers.startCycle(chatId, level);
      }
    } catch {}
  }, CHECK_MS);
}

module.exports = { start };
