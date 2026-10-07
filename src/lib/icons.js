/** Functional spell sigils and cooldown clocks, shared verbatim by the action bar and arena cues. */
import {HZ} from './engine.js';
export const ICONS={
 brand:{key:'Q',name:'Sorrowbrand',light:'#e2b7ff',mid:'#8452b0',dark:'#291638'},
 glass:{key:'E',name:'Nightglass',light:'#ccd6ff',mid:'#626bc1',dark:'#1a2248'},
 thread:{key:'R',name:'Gloam Thread',light:'#b0edff',mid:'#397faa',dark:'#102d42'},
 bolt:{key:'4',name:'Wraithbolt',light:'#f4c6ff',mid:'#b56acf',dark:'#3d174b'},
 spend:{key:'5',name:'Devouring Rift',light:'#ffe5a2',mid:'#b9974c',dark:'#3b2c12'},
 bloom:{key:'5',name:'Umbral Bloom',light:'#eacbff',mid:'#a875c8',dark:'#342045'},
};
const TAU=Math.PI*2;
function path(c,points,fill=false){c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));if(fill){c.closePath();c.fill();}else c.stroke();}
function ring(c,x,y,r){c.beginPath();c.arc(x,y,r,0,TAU);c.stroke();}
function label(c,value,x,y,size,color='#fff'){c.font=`700 ${size}px "Segoe UI", sans-serif`;c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';c.lineWidth=3;c.strokeStyle='#090d18';c.strokeText(value,x,y);c.fillStyle=color;c.fillText(value,x,y);}
export function spellReadiness(sim,id){const spellId=id==='bloom'?'spend':id;const cooldown=spellId==='glass'?Math.max(0,(sim.cooldowns.glass-sim.tick)/HZ):0;const gcd=Math.max(0,(sim.gcdUntil-sim.tick)/HZ);return{cooldown,cooldownMax:8,gcd,gcdMax:1.2,locked:(spellId==='bolt'&&sim.proc.charges===0)||(spellId==='spend'&&sim.shards<3),ready:spellId==='bolt'&&sim.proc.charges>0?'proc':spellId==='spend'&&sim.shards===3?'resource':null,charges:spellId==='bolt'?sim.proc.charges:0};}
export function drawSpellIcon(c,id,x,y,size,{cooldown=0,cooldownMax=8,gcd=0,gcdMax=1.2,locked=false,ready=null,charges=0,key=true,clock=true}={}){
 const icon=ICONS[id]||ICONS.spend;c.save();c.translate(x,y);c.scale(size/80,size/80);
 c.fillStyle='#090e18';c.fillRect(0,0,80,80);const bg=c.createRadialGradient(40,31,3,40,40,55);bg.addColorStop(0,icon.mid);bg.addColorStop(.5,icon.dark);bg.addColorStop(1,'#101522');c.fillStyle=bg;c.fillRect(3,3,74,74);
 c.strokeStyle=icon.light+'66';c.lineWidth=1;c.strokeRect(6.5,6.5,67,67);
 c.save();c.translate(40,40);c.lineCap='round';c.lineJoin='round';c.strokeStyle=icon.light;c.fillStyle=icon.light;c.lineWidth=4;
 if(id==='brand'){ring(c,0,0,16);c.lineWidth=3;ring(c,0,0,5);for(let i=0;i<3;i++){const a=-Math.PI/2+i*TAU/3;path(c,[[Math.cos(a)*22,Math.sin(a)*22],[Math.cos(a)*29,Math.sin(a)*29]]);} }
 else if(id==='glass'){path(c,[[0,-28],[19,0],[0,27],[-19,0]],true);c.strokeStyle=icon.dark;c.lineWidth=2;path(c,[[0,-19],[0,17]]);path(c,[[-13,-1],[0,7],[13,-1]]);}
 else if(id==='thread'){c.lineWidth=4;for(const dy of [-12,0,12]){c.beginPath();c.moveTo(-25,dy+4);c.bezierCurveTo(-8,dy-16,8,dy+16,25,dy-4);c.stroke();}}
 else if(id==='bolt'){path(c,[[6,-29],[-20,4],[-2,2],[-8,29],[22,-9],[4,-7]],true);}
 else if(id==='bloom'){for(let i=0;i<6;i++){c.save();c.rotate(i*TAU/6);path(c,[[0,-29],[5,-15],[0,-7],[-5,-15]],true);c.restore();}ring(c,0,0,4);}
 else{c.save();c.rotate(-.3);c.lineWidth=5;c.beginPath();c.ellipse(0,0,14,25,0,0,TAU);c.stroke();c.lineWidth=2;c.beginPath();c.ellipse(0,0,21,30,0,-1.0,1.5);c.stroke();c.beginPath();c.ellipse(0,0,21,30,0,Math.PI-1,Math.PI+1.5);c.stroke();c.restore();}
 c.restore();
 if(locked){c.fillStyle='#060b17b0';c.fillRect(3,3,74,74);}
 const fraction=cooldown>0?Math.min(1,cooldown/cooldownMax):Math.min(1,gcd/gcdMax);
 if(clock&&fraction>0){const angle=-Math.PI/2+TAU*(1-fraction);c.save();c.beginPath();c.rect(3,3,74,74);c.clip();c.fillStyle=cooldown>0?'#030814e8':'#081725c7';c.beginPath();c.moveTo(40,40);c.arc(40,40,56,angle,Math.PI*1.5);c.closePath();c.fill();c.strokeStyle=cooldown>0?'#e2e8ff':'#9ae5ed';c.lineWidth=2.5;c.beginPath();c.moveTo(40,40);c.lineTo(40+Math.cos(angle)*57,40+Math.sin(angle)*57);c.stroke();c.restore();}
 c.strokeStyle=ready==='resource'?'#ffe29a':ready==='proc'?'#efc7ff':cooldown>0?'#687c9e':icon.mid;c.lineWidth=ready?4:2;c.strokeRect(2,2,76,76);
 if(gcd>0&&clock){c.strokeStyle='#9ce5ed';c.lineWidth=2;c.beginPath();c.arc(40,40,34,-Math.PI/2+TAU*(1-Math.min(1,gcd/gcdMax)),Math.PI*1.5);c.stroke();}
 if(ready){c.strokeStyle=ready==='resource'?'#fff0c5':'#fae7ff';c.lineWidth=2;for(const [sx,sy,dx,dy] of [[0,0,1,1],[80,0,-1,1],[0,80,1,-1],[80,80,-1,-1]]){path(c,[[sx+dx*13,sy],[sx,sy],[sx,sy+dy*13]]);}}
 if(clock&&(cooldown>0||gcd>0)){label(c,(cooldown>0?cooldown:gcd).toFixed(1),40,45,cooldown>0?25:21,cooldown>0?'#fff':'#c5f9ff');label(c,cooldown>0?'CD':'GCD',40,63,10,cooldown>0?'#d9e3ff':'#9ce5ed');}
 if(key)label(c,icon.key,13,14,15,'#fff');if(charges>0)label(c,String(charges),67,67,14,icon.light);
 c.restore();
}
