const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");
const Database = require("better-sqlite3");

/* ================= SQLite ================= */

const db = new Database(path.join(__dirname, "linkup.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    salt TEXT NOT NULL DEFAULT '',
    first TEXT NOT NULL DEFAULT '',
    last TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    online INTEGER NOT NULL DEFAULT 0,
    lastSeen INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,            -- 'dm' | 'group'
    name TEXT NOT NULL DEFAULT '',
    memberIds TEXT NOT NULL,       -- JSON array
    createdBy TEXT NOT NULL DEFAULT '',
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'call'
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chatId, ts);
  CREATE INDEX IF NOT EXISTS idx_chats_member ON chats(memberIds);
`);

/* ================= Password hash ================= */

const crypto = require("crypto");

function hashPassword(password, salt) {
  return crypto
    .createHash("sha256")
    .update(salt + "::" + password)
    .digest("hex");
}

/* ================= Helpers ================= */

function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    first: row.first,
    last: row.last,
    about: row.about,
    online: !!row.online,
    lastSeen: row.lastSeen,
    createdAt: row.createdAt,
  };
}

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    first: u.first,
    last: u.last,
    about: u.about,
    online: u.online,
    lastSeen: u.lastSeen,
    createdAt: u.createdAt,
  };
}

function publicUser(id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return sanitizeUser(rowToUser(row));
}

function getUserByUsernameOrEmail(q) {
  const row = db
    .prepare("SELECT * FROM users WHERE username = ? OR email = ?")
    .get(q, q);
  return rowToUser(row);
}

function getChat(id) {
  const row = db.prepare("SELECT * FROM chats WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    memberIds: JSON.parse(row.memberIds || "[]"),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/* ================= WebSocket: подключения ================= */

const wss = new WebSocketServer({ noServer: true });

// userId -> { ws, pingTimer }
const clients = new Map();

function attachUser(ws, userId) {
  const old = clients.get(userId);
  if (old && old.ws !== ws) {
    try {
      old.ws.close();
    } catch (e) {}
  }
  clients.set(userId, { ws, pingTimer: null });
}

function detachUser(ws) {
  for (const [uid, c] of clients.entries()) {
    if (c.ws === ws) clients.delete(uid);
  }
}

function sendTo(userId, msg) {
  const c = clients.get(userId);
  if (c && c.ws.readyState === 1) {
    c.ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function broadcastToChat(chatId, senderId, msg) {
  const chat = getChat(chatId);
  if (!chat) return;
  chat.memberIds.forEach((mid) => {
    if (mid !== senderId) sendTo(mid, msg);
  });
}

function broadcastPresence() {
  const all = db.prepare("SELECT * FROM users").all().map(rowToUser).map(sanitizeUser);
  const msg = JSON.stringify({ t: "users", users: all });
  for (const c of clients.values()) {
    if (c.ws.readyState === 1) c.ws.send(msg);
  }
}

const wssConnections = new Set();

/* ================= Express ================= */

const app = express();
app.use(express.json());

app.use("/", express.static(path.join(__dirname, "..")));

// Небольшой middleware: если путь не файл — отдать index.html (SPA)
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, url);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, req, url) => {
  const token = url.searchParams.get("token");
  if (!token) {
    ws.close(4001, "no token");
    return;
  }

  // token = userId (простая сессия по ID пользователя)
  const user = publicUser(token);
  if (!user) {
    ws.close(4002, "bad token");
    return;
  }

  attachUser(ws, token);
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // Пинги для определения обрыва
  const pingTimer = setInterval(() => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }, 30000);

  const entry = clients.get(token);
  if (entry) entry.pingTimer = pingTimer;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    handleWsMessage(token, msg);
  });

  ws.on("close", () => {
    clearInterval(pingTimer);
    detachUser(ws);
    db.prepare("UPDATE users SET online = 0, lastSeen = ? WHERE id = ?").run(
      Date.now(),
      token
    );
    broadcastPresence();
  });

  // Помечаем онлайн при подключении
  db.prepare("UPDATE users SET online = 1, lastSeen = ? WHERE id = ?").run(Date.now(), token);
  broadcastPresence();

  // Сразу отправляем пользователю свежий список онлайна
  const all = db.prepare("SELECT * FROM users").all().map(rowToUser).map(sanitizeUser);
  ws.send(JSON.stringify({ t: "users", users: all }));
});

function handleWsMessage(userId, msg) {
  switch (msg.t) {
    case "chat:open":
      // клиент открыл чат — отправляем ему историю (или клиент сам запросит через HTTP)
      break;

    case "chat:message": {
      const { chatId, text } = msg;
      const chat = getChat(chatId);
      if (!chat) return;
      if (!chat.memberIds.includes(userId)) return;

      const m = {
        id: uid("m"),
        chatId,
        senderId: userId,
        text: String(text || "").slice(0, 4000),
        kind: "text",
        ts: Date.now(),
      };

      db.prepare(
        "INSERT INTO messages (id, chatId, senderId, text, kind, ts) VALUES (?,?,?,?,?,?)"
      ).run(m.id, m.chatId, m.senderId, m.text, m.kind, m.ts);

      // Автору — подтверждение, остальным — новое сообщение
      sendTo(userId, { t: "chat:message", message: m });
      broadcastToChat(chatId, userId, { t: "chat:message", message: m });
      break;
    }

    case "call:offer":
    case "call:answer":
    case "call:ice": {
      const target = msg.to;
      if (!target) return;
      sendTo(target, {
        t: msg.t,
        from: userId,
        callId: msg.callId,
        payload: msg.payload,
      });
      break;
    }

    case "call:ring": {
      // Уведомление: вас вызывают
      const target = msg.to;
      if (!target) return;
      sendTo(target, {
        t: "call:ring",
        from: userId,
        callId: msg.callId,
        kind: msg.kind || "audio",
        chatId: msg.chatId,
      });
      break;
    }

    case "call:accept":
    case "call:decline":
    case "call:end": {
      const target = msg.to;
      if (!target) return;
      sendTo(target, { t: msg.t, from: userId, callId: msg.callId });
      break;
    }
  }
}

/* ================= HTTP API ================= */

const API = "/api";

// Регистрация
app.post(API + "/register", (req, res) => {
  const { username, email, password, first, last } = req.body || {};
  const un = String(username || "").trim().toLowerCase();
  const em = String(email || "").trim().toLowerCase();
  const fn = String(first || "").trim();

  if (!fn) return res.status(400).json({ error: "Введите имя" });
  if (!/^[a-z0-9_]{3,20}$/.test(un))
    return res.status(400).json({ error: "Логин: 3-20 символов, латиница, цифры, _" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em))
    return res.status(400).json({ error: "Некорректная почта" });
  if (String(password).length < 6)
    return res.status(400).json({ error: "Пароль минимум 6 символов" });

  const exists = db
    .prepare("SELECT 1 FROM users WHERE username = ? OR email = ?")
    .get(un, em);
  if (exists) return res.status(409).json({ error: "Логин или почта уже заняты" });

  const salt = Math.random().toString(36).slice(2, 10);
  const id = uid("u");
  db.prepare(
    "INSERT INTO users (id, username, email, password, salt, first, last, createdAt, online, lastSeen) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).run(id, un, em, hashPassword(password, salt), salt, fn, String(last || ""), Date.now(), 0, Date.now());

  const user = publicUser(id);
  broadcastPresence();
  res.json({ token: id, user });
});

// Вход
app.post(API + "/login", (req, res) => {
  const { loginId, password } = req.body || {};
  const user = getUserByUsernameOrEmail(String(loginId || "").trim());
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);

  // Проверяем пароль: либо хеш, либо (для seed-пользователей) открытый текст
  const valid =
    (row.salt && row.salt !== "" && row.password === hashPassword(password, row.salt)) ||
    row.password === password;

  if (!valid) return res.status(401).json({ error: "Неверный пароль" });

  res.json({ token: user.id, user });
});

// Текущий пользователь (по токену/ID)
app.get(API + "/me", (req, res) => {
  const token = req.headers.authorization || "";
  const id = token.replace(/^Bearer\s+/i, "");
  const user = publicUser(id);
  if (!user) return res.status(401).json({ error: "Не авторизован" });
  res.json({ user });
});

// Список всех пользователей
app.get(API + "/users", (req, res) => {
  const all = db.prepare("SELECT * FROM users").all().map(rowToUser).map(sanitizeUser);
  res.json({ users: all });
});

// Поиск людей
app.get(API + "/users/search", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  let rows = db.prepare("SELECT * FROM users").all();
  if (q) {
    rows = rows.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.first.toLowerCase().includes(q) ||
        r.last.toLowerCase().includes(q)
    );
  }
  res.json({ users: rows.map(rowToUser).map(sanitizeUser) });
});

// Мои чаты
app.get(API + "/chats", (req, res) => {
  const token = req.headers.authorization || "";
  const id = token.replace(/^Bearer\s+/i, "");
  const rows = db.prepare("SELECT * FROM chats").all();
  const mine = rows
    .filter((r) => JSON.parse(r.memberIds).includes(id))
    .map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      memberIds: JSON.parse(r.memberIds),
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  res.json({ chats: mine });
});

// Создать/взять DM
app.post(API + "/chats/dm", (req, res) => {
  const token = req.headers.authorization || "";
  const me = token.replace(/^Bearer\s+/i, "");
  const { otherId } = req.body || {};
  if (!otherId) return res.status(400).json({ error: "no otherId" });

  const rows = db.prepare("SELECT * FROM chats WHERE type = 'dm'").all();
  const found = rows.find((r) => {
    const ids = JSON.parse(r.memberIds);
    return ids.includes(me) && ids.includes(otherId);
  });
  if (found) {
    return res.json({
      chat: {
        id: found.id,
        type: found.type,
        memberIds: JSON.parse(found.memberIds),
        createdAt: found.createdAt,
      },
    });
  }

  const chatId = uid("c");
  db.prepare(
    "INSERT INTO chats (id, type, name, memberIds, createdBy, createdAt) VALUES (?,?,?,?,?,?)"
  ).run(chatId, "dm", "", JSON.stringify([me, otherId]), me, Date.now());
  res.json({
    chat: {
      id: chatId,
      type: "dm",
      memberIds: [me, otherId],
      createdAt: Date.now(),
    },
  });
});

// Создать группу
app.post(API + "/chats/group", (req, res) => {
  const token = req.headers.authorization || "";
  const me = token.replace(/^Bearer\s+/i, "");
  const { name, memberIds } = req.body || {};
  const ids = Array.from(new Set([me, ...(Array.isArray(memberIds) ? memberIds : [])]));
  if (ids.length < 2) return res.status(400).json({ error: "Нужны участники" });

  const chatId = uid("c");
  db.prepare(
    "INSERT INTO chats (id, type, name, memberIds, createdBy, createdAt) VALUES (?,?,?,?,?,?)"
  ).run(chatId, "group", String(name || "Без названия").trim().slice(0, 100), JSON.stringify(ids), me, Date.now());
  res.json({
    chat: { id: chatId, type: "group", name: String(name || "").trim(), memberIds: ids, createdBy: me, createdAt: Date.now() },
  });
});

// Выйти из чата
app.post(API + "/chats/:id/leave", (req, res) => {
  const token = req.headers.authorization || "";
  const me = token.replace(/^Bearer\s+/i, "");
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "чат не найден" });
  const ids = chat.memberIds.filter((x) => x !== me);
  db.prepare("UPDATE chats SET memberIds = ? WHERE id = ?").run(JSON.stringify(ids), chat.id);
  res.json({ ok: true });
});

// Сообщения чата
app.get(API + "/chats/:id/messages", (req, res) => {
  const token = req.headers.authorization || "";
  const id = token.replace(/^Bearer\s+/i, "");
  const chat = getChat(req.params.id);
  if (!chat) return res.status(404).json({ error: "чат не найден" });
  if (!chat.memberIds.includes(id))
    return res.status(403).json({ error: "нет доступа" });

  const rows = db
    .prepare("SELECT * FROM messages WHERE chatId = ? ORDER BY ts ASC")
    .all(chat.id);
  res.json({ messages: rows });
});

// История звонков — не нужна отдельно (сообщения kind=call), оставим простой GET
app.get(API + "/calls", (req, res) => {
  const token = req.headers.authorization || "";
  const id = token.replace(/^Bearer\s+/i, "");
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE kind = 'call' AND (senderId = ? OR chatId IN (SELECT id FROM chats WHERE memberIds LIKE ?)) ORDER BY ts DESC LIMIT 100"
    )
    .all(id, "%" + id + "%");
  res.json({ calls: rows });
});

/* ================= Seed: демо-пользователи ================= */

function seed() {
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  if (count > 0) return;

  const seedUsers = [
    { username: "demo", email: "demo@linkup.app", password: "demo123", first: "Demo", last: "", about: "Демо-аккаунт" },
    { username: "alex", email: "alex@linkup.app", password: "alex123", first: "Alex", last: "Star", about: "Звонки и чаты — привет!" },
    { username: "kira", email: "kira@linkup.app", password: "kira123", first: "Кира", last: "Морозова", about: "Дизайн, кофе, LinkUp" },
    { username: "max", email: "max@linkup.app", password: "max123", first: "Max", last: "Volkov", about: "" },
  ];

  const ins = db.prepare(
    "INSERT INTO users (id, username, email, password, salt, first, last, about, createdAt, online, lastSeen) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const ids = {};
  seedUsers.forEach((u) => {
    const id = uid("u");
    ids[u.username] = id;
    ins.run(id, u.username, u.email, u.password, "", u.first, u.last, u.about, Date.now(), 0, Date.now());
  });

  // Пример чата demo-alex и группы
  const chatDM = uid("c");
  db.prepare("INSERT INTO chats (id, type, name, memberIds, createdBy, createdAt) VALUES (?,?,?,?,?,?)").run(
    chatDM, "dm", "", JSON.stringify([ids.demo, ids.alex]), ids.demo, Date.now()
  );

  const grp = uid("c");
  db.prepare("INSERT INTO chats (id, type, name, memberIds, createdBy, createdAt) VALUES (?,?,?,?,?,?)").run(
    grp, "group", "LinkUp — команда", JSON.stringify([ids.demo, ids.alex, ids.kira, ids.max]), ids.demo, Date.now()
  );

  const insMsg = db.prepare(
    "INSERT INTO messages (id, chatId, senderId, text, kind, ts) VALUES (?,?,?,?,?,?)"
  );
  insMsg.run(uid("m"), chatDM, ids.alex, "Привет! Давай созвонимся позже", "text", Date.now() - 3600000 * 2);
  insMsg.run(uid("m"), grp, ids.kira, "Всем привет в команде LinkUp! 🎉", "text", Date.now() - 3600000 * 20);
  insMsg.run(uid("m"), grp, ids.alex, "Звонки уже проверили?", "text", Date.now() - 3600000 * 19);
  insMsg.run(uid("m"), grp, ids.demo, "Сейчас всё соберём, скоро покажем", "text", Date.now() - 3600000 * 18);
}

seed();
broadcastPresence();

/* ================= Запуск ================= */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("LinkUp server on http://localhost:" + PORT);
});