import { WORLD, HZ } from './engine.js';
import {drawSpellIcon,spellReadiness} from './icons.js';
const TAU=Math.PI*2;
const poly=(c,pts,fill,stroke)=>{c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.stroke();}};
function circle(c,x,y,r,fill,stroke,width=1){c.beginPath();c.arc(x,y,Math.max(0,r),0,TAU);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.lineWidth=width;c.strokeStyle=stroke;c.stroke();}}
function text(c,str,x,y,size=14,color='#afbacb',align='center',weight=500){c.font=`${weight} ${size}px "Segoe UI", sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(str,x,y);}
export class ArenaRenderer {
 constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.floats=[];this.lastEvent=0;this.reducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;}
 resize(){const r=this.canvas.getBoundingClientRect();const d=Math.min(globalThis.devicePixelRatio||1,2);const w=Math.round(r.width*d),h=Math.round(r.height*d);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}}
 pointFromClient(clientX,clientY){const r=this.canvas.getBoundingClientRect(),scale=Math.min(r.width/WORLD.width,r.height/WORLD.height),ox=(r.width-WORLD.width*scale)/2,oy=(r.height-WORLD.height*scale)/2;return{x:(clientX-r.left-ox)/scale,y:(clientY-r.top-oy)/scale};}
 draw(s){this.resize();const c=this.ctx,w=this.canvas.width,h=this.canvas.height,scale=Math.min(w/WORLD.width,h/WORLD.height),ox=(w-WORLD.width*scale)/2,oy=(h-WORLD.height*scale)/2;c.setTransform(1,0,0,1,0,0);c.fillStyle='#0d1622';c.fillRect(0,0,w,h);c.setTransform(scale,0,0,scale,ox,oy);this.floor(c,s);
   // Ground telegraphs remain under actors and spells; their heavy outlines are redrawn on top.
   s.hazards.forEach(h=>this.hazard(c,h,s,false));
   [...s.targets].sort((a,b)=>a.y-b.y).forEach(t=>this.target(c,t,s));
   this.magic(c,s);this.player(c,s);s.hazards.forEach(h=>this.hazard(c,h,s,true));
   this.damageText(c,s);this.annotations(c,s);
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
    if(!outline){circle(c,h.x,h.y,h.r,live?'#fa97412e':'#e29b3b12');c.save();c.beginPath();c.arc(h.x,h.y,h.r,0,TAU);c.clip();c.strokeStyle='#f3af5433';c.lineWidth=1;for(let x=h.x-h.r*2;x<h.x+h.r*2;x+=17){c.beginPath();c.moveTo(x,h.y-h.r);c.lineTo(x+h.r*2,h.y+h.r);c.stroke();}c.restore();}
    else{circle(c,h.x,h.y,h.r,null,live?'#ffd39c':'#e8a24c',2.2);if(!live){c.beginPath();c.arc(h.x,h.y,h.r-5,-Math.PI/2,-Math.PI/2+TAU*prog);c.strokeStyle='#ffcd81';c.lineWidth=4;c.stroke();this.warningLabel(c,`${((h.impact-s.tick)/HZ).toFixed(1)}s`,h.x,h.y-h.r-12);} }
   }else{
     c.translate(h.x,h.y);c.rotate(h.angle);const len=1200,half=h.width/2;
     if(!outline){c.fillStyle=live?'#fa974133':'#e29b3b15';c.fillRect(-len,-half,len*2,h.width);c.save();c.beginPath();c.rect(-len,-half,len*2,h.width);c.clip();c.strokeStyle='#f3af5455';c.lineWidth=1;for(let x=-len;x<len;x+=22){c.beginPath();c.moveTo(x,-half);c.lineTo(x+h.width,half);c.stroke();}c.restore();}
     else{c.strokeStyle=live?'#ffd39c':'#edaa54';c.lineWidth=2;c.beginPath();c.moveTo(-len,-half);c.lineTo(len,-half);c.moveTo(-len,half);c.lineTo(len,half);c.stroke();c.setLineDash([8,8]);c.strokeStyle='#ffcc8177';c.lineWidth=2;c.beginPath();c.moveTo(-len,0);c.lineTo(len,0);c.stroke();c.setLineDash([]);c.rotate(-h.angle);if(!live)this.warningLabel(c,`LINE · ${((h.impact-s.tick)/HZ).toFixed(1)}s`,0,-58);}
   }c.restore();
 }
 warningLabel(c,label,x,y){c.font='600 13px "Segoe UI", sans-serif';const width=c.measureText(label).width+18;c.fillStyle='#201b19';c.fillRect(x-width/2,y-14,width,22);text(c,label,x,y+2,13,'#ffd092','center',700);}
 target(c,t,s){
  const selected=s.selectedId===t.id;const dummy=t.kind==='dummy';const brand=t.dots.brand;
  circle(c,t.x,t.y+12,dummy?35:28,'#060a1166');
  if(selected){const r=t.r+14;c.save();c.translate(t.x,t.y);c.strokeStyle='#d9c58f';c.lineWidth=2;for(let a=0;a<TAU;a+=Math.PI/2){c.beginPath();c.arc(0,0,r,a+.2,a+.8);c.stroke();}c.restore();poly(c,[[t.x-5,t.y-t.r-18],[t.x+5,t.y-t.r-18],[t.x,t.y-t.r-12]],'#ead6a0');}
  if(brand){circle(c,t.x,t.y,t.r+6,null,'#ba91e082',2);c.save();c.setLineDash([4,5]);circle(c,t.x,t.y,t.r+10,null,'#a77bdc40',1);c.restore();}
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
  const name=dummy?'SENTINEL':t.name.toUpperCase();text(c,name,t.x,t.y+(dummy?54:59),12,selected?'#e6d5a9':'#a6b1c3','center',600);
  if(brand){text(c,`${Math.max(0,(brand.expires-s.tick)/HZ).toFixed(1)}s`,t.x+t.r+18,t.y+3,12,brand.expires-s.tick<5.4*HZ?'#eed092':'#d4b9eb','left',600);}
 }
 player(c,s){const p=s.player,t=s.target();const a=t?Math.atan2(t.y-p.y,t.x-p.x):0;
  circle(c,p.x,p.y+11,19,'#070c1566');circle(c,p.x,p.y,19,null,'#85dcd64c',1);
  c.save();c.translate(p.x,p.y);c.rotate(a);poly(c,[[19,0],[-10,-10],[-6,0],[-10,10]],'#9be3df','#d9ffff');poly(c,[[6,0],[-8,-6],[-5,0],[-8,6]],'#226874');c.restore();
  if(s.cast){const progress=(s.tick-s.cast.started)/(s.cast.ends-s.cast.started);c.beginPath();c.arc(p.x,p.y,23,-Math.PI/2,-Math.PI/2+TAU*progress);c.strokeStyle=s.cast.kind==='channel'?'#81b8ec':'#b6a2ea';c.lineWidth=3;c.stroke();}
  text(c,'YOU',p.x,p.y+38,11,'#a3d8d8','center',600);
  const ready=[];if(s.proc.charges>0)ready.push('bolt');if(s.shards===3)ready.push(s.loadout==='bloom'?'bloom':'spend');const size=42,gap=8,total=ready.length*size+Math.max(0,ready.length-1)*gap;const y=p.y<105?p.y+53:p.y-65,left=Math.max(8,Math.min(WORLD.width-total-8,p.x-total/2));ready.forEach((id,i)=>drawSpellIcon(c,id,left+i*(size+gap),y,size,{...spellReadiness(s,id),clock:false}));

 }
 magic(c,s){
  if(s.cast?.kind==='channel'){const target=s.target(s.cast.targetId);if(target){const p=s.player;c.save();const g=c.createLinearGradient(p.x,p.y,target.x,target.y);g.addColorStop(0,'#6bc8d5aa');g.addColorStop(1,'#b7a5eacc');c.lineCap='round';c.strokeStyle='#9ca8e918';c.lineWidth=13;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(target.x,target.y);c.stroke();c.strokeStyle=g;c.lineWidth=3;c.stroke();c.strokeStyle='#cedcff9c';c.lineWidth=1;c.stroke();for(let i=0;i<3;i++){const q=((s.time*1.25+i/3)%1);circle(c,p.x+(target.x-p.x)*q,p.y+(target.y-p.y)*q,3,'#bcd7f2');}c.restore();}}
  for(const e of s.effects){let age=(s.tick-e.start)/(e.duration*HZ);if(age<0||age>1)continue;c.save();c.globalAlpha=1-age;
    if(['glass','bolt'].includes(e.type)){const q=Math.min(1,age*3),x=e.fromX+(e.x-e.fromX)*q,y=e.fromY+(e.y-e.fromY)*q;const color=e.type==='glass'?'#b3a3fc':'#dfb9ff';c.strokeStyle=color;c.lineWidth=e.type==='glass'?5:3;c.lineCap='round';c.beginPath();c.moveTo(x-(e.x-e.fromX)*.08,y-(e.y-e.fromY)*.08);c.lineTo(x,y);c.stroke();circle(c,x,y,e.type==='glass'?7:5,color);if(q===1){circle(c,e.x,e.y,14+age*25,null,color,3);}}
    if(e.type==='brand'||e.type==='rift'){circle(c,e.x,e.y,15+age*35,null,e.type==='brand'?'#b194dd':'#e7c48a',2);}
    if(e.type==='bloom'){circle(c,e.x,e.y,e.radius*age,null,'#cfb7f5',3);circle(c,e.x,e.y,e.radius*age,'#ac82df0c');}
    if(e.type==='death'){for(let i=0;i<6;i++){const a=i*TAU/6;poly(c,[[e.x+Math.cos(a)*age*40,e.y+Math.sin(a)*age*40-4],[e.x+Math.cos(a)*age*40+3,e.y+Math.sin(a)*age*40+3],[e.x+Math.cos(a)*age*40-3,e.y+Math.sin(a)*age*40+3]],'#b49ace');}}
    c.restore();
  }
 }
 damageText(c,s){
   for(const e of s.events){if(e.id<=this.lastEvent)continue;if(e.type==='damage')this.floats.push({...e,born:s.tick});}
   this.lastEvent=s.eventId;this.floats=this.floats.filter(e=>s.tick-e.born<52&&s.tick>=e.born);
   const groups=new Map();for(const f of this.floats){const key=`${f.targetId}-${Math.floor(f.born/6)}`;if(groups.has(key))groups.get(key).amount+=f.amount;else groups.set(key,{...f});}
   for(const f of groups.values()){const age=(s.tick-f.born)/52;c.save();c.globalAlpha=Math.min(1,(1-age)*2.5);const big=f.amount>=700;text(c,f.amount.toLocaleString(),f.x+(big?22:-24),f.y-30-(this.reducedMotion?8:age*37),big?20:14,big?'#eee6ff':'#c5b5d5','center',big?700:500);c.restore();}
 }
 annotations(c,s){const recentHit=[...s.events].reverse().find(e=>e.type==='hit'&&s.time-e.time<.45);if(recentHit){c.save();c.globalAlpha=.45-(s.time-recentHit.time);c.strokeStyle='#efa15a';c.lineWidth=10;c.strokeRect(5,5,990,550);c.restore();}
  const selected=s.target();if(selected){text(c,'TARGET',950,60,11,'#9e957e','right',600);text(c,selected.name,950,80,15,'#ded3b7','right',600);}
 }
}
