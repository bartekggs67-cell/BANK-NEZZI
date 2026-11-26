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

const save = () => fs.writeFileSync(DATA, JSON.stringify(state, null, 2), "utf8");

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

const HTML = `<!DOCTYPE html><html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Bank Nezzi</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-slate-950 text-slate-100 p-4 sm:p-8"><div class="max-w-4xl mx-auto space-y-6"><header class="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 flex flex-wrap justify-between items-center gap-3"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-emerald-400 text-slate-950 font-black flex items-center justify-center text-lg">N</div><div><div class="text-2xl font-black">Bank <span class="text-sky-400">Nezzi</span></div><div class="text-xs text-slate-400">Konto w grze: <b class="text-white">NezziBG</b> • Lokata <b class="text-emerald-400">10%</b></div></div></div><a href="#admin" class="bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-xs px-4 py-2 rounded-xl">Panel Admina</a></header><section class="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-4"><h1 class="text-2xl sm:text-3xl font-black">Wpłacaj na <span class="text-sky-400">NezziBG</span> i odbieraj <span class="text-emerald-400">+10%</span></h1><div class="flex flex-wrap gap-2"><input id="nick" placeholder="Twój nick z Minecraft..." class="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-sm flex-1 min-w-[160px]"><button onclick="genPay()" class="bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold px-5 py-2.5 rounded-xl text-sm">Generuj /pay</button><button onclick="showUser()" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 font-bold px-4 py-2.5 rounded-xl text-sm">Sprawdź konto</button></div><div id="cmdBox" class="hidden bg-sky-500/10 border border-sky-500/30 rounded-2xl p-3.5 font-mono text-emerald-400 font-bold text-sm"></div><div id="userBox" class="hidden bg-slate-950 border border-slate-800 rounded-2xl p-4 flex flex-wrap justify-between items-center gap-3"><div>Gracz <b id="uNick"></b>: <span id="uBal" class="text-emerald-400 font-black text-xl font-mono">0 $</span></div><div class="flex gap-2"><input id="wAmt" type="number" placeholder="Kwota" min="1" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs w-28 font-mono"><button onclick="askW()" class="bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold px-4 py-2 rounded-xl text-xs">Wypłać</button></div></div></section><section class="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-3"><div class="flex justify-between items-center"><h2 class="font-bold text-lg">Lista wpłacających</h2><span id="depCount" class="text-xs font-bold text-sky-400 bg-sky-500/10 px-3 py-1 rounded-full">0 wpłacających</span></div><div id="list" class="space-y-2 text-xs sm:text-sm"></div></section><section id="admin" class="bg-slate-900/90 border border-sky-500/30 rounded-3xl p-6 space-y-4"><h2 class="font-bold text-lg text-sky-400">Panel Administratora</h2><div id="lockBox" class="flex flex-wrap gap-2"><input id="pass" type="password" placeholder="Hasło administratora" class="bg-slate-950 border border-slate-700 rounded-xl px-4 py-2 text-sm flex-1 min-w-[200px]"><button onclick="loginAdm()" class="bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold px-5 py-2 rounded-xl text-sm">Odblokuj panel</button></div><div id="admBox" class="hidden space-y-3 text-xs"><div class="flex flex-wrap gap-2 items-center bg-slate-950/70 p-3.5 rounded-2xl border border-slate-800"><button onclick="api('/api/interest',{})" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold px-4 py-2 rounded-xl">+ Nalicz 10% zysku</button><input id="mNick" placeholder="Nick gracza" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 flex-1 min-w-[130px]"><input id="mAmt" type="number" placeholder="Kwota $" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 w-28 font-mono"><button onclick="addM()" class="bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold px-4 py-2 rounded-xl">Dodaj wpłatę</button></div><div id="admPending" class="space-y-1.5"></div><div id="admWithdraws" class="space-y-1.5"></div><div id="admUsers" class="space-y-1.5"></div></div></section></div><script>
let cur="",adm="";
async function refresh(){const d=await(await fetch("/api/state")).json();const dep=Object.values(d.users).filter(u=>u.totalDeposited>0).sort((a,b)=>b.totalDeposited-a.totalDeposited);document.getElementById("depCount").textContent=dep.length+" wpłacających";document.getElementById("list").innerHTML=dep.length?dep.map((u,i)=>'<div class="flex justify-between items-center bg-slate-950/80 border border-slate-800 px-4 py-2.5 rounded-xl"><span>#'+(i+1)+' <b>'+u.nick+'</b></span><span class="text-emerald-400 font-mono font-bold">Wpłacono: '+u.totalDeposited+' $ • Saldo: '+u.balance+' $</span></div>'):'<div class="text-slate-500 text-xs">Brak wpłat.</div>';if(cur){const u=d.users[cur.toLowerCase()]||{nick:cur,balance:0};document.getElementById("uNick").textContent=u.nick;document.getElementById("uBal").textContent=u.balance+" $";}if(adm){document.getElementById("admPending").innerHTML=Object.entries(d.pending).map(([k,p])=>'<div class="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl"><span><b>'+p.nick+'</b> — '+p.amount+' $</span><button onclick="api(\'/api/approve\',{key:\''+k+'\'})" class="bg-emerald-500 text-slate-950 font-bold px-3 py-1 rounded-lg">Zatwierdź</button></div>').join("");document.getElementById("admWithdraws").innerHTML=d.withdraws.filter(w=>w.status==="OCZEKUJE").map(w=>'<div class="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl"><code>/pay '+w.nick+' '+w.amount+'</code><button onclick="api(\'/api/done-withdraw\',{id:'+w.id+'})" class="bg-amber-400 text-slate-950 font-bold px-3 py-1 rounded-lg">Wypłacono</button></div>').join("");document.getElementById("admUsers").innerHTML=Object.values(d.users).map(u=>'<div class="bg-slate-950 p-2.5 rounded-xl"><b>'+u.nick+'</b> • wpłaty: '+u.totalDeposited+' $ • saldo: '+u.balance+' $</div>').join("");}}
async function genPay(){const n=document.getElementById("nick").value.trim();if(!n)return alert("Wpisz nick.");cur=n;const d=await(await fetch("/api/pending",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nick:n})})).json();document.getElementById("cmdTxt").textContent="Wyślij w grze: /pay NezziBG "+d.amount;document.getElementById("cmdBox").classList.remove("hidden");}
function showUser(){cur=document.getElementById("nick").value.trim()||cur;if(!cur)return alert("Wpisz nick.");document.getElementById("userBox").classList.remove("hidden");refresh();}
async function askW(){const a=Number(document.getElementById("wAmt").value);if(!a||a<=0)return;await fetch("/api/withdraw",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({nick:cur,amount:a})});document.getElementById("wAmt").value="";refresh();}
function loginAdm(){adm=document.getElementById("pass").value;if(adm!=="7532252"){adm="";return alert("Złe hasło");}document.getElementById("lockBox").classList.add("hidden");document.getElementById("admBox").classList.remove("hidden");refresh();}
async function api(u,b){await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...b,pass:adm})});refresh();}
function addM(){api("/api/deposit",{nick:document.getElementById("mNick").value,amount:Number(document.getElementById("mAmt").value)});document.getElementById("mNick").value="";document.getElementById("mAmt").value="";}
setInterval(refresh,2000);refresh();
</script></body></html>`;

