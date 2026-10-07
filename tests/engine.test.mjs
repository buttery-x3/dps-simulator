import test from 'node:test';
import assert from 'node:assert/strict';
import {RaidSim,HZ} from '../src/lib/engine.js';
import {ABILITIES,CATALOGUE,DEFAULT_LOADOUT,compileAbility} from '../src/lib/catalogue.js';
const ids={bolt:'veil-bolt',glimmer:'lingering-glimmer',thread:'gloam-thread',flare:'astral-flare',rift:'destructive-rift',pulse:'area-pulse',chain:'chain-strike',focus:'focused-energy'};
const loadout=(a,t={})=>({abilities:a.map(id=>ids[id]||id),talents:Object.fromEntries(Object.entries(t).map(([id,v])=>[ids[id]||id,v]))});
const fresh=(a,t={},o={})=>{const s=new RaidSim({mechanics:false,loadout:a?loadout(a,t):DEFAULT_LOADOUT,...o});s.start();return s;};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const spell=(s,id)=>s.spellMap.get(ids[id]||id),dot=(s,id)=>Object.values(s.target().dots).find(d=>d.spellId===(ids[id]||id));
const finish=(s,id)=>s.advance(Math.max(spell(s,id).activation.duration,spell(s,id).gcd));
const ready=s=>{s.gcdUntil=s.tick;for(const id of Object.keys(s.cooldowns))s.cooldowns[id]=s.tick;};
for(const a of ABILITIES)for(const v of [null,...a.talents.map(t=>t.id)])test(`shared execution: ${a.name} / ${v||'base'}`,()=>{const s=fresh([a.id],v?{[a.id]:v}:{});s.resource.value=3;s.rand=()=>0;s.spawnWave();assert.equal(s.use(a.id).ok,true);s.advance(12);assert.ok(Number.isFinite(s.totalDamage));assert.ok(s.resource.value>=0&&s.resource.value<=3);assert.ok(s.totalDamage>0||a.id===ids.focus);assert.equal(s.cast,null);assert.equal(s.castCounts[a.id],1);});

const singleCastDamage = {
  'veil-bolt': [1150, 640, 1720, 1150],
  'lingering-glimmer': [1440, 1440, 1440, 2880],
  'gloam-thread': [720, 990, 720, 720],
  'astral-flare': [900, 900, 520, 900],
  'destructive-rift': [2400, 2700, 2400, 2400],
  'area-pulse': [1080, 1780, 3600, 650],
  'chain-strike': [520, 520, 240, 520],
  'focused-energy': [0, 0, 0, 0],
};
for (const ability of ABILITIES) for (const [index, talent] of [null, 'v1', 'v2', 'v3'].entries()) {
  test(`exact complete single-target damage: ${ability.name} / ${talent ?? 'base'}`, () => {
    const sim = fresh([ability.id], talent ? {[ability.id]: talent} : {});
    sim.resource.value = 3;
    sim.rand = () => 0;
    assert.equal(sim.use(ability.id).ok, true);
    sim.advance(40);
    assert.equal(sim.totalDamage, singleCastDamage[ability.id][index]);
    assert.equal(sim.castCounts[ability.id], 1);
    assert.equal(sim.cast, null);
    assert.deepEqual(sim.target().dots, {});
  });
}

test('Veil base uses the heavy hit/cooldown; Light Veil remains freely repeatable', () => {
  const base = fresh(['bolt']);
  assert.equal(base.use(ids.bolt).ok, true);
  base.advance(1.5 - 1 / HZ);
  assert.equal(base.totalDamage, 0);
  assert.equal(base.cooldowns[ids.bolt], 0);
  base.advance(1 / HZ);
  assert.equal(base.totalDamage, 1150);
  assert.equal(base.cooldowns[ids.bolt], 7.5 * HZ);
  assert.match(base.use(ids.bolt).reason, /cooling/);
  base.advance(6 - 1 / HZ);
  assert.match(base.use(ids.bolt).reason, /cooling/);
  base.advance(1 / HZ);
  assert.equal(base.use(ids.bolt).ok, true);
  finish(base, 'bolt');
  assert.equal(base.totalDamage, 2300);
  assert.equal(base.time, 9);

  const light = fresh(['bolt'], {bolt: 'v1'});
  for (let cast = 1; cast <= 3; cast++) {
    assert.equal(light.use(ids.bolt).ok, true);
    finish(light, 'bolt');
    assert.equal(light.totalDamage, cast * 640);
    assert.equal(light.cooldowns[ids.bolt], light.tick);
  }
});

