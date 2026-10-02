// Real GTK shortcut editor for the private compositor integration test.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import { KeybindingsPane } from '../prefsKeybinding.js';

const dir = GLib.getenv('PAPERWM_TEST_DIR');
if (!dir || GLib.getenv('XDG_RUNTIME_DIR') !== `${dir}/runtime`)
    throw new Error('Requires an isolated Shell');
const app = new Gtk.Application({ application_id: 'org.paperwm.ScrollEditorTest' });
app.connect('activate', () => {
    const settings = new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.paperwm.keybindings' });
    const pane = new KeybindingsPane();
    pane.init({ getSettings: () => settings });
    pane._search.text = 'Switch to workspace above';
    const window = new Gtk.ApplicationWindow({ application: app,
        title: 'PaperWM scroll editor test', default_width: 780, default_height: 500, child: pane });
    window.present();
    GLib.file_set_contents(`${dir}/editor-status`, 'READY');
    let previous;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        const file = Gio.File.new_for_path(`${dir}/editor-command`);
        if (!file.query_exists(null))
            return GLib.SOURCE_CONTINUE;
        const command = new TextDecoder().decode(file.load_contents(null)[1]);
        if (command === previous)
            return GLib.SOURCE_CONTINUE;
        previous = command;
        for (let row = pane._listbox.get_first_child(); row; row = row.get_next_sibling()) {
            if (row.keybinding?.action !== 'switch-up-workspace')
                continue;
            row.expanded = true;
            const combo = row._comboList.get_row_at_index(0);
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                combo.editing = command.endsWith(':edit');
                print(`EDITOR ${command} editing=${combo.editing} token=${combo._scrollCapture.token}`);
                GLib.file_set_contents(`${dir}/editor-status`, command);
                return GLib.SOURCE_REMOVE;
            });
            break;
        }
        return GLib.SOURCE_CONTINUE;
    });
});
app.run([]);
