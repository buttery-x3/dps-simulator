import {SPELLS} from './engine.js';

export function registerTrainingTools(context, actions) {
 const {sim, startSession, pauseSession, resumeSession, stopSession, configure, selectTarget, castSpell} = actions;
 if (!context?.registerTool) return () => {};
 const lifecycle=new AbortController();const obj=(input,keys)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))throw new Error('Invalid tool input.');return input;};const register=(name,description,inputSchema,execute,readOnly=false)=>{try{Promise.resolve(context.registerTool({name,description,inputSchema,annotations:{readOnlyHint:readOnly,untrustedContentHint:false},execute:async(input)=>execute(input)},{signal:lifecycle.signal})).catch(()=>{});}catch{}};
 const empty={type:'object',properties:{},additionalProperties:false};
 register('read_training_session','Read current real-time training state and exact metrics. Does not advance time.',empty,input=>{obj(input,[]);return sim.snapshot();},true);
 register('start_training_session','Start a new session using the current setup. Resets prior results. Runs only at real-time speed in a visible page.',empty,input=>{obj(input,[]);if(['running','paused'].includes(sim.phase))throw new Error('A session is already active.');return startSession();});
 register('pause_training_session','Pause the current session and its clock.',empty,input=>{obj(input,[]);if(sim.phase!=='running')throw new Error('No running session.');return pauseSession();});
 register('resume_training_session','Resume the paused session at real-time speed in a visible page.',empty,input=>{obj(input,[]);if(sim.phase!=='paused')throw new Error('No paused session.');return resumeSession();});
 register('stop_training_session','Stop the active session and show the preserved summary.',empty,input=>{obj(input,[]);return stopSession();});
 register('configure_training_session','Set loadout, reproducible seed, and ground mechanics before starting a session.',{type:'object',properties:{seed:{type:'integer',minimum:1,maximum:4294967295},loadout:{type:'string',enum:['rift','bloom']},mechanics:{type:'boolean'}},additionalProperties:false},input=>configure(obj(input,['seed','loadout','mechanics'])));
 register('select_training_target','Select a live target from the session snapshot.',{type:'object',properties:{targetId:{type:'string'}},required:['targetId'],additionalProperties:false},input=>{obj(input,['targetId']);if(typeof input.targetId!=='string'||!sim.target(input.targetId))throw new Error('Target does not exist.');return selectTarget(input.targetId);});
 register('cast_training_spell','Attempt one spell: brand=Q, glass=E, thread=R, bolt=4, spend=5. Respects the live global cooldown, cast, movement, resources, and proc rules.',{type:'object',properties:{spell:{type:'string',enum:SPELLS.map(s=>s.id)}},required:['spell'],additionalProperties:false},input=>{obj(input,['spell']);if(!SPELLS.some(s=>s.id===input.spell))throw new Error('Unknown spell.');return castSpell(input.spell);});

 return () => lifecycle.abort();
}
