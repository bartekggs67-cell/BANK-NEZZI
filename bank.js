const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PASS = "7532252";
const DATA_FILE = path.join(__dirname, "data.json");
const HTML_FILE = path.join(__dirname, "index.html");

let db = { users: {}, pending: {}, withdraws: [], authVerifications: {} };

if (fs.existsSync(DATA_FILE)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    db = {
      users: parsed.users || {},
      pending: parsed.pending || {},
      withdraws: parsed.withdraws || [],
      authVerifications: parsed.authVerifications || {}
    };
  } catch (_) {}
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (_) {}
}

function hashPassword(plain) {
  return crypto.createHash("sha256").update(String(plain)).digest("hex");
}

function ensureUser(nick) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  if (!key) return null;
  if (!db.users[key]) {
    db.users[key] = {
      nick: cleanNick,
      balance: 0,
      totalDeposited: 0,
      passwordHash: ""
    };
  } else if (!db.users[key].nick) {
    db.users[key].nick = cleanNick;
  }
  return db.users[key];
}

function addBalance(nick, amount) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  const value = Math.floor(Number(amount) || 0);
  if (!key || value <= 0) return;

  const user = ensureUser(cleanNick);
  user.balance += value;
  user.totalDeposited += value;
  delete db.pending[key];
  saveDb();
}

function upsertUser(nick, balance, totalDeposited) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  if (!key) return;

  const existing = db.users[key];
  db.users[key] = {
    nick: cleanNick,
    balance: Math.max(0, Math.floor(Number(balance) || 0)),
    totalDeposited: Math.max(0, Math.floor(Number(totalDeposited) || 0)),
    passwordHash: existing ? existing.passwordHash || "" : ""
  };
  saveDb();
}

function deleteUser(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return;
  delete db.users[k];
  delete db.pending[k];
  delete db.authVerifications[k];
  saveDb();
}

function simulateSend(nick, amount, instantCredit) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  const value = Math.floor(Number(amount) || 0);
  if (!key || value <= 0) return;

  if (instantCredit) {
    addBalance(cleanNick, value);
  } else {
    db.pending[key] = { nick: cleanNick, amount: value };
    saveDb();
  }
}

function getPublicState() {
  const safeUsers = {};
  for (const [k, u] of Object.entries(db.users || {})) {
    safeUsers[k] = {
      nick: u.nick,
      balance: Number(u.balance || 0),
      totalDeposited: Number(u.totalDeposited || 0),
      hasPassword: Boolean(u.passwordHash)
    };
  }
  const safeAuth = {};
  for (const [k, v] of Object.entries(db.authVerifications || {})) {
    safeAuth[k] = {
      nick: v.nick,
      mode: v.mode,
      amount: v.amount,
      approved: Boolean(v.approved),
      createdAt: v.createdAt || 0
    };
  }
  return {
    users: safeUsers,
    pending: db.pending || {},
    withdraws: db.withdraws || [],
    authVerifications: safeAuth
  };
}

