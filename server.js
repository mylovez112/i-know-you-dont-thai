const express = require("express"), http = require("http"), crypto = require("crypto");
const { Server } = require("socket.io");
const app = express(), server = http.createServer(app), io = new Server(server);
app.use(express.static(__dirname));

const rooms = new Map();
const COLORS = ["แดง", "น้ำเงิน", "เขียว", "เหลือง"], SHAPES = ["วงกลม", "สามเหลี่ยม", "สี่เหลี่ยม", "ดาว"], ICONS = ["แมว", "กบ", "จิ้งจอก", "แพนด้า"];
const EMO = "😂🤣😎🤔😱😭🥳🔥👏👍👎❤️🤡💀🙈🎉".match(/\p{Extended_Pictographic}\uFE0F?/gu);
const L = (lv, id, label, test, need) => ({ lv, id, label, test, need });
const has = (c, p, f) => !p || f(c, p);
// test(ไพ่ที่วาง, ใบก่อนหน้า, ctx) — lv = ระดับความยาก 1-5
const RULES = [
  ...COLORS.map(x => L(1, "c" + x, `ไพ่สี${x}เท่านั้น`, c => c.color === x)),
  ...SHAPES.map(x => L(1, "s" + x, `ไพ่รูป${x}เท่านั้น`, c => c.shape === x)),
  ...ICONS.map(x => L(1, "a" + x, `ไพ่ตัว${x}เท่านั้น`, c => c.icon === x)),
  L(1, "even", "เลขคู่เท่านั้น", c => c.number % 2 === 0), L(1, "odd", "เลขคี่เท่านั้น", c => c.number % 2 === 1),
  L(2, "high", "เลข 4 ขึ้นไปเท่านั้น", c => c.number >= 4), L(2, "low", "เลข 1–3 เท่านั้น", c => c.number <= 3),
  ...[1, 2, 3, 4, 5].map(n => L(2, "n" + n, `เลข ${n} เท่านั้น`, c => c.number === n)),
  L(2, "warm", "สีโทนร้อน (แดง/เหลือง)", c => ["แดง", "เหลือง"].includes(c.color)),
  L(2, "cool", "สีโทนเย็น (น้ำเงิน/เขียว)", c => ["น้ำเงิน", "เขียว"].includes(c.color)),
  L(2, "furry", "ไพ่สัตว์มีขน (ไม่ใช่กบ)", c => c.icon !== "กบ"),
  L(2, "edge", "เลข 1 หรือ 5 เท่านั้น", c => c.number === 1 || c.number === 5),
  ...COLORS.map(x => L(3, "nc" + x, `ไม่ใช่สี${x}`, c => c.color !== x)),
  L(3, "redstar", "สีแดงหรือรูปดาว", c => c.color === "แดง" || c.shape === "ดาว"),
  L(3, "blueeven", "สีน้ำเงินหรือเลขคู่", c => c.color === "น้ำเงิน" || c.number % 2 === 0),
  L(3, "catodd", "ไพ่แมวหรือเลขคี่", c => c.icon === "แมว" || c.number % 2 === 1),
  L(3, "greeneven", "สีเขียวหรือเลขคู่", c => c.color === "เขียว" || c.number % 2 === 0),
  L(3, "alt", "สีต้องไม่ซ้ำกับใบก่อนหน้า", (c, p) => has(c, p, () => c.color !== p.color)),
  L(3, "up", "เลขต้องไม่น้อยกว่าใบก่อนหน้า", (c, p) => has(c, p, () => c.number >= p.number)),
  L(3, "shp", "รูปทรงต้องต่างจากใบก่อนหน้า", (c, p) => has(c, p, () => c.shape !== p.shape)),
  L(4, "ani", "สัตว์ต้องต่างจากใบก่อนหน้า", (c, p) => has(c, p, () => c.icon !== p.icon)),
  L(4, "numd", "เลขต้องต่างจากใบก่อนหน้า", (c, p) => has(c, p, () => c.number !== p.number)),
  L(4, "gt", "เลขต้องมากกว่าใบก่อนหน้า (ห้ามเท่า)", (c, p) => has(c, p, () => c.number > p.number)),
  L(4, "zig", "สลับเลขคู่–คี่กับใบก่อนหน้า", (c, p) => has(c, p, () => (c.number + p.number) % 2 === 1)),
  L(4, "samec", "สีเดียวกับใบก่อนหน้า หรือเลขเท่ากัน", (c, p) => has(c, p, () => c.color === p.color || c.number === p.number)),
  L(4, "sume", "ผลรวมเลขกับใบก่อนหน้าเป็นเลขคู่", (c, p) => has(c, p, () => (c.number + p.number) % 2 === 0)),
  L(4, "sum5", "ผลรวมเลขกับใบก่อนหน้ามากกว่า 5", (c, p) => has(c, p, () => c.number + p.number > 5)),
  L(4, "sum6", "ผลรวมเลขกับใบก่อนหน้าไม่เกิน 6", (c, p) => has(c, p, () => c.number + p.number <= 6)),
  L(5, "bday", "เลขบนไพ่ตรงกับตัวเลขในวันเกิดของ Rule Keeper", (c, p, x) => x.bd.includes(String(c.number)), x => x.bd.some(d => d >= 1 && d <= 5)),
  L(5, "year", "เลขบนไพ่ตรงกับตัวเลขในปี ค.ศ. ปัจจุบัน", (c, p, x) => x.yr.includes(String(c.number)), x => x.yr.some(d => d >= 1 && d <= 5)),
  L(5, "today", "เลขบนไพ่ตรงกับตัวเลขของวันที่วันนี้", (c, p, x) => x.dy.includes(String(c.number)), x => x.dy.some(d => d >= 1 && d <= 5)),
  L(5, "np", "เลขไม่เกินจำนวนผู้เล่นในห้อง (ไม่นับ Rule Keeper)", (c, p, x) => c.number <= x.np),
  L(5, "rainbow", "เลขเท่ากับลำดับสี (แดง1 เหลือง2 เขียว3 น้ำเงิน4)", c => c.number === ["แดง", "เหลือง", "เขียว", "น้ำเงิน"].indexOf(c.color) + 1),
  L(5, "corner", "เลขเท่ากับจำนวนมุมของรูปทรง (สามเหลี่ยม3 สี่เหลี่ยม4 ดาว5)", c => c.number === { "สามเหลี่ยม": 3, "สี่เหลี่ยม": 4, "ดาว": 5 }[c.shape]),
];

