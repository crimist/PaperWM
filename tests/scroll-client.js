// Small Wayland client for the isolated Shell integration test.
import Gtk from 'gi://Gtk?version=4.0';

const app = new Gtk.Application({ application_id: 'org.paperwm.ScrollTest' });
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'PaperWM scroll test client',
        default_width: 500,
        default_height: 400,
    });
    window.present();
});
app.run([]);
