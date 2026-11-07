const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname));

const rooms = new Map();
const COLORS = ["แดง", "น้ำเงิน", "เขียว", "เหลือง"];
const SHAPES = ["วงกลม", "สามเหลี่ยม", "สี่เหลี่ยม", "ดาว"];
const ICONS = ["แมว", "จรวด", "หัวใจ", "ใบไม้"];
const RULES = [
  { id:"red", label:"ไพ่สีแดงเท่านั้น", test:c=>c.color==="แดง", hint:"สี" },
  { id:"blue", label:"ไพ่สีน้ำเงินเท่านั้น", test:c=>c.color==="น้ำเงิน", hint:"สี" },
  { id:"green", label:"ไพ่สีเขียวเท่านั้น", test:c=>c.color==="เขียว", hint:"สี" },
  { id:"yellow", label:"ไพ่สีเหลืองเท่านั้น", test:c=>c.color==="เหลือง", hint:"สี" },
  { id:"circle", label:"ไพ่รูปวงกลมเท่านั้น", test:c=>c.shape==="วงกลม", hint:"รูปทรง" },
  { id:"triangle", label:"ไพ่รูปสามเหลี่ยมเท่านั้น", test:c=>c.shape==="สามเหลี่ยม", hint:"รูปทรง" },
  { id:"square", label:"ไพ่รูปสี่เหลี่ยมเท่านั้น", test:c=>c.shape==="สี่เหลี่ยม", hint:"รูปทรง" },
  { id:"star", label:"ไพ่รูปดาวเท่านั้น", test:c=>c.shape==="ดาว", hint:"รูปทรง" },
  { id:"even", label:"เลขคู่เท่านั้น", test:c=>c.number%2===0, hint:"ตัวเลข" },
  { id:"odd", label:"เลขคี่เท่านั้น", test:c=>c.number%2===1, hint:"ตัวเลข" },
  { id:"high", label:"เลข 4 ขึ้นไปเท่านั้น", test:c=>c.number>=4, hint:"ตัวเลข" },
  { id:"low", label:"เลข 1 ถึง 3 เท่านั้น", test:c=>c.number<=3, hint:"ตัวเลข" },
  { id:"cat", label:"ไพ่รูปแมวเท่านั้น", test:c=>c.icon==="แมว", hint:"สัญลักษณ์" },
  { id:"rocket", label:"ไพ่รูปจรวดเท่านั้น", test:c=>c.icon==="จรวด", hint:"สัญลักษณ์" },
  { id:"heart", label:"ไพ่รูปหัวใจเท่านั้น", test:c=>c.icon==="หัวใจ", hint:"สัญลักษณ์" },
  { id:"leaf", label:"ไพ่รูปใบไม้เท่านั้น", test:c=>c.icon==="ใบไม้", hint:"สัญลักษณ์" }
];

