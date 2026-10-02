import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PATH = '/org/gnome/Shell/Extensions/PaperWM/ScrollCapture';
const IFACE = 'org.gnome.Shell.Extensions.PaperWM.ScrollCapture';
const XML = `<node><interface name="${IFACE}">
    <method name="Begin"><arg type="s" direction="in"/></method>
    <method name="End"><arg type="s" direction="in"/></method>
    <signal name="Scroll"><arg type="s"/><arg type="i"/><arg type="u"/></signal>
</interface></node>`;

function call(...args) {
    return new Promise((resolve, reject) => Gio.DBus.session.call(...args, (connection, result) => {
        try {
            resolve(connection.call_finish(result));
        } catch (error) {
            reject(error);
        }
    }));
}

// Mutter keeps Super+wheel in Shell even when a Wayland client inhibits
// keyboard shortcuts. Forward only to the focused process editing a shortcut.
export class ScrollCaptureService {
    constructor(focusedPid) {
        this.focusedPid = focusedPid;
        this.exported = Gio.DBusExportedObject.wrapJSObject(XML, this);
        this.exported.export(Gio.DBus.session, PATH);
    }

    async BeginAsync([token], invocation) {
        this.clear();
        const request = { sender: invocation.get_sender(), token, pid: 0 };
        this.request = request;
        try {
            const result = await call(
                'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                'GetConnectionUnixProcessID', new GLib.Variant('(s)', [request.sender]),
                new GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 1000, null);
            if (this.request === request) {
                [request.pid] = result.deep_unpack();
                this.watch = Gio.bus_watch_name_on_connection(Gio.DBus.session,
                    request.sender, Gio.BusNameWatcherFlags.NONE, null, () => {
                        if (this.request === request)
                            this.clear();
                    });
            }
            invocation.return_value(null);
        } catch (error) {
            if (this.request === request)
                this.clear();
            invocation.return_dbus_error(`${IFACE}.Failed`, error.message);
        }
    }

    EndAsync([token], invocation) {
        if (this.request?.sender === invocation.get_sender() && this.request.token === token)
            this.clear();
        invocation.return_value(null);
    }

    forward(direction, mods) {
        const request = this.request;
        if (!request?.pid || !mods || request.pid !== this.focusedPid())
            return false;
        Gio.DBus.session.emit_signal(request.sender, PATH, IFACE, 'Scroll',
            new GLib.Variant('(siu)', [request.token, direction, mods]));
        return true;
    }

    clear() {
        this.request = null;
        if (this.watch) {
            Gio.bus_unwatch_name(this.watch);
            this.watch = null;
        }
    }

    destroy() {
        this.clear();
        this.exported.unexport();
    }
}

export class ScrollCaptureClient {
    start(onScroll) {
        if (this.token)
            return;
        this.token = GLib.uuid_string_random();
        const token = this.token;
        this.subscription = Gio.DBus.session.signal_subscribe('org.gnome.Shell', IFACE,
            'Scroll', PATH, null, Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _iface, _signal, params) => {
                const [eventToken, direction, mods] = params.deep_unpack();
                if (this.token === eventToken)
                    onScroll(direction, mods);
            });
        this.call('Begin', token);
    }

    stop() {
        if (!this.token)
            return;
        Gio.DBus.session.signal_unsubscribe(this.subscription);
        this.call('End', this.token);
        this.token = null;
        this.subscription = null;
    }

    call(method, token) {
        // Recording also works with the explicit controls when PaperWM is off.
        call('org.gnome.Shell', PATH, IFACE, method,
            new GLib.Variant('(s)', [token]), null, Gio.DBusCallFlags.NO_AUTO_START,
            1000, null).catch(() => {});
    }
}
