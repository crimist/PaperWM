// Runs only in the private compositor created by run-shell-scroll.sh.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Tiling, Navigator } from '../imports.js';

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
    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.setenv('WAYLAND_DISPLAY', 'paperwm-test', true);
    launcher.setenv('GTK_A11Y', 'none', true);
    const uri = GLib.uri_resolve_relative(import.meta.url, './scroll-client.js', GLib.UriFlags.NONE);
    const client = launcher.spawnv(['gjs', '-m', GLib.filename_from_uri(uri)[0]]);
    try {
        await wait(1000);
        Main.overview.hide();
        await wait(1000);
        const window = global.get_window_actors().map(actor => actor.meta_window)
            .find(w => w.title === 'PaperWM scroll test client');
        assert(window, 'Wayland client opened');
        const space = Tiling.spaces.spaceOfWindow(window);
        const otherMonitor = Main.layoutManager.monitors.find(m => m !== space.monitor);
        const empty = Tiling.spaces.monitors.get(otherMonitor);
        assert(empty.length === 0, 'Destination monitor has an empty workspace');

        // The virtual monitors are side by side; route each direction to the
        // empty monitor to also reproduce the user's stacked-monitor layout.
        const neighbor = global.display.get_monitor_neighbor_index;
        global.display.get_monitor_neighbor_index = () => otherMonitor.index;
        try {
            for (const direction of [Meta.MotionDirection.UP, Meta.MotionDirection.DOWN,
                Meta.MotionDirection.LEFT, Meta.MotionDirection.RIGHT]) {
                space.switchGlobal(direction);
                assert(Tiling.spaces.selectedSpace === space, 'Empty destination leaves selection intact');
            }
        } finally {
            global.display.get_monitor_neighbor_index = neighbor;
            Navigator.finishDispatching();
        }

        // Queue the real workspace-change resize callback, then close its
        // window. Intercept any subsequent resize before it reaches Mutter,
        // so this regression test can safely fail on the broken code.
        let unmanaged = false;
        let staleResizes = 0;
        const resize = window.move_resize_frame.bind(window);
        window.move_resize_frame = (...args) => {
            if (unmanaged) {
                staleResizes++;
                return;
            }
            resize(...args);
        };
        const height = window.get_frame_rect().height;
        window.connect('unmanaged', () => {
            unmanaged = true;
            // Leave an unmet resize target, as in the Discord Updater crash.
            window._targetHeight = height + 100;
        });
        window.change_workspace(empty.workspace);
        client.force_exit();
        await wait(1500);
        assert(unmanaged, 'Wayland window was unmanaged');
        assert(staleResizes === 0, `Delayed callback resized a closed window ${staleResizes} times`);
        const result = 'PASS: empty-monitor navigation in all directions and window closure with pending workspace resize';
        print(result);
        GLib.file_set_contents(`${dir}/result`, result);
    } finally {
        client.force_exit();
    }
}
