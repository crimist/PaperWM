import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../keybindings.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function moveWindowOrMonitor('), source.indexOf('export function setupActions('));
const motion = {LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4};
const monitor = {LEFT: 11, RIGHT: 12, UP: 13, DOWN: 14};
let count = 0;
function fixture({column = 1, row = 1, lengths = [3, 3, 3], neighbor = 1, valid = true, destroyed = false, stale = false, dragging = false} = {}) {
    const events = [];
    let callback;
    const window = {get_compositor_private: () => !destroyed};
    const space = lengths.map(length => Array(length).fill(null));
    space.monitor = {index: 0};
    space.positionOf = () => valid ? [column, row] : false;
    space.swap = (dir, mw) => {assert.equal(mw, window); events.push(['swap', dir]);};
    space.activateWithFocus = (mw, animate, paperAnimate) => {
        assert.equal(mw, window); assert.equal(animate, false); assert.equal(paperAnimate, false);
        events.push(['focus']);
    };
    const context = vm.createContext({
        Meta: {MotionDirection: motion, DisplayDirection: monitor},
        display: {get_monitor_neighbor_index: (index, dir) => {assert.equal(index, 0); assert.ok(Object.values(monitor).includes(dir)); return neighbor;}},
        GLib: {PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false, idle_add: (priority, cb) => {assert.equal(priority, 0); callback = cb; return 123;}},
        Tiling: {inGrab: dragging, spaces: {spaceOfWindow: mw => {assert.equal(mw, window); return stale ? null : space;}, switchMonitor: (dir, move) => {assert.equal(move, true); events.push(['monitor', dir]);}}},
        Navigator: {finishDispatching: () => events.push(['finish'])},
    });
    vm.runInContext('let pendingMonitorMove = null;\n' + helper, context);
    return {events, move: dir => context.moveWindowOrMonitor(window, space, dir), flush: () => callback?.()};
}
for (const [name, dir] of Object.entries(motion)) {
    const local = fixture(); local.move(dir);
    assert.deepEqual(local.events, [['swap', dir]]); count++;
    const edgePosition = {LEFT: {column: 0}, RIGHT: {column: 2}, UP: {row: 0}, DOWN: {row: 2}}[name];
    const edge = fixture(edgePosition); edge.move(dir);
    assert.deepEqual(edge.events, [], 'monitor moves must wait until after key dispatch');
    edge.move(dir); // Key autorepeat must not queue a duplicate transfer.
    edge.flush();
    assert.deepEqual(edge.events, [['finish'], ['focus'], ['monitor', monitor[name]]]); count++;
    const missing = fixture({...edgePosition, neighbor: -1}); missing.move(dir); missing.flush();
    assert.deepEqual(missing.events, []); count++;
}
for (const name of ['UP', 'DOWN']) {
    const single = fixture({column: 0, row: 0, lengths: [1]}); single.move(motion[name]); single.flush();
    assert.deepEqual(single.events, [['finish'], ['focus'], ['monitor', monitor[name]]]); count++;
}
for (const state of [{valid: false}, {destroyed: true}, {stale: true}, {dragging: true}]) {
    const f = fixture({column: 0, ...state}); f.move(motion.LEFT); f.flush();
    assert.deepEqual(f.events, []); count++;
}
console.log(`Passed ${count} edge-movement scenarios.`);
