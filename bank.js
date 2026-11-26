const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PASS = "7532252";
const DATA = path.join(__dirname, "data.json");

let state = { users: {}, pending: {}, withdraws: [] };
try {
  if (fs.existsSync(DATA)) state = JSON.parse(fs.readFileSync(DATA, "utf8"));
} catch (_) {}

const save = () => {
  try {
    fs.writeFileSync(DATA, JSON.stringify(state, null, 2), "utf8");
  } catch (_) {}
};

function credit(nick, amt) {
  const k = (nick || "").trim().toLowerCase();
  const n = Math.floor(Number(amt) || 0);
  if (!k || n <= 0) return;
  if (!state.users[k]) {
    state.users[k] = { nick: nick.trim(), balance: 0, totalDeposited: 0 };
  }
  state.users[k].balance += n;
  state.users[k].totalDeposited += n;
  delete state.pending[k];
  save();
}

const HTML = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Bank Nezzi</title>
<style>
  *{box-sizing:border-box;font-family:Arial,sans-serif}
  body{margin:0;background:#090d16;color:#f1f5f9;padding:16px}
  .wrap{max-width:860px;margin:0 auto}
  .card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:18px;margin-bottom:16px}
  h1,h2{margin:0 0 10px 0}
  .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  input{background:#090d16;color:#fff;border:1px solid #334155;border-radius:10px;padding:10px 12px;font-size:14px}
  button{border:0;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;font-size:14px}
  .btn-blue{background:#38bdf8;color:#082f49}
  .btn-gray{background:#1e293b;color:#f8fafc;border:1px solid #334155}
  .btn-green{background:#22c55e;color:#052e16}
  .btn-amber{background:#fbbf24;color:#451a03}
  .box{margin-top:12px;padding:12px;border-radius:12px;background:#090d16;border:1px solid #1e293b;display:none}
  .cmd{color:#4ade80;font-weight:700;font-family:monospace;font-size:15px}
  .item{display:flex;justify-content:space-between;align-items:center;background:#090d16;border:1px solid #1e293b;padding:10px 12px;border-radius:10px;margin-top:8px;font-size:13px}
  .muted{color:#94a3b8;font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div>
        <h1>Bank <span style="color:#38bdf8">Nezzi</span></h1>
        <div class="muted">Konto w grze: <b>NezziBG</b> • Zysk: <b style="color:#4ade80">+10%</b></div>
      </div>
      <a href="#admin" style="color:#38bdf8;text-decoration:none;font-weight:700;font-size:13px">Panel Admina ↓</a>
    </div>
  </div>

  <div class="card">
    <h2>Wpłaty i konto gracza</h2>
    <div class="muted">Wpisz nick z Minecrafta, wygeneruj komendę /pay na konto <b>NezziBG</b> albo sprawdź swoje saldo.</div>
    <div class="row">
      <input id="nick" placeholder="Twój nick z Minecraft..." style="flex:1;min-width:180px">
      <button class="btn-blue" onclick="genPay()">Generuj /pay</button>
      <button class="btn-gray" onclick="showUser()">Sprawdź konto</button>
    </div>
    <div id="cmdBox" class="box"></div>
    <div id="userBox" class="box">
      <div class="row" style="justify-content:space-between;align-items:center;margin-top:0">
        <div>Gracz <b id="uNick"></b> — Saldo: <b id="uBal" style="color:#4ade80;font-size:18px">0 $</b></div>
        <div class="row" style="margin-top:0">
          <input id="wAmt" type="number" placeholder="Kwota" min="1" style="width:110px">
          <button class="btn-amber" onclick="askW()">Wypłać</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Lista wpłacających</h2>
    <div id="list" class="muted">Ładowanie...</div>
  </div>

  <div class="card" id="admin">
    <h2 style="color:#38bdf8">Panel Admina</h2>
    <div id="lockBox" class="row">
      <input id="pass" type="password" placeholder="Hasło admina">
      <button class="btn-blue" onclick="loginAdm()">Odblokuj</button>
    </div>
    <div id="admBox" style="display:none">
      <div class="row">
        <button class="btn-green" onclick="api('/api/interest',{})">+10% wszystkim</button>
        <input id="mNick" placeholder="Nick" style="width:150px">
        <input id="mAmt" type="number" placeholder="Kwota" style="width:110px">
        <button class="btn-blue" onclick="addM()">Dodaj wpłatę</button>
      </div>
      <div id="admPending"></div>
      <div id="admWithdraws"></div>
      <div id="admUsers"></div>
    </div>
  </div>
</div>

<script>
let cur = "", adm = "";

async function safeJson(url, opts) {
  try {
    const r = await fetch(url, opts);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

async function refresh() {
  const d = await safeJson("/api/state");
  if (!d || !d.users) return;

  const dep = Object.values(d.users)
    .filter(u => u.totalDeposited > 0)
    .sort((a, b) => b.totalDeposited - a.totalDeposited);

  document.getElementById("list").innerHTML = dep.length
    ? dep.map((u, i) => '<div class="item"><span>#' + (i + 1) + ' <b>' + esc(u.nick) + '</b></span><span style="color:#4ade80;font-weight:700">Wpłacono: ' + u.totalDeposited + ' $ • Saldo: ' + u.balance + ' $</span></div>').join("")
    : '<div class="muted">Brak wpłat.</div>';

  if (cur) {
    const u = d.users[cur.toLowerCase()] || { nick: cur, balance: 0 };
    document.getElementById("uNick").textContent = u.nick;
    document.getElementById("uBal").textContent = u.balance + " $";
  }

  if (adm) {
    const pend = Object.entries(d.pending || {});
    document.getElementById("admPending").innerHTML = pend.map(([k, p]) =>
      '<div class="item"><span><b>' + esc(p.nick) + '</b> — ' + p.amount + ' $</span><button class="btn-green" onclick="api(\\x27/api/approve\\x27,{key:\\x27' + esc(k) + '\\x27})">Zatwierdź</button></div>'
    ).join("");

    const wds = (d.withdraws || []).filter(w => w.status === "OCZEKUJE");
    document.getElementById("admWithdraws").innerHTML = wds.map(w =>
      '<div class="item"><span><b>/pay ' + esc(w.nick) + ' ' + w.amount + '</b></span><button class="btn-amber" onclick="api(\\x27/api/done-withdraw\\x27,{id:' + w.id + '})">Wypłacono</button></div>'
    ).join("");

    document.getElementById("admUsers").innerHTML = Object.values(d.users).map(u =>
      '<div class="item"><span><b>' + esc(u.nick) + '</b> • wpłaty: ' + u.totalDeposited + ' $ • saldo: ' + u.balance + ' $</span></div>'
    ).join("");
  }
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

async function genPay() {
  const n = document.getElementById("nick").value.trim();
  if (!n) return alert("Wpisz nick.");
  cur = n;
  const d = await safeJson("/api/pending", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nick: n })
  });
  const box = document.getElementById("cmdBox");
  box.style.display = "block";
  box.innerHTML = d && d.amount
    ? 'Wyślij w grze: <span class="cmd">/pay NezziBG ' + d.amount + '</span>'
    : 'Błąd połączenia z serwerem (odśwież za chwilę).';
}

function showUser() {
  cur = document.getElementById("nick").value.trim() || cur;
  if (!cur) return alert("Wpisz nick.");
  document.getElementById("userBox").style.display = "block";
  refresh();
}

async function askW() {
  const a = Number(document.getElementById("wAmt").value);
  if (!a || a <= 0) return;
  await safeJson("/api/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nick: cur, amount: a })
  });
  document.getElementById("wAmt").value = "";
  refresh();
}

function loginAdm() {
  const p = document.getElementById("pass").value;
  if (p !== "7532252") return alert("Złe hasło");
  adm = p;
  document.getElementById("lockBox").style.display = "none";
  document.getElementById("admBox").style.display = "block";
  refresh();
}

async function api(u, b) {
  await safeJson(u, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...b, pass: adm })
  });
  refresh();
}

function addM() {
  const n = document.getElementById("mNick").value.trim();
  const a = Number(
