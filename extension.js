import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Cairo from 'gi://cairo';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// ---------------------------------------------------------------------------
// Geometry constants (see PRD §4). These are the "resting" (idle) and
// "expanded" (active/open) target states the morphing engine tweens between.
// ---------------------------------------------------------------------------
const IDLE_WIDTH = 140;
const IDLE_HEIGHT_EXTRA = 6;   // how far the idle notch hangs below the panel
const OPEN_WIDTH = 380;
const OPEN_HEIGHT_EXTRA = 46;
const R_OUTER = 14;            // convex bridge radius
const R_INNER = 10;            // concave corner radius
const EASE_TIME = 420;         // ms
const EASE_MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;
const BLEED = 2;               // extra canvas pixels above top edge to kill antialiasing seam

const MPRIS_BUS_NAME_PREFIX = 'org.mpris.MediaPlayer2.';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const MPRIS_PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const PlayerProxyWrapper = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
  </interface>
</node>`);

// ---------------------------------------------------------------------------
// GnotchActor — the visual widget. Draws its own silhouette on a
// Clutter.Canvas using the Bézier bridge/corner routine from the PRD, and
// hosts a label for now-playing text. Geometry is entirely programmatic:
// no CSS border-radius is used because CSS cannot express the inverse
// (convex-then-concave) corner routing the notch needs.
// ---------------------------------------------------------------------------
const GnotchActor = GObject.registerClass(
class GnotchActor extends St.Widget {
    _init() {
        super._init({
            reactive: true,
            track_hover: true,
            layout_manager: new Clutter.BinLayout(),
        });

        this._panelHeight = Main.panel.height;
        this._progress = 0; // 0 = idle, 1 = fully open
        this._expanded = false;

        this._canvas = new St.DrawingArea();
        this._canvas.connect('repaint', this._onDraw.bind(this));
        this.add_child(this._canvas);

        this._label = new St.Label({
            style_class: 'gnotch-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this.add_child(this._label);

        this.connect('button-press-event', this._onClick.bind(this));

        this._resize(IDLE_WIDTH, this._panelHeight + IDLE_HEIGHT_EXTRA);
    }

    // -- sizing -------------------------------------------------------------

    _resize(width, height) {
        this.set_size(width, height + BLEED);
        this._canvas.set_size(width, height + BLEED);
    }

    _currentWidth() {
        return IDLE_WIDTH + (OPEN_WIDTH - IDLE_WIDTH) * this._progress;
    }

    _currentHeight() {
        const idleH = this._panelHeight + IDLE_HEIGHT_EXTRA;
        const openH = this._panelHeight + OPEN_HEIGHT_EXTRA;
        return idleH + (openH - idleH) * this._progress;
    }

    // -- geometry / drawing ---------------------------------------------------
    // Implements PRD §4.2: a path that bridges the flat top-bar edge into the
    // hanging body via a convex curve, then rounds the bottom corners with a
    // concave curve, entirely with cr.curveTo Bézier segments (no border-radius).

    _onDraw(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();

        cr.save();
        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.restore();

        const Ph = Main.panel.height;
        const Ro = R_OUTER;
        const Ri = R_INNER;

        cr.setSourceRGBA(0.09, 0.09, 0.11, 0.98);
        cr.moveTo(0, 0);
        cr.lineTo(0, Ph);
        cr.curveTo(Ro / 2, Ph, Ro, Ph + (Ro / 2), Ro, Ph + Ro);
        cr.lineTo(Ro, height - Ri);
        cr.curveTo(Ro, height, Ro, height, Ro + Ri, height);
        cr.lineTo(width - Ro - Ri, height);
        cr.curveTo(width - Ro, height, width - Ro, height, width - Ro, height - Ri);
        cr.lineTo(width - Ro, Ph + Ro);
        cr.curveTo(width - Ro, Ph + (Ro / 2), width - (Ro / 2), Ph, width, Ph);
        cr.lineTo(width, 0);
        cr.closePath();
        cr.fill();

        cr.$dispose();
    }

    _redraw() {
        const w = Math.round(this._currentWidth());
        const h = Math.round(this._currentHeight());
        this._resize(w, h);
        this._canvas.queue_repaint();
    }

    // -- interaction ----------------------------------------------------------

    _onClick() {
        this.toggleExpanded();
        return Clutter.EVENT_STOP;
    }

    toggleExpanded(forceState) {
        const target = forceState !== undefined ? forceState : !this._expanded;
        if (target === this._expanded)
            return;
        this._expanded = target;

        this.ease_property('progress', target ? 1 : 0, {
            duration: EASE_TIME,
            mode: EASE_MODE,
            onUpdate: () => this._redraw(),
        });
    }

    // A GObject-less tween target: since we can't easily add a real GObject
    // property without a class boilerplate, we drive it manually here.
    ease_property(name, value, params) {
        if (name !== 'progress')
            return;
        const startValue = this._progress;
        const startTime = GLib.get_monotonic_time();
        const durationUs = params.duration * 1000;

        if (this._tweenTimeoutId) {
            GLib.source_remove(this._tweenTimeoutId);
            this._tweenTimeoutId = null;
        }

        this._tweenTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const now = GLib.get_monotonic_time();
            let t = Math.min(1, (now - startTime) / durationUs);
            // ease-out-cubic
            const eased = 1 - Math.pow(1 - t, 3);
            this._progress = startValue + (value - startValue) * eased;
            if (params.onUpdate)
                params.onUpdate();
            if (t >= 1) {
                this._tweenTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    // -- now playing ------------------------------------------------------

    setNowPlaying(title, artist, playing) {
        if (!title) {
            this._label.set_text('');
            this._label.visible = false;
            this.toggleExpanded(false);
            return;
        }
        const icon = playing ? '\u{1F3B5}' : '\u23F8';
        this._label.set_text(`${icon} ${title} \u2013 ${artist}`);
        this._label.visible = true;
    }

    destroy() {
        if (this._tweenTimeoutId) {
            GLib.source_remove(this._tweenTimeoutId);
            this._tweenTimeoutId = null;
        }
        super.destroy();
    }
});

// ---------------------------------------------------------------------------
// MPRIS tracking — fully event-driven: we watch for name-owner changes on the
// session bus for org.mpris.MediaPlayer2.* names, then subscribe to
// PropertiesChanged on whichever player is active. No polling loops.
// ---------------------------------------------------------------------------
class MprisWatcher {
    constructor(onChange) {
        this._onChange = onChange;
        this._playerProxy = null;
        this._propsSignalId = null;
        this._currentBusName = null;

        this._watcherId = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            'org.mpris.MediaPlayer2', // watched loosely; refined via ListNames below
            Gio.BusNameWatcherFlags.NONE,
            null, null
        );

        this._nameOwnerId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus',
            'org.freedesktop.DBus',
            'NameOwnerChanged',
            '/org/freedesktop/DBus',
            null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (!name.startsWith(MPRIS_BUS_NAME_PREFIX))
                    return;
                if (newOwner && !this._currentBusName)
                    this._attach(name);
                else if (!newOwner && name === this._currentBusName)
                    this._detach();
            }
        );

        this._findExistingPlayer();
    }

    _findExistingPlayer() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, null,
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deep_unpack();
                    const player = names.find(n => n.startsWith(MPRIS_BUS_NAME_PREFIX));
                    if (player)
                        this._attach(player);
                } catch (e) {
                    logError(e, 'Gnotch: failed to list bus names');
                }
            }
        );
    }

    _attach(busName) {
        this._currentBusName = busName;
        this._playerProxy = new PlayerProxyWrapper(
            Gio.DBus.session, busName, MPRIS_PATH,
            (proxy, error) => {
                if (error) {
                    logError(error, 'Gnotch: MPRIS proxy init failed');
                    return;
                }
                this._emit();
            }
        );
        this._propsSignalId = this._playerProxy.connect(
            'g-properties-changed', () => this._emit());
    }

    _detach() {
        if (this._playerProxy && this._propsSignalId) {
            this._playerProxy.disconnect(this._propsSignalId);
            this._propsSignalId = null;
        }
        this._playerProxy = null;
        this._currentBusName = null;
        this._onChange(null, null, false);
    }

    _emit() {
        if (!this._playerProxy)
            return;
        const status = this._playerProxy.PlaybackStatus;
        const meta = this._playerProxy.Metadata || {};
        const title = meta['xesam:title'] ? meta['xesam:title'].deep_unpack() : null;
        let artist = null;
        if (meta['xesam:artist']) {
            const arr = meta['xesam:artist'].deep_unpack();
            artist = Array.isArray(arr) ? arr.join(', ') : arr;
        }
        this._onChange(title, artist, status === 'Playing');
    }

    destroy() {
        if (this._watcherId)
            Gio.bus_unwatch_name(this._watcherId);
        if (this._nameOwnerId)
            Gio.DBus.session.signal_unsubscribe(this._nameOwnerId);
        this._detach();
    }
}

// ---------------------------------------------------------------------------
export default class GnotchExtension extends Extension {
    enable() {
        this._actor = new GnotchActor();
        Main.layoutManager.addChrome(this._actor, {
            affectsStruts: false,
            trackFullscreen: false,
        });
        this._positionActor();

        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._positionActor());

        this._mpris = new MprisWatcher((title, artist, playing) => {
            this._actor.setNowPlaying(title, artist, playing);
        });
    }

    _positionActor() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._actor)
            return;
        this._actor.set_position(
            Math.round(monitor.x + monitor.width / 2 - this._actor.width / 2),
            monitor.y - BLEED
        );
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._mpris) {
            this._mpris.destroy();
            this._mpris = null;
        }
        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
    }
}
