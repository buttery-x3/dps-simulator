import { WORLD, HZ } from './engine.js';
import {drawSpellIcon,spellReadiness} from './icons.js';
import {maintenanceDots} from './hud.js';
const TAU=Math.PI*2;
const poly=(c,pts,fill,stroke)=>{c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}};
function circle(c,x,y,r,fill,stroke,width=1){c.beginPath();c.arc(x,y,Math.max(0,r),0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=width;c.strokeStyle=stroke;c.stroke();}}
function text(c,str,x,y,size=14,color='#afbacb',align='center',weight=500){c.font=`${weight} ${size}px "Segoe UI", sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(str,x,y);}
export class ArenaRenderer {
 constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.dotLabelBounds=[];this.floats=[];this.lastEvent=0;this.reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;}
 resize(){const r=this.canvas.getBoundingClientRect();const d=Math.min(globalThis.devicePixelRatio||1,2);const w=Math.round(r.width*d),h=Math.round(r.height*d);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}}
 pointFromClient(clientX,clientY){const r=this.canvas.getBoundingClientRect(),scale=Math.min(r.width/WORLD.width,r.height/WORLD.height),ox=(r.width-WORLD.width*scale)/2,oy=(r.height-WORLD.height*scale)/2;return{x:(clientX-r.left-ox)/scale,y:(clientY-r.top-oy)/scale};}
 draw(s){this.resize();const c=this.ctx,w=this.canvas.width,h=this.canvas.height,scale=Math.min(w/WORLD.width,h/WORLD.height),ox=(w-WORLD.width*scale)/2,oy=(h-WORLD.height*scale)/2;c.setTransform(1,0,0,1,0,0);c.fillStyle='#0d1622';c.fillRect(0,0,w,h);c.setTransform(scale,0,0,scale,ox,oy);this.floor(c,s);
   c.save();c.beginPath();c.rect(0,0,WORLD.width,WORLD.height);c.clip();
   // Mechanics fill the floor beneath actors; crisp boundaries and timers stay above spell VFX.
   (s.safeZones||[]).forEach(zone=>this.safeZone(c,zone,s,false));
   s.hazards.forEach(h=>this.hazard(c,h,s,false));
   (s.hostileProjectiles||[]).forEach(projectile=>this.hostileProjectile(c,projectile,s,false));
   this.dotLabelBounds=[];this.bindingLinks(c,s);
   [...s.targets].sort((a,b)=>a.y-b.y).forEach(t=>this.target(c,t,s));
   this.magic(c,s);this.player(c,s);
   (s.safeZones||[]).forEach(zone=>this.safeZone(c,zone,s,true));
   s.hazards.forEach(h=>this.hazard(c,h,s,true));
   (s.hostileProjectiles||[]).forEach(projectile=>this.hostileProjectile(c,projectile,s,true));
   this.damageText(c,s);this.annotations(c,s);c.restore();
 }
 floor(c,s){
   c.fillStyle='#101824';c.fillRect(0,0,1000,560);
   const bg=c.createRadialGradient(500,190,40,500,280,580);bg.addColorStop(0,'#233044');bg.addColorStop(.68,'#151f2e');bg.addColorStop(1,'#0c1420');c.fillStyle=bg;c.fillRect(0,0,1000,560);
   c.save();c.strokeStyle='#7992b00b';c.lineWidth=1;for(let x=-560;x<1100;x+=64){c.beginPath();c.moveTo(x,0);c.lineTo(x+560,560);c.stroke();c.beginPath();c.moveTo(x+560,0);c.lineTo(x,560);c.stroke();}
   c.strokeStyle='#819bb91b';c.lineWidth=1.5;c.strokeRect(24,24,952,512);c.strokeStyle='#9bb5d117';c.strokeRect(34,34,932,492);
   circle(c,500,205,180,null,'#9cacca14',1.5);circle(c,500,205,185,null,'#9cacca09',1);circle(c,500,205,100,null,'#9cacca12',1);
   for(let a=0;a<TAU;a+=TAU/24){const r=180;c.beginPath();c.moveTo(500+Math.cos(a)*r,205+Math.sin(a)*r);c.lineTo(500+Math.cos(a)*(r+8),205+Math.sin(a)*(r+8));c.stroke();}
   [[45,45],[955,45],[45,515],[955,515]].forEach(([x,y])=>{poly(c,[[x,y-4],[x+4,y],[x,y+4],[x-4,y]],'#8593ae55');});c.restore();
   text(c,'THE STILLING CHAMBER',53,62,12,'#899bb077','left',600);text(c,'NO END STATE  /  TRAIN AT YOUR PACE',950,513,11,'#8091a566','right',500);
 }
 hazard(c,h,s,outline){
   const live=s.tick>=h.impact,prog=Math.min(1,(s.tick-h.born)/(h.impact-h.born)),fade=live?Math.max(0,(h.ends-s.tick)/(h.ends-h.impact)):1;
   c.save();c.globalAlpha=fade;
   if(h.type==='circle'){
    if(!outline){circle(c,h.x,h.y,h.r,live?'#f4546333':'#ef44551c');c.save();c.beginPath();c.arc(h.x,h.y,h.r,0,TAU);c.clip();c.strokeStyle='#fb71854d';c.lineWidth=1;for(let x=h.x-h.r*2;x<h.x+h.r*2;x+=17){c.beginPath();c.moveTo(x,h.y-h.r);c.lineTo(x+h.r*2,h.y+h.r);c.stroke();}c.restore();}
    else{circle(c,h.x,h.y,h.r,null,live?'#ffd0d5':'#f15b69',2.2);if(!live){c.beginPath();c.arc(h.x,h.y,h.r-5,-Math.PI/2,-Math.PI/2+TAU*prog);c.strokeStyle='#ff9aa8';c.lineWidth=4;c.stroke();this.warningLabel(c,`${((h.impact-s.tick)/HZ).toFixed(1)}s`,h.x,h.y-h.r-12);} }
   }else{
     c.translate(h.x,h.y);c.rotate(h.angle);const len=1200,half=h.width/2;
     if(!outline){c.fillStyle=live?'#f4546338':'#ef445520';c.fillRect(-len,-half,len*2,h.width);c.save();c.beginPath();c.rect(-len,-half,len*2,h.width);c.clip();c.strokeStyle='#fb718566';c.lineWidth=1;for(let x=-len;x<len;x+=22){c.beginPath();c.moveTo(x,-half);c.lineTo(x+h.width,half);c.stroke();}c.restore();}
     else{c.strokeStyle=live?'#ffd0d5':'#f15b69';c.lineWidth=2;c.beginPath();c.moveTo(-len,-half);c.lineTo(len,-half);c.moveTo(-len,half);c.lineTo(len,half);c.stroke();c.setLineDash([8,8]);c.strokeStyle='#ff899a88';c.lineWidth=2;c.beginPath();c.moveTo(-len,0);c.lineTo(len,0);c.stroke();c.setLineDash([]);c.rotate(-h.angle);if(!live)this.warningLabel(c,`LINE · ${((h.impact-s.tick)/HZ).toFixed(1)}s`,0,-58);}
   }c.restore();
 }
 warningLabel(c,label,x,y){c.font='600 13px "Segoe UI", sans-serif';const width=c.measureText(label).width+18;c.fillStyle='#26131b';c.fillRect(x-width/2,y-14,width,22);text(c,label,x,y+2,13,'#ffb6bf','center',700);}
 safeZone(c,zone,s,outline){
  const deadline=zone.kind==='safe-deadline',active=s.tick>=zone.active;
  if(s.tick<zone.born||s.tick>=(deadline?zone.active:zone.ends))return;
  const inside=Math.hypot(s.player.x-zone.x,s.player.y-zone.y)<=Math.max(0,zone.r-s.player.r)+1e-9;
  const color=active?'#61efae':'#67e3ed',remaining=Math.max(0,((active?zone.ends:zone.active)-s.tick)/HZ);
  c.save();
  if(!outline){
    circle(c,zone.x,zone.y,zone.r,active?'#30d78a29':'#35cedb1c');
    // Inward markers and a cool palette identify a destination, unlike red hatched hazards.
    for(let i=0;i<4;i++){const angle=i*TAU/4,outer=zone.r-9,inner=zone.r-19;c.save();c.translate(zone.x,zone.y);c.rotate(angle);poly(c,[[outer,-5],[inner,0],[outer,5]],active?'#61efae70':'#67e3ed70');c.restore();}
    circle(c,zone.x,zone.y,Math.max(0,zone.r-s.player.r),null,active?'#61efae22':'#67e3ed22',1);
  }else{
    c.setLineDash(active?[]:deadline?[9,4]:[3,5]);circle(c,zone.x,zone.y,zone.r,null,color,active?3:2.5);c.setLineDash([]);
    const span=active?zone.ends-zone.active:zone.active-zone.born;
    const progress=Math.max(0,Math.min(1,((active?zone.ends:zone.active)-s.tick)/Math.max(1,span)));
    c.beginPath();c.arc(zone.x,zone.y,Math.max(0,zone.r-5),-Math.PI/2,-Math.PI/2+TAU*progress);c.lineWidth=3;c.strokeStyle=color;c.stroke();
    // A check appears only when the whole collision disk is inside this particular zone.
    if(inside){c.strokeStyle=color;c.lineWidth=2.5;c.beginPath();c.moveTo(zone.x-7,zone.y);c.lineTo(zone.x-2,zone.y+5);c.lineTo(zone.x+8,zone.y-6);c.stroke();}
    else{circle(c,zone.x,zone.y,5,null,color,1.5);}
    const label=deadline?`ENTER BY ${remaining.toFixed(1)}s`:active?`HOLD · ${remaining.toFixed(1)}s`:`HOLD IN ${remaining.toFixed(1)}s`;
    c.font='700 13px "Segoe UI", sans-serif';const width=c.measureText(label).width+20;
    const x=Math.max(width/2+8,Math.min(WORLD.width-width/2-8,zone.x)),y=Math.max(84,Math.min(WORLD.height-22,zone.y-zone.r-12));
    c.fillStyle='#0b2429';c.fillRect(x-width/2,y-15,width,24);c.lineWidth=1;c.strokeStyle=color;c.strokeRect(x-width/2,y-15,width,24);text(c,label,x,y+2,13,color,'center',700);
  }
  c.restore();
 }
 hostileProjectile(c,projectile,s,outline){
  if(s.tick<projectile.born||s.tick>=projectile.expires)return;
  const angle=Math.atan2(projectile.vy,projectile.vx),r=projectile.r;
  c.save();c.translate(projectile.x,projectile.y);c.rotate(angle);
  if(!outline){
    // A tapered red wake communicates travel direction; friendly missiles keep their spell color.
    poly(c,[[-r-38,-2],[-r-7,-r*.72],[r*.25,0],[-r-7,r*.72],[-r-38,2]],'#fa4b363f');
    c.strokeStyle='#ff693a';c.lineWidth=3;c.beginPath();c.moveTo(-r-28,0);c.lineTo(-r+2,0);c.stroke();
    circle(c,0,0,r,'#e63f36');
  }else{
    circle(c,0,0,r,null,'#ffac69',2.5);
    // The forward chevron stays legible when a spell effect crosses the projectile.
    poly(c,[[-r*.2,-r*.58],[r*.65,0],[-r*.2,r*.58]],'#ffd299');
    c.strokeStyle='#ff693a';c.lineWidth=2;c.beginPath();c.moveTo(-r-10,-5);c.lineTo(-r-3,0);c.lineTo(-r-10,5);c.stroke();
  }
  c.restore();
 }
 target(c,t,s){
  const selected=s.selectedId===t.id;const dummy=t.kind==='dummy';
  const definitions=maintenanceDots(s.spells||[]);
  const dots=Object.entries(t.dots||{}).filter(([id,dot])=>(dot.maintenance||definitions.some(def=>def.id===id))&&dot.expires>s.tick).map(([id,dot])=>({...definitions.find(def=>def.id===id),...dot,id}));
  circle(c,t.x,t.y+12,dummy?35:28,'#060a1166');
  if(selected){const r=t.r+14;c.save();c.translate(t.x,t.y);c.strokeStyle='#d9c58f';c.lineWidth=2;for(let a=0;a<TAU;a+=Math.PI/2){c.beginPath();c.arc(0,0,r,a+.2,a+.8);c.stroke();}c.restore();poly(c,[[t.x-5,t.y-t.r-18],[t.x+5,t.y-t.r-18],[t.x,t.y-t.r-12]],'#ead6a0');}
  dots.forEach((dot,i)=>{c.save();c.globalAlpha=.65;c.setLineDash(i%2?[4,5]:[]);circle(c,t.x,t.y,t.r+6+i*4,null,dot.color||'#c697ff',i===0?2:1.5);c.restore();});
  if(dummy){
    poly(c,[[t.x,t.y-31],[t.x+20,t.y-10],[t.x+16,t.y+21],[t.x,t.y+30],[t.x-16,t.y+21],[t.x-20,t.y-10]],'#303d53','#8293ac');
    poly(c,[[t.x,t.y-27],[t.x+15,t.y-9],[t.x,t.y+4],[t.x-15,t.y-9]],'#5e6b81');
    poly(c,[[t.x,t.y+4],[t.x+15,t.y-9],[t.x+12,t.y+17],[t.x,t.y+25]],'#334359');
    poly(c,[[t.x,t.y-11],[t.x+6,t.y-3],[t.x,t.y+5],[t.x-6,t.y-3]],'#d5bb7e');
    c.strokeStyle='#d0c39f66';c.lineWidth=2;c.beginPath();c.moveTo(t.x-8,t.y+11);c.lineTo(t.x+8,t.y+11);c.stroke();
  }else{
    poly(c,[[t.x,t.y-27],[t.x+18,t.y-4],[t.x+10,t.y+22],[t.x-10,t.y+22],[t.x-18,t.y-4]],'#45374f','#a18aaf');
    poly(c,[[t.x,t.y-24],[t.x+13,t.y-3],[t.x,t.y+18]],'#78608b');
    poly(c,[[t.x-4,t.y-6],[t.x+4,t.y-6],[t.x+6,t.y+1],[t.x-6,t.y+1]],'#e3c2f2');
    c.fillStyle='#090e17';c.fillRect(t.x-26,t.y+36,52,4);c.fillStyle='#9c82b5';c.fillRect(t.x-26,t.y+36,52*t.hp/t.maxHp,4);
  }
  const name=(t.name||(dummy?'Sentinel':'Echo')).toUpperCase();text(c,name,t.x,t.y+(dummy?54:59),12,selected?'#e6d5a9':'#a6b1c3','center',600);
  this.dotLabels(c,t,s,dots);
 }
 dotLabels(c,t,s,dots){
  if(!dots.length)return;
  c.font='600 10px "Segoe UI", sans-serif';
  const badges=dots.map(dot=>{
    const seconds=Math.max(0,(dot.expires-s.tick)/HZ),refresh=seconds<=((dot.duration||0)/HZ)*(dot.carry||0);
    const initials=(dot.name||dot.id).split(/[\s-]+/).map(word=>word[0]).join('').slice(0,2).toUpperCase();
    const label=`${initials} ${seconds.toFixed(1)}s`;
    return{label,width:c.measureText(label).width+10,color:refresh?'#eed092':dot.color||'#d4b9eb'};
  });
  const width=Math.max(...badges.map(badge=>badge.width)),height=badges.length*15;
  const candidates=[
    {x:t.x-width/2,y:t.y-t.r-24-height},
    {x:t.x+t.r+16,y:t.y-height/2},
    {x:t.x-t.r-16-width,y:t.y-height/2},
    {x:t.x-width/2,y:t.y+67},
  ];
  // Avoid adjacent actors and badges, especially in the clustered target layout.
  const blockers=[...s.targets.map(target=>({x:target.x-target.r-13,y:target.y-target.r-20,width:target.r*2+26,height:target.r+84})),...this.dotLabelBounds];
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+height,b.y+b.height)-Math.max(a.y,b.y));
  const score=position=>blockers.reduce((sum,box)=>sum+overlap(position,box),0)+(position.x<8||position.x+width>WORLD.width-8||position.y<68||position.y+height>WORLD.height-20?100000:0);
  const position=candidates.reduce((best,candidate)=>score(candidate)<score(best)?candidate:best,candidates[0]);
  this.dotLabelBounds.push({...position,width,height});
  badges.forEach((badge,i)=>{const x=position.x+width/2,y=position.y+10+i*15;c.fillStyle='#101824e8';c.fillRect(x-badge.width/2,y-10,badge.width,14);text(c,badge.label,x,y,10,badge.color,'center',600);});
 }
 player(c,s){const p=s.player,t=s.target();const a=t?Math.atan2(t.y-p.y,t.x-p.x):0;
  circle(c,p.x,p.y+11,19,'#070c1566');circle(c,p.x,p.y,19,null,'#85dcd64c',1);
  c.save();c.translate(p.x,p.y);c.rotate(a);poly(c,[[19,0],[-10,-10],[-6,0],[-10,10]],'#9be3df','#d9ffff');poly(c,[[6,0],[-8,-6],[-5,0],[-8,6]],'#226874');c.restore();
  if(s.cast){const progress=(s.tick-s.cast.started)/(s.cast.ends-s.cast.started);c.beginPath();c.arc(p.x,p.y,23,-Math.PI/2,-Math.PI/2+TAU*progress);c.strokeStyle=s.cast.kind==='channel'?'#81b8ec':'#b6a2ea';c.lineWidth=3;c.stroke();}
  text(c,'YOU',p.x,p.y+38,11,'#a3d8d8','center',600);
  const ready=(s.spells||[]).map(spell=>({spell,state:spellReadiness(s,spell.id)})).filter(({state})=>state.ready&&!state.locked);
  const size=42,gap=8,total=ready.length*size+Math.max(0,ready.length-1)*gap;const y=p.y<105?p.y+53:p.y-65,left=Math.max(8,Math.min(WORLD.width-total-8,p.x-total/2));
  ready.forEach(({spell,state},i)=>drawSpellIcon(c,spell.icon||spell.id,left+i*(size+gap),y,size,{...state,clock:false}));

 }
 bindingLinks(c,s){
  for(const link of s.links||[]){
    if(link.expires<=s.tick)continue;const source=s.target(link.sourceId);if(!source)continue;
    const spell=(s.spells||[]).find(spell=>spell.id===link.spellId);
    c.save();c.globalAlpha=.28;c.strokeStyle=spell?.color||'#b6a5e8';c.lineWidth=1.5;c.setLineDash([5,7]);
    for(const id of link.targetIds||[]){const target=s.target(id);if(!target)continue;c.beginPath();c.moveTo(source.x,source.y);c.lineTo(target.x,target.y);c.stroke();}
    c.restore();
  }
 }
 magic(c,s){
  if(s.cast?.kind==='channel'){
    const target=s.target(s.cast.targetId),spell=(s.spells||[]).find(spell=>spell.id===s.cast.spell);
    if(target){const p=s.player,color=spell?.color||'#b7a5ea';c.save();c.lineCap='round';c.strokeStyle=color;c.globalAlpha=.12;c.lineWidth=13;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(target.x,target.y);c.stroke();c.globalAlpha=.75;c.lineWidth=3;c.stroke();c.globalAlpha=.8;for(let i=0;i<3;i++){const q=((s.time*1.25+i/3)%1);circle(c,p.x+(target.x-p.x)*q,p.y+(target.y-p.y)*q,3,color);}c.restore();}
  }
  for(const e of s.effects){
    const age=(s.tick-e.start)/(Math.max(.001,e.duration)*HZ);if(age<0||age>1)continue;
    const color=e.color||'#c8b5ec',radius=e.radius||45;
    c.save();c.globalAlpha=1-age;
    if(e.type==='projectile'){
      const q=Math.min(1,age*3),x=e.fromX+(e.x-e.fromX)*q,y=e.fromY+(e.y-e.fromY)*q;
      c.strokeStyle=color;c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(x-(e.x-e.fromX)*.08,y-(e.y-e.fromY)*.08);c.lineTo(x,y);c.stroke();circle(c,x,y,6,color);if(q===1)circle(c,e.x,e.y,14+age*25,null,color,3);
    }else if(e.type==='pulse'){
      circle(c,e.x,e.y,radius*age,null,color,3);c.globalAlpha=(1-age)*.07;circle(c,e.x,e.y,radius*age,color);
    }else if(e.type==='dot'){
      circle(c,e.x,e.y,12+age*Math.min(radius,55),null,color,2);
    }else if(e.type==='beam'||e.type==='link'){
      c.strokeStyle=color;c.lineWidth=e.type==='beam'?4:2;c.lineCap='round';if(e.type==='link')c.setLineDash([5,5]);c.beginPath();c.moveTo(e.fromX,e.fromY);c.lineTo(e.x,e.y);c.stroke();circle(c,e.x,e.y,8+age*15,null,color,2);
    }else if(e.type==='buff'){
      circle(c,e.x,e.y,20+age*25,null,color,2);
      for(let i=0;i<4;i++){const angle=i*TAU/4-Math.PI/2,outer=30+age*18;poly(c,[[e.x+Math.cos(angle)*outer,e.y+Math.sin(angle)*outer],[e.x+Math.cos(angle+.12)*(outer-9),e.y+Math.sin(angle+.12)*(outer-9)],[e.x+Math.cos(angle-.12)*(outer-9),e.y+Math.sin(angle-.12)*(outer-9)]],color);}
    }else if(e.type==='death'){
      for(let i=0;i<6;i++){const angle=i*TAU/6,x=e.x+Math.cos(angle)*age*40,y=e.y+Math.sin(angle)*age*40;poly(c,[[x,y-4],[x+3,y+3],[x-3,y+3]],color);}
    }
    c.restore();
  }
 }
 damageText(c,s){
   for(const e of s.events){if(e.id<=this.lastEvent)continue;if(e.type==='damage')this.floats.push({...e,born:s.tick});}
   this.lastEvent=s.eventId;this.floats=this.floats.filter(e=>s.tick-e.born<52&&s.tick>=e.born);
   const groups=new Map();for(const f of this.floats){const key=`${f.targetId}-${Math.floor(f.born/6)}`;if(groups.has(key))groups.get(key).amount+=f.amount;else groups.set(key,{...f});}
   for(const f of groups.values()){const age=(s.tick-f.born)/52;c.save();c.globalAlpha=Math.min(1,(1-age)*2.5);const big=f.amount>=700;text(c,f.amount.toLocaleString(),f.x+(big?22:-24),f.y-30-(this.reducedMotion?8:age*37),big?20:14,big?'#eee6ff':'#c5b5d5','center',big?700:500);c.restore();}
 }
 annotations(c,s){const recentHit=[...s.events].reverse().find(e=>e.type==='hit'&&s.time-e.time<.45);if(recentHit){c.save();c.globalAlpha=.45-(s.time-recentHit.time);c.strokeStyle='#f15b69';c.lineWidth=10;c.strokeRect(5,5,990,550);c.restore();}
  const selected=s.target();if(selected){text(c,'TARGET',950,60,11,'#9e957e','right',600);text(c,selected.name,950,80,15,'#ded3b7','right',600);}
 }
}
