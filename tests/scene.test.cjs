const assert=require("assert");const W=require("../web/vendor/hall-walk.js");const S=require("../web/scene.js");const R=require("../web/rules.js");
let n=0;const t=(name,f)=>{f();n++;console.log("ok -",name)};
// flood fill the walkable floor from the Saturday spawn
const step=0.25,reach=new Set();const key=(x,z)=>Math.round(x/step)+","+Math.round(z/step);
function flood(){const q=[[S.SPAWN_SAT.x,S.SPAWN_SAT.z]];reach.add(key(...q[0]));while(q.length){const[x,z]=q.pop();for(const[dx,dz]of[[step,0],[-step,0],[0,step],[0,-step]]){const a=x+dx,b=z+dz;const k=key(a,b);if(reach.has(k)||!W.clear(a,b,S.world))continue;reach.add(k);q.push([a,b])}}}
flood();
const can=(x,z)=>{for(let dx=-.5;dx<=.5;dx+=step)for(let dz=-.5;dz<=.5;dz+=step)if(reach.has(key(x+dx,z+dz)))return true;return false};
t("every house's knock spot is reachable",()=>{for(const h of S.houses)assert(can(h.stand.x,h.stand.z),R.DOORS[h.door].name)});
t("each door is a different neighbour",()=>{assert.equal(new Set(S.HOUSE).size,17);assert.equal(S.houses.length,17)});
t("towers, crate, booth, bell and clerk can be reached",()=>{for(const p of S.PIES)assert(can(S.plinths[p].x,S.plinths[p].z+1.1),p);assert(can(S.bell.x,S.bell.z+.9));assert(can(S.booth.standX,S.booth.z));assert(can(S.clerk.x,S.clerk.z+.8));assert(can(S.SPAWN_SUN.x,S.SPAWN_SUN.z));assert(can(S.SPAWN_TENT.x,S.SPAWN_TENT.z));assert(can(S.crate.x,S.crate.z+1.3));assert(can(S.dot.x,S.dot.z+1))});
t("houses don't overlap each other",()=>{for(let i=0;i<17;i++){const a=S.houses[i],b=S.houses[(i+1)%17];if(i<16)assert(Math.hypot(a.x-b.x,a.z-b.z)>5.6,i)}});
t("meshes are well formed",()=>{const m=S.build(i=>R.DOORS[i].ballot[0]);for(const k of["ground","solid","signs","board","sky"]){const x=m[k];assert(x.indices.length%3===0);assert.equal(x.normals.length,x.positions.length);assert.equal(x.colors.length,x.positions.length);assert(x.uvs.length===0||x.uvs.length===x.nv*2,k);assert(Math.max(...x.indices.slice(0,50000))<x.nv);assert(x.positions.every(Number.isFinite),k)}console.log("   vertices",m.solid.nv)});
t("the bar sits exactly at more than half",()=>{const step9=S.BAR_RISE/9,step13=S.BAR_RISE/13;assert(Math.abs(S.towerTop(9,step9)-(S.PLINTH.top+S.BAR_RISE))<1e-9);assert(Math.abs(S.towerTop(13,step13)-(S.PLINTH.top+S.BAR_RISE))<1e-9)});
console.log(n,"passed");
