import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {flushSync, mount, unmount} from 'svelte';
import {fromStore, writable} from 'svelte/store';
import DrillEditor from '../src/components/DrillEditor.svelte';
import {DEFAULT_DRILL, DRILL_LIMITS, createDrill, createAddWave, validateDrill} from '../src/lib/drills.js';
import {MAX_DRILL_IMPORT_BYTES} from '../src/lib/drill-storage.js';

let editor, state, changes, selections, notice;
const copy = value => JSON.parse(JSON.stringify(value));
const buttons = () => [...document.querySelectorAll('button')];
const labeled = text => document.querySelector(`[aria-label="${text}"]`);
const button = text => buttons().find(item => item.textContent.trim() === text);
const field = text => [...document.querySelectorAll('label.field')].find(item => item.querySelector('span')?.textContent === text)?.querySelector('input,select,textarea');
const tap = element => { expect(element).toBeTruthy(); element.click(); flushSync(); };
const input = (element, value) => { expect(element).toBeTruthy(); element.value = value; element.dispatchEvent(new Event('input', {bubbles: true})); flushSync(); };
const select = (element, value) => { element.value = value; element.dispatchEvent(new Event('change', {bubbles: true})); flushSync(); };
function launch(library = [copy(DEFAULT_DRILL)], selectedId = library[0].id) {
  state = fromStore(writable({library, selectedId}));
  changes = vi.fn((library, selectedId) => { state.current = {library, selectedId}; });
  selections = vi.fn(selectedId => { state.current = {...state.current, selectedId}; });
  notice = vi.fn();
  editor = mount(DrillEditor, {target: document.body, props: {get library() { return state.current.library; }, get selectedId() { return state.current.selectedId; }, onlibrarychange: changes, onselect: selections, onnotice: notice}});
  flushSync();
}
function importText(text) { if (!document.querySelector('textarea')) tap(button('Import JSON')); input(document.querySelector('textarea'), text); tap(button('Validate & import')); }
function pointer(canvas, type, x, y) { canvas.dispatchEvent(new PointerEvent(type, {clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true})); flushSync(); }