function makeDeck() {
  const deck = [];
  let id = 0;
  for (const color of COLORS) for (const shape of SHAPES) for (const number of [1,2,3,4,5]) {
    deck.push({ id: String(++id), color, shape, number, icon: ICONS[(number + SHAPES.indexOf(shape) + COLORS.indexOf(color)) % ICONS.length] });
  }
  return deck.sort(()=>Math.random()-.5);
}
function code() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function pub(room) {
  return {
    code: room.code, phase: room.phase, hostId: room.hostId,
    players: [...room.players.values()].map(p=>({id:p.id,name:p.name,handCount:p.hand.length,online:p.online})),
    discard: room.discard.slice(-8), log: room.log.slice(-12),
    myHand: null, ruleHint: room.rule?.hint || null
  };
}
function sendRoom(room) {
  for (const p of room.players.values()) {
    const state = pub(room);
    state.myHand = p.hand;
    state.isHost = p.id === room.hostId;
    state.secretRule = p.id === room.hostId && room.phase !== "lobby" ? room.rule.label : null;
    io.to(p.id).emit("state", state);
  }
}
function say(room, msg) {
  room.log.push(msg);
  if (room.log.length > 30) room.log.shift();
}
io.on("connection", socket => {
  socket.on("create", ({name}, cb) => {
    const roomCode = code();
    const room = {code:roomCode, hostId:socket.id, players:new Map(), phase:"lobby", deck:[], discard:[], rule:null, log:[]};
    room.players.set(socket.id, {id:socket.id,name:(name||"ผู้เล่น").slice(0,18),hand:[],online:true});
    rooms.set(roomCode, room); socket.join(roomCode);
    cb({ok:true,code:roomCode}); sendRoom(room);
  });
  socket.on("join", ({code:roomCode,name}, cb) => {
    const room = rooms.get((roomCode||"").toUpperCase());
    if (!room) return cb({ok:false,error:"ไม่พบห้องนี้"});
    if (room.phase !== "lobby") return cb({ok:false,error:"เกมเริ่มแล้ว เข้าร่วมห้องไม่ได้"});
    if (room.players.size >= 8) return cb({ok:false,error:"ห้องเต็มแล้ว (สูงสุด 8 คน)"});
    room.players.set(socket.id,{id:socket.id,name:(name||"ผู้เล่น").slice(0,18),hand:[],online:true});
    socket.join(room.code); say(room, `${name||"ผู้เล่น"} เข้าร่วมห้องแล้ว`);
    cb({ok:true,code:room.code}); sendRoom(room);
  });
  socket.on("start", (_, cb) => {
    const room = [...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room || room.hostId !== socket.id) return cb?.({ok:false,error:"เฉพาะเจ้าของห้องเริ่มเกมได้"});
    if (room.players.size < 2) return cb?.({ok:false,error:"ต้องมีผู้เล่นอย่างน้อย 2 คน"});
    room.deck = makeDeck(); room.discard=[]; room.rule=RULES[Math.floor(Math.random()*RULES.length)];
    for (const p of room.players.values()) p.hand = room.deck.splice(0,5);
    room.phase="playing"; say(room,"เริ่มเกมแล้ว! ลองสังเกตกฎลับจากไพ่ที่ผ่านและไม่ผ่าน");
    cb?.({ok:true}); sendRoom(room);
  });
  socket.on("play", ({cardId}, cb) => {
    const room = [...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room || room.phase!=="playing") return cb?.({ok:false,error:"ยังไม่อยู่ในช่วงเล่น"});
    const p=room.players.get(socket.id);
    const idx=p.hand.findIndex(c=>c.id===cardId);
    if (idx<0) return cb?.({ok:false,error:"ไม่พบไพ่ใบนี้"});
    const card=p.hand[idx];
    if (room.rule.test(card)) {
      p.hand.splice(idx,1); room.discard.push({...card,playedBy:p.name,accepted:true});
      say(room,`✅ ${p.name} ลงไพ่ ${card.color} ${card.shape} เลข ${card.number} — ผ่าน!`);
    } else {
      say(room,`❌ ${p.name} ลงไพ่ ${card.color} ${card.shape} เลข ${card.number} — ไม่ผ่าน ต้องเก็บกลับ`);
    }
    if (p.hand.length===0) { room.phase="guess"; room.guesser=socket.id; say(room,`${p.name} ไพ่หมดแล้ว! ถึงเวลาทายกฎลับ`); }
    cb?.({ok:true}); sendRoom(room);
  });
  socket.on("guess", ({text:guess}, cb) => {
    const room = [...rooms.values()].find(r=>r.players.has(socket.id));
    if (!room || room.phase!=="guess" || room.guesser!==socket.id) return cb?.({ok:false,error:"ตอนนี้ยังไม่ใช่ตาคุณทาย"});
    const normalized=(guess||"").trim().toLowerCase();
    const rule=room.rule;
    const accepted = normalized===rule.label.toLowerCase() || normalized===rule.id;
    if (accepted) { room.phase="ended"; say(room,`🏆 ${room.players.get(socket.id).name} ทายถูก! กฎคือ “${rule.label}”`); }
    else {
      const p=room.players.get(socket.id); p.hand=room.deck.splice(0,2);
      room.phase="playing"; say(room,`ยังไม่ถูก! รับไพ่เพิ่ม 2 ใบ แล้วเล่นต่อ`);
    }
    cb?.({ok:true,accepted,rule:accepted?rule.label:null}); sendRoom(room);
  });
  socket.on("restart",(_,cb)=>{
    const room=[...rooms.values()].find(r=>r.players.has(socket.id));
    if(!room||room.hostId!==socket.id)return cb?.({ok:false,error:"เฉพาะเจ้าของห้องเริ่มใหม่ได้"});
    room.phase="lobby";room.deck=[];room.discard=[];room.rule=null;room.log=[];room.guesser=null;
    for(const p of room.players.values())p.hand=[];
    cb?.({ok:true});sendRoom(room);
  });
  socket.on("disconnect",()=>{
    for(const room of rooms.values()) if(room.players.has(socket.id)){
      const p=room.players.get(socket.id);p.online=false;
      say(room,`${p.name} หลุดการเชื่อมต่อ`);
      if(room.hostId===socket.id){
        const next=[...room.players.values()].find(x=>x.online);
        if(next)room.hostId=next.id;
      }
      sendRoom(room);
    }
  });
});
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`Game running on ${PORT}`));