test('Lingering Touch keeps its explicit hit and DoT with inherited cooldown and refresh carry', () => {
  const sim = fresh(['bolt'], {bolt: 'v2'});
  assert.equal(sim.use(ids.bolt).ok, true);
  finish(sim, 'bolt');
  assert.equal(sim.totalDamage, 640);
  assert.equal(sim.cooldowns[ids.bolt] - sim.tick, 6 * HZ);
  assert.ok(dot(sim, 'bolt').maintenance);
  assert.equal(dot(sim, 'bolt').expires, 19.5 * HZ);
  assert.match(sim.use(ids.bolt).reason, /cooling/);
  sim.advance(3);
  assert.equal(sim.totalDamage, 820);
  sim.advance(3);
  assert.equal(sim.use(ids.bolt).ok, true);
  const nextTick = dot(sim, 'bolt').nextTick;
  finish(sim, 'bolt');
  assert.equal(sim.totalDamage, 1640);
  assert.equal(dot(sim, 'bolt').nextTick, nextTick);
  assert.equal(dot(sim, 'bolt').expires - sim.tick, 23.4 * HZ);
});

test('Charged Veil keeps the heavy hit/cooldown and rolls 20% only on completed hits', () => {
  const sim = fresh(['bolt'], {bolt: 'v3'});
  let rolls = 0;
  sim.rand = () => { rolls++; return .199; };
  assert.equal(sim.use(ids.bolt).ok, true);
  sim.advance(.2); sim.setMovement(1, 0);
  assert.equal(rolls, 0);
  assert.equal(sim.totalDamage, 0);
  assert.equal(sim.cooldowns[ids.bolt], 0);
  sim.setMovement(0, 0); sim.advance(1);
  assert.equal(sim.use(ids.bolt).ok, true);
  finish(sim, 'bolt');
  assert.equal(sim.totalDamage, 1150);
  assert.equal(sim.resource.value, 1);
  assert.equal(rolls, 1);
  assert.equal(sim.cooldowns[ids.bolt] - sim.tick, 6 * HZ);
  assert.equal(sim.use(ids.bolt).ok, false);
  sim.advance(6);
  sim.rand = () => { rolls++; return .2; };
  assert.equal(sim.use(ids.bolt).ok, true);
  finish(sim, 'bolt');
  assert.equal(sim.totalDamage, 2300);
  assert.equal(sim.resource.value, 1);
  assert.equal(rolls, 2);
});

test('queued Veil repeats cannot bypass inherited cooldowns; Light Veil queues normally', () => {
  for (const talent of [null, 'v1', 'v2', 'v3']) {
    const sim = fresh(['bolt'], talent ? {bolt: talent} : {});
    assert.equal(sim.use(ids.bolt).ok, true);
    sim.advance(1.4);
    assert.equal(sim.use(ids.bolt).queued, true);
    sim.advance(.1);
    assert.equal(sim.queue, null);
    assert.equal(sim.castCounts[ids.bolt], talent === 'v1' ? 2 : 1);
    assert.equal(Boolean(sim.cast), talent === 'v1');
    assert.equal(sim.cooldowns[ids.bolt] - sim.tick, talent === 'v1' ? 0 : 6 * HZ);
  }
});

