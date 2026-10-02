// Run with a GTK display and GSETTINGS_SCHEMA_DIR pointing to ../schemas:
// gjs -m tests/scroll-bindings.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import { AcceleratorParse, MOUSE_SCROLL_UP, MOUSE_SCROLL_DOWN, isScrollBinding } from '../acceleratorparse.js';
import { KeybindingsPane } from '../prefsKeybinding.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function flush() {
    const context = GLib.MainContext.default();
    while (context.pending())
        context.iteration(false);
}

const parser = new AcceleratorParse();
const [ok, key, mask] = parser.accelerator_parse('<Control><Super>MouseScrollUp');
assert(ok && key === MOUSE_SCROLL_UP && mask === (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SUPER_MASK),
    'Wheel accelerators retain their direction and modifiers');
assert(parser.accelerator_parse('MouseScrollDown')[1] === MOUSE_SCROLL_DOWN, 'Wheel down parses');
assert(parser.accelerator_parse('ScrollUp')[1] !== MOUSE_SCROLL_UP, 'Multimedia ScrollUp remains a keyboard key');
assert(!isScrollBinding('<Super>Page_Up') && !isScrollBinding('MouseScrollLeft'), 'Keyboard and unsupported directions remain distinct');

Gtk.init();
const settings = new Gio.Settings({
    schema_id: 'org.gnome.shell.extensions.paperwm.keybindings',
    backend: Gio.memory_settings_backend_new(),
});
// Broadway has no physical keyboard layout for translating Above_Tab.
settings.list_keys().forEach(key => settings.set_strv(key, []));
settings.set_strv('switch-up-workspace', ['<Super>Page_Up', '<Super>MouseScrollUp']);
settings.set_strv('switch-down-workspace', ['<Super>Page_Down', '<Super>MouseScrollDown']);
const pane = new KeybindingsPane();
pane.init({ getSettings: () => settings });
flush();

function findRow(action) {
    for (let row = pane._listbox.get_first_child(); row; row = row.get_next_sibling()) {
        if (row.keybinding.action === action)
            return row;
    }
    throw new Error(`Missing row: ${action}`);
}

const up = findRow('switch-up-workspace');
let wheelRow = up._comboList.get_row_at_index(1);
assert(wheelRow.combo.keystr === '<Super>MouseScrollUp', 'Wheel binding reloads from settings');
assert(wheelRow.combo.keycode === 0, 'Wheel shortcuts never expose a keyboard hardware code');
assert(wheelRow._scrollLabel.visible && !wheelRow._shortcutLabel.visible, 'Wheel label uses the custom display');
assert(wheelRow._scrollLabel.label.includes('Scroll Up'), 'Readable wheel direction');
assert(up._comboList.get_row_at_index(0)._shortcutLabel.visible, 'Mixed keyboard shortcut is still displayed');

const controllers = wheelRow.observe_controllers();
let scrollController;
for (let i = 0; i < controllers.get_n_items(); i++) {
    const controller = controllers.get_item(i);
    if (controller instanceof Gtk.EventControllerScroll)
        scrollController = controller;
}
assert(scrollController, 'Shortcut row installs a scroll capture controller');
assert(!scrollController.emit('scroll', 0, -1), 'Scrolling outside edit mode propagates');
wheelRow._grabKeyboard = () => {};
wheelRow._ungrabKeyboard = () => {};
wheelRow.editing = true;
scrollController.get_current_event_state = () => Gdk.ModifierType.LOCK_MASK;
assert(scrollController.emit('scroll', 0, -1), 'Bare scrolling is consumed while editing');
assert(wheelRow.editing && settings.get_strv('switch-up-workspace').includes('<Super>MouseScrollUp'),
    'Scrolling without modifiers does not record a binding');
const modifierController = {
    get_current_event: () => ({ is_modifier: () => true }),
};
wheelRow._onKeyPressed(modifierController, Gdk.KEY_Super_L, 133, 0);
assert(wheelRow.editing, 'Pressing Super alone keeps the recorder waiting for a wheel step');
scrollController.get_current_event_state = () => Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.LOCK_MASK;
assert(scrollController.emit('scroll', 0, -1), 'Editing consumes the wheel event');
flush();
assert(settings.get_strv('switch-up-workspace').includes('<Control><Super>MouseScrollUp'),
    'Captured wheel shortcut is persisted, excluding Caps Lock');
assert(settings.get_strv('switch-up-workspace').includes('<Super>Page_Up'), 'Recording preserves the other keyboard shortcut');

wheelRow = up._comboList.get_row_at_index(1);
wheelRow._grabKeyboard = () => {};
wheelRow._ungrabKeyboard = () => {};
wheelRow.editing = true;
wheelRow._wheelModifiers.forEach(m => m.button.active = false);
const downButton = wheelRow._wheelControls.get_last_child();
assert(!downButton.sensitive, 'Direction buttons are disabled without a modifier');
downButton.emit('clicked');
assert(wheelRow.editing, 'Direction controls also require a modifier');
wheelRow._wheelModifiers.find(m => m.button.label === 'Super').button.active = true;
assert(downButton.sensitive, 'Selecting Super enables direction buttons');
downButton.emit('clicked');
flush();
assert(settings.get_strv('switch-up-workspace').includes('<Super>MouseScrollDown'),
    'Explicit controls record Super+wheel without Shell capture');

settings.set_strv('switch-down-workspace', ['<Control><Super>MouseScrollUp']);
settings.set_strv('switch-up-workspace', ['<Super>Page_Up', '<Control><Super>MouseScrollUp']);
flush();
assert(pane._model.collisions.get('<Control><Super>MouseScrollUp').size === 2, 'Duplicate wheel bindings are reported');
wheelRow = up._comboList.get_row_at_index(1);
wheelRow._onDeleteButtonClicked();
flush();
assert(settings.get_strv('switch-up-workspace').join() === '<Super>Page_Up', 'Deleting a wheel shortcut preserves keyboard bindings');
up.keybinding.reset();
flush();
assert(settings.get_user_value('switch-up-workspace') === null, 'Reset restores the default keyboard bindings');
pane._listbox.set_header_func(null);
pane._listbox.bind_model(null, null);
flush();
print('PASS: modifier-only input, modifier-required wheel capture, explicit controls, parsing, persistence, collisions, deletion and reset');
