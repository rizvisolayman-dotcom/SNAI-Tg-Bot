const db = require("./db");
const handlers = require("./handlers");

const CHECK_MS = 60 * 1000;

function isDhaka1202AM() {
  const now = new Date();

  const dhaka = new Date(
    now.toLocaleString("en-US", {
      timeZone: "Asia/Dhaka"
    })
  );

  return dhaka.getHours() === 0 && dhaka.getMinutes() === 2;
}

let lastRunDate = "";

function start() {
  setInterval(async () => {
    try {
      const now = new Date();
      const dhaka = new Date(
        now.toLocaleString("en-US", {
          timeZone: "Asia/Dhaka"
        })
      );

      const today =
        dhaka.getFullYear() +
        "-" +
        String(dhaka.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(dhaka.getDate()).padStart(2, "0");

      if (!isDhaka1202AM()) return;
      if (lastRunDate === today) return;

      lastRunDate = today;

      for (const [chatId] of db.getAll()) {
        try {
          await handlers.doDailyClaim(chatId);
        } catch (e) {
          console.error("Daily claim error:", chatId, e);
        }
      }
    } catch (e) {
      console.error("dailyTask error:", e);
    }
  }, CHECK_MS);
}

module.exports = { start };
