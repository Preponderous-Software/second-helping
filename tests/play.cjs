/* Plays all five fair days in a real browser on Strata (software GL). */
const {chromium}=require("playwright");
const OUT=process.argv[2]||".";const BASE=process.env.BASE||"http://127.0.0.1:8771/";
const wait=(p,fn,arg,ms=40000)=>p.waitForFunction(fn,arg,{timeout:ms,polling:100});
async function run(name,ctxOpts){
 const b=await chromium.launch({args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
 const c=await b.newContext(ctxOpts);const p=await c.newPage();const errs=[];
 p.on("pageerror",e=>errs.push(e.message));p.on("console",m=>{if(m.type()==="error"&&!/fonts\.g|ERR_|Failed to load resource/.test(m.text()))errs.push(m.text())});
 const shot=n=>p.screenshot({path:`${OUT}/${name}-${n}.png`});
 await p.goto(BASE+"?economy=1");await wait(p,()=>window.__fair&&!document.getElementById("title").hidden,null,60000);
 await p.waitForTimeout(800);await shot("1-title");
 await p.click("#title-buttons .primary");await wait(p,()=>__fair.G.step==="booth");await p.waitForTimeout(500);await shot("2-gate");
 // real input, no teleporting: the camera only ever turns when the player turns it
 const pose=()=>p.evaluate(()=>({x:__fair.me.x,z:__fair.me.z,yaw:__fair.me.yaw}));
 const a0=await pose();
 if(name==="desktop"){await p.focus("#fair");await p.keyboard.down("w");await p.waitForTimeout(1200);await p.keyboard.up("w");const a1=await pose();require("assert")(a1.z<a0.z-0.5,"W walks forward "+JSON.stringify([a0,a1]));require("assert").equal(a1.yaw,a0.yaw,"walking never turns the view");
  await p.mouse.move(640,400);await p.mouse.down();await p.mouse.move(760,400,{steps:6});await p.mouse.up();await p.waitForTimeout(300);const a2=await pose();require("assert")(Math.abs(a2.yaw-a1.yaw)>0.05,"drag looks");console.log("walk ok",a0.z.toFixed(2),"->",a1.z.toFixed(2),"yaw",a1.yaw.toFixed(2),"->",a2.yaw.toFixed(2))}
 else{const r=await p.evaluate(()=>{const s=document.getElementById("stick");const b=s.getBoundingClientRect();const ev=(t,y)=>s.dispatchEvent(new PointerEvent(t,{pointerId:7,bubbles:true,clientX:b.left+b.width/2,clientY:y}));s.setPointerCapture=()=>{};ev("pointerdown",b.top+8);return b.top+8});await p.waitForTimeout(1200);await p.evaluate(y=>document.getElementById("stick").dispatchEvent(new PointerEvent("pointerup",{pointerId:7,bubbles:true,clientY:y})),r);const a1=await pose();require("assert")(a1.z<a0.z-0.5,"stick walks "+JSON.stringify([a0,a1]));console.log("stick ok",a0.z.toFixed(2),"->",a1.z.toFixed(2))}
 const useAt=async(x,z,yaw,pitch=0.04)=>{await p.evaluate(([x,z,y,q])=>{__fair.tp(x,z,y,q);return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))},[x,z,yaw,pitch]);await wait(p,()=>__fair.use());await p.evaluate(()=>__fair.act())};
 await useAt(-4.1,11,0);await wait(p,()=>!document.getElementById("panel").hidden);
 for(const pie of ["pecan","apple","cherry","pumpkin"])await p.click(`.pick[data-pie=${pie}]`);
 await shot("3-ballot");await p.click("#panel-buttons .primary");
 await p.evaluate(()=>__fair.tp(0,0.3,Math.PI/2));await wait(p,()=>__fair.G.step==="count");await p.click("#panel-buttons .primary");
 await p.evaluate(()=>__fair.tp(0,-2,Math.PI/2,0.02));await p.waitForTimeout(700);await shot("4-towers");
 // a wrong pull is refused
 const s=()=>p.evaluate(()=>{const s=__fair.G.sat;return{phase:s.phase,short:s.shortest(),pulled:s.pulled,held:s.held,want:s.held!=null?s.nextPie(s.held):null,winner:s.winner,moved:s.moved}});
 const pl=await p.evaluate(()=>Object.fromEntries(Object.entries(__fair.S.plinths).map(([k,v])=>[k,v.x])));
 await useAt(pl.pumpkin,-3.6,Math.PI/2);assert=require("assert");assert.equal((await s()).phase,"pull");
 let g=0,shotCarry=false;for(;;){assert(g++<80);const st=await s();if(st.phase==="done")break;
  if(st.phase==="pull")await useAt(pl[st.short[0]],-3.6,Math.PI/2);
  else if(st.held==null)await useAt(pl[st.pulled],-3.6,Math.PI/2);
  else{if(!shotCarry){await p.waitForTimeout(500);await shot("5-carrying");shotCarry=true}await useAt(pl[st.want],-3.6,Math.PI/2)}
  await p.waitForTimeout(30)}
 console.log(name,"saturday winner",(await s()).winner);
 await wait(p,()=>!document.getElementById("panel").hidden);await p.waitForTimeout(300);await shot("6-saturday-won");console.log(await p.textContent("#panel-body"));
 const open=()=>wait(p,()=>!document.getElementById("panel").hidden);const closed=()=>wait(p,()=>document.getElementById("panel").hidden);
 const ok=async()=>{await p.click("#panel-buttons .primary")};
 const SPOT=-3.6,BELL=[0,-1.7,Math.PI/2];
 // Day 2: The Spoiler
 await ok();await wait(p,()=>__fair.G.day===2&&__fair.G.lab&&!document.getElementById("panel").hidden);await ok();await closed();
 await useAt(pl.apple,SPOT,Math.PI/2);await p.waitForTimeout(150);assert.equal(await p.evaluate(()=>__fair.G.winner),null,"the wrong tower gets no ribbon");
 await useAt(pl.pumpkin,SPOT,Math.PI/2);await open();await p.waitForTimeout(400);await shot("d2-1-old-rule");console.log(await p.textContent("#panel-title"));await ok();await closed();
 await useAt(pl.cherry,SPOT,Math.PI/2);await p.waitForTimeout(800);await p.evaluate(()=>__fair.tp(0,-2,Math.PI/2,0.02));await p.waitForTimeout(300);await shot("d2-2-no-cherry");
 await useAt(pl.apple,SPOT,Math.PI/2);await open();console.log(await p.textContent("#panel-title"));await ok();await closed();
 await useAt(pl.pumpkin,SPOT,Math.PI/2);await wait(p,()=>__fair.G.lab.bell);await useAt(...BELL);await open();console.log(await p.textContent("#panel-title"),"|",await p.textContent("#panel-body"));await p.waitForTimeout(400);await shot("d2-3-ranked");
 // Day 3: The Doors
 await ok();await wait(p,()=>__fair.G.mode==="sun"&&!document.getElementById("panel").hidden);await p.waitForTimeout(800);await shot("7-sunday");await ok();
 const door=n=>p.evaluate(n=>{const R=window.Rules;const i=R.DOORS.findIndex(d=>d.name===n);const h=__fair.S.houses.find(h=>h.door===i);return{x:h.stand.x,z:h.stand.z}},n);
 const visit=async n=>{const d=await door(n);const yaw=await p.evaluate(d=>{const h=__fair.S.houses.find(h=>Math.hypot(h.stand.x-d.x,h.stand.z-d.z)<.01);return Math.atan2(h.fr.f[2],h.fr.f[0])},d);await useAt(d.x,d.z,yaw);await wait(p,()=>!document.getElementById("panel").hidden)};
 // a losing try first
 await visit("Mabel");await p.waitForTimeout(400);await shot("8-door");await p.click("#panel-buttons .primary");await p.click("#panel-buttons .btn:last-child");await wait(p,()=>document.getElementById("panel").hidden);
 await useAt(0,-1.7,Math.PI/2);await wait(p,()=>__fair.G.step==="result",null,30000);await open();console.log(await p.textContent("#panel-body"));await p.click("#panel-buttons .primary");
 // the solution
 for(const n of ["Lena","Ada","Walt"]){await visit(n);await p.click("#panel-buttons .primary");await p.click("#panel-buttons .btn:last-child");await wait(p,()=>document.getElementById("panel").hidden)}
 await p.keyboard.press("l");await wait(p,()=>!document.getElementById("panel").hidden);await p.waitForTimeout(100);await shot("9-ledger");await p.keyboard.press("Escape");
 await useAt(0,-1.7,Math.PI/2,0.0);await p.waitForTimeout(2600);await shot("10-count");await wait(p,()=>__fair.G.step==="result");console.log(await p.textContent("#panel-body"));await p.waitForTimeout(700);await shot("11-pecan-wins");
 // Day 4: The Short Ballot
 await ok();await wait(p,()=>__fair.G.day===4&&__fair.G.sat&&!document.getElementById("panel").hidden);await ok();await closed();
 await p.evaluate(()=>__fair.tp(0,-2,Math.PI/2,0.02));await p.waitForTimeout(400);await shot("d4-1-start");
 const CRATE=[5.9,-4.2,Math.PI/2];let g4=0,crateShot=false,bars=new Set();
 for(;;){assert(g4++<120);const st=await s();bars.add(await p.evaluate(()=>__fair.G.sat.needed()));if(st.phase==="done")break;
  if(st.phase==="pull")await useAt(pl[st.short[0]],SPOT,Math.PI/2);
  else if(st.held==null)await useAt(pl[st.pulled],SPOT,Math.PI/2);
  else if(st.want)await useAt(pl[st.want],SPOT,Math.PI/2);
  else{
   // beside any tower, a spent ballot offers the crate or nothing: Cherry stood next to the crate and took the prompt
   await p.evaluate(([x])=>{__fair.tp(x,-3.9,Math.PI/2);return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))},[pl.cherry]);assert.equal(await p.evaluate(()=>__fair.use()),"Put it in the crate");
   await p.evaluate(()=>__fair.tp(5.9,-3.9,Math.PI/2,0.3));await p.waitForTimeout(200);if(!crateShot){await shot("d4-2-crate");crateShot=true}await useAt(...CRATE)}
  await p.waitForTimeout(30)}
 console.log("bar needed values",[...bars]);assert.deepEqual([...bars].sort((a,b)=>b-a),[11,10,9]);
 await open();console.log(await p.textContent("#panel-title"));await ok();await closed();
 await useAt(5.9,-4,Math.PI/2);await open();await p.waitForTimeout(300);await shot("d4-3-read-crate");await ok();await closed();
 await useAt(...BELL);await open();console.log(await p.textContent("#panel-title"));await p.waitForTimeout(400);await shot("d4-4-recount");
 // Day 5: The Paradox
 await ok();await wait(p,()=>__fair.G.day===5&&__fair.G.lab&&!document.getElementById("panel").hidden);await ok();await closed();
 await useAt(...BELL);await open();console.log(await p.textContent("#panel-title"));await ok();await closed();
 const sw=async pie=>{await useAt(pl[pie],SPOT,Math.PI/2);await p.waitForTimeout(40)};
 await sw("cherry");await sw("pecan");await useAt(...BELL);await open();console.log(await p.textContent("#panel-title"));await ok();await closed();
 await sw("cherry");await sw("cherry");await p.evaluate(()=>__fair.tp(0,-2,Math.PI/2,0.02));await p.waitForTimeout(600);await shot("d5-1-switched");
 await useAt(...BELL);await open();console.log(await p.textContent("#panel-title"),"|",await p.evaluate(()=>__fair.G.winner));assert.equal(await p.evaluate(()=>__fair.G.winner),"pecan");await p.waitForTimeout(500);await shot("d5-2-paradox");
 await ok();await wait(p,()=>__fair.G.mode==="end");await p.waitForTimeout(200);await shot("12-end");
 // saves: this game's own, then the old two-day format a player may still hold
 await p.reload();await wait(p,()=>window.__fair&&!document.getElementById("title").hidden,null,60000);console.log("after reload:",await p.textContent("#title-buttons"));
 assert(/Continue: Day 5/.test(await p.textContent("#title-buttons")));
 await p.evaluate(()=>localStorage.setItem("second-helping.v1",JSON.stringify({satDone:true,met:[15,16]})));await p.reload();await wait(p,()=>window.__fair&&!document.getElementById("title").hidden,null,60000);console.log("old save:",await p.textContent("#title-buttons"));
 assert(/Continue: Day 3/.test(await p.textContent("#title-buttons")));await p.click("#title-buttons .primary");await wait(p,()=>__fair.G.mode==="sun");assert.equal(await p.evaluate(()=>__fair.G.sun.met.size),2,"the old ledger carries over");
 // skipping: from the title, then day by day, with the ledger left alone
 await p.evaluate(()=>localStorage.removeItem("second-helping.v1"));await p.reload();await wait(p,()=>window.__fair&&!document.getElementById("title").hidden,null,60000);
 const fresh=await p.textContent("#title-buttons");for(let d=2;d<=5;d++)assert(fresh.includes(`Day ${d},`),"every day is offered from the start");await p.waitForTimeout(300);await shot("13-title-all-days");
 await p.click("#title-buttons .primary");await wait(p,()=>__fair.G.step==="booth");assert.equal(await p.isVisible("#skip"),true);await shot("14-skip-button");
 const skip=async()=>{await p.click("#skip");await open();await p.click("#panel-buttons .primary")};
 await p.click("#skip");await open();await shot("15-skip-confirm");await p.click("#panel-buttons .btn:last-child");await closed();assert.equal(await p.evaluate(()=>__fair.G.day),1,"keep playing stays put");
 await skip();await wait(p,()=>__fair.G.day===2&&__fair.G.lab&&!document.getElementById("panel").hidden);await ok();await closed();
 await skip();await wait(p,()=>__fair.G.day===3&&__fair.G.sun&&!document.getElementById("panel").hidden);await ok();await closed();
 await visit("Mabel");await p.click("#panel-buttons .primary");await p.click("#panel-buttons .btn:last-child");await wait(p,()=>document.getElementById("panel").hidden);
 await useAt(0,-1.7,Math.PI/2);await wait(p,()=>__fair.G.counting);await p.click("#skip");await p.waitForTimeout(100);assert.equal(await p.isVisible("#panel"),false,"a running count can't be skipped");await wait(p,()=>__fair.G.step==="result");await open();await ok();await closed();
 await skip();await wait(p,()=>__fair.G.day===4&&__fair.G.sat&&!document.getElementById("panel").hidden);await p.click("#skip");await p.waitForTimeout(100);assert.match(await p.textContent("#toast"),/Close this panel/);await ok();await closed();
 await skip();await wait(p,()=>__fair.G.day===5&&__fair.G.lab&&!document.getElementById("panel").hidden);await ok();await closed();
 await p.click("#skip");await open();await p.click("#panel-buttons .primary");await wait(p,()=>__fair.G.mode==="end");assert.equal(await p.isVisible("#skip"),false);
 const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem("second-helping.v1")));assert.equal(saved.reached,5);assert.equal(saved.met.length>0,true,"the ledger survives skipping");
 console.log(name,"overflow",await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),"errors",errs);await b.close();if(errs.length)process.exit(1)}
(async()=>{await run("desktop",{viewport:{width:1280,height:720}});await run("phone",{viewport:{width:390,height:844},hasTouch:true,isMobile:true})})().catch(e=>{console.error(e);process.exit(1)});
