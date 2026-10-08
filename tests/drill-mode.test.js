import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {flushSync,mount,tick,unmount} from 'svelte';
import App from '../src/App.svelte';
import {createDrill,createMechanic,DEFAULT_DRILL} from '../src/lib/drills.js';
import {DRILL_STORAGE_KEY,saveDrillLibrary} from '../src/lib/drill-storage.js';
import {ArenaRenderer} from '../src/lib/renderer.js';
let app,tools,storageDescriptor;
const $=id=>document.getElementById(id);
const click=id=>{ $(id).click();flushSync(); };
const key=(code,type='keydown',target=$('arena'))=>{const e=new KeyboardEvent(type,{code,bubbles:true,cancelable:true});target.dispatchEvent(e);flushSync();return e;};
const launch=()=>{app=mount(App,{target:document.body});flushSync();};
beforeEach(()=>{storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');localStorage.clear();document.body.replaceChildren();window.confirm=vi.fn(()=>true);document.hidden=false;document.hasFocus=()=>true;tools=new Map();document.modelContext={registerTool(tool){tools.set(tool.name,tool);}};});
afterEach(async()=>{if(app)await unmount(app);app=null;vi.restoreAllMocks();Object.defineProperty(globalThis,'localStorage',storageDescriptor);document.body.replaceChildren();});
test('Fight/Edit fully replaces combat, freezes the run, clears inputs and requires explicit resume', async()=>{
  launch(); click('startBtn');await tick();key('KeyD');expect(app.sim.input.x).toBe(1);
  key('KeyD','keyup');flushSync(()=>app.castSpell('veil-bolt'));app.sim.advance(.3);
  const cast=app.sim.cast;const oldArena=$('arena');click('editMode');
  expect(app.sim.phase).toBe('paused');expect(app.sim.input).toEqual({x:0,y:0});expect(app.sim.cast).toBe(cast);
  expect($('arena')).toBeNull();expect(document.querySelector('.ability-deck')).toBeNull();expect(document.querySelector('.metrics')).toBeNull();
  expect($('helpDialog')).toBeNull();expect($('summaryDialog')).toBeNull();expect(document.querySelector('.drill-editor')).not.toBeNull();
  const before=app.sim.snapshot();app.sim.advance(100);expect(app.sim.snapshot()).toEqual(before);
  expect(app.castSpell('veil-bolt').ok).toBe(false);expect(app.resumeSession().ok).toBe(false);expect(app.startSession().ok).toBe(false);
  key('KeyD','keydown',oldArena);expect(app.sim.input.x).toBe(0);
  click('fightMode');await tick();expect(app.sim.phase).toBe('paused');expect($('arena')).not.toBe(oldArena);
  click('pauseBtn');expect(app.sim.phase).toBe('running');expect(app.sim.cast).toBe(cast);
  app.sim.advance(1.2);expect(app.sim.totalDamage).toBe(1150);
});
test('repeated switches rebind actual canvas rendering and remove transient tooltips',()=>{
  const draw=vi.spyOn(ArenaRenderer.prototype,'draw');launch();
  for(let i=0;i<4;i++){
    document.querySelector('[data-spell="veil-bolt"]').dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}));flushSync();
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    click('editMode');expect(document.querySelector('[role="tooltip"]')).toBeNull();
    click('fightMode');const current=$('arena');expect(draw.mock.instances.at(-1).canvas).toBe(current);
    current.focus();key('Digit1');expect(app.sim.phase).toBe('ready');
  }
  expect(document.querySelectorAll('#arena')).toHaveLength(1);
});
test('selected drill applies only to fresh Start; stopped summary retains exact original definition',async()=>{
  const other=createDrill({id:'other-drill',name:'Council wall',bosses:[{id:'left',name:'Left',x:300,y:150},{id:'right',name:'Right',x:700,y:150}],mechanics:[createMechanic('projectiles',{pattern:'wall'})]});
  saveDrillLibrary([DEFAULT_DRILL,other],DEFAULT_DRILL.id);launch();click('startBtn');app.sim.advance(1);
  $('drillSelect').value=other.id;$('drillSelect').dispatchEvent(new Event('change',{bubbles:true}));flushSync();
  expect(app.sim.drill.id).toBe(DEFAULT_DRILL.id);expect(document.querySelector('.next-drill-note').textContent).toContain('next Start');
  click('stopBtn');const summary=app.sim.summary;expect(summary.drillName).toBe(DEFAULT_DRILL.name);
  click('editMode');click('fightMode');expect(app.sim.summary).toEqual(summary);click('startBtn');
  expect($('summaryDialog').open).toBe(true);expect($('summaryContent').textContent).toContain(DEFAULT_DRILL.name);
  click('restartBtn');expect(app.sim.drill.id).toBe(other.id);expect(app.sim.targets).toHaveLength(2);
  await unmount(app);app=null;launch();expect($('drillSelect').value).toBe(other.id);expect(app.sim.phase).toBe('ready');expect(app.sim.drill.id).toBe(other.id);
});
test('browser tools expose library and mode, reject legacy fields, and cannot cast or resume from Edit',async()=>{
  launch();const read=()=>tools.get('read_training_session').execute({});
  const initial=await read();expect(initial.mode).toBe('fight');expect(initial.drillLibrary).toHaveLength(1);expect(initial.setup.drill.id).toBe(DEFAULT_DRILL.id);
  await expect(tools.get('configure_training_session').execute({mechanics:false})).rejects.toThrow(/Invalid/);
  await tools.get('start_training_session').execute({});flushSync();
  await tools.get('set_training_mode').execute({mode:'edit'});flushSync();
  expect((await read()).mode).toBe('edit');expect((await read()).editorDraft).not.toBeNull();
  expect((await tools.get('resume_training_session').execute({})).ok).toBe(false);
  expect((await tools.get('cast_training_spell').execute({spell:'veil-bolt'})).ok).toBe(false);
  await tools.get('set_training_mode').execute({mode:'fight'});flushSync();expect(app.sim.phase).toBe('paused');
});
test('corrupt browser library leaves stored bytes unchanged and independent setup available',()=>{
  const raw='{"version":999,"drills":[]}';localStorage.setItem(DRILL_STORAGE_KEY,raw);launch();
  expect($('drillNotice').textContent).toContain('could not be restored');expect(localStorage.getItem(DRILL_STORAGE_KEY)).toBe(raw);
  expect(document.querySelectorAll('.ability')).toHaveLength(5);click('startBtn');expect(app.sim.phase).toBe('running');
});
const inputFor=label=>[...document.querySelectorAll('.drill-editor label')].find(node=>node.querySelector('span')?.textContent===label)?.querySelector('input');
function input(label,value){const node=inputFor(label);node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));flushSync();}
function editorButton(label){const button=[...document.querySelectorAll('.drill-editor button')].find(node=>node.textContent.trim()===label);button.click();flushSync();}
test('unsaved draft cannot leave without confirmation and saved edits preserve paused rules until new Start',()=>{
  launch();click('startBtn');app.sim.advance(.4);click('editMode');input('Drill name','My edited drill');input('Player X',350);
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);click('fightMode');expect(document.querySelector('.drill-editor')).not.toBeNull();expect(confirm).toHaveBeenCalledOnce();
  expect(app.sim.drill.name).toBe(DEFAULT_DRILL.name);expect(app.sim.player.x).toBe(500);
  editorButton('Save drill');expect(document.querySelector('.draft-badge').textContent).toContain('Saved');click('fightMode');
  expect(app.sim.phase).toBe('paused');expect(app.sim.drill.name).toBe(DEFAULT_DRILL.name);expect($('drillSelect').selectedOptions[0].textContent).toBe('My edited drill');
  click('stopBtn');expect($('summaryContent').textContent).toContain(DEFAULT_DRILL.name);click('restartBtn');
  expect(app.sim.drill.name).toBe('My edited drill');expect(app.sim.player.x).toBe(350);
});
test('quota failures retain saved edits for the visit and show the export warning',()=>{
  launch();click('editMode');input('Drill name','Memory only');
  const original=localStorage;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>original.getItem(key),setItem(){throw new Error('Quota exceeded');}}});
  editorButton('Save drill');expect($('drillNotice').textContent).toContain('export JSON');
  click('fightMode');expect($('drillSelect').selectedOptions[0].textContent).toBe('Memory only');click('startBtn');expect(app.sim.drill.name).toBe('Memory only');
});
test('safe metrics render exact run denominators and stay frozen through editing',()=>{
  const drill=createDrill({id:'safe-test',name:'Safe metrics',addWaves:[],mechanics:[createMechanic('safe-deadline',{first:0,delay:1,frequency:10,placement:{mode:'player'}}),createMechanic('safe-hold',{first:0,delay:0,duration:2,frequency:10,placement:{mode:'player'}})]});
  expect(saveDrillLibrary([drill],drill.id).ok).toBe(true);launch();expect(app.sim.drill.id).toBe(drill.id);click('startBtn');expect(app.sim.phase).toBe('running');app.sim.advance(2);flushSync(()=>app.renderHud());
  expect($('safeDeadlineCount').textContent).toBe('1 / 1');expect($('safeHoldTime').textContent).toBe('2.0 / 2.0s');
  click('stopBtn');expect(document.querySelector('[data-drill-metric="deadlines"]').textContent).toContain('1 / 1');expect(document.querySelector('[data-drill-metric="hold"]').textContent).toContain('100%');expect($('summaryContent').textContent).toContain('2.00s / 2.00s');
  const summary=app.sim.summary;click('editMode');input('Drill name','Changed safe title');editorButton('Save drill');click('fightMode');click('startBtn');expect(app.sim.summary).toEqual(summary);expect($('summaryContent').textContent).toContain('Safe metrics');
});
