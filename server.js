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
const pairs = a => a.flatMap((x, i) => a.slice(i + 1).map(y => [x, y]));
const NUMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], PAR = [["คี่", 1], ["คู่", 0]];
// เลขบนไพ่ = จำนวนสัตว์บนไพ่ (lv ใช้จัดกลุ่มเท่านั้น ไม่มีผลต่อการสุ่ม)
// แนวเดียวกับตัวอย่างในเกมต้นฉบับ: สีเดียว / ห้ามสี / สองสี / เลขคี่ / ตัวละครเฉพาะ / หมวดตัวละคร / ห้ามเลขเดียวกับใบก่อนหน้า
// ที่เหลือเป็นกฎเพิ่มเติมแนวเดียวกัน (สี เลข สัตว์ รูปทรง การรวมเงื่อนไข และลำดับการวาง)
const RULES = [
  L(2, "few", "ไพ่ต้องมีสัตว์ไม่เกิน 2 ตัว", c => c.number <= 2),
  ...NUMS.map(n => L(2, "nn" + n, `ไพ่ห้ามเป็นเลข ${n}`, c => c.number !== n)),
  L(2, "mid", "เลข 4–7 เท่านั้น", c => c.number >= 4 && c.number <= 7), L(2, "edge", "เลข 1 หรือ 10 เท่านั้น", c => c.number === 1 || c.number === 10),
  ...pairs(ICONS).map(([x, y]) => L(2, "ap" + x + y, `ไพ่ตัว${x}หรือตัว${y}เท่านั้น`, c => c.icon === x || c.icon === y)),
  ...SHAPES.map(x => L(2, "s" + x, `ไพ่รูป${x}เท่านั้น`, c => c.shape === x)),
  ...SHAPES.map(x => L(2, "ns" + x, `ไพ่ห้ามเป็นรูป${x}`, c => c.shape !== x)),
  ...COLORS.flatMap(x => PAR.map(([n, v]) => L(2, `c${x}${n}`, `ไพ่สี${x} และเลข${n}`, c => c.color === x && c.number % 2 === v))),
  ...ICONS.flatMap(x => PAR.map(([n, v]) => L(2, `a${x}${n}`, `ไพ่ตัว${x} และเลข${n}`, c => c.icon === x && c.number % 2 === v))),
  ...COLORS.flatMap(x => PAR.map(([n, v]) => L(3, `oc${x}${n}`, `ไพ่สี${x} หรือเลข${n}`, c => c.color === x || c.number % 2 === v))),
  ...ICONS.map(x => L(3, "oa" + x, `ไพ่ตัว${x} หรือเลขมากกว่า 3`, c => c.icon === x || c.number > 3)),
  // ลำดับการวาง: ดูใบก่อนหน้าในแถว
  L(2, "ani", "สัตว์ต้องไม่ซ้ำกับใบก่อนหน้า", (c, p) => has(c, p, () => c.icon !== p.icon)),
  L(3, "shp", "รูปทรงต้องไม่ซ้ำกับใบก่อนหน้า", (c, p) => has(c, p, () => c.shape !== p.shape)),
  L(2, "zig", "สลับเลขคู่–คี่กับใบก่อนหน้า", (c, p) => has(c, p, () => (c.number + p.number) % 2 === 1)),
  L(3, "near", "เลขต้องต่างจากใบก่อนหน้าไม่เกิน 1", (c, p) => has(c, p, () => Math.abs(c.number - p.number) <= 1)),
  L(3, "far", "เลขต้องต่างจากใบก่อนหน้าอย่างน้อย 3", (c, p) => has(c, p, () => Math.abs(c.number - p.number) >= 3)),
  L(3, "sum5", "ผลรวมเลขกับใบก่อนหน้ามากกว่า 11", (c, p) => has(c, p, () => c.number + p.number > 11)),
  L(3, "sum6", "ผลรวมเลขกับใบก่อนหน้าไม่เกิน 11", (c, p) => has(c, p, () => c.number + p.number <= 11)),
  L(3, "uno", "สีเหมือนใบก่อนหน้า หรือเลขเหมือนใบก่อนหน้า", (c, p) => has(c, p, () => c.color === p.color || c.number === p.number)),
  L(3, "year", "เลขบนไพ่ตรงกับตัวเลขในปี ค.ศ. ปัจจุบัน", (c, p, x) => x.yr.includes(String(c.number)), x => x.yr.some(d => d >= 1 && d <= 9)),
];

