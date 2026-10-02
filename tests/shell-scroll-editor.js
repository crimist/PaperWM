// Real Super+wheel recording across the Shell/GTK process boundary.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Tiling } from '../imports.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function wait(ms = 250) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

export async function run() {
    const dir = GLib.getenv('PAPERWM_TEST_DIR');
    assert(dir && GLib.getenv('XDG_RUNTIME_DIR') === `${dir}/runtime`, 'Requires an isolated Shell');
    const extension = Main.extensionManager.lookup('paperwm@paperwm.github.com').stateObj;
    const settings = extension.getSettings('org.gnome.shell.extensions.paperwm.keybindings');
    settings.set_strv('switch-up-workspace', ['<Super>Page_Up']);
    settings.set_strv('switch-down-workspace', ['<Super>MouseScrollUp']);
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.setenv('WAYLAND_DISPLAY', 'paperwm-test', true);
    launcher.setenv('GTK_A11Y', 'none', true);
    launcher.setenv('GSETTINGS_SCHEMA_DIR', `${extension.path}/schemas`, true);
    const uri = GLib.uri_resolve_relative(import.meta.url, './scroll-editor-client.js', GLib.UriFlags.NONE);
    const client = launcher.spawnv(['gjs', '-m', GLib.filename_from_uri(uri)[0]]);
    const seat = Clutter.get_default_backend().get_default_seat();
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const timestamp = () => GLib.get_monotonic_time();
    const key = (value, pressed) => keyboard.notify_keyval(timestamp(), value,
        pressed ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
    const readStatus = () => {
        const file = Gio.File.new_for_path(`${dir}/editor-status`);
        return file.query_exists(null) ? new TextDecoder().decode(file.load_contents(null)[1]) : '';
    };
    async function command(value) {
        GLib.file_set_contents(`${dir}/editor-command`, value);
        for (let i = 0; i < 20 && readStatus() !== value; i++)
            await wait(100);
        assert(readStatus() === value, `GTK editor accepted ${value}`);
        await wait();
        // GTK's Wayland shortcut inhibitor asks for permission the first time.
        // Accept only in this private compositor, using the dialog's default.
        if (Main.actionMode === Shell.ActionMode.SYSTEM_MODAL) {
            key(Clutter.KEY_Return, true);
            key(Clutter.KEY_Return, false);
            await wait(400);
            // Opening the system dialog may remove the row's focus. Enter edit
            // mode again once permission is granted, as a subsequent click does.
            if (value.endsWith(':edit'))
                return command(value.replace(':', ':retry:'));
        }
        assert(Main.actionMode === Shell.ActionMode.NORMAL, 'Shortcut inhibitor dialog is closed');
    }
    try {
        await wait(1500);
        Main.overview.hide();
        await wait(750);
        assert(readStatus() === 'READY', 'GTK editor started');
        const window = global.display.focus_window;
        assert(window?.title === 'PaperWM scroll editor test', 'GTK editor has keyboard focus');
        const frame = window.get_frame_rect();
        pointer.notify_absolute_motion(timestamp(), frame.x + frame.width / 2, frame.y + frame.height / 2);
        await command('1:edit');
        const space = Tiling.spaces.selectedSpace;
        key(Clutter.KEY_Super_L, true);
        await wait();
        pointer.notify_discrete_scroll(timestamp(), Clutter.ScrollDirection.UP, Clutter.ScrollSource.WHEEL);
        await wait(500);
        key(Clutter.KEY_Super_L, false);
        await wait();
        assert(settings.get_strv('switch-up-workspace').includes('<Super>MouseScrollUp'),
            'Real Super+wheel reaches GTK and records Super');
        assert(Tiling.spaces.selectedSpace === space, 'Recording does not dispatch the existing workspace shortcut');

        await command('2:edit');
        key(Clutter.KEY_Super_L, true);
        key(Clutter.KEY_Control_L, true);
        await wait();
        pointer.notify_discrete_scroll(timestamp(), Clutter.ScrollDirection.DOWN, Clutter.ScrollSource.WHEEL);
        await wait(500);
        key(Clutter.KEY_Control_L, false);
        key(Clutter.KEY_Super_L, false);
        await wait();
        assert(settings.get_strv('switch-up-workspace').includes('<Control><Super>MouseScrollDown'),
            'Real Ctrl+Super+wheel preserves both modifiers');

        await command('3:edit');
        await command('4:cancel');
        key(Clutter.KEY_Super_L, true);
        await wait();
        pointer.notify_discrete_scroll(timestamp(), Clutter.ScrollDirection.UP, Clutter.ScrollSource.WHEEL);
        await wait();
        key(Clutter.KEY_Super_L, false);
        await wait();
        assert(Tiling.spaces.selectedSpace !== space, 'Cancel releases capture and normal shortcuts resume');
        const result = 'PASS: real GTK Super+wheel and Ctrl+Super+wheel recording, shortcut suppression during capture, and cancellation';
        print(result);
        GLib.file_set_contents(`${dir}/result`, result);
    } finally {
        key(Clutter.KEY_Control_L, false);
        key(Clutter.KEY_Super_L, false);
        client.force_exit();
        await wait();
    }
}
