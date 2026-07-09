const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data.json");

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { users: {} }; }
}

function save(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function get(chatId) {
  return load().users[chatId] || null;
}

function set(chatId, data) {
  const d = load();
  d.users[chatId] = data;
  save(d);
}

function del(chatId) {
  const d = load();
  delete d.users[chatId];
  save(d);
}

function getAll() {
  return load().users || {};
}

module.exports = {
  load,
  save,
  get,
  set,
  del,
  getAll
};