let uid = 0;
function makeDeck() {
  const d = [];
  for (const color of COLORS) for (const shape of SHAPES) for (const number of NUMS)
    d.push({ id: ++uid, color, shape, number, icon: ICONS[(number + SHAPES.indexOf(shape) + COLORS.indexOf(color)) % 4] });
  return d.sort(() => Math.random() - .5);
}
const code = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const find = id => [...rooms.values()].find(r => r.players.has(id));
const order = r => [...r.players.values()]; // ทุกคนเป็นผู้เล่น บอทเป็น Rule Keeper
const say = (r, m) => { r.log.push(m); if (r.log.length > 40) r.log.shift(); };
const fits = (r, c, p) => r.rule.test(c, p, r.ctx);
function draw(r, p, n) { for (let i = 0; i < n; i++) { if (!r.deck.length) r.deck = makeDeck(); p.hand.push(r.deck.pop()); } }
function next(r) {
  const o = order(r), i = o.findIndex(p => p.id === r.turn);
  for (let k = 1; k <= o.length; k++) { const p = o[(i + k) % o.length]; if (p.online) { r.turn = p.id; return; } }
}
function toGuess(r, p) { // ตัวเลือก 3 ข้อ: กฎจริง + ตัวหลอก 2 ข้อที่ "พฤติกรรมใกล้เคียงกฎจริงที่สุด" (แต่ไม่เหมือนกันทุกกรณี)
  const D = makeDeck(), pv = i => D[(i + 7) % D.length];
  const agree = o => D.filter((c, i) => fits(r, c, pv(i)) === o.test(c, pv(i), r.ctx)).length;
  const pool = RULES.filter(o => o.id !== r.rule.id && (!o.need || o.need(r.ctx))).sort(() => Math.random() - .5)
    .map(o => ({ o, s: agree(o) })).filter(x => x.s < D.length).sort((a, b) => b.s - a.s);
  r.choices = [r.rule, ...pool.slice(0, 2).map(x => x.o)].sort(() => Math.random() - .5).map(o => ({ id: o.id, label: o.label }));
  r.phase = "guess"; say(r, `🃏 ${p.name} ไพ่หมดมือ! ถึงเวลาทายกฎ`);
}
function send(r) {
  const players = [...r.players.values()].map(x => ({ id: x.id, name: x.name, n: x.hand.length, online: x.online, w: x.w, l: x.l }));
  for (const p of r.players.values()) io.to(p.id).emit("state", {
    code: r.code, phase: r.phase, hostId: r.hostId, me: p.id, turn: r.turn, winner: r.winner,
    players, line: r.line, log: r.log.slice(-6), hand: p.hand, deck: r.deck.length,
    rule: r.rule && r.phase === "ended" ? r.rule.label : null,
    choices: r.phase === "guess" && r.turn === p.id ? r.choices : [],
  });
}

io.on("connection", s => {
  const mk = n => ({ id: s.id, name: (n || "ผู้เล่น").slice(0, 16), hand: [], online: true, w: 0, l: 0 });
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
    if (r.hostId !== s.id) return cb({ ok: false, error: "เฉพาะเจ้าของห้องเริ่มเกมได้" });
    const dig = t => [...String(t)].filter(ch => /\d/.test(ch)).map(Number), now = new Date();
    r.ctx = { yr: dig(now.getFullYear()).map(String) };
    const pool = RULES.filter(o => !o.need || o.need(r.ctx));  // สุ่มจากทุกกฎเท่าๆ กัน
    r.rule = pool[Math.floor(Math.random() * pool.length)]; r.deck = makeDeck(); r.winner = null; r.winnerId = null; r.log = [];
    const i = r.deck.findIndex(c => fits(r, c, null)); r.line = r.deck.splice(i, 1);
    for (const q of r.players.values()) { q.hand = []; draw(r, q, 7); }
    r.phase = "playing"; r.turn = order(r)[0].id;
    say(r, `เริ่มเกม! Rule Keeper วางไพ่ใบแรกที่ตรงกับกฎลับแล้ว`); cb({ ok: true });
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
    } else { const i = p.hand.findIndex(c => fits(r, c, last)); r.line.push(...p.hand.splice(i, 1)); draw(r, p, 2); say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ แต่มีใบที่ผ่านอยู่ — ลงให้ 1 ใบ จั่วใหม่ 1 ใบ และจั่วเพิ่มอีก 1 ใบ`); next(r); }
    cb({ ok: true, accepted: !any });
  }));

  s.on("guess", act((r, p, { id }, cb) => {
    if (r.phase !== "guess" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ใช่ตาทายของคุณ" });
    if (id === r.rule.id) { r.phase = "ended"; r.winner = p.name; r.winnerId = p.id; r.players.forEach(q => q.id === p.id ? q.w++ : q.l++); say(r, `🏆 ${p.name} ทายถูก!`); return cb({ ok: true, accepted: true }); }
    say(r, `🤔 ${p.name} ทายผิด! ส่งต่อให้คนถัดไปทาย`);
    next(r); cb({ ok: true, accepted: false });
  }));

  s.on("restart", act((r, p, d, cb) => {
    if (r.phase !== "ended") return cb({ ok: false });
    if (!r.players.get(r.hostId)?.online) r.hostId = [...r.players.values()].find(x => x.online)?.id || r.hostId; // เจ้าของห้องหลุด → โอนให้คนที่ยังอยู่
    r.phase = "lobby"; r.line = []; r.rule = null; r.winner = null; r.log = []; r.players.forEach(x => x.hand = []);
    say(r, "รอบใหม่! บอทยังเป็น Rule Keeper ให้เหมือนเดิม"); cb({ ok: true });
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
