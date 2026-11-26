const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PASS = "7532252";
const DATA_FILE = path.join(__dirname, "data.json");
const HTML_FILE = path.join(__dirname, "index.html");

let db = { users: {}, pending: {}, withdraws: [] };

if (fs.existsSync(DATA_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (_) {}
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (_) {}
}

function addBalance(nick, amount) {
  const cleanNick = String(nick || "").trim();
  const key = cleanNick.toLowerCase();
  const value = Math.floor(Number(amount) || 0);
  if (!key || value <= 0) return;

  if (!db.users[key]) {
    db.users[key] = { nick: cleanNick, balance: 0, totalDeposited: 0 };
  }
  db.users[key].balance += value;
  db.users[key].totalDeposited += value;
  delete db.pending[key];
  saveDb();
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

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(HTML_FILE).pipe(res);
  }

  if (req.method === "GET" && req.url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(db));
  }

  if (req.method === "POST") {
    return readBody(req, data => {
      if (req.url === "/api/pending") {
        const nick = String(data.nick || "").trim();
        if (!nick) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Brak nicku" }));
        }
        const amount = Math.floor(Math.random() * 400) + 101;
        db.pending[nick.toLowerCase()] = { nick, amount };
        saveDb();
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ amount }));
      }

      if (req.url === "/api/withdraw") {
        const key = String(data.nick || "").trim().toLowerCase();
        const amount = Math.floor(Number(data.amount) || 0);
        const user = db.users[key];
        if (user && amount > 0 && user.balance >= amount) {
          user.balance -= amount;
          db.withdraws.unshift({
            id: Date.now(),
            nick: user.nick,
            amount,
            status: "OCZEKUJE"
          });
          saveDb();
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
      }

      if (data.pass !== PASS) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Brak dostepu" }));
      }

      if (req.url === "/api/deposit") {
        addBalance(data.nick, data.amount);
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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log("Bank Nezzi dziala na porcie", PORT);
});