beforeEach(() => { document.body.replaceChildren(); window.confirm = vi.fn().mockReturnValue(true); URL.createObjectURL ??= () => ''; URL.revokeObjectURL ??= () => {};  });
afterEach(async () => { if (editor) await unmount(editor); editor = null; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('drill editing and library', () => {
  test('mounts a cloned saved drill with all editing groups, no automatic writes', () => {
    launch();
    expect(editor.getDraft()).toMatchObject({drill: DEFAULT_DRILL, dirty: false, valid: true});
    expect(document.querySelector('canvas')).toBeTruthy();
    expect(document.querySelector('[aria-label="Placement tools"]')).toBeTruthy();
    expect(field('Random seed').value).toBe(String(DEFAULT_DRILL.seed));
    expect(button('Save drill').disabled).toBe(true);
    for (const input of document.querySelectorAll('input[type=number]')) expect(input.validity.valid).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Resume keeps your captured session');
  });

  test('valid imported fractional coordinates and timings stay valid in native inputs', () => {
    const drill = copy(DEFAULT_DRILL);
    drill.playerStart.x = 300.375; drill.bosses[0].y = 140.025;
    drill.addWaves[0].lifetime = 17.1234; drill.addWaves[0].frequency = 3.333;
    drill.mechanics[0].first = 1.2345; drill.mechanics[0].radius = 65.6789;
    launch([drill]);
    expect(editor.getDraft().valid).toBe(true);
    for (const input of document.querySelectorAll('input[type=number]')) expect(input.validity.valid).toBe(true);
    expect(field('Random seed').step).toBe('1'); expect(field('Player X').step).toBe('any');
  });

  test('draft input stays isolated until explicit save, then replaces immutable saved item', () => {
    launch(); const original = copy(state.current.library);
    input(field('Drill name'), 'Tight circles'); input(field('Random seed'), '77');
    expect(editor.getDraft().dirty).toBe(true); expect(state.current.library).toEqual(original);
    tap(button('Save drill'));
    expect(changes).toHaveBeenCalledTimes(1);
    expect(state.current.library[0]).toMatchObject({name: 'Tight circles', seed: 77});
    expect(editor.getDraft().dirty).toBe(false); expect(button('Save drill').disabled).toBe(true);
    expect(notice).not.toHaveBeenCalled();
  });

  test('empty/invalid numeric settings prevent save and export without repairing or clamping', () => {
    launch(); input(field('Random seed'), '');
    expect(editor.getDraft().valid).toBe(false);
    expect(document.querySelector('.validation-errors').textContent).toContain('drill.seed');
    expect(button('Save drill').disabled).toBe(true); expect(button('Export drill').disabled).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    input(field('Random seed'), '123'); expect(editor.getDraft().valid).toBe(true);
  });

  test('leaving or switching dirty drafts requires confirmation and cancellation preserves input', () => {
    const other = createDrill({id: 'other', name: 'Other'}); launch([copy(DEFAULT_DRILL), other]);
    input(field('Drill name'), 'Unsaved'); window.confirm.mockReturnValue(false);
    expect(editor.prepareLeave()).toBe(false); expect(field('Drill name').value).toBe('Unsaved');
    select(document.querySelector('[aria-label="Saved drill library"]'), other.id);
    expect(selections).not.toHaveBeenCalled(); expect(field('Drill name').value).toBe('Unsaved');
    expect(document.querySelector('[aria-label="Saved drill library"]').value).toBe(DEFAULT_DRILL.id);
    window.confirm.mockReturnValue(true); select(document.querySelector('[aria-label="Saved drill library"]'), other.id);
    expect(selections).toHaveBeenCalledWith(other.id); expect(field('Drill name').value).toBe('Other');
    input(field('Drill name'), 'Changed again'); expect(editor.prepareLeave()).toBe(true); flushSync();
    expect(editor.getDraft().dirty).toBe(false); expect(field('Drill name').value).toBe('Other');
  });

  test('New starts a blank-rule draft, cancel keeps previous changes, save adds named drill', () => {
    launch(); input(field('Drill name'), 'Work in progress'); window.confirm.mockReturnValue(false);
    tap(button('＋ New')); expect(field('Drill name').value).toBe('Work in progress');
    window.confirm.mockReturnValue(true); tap(button('＋ New'));
    expect(editor.getDraft()).toMatchObject({dirty: true, drill: {mechanics: [], addWaves: []}});
    expect(changes).not.toHaveBeenCalled(); input(field('Drill name'), 'Single target focus'); tap(button('Save drill'));
    expect(state.current.library).toHaveLength(2); expect(state.current.library[1].name).toBe('Single target focus');
    expect(state.current.library[1].id).not.toBe(DEFAULT_DRILL.id);
    expect(state.current.selectedId).toBe(state.current.library[1].id);
  });

  test('Duplicate and Save as new create independent IDs; Delete requires confirmation and retains one drill', () => {
    launch(); expect(button('Delete').disabled).toBe(true);
    tap(button('Duplicate')); expect(state.current.library).toHaveLength(2);
    expect(state.current.library[1].name).toContain('copy'); expect(editor.getDraft().dirty).toBe(false);
    const duplicateId = state.current.selectedId;
    input(field('Drill name'), 'A named variation'); tap(button('Save as new'));
    expect(state.current.library).toHaveLength(3); expect(state.current.selectedId).not.toBe(duplicateId);
    window.confirm.mockReturnValue(false); tap(button('Delete')); expect(state.current.library).toHaveLength(3);
    window.confirm.mockReturnValue(true); tap(button('Delete')); expect(state.current.library).toHaveLength(2);
    expect(state.current.selectedId).toBe(DEFAULT_DRILL.id);
  });

  test('selected prop changes load the corresponding saved draft', () => {
    const other = createDrill({id: 'other', name: 'Other'}); launch([copy(DEFAULT_DRILL), other]);
    flushSync(() => { state.current = {...state.current, selectedId: other.id}; });
    expect(editor.getDraft().drill.id).toBe(other.id); expect(editor.getDraft().dirty).toBe(false);
  });
});

describe('placement and rules', () => {
  test('canvas click, drag, keyboard and numeric fields agree on world positions', () => {
    launch(); const canvas = document.querySelector('canvas');
    pointer(canvas, 'pointerdown', 240, 330); pointer(canvas, 'pointerup', 240, 330);
    expect(editor.getDraft().drill.playerStart).toEqual({x: 240, y: 330});
    expect(field('Player X').value).toBe('240');
    pointer(canvas, 'pointerdown', 500, 160); pointer(canvas, 'pointermove', 650, 110); pointer(canvas, 'pointerup', 650, 110);
    expect(editor.getDraft().drill.bosses[0]).toMatchObject({x: 650, y: 110});
    canvas.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true})); flushSync();
    expect(field('Boss 1 X').value).toBe('660');
    input(field('Boss 1 Y'), '220'); expect(editor.getDraft().drill.bosses[0].y).toBe(220);
  });

  test('wide preview letterbox gutters do not mutate positions', () => {
    launch(); const canvas = document.querySelector('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({left: 10, top: 20, width: 2000, height: 560});
    pointer(canvas, 'pointerdown', 50, 300); pointer(canvas, 'pointerup', 50, 300);
    expect(editor.getDraft().dirty).toBe(false);
    pointer(canvas, 'pointerdown', 1110, 380); pointer(canvas, 'pointerup', 1110, 380);
    expect(editor.getDraft().drill.playerStart).toEqual({x: 600, y: 360});
  });

  test('permanent bosses can be added, renamed and removed while retaining at least one', () => {
    launch(); tap(button('＋ Add permanent boss'));
    expect(editor.getDraft().drill.bosses).toHaveLength(2); input(field('Boss 2 name'), 'Second sentinel');
    expect(document.querySelector('[aria-label="Placement tools"]').textContent).toContain('Second sentinel');
    tap(document.querySelector('[aria-label="Remove boss 1"]')); expect(editor.getDraft().drill.bosses).toHaveLength(1);
    expect(document.querySelector('[aria-label="Remove boss 1"]').disabled).toBe(true);
    expect(editor.getDraft().valid).toBe(true);
  });

  test('all mechanic kinds and add waves expose their timing, geometry, placement and semantics', () => {
    launch(); tap(button('＋ New'));
    for (const label of ['Hostile circle', 'Hostile line', 'Projectiles', 'Safe deadline', 'Safe hold']) {
      tap(buttons().find(item => item.textContent.includes(label) && item.closest('.mechanic-palette')));
    }
    tap(button('＋ Add wave rule'));
    expect(editor.getDraft().drill.mechanics.map(rule => rule.kind)).toEqual(['circle', 'line', 'projectiles', 'safe-deadline', 'safe-hold']);
    expect(editor.getDraft().drill.addWaves).toHaveLength(1);
    expect(editor.getDraft().valid).toBe(true);
    for (const input of document.querySelectorAll('input[type=number]')) expect(input.validity.valid).toBe(true);
    expect(document.body.textContent).toContain('Be fully inside when the countdown ends');
    expect(document.body.textContent).toContain('Time outside all active safe zones');
    expect(document.querySelectorAll('.safe-card')).toHaveLength(2);
    expect(document.querySelectorAll('label.field').length).toBeGreaterThan(35);
  });

  test('projectile wall exposes spacing and angle sequencing with no fake origin placement', () => {
    launch(); tap(buttons().find(item => item.textContent.includes('Projectiles') && item.closest('.mechanic-palette')));
    select(field('Projectile pattern'), 'wall');
    expect(field('Wall center-to-center spacing')).toBeTruthy();
    expect(document.querySelectorAll('.rule-card').length).toBe(3);
    const card = field('Projectile pattern').closest('.rule-card');
    expect(card.querySelector('[aria-label*="placement"]')).toBeNull();
    expect(card.textContent).toContain('arena edge opposite their travel direction');
    select(card.querySelectorAll('select')[1], 'sequence');
    expect(field('Starting angle (°)')).toBeTruthy(); expect(field('Angle step per repeat (°)')).toBeTruthy();
    input(field('Projectile radius'), '40'); input(field('Wall center-to-center spacing'), '40');
    expect(editor.getDraft().valid).toBe(false);
    input(field('Wall center-to-center spacing'), '110'); expect(editor.getDraft().valid).toBe(true);
    select(field('Projectile pattern'), 'aimed'); expect(field('Projectile center-to-center spacing')).toBeTruthy();
  });
});


