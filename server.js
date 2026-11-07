const express = require("express"), http = require("http"), crypto = require("crypto");
const { Server } = require("socket.io");
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.static(__dirname));

const rooms = new Map();
const COLORS = ["แดง", "น้ำเงิน", "เขียว", "เหลือง"];
const SHAPES = ["วงกลม", "สามเหลี่ยม", "สี่เหลี่ยม", "ดาว"];
const ICONS = ["แมว", "กบ", "จิ้งจอก", "แพนด้า"];
const R = (id, label, test) => ({ id, label, test });
// test(การ์ดที่วาง, การ์ดใบก่อนหน้า) — กฎแบบ "ลำดับ" ใช้ใบก่อนหน้าด้วย
const RULES = [
  ...COLORS.map(x => R("c" + x, `ไพ่สี${x}เท่านั้น`, c => c.color === x)),
  ...SHAPES.map(x => R("s" + x, `ไพ่รูป${x}เท่านั้น`, c => c.shape === x)),
  ...ICONS.map(x => R("a" + x, `ไพ่ตัว${x}เท่านั้น`, c => c.icon === x)),
  R("even", "เลขคู่เท่านั้น", c => c.number % 2 === 0),
  R("odd", "เลขคี่เท่านั้น", c => c.number % 2 === 1),
  R("high", "เลข 4 ขึ้นไปเท่านั้น", c => c.number >= 4),
  R("low", "เลข 1–3 เท่านั้น", c => c.number <= 3),
  R("alt", "สีต้องไม่ซ้ำกับใบก่อนหน้า", (c, p) => !p || c.color !== p.color),
  R("up", "เลขต้องไม่น้อยกว่าใบก่อนหน้า", (c, p) => !p || c.number >= p.number),
  R("shp", "รูปทรงต้องต่างจากใบก่อนหน้า", (c, p) => !p || c.shape !== p.shape),
];

function makeDeck() {
  const d = []; let id = 0;
  for (const color of COLORS) for (const shape of SHAPES) for (const number of [1, 2, 3, 4, 5])
    d.push({ id: ++id, color, shape, number, icon: ICONS[(number + SHAPES.indexOf(shape) + COLORS.indexOf(color)) % 4] });
  return d.sort(() => Math.random() - .5);
}
const code = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const find = id => [...rooms.values()].find(r => r.players.has(id));
const order = r => [...r.players.values()].filter(p => p.id !== r.hostId);
const say = (r, m) => { r.log.push(m); if (r.log.length > 40) r.log.shift(); };
function draw(r, p, n) { for (let i = 0; i < n; i++) { if (!r.deck.length) r.deck = makeDeck(); p.hand.push(r.deck.pop()); } }
function next(r) {
  const o = order(r), i = o.findIndex(p => p.id === r.turn);
  for (let k = 1; k <= o.length; k++) { const p = o[(i + k) % o.length]; if (p.online) { r.turn = p.id; return; } }
}
function send(r) {
  const players = [...r.players.values()].map(x => ({ id: x.id, name: x.name, n: x.hand.length, online: x.online }));
  for (const p of r.players.values()) io.to(p.id).emit("state", {
    code: r.code, phase: r.phase, hostId: r.hostId, me: p.id, turn: r.turn, winner: r.winner,
    players, line: r.line, log: r.log.slice(-6), hand: p.hand, deck: r.deck.length,
    rule: r.rule && (p.id === r.hostId || r.phase === "ended") ? r.rule.label : null,
    rules: RULES.map(x => ({ id: x.id, label: x.label })),
  });
}

