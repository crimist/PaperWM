// Run with PAPERWM_TEST_MODULE=shell-fullscreen.js ./tests/run-shell-scroll.sh.
// Requires Chromium. Uses a private compositor and a temporary browser profile.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Tiling } from '../imports.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function wait(ms = 700) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function checkGeometry(window, space) {
    const frame = window.get_frame_rect();
    const buffer = window.get_buffer_rect();
    const clip = window.get_compositor_private().get_clip();
    const expected = [space.monitor.x - buffer.x, space.monitor.y - buffer.y,
        space.monitor.width, space.monitor.height];
    assert(clip.every((value, i) => value === expected[i]),
        `Stale monitor clip: ${JSON.stringify(clip)} instead of ${JSON.stringify(expected)}`);
    const clone = window.clone.cloneActor;
    assert(clone.x === buffer.x - frame.x && clone.y === buffer.y - frame.y,
        'Clone origin matches the current buffer');
    assert(clone.width === buffer.width && clone.height === buffer.height,
        'Clone size matches the current buffer');
}

export async function run() {
    const dir = GLib.getenv('PAPERWM_TEST_DIR');
    assert(dir && GLib.getenv('XDG_RUNTIME_DIR') === `${dir}/runtime`, 'Requires an isolated Shell');
    const extension = Main.extensionManager.lookup('paperwm@paperwm.github.com').stateObj;
    const settings = extension.getSettings();
    for (const key of ['horizontal-margin', 'vertical-margin', 'vertical-margin-bottom', 'window-gap'])
        settings.set_int(key, 0);
    settings.set_boolean('default-show-top-bar', false);
    settings.set_boolean('show-window-position-bar', false);
    Main.overview.hide();
    await wait();

    const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
    launcher.setenv('WAYLAND_DISPLAY', 'paperwm-test', true);
    launcher.setenv('GTK_A11Y', 'none', true);
    const chromium = GLib.find_program_in_path('chromium') ?? GLib.find_program_in_path('chromium-browser');
    assert(chromium, 'Chromium is required for the fullscreen regression test');
    GLib.file_set_contents(`${dir}/fullscreen.html`,
        '<!doctype html><title>PaperWM fullscreen test</title><body style="background:green">Fullscreen test</body>');
    const client = launcher.spawnv([chromium, '--ozone-platform=wayland',
        `--user-data-dir=${dir}/chromium-profile`, '--no-first-run',
        '--disable-background-networking', '--disable-sync', '--disable-extensions',
        `file://${dir}/fullscreen.html`]);
    try {
        await wait(1500);
        const window = global.get_window_actors().map(actor => actor.meta_window)
            .find(w => w.title?.includes('PaperWM fullscreen test'));
        assert(window && Tiling.isTiled(window), 'Wayland client starts tiled');
        // Use the secondary monitor so GNOME's primary-panel strut cannot
        // constrain the normal window to less than the fullscreen height.
        const secondary = Main.layoutManager.monitors.find(m => m !== Main.layoutManager.primaryMonitor);
        window.move_to_monitor(secondary.index);
        await wait();
        const space = Tiling.spaces.spaceOfWindow(window);
        const monitor = space.monitor;
        let sizeChanges = 0;
        const sizeId = window.connect('size-changed', () => sizeChanges++);

        for (const width of [500, monitor.width]) {
            window.move_resize_frame(true, monitor.x, monitor.y, width, monitor.height);
            await wait();
            const before = window.get_frame_rect();
            assert(before.width === width && before.height === monitor.height,
                `Requested ${width}x${monitor.height}, got ${before.width}x${before.height}`);
            checkGeometry(window, space);
            sizeChanges = 0;
            window.make_fullscreen();
            await wait();
            assert(window.fullscreen, 'Client enters fullscreen');
            if (width === monitor.width)
                assert(sizeChanges === 0, 'Full-size transition does not emit size-changed');
            checkGeometry(window, space);
            assert(window._fullscreen_lock, 'Fullscreen restoration state is tracked without a resize');

            window.unmake_fullscreen();
            await wait();
            const restored = window.get_frame_rect();
            assert(restored.width === before.width && restored.height === before.height,
                'Leaving fullscreen restores tiled dimensions');
            checkGeometry(window, space);
            assert(!window._fullscreen_lock, 'Fullscreen restoration lock is cleared');
        }
        window.disconnect(sizeId);

        // Close the client while the deferred fullscreen refresh is pending.
        window.make_fullscreen();
        client.force_exit();
        await wait();
        assert(!window.get_compositor_private(), 'Pending refresh tolerates a closed client');
        const result = 'PASS: fullscreen clipping, clone geometry and restoration with and without resize signals';
        print(result);
        GLib.file_set_contents(`${dir}/result`, result);
    } finally {
        client.force_exit();
    }
}