test('Refreshing Rift resets the new base Veil cooldown through the shared reset handler', () => {
  const sim = fresh(['bolt', 'rift'], {rift: 'v3'});
  sim.resource.value = 3;
  sim.use(ids.bolt); finish(sim, 'bolt');
  assert.match(sim.use(ids.bolt).reason, /cooling/);
  assert.equal(sim.use(ids.rift).ok, true);
  finish(sim, 'rift');
  assert.equal(sim.cooldowns[ids.bolt], sim.tick);
  assert.equal(sim.use(ids.bolt).ok, true);
  finish(sim, 'bolt');
  assert.equal(sim.totalDamage, 4700);
});
test('Glimmer instant DoT, exact schedule and capped carry, no impact damage',()=>{const s=fresh(['glimmer']);s.use(ids.glimmer);const d=dot(s,'glimmer'),next=d.nextTick;assert.equal(s.totalDamage,0);s.advance(1.2);s.use(ids.glimmer);assert.equal(dot(s,'glimmer').nextTick,next);assert.equal(dot(s,'glimmer').expires-s.tick,18*HZ+5.4*HZ);s.advance(1.8);assert.equal(s.totalDamage,240);});
test('Lingering Resource rolls only periodic ticks at 2%',()=>{const s=fresh(['glimmer'],{glimmer:'v1'});let rolls=0;s.rand=()=>{rolls++;return .0199};s.use(ids.glimmer);assert.equal(rolls,0);s.advance(3);assert.equal(rolls,1);assert.equal(s.resource.value,1);s.rand=()=>.02;s.advance(3);assert.equal(s.resource.value,1);});
test('Astral Refresh rolls ON CAST, resets CD or restores precisely one stored charge',()=>{const s=fresh(['glimmer','flare'],{glimmer:'v2'});s.use(ids.flare);s.advance(1.2);let rolls=0;s.rand=()=>{rolls++;return .499};s.use(ids.glimmer);assert.equal(s.cooldowns[ids.flare],s.tick);assert.equal(rolls,1);s.advance(6);assert.equal(rolls,1);const c=fresh(['glimmer','flare'],{glimmer:'v2',flare:'v3'});c.use(ids.flare);c.advance(1.2);c.use(ids.flare);c.advance(1.2);assert.equal(c.spellCharges[ids.flare].current,1);c.rand=()=>0;c.use(ids.glimmer);assert.equal(c.spellCharges[ids.flare].current,2);assert.ok(c.spellCharges[ids.flare].nextRecharge>c.tick);});
test('Linger Longer doubles total ticks with unchanged damage',()=>{const b=fresh(['glimmer']),l=fresh(['glimmer'],{glimmer:'v3'});b.use(ids.glimmer);l.use(ids.glimmer);assert.equal(dot(l,'glimmer').duration,2*dot(b,'glimmer').duration);assert.equal(dot(l,'glimmer').amount,dot(b,'glimmer').amount);b.advance(36);l.advance(36);assert.equal(l.totalDamage,2*b.totalDamage);});
test('Thread four ticks, ramping ticks, guaranteed completion and no clipped reward',()=>{const b=fresh(['thread']);b.use(ids.thread);b.advance(3);assert.equal(b.totalDamage,720);const r=fresh(['thread'],{thread:'v1'});r.use(ids.thread);r.advance(3);assert.deepEqual(r.events.filter(e=>e.type==='damage').map(e=>e.amount),[180,225,270,315]);const s=fresh(['thread'],{thread:'v2'});s.rand=()=>.999;s.use(ids.thread);s.advance(2.9);s.setMovement(1,0);s.advance(1);assert.equal(s.resource.value,0);s.setMovement(0,0);s.use(ids.thread);s.advance(3);assert.equal(s.resource.value,1);});
test('Twin Threads damages only nearest secondary for 50%',()=>{const s=fresh(['thread'],{thread:'v3'});s.spawnWave();s.spawnWave();s.use(ids.thread);s.advance(.75);assert.deepEqual(s.events.filter(e=>e.type==='damage').map(e=>e.amount),[180,90]);});
test('Flare instant eight-second cooldown; 50% resource; mobile cast',()=>{const b=fresh(['flare']);b.use(ids.flare);assert.equal(b.totalDamage,900);assert.equal(b.cooldowns[ids.flare],8*HZ);const g=fresh(['flare'],{flare:'v1'});g.rand=()=>.499;g.use(ids.flare);assert.equal(g.resource.value,1);g.advance(8);g.rand=()=>.5;g.use(ids.flare);assert.equal(g.resource.value,1);const m=fresh(['flare'],{flare:'v2'});m.setMovement(1,0);assert.equal(m.use(ids.flare).ok,true);m.advance(.5);m.setMovement(-1,0);assert.ok(m.cast);m.advance(.7);assert.equal(m.totalDamage,520);assert.equal(m.interrupts,0);assert.ok(m.cooldowns[ids.flare]<=m.tick);});
test('stored charges serially recharge separately from resource and never expire',()=>{const s=fresh(['flare'],{flare:'v3'});s.resource.value=2;for(let i=0;i<3;i++){s.use(ids.flare);s.advance(1.2);}assert.equal(s.spellCharges[ids.flare].current,0);assert.equal(s.resource.value,2);assert.match(s.use(ids.flare).reason,/stored spell charges/);s.advance(6.4);assert.equal(s.spellCharges[ids.flare].current,1);s.advance(10);assert.equal(s.spellCharges[ids.flare].current,2);s.advance(10);assert.equal(s.spellCharges[ids.flare].current,3);assert.equal(s.spellCharges[ids.flare].nextRecharge,0);});
test('Rift requires/reserves three and refunds interrupted cast',()=>{const s=fresh(['rift']);s.resource.value=2;assert.match(s.use(ids.rift).reason,/Requires 3 Astral charges/);s.resource.value=3;s.use(ids.rift);assert.equal(s.resource.value,0);s.advance(.5);s.setMovement(1,0);assert.equal(s.resource.value,3);assert.equal(s.totalDamage,0);s.setMovement(0,0);ready(s);s.use(ids.rift);finish(s,'rift');assert.equal(s.resource.value,0);assert.equal(s.totalDamage,2400);});
test('Devouring consumes current 1–3, instant periodic-only scaled damage',()=>{for(const n of [1,2,3]){const s=fresh(['rift'],{rift:'v1'});assert.match(s.use(ids.rift).reason,/Requires 1 Astral charge$/);s.resource.value=n;s.use(ids.rift);assert.equal(s.resource.value,0);assert.equal(s.totalDamage,0);assert.equal(dot(s,'rift').amount,150*n);s.advance(6);assert.equal(s.totalDamage,900*n);}});
test('Chaos uses ONE equal25% roll retaining 0/1/2/3',()=>{for(const [roll,n] of [[0,0],[.249999,0],[.25,1],[.499999,1],[.5,2],[.749999,2],[.75,3],[.99999,3]]){const s=fresh(['rift'],{rift:'v2'});let rolls=0;s.rand=()=>{rolls++;return roll};s.resource.value=3;s.use(ids.rift);finish(s,'rift');assert.equal(rolls,1);assert.equal(s.resource.value,n);}});
test('Refreshing Rift fully restores charges/CDs and only existing DoTs across live targets without immediate ticks',()=>{const s=fresh(['rift','flare','glimmer','focus'],{rift:'v3',flare:'v3'});s.spawnWave();s.use(ids.glimmer);s.advance(1.2);s.select(s.targets[1].id);s.use(ids.glimmer);s.advance(1.2);s.select('dummy');s.use(ids.flare);s.advance(1.2);s.use(ids.flare);s.advance(1.2);s.use(ids.focus);s.advance(1.2);s.resource.value=3;s.use(ids.rift);s.advance(1.35);assert.equal(s.spellCharges[ids.flare].current,3);assert.equal(s.spellCharges[ids.flare].nextRecharge,0);assert.ok(s.cooldowns[ids.focus]<=s.tick);for(const t of s.targets.slice(0,2))for(const d of Object.values(t.dots))assert.equal(d.expires,s.tick+d.duration);assert.equal(Object.keys(s.targets[2].dots).length,0);assert.equal(s.events.filter(e=>e.type==='cast'&&e.spell===ids.glimmer).length,2);});
test('Pulse base clusters vs spread; cast hybrid; interrupted channel commits cooldown; charge burst smaller area',()=>{const b=fresh(['pulse'],{},{layout:'clustered'});b.spawnWave();b.use(ids.pulse);assert.equal(b.totalDamage,0);assert.ok(b.targets.every(t=>Object.keys(t.dots).length));b.advance(2);assert.equal(b.totalDamage,540);const sp=fresh(['pulse']);sp.spawnWave();sp.use(ids.pulse);assert.equal(sp.targets.filter(t=>Object.keys(t.dots).length).length,1);const c=fresh(['pulse'],{pulse:'v1'});c.use(ids.pulse);assert.equal(c.totalDamage,0);finish(c,'pulse');assert.equal(c.totalDamage,700);assert.ok(dot(c,'pulse'));const ch=fresh(['pulse'],{pulse:'v2'});ch.use(ids.pulse);ch.advance(1.5);assert.equal(ch.totalDamage,1350);ch.setMovement(1,0);ch.setMovement(0,0);assert.match(ch.use(ids.pulse).reason,/cooling/);const d=ch.totalDamage;ch.advance(5);assert.equal(ch.totalDamage,d);const q=fresh(['pulse'],{pulse:'v3'});q.use(ids.pulse);assert.equal(q.totalDamage,650);assert.equal(Object.keys(q.target().dots).length,0);assert.equal(q.spellCharges[ids.pulse].current,2);assert.ok(spell(q,'pulse').targeting.radius<compileAbility(ids.pulse).targeting.radius);});
test('Chain up to3 additional reachable targets, resource rolls per hit at10%',()=>{const s=fresh(['chain'],{chain:'v3'},{layout:'clustered'});s.spawnWave();s.spawnWave();let rolls=0;s.rand=()=>{rolls++;return .099};s.use(ids.chain);finish(s,'chain');assert.equal(s.events.filter(e=>e.type==='damage').length,4);assert.equal(rolls,4);assert.equal(s.resource.value,3);assert.equal(s.wastedShards,1);});
test('Binding copies10% to each linked target; overlapping links cannot recurse/proc resource',()=>{const s=fresh(['chain','glimmer'],{chain:'v1',glimmer:'v1'},{layout:'clustered'});s.spawnWave();s.spawnWave();s.use(ids.chain);finish(s,'chain');assert.equal(s.links.length,1);assert.equal(s.links[0].targetIds.length,3);const primary=s.target(),second=s.target(s.links[0].targetIds[0]);s.select(second.id);s.use(ids.chain);finish(s,'chain');assert.equal(s.links.length,2);s.rand=()=>0;const before=s.totalDamage;s.damage(primary,100,'probe');near(s.totalDamage-before,130);assert.equal(s.resource.value,0);s.advance(10);const after=s.totalDamage;s.damage(primary,100,'probe');assert.equal(s.totalDamage-after,100);});
test('Lingering Chains refreshes only existing Glimmer/Touch on hits, not other DoTs or bare targets',()=>{const s=fresh(['chain','glimmer','bolt','rift'],{chain:'v2',bolt:'v2',rift:'v1'});s.spawnWave();s.use(ids.glimmer);s.advance(1.2);s.use(ids.bolt);finish(s,'bolt');s.resource.value=1;s.use(ids.rift);s.advance(1.2);const expires=dot(s,'rift').expires;s.use(ids.chain);finish(s,'chain');for(const d of Object.values(s.target().dots).filter(d=>d.maintenance))assert.equal(d.expires,s.tick+d.duration);assert.equal(dot(s,'rift').expires,expires);assert.equal(Object.keys(s.targets[1].dots).length,0);assert.equal((s.cooldowns[ids.chain]-s.tick)/HZ,10);});
test('Focus10%/20% cast and GCD reduction, channels/ticks unchanged, expires at15s',()=>{for(const [t,f] of [[null,.9],['v1',.8]]){const s=fresh(['focus','bolt','thread','glimmer'],t?{focus:t}:{});s.use(ids.focus);assert.equal(s.totalDamage,0);s.advance(1.2);s.use(ids.bolt);near((s.cast.ends-s.tick)/HZ,Math.round(1.5*f*HZ)/HZ);near(s.gcdDuration,Math.round(1.2*f*HZ)/HZ);finish(s,'bolt');s.use(ids.thread);assert.equal((s.cast.ends-s.tick)/HZ,3);s.advance(3);s.use(ids.glimmer);assert.equal(dot(s,'glimmer').interval,3*HZ);s.advance(15-s.time);assert.equal(Object.keys(s.buffs).length,0);}});
test('Focus shorter60sCD, double resource gains current buff state, overcap',()=>{const b=fresh(['focus'],{focus:'v2'});b.use(ids.focus);assert.equal(b.cooldowns[ids.focus],60*HZ);const s=fresh(['focus','thread'],{focus:'v3',thread:'v2'});s.use(ids.focus);s.advance(1.2);s.use(ids.thread);s.advance(3);assert.equal(s.resource.value,2);s.use(ids.thread);s.advance(3);assert.equal(s.resource.value,3);assert.equal(s.wastedShards,1);s.advance(15-s.time);s.resource.value=0;s.use(ids.thread);s.advance(3);assert.equal(s.resource.value,1);});
test('full completion resource still granted if final channel tick kills target',()=>{const s=fresh(['thread'],{thread:'v2'});s.spawnWave();const add=s.targets[1];add.hp=720;s.select(add.id);s.use(ids.thread);s.advance(3);assert.equal(s.kills,1);assert.equal(s.resource.value,1);assert.equal(s.events.filter(e=>e.type==='cast_complete').length,1);});
test('pooled coverage includes initial delay and all live add time for each selected maintenance DoT',()=>{const s=fresh(['glimmer','bolt'],{bolt:'v2'});s.advance(2);s.use(ids.glimmer);s.advance(2);assert.equal(s.metrics().coverageDetails.length,2);near(s.metrics().dotCoverage,.25);s.spawnWave();s.advance(2);const m=s.metrics();assert.ok(m.coverageDetails.every(e=>e.availableTicks===10*HZ));near(m.dotCoverage,(4*HZ)/(2*10*HZ));const n=fresh(['bolt']);n.advance(2);assert.equal(n.metrics().dotCoverage,null);});
test('DoTs continue after selection changes; overkill excluded; target death cancels cast',()=>{const s=fresh(['glimmer','bolt']);s.spawnWave();const add=s.targets[1];s.select(add.id);s.use(ids.glimmer);s.advance(1.2);s.select('dummy');s.use(ids.glimmer);s.advance(1.8);assert.equal(add.hp,5960);s.select(add.id);s.use(ids.bolt);const before=s.totalDamage;s.damage(add,99999,'probe');assert.equal(s.totalDamage-before,5960);s.advance(3);assert.equal(s.cast,null);assert.equal(s.selectedId,'dummy');assert.equal(s.kills,1);});
test('links copy actual damage not overkill',()=>{const s=fresh(['chain'],{chain:'v1'});s.spawnWave();const a=s.targets[1];s.select(a.id);s.use(ids.chain);finish(s,'chain');a.hp=50;const before=s.totalDamage;s.damage(a,500,'probe');near(s.totalDamage-before,60);assert.equal(s.kills,1);});
test('instant clips channel after GCD without completion reward',()=>{const s=fresh(['thread','glimmer'],{thread:'v2'});s.use(ids.thread);s.advance(1.2);s.use(ids.glimmer);assert.equal(s.cast,null);assert.equal(s.resource.value,0);assert.equal(s.totalDamage,180);});
test('two stationary adds arrive14s and fade40s later',()=>{const s=fresh();s.advance(14);assert.equal(s.targets.length,3);const t={...s.targets[1]};s.advance(5);assert.equal(s.targets[1].x,t.x);assert.equal(s.targets[1].y,t.y);s.advance(35);assert.equal(s.escaped,2);assert.equal(s.targets.length,3);});
test('circle/line actual radius collision once per impact and ample dodge time',()=>{const s=fresh();s.hazards=[{type:'circle',x:s.player.x,y:s.player.y,r:76,born:0,impact:60,ends:90,hit:false}];s.advance(1);assert.equal(s.damageTaken,1000);s.advance(.5);assert.equal(s.damageTaken,1000);assert.equal(s.hazards.length,0);assert.equal(s.isHit({type:'circle',x:0,y:0,r:76},{x:88,y:0,r:12}),false);assert.equal(s.isHit({type:'circle',x:0,y:0,r:76},{x:86,y:0,r:12}),true);assert.equal(s.isHit({type:'line',angle:0,x:0,y:0,width:72},{x:700,y:46,r:12}),true);const d=fresh(undefined,{},{mechanics:true});d.advance(6);d.setMovement(-1,0);d.advance(2.2);assert.equal(d.damageTaken,0);});
test('pause freezes all time and stop preserves summary until next start despite setup edits',()=>{const s=fresh(['glimmer','focus']);s.use(ids.glimmer);s.advance(1.2);s.use(ids.focus);s.advance(2.8);s.pause();const snap=JSON.stringify(s.snapshot());s.advance(90);assert.equal(JSON.stringify(s.snapshot()),snap);s.resume();s.advance(2);s.stop();const summary=JSON.stringify(s.summary);s.advance(100);s.configureLoadout(loadout(['bolt']));assert.equal(JSON.stringify(s.summary),summary);assert.equal(JSON.stringify(s.metrics()),summary);assert.equal(s.phase,'stopped');s.start();assert.equal(s.totalDamage,0);assert.equal(s.summary,null);assert.equal(s.time,0);});
test('exact session/rolling DPS including time-zero event at exact15s cutoff',()=>{const s=fresh();s.damage(s.target(),1500,'probe');s.advance(5);near(s.metrics().sessionDps,300);near(s.metrics().rollingDps,300);s.advance(10);assert.equal(s.metrics().rollingDps,0);near(s.metrics().sessionDps,100);s.damage(s.target(),300,'probe');near(s.metrics().rollingDps,20);s.advance(1);near(s.metrics().sessionDps,112.5);});
test('seed reproducibility across frame chunk sizes',()=>{const a=fresh(undefined,{},{seed:188,mechanics:true}),b=fresh(undefined,{},{seed:188,mechanics:true});a.use(ids.glimmer);b.use(ids.glimmer);a.advance(10);for(let i=0;i<600;i++)b.advance(1/60);assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.hazards,b.hazards);});
test('movement normalized/bounded, invalid time ignored, mid-session setup blocked',()=>{const s=fresh();s.setMovement(1,1);near(Math.hypot(s.input.x,s.input.y),1);s.advance(100);assert.equal(s.player.x,970);assert.equal(s.player.y,530);const t=s.time;s.advance(NaN);s.advance(-2);assert.equal(s.time,t);assert.throws(()=>s.configureLoadout(DEFAULT_LOADOUT),/Stop/);});
test('short queue captures target at queue time',()=>{const s=fresh(['glimmer','bolt']);s.spawnWave();s.use(ids.glimmer);s.advance(1.1);s.select(s.targets[1].id);assert.equal(s.use(ids.bolt).queued,true);s.select('dummy');s.advance(.1);assert.equal(s.cast.spell,ids.bolt);assert.equal(s.cast.targetId,s.targets[1].id);});
test('ninth data-only spell runs without an ability-ID branch',()=>{const catalogue=JSON.parse(JSON.stringify(CATALOGUE)),a=JSON.parse(JSON.stringify(catalogue.abilities[0]));a.id='test-comet';a.name='Test Comet';catalogue.abilities.push(a);const s=fresh(['test-comet'],{'test-comet':'v3'},{catalogue});s.rand=()=>0;s.use('test-comet');s.advance(3);assert.equal(s.totalDamage,1150);assert.equal(s.resource.value,1);});
test('periodic-trigger effects retain original consumed-resource context',()=>{const catalogue=JSON.parse(JSON.stringify(CATALOGUE));const a=catalogue.abilities.find(a=>a.id===ids.rift);a.talents[0].patch.triggers=[{event:'periodicTick',chance:1,effects:[{type:'damage',amount:10,perResource:true}]}];const s=fresh(['rift'],{rift:'v1'},{catalogue});s.resource.value=3;s.use(ids.rift);s.advance(1);assert.equal(s.totalDamage,480);});
test('chain stops when no further target is within jump range while AoE requires a cluster',()=>{const s=fresh(['chain','pulse']);s.spawnWave();s.spawnWave();const chain=s.selectVictims(spell(s,'chain'),'dummy'),area=s.selectVictims(spell(s,'pulse'),'dummy');assert.equal(chain.length,3);assert.equal(area.length,1);});

test('Astral charge wording preserves resource snapshot and legacy metric aliases', () => {
  const s = fresh(['rift']);
  assert.equal(s.resource.label, 'Astral charges');
  assert.equal(s.canCast(ids.rift), 'Requires 3 Astral charges');
  s.shards = 2;
  assert.equal(s.resource.value, 2);
  assert.equal(s.shards, 2);
  assert.equal(s.snapshot().resource.label, 'Astral charges');
  assert.equal(s.metrics().wastedShards, 0);
  const flexible = fresh(['rift'], {rift: 'v1'});
  assert.equal(flexible.canCast(ids.rift), 'Requires 1 Astral charge');
});