io.on("connection", s => {
  const mk = n => ({ id: s.id, name: (n || "ผู้เล่น").slice(0, 16), hand: [], online: true });
  s.on("create", ({ name }, cb) => {
    const r = { code: code(), hostId: s.id, players: new Map(), phase: "lobby", deck: [], line: [], rule: null, log: [], turn: null, winner: null };
    r.players.set(s.id, mk(name)); rooms.set(r.code, r); s.join(r.code); cb({ ok: true }); send(r);
  });
  s.on("join", ({ code: c, name }, cb) => {
    const r = rooms.get((c || "").trim().toUpperCase());
    if (!r) return cb({ ok: false, error: "ไม่พบห้องนี้" });
    if (r.phase !== "lobby") return cb({ ok: false, error: "เกมเริ่มแล้ว เข้าร่วมไม่ได้" });
    if (r.players.size >= 8) return cb({ ok: false, error: "ห้องเต็มแล้ว (สูงสุด 8 คน)" });
    r.players.set(s.id, mk(name)); s.join(r.code); say(r, `${mk(name).name} เข้าห้อง`); cb({ ok: true }); send(r);
  });
  const act = fn => (d, cb) => { const r = find(s.id); if (!r) return; fn(r, r.players.get(s.id), d || {}, cb || (() => { })); send(r); };

  s.on("start", act((r, p, d, cb) => {
    if (r.hostId !== s.id) return cb({ ok: false, error: "เฉพาะเจ้าของห้อง (Rule Keeper) เริ่มเกมได้" });
    if (r.players.size < 2) return cb({ ok: false, error: "ต้องมีผู้เล่นอย่างน้อย 2 คน" });
    r.deck = makeDeck(); r.rule = RULES[Math.floor(Math.random() * RULES.length)]; r.winner = null; r.log = [];
    const i = r.deck.findIndex(c => r.rule.test(c, null));
    r.line = r.deck.splice(i, 1);
    for (const x of r.players.values()) { x.hand = []; if (x.id !== r.hostId) draw(r, x, 5); }
    r.phase = "playing"; r.turn = order(r)[0].id;
    say(r, "เริ่มเกม! Rule Keeper วางไพ่ใบแรกที่ตรงกับกฎลับแล้ว"); cb({ ok: true });
  }));

  s.on("play", act((r, p, { ids = [] }, cb) => {
    if (r.phase !== "playing" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ถึงตาคุณ" });
    const cards = ids.map(id => p.hand.find(c => c.id === id));
    if (!cards.length || cards.some(c => !c) || new Set(ids).size !== ids.length) return cb({ ok: false, error: "เลือกไพ่ไม่ถูกต้อง" });
    let prev = r.line[r.line.length - 1], ok = true;
    for (const c of cards) { if (!r.rule.test(c, prev)) { ok = false; break; } prev = c; }
    if (ok) {
      p.hand = p.hand.filter(c => !ids.includes(c.id)); r.line.push(...cards);
      say(r, `✅ ${p.name} วางไพ่ ${cards.length} ใบ — ผ่าน!`);
      if (!p.hand.length) { r.phase = "guess"; say(r, `🃏 ${p.name} ไพ่หมดมือ! ถึงเวลาทายกฎ`); } else next(r);
    } else { draw(r, p, 1); say(r, `❌ ${p.name} วางไพ่ ${cards.length} ใบ — ไม่ผ่าน ได้ไพ่คืน + จั่วเพิ่ม 1 ใบ`); next(r); }
    cb({ ok: true, accepted: ok });
  }));

  s.on("trade", act((r, p, d, cb) => {
    if (r.phase !== "playing" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ถึงตาคุณ" });
    const last = r.line[r.line.length - 1], any = p.hand.some(c => r.rule.test(c, last));
    if (!any) { const n = p.hand.length; r.deck.unshift(...p.hand); p.hand = []; draw(r, p, n); say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ — ไม่มีใบไหนผ่านจริง! เปลี่ยนไพ่ใหม่ ${n} ใบ`); }
    else { draw(r, p, 1); say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ แต่มีใบที่ผ่านอยู่ — จั่วเพิ่ม 1 ใบ`); }
    next(r); cb({ ok: true, accepted: !any });
  }));

  s.on("guess", act((r, p, { id }, cb) => {
    if (r.phase !== "guess" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ใช่ตาทายของคุณ" });
    if (id === r.rule.id) { r.phase = "ended"; r.winner = p.name; say(r, `🏆 ${p.name} ทายถูก! กฎคือ “${r.rule.label}”`); cb({ ok: true, accepted: true }); }
    else { draw(r, p, 2); r.phase = "playing"; say(r, `🤔 ${p.name} ทายผิด! รับไพ่เพิ่ม 2 ใบ แล้วเล่นต่อ`); next(r); cb({ ok: true, accepted: false }); }
  }));

  s.on("restart", act((r, p, d, cb) => {
    if (r.hostId !== s.id) return cb({ ok: false, error: "เฉพาะเจ้าของห้องเท่านั้น" });
    r.phase = "lobby"; r.line = []; r.rule = null; r.winner = null; r.log = []; r.players.forEach(x => x.hand = []); cb({ ok: true });
  }));

  s.on("disconnect", () => {
    const r = find(s.id); if (!r) return;
    const p = r.players.get(s.id);
    if (r.phase === "lobby") r.players.delete(s.id); else { p.online = false; say(r, `${p.name} หลุดการเชื่อมต่อ`); if (r.turn === s.id) next(r); }
    send(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game running on ${PORT}`));
