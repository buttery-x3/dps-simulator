/** Portable, DOM-free combat simulation. Time is integer 60 Hz ticks. */
export const HZ = 60;
export const WORLD = { width: 1000, height: 560, margin: 30 };
export const SPELLS = [
  { id:'brand', key:'Q', name:'Sorrowbrand', short:'Brand', color:'#c697ff', type:'Instant · 18s DoT', detail:'72 on impact, then 240 every 3s. Refresh in the final 5.4s to carry the remaining time forward.', gcd:1.2 },
  { id:'glass', key:'E', name:'Nightglass', short:'Nightglass', color:'#a69cff', type:'1.5s cast · 8s cooldown', detail:'1,050 damage. Generates one void shard. Stand still until the cast lands.', gcd:1.2, cast:1.5, cooldown:8 },
  { id:'thread', key:'R', name:'Gloam Thread', short:'Thread', color:'#8abbf4', type:'3s channel · filler', detail:'180 damage every 0.75s. Moving interrupts it; casting another spell clips the remaining channel.', gcd:1.2, channel:3 },
  { id:'bolt', key:'4', name:'Wraithbolt', short:'Wraithbolt', color:'#dfb7ff', type:'Instant · requires a proc', detail:'760 damage. Brand and Thread ticks can grant a charge. Stores 2 charges for 12s. Use it while moving.', gcd:1.2 },
  { id:'spend', key:'5', name:'Devouring Rift', short:'Rift', color:'#e4cb8c', type:'Instant · 3 void shards', detail:'700 damage, then 300 each second for 6s. Spend three shards before generating more.', gcd:1.2 },
];
const ticks=s=>Math.round(s*HZ), clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export class RaidSim {
  constructor({seed=72821, loadout='rift', mechanics=true}={}) {
    this.seed=seed>>>0 || 1; this.loadout=loadout; this.mechanics=mechanics; this.reset();
  }
  reset() {
    this.rngState=this.seed; this.phase='ready'; this.time=0; this.tick=0; this.accumulator=0;
    this.player={x:500,y:445,r:12,speed:195}; this.input={x:0,y:0};
    this.targets=[{id:'dummy',name:'Eternal sentinel',kind:'dummy',x:500,y:160,r:24,hp:Infinity,maxHp:Infinity,dots:{},born:0}];
    this.selectedId='dummy'; this.gcdUntil=0; this.cooldowns={glass:0};this.cast=null;this.queue=null;
    this.proc={charges:0,until:0};this.shards=0;this.hazards=[];this.effects=[];this.events=[];this.damageEvents=[];
    this.totalDamage=0;this.damageTaken=0;this.hitsTaken=0;this.kills=0;this.escaped=0;this.interrupts=0;this.wastedShards=0;
    this.breakdown={};this.targetDamage={};this.castCounts={};this.brandTargetTicks=0;this.availableTargetTicks=0;
    this.nextWave=ticks(14);this.nextHazard=ticks(6);this.wave=0;this.hazardCount=0;this.eventId=0;this.summary=null;
    this.notice={text:'Keep your DoT on every target. Save instant casts for movement.',kind:'info',until:Infinity};
  }
  rand(){let x=this.rngState;x^=x<<13;x^=x>>>17;x^=x<<5;this.rngState=x>>>0;return this.rngState/4294967296;}
  emit(type,data={}){const e={id:++this.eventId,type,time:this.time,...data};this.events.push(e);if(this.events.length>100)this.events.shift();return e;}
  message(text,kind='info',seconds=2){this.notice={text,kind,until:this.tick+ticks(seconds)};}
  start(){this.reset();this.phase='running';this.emit('start');return true;}
  pause(reason='Paused'){if(this.phase!=='running')return false;this.phase='paused';this.setMovement(0,0);this.pauseReason=reason;this.accumulator=0;return true;}
  resume(){if(this.phase!=='paused')return false;this.phase='running';this.accumulator=0;return true;}
  stop(){if(!['running','paused'].includes(this.phase))return false;this.phase='stopped';this.input={x:0,y:0};this.cast=null;this.queue=null;this.accumulator=0;this.summary=JSON.parse(JSON.stringify(this.metrics()));this.emit('stop');return true;}
  target(id=this.selectedId){return this.targets.find(t=>t.id===id);}
  select(id){if(!this.target(id))return false;this.selectedId=id;this.emit('select',{targetId:id});return true;}
  cycleTarget(){const i=this.targets.findIndex(t=>t.id===this.selectedId);return this.select(this.targets[(i+1)%this.targets.length].id);}
  setMovement(x,y){x=Number.isFinite(x)?clamp(x,-1,1):0;y=Number.isFinite(y)?clamp(y,-1,1):0;const mag=Math.hypot(x,y);this.input={x:mag>1?x/mag:x,y:mag>1?y/mag:y};if((x||y)&&this.cast&&this.phase==='running')this.interrupt('Movement');}
  interrupt(reason){if(!this.cast)return;this.emit('interrupt',{spell:this.cast.spell,reason});this.cast=null;this.interrupts++;this.message(`${reason} interrupted your cast`,'warn',1.8);}
  canCast(id){
    if(this.phase!=='running')return 'Start or resume your session';
    const spell=SPELLS.find(s=>s.id===id);if(!spell)return 'Unknown spell';
    const target=this.target();if(!target)return 'Select a target';
    if(dist(this.player,target)>700)return 'Target is out of range';
    if(this.tick<this.gcdUntil)return 'Global cooldown';
    if(this.cast&&this.cast.kind==='cast')return 'Already casting';
    if((this.input.x||this.input.y)&&(spell.cast||spell.channel))return 'Stand still to cast';
    if(id==='glass'&&this.tick<this.cooldowns.glass)return 'Nightglass is cooling down';
    if(id==='bolt'&&this.proc.charges<1)return 'Waiting for a Wraithbolt proc';
    if(id==='spend'&&this.shards<3)return 'Requires 3 void shards';
    return null;
  }
  use(id,{queue=true}={}){
    const reason=this.canCast(id);
    if(reason){
      const busyUntil=Math.max(this.gcdUntil,this.cast?.kind==='cast'?this.cast.ends:0);
      if(queue&&['Global cooldown','Already casting'].includes(reason)&&busyUntil-this.tick<=ticks(.18)){
        this.queue={id,targetId:this.selectedId,expires:busyUntil+ticks(.12)};return {ok:true,queued:true};
      }
      if(reason!=='Global cooldown')this.message(reason,'warn',1.3);
      return {ok:false,reason};
    }
    this.queue=null;const s=SPELLS.find(s=>s.id===id),target=this.target();
    if(this.cast)this.emit('clip',{spell:this.cast.spell});
    this.cast=null;this.gcdUntil=this.tick+ticks(s.gcd);this.castCounts[id]=(this.castCounts[id]||0)+1;
    this.emit('cast',{spell:id,targetId:target.id});
    if(s.cast||s.channel){this.cast={spell:id,kind:s.cast?'cast':'channel',targetId:target.id,started:this.tick,ends:this.tick+ticks(s.cast||s.channel),nextTick:this.tick+ticks(.75)};}
    else if(id==='brand'){
      this.damage(target,72,'brand');
      const old=target.dots.brand,carry=old?Math.min(ticks(5.4),Math.max(0,old.expires-this.tick)):0;
      target.dots.brand={expires:this.tick+ticks(18)+carry,nextTick:old?.nextTick??this.tick+ticks(3),interval:ticks(3),damage:240};
      this.effect('brand',target,{duration:.6});
    } else if(id==='bolt') {this.proc.charges--;this.damage(target,760,'bolt');this.effect('bolt',target,{duration:.45});}
    else if(id==='spend') {
      this.shards-=3;
      if(this.loadout==='bloom'){
        const victims=this.targets.filter(t=>dist(t,target)<=220);for(const t of victims)this.damage(t,t.id===target.id?1200:900,'bloom');
        this.effect('bloom',target,{duration:.75,radius:220});
      }else{this.damage(target,700,'rift');if(this.target(target.id))target.dots.rift={expires:this.tick+ticks(6),nextTick:this.tick+ticks(1),interval:ticks(1),damage:300};this.effect('rift',target,{duration:.7});}
    }
    return {ok:true};
  }
  effect(type,target,extra={}){this.effects.push({type,x:target.x,y:target.y,fromX:this.player.x,fromY:this.player.y,start:this.tick,duration:.45,...extra});}
  grantProc(){if(this.proc.charges===2)this.emit('proc_overflow');this.proc.charges=Math.min(2,this.proc.charges+1);this.proc.until=this.tick+ticks(12);this.emit('proc',{charges:this.proc.charges});this.message('Wraithbolt ready · instant, cast while moving','proc',2.5);}
  damage(target,amount,spell){
    if(!this.target(target.id))return 0;
    const dealt=target.kind==='dummy'?amount:Math.min(target.hp,amount);
    if(dealt<=0)return 0;target.hp-=dealt;this.totalDamage+=dealt;this.breakdown[spell]=(this.breakdown[spell]||0)+dealt;this.targetDamage[target.id]=(this.targetDamage[target.id]||0)+dealt;
    this.damageEvents.push({tick:this.tick,amount:dealt});this.emit('damage',{targetId:target.id,amount:dealt,spell,x:target.x,y:target.y});
    if(target.hp<=0){this.kills++;this.emit('kill',{targetId:target.id,x:target.x,y:target.y});this.effect('death',target,{duration:.6});this.removeTarget(target.id);}
    return dealt;
  }
  removeTarget(id){this.targets=this.targets.filter(t=>t.id!==id);if(this.selectedId===id){this.selectedId='dummy';this.emit('select',{targetId:'dummy'});}if(this.cast?.targetId===id){this.cast=null;this.emit('target_lost');}}
  spawnWave(){
    const spots=[{x:335,y:140},{x:665,y:160},{x:345,y:275},{x:665,y:275}];this.wave++;
    let created=0;
    for(let n=0;n<2;n++){
      const occupied=this.targets.filter(t=>t.kind==='add');const spot=spots.find(p=>!occupied.some(t=>dist(p,t)<30));if(!spot)break;
      const id=`echo-${this.wave}-${n}`;this.targets.push({id,name:`Echo ${this.wave}.${n+1}`,kind:'add',...spot,r:20,hp:6200,maxHp:6200,dots:{},born:this.tick,expires:this.tick+ticks(40)});created++;
    }
    if(created){this.emit('wave',{count:created});this.message('Priority echoes appeared · spread Sorrowbrand','warn',3);}
  }
  spawnHazard(){
    this.hazardCount++;const type=this.hazardCount%3===0?'line':'circle';
    const h={id:`hazard-${this.hazardCount}`,type,born:this.tick,impact:this.tick+ticks(type==='line'?2.6:2.15),ends:this.tick+ticks(type==='line'?3.15:2.7),hit:false};
    if(type==='circle'){h.x=clamp(this.player.x+(this.rand()-.5)*32,95,905);h.y=clamp(this.player.y+(this.rand()-.5)*32,95,465);h.r=76;}
    else{h.angle=this.rand()>.5?Math.PI/2:0;h.x=this.player.x;h.y=this.player.y;h.width=72;}
    this.hazards.push(h);this.emit('hazard',{type});
    // Later drills sometimes layer a second, clearly telegraphed circle.
    if(this.time>40&&this.hazardCount%4===0)this.hazards.push({id:`hazard-extra-${this.hazardCount}`,type:'circle',born:this.tick,impact:this.tick+ticks(3.1),ends:this.tick+ticks(3.65),hit:false,x:clamp(this.player.x+110,100,900),y:clamp(this.player.y-80,100,460),r:64});
  }
  isHit(h,p=this.player){if(h.type==='circle')return dist(h,p)<h.r+p.r-1;const perpendicular=Math.abs((p.x-h.x)*-Math.sin(h.angle)+(p.y-h.y)*Math.cos(h.angle));return perpendicular<h.width/2+p.r-1;}
  advance(seconds){if(this.phase!=='running'||!Number.isFinite(seconds)||seconds<=0)return;this.accumulator+=seconds*HZ;const steps=Math.floor(this.accumulator+1e-8);this.accumulator-=steps;for(let i=0;i<steps&&this.phase==='running';i++)this.step();}
  step(){
    if(this.phase!=='running')return;this.tick++;this.time=this.tick/HZ;
    const p=this.player;p.x=clamp(p.x+this.input.x*p.speed/HZ,WORLD.margin,WORLD.width-WORLD.margin);p.y=clamp(p.y+this.input.y*p.speed/HZ,WORLD.margin,WORLD.height-WORLD.margin);
    if(this.proc.charges&&this.tick>=this.proc.until){this.proc.charges=0;this.emit('proc_expired');}
    const cast=this.cast;
    if(cast){const target=this.target(cast.targetId);
      if(!target){this.cast=null;}
      else if(cast.kind==='channel'&&this.tick>=cast.nextTick){this.damage(target,180,'thread');this.effect('thread',target,{duration:.16});cast.nextTick+=ticks(.75);if(this.rand()<.1)this.grantProc();}
      if(this.cast===cast&&this.tick>=cast.ends){
        this.cast=null;
        if(cast.kind==='cast'&&target){this.damage(target,1050,'glass');this.cooldowns.glass=this.tick+ticks(8);if(this.shards===3)this.wastedShards++;this.shards=Math.min(3,this.shards+1);this.effect('glass',target,{duration:.55});this.emit('cast_complete',{spell:'glass'});}
      }
    }
    for(const t of [...this.targets]){
      this.availableTargetTicks++;if(t.dots.brand&&t.dots.brand.expires>=this.tick)this.brandTargetTicks++;
      for(const [id,dot] of Object.entries(t.dots)){
        if(this.tick>=dot.nextTick&&dot.nextTick<=dot.expires){this.damage(t,dot.damage,id);if(id==='brand'&&this.rand()<.23)this.grantProc();dot.nextTick+=dot.interval;}
        if(this.tick>=dot.expires)delete t.dots[id];
      }
      if(t.expires&&this.tick>=t.expires&&this.target(t.id)){this.escaped++;this.emit('escape',{targetId:t.id});this.removeTarget(t.id);}
    }
    for(const h of this.hazards){if(!h.hit&&this.tick>=h.impact){h.hit=true;if(this.isHit(h)){this.damageTaken+=1000;this.hitsTaken++;this.emit('hit',{amount:1000});this.message('Ground hit · 1,000 damage taken','warn',2.1);}else this.emit('dodge');}}
    this.hazards=this.hazards.filter(h=>this.tick<h.ends);this.effects=this.effects.filter(e=>this.tick<e.start+ticks(e.duration));
    if(this.tick>=this.nextWave){this.spawnWave();this.nextWave+=ticks(30);}
    if(this.mechanics&&this.tick>=this.nextHazard){this.spawnHazard();this.nextHazard+=ticks(5.2+this.rand()*1.6);}
    // Only retain the rolling window; lifetime totals are tracked separately.
    while(this.damageEvents.length&&this.damageEvents[0].tick<=this.tick-ticks(15))this.damageEvents.shift();
    if(this.queue){if(this.tick>this.queue.expires)this.queue=null;else if(this.tick>=this.gcdUntil&&this.cast?.kind!=='cast'){const q=this.queue;this.selectedId=this.target(q.targetId)?q.targetId:this.selectedId;this.use(q.id,{queue:false});this.queue=null;}}
  }
  metrics(){const duration=this.time,window=Math.min(15,duration);return {seed:this.seed,loadout:this.loadout,mechanics:this.mechanics,elapsed:duration,totalDamage:this.totalDamage,sessionDps:duration?this.totalDamage/duration:0,rollingDps:window?this.damageEvents.reduce((s,e)=>s+e.amount,0)/window:0,rollingSeconds:window,damageTaken:this.damageTaken,hitsTaken:this.hitsTaken,kills:this.kills,escaped:this.escaped,interrupts:this.interrupts,wastedShards:this.wastedShards,brandUptime:this.availableTargetTicks?this.brandTargetTicks/this.availableTargetTicks:0,breakdown:{...this.breakdown},castCounts:{...this.castCounts}};}
  snapshot(){return {phase:this.phase,seed:this.seed,loadout:this.loadout,...this.metrics(),player:{...this.player},selectedId:this.selectedId,targets:this.targets.map(t=>({id:t.id,name:t.name,kind:t.kind,hp:t.kind==='dummy'?null:t.hp,maxHp:t.kind==='dummy'?null:t.maxHp,brandSeconds:t.dots.brand?Math.max(0,(t.dots.brand.expires-this.tick)/HZ):0,riftSeconds:t.dots.rift?Math.max(0,(t.dots.rift.expires-this.tick)/HZ):0})),shards:this.shards,procCharges:this.proc.charges,procSeconds:Math.max(0,(this.proc.until-this.tick)/HZ),gcdSeconds:Math.max(0,(this.gcdUntil-this.tick)/HZ),cast:this.cast?{spell:this.cast.spell,kind:this.cast.kind,remaining:(this.cast.ends-this.tick)/HZ}:null};}
}