http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(state));
  }
  let raw = "";
  req.on("data", c => raw += c);
  req.on("end", () => {
    let b = {};
    try { b = raw ? JSON.parse(raw) : {}; } catch (_) {}
    if (req.method === "POST" && req.url === "/api/pending") {
      const amount = Math.floor(Math.random() * 400) + 101;
      state.pending[(b.nick || "Gracz").toLowerCase()] = { nick: b.nick || "Gracz", amount };
      save();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ amount }));
    }
    if (req.method === "POST" && req.url === "/api/withdraw") {
      const u = state.users[(b.nick || "").toLowerCase()];
      const a = Math.floor(Number(b.amount) || 0);
      if (u && a > 0 && u.balance >= a) {
        u.balance -= a;
        state.withdraws.unshift({ id: Date.now(), nick: u.nick, amount: a, status: "OCZEKUJE" });
        save();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (req.url.startsWith("/api/") && b.pass !== PASS) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (req.url === "/api/deposit") credit(b.nick, b.amount);
    if (req.url === "/api/approve") {
      const p = state.pending[b.key];
      if (p) credit(p.nick, p.amount);
    }
    if (req.url === "/api/done-withdraw") {
      const w = state.withdraws.find(x => x.id === b.id);
      if (w) { w.status = "WYPŁACONO"; save(); }
    }
    if (req.url === "/api/interest") {
      Object.values(state.users).forEach(u => {
        if (u.balance > 0) u.balance = Math.floor(u.balance * 1.10);
      });
      save();
    }
    if (req.url.startsWith("/api/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
}).listen(PORT, () => console.log("BANK NEZZI DZIALA NA PORT:", PORT));
