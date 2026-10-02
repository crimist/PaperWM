#!/bin/sh
# Runs the integration test in a separate bus, compositor and settings backend.
# Requires GNOME Shell, GJS and dbus-run-session. Logs are retained in /tmp.
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /tmp/paperwm-scroll-test.XXXXXX)
mkdir -p "$test_dir/runtime" "$test_dir/config" "$test_dir/cache" "$test_dir/data/gnome-shell/extensions/wheel-test@paperwm.local"
chmod 700 "$test_dir/runtime"
ln -s "$repo_dir" "$test_dir/data/gnome-shell/extensions/paperwm@paperwm.github.com"
cat > "$test_dir/data/gnome-shell/extensions/wheel-test@paperwm.local/metadata.json" <<'EOF'
{"uuid":"wheel-test@paperwm.local","name":"PaperWM wheel test","description":"Isolated integration test","shell-version":["50"]}
EOF
cat > "$test_dir/data/gnome-shell/extensions/wheel-test@paperwm.local/extension.js" <<'EOF'
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
export default class WheelTest extends Extension {
    enable() {
        this.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            this.timer = null;
            const dir = GLib.getenv('PAPERWM_TEST_DIR');
            const moduleName = GLib.getenv('PAPERWM_TEST_MODULE');
            const file = Gio.File.new_for_path(`${dir}/data/gnome-shell/extensions/paperwm@paperwm.github.com/tests/${moduleName}`);
            import(file.get_uri())
                .then(module => module.run())
                .catch(error => GLib.file_set_contents(`${dir}/result`, `FAIL: ${error.message}\n${error.stack}`))
                .finally(() => global.context.terminate());
            return GLib.SOURCE_REMOVE;
        });
    }
    disable() {
        if (this.timer)
            GLib.source_remove(this.timer);
    }
}
EOF
timeout 45s dbus-run-session -- env \
    PAPERWM_TEST_DIR="$test_dir" \
    PAPERWM_TEST_MODULE="${PAPERWM_TEST_MODULE:-shell-scroll.js}" \
    XDG_RUNTIME_DIR="$test_dir/runtime" \
    XDG_CONFIG_HOME="$test_dir/config" \
    XDG_DATA_HOME="$test_dir/data" \
    XDG_CACHE_HOME="$test_dir/cache" \
    GSETTINGS_BACKEND=keyfile \
    sh -c '
        gsettings set org.gnome.shell enabled-extensions "[\"paperwm@paperwm.github.com\", \"wheel-test@paperwm.local\"]"
        gsettings set org.gnome.mutter dynamic-workspaces false
        gsettings set org.gnome.desktop.wm.preferences num-workspaces 6
        gsettings set org.gnome.desktop.interface enable-hot-corners false
        exec gnome-shell --headless --virtual-monitor=800x600 --virtual-monitor=800x600 --wayland-display=paperwm-test --no-x11
    ' > "$test_dir/shell.log" 2>&1 || true
printf 'Test logs: %s\n' "$test_dir/shell.log"
if [ -f "$test_dir/result" ]; then
    cat "$test_dir/result"
    printf '\n'
    case "$(cat "$test_dir/result")" in
        PASS:*) exit 0 ;;
    esac
fi
tail -60 "$test_dir/shell.log"
exit 1