let uid = 0;
function makeDeck() {
  const d = [];
  for (const color of COLORS) for (const shape of SHAPES) for (const number of [1, 2, 3, 4, 5])
    d.push({ id: ++uid, color, shape, number, icon: ICONS[(number + SHAPES.indexOf(shape) + COLORS.indexOf(color)) % 4] });
  return d.sort(() => Math.random() - .5);
}
const code = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const find = id => [...rooms.values()].find(r => r.players.has(id));
const order = r => [...r.players.values()].filter(p => p.id !== r.hostId);
const say = (r, m) => { r.log.push(m); if (r.log.length > 40) r.log.shift(); };
const fits = (r, c, p) => r.rule.test(c, p, r.ctx);
function draw(r, p, n) { for (let i = 0; i < n; i++) { if (!r.deck.length) r.deck = makeDeck(); p.hand.push(r.deck.pop()); } }
function next(r) {
  const o = order(r), i = o.findIndex(p => p.id === r.turn);
  for (let k = 1; k <= o.length; k++) { const p = o[(i + k) % o.length]; if (p.online) { r.turn = p.id; return; } }
}
function toGuess(r, p) { // ตัวเลือก 3 ข้อ: ของจริง + ตัวหลอก 2 (ไม่ซ้ำผลกับของจริง)
  const D = makeDeck().slice(0, 20), same = o => D.every(c => D.every(q => fits(r, c, q) === o.test(c, q, r.ctx)));
  const pool = RULES.filter(o => o.id !== r.rule.id && (!o.need || o.need(r.ctx)) && !same(o)).sort(() => Math.random() - .5);
  const near = pool.filter(o => Math.abs(o.lv - r.rule.lv) <= 1);
  r.choices = [r.rule, ...(near.length >= 2 ? near : pool).slice(0, 2)].sort(() => Math.random() - .5).map(o => ({ id: o.id, label: o.label }));
  r.phase = "guess"; say(r, `🃏 ${p.name} ไพ่หมดมือ! ถึงเวลาทายกฎ`);
}
function send(r) {
  const players = [...r.players.values()].map(x => ({ id: x.id, name: x.name, n: x.hand.length, online: x.online }));
  for (const p of r.players.values()) io.to(p.id).emit("state", {
    code: r.code, phase: r.phase, hostId: r.hostId, me: p.id, turn: r.turn, winner: r.winner,
    players, line: r.line, log: r.log.slice(-6), hand: p.hand, deck: r.deck.length,
    rule: r.rule && (p.id === r.hostId || r.phase === "ended") ? r.rule.label : null,
    choices: r.phase === "guess" && r.turn === p.id ? r.choices : [],
  });
}

