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
const warm = c => c.color === "แดง" || c.color === "เหลือง", PRIME = [2, 3, 5, 7];
const cyc = (arr, k) => (c, p) => has(c, p, () => (arr.indexOf(c[k]) - arr.indexOf(p[k]) + arr.length) % arr.length === 1);
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
  L(3, "sum5", "ผลรวมเลขกับใบก่อนหน้ามากกว่า 10", (c, p) => has(c, p, () => c.number + p.number > 10)),
  L(3, "sum6", "ผลรวมเลขกับใบก่อนหน้าไม่เกิน 11", (c, p) => has(c, p, () => c.number + p.number <= 11)),
  L(3, "uno", "สีเหมือนใบก่อนหน้า หรือเลขเหมือนใบก่อนหน้า", (c, p) => has(c, p, () => c.color === p.color || c.number === p.number)),
  // ===== กฎระดับยากเพิ่มเติม =====
  L(3, "div3", "เลขหาร 3 ลงตัว (3, 6, 9)", c => c.number % 3 === 0),
  L(3, "prime", "เลขจำนวนเฉพาะ (2, 3, 5, 7)", c => PRIME.includes(c.number)),
  L(3, "nprime", "เลขที่ไม่ใช่จำนวนเฉพาะ", c => !PRIME.includes(c.number)),
  L(3, "sq", "เลขกำลังสอง (1, 4, 9)", c => [1, 4, 9].includes(c.number)),
  ...[["แดง", "ดาว"], ["น้ำเงิน", "วงกลม"], ["เขียว", "สามเหลี่ยม"], ["เหลือง", "สี่เหลี่ยม"]].map(([x, y]) => L(3, "cs" + x, `ไพ่สี${x} หรือรูป${y}`, c => c.color === x || c.shape === y)),
  ...[["แดง", "แมว"], ["น้ำเงิน", "กบ"], ["เขียว", "จิ้งจอก"], ["เหลือง", "แพนด้า"]].map(([x, y]) => L(3, "ci" + x, `ไพ่ห้ามเป็นสี${x} และห้ามเป็นตัว${y}`, c => c.color !== x && c.icon !== y)),
  L(3, "both", "สีและสัตว์ต้องต่างจากใบก่อนหน้าทั้งคู่", (c, p) => has(c, p, () => c.color !== p.color && c.icon !== p.icon)),
  L(3, "both2", "สีและรูปทรงต้องต่างจากใบก่อนหน้าทั้งคู่", (c, p) => has(c, p, () => c.color !== p.color && c.shape !== p.shape)),
  L(3, "wc", "สลับสีโทนร้อน (แดง/เหลือง) กับโทนเย็น (น้ำเงิน/เขียว) กับใบก่อนหน้า", (c, p) => has(c, p, () => warm(c) !== warm(p))),
  L(3, "hl", "สลับเลขสูง (6–10) กับเลขต่ำ (1–5) กับใบก่อนหน้า", (c, p) => has(c, p, () => (c.number > 5) !== (p.number > 5))),
  L(3, "sum3", "ผลรวมเลขกับใบก่อนหน้าหาร 3 ลงตัว", (c, p) => has(c, p, () => (c.number + p.number) % 3 === 0)),
  L(3, "cond1", "ถ้าใบก่อนหน้าเป็นเลขคี่ ใบนี้ต้องสีร้อน (แดง/เหลือง) ถ้าเป็นเลขคู่ ใบนี้ต้องสีเย็น (น้ำเงิน/เขียว)", (c, p) => has(c, p, () => p.number % 2 === 1 ? warm(c) : !warm(c))),
  L(3, "cond2", "ถ้าใบก่อนหน้าเป็นสีร้อน ใบนี้ต้องเลขคี่ ถ้าเป็นสีเย็น ใบนี้ต้องเลขคู่", (c, p) => has(c, p, () => warm(p) ? c.number % 2 === 1 : c.number % 2 === 0)),
  L(3, "cond3", "ถ้าใบก่อนหน้าเลขมากกว่า 5 ใบนี้ต้องสีเดียวกับใบก่อนหน้า ถ้าไม่ ใบนี้ต้องสีต่างจากใบก่อนหน้า", (c, p) => has(c, p, () => p.number > 5 ? c.color === p.color : c.color !== p.color)),
  L(3, "cycc", "สีต้องเรียงวน แดง → น้ำเงิน → เขียว → เหลือง → แดง …", cyc(COLORS, "color")),
  L(3, "cyca", "สัตว์ต้องเรียงวน แมว → กบ → จิ้งจอก → แพนด้า → แมว …", cyc(ICONS, "icon")),
  L(3, "cycs", "รูปทรงต้องเรียงวน วงกลม → สามเหลี่ยม → สี่เหลี่ยม → ดาว → วงกลม …", cyc(SHAPES, "shape")),
  L(3, "cyc1", "เลขต้องเรียงขึ้นทีละ 1 จากใบก่อนหน้า (ถึง 10 แล้ววนกลับไป 1)", (c, p) => has(c, p, () => (c.number - p.number + 10) % 10 === 1)),
  L(3, "cycd", "เลขต้องเรียงลงทีละ 1 จากใบก่อนหน้า (ถึง 1 แล้ววนกลับไป 10)", (c, p) => has(c, p, () => (p.number - c.number + 10) % 10 === 1)),
  L(2, "cyc12", "เลขต้องเพิ่มขึ้น 1 หรือ 2 จากใบก่อนหน้า (วนกลับจาก 10 ไป 1)", (c, p) => has(c, p, () => [1, 2].includes((c.number - p.number + 10) % 10))),
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
const order = r => r.seq ? r.seq.map(id => r.players.get(id)).filter(Boolean) : [...r.players.values()]; // ลำดับเล่น (สุ่มใหม่ทุกรอบ) ทุกคนเป็นผู้เล่น บอทเป็น Rule Keeper
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
function help(r) { // ทุกคนลงไม่ผ่านติดกัน 3 รอบ → บอทวางไพ่ที่ผ่านกฎช่วย 1 ใบ
  r.fails = (r.fails || 0) + 1;
  if (r.fails < 3 * Math.max(1, order(r).filter(x => x.online).length)) return;
  const last = r.line[r.line.length - 1];
  if (!r.deck.some(c => fits(r, c, last))) r.deck.push(...makeDeck());
  const i = r.deck.findIndex(c => fits(r, c, last));
  if (i >= 0) { r.line.push(...r.deck.splice(i, 1)); say(r, "💡 ทุกคนลงไม่ผ่านมา 3 รอบแล้ว! บอทวางไพ่ที่ผ่านกฎช่วย 1 ใบ"); }
  r.fails = 0;
}
function send(r) {
  const players = order(r).map(x => ({ id: x.id, name: x.name, n: x.hand.length, online: x.online, w: x.w, l: x.l }));
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
    const ok = RULES.filter(o => !o.need || o.need(r.ctx)), D = makeDeck(), pv = i => D[(i + 7) % D.length];
    const sim = (a, b) => D.filter((c, i) => a.test(c, pv(i), r.ctx) === b.test(c, pv(i), r.ctx)).length / D.length;
    r.hist = r.hist || []; // กฎที่เคยออกในห้องนี้: ไม่ซ้ำ 8 รอบล่าสุด และไม่คล้ายกับ 3 รอบล่าสุด
    const fresh = ok.filter(o => !r.hist.slice(-8).some(q => q.id === o.id) && !r.hist.slice(-3).some(q => sim(o, q) >= 0.8));
    const tier = Math.random() < 0.5 ? 3 : 2; // ยาก 50% / กลาง 50%
    let pool = fresh.filter(o => o.lv === tier); if (!pool.length) pool = fresh.length ? fresh : ok.filter(o => o.lv === tier);
    r.fails = 0;
    r.seq = [...r.players.keys()].sort(() => Math.random() - .5); // สุ่มลำดับการเล่นใหม่ทุกรอบ
    r.rule = pool[Math.floor(Math.random() * pool.length)]; r.hist.push(r.rule); r.deck = makeDeck(); r.winner = null; r.winnerId = null; r.log = [];
    const i = r.deck.findIndex(c => fits(r, c, null)); r.line = r.deck.splice(i, 1);
    for (const q of r.players.values()) { q.hand = []; draw(r, q, 7); }
    r.phase = "playing"; r.turn = order(r)[0].id;
    say(r, `เริ่มเกม! ลำดับเล่น: ${order(r).map(x => x.name).join(" → ")}`); cb({ ok: true });
  }));

  s.on("play", act((r, p, { ids = [] }, cb) => {
    if (r.phase !== "playing" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ถึงตาคุณ" });
    const cards = ids.map(id => p.hand.find(c => c.id === id));
    if (!cards.length || cards.some(c => !c) || new Set(ids).size !== ids.length) return cb({ ok: false, error: "เลือกไพ่ไม่ถูกต้อง" });
    let prev = r.line[r.line.length - 1], ok = true;
    for (const c of cards) { if (!fits(r, c, prev)) { ok = false; break; } prev = c; }
    if (ok) {
      p.hand = p.hand.filter(c => !ids.includes(c.id)); r.line.push(...cards); r.fails = 0;
      say(r, `✅ ${p.name} วางไพ่ ${cards.length} ใบ — ผ่าน!`);
      if (!p.hand.length) toGuess(r, p); else next(r);
    } else { say(r, `❌ ${p.name} วางไพ่ ${cards.length} ใบ — ไม่ผ่าน เก็บไพ่คืน`); next(r); help(r); }
    cb({ ok: true, accepted: ok });
  }));

  s.on("trade", act((r, p, d, cb) => {
    if (r.phase !== "playing" || r.turn !== s.id) return cb({ ok: false, error: "ยังไม่ถึงตาคุณ" });
    const last = r.line[r.line.length - 1], any = p.hand.some(c => fits(r, c, last));
    if (!any) {
      const n = p.hand.length - 1; r.deck.unshift(...p.hand); p.hand = []; draw(r, p, n);
      say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ — ไม่มีใบไหนผ่านจริง! เปลี่ยนมือใหม่เหลือ ${n} ใบ`);
      if (n === 0) toGuess(r, p); else { next(r); help(r); }
    } else { const i = p.hand.findIndex(c => fits(r, c, last)); r.line.push(...p.hand.splice(i, 1)); r.fails = 0; draw(r, p, 2); say(r, `🔄 ${p.name} เปิดไพ่ทั้งมือ แต่มีใบที่ผ่านอยู่ — ลงให้ 1 ใบ จั่วใหม่ 1 ใบ และจั่วเพิ่มอีก 1 ใบ`); next(r); }
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
    r.phase = "lobby"; r.seq = null; r.line = []; r.rule = null; r.winner = null; r.log = []; r.players.forEach(x => x.hand = []);
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
