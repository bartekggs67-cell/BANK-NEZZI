const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MASTER_PASS = "7532252";
const DAY_MS = 24 * 60 * 60 * 1000;
const DATA_FILE = path.join(__dirname, "data.json");
const HTML_FILE = path.join(__dirname, "index.html");

let db = {
  users: {},
  pendingRegistrations: {},
  pending: {},
  withdraws: [],
  depositHistory: [],
  admins: []
};

try {
  if (fs.existsSync(DATA_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    db = {
      users: parsed.users || {},
      pendingRegistrations: parsed.pendingRegistrations || {},
      pending: parsed.pending || {},
      withdraws: parsed.withdraws || [],
      depositHistory: parsed.depositHistory || [],
      admins: parsed.admins || []
    };
  }
} catch (_) {}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (_) {}
}

function simpleHash(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function generateAdminCredentials() {
  let login = "";
  do {
    const len = Math.floor(Math.random() * 3) + 8; // 8-10 cyfr (max 10)
    login = "";
    for (let i = 0; i < len; i++) {
      const minDigit = i === 0 ? 1 : 0;
      login += String(Math.floor(Math.random() * (10 - minDigit)) + minDigit);
    }
  } while (db.admins.some(a => a.login === login));

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 8; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }
  return { login, password };
}

function isValidAdminAuth(data) {
  if (!data) return false;
  if (String(data.pass || "") === MASTER_PASS) return true;
  const login = String(data.adminLogin || "").trim();
  const pass = String(data.adminPassword || "");
  if (!login || !pass) return false;
  return db.admins.some(a => a.login === login && a.password === pass);
}

function isMasterAdmin(data) {
  return String((data && data.pass) || "") === MASTER_PASS;
}

function processUser24hInterest(user) {
  if (!user) return false;
  const dep = Number(user.totalDeposited || 0);
  const bal = Number(user.balance || 0);
  if (dep <= 0 && bal <= 0) {
    user.nextBonusAt = 0;
    return false;
  }

  const now = Date.now();
  if (!user.nextBonusAt) {
    user.nextBonusAt = now + DAY_MS;
    return true;
  }

  if (now >= user.nextBonusAt) {
    const overdue = now - user.nextBonusAt;
    const cycles = Math.floor(overdue / DAY_MS) + 1;
    for (let i = 0; i < cycles; i++) {
      if (user.totalDeposited > 0) {
        user.totalDeposited = Math.floor(user.totalDeposited * 1.1);
      }
      if (user.balance > 0) {
        user.balance = Math.floor(user.balance * 1.1);
      } else if (user.totalDeposited > 0) {
        user.balance = Math.floor(user.totalDeposited * 1.1);
      }
    }
    user.nextBonusAt += cycles * DAY_MS;
    return true;
  }
  return false;
}

function checkAllUsers24h() {
  let changed = false;
  Object.values(db.users || {}).forEach(u => {
    if (processUser24hInterest(u)) changed = true;
  });
  if (changed) saveDb();
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
      passwordHash: "",
      nextBonusAt: 0
    };
  } else if (!db.users[key].nick) {
    db.users[key].nick = cleanNick;
  }
  return db.users[key];
}

function recordDeposit(nick, amount, note) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  const value = Math.floor(Number(amount) || 0);
  if (!key || value <= 0) return;

  const user = ensureUser(cleanNick);
  const wasZero = Number(user.totalDeposited || 0) <= 0 && Number(user.balance || 0) <= 0;
  user.balance = Number(user.balance || 0) + value;
  user.totalDeposited = Number(user.totalDeposited || 0) + value;

  if (wasZero || !user.nextBonusAt) {
    user.nextBonusAt = Date.now() + DAY_MS;
  }

  db.depositHistory.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    nick: user.nick,
    amount: value,
    note: note || "Wpłata",
    createdAt: Date.now()
  });

  delete db.pending[key];
  saveDb();
}

function upsertUser(nick, balance, totalDeposited) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  if (!key) return;

  const existing = db.users[key];
  const newBal = Math.max(0, Math.floor(Number(balance) || 0));
  const newDep = Math.max(0, Math.floor(Number(totalDeposited) || 0));

  db.users[key] = {
    nick: cleanNick,
    balance: newBal,
    totalDeposited: newDep,
    passwordHash: existing ? existing.passwordHash || "" : "",
    nextBonusAt:
      newBal > 0 || newDep > 0
        ? (existing && existing.nextBonusAt ? existing.nextBonusAt : Date.now() + DAY_MS)
        : 0
  };
  saveDb();
}

function deleteUser(key) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return;
  delete db.users[k];
  delete db.pending[k];
  delete db.pendingRegistrations[k];
  saveDb();
}