io.on("connection", s => {
  const mk = n => ({ id: s.id, name: (n || "ผู้เล่น").slice(0, 16), hand: [], online: true });
  s.on("create", ({ name }, cb) => {
    const r = { code: code(), hostId: s.id, players: new Map(), phase: "lobby", deck: [], line: [], rule: null, log: [], turn: null, winner: null, winnerId: null };
    r.players.set(s.id, mk(name)); rooms.set(r.code, r); s.join(r.code); cb({ ok: true }); send(r);
  });
  s.on("join", ({ code: c, name }, cb) => {
    const r = rooms.get((c || "").trim().toUpperCase());
    if (!r) return cb({ ok: false, error: "ไม่พบห้องนี้" });
    if (r.phase !== "lobby") return cb({ ok: false, error: "เกมเริ่มแล้ว เข้าร่วมไม่ได้" });
    if (r.players.size >= 8) return cb({ ok: false, error: "ห้องเต็มแล้ว (สูงสุด 8 คน)" });
    r.players.set(s.id, mk(name)); s.join(r.code); say(r, `${mk(name).name} เข้าห้อง`); cb({ ok: true }); send(r);
  });
  s.on("emo", e => { const r = find(s.id); if (r && EMO.includes(e)) io.to(r.code).emit("emo", { n: r.players.get(s.id).name, e }); });
  const act = fn => (d, cb) => { const r = find(s.id); if (!r) return; fn(r, r.players.get(s.id), d || {}, cb || (() => { })); send(r); };

  s.on("start", act((r, p, d, cb) => {
    if (r.hostId !== s.id) return cb({ ok: false, error: "เฉพาะ Rule Keeper เริ่มเกมได้" });
    if (r.players.size < 2) return cb({ ok: false, error: "ต้องมีผู้เล่นอย่างน้อย 2 คน" });
    const dig = t => [...String(t)].filter(ch => /\d/.test(ch)).map(Number), now = new Date();
    r.ctx = { bd: dig(d.bd).map(String), yr: dig(now.getFullYear()).map(String), dy: dig(now.getDate()).map(String), np: r.players.size - 1 };
    const num = a => a.map(Number); r.ctx.bd = r.ctx.bd; // เก็บเป็นสตริงเพื่อใช้ includes
    const x = { ...r.ctx, bd: num(r.ctx.bd), yr: num(r.ctx.yr), dy: num(r.ctx.dy) };
    const lv = Math.min(5, Math.max(1, +d.lv || 1));
    const pool = RULES.filter(o => o.lv === lv && (!o.need || o.need(x)));
    r.rule = pool[Math.floor(Math.random() * pool.length)]; r.deck = makeDeck(); r.winner = null; r.winnerId = null; r.log = [];
    const i = r.deck.findIndex(c => fits(r, c, null)); r.line = r.deck.splice(i, 1);
    for (const q of r.players.values()) { q.hand = []; if (q.id !== r.hostId) draw(r, q, 7); }
    r.phase = "playing"; r.turn = order(r)[0].id;
    say(r, `เริ่มเกม ระดับ ${lv}! Rule Keeper วางไพ่ใบแรกที่ตรงกับกฎลับแล้ว`); cb({ ok: true });
  }));

  s.on("play", act((r, p, { ids = [] }, cb) => {
    if (r.phase !== "playing" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ถึงตาคุณ" });
    const cards = ids.map(id => p.hand.find(c => c.id === id));
    if (!cards.length || cards.some(c => !c) || new Set(ids).size !== ids.length) return cb({ ok: false, error: "เลือกไพ่ไม่ถูกต้อง" });
    let prev = r.line[r.line.length - 1], ok = true;
    for (const c of cards) { if (!fits(r, c, prev)) { ok = false; break; } prev = c; }
    if (ok) {
      p.hand = p.hand.filter(c => !ids.includes(c.id)); r.line.push(...cards);
      say(r, `✅ ${p.name} วางไพ่ ${cards.length} ใบ — ผ่าน!`);
      if (!p.hand.length) toGuess(r, p); else next(r);
    } else { say(r, `❌ ${p.name} วางไพ่ ${cards.length} ใบ — ไม่ผ่าน เก็บไพ่คืน`); next(r); }
    cb({ ok: true, accepted: ok });
  }));

  s.on("trade", act((r, p, d, cb) => {
    if (r.phase !== "playing" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ถึงตาคุณ" });
    const last = r.line[r.line.length - 1], any = p.hand.some(c => fits(r, c, last));
    if (!any) {
      const n = p.hand.length - 1; r.deck.unshift(...p.hand); p.hand = []; draw(r, p, n);
      say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ — ไม่มีใบไหนผ่านจริง! เปลี่ยนมือใหม่เหลือ ${n} ใบ`);
      if (n === 0) toGuess(r, p); else next(r);
    } else { const i = p.hand.findIndex(c => fits(r, c, last)); r.line.push(...p.hand.splice(i, 1)); draw(r, p, 1); say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ แต่มีใบที่ผ่านอยู่ — ลงให้ 1 ใบ แล้วจั่วใหม่ 1 ใบ`); next(r); }
    cb({ ok: true, accepted: !any });
  }));

  s.on("guess", act((r, p, { id }, cb) => {
    if (r.phase !== "guess" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ใช่ตาทายของคุณ" });
    if (id === r.rule.id) { r.phase = "ended"; r.winner = p.name; r.winnerId = p.id; say(r, `🏆 ${p.name} ทายถูก!`); return cb({ ok: true, accepted: true }); }
    say(r, `🤔 ${p.name} ทายผิด! ส่งต่อให้คนถัดไปทาย`);
    next(r); cb({ ok: true, accepted: false });
  }));

  s.on("restart", act((r, p, d, cb) => {
    if (r.phase !== "ended") return cb({ ok: false });
    if (r.winnerId && r.players.has(r.winnerId)) r.hostId = r.winnerId; // ผู้ชนะเป็น Rule Keeper รอบถัดไป
    r.phase = "lobby"; r.line = []; r.rule = null; r.winner = null; r.log = []; r.players.forEach(x => x.hand = []);
    say(r, `${r.players.get(r.hostId).name} เป็น Rule Keeper รอบใหม่`); cb({ ok: true });
  }));

  s.on("disconnect", () => {
    const r = find(s.id); if (!r) return;
    const p = r.players.get(s.id);
    if (r.phase === "lobby") { r.players.delete(s.id); if (r.hostId === s.id) { const f = [...r.players.keys()][0]; if (f) r.hostId = f; } }
    else { p.online = false; say(r, `${p.name} หลุดการเชื่อมต่อ`); if (r.turn === s.id) next(r); }
    send(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Game running on ${PORT}`));
