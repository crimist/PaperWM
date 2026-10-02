// Integration test entry point for a separate headless GNOME Shell session.
// Do not run in the user's desktop: this changes settings and injects input.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Keybindings, Tiling, Navigator } from '../imports.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function wait(ms = 250) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

const seat = Clutter.get_default_backend().get_default_seat();
const superMask = Clutter.ModifierType.MOD4_MASK;

function event(direction, state = superMask) {
    return {
        type: () => Clutter.EventType.SCROLL,
        get_scroll_direction: () => direction,
        get_state: () => state,
    };
}

export async function run() {
    const testDir = GLib.getenv('PAPERWM_TEST_DIR');
    assert(testDir && GLib.getenv('XDG_RUNTIME_DIR') === `${testDir}/runtime`,
        'This test must run in its isolated Shell session');
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.setenv('WAYLAND_DISPLAY', 'paperwm-test', true);
    launcher.setenv('GTK_A11Y', 'none', true);
    const clientUri = GLib.uri_resolve_relative(import.meta.url, './scroll-client.js', GLib.UriFlags.NONE);
    const client = launcher.spawnv(['gjs', '-m', GLib.filename_from_uri(clientUri)[0]]);
    await wait(1000);
    Main.overview.hide();
    await wait(1000);
    assert(Main.actionMode === Shell.ActionMode.NORMAL, 'Test Shell is in normal mode');
    assert(Main.layoutManager.monitors.length === 2, 'Test has two monitors');
    const extension = Main.extensionManager.lookup('paperwm@paperwm.github.com').stateObj;
    const settings = extension.getSettings('org.gnome.shell.extensions.paperwm.keybindings');
    settings.set_strv('switch-down-workspace', ['<Super>Page_Down', '<Super>MouseScrollDown']);
    settings.set_strv('switch-up-workspace', ['<Super>Page_Up', '<Super>MouseScrollUp']);
    await wait();
    assert(Keybindings.idOf('switch-down-workspace') !== Meta.KeyBindingAction.NONE,
        'Mixed keyboard and wheel action retains its Mutter registration');

    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.DOWN, 0)) === Clutter.EVENT_PROPAGATE,
        'Unbound ordinary scrolling passes through');
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.DOWN, superMask | Clutter.ModifierType.CONTROL_MASK)) === Clutter.EVENT_PROPAGATE,
        'Extra modifiers do not activate a different binding');
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.SMOOTH)) === Clutter.EVENT_PROPAGATE,
        'Smooth events do not double-dispatch discrete wheel steps');
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.LEFT)) === Clutter.EVENT_PROPAGATE,
        'Horizontal scrolling is unaffected');
    settings.set_strv('switch-up-workspace', ['MouseScrollUp']);
    await wait();
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.UP, 0)) === Clutter.EVENT_PROPAGATE,
        'Even a stored bare-wheel binding leaves ordinary scrolling alone');
    settings.set_strv('switch-up-workspace', ['<Super>Page_Up', '<Super>MouseScrollUp']);
    await wait();

    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const timestamp = () => GLib.get_monotonic_time();
    const original = Tiling.spaces.selectedSpace;
    const monitor = original.monitor;
    const otherMonitor = Main.layoutManager.monitors.find(m => m !== monitor);
    const otherSpace = Tiling.spaces.monitors.get(otherMonitor);
    pointer.notify_absolute_motion(timestamp(), monitor.x + monitor.width / 2, monitor.y + monitor.height / 2);
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    await wait();
    assert(Main.actionMode === Shell.ActionMode.NORMAL, 'Super press leaves test Shell in normal mode');
    pointer.notify_discrete_scroll(timestamp(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
    await wait();
    const next = Tiling.spaces.selectedSpace;
    assert(next !== original && next.monitor === monitor, 'Super+wheel switches workspace on the active monitor');
    assert(Tiling.spaces.monitors.get(otherMonitor) === otherSpace, 'Other monitor is unchanged');
    pointer.notify_discrete_scroll(timestamp(), Clutter.ScrollDirection.UP, Clutter.ScrollSource.WHEEL);
    await wait();
    assert(Tiling.spaces.selectedSpace === original, 'Repeated wheel input works while Super remains held');
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await wait();
    assert(!Navigator.navigating, 'Releasing Super finishes navigation');

    // Wheel-only actions must work even without a usable keyboard shortcut.
    settings.set_strv('switch-down-workspace', ['<Super>MouseScrollDown']);
    await wait();
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    pointer.notify_discrete_scroll(timestamp(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
    await wait();
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await wait();
    assert(Tiling.spaces.selectedSpace !== original && !Navigator.navigating, 'Wheel-only binding dispatches and releases');

    settings.set_strv('switch-down-workspace', ['<Super>Page_Down']);
    await wait();
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.DOWN)) === Clutter.EVENT_PROPAGATE,
        'Removing a wheel binding takes effect immediately');
    const beforeKeyboard = Tiling.spaces.selectedSpace;
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Page_Up, Clutter.KeyState.PRESSED);
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Page_Up, Clutter.KeyState.RELEASED);
    await wait();
    keyboard.notify_keyval(timestamp(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    await wait();
    assert(Tiling.spaces.selectedSpace !== beforeKeyboard && Tiling.spaces.selectedSpace.monitor === monitor,
        'Existing keyboard shortcut still dispatches after editing wheel bindings');
    settings.set_strv('switch-up-workspace', ['<Super>MouseScrollUp']);
    await wait();
    extension.disable();
    extension.enable();
    await wait();
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.DOWN)) === Clutter.EVENT_PROPAGATE,
        'Disable and re-enable do not leave stale wheel bindings');
    assert(Keybindings.handleScrollEvent(event(Clutter.ScrollDirection.UP)) === Clutter.EVENT_STOP,
        'Wheel-only bindings are restored on re-enable');
    await wait();
    Navigator.finishDispatching();
    client.force_exit();

    const result = 'PASS: real Super+wheel input, repeated navigation, monitor isolation, wheel-only bindings, modifier matching, settings changes and extension lifecycle';
    print(result);
    GLib.file_set_contents(`${testDir}/result`, result);
}