function getPublicState() {
  checkAllUsers24h();
  const now = Date.now();
  const safeUsers = {};
  for (const [k, u] of Object.entries(db.users || {})) {
    const nextAt = Number(u.nextBonusAt || 0);
    safeUsers[k] = {
      nick: u.nick,
      balance: Number(u.balance || 0),
      totalDeposited: Number(u.totalDeposited || 0),
      nextBonusAt: nextAt,
      remainingMs: nextAt > now ? nextAt - now : 0
    };
  }
  const safeRegs = {};
  for (const [k, r] of Object.entries(db.pendingRegistrations || {})) {
    safeRegs[k] = {
      nick: r.nick,
      amount: r.amount,
      approved: Boolean(r.approved),
      createdAt: r.createdAt || 0
    };
  }
  return {
    users: safeUsers,
    pendingRegistrations: safeRegs,
    pending: db.pending || {},
    withdraws: db.withdraws || [],
    depositHistory: db.depositHistory || []
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
  try {
    checkAllUsers24h();

    if (req.method === "GET" && req.url === "/") {
      if (!fs.existsSync(HTML_FILE)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end("<h1>Bank banansmp.pl</h1><p>Brak pliku index.html.</p>");
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(HTML_FILE).pipe(res);
    }

    if (req.method === "GET" && req.url === "/api/state") {
      return sendJson(res, 200, getPublicState());
    }

    if (req.method === "POST") {
      return readBody(req, data => {
        // KROK 1 REJESTRACJI: nick + haslo + potwierdz haslo -> losuje /pay NezziBG 67-1000
        if (req.url === "/api/register-start") {
          const cleanNick = String(data.nick || "").trim();
          const key = cleanNick.toLowerCase();
          const password = String(data.password || "");
          const confirmPassword = String(data.confirmPassword || "");

          if (!cleanNick) {
            return sendJson(res, 400, { ok: false, error: "Podaj nick z gry." });
          }
          if (password.length < 4) {
            return sendJson(res, 400, { ok: false, error: "Hasło musi mieć minimum 4 znaki." });
          }
          if (password !== confirmPassword) {
            return sendJson(res, 400, { ok: false, error: "Hasła nie są takie same." });
          }

          const existing = db.users[key];
          if (existing && existing.passwordHash) {
            return sendJson(res, 400, {
              ok: false,
              error: "Ten nick jest już zarejestrowany — kliknij Zaloguj."
            });
          }

          const amount = Math.floor(Math.random() * (1000 - 67 + 1)) + 67;
          const token = String(Date.now()) + "_" + Math.floor(Math.random() * 100000);

          db.pendingRegistrations[key] = {
            nick: existing ? existing.nick : cleanNick,
            passwordHash: simpleHash(password),
            amount,
            token,
            approved: false,
            createdAt: Date.now()
          };
          saveDb();

          return sendJson(res, 200, {
            ok: true,
            nick: db.pendingRegistrations[key].nick,
            amount,
            token
          });
        }

        // KROK 2 REJESTRACJI: sprawdza czy przelew /pay NezziBG <67-1000> zostal zatwierdzony
        if (req.url === "/api/register-check") {
          const cleanNick = String(data.nick || "").trim();
          const key = cleanNick.toLowerCase();
          const token = String(data.token || "");
          const reg = db.pendingRegistrations[key];

          if (!reg || reg.token !== token) {
            return sendJson(res, 400, {
              ok: false,
              error: "Sesja rejestracji wygasła. Kliknij Zarejestruj się ponownie."
            });
          }

          if (!reg.approved) {
            return sendJson(res, 200, { ok: true, approved: false });
          }

          const user = ensureUser(reg.nick);
          user.passwordHash = reg.passwordHash;
          const depositAmount = reg.amount;
          delete db.pendingRegistrations[key];
          recordDeposit(user.nick, depositAmount, "Rejestracja /pay");

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

        // LOGOWANIE DO ISTNIEJACEGO KONTA
        if (req.url === "/api/login") {
          const cleanNick = String(data.nick || "").trim();
          const key = cleanNick.toLowerCase();
          const password = String(data.password || "");

          if (!cleanNick || !password) {
            return sendJson(res, 400, { ok: false, error: "Podaj nick i hasło." });
          }

          const existing = db.users[key];
          if (!existing || !existing.passwordHash) {
            return sendJson(res, 400, {
              ok: false,
              error: "Nie ma jeszcze takiego konta — kliknij Zarejestruj się."
            });
          }

          if (existing.passwordHash !== simpleHash(password)) {
            return sendJson(res, 401, { ok: false, error: "Nieprawidłowe hasło." });
          }

          return sendJson(res, 200, {
            ok: true,
            user: {
              nick: existing.nick,
              balance: existing.balance,
              totalDeposited: existing.totalDeposited
            }
          });
        }

        // GENEROWANIE WPLATY PRZEZ GRACZA
        if (req.url === "/api/pending") {
          const nick = String(data.nick || "").trim();
          const amount = Math.floor(Number(data.amount) || 0);
          if (!nick) {
            return sendJson(res, 400, { ok: false, error: "Brak nicku." });
          }
          if (amount <= 0) {
            return sendJson(res, 400, { ok: false, error: "Wpisz kwotę większą od 0." });
          }
          db.pending[nick.toLowerCase()] = { nick, amount };
          saveDb();
          return sendJson(res, 200, { ok: true, amount });
        }

        // WYPLATA SRODKOW
        if (req.url === "/api/withdraw") {
          const key = String(data.nick || "").trim().toLowerCase();
          const password = String(data.password || "");
          const amount = Math.floor(Number(data.amount) || 0);
          const user = db.users[key];

          if (!user || !user.passwordHash || user.passwordHash !== simpleHash(password)) {
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

        // LOGOWANIE DO PANELU ADMINA (haslo glowne lub wygenerowane konto admina)
        if (req.url === "/api/admin-login") {
          if (!isValidAdminAuth(data)) {
            return sendJson(res, 403, { ok: false, error: "Błędny login lub hasło admina." });
          }
          return sendJson(res, 200, {
            ok: true,
            isMaster: isMasterAdmin(data),
            admins: isMasterAdmin(data) ? db.admins : []
          });
        }

        if (!isValidAdminAuth(data)) {
          return sendJson(res, 403, { ok: false, error: "Brak dostępu admina." });
        }

        if (req.url === "/api/approve-registration") {
          const key = String(data.key || "").trim().toLowerCase();
          if (db.pendingRegistrations[key]) {
            db.pendingRegistrations[key].approved = true;
            saveDb();
          }
        } else if (req.url === "/api/approve") {
          const item = db.pending[String(data.key || "").toLowerCase()];
          if (item) recordDeposit(item.nick, item.amount, "Wpłata /pay");
        } else if (req.url === "/api/simulate-send") {
          const cleanNick = String(data.nick || "").trim();
          const amount = Math.floor(Number(data.amount) || 0);
          if (cleanNick && amount > 0) {
            if (data.instant) {
              recordDeposit(cleanNick, amount, "Wpłata /pay");
            } else {
              db.pending[cleanNick.toLowerCase()] = { nick: cleanNick, amount };
              saveDb();
            }
          }
        } else if (req.url === "/api/save-user") {
          upsertUser(data.nick, data.balance, data.totalDeposited);
        } else if (req.url === "/api/delete-user") {
          deleteUser(data.key);
        } else if (req.url === "/api/done-withdraw") {
          const w = db.withdraws.find(x => x.id === data.id);
          if (w) {
            w.status = "WYPLACONO";
            saveDb();
          }
        } else if (req.url === "/api/interest") {
          Object.values(db.users || {}).forEach(u => {
            if (u.totalDeposited > 0) u.totalDeposited = Math.floor(u.totalDeposited * 1.1);
            if (u.balance > 0) u.balance = Math.floor(u.balance * 1.1);
            if (u.totalDeposited > 0 || u.balance > 0) {
              u.nextBonusAt = Date.now() + DAY_MS;
            }
          });
          saveDb();
        } else if (req.url === "/api/admin-generate") {
          if (!isMasterAdmin(data)) {
            return sendJson(res, 403, { ok: false, error: "Tylko główny admin może tworzyć adminów." });
          }
          const creds = generateAdminCredentials();
          const newAdmin = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            login: creds.login,
            password: creds.password,
            createdAt: Date.now()
          };
          db.admins.unshift(newAdmin);
          saveDb();
          return sendJson(res, 200, { ok: true, admin: newAdmin, admins: db.admins });
        } else if (req.url === "/api/admin-delete") {
          if (!isMasterAdmin(data)) {
            return sendJson(res, 403, { ok: false, error: "Tylko główny admin może usuwać adminów." });
          }
          db.admins = db.admins.filter(a => a.id !== data.id);
          saveDb();
          return sendJson(res, 200, { ok: true, admins: db.admins });
        }

        return sendJson(res, 200, {
          ok: true,
          admins: isMasterAdmin(data) ? db.admins : []
        });
      });
    }

    res.writeHead(404);
    res.end("Not found");
  } catch (_) {
    res.writeHead(500);
    res.end("Server error");
  }
});

server.listen(PORT, () => {
  console.log("Bank banansmp.pl działa na porcie", PORT);
});
          
