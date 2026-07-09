const https = require("https");
const db = require("./db");

const BASE = "https://api.smart-nft.online/api/";

function call(token, endpoint, data = {}) {
  return new Promise((resolve, reject) => {
    const body = Object.entries(data)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const u = new URL(endpoint, BASE);

    const opts = {
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "accept-language": "en-US",
        ...(token ? { token } : {}),
      },
      timeout: 15000,
    };

    const req = https.request(opts, (res) => {
      let b = "";

      res.on("data", c => b += c);

      res.on("end", () => {
        try {
          resolve(JSON.parse(b));
        } catch {
          reject(b);
        }
      });
    });

    req.on("error", reject);

    req.on("timeout", () => {
      req.destroy();
      reject("timeout");
    });

    req.write(body);
    req.end();
  });
}

async function login(chatId, account, password) {
  const resp = await call(null, "user/login", {
    account,
    password
  });

  if (resp.code !== 1) return resp;

  const old = db.get(chatId) || {};

  const s = {
    ...old,
    account,
    password,
    token: resp.data.userinfo.token,
    login_time: Date.now(),
    display_name: resp.data.userinfo.username || account,
  };

  db.set(chatId, s);
  return resp;
}

async function authed(chatId, endpoint, data = {}) {
  const s = db.get(chatId);

  if (!s || !s.account || !s.password) {
    return { code: -2, msg: "Not logged in" };
  }

  let token = s.token;

  // token na thakle age login korbe
  if (!token) {
    const loginResp = await call(null, "user/login", {
      account: s.account,
      password: s.password
    });

    if (loginResp.code !== 1) {
      return { code: -2, msg: "Auto re-login failed" };
    }

    token = loginResp.data.userinfo.token;
    s.token = token;
    s.login_time = Date.now();
    db.set(chatId, s);
  }

  let resp = await call(token, endpoint, data);

  // token invalid hole sudhu tokhon login korbe
  if (
    resp &&
    (
      resp.code === -1 ||
      String(resp.msg || "").toLowerCase().includes("login") ||
      String(resp.msg || "").toLowerCase().includes("token")
    )
  ) {
    const loginResp = await call(null, "user/login", {
      account: s.account,
      password: s.password
    });

    if (loginResp.code !== 1) {
      return { code: -2, msg: "Auto re-login failed" };
    }

    s.token = loginResp.data.userinfo.token;
    s.login_time = Date.now();
    db.set(chatId, s);

    resp = await call(s.token, endpoint, data);
  }

  return resp;
}

module.exports = {
  call,
  login,
  authed
};