describe('ADD spawn-point authoring', () => {
  const placement = () => editor.getDraft().drill.addWaves[0].placement;
  const points = () => placement().points;
  const pointAction = (number, action) => labeled(`Add wave 1: ${action} point ${number}`);

  test('converts legacy placement to one ordered point and back using the selected point', () => {
    const drill = createDrill({addWaves: [createAddWave({placement: {mode: 'fixed', x: 253.5, y: 181.75}})]});
    launch([drill]);
    select(labeled('Add wave 1 placement'), 'points');
    expect(placement()).toEqual({mode: 'points', selection: 'ordered', points: [{x: 253.5, y: 181.75}]});
    expect(pointAction(1, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#placementHint').textContent).toContain('Add-wave point 1');
    tap(labeled('Add wave 1: add spawn point'));
    input(field('Point 2 X'), '800.125'); input(field('Point 2 Y'), '420.75');
    select(labeled('Add wave 1 placement'), 'fixed');
    expect(placement()).toEqual({mode: 'fixed', x: 800.125, y: 420.75});
    expect(field('Origin X').value).toBe('800.125');
    expect(editor.getDraft().valid).toBe(true);
  });

  test('add, reorder and remove preserve the selected logical point without persisting UI state', () => {
    launch(); tap(button('Preview / place points'));
    tap(labeled('Add wave 1: add spawn point'));
    expect(points()).toHaveLength(3);
    input(field('Point 3 X'), '700'); input(field('Point 3 Y'), '320');
    tap(labeled('Add wave 1: move point 3 up'));
    expect(points()).toEqual([{x: 430, y: 180}, {x: 700, y: 320}, {x: 570, y: 180}]);
    expect(pointAction(2, 'select').getAttribute('aria-pressed')).toBe('true');
    tap(labeled('Add wave 1: move point 1 down'));
    expect(pointAction(1, 'select').getAttribute('aria-pressed')).toBe('true');
    tap(pointAction(3, 'remove'));
    expect(points()).toEqual([{x: 700, y: 320}, {x: 430, y: 180}]);
    tap(pointAction(1, 'remove'));
    expect(points()).toEqual([{x: 430, y: 180}]);
    expect(pointAction(1, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(pointAction(1, 'remove').disabled).toBe(true);
    expect(labeled('Add wave 1: move point 1 up').disabled).toBe(true);
    expect(labeled('Add wave 1: move point 1 down').disabled).toBe(true);
    tap(button('Save drill'));
    expect(state.current.library[0].addWaves[0].placement).toEqual({mode: 'points', selection: 'ordered', points: [{x: 430, y: 180}]});
  });

  test('removing an earlier point and the selected last point keeps a valid selection', () => {
    launch(); tap(labeled('Add wave 1: add spawn point'));
    input(field('Point 3 X'), '750');
    tap(pointAction(1, 'remove'));
    expect(pointAction(2, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(points()[1].x).toBe(750);
    tap(pointAction(2, 'remove'));
    expect(pointAction(1, 'select').getAttribute('aria-pressed')).toBe('true');
    const canvas = document.querySelector('canvas');
    pointer(canvas, 'pointerdown', 400, 300); pointer(canvas, 'pointerup', 400, 300);
    expect(points()).toEqual([{x: 400, y: 300}]);
    expect(editor.getDraft().valid).toBe(true);
  });

  test('numbered canvas markers select, drag, and keyboard-move only the chosen point', () => {
    launch(); const canvas = document.querySelector('canvas');
    const drawText = vi.spyOn(canvas.getContext('2d'), 'fillText');
    tap(button('Preview / place points'));
    expect(drawText).toHaveBeenCalledWith('1', 430, 180);
    expect(drawText).toHaveBeenCalledWith('2', 570, 180);
    pointer(canvas, 'pointerdown', 570, 180); pointer(canvas, 'pointermove', 660, 260); pointer(canvas, 'pointerup', 660, 260);
    expect(points()).toEqual([{x: 430, y: 180}, {x: 660, y: 260}]);
    expect(pointAction(2, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(field('Point 2 X').value).toBe('660');
    canvas.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true})); flushSync();
    expect(points()[1]).toEqual({x: 670, y: 260});
    expect(drawText).toHaveBeenCalledWith('2', 670, 260);
    expect(drawText).toHaveBeenCalledWith('SPAWN POINTS · ORDERED · Point 2 selected', 44, 518);
    pointer(canvas, 'pointermove', 800, 300); expect(points()[1]).toEqual({x: 670, y: 260});
  });

  test('placing points over boss/player markers does not accidentally move those actors', () => {
    launch(); const canvas = document.querySelector('canvas');
    tap(pointAction(2, 'select'));
    pointer(canvas, 'pointerdown', 500, 160); pointer(canvas, 'pointerup', 500, 160);
    expect(points()[1]).toEqual({x: 500, y: 160});
    pointer(canvas, 'pointerdown', 500, 445); pointer(canvas, 'pointerup', 500, 445);
    expect(points()[1]).toEqual({x: 500, y: 445});
    expect(editor.getDraft().drill.bosses).toEqual(DEFAULT_DRILL.bosses);
    expect(editor.getDraft().drill.playerStart).toEqual(DEFAULT_DRILL.playerStart);
    tap(button('● Player start'));
    pointer(canvas, 'pointerdown', 300, 350); pointer(canvas, 'pointerup', 300, 350);
    expect(editor.getDraft().drill.playerStart).toEqual({x: 300, y: 350});
    expect(points()[1]).toEqual({x: 500, y: 445});
  });

  test.each(['random', 'ordered', 'priority'])('%s selection, order and fractional coordinates survive save and reload', selection => {
    const other = createDrill({id: 'other', name: 'Other'});
    launch([copy(DEFAULT_DRILL), other]);
    select(labeled('Add wave 1 point selection'), selection);
    input(field('Point 1 X'), '123.375'); input(field('Point 2 Y'), '321.125');
    const expected = copy(placement());
    tap(button('Save drill'));
    select(labeled('Saved drill library'), other.id);
    select(labeled('Saved drill library'), DEFAULT_DRILL.id);
    expect(placement()).toEqual(expected);
    expect(labeled('Add wave 1 point selection').value).toBe(selection);
    expect(editor.getDraft()).toMatchObject({dirty: false, valid: true});
    expect(Object.keys(placement()).sort()).toEqual(['mode', 'points', 'selection']);
  });

  test('blank and out-of-world coordinates block save/export and preserve authored values', () => {
    launch(); input(field('Point 2 X'), '');
    expect(editor.getDraft().valid).toBe(false);
    expect(editor.getDraft().errors.join(' ')).toContain('placement.points[1].x');
    expect(button('Save drill').disabled).toBe(true); expect(button('Export drill').disabled).toBe(true);
    input(field('Point 2 X'), '971');
    expect(points()[1].x).toBe(971); expect(editor.getDraft().valid).toBe(false);
    input(field('Point 2 X'), '570.125'); input(field('Point 1 Y'), '29.99');
    expect(points()[0].y).toBe(29.99); expect(editor.getDraft().valid).toBe(false);
    input(field('Point 1 Y'), '180.5');
    expect(editor.getDraft().valid).toBe(true);
    expect(field('Point 1 Y').validity.valid).toBe(true);
    expect(changes).not.toHaveBeenCalled();
  });

  test('add-point limit and independent wave selection stay bounded', () => {
    const drill = createDrill();
    drill.addWaves[0].placement.points = Array.from({length: DRILL_LIMITS.spawnPoints}, (_, index) => ({x: 40 + index * 20, y: 180}));
    drill.addWaves.push(createAddWave({id: 'second-wave', placement: {mode: 'points', selection: 'priority', points: [{x: 800, y: 300}]}}));
    launch([drill]);
    expect(labeled('Add wave 1: add spawn point').disabled).toBe(true);
    tap(pointAction(32, 'select'));
    tap(labeled('Add wave 2: select point 1'));
    const canvas = document.querySelector('canvas');
    pointer(canvas, 'pointerdown', 820, 330); pointer(canvas, 'pointerup', 820, 330);
    expect(editor.getDraft().drill.addWaves[1].placement.points).toEqual([{x: 820, y: 330}]);
    expect(points()).toHaveLength(32); expect(points()[31]).toEqual({x: 660, y: 180});
    tap(document.querySelectorAll('.wave-card .rule-actions button')[0]);
    expect(pointAction(32, 'select').getAttribute('aria-pressed')).toBe('true');
    tap(pointAction(1, 'remove')); expect(labeled('Add wave 1: add spawn point').disabled).toBe(false);
    tap(labeled('Add wave 1: add spawn point')); expect(points()).toHaveLength(32);
    expect(pointAction(32, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(editor.getDraft().valid).toBe(true);
  });

  test('legacy fixed/player/random ADD controls and mechanic controls remain supported', () => {
    const drill = createDrill({addWaves: [createAddWave()]}); launch([drill]);
    const legacy = copy(placement());
    select(labeled('Add wave 1 placement'), 'player');
    expect(placement()).toEqual({...legacy, mode: 'player'});
    select(labeled('Add wave 1 placement'), 'random');
    expect(placement()).toEqual({...legacy, mode: 'random'});
    const drawText = vi.spyOn(document.querySelector('canvas').getContext('2d'), 'fillText');
    tap(document.querySelector('.wave-card .rule-actions button'));
    expect(drawText).toHaveBeenCalledWith('RANDOM POSITION · sampled for each add', 44, 52);
    expect(document.querySelector('.wave-card').textContent).toContain('Picks a new position for each target');
    select(labeled('Add wave 1 placement'), 'fixed');
    expect(field('Origin X').value).toBe(String(legacy.x));
    expect(editor.getDraft().valid).toBe(true);
    const mechanic = labeled('Hostile circle 1 placement');
    expect([...mechanic.options].map(option => option.value)).toEqual(['fixed', 'player', 'random']);
    select(mechanic, 'fixed');
    tap(document.querySelector('.rule-card:not(.wave-card) .rule-actions button'));
    const canvas = document.querySelector('canvas');
    pointer(canvas, 'pointerdown', 320, 250); pointer(canvas, 'pointerup', 320, 250);
    expect(editor.getDraft().drill.mechanics[0].placement).toEqual({mode: 'fixed', x: 320, y: 250});
    expect(placement()).toEqual(legacy);
  });

  test('New from default exposes the updated default while keeping saved legacy drills intact', () => {
    const legacy = createDrill({id: DEFAULT_DRILL.id, name: 'Saved older practice', addWaves: [createAddWave()]});
    launch([legacy]); input(field('Drill name'), 'Unfinished edit');
    window.confirm.mockReturnValue(false); tap(button('New from default'));
    expect(field('Drill name').value).toBe('Unfinished edit');
    window.confirm.mockReturnValue(true); tap(button('New from default'));
    expect(editor.getDraft()).toMatchObject({dirty: true, valid: true});
    expect(placement()).toEqual({mode: 'points', selection: 'ordered', points: [{x: 430, y: 180}, {x: 570, y: 180}]});
    expect(editor.getDraft().drill.id).not.toBe(legacy.id);
    expect(pointAction(1, 'select').getAttribute('aria-pressed')).toBe('true');
    expect(state.current.library).toEqual([legacy]); expect(changes).not.toHaveBeenCalled();
    tap(button('Save drill'));
    expect(state.current.library).toHaveLength(2); expect(state.current.library[0]).toEqual(legacy);
    expect(state.current.library[1].addWaves).toEqual(DEFAULT_DRILL.addWaves);
  });

  test('point-list JSON export and import round-trip without UI selection state', async () => {
    launch(); tap(pointAction(2, 'select')); select(labeled('Add wave 1 point selection'), 'priority');
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:point-list');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    tap(button('Export drill'));
    const exported = JSON.parse(await create.mock.calls[0][0].text());
    expect(exported.addWaves[0].placement).toEqual(placement());
    exported.id = 'imported-points'; exported.name = 'Imported points';
    importText(JSON.stringify(exported));
    expect(editor.getDraft().drill).toEqual(exported);
    expect(editor.getDraft()).toMatchObject({dirty: false, valid: true});
    expect(state.current.library).toHaveLength(2);
  });
});

describe('safe import, export and interrupted flows', () => {
  test('invalid JSON or any invalid imported drill preserves both dirty draft and saved library', () => {
    launch(); input(field('Drill name'), 'Still editing');
    const before = editor.getDraft(); importText('{');
    expect(document.querySelector('[role="alert"]').textContent).toContain('Import rejected');
    expect(editor.getDraft()).toEqual(before); expect(changes).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled();
    importText(JSON.stringify({...DEFAULT_DRILL, version: 999}));
    expect(editor.getDraft()).toEqual(before); expect(changes).not.toHaveBeenCalled();
    importText('x'.repeat(MAX_DRILL_IMPORT_BYTES + 1));
    expect(editor.getDraft()).toEqual(before); expect(changes).not.toHaveBeenCalled();
  });

  test('valid import needs dirty-discard approval, then merges atomically and selects imported item', () => {
    launch(); input(field('Drill name'), 'Unsaved'); const incoming = createDrill({id: 'imported', name: 'Imported practice'});
    window.confirm.mockReturnValue(false); importText(JSON.stringify(incoming)); expect(changes).not.toHaveBeenCalled();
    expect(field('Drill name').value).toBe('Unsaved');
    window.confirm.mockReturnValue(true); tap(button('Validate & import'));
    expect(state.current.library).toHaveLength(2); expect(state.current.selectedId).toBe(incoming.id);
    expect(field('Drill name').value).toBe(incoming.name); expect(document.querySelector('textarea')).toBeNull();
    expect(editor.getDraft().dirty).toBe(false);
  });

  test('colliding import cancel keeps old saved drill; explicit replace updates matching ID only', () => {
    const other = createDrill({id: 'other', name: 'Other'}); launch([copy(DEFAULT_DRILL), other]);
    const incoming = {...copy(DEFAULT_DRILL), name: 'Updated import'};
    window.confirm.mockReturnValue(false); importText(JSON.stringify(incoming));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('matching IDs')); expect(changes).not.toHaveBeenCalled();
    window.confirm.mockReturnValue(true); tap(button('Validate & import'));
    expect(state.current.library).toHaveLength(2); expect(state.current.library.find(item => item.id === DEFAULT_DRILL.id).name).toBe('Updated import');
    expect(state.current.library.find(item => item.id === other.id)).toEqual(other);
  });

  test('export creates downloadable JSON and never clears unsaved draft state', async () => {
    launch(); input(field('Drill name'), 'Portable edit');
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test'); const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    tap(button('Export drill'));
    expect(click).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
    const data = JSON.parse(await create.mock.calls[0][0].text()); expect(data.name).toBe('Portable edit'); expect(validateDrill(data).valid).toBe(true);
    expect(editor.getDraft().dirty).toBe(true); expect(changes).not.toHaveBeenCalled();
    tap(button('Export library')); const library = JSON.parse(await create.mock.calls[1][0].text());
    expect(library.drills[0].name).toBe(DEFAULT_DRILL.name);
    await new Promise(resolve => setTimeout(resolve, 5)); expect(revoke).toHaveBeenCalledWith('blob:test');
  });

  test('closing import keeps a dirty draft; leaving cleans only after confirmation', () => {
    launch(); input(field('Drill name'), 'Draft survives panel'); tap(button('Import JSON')); input(document.querySelector('textarea'), '{'); tap(button('Cancel'));
    expect(editor.getDraft().dirty).toBe(true); expect(field('Drill name').value).toBe('Draft survives panel');
    expect(editor.prepareLeave()).toBe(true); flushSync(); expect(editor.getDraft().drill.name).toBe(DEFAULT_DRILL.name);
  });


  test.each(['cancel', 'toggle', 'unmount', 'new'])('late file read after %s cannot import or alter the library', async action => {
    launch(); tap(button('Import JSON'));
    let resolveRead;
    const pending = new Promise(resolve => { resolveRead = resolve; });
    const upload = document.querySelector('input[type="file"]');
    Object.defineProperty(upload, 'files', {configurable: true, value: [{size: 300, text: () => pending}]});
    upload.dispatchEvent(new Event('change', {bubbles: true})); flushSync();
    expect(upload.disabled).toBe(true);
    if (action === 'cancel') tap(button('Cancel'));
    if (action === 'toggle') tap(button('Import JSON'));
    if (action === 'new') tap(button('＋ New'));
    if (action === 'unmount') { await unmount(editor); editor = null; }
    resolveRead(JSON.stringify(createDrill({id: 'late-import', name: 'Late import'})));
    await new Promise(resolve => setTimeout(resolve, 0)); flushSync();
    expect(changes).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled();
    expect(state.current.library).toEqual([DEFAULT_DRILL]);
    if (editor) expect(editor.getDraft().drill.id).not.toBe('late-import');
  });

  test('a fresh file import still works after a canceled read finishes', async () => {
    launch(); tap(button('Import JSON'));
    let resolveRead;
    const upload = document.querySelector('input[type="file"]');
    Object.defineProperty(upload, 'files', {configurable: true, value: [{size: 300, text: () => new Promise(resolve => { resolveRead = resolve; })}]});
    upload.dispatchEvent(new Event('change', {bubbles: true})); flushSync();
    tap(button('Cancel')); tap(button('Import JSON'));
    const fresh = createDrill({id: 'fresh-file', name: 'Fresh file'});
    const currentUpload = document.querySelector('input[type="file"]');
    Object.defineProperty(currentUpload, 'files', {configurable: true, value: [{size: 300, text: () => Promise.resolve(JSON.stringify(fresh))}]});
    currentUpload.dispatchEvent(new Event('change', {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 0)); flushSync();
    expect(changes).toHaveBeenCalledTimes(1); expect(state.current.selectedId).toBe(fresh.id);
    resolveRead(JSON.stringify(createDrill({id: 'stale-file'})));
    await new Promise(resolve => setTimeout(resolve, 0)); flushSync();
    expect(changes).toHaveBeenCalledTimes(1); expect(state.current.selectedId).toBe(fresh.id);
  });

  test('file read failures are recoverable and stale failures stay silent', async () => {
    launch(); tap(button('Import JSON'));
    const upload = document.querySelector('input[type="file"]');
    Object.defineProperty(upload, 'files', {configurable: true, value: [{size: 300, text: () => Promise.reject(Error('read failed'))}]});
    upload.dispatchEvent(new Event('change', {bubbles: true})); await new Promise(resolve => setTimeout(resolve, 0)); flushSync();
    expect(document.querySelector('[role="alert"]').textContent).toContain('could not be read');
    expect(upload.disabled).toBe(false); expect(changes).not.toHaveBeenCalled();
  });

  test('browser navigation warns only for dirty draft and cleanup removes listener', () => {
    launch(); let event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    input(field('Drill name'), 'Uncommitted'); event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    tap(button('Save drill')); event = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
  });
});