function readBody(req, cb) {
  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1e6) req.destroy();
  });
  req.on("end", () => {
    try {
      cb(body ? JSON.parse(body) : {});
    } catch (_) {
      cb({});
    }
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(HTML_FILE).pipe(res);
  }

  if (req.method === "GET" && req.url === "/api/state") {
    return sendJson(res, 200, getPublicState());
  }

  if (req.method === "POST") {
    return readBody(req, data => {
      if (req.url === "/api/auth-start") {
        const cleanNick = String(data.nick || "").trim();
        const key = cleanNick.toLowerCase();
        const password = String(data.password || "");
        const mode = String(data.mode || "login");

        if (!cleanNick) {
          return sendJson(res, 400, { ok: false, error: "Podaj nick z Minecrafta." });
        }
        if (password.length < 4) {
          return sendJson(res, 400, { ok: false, error: "Hasło musi mieć co najmniej 4 znaki." });
        }

        const existing = db.users[key];

        if (mode === "register") {
          if (existing && existing.passwordHash) {
            return sendJson(res, 400, {
              ok: false,
              error: "Ten nick ma już konto — użyj przycisku Zaloguj."
            });
          }
        } else {
          if (!existing || !existing.passwordHash) {
            return sendJson(res, 400, {
              ok: false,
              error: "Brak konta dla tego nicku — kliknij Zarejestruj się."
            });
          }
          if (hashPassword(password) !== existing.passwordHash) {
            return sendJson(res, 401, {
              ok: false,
              error: "Nieprawidłowe hasło do tego konta."
            });
          }
        }

        const amount = Math.floor(Math.random() * 1000) + 1;
        const token = crypto.randomBytes(12).toString("hex");
        db.authVerifications[key] = {
          nick: existing ? existing.nick : cleanNick,
          mode,
          passwordHash: hashPassword(password),
          amount,
          token,
          approved: false,
          createdAt: Date.now()
        };
        saveDb();

        return sendJson(res, 200, {
          ok: true,
          nick: db.authVerifications[key].nick,
          amount,
          token,
          mode
        });
      }

      if (req.url === "/api/auth-complete") {
        const cleanNick = String(data.nick || "").trim();
        const key = cleanNick.toLowerCase();
        const token = String(data.token || "");
        const entry = db.authVerifications[key];

        if (!entry || entry.token !== token) {
          return sendJson(res, 400, {
            ok: false,
            error: "Sesja weryfikacji wygasła. Spróbuj ponownie."
          });
        }

        if (!entry.approved) {
          return sendJson(res, 200, {
            ok: true,
            approved: false
          });
        }

        const user = ensureUser(entry.nick);
        if (entry.mode === "register") {
          user.passwordHash = entry.passwordHash;
        }
        delete db.authVerifications[key];
        saveDb();

        return sendJson(res, 200, {
          ok: true,
          approved: true,
          user: {
            nick: user.nick,
            balance: user.balance,
            totalDeposited: user.totalDeposited
          }
        });
      }

      if (req.url === "/api/pending") {
        const nick = String(data.nick || "").trim();
        const amount = Math.floor(Number(data.amount) || 0);
        if (!nick) {
          return sendJson(res, 400, { ok: false, error: "Brak nicku" });
        }
        if (amount <= 0) {
          return sendJson(res, 400, { ok: false, error: "Wpisz kwotę większą od 0." });
        }
        db.pending[nick.toLowerCase()] = { nick, amount };
        saveDb();
        return sendJson(res, 200, { ok: true, amount });
      }

      if (req.url === "/api/withdraw") {
        const key = String(data.nick || "").trim().toLowerCase();
        const password = String(data.password || "");
        const amount = Math.floor(Number(data.amount) || 0);
        const user = db.users[key];

        if (!user || !user.passwordHash || hashPassword(password) !== user.passwordHash) {
          return sendJson(res, 401, { ok: false, error: "Zaloguj się ponownie." });
        }
        if (amount <= 0 || user.balance < amount) {
          return sendJson(res, 400, { ok: false, error: "Za małe saldo do wypłaty." });
        }

        user.balance -= amount;
        db.withdraws.unshift({
          id: Date.now(),
          nick: user.nick,
          amount,
          status: "OCZEKUJE"
        });
        saveDb();
        return sendJson(res, 200, {
          ok: true,
          user: {
            nick: user.nick,
            balance: user.balance,
            totalDeposited: user.totalDeposited
          }
        });
      }

      if (data.pass !== PASS) {
        return sendJson(res, 403, { error: "Brak dostepu" });
      }

      if (req.url === "/api/approve-auth") {
        const key = String(data.key || "").trim().toLowerCase();
        if (db.authVerifications[key]) {
          db.authVerifications[key].approved = true;
          saveDb();
        }
      } else if (req.url === "/api/deposit") {
        addBalance(data.nick, data.amount);
      } else if (req.url === "/api/save-user") {
        upsertUser(data.nick, data.balance, data.totalDeposited);
      } else if (req.url === "/api/delete-user") {
        deleteUser(data.key);
      } else if (req.url === "/api/simulate-send") {
        simulateSend(data.nick, data.amount, Boolean(data.instant));
      } else if (req.url === "/api/approve") {
        const item = db.pending[String(data.key || "").toLowerCase()];
        if (item) addBalance(item.nick, item.amount);
      } else if (req.url === "/api/done-withdraw") {
        const w = db.withdraws.find(x => x.id === data.id);
        if (w) {
          w.status = "WYPLACONO";
          saveDb();
        }
      } else if (req.url === "/api/interest") {
        Object.values(db.users).forEach(u => {
          if (u.balance > 0) u.balance = Math.floor(u.balance * 1.1);
        });
        saveDb();
      }

      return sendJson(res, 200, { ok: true });
    });
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("Bank Nezzi dziala na porcie", PORT);
});
