// Nookdo — top-bar indicator and the animated popup

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'cairo';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import {TaskStore} from './taskStore.js';
import * as Fx from './effects.js';

const M = Clutter.AnimationMode;
const SHELL_MAJOR = Number.parseInt(Config.PACKAGE_VERSION.split('.')[0], 10);

// GNOME 51 changed PopupMenu.open()/close() to take a params object.
function openMenu(menu) {
    if (SHELL_MAJOR >= 51)
        menu.open({animate: true});
    else
        menu.open(BoxPointer.PopupAnimation.FULL);
}

function closeMenu(menu) {
    if (SHELL_MAJOR >= 51)
        menu.close({animate: true});
    else
        menu.close(BoxPointer.PopupAnimation.FULL);
}

// Flat accent colours. Keys match the CSS classes generated in stylesheet.css.
// GNOME (47+) accent names, plus Ubuntu Yaru variants for older releases.
export const ACCENTS = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
    ubuntu: '#e95420',
    bark: '#787859',
    sage: '#657b69',
    olive: '#4b8501',
    viridian: '#03875b',
    prussiangreen: '#308280',
    'yaru-blue': '#0073e5',
    'yaru-purple': '#7764d8',
    magenta: '#b34cb3',
    'yaru-red': '#da3450',
};

const YARU_ACCENTS = {
    blue: 'yaru-blue', purple: 'yaru-purple', red: 'yaru-red', bark: 'bark', sage: 'sage',
    olive: 'olive', viridian: 'viridian', prussiangreen: 'prussiangreen', magenta: 'magenta',
};

const PRIORITIES = ['Normal', 'Low', 'Medium', 'High'];
const EXTRA_CONFETTI = ['#ffd166', '#06d6a0', '#4cc9f0', '#ff6b6b'];

const FILTERS = [
    {key: 'all', label: 'All'},
    {key: 'active', label: 'Active'},
    {key: 'done', label: 'Done'},
];

function vbox(params = {}) {
    const box = new St.BoxLayout(params);
    if (box.orientation !== undefined)
        box.orientation = Clutter.Orientation.VERTICAL; // GNOME 48+
    else
        box.vertical = true;
    return box;
}

function hexToRgb(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function relativeTime(ms) {
    const diff = Math.max(0, Date.now() - ms) / 1000;
    if (diff < 60)
        return 'just now';
    if (diff < 3600)
        return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)}h ago`;
    const days = Math.floor(diff / 86400);
    return days === 1 ? 'yesterday' : `${days}d ago`;
}

function firstName() {
    const real = GLib.get_real_name();
    const name = real && real !== 'Unknown' ? real.split(/\s+/)[0] : GLib.get_user_name();
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function greeting() {
    const h = new Date().getHours();
    if (h < 5)
        return 'Burning the midnight oil';
    if (h < 12)
        return 'Good morning';
    if (h < 18)
        return 'Good afternoon';
    return 'Good evening';
}

/**
 * Lays its single child out at full natural height regardless of the
 * container's own height, so height animations clip-reveal the row
 * instead of squashing (and blurring) its contents.
 */
const RevealLayout = GObject.registerClass(
class NookdoRevealLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width(container, forHeight) {
        const child = container.get_first_child();
        if (!child)
            return [0, 0];
        return child.get_preferred_width(forHeight);
    }

    vfunc_get_preferred_height(container, forWidth) {
        const child = container.get_first_child();
        return child ? child.get_preferred_height(forWidth) : [0, 0];
    }

    vfunc_allocate(container, box) {
        const child = container.get_first_child();
        if (!child)
            return;
        const width = box.get_width();
        const [, nat] = child.get_preferred_height(width);
        child.allocate(Clutter.ActorBox.new(0, 0, width, nat));
    }
});

/* ------------------------------------------------------------------ */
/* A single task row                                                   */
/* ------------------------------------------------------------------ */

class TaskRow {
    constructor(popup, task) {
        this.popup = popup;
        this.task = task;
        this.destroyed = false;
        this._editing = false;
        this._edit = null;

        this.actor = new St.Widget({
            layout_manager: new RevealLayout(),
            clip_to_allocation: true,
            x_expand: true,
        });
        this.row = new St.BoxLayout({
            style_class: 'nookdo-row',
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        this.actor.add_child(this.row);

        this._bar = new St.Widget({style_class: 'nookdo-bar', y_expand: true});

        this._checkIcon = new St.Icon({
            icon_name: 'object-select-symbolic',
            icon_size: 12,
            style_class: 'nookdo-check-icon',
        });
        this._checkIcon.set_pivot_point(0.5, 0.5);
        this.check = new St.Button({
            style_class: 'nookdo-check',
            child: this._checkIcon,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.check.set_pivot_point(0.5, 0.5);

        this._textBox = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'nookdo-label', reactive: true, x_expand: true});
        const ct = this._label.clutter_text;
        ct.line_wrap = true;
        ct.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        ct.ellipsize = Pango.EllipsizeMode.NONE;
        this._meta = new St.Label({style_class: 'nookdo-meta'});
        this._textBox.add_child(this._label);
        this._textBox.add_child(this._meta);

        this._del = new St.Button({
            style_class: 'nookdo-del',
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12}),
            can_focus: true,
            opacity: 0,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.row.add_child(this._bar);
        this.row.add_child(this.check);
        this.row.add_child(this._textBox);
        this.row.add_child(this._del);

        this.row.connect('notify::hover', () => {
            this._del.ease({
                opacity: this.row.hover || this._del.has_key_focus() ? 255 : 0,
                duration: 160,
                mode: M.EASE_OUT_QUAD,
            });
        });
        this._del.connect('key-focus-in', () => (this._del.opacity = 255));
        this.check.connect('clicked', () => this.popup.toggleTask(this));
        this._del.connect('clicked', () => this.popup.removeTask(this));
        this._label.connect('button-press-event', (_a, event) => {
            if (event.get_click_count() === 2) {
                this.startEdit();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this.sync();
    }

    _setText() {
        const esc = GLib.markup_escape_text(this.task.text, -1);
        this._label.clutter_text.set_markup(this.task.done ? `<s>${esc}</s>` : esc);
    }

    updateMeta() {
        const t = this.task;
        const when = t.done ? `Done ${relativeTime(t.completedAt)}` : `Added ${relativeTime(t.created)}`;
        this._meta.text = t.priority > 0 && !t.done ? `${PRIORITIES[t.priority]} priority · ${when}` : when;
    }

    sync() {
        const t = this.task;
        this._bar.style_class = `nookdo-bar nookdo-bar-${t.done ? 0 : t.priority}`;
        if (t.done) {
            this.row.add_style_class_name('done');
            this.check.add_style_class_name('checked');
        } else {
            this.row.remove_style_class_name('done');
            this.check.remove_style_class_name('checked');
        }
        this._checkIcon.scale_x = this._checkIcon.scale_y = t.done ? 1 : 0;
        this._checkIcon.opacity = t.done ? 255 : 0;
        this._setText();
        this.updateMeta();
    }

    animateToggle() {
        const done = this.task.done;
        this.check[done ? 'add_style_class_name' : 'remove_style_class_name']('checked');
        this._bar.style_class = `nookdo-bar nookdo-bar-${done ? 0 : this.task.priority}`;

        this._checkIcon.remove_all_transitions();
        this._checkIcon.ease({
            scale_x: done ? 1 : 0,
            scale_y: done ? 1 : 0,
            opacity: done ? 255 : 0,
            duration: done ? 420 : 200,
            mode: done ? M.EASE_OUT_BACK : M.EASE_IN_QUAD,
        });
        if (done)
            Fx.pop(this.check, 0.75, 460);

        // Cross-fade the label into its new (struck-through / restored) state.
        this._label.remove_all_transitions();
        this._label.ease({
            opacity: 0,
            translation_x: done ? 4 : -4,
            duration: 130,
            mode: M.EASE_IN_QUAD,
            onComplete: () => {
                this.row[done ? 'add_style_class_name' : 'remove_style_class_name']('done');
                this._setText();
                this.updateMeta();
                this._label.ease({
                    opacity: 255,
                    translation_x: 0,
                    duration: 260,
                    mode: M.EASE_OUT_CUBIC,
                });
            },
        });
    }

    startEdit() {
        if (this._editing || this.destroyed)
            return;
        this._editing = true;
        this._edit = new St.Entry({
            style_class: 'nookdo-edit-entry',
            text: this.task.text,
            can_focus: true,
            x_expand: true,
        });
        const ct = this._edit.clutter_text;
        ct.connect('activate', () => this.finishEdit(true));
        ct.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.finishEdit(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        ct.connect('key-focus-out', () => this.finishEdit(true));

        this._label.hide();
        this._textBox.insert_child_at_index(this._edit, 0);
        this._edit.opacity = 0;
        this._edit.ease({opacity: 255, duration: 180, mode: M.EASE_OUT_QUAD});
        this._edit.grab_key_focus();
        ct.set_selection(0, -1);
    }

    finishEdit(commit) {
        if (!this._editing)
            return;
        this._editing = false;
        const text = this._edit.get_text().trim();
        const edit = this._edit;
        this._edit = null;
        edit.destroy();
        this._label.show();
        if (commit && text && text !== this.task.text)
            this.popup.renameTask(this, text);
        this._label.opacity = 0;
        this._label.ease({opacity: 255, duration: 220, mode: M.EASE_OUT_QUAD});
    }

    destroy() {
        this.destroyed = true;
        this.actor.destroy();
    }
}

/* ------------------------------------------------------------------ */
/* The top-bar button + popup                                          */
/* ------------------------------------------------------------------ */

export const NookdoIndicator = GObject.registerClass(
class NookdoIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'Nookdo', false);

        this._ext = extension;
        this._settings = extension.getSettings();
        this._store = new TaskStore();
        this._rows = new Map();
        this._filter = 'all';
        this._priority = 0;
        this._timeouts = new Set();
        this._settingsIds = [];
        this._ringValue = 0;
        this._ringTimeline = null;
        this._emptyShown = null;
        this._lastPending = this._store.pendingCount;
        this._undoTasks = [];
        this._toastTimer = 0;
        this._autoCloseTimer = 0;
        this._reminderId = 0;
        this._nudge = false;
        this._accent = 'blue';
        this._theme = 'dark';
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ifaceIds = [];

        this._buildPanel();
        this._buildPopup();

        for (const task of this._store.sorted(this._doneToBottom))
            this._createRow(task, -1);

        this._watchSettings();
        this._applyAppearance();
        this._refreshMeta(false);
        this._refreshEmpty(false);
        this._restartReminder();
    }

    get _doneToBottom() {
        return this._settings.get_boolean('completed-to-bottom');
    }

    /* ---------------- panel ---------------- */

    _buildPanel() {
        const box = new St.BoxLayout({style_class: 'nookdo-panel-box'});
        this._panelIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._ext.path}/icons/nookdo-symbolic.svg`),
            style_class: 'system-status-icon nookdo-panel-icon',
        });
        this._badge = new St.Label({
            style_class: 'nookdo-badge',
            y_align: Clutter.ActorAlign.CENTER,
            text: '0',
        });
        this._badge.set_pivot_point(0.5, 0.5);
        box.add_child(this._panelIcon);
        box.add_child(this._badge);
        this.add_child(box);
    }

    /* ---------------- popup ---------------- */

    _buildPopup() {
        this.menu.actor.add_style_class_name('nookdo-menu');

        this._root = new St.Widget({
            style_class: 'nookdo-root',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        this._content = vbox({style_class: 'nookdo-content', x_expand: true, y_expand: true});
        this._fx = new Clutter.Actor({reactive: false, x_expand: true, y_expand: true});
        this._root.add_child(this._content);
        this._root.add_child(this._fx);

        this._buildNudge();
        this._buildHeader();
        this._buildAddBar();
        this._buildTabs();
        this._buildList();
        this._buildToast();
        this._buildFooter();

        this.menu.box.add_child(this._root);

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._onOpen();
            else
                this._onClose();
        });

        // Any interaction with a reminder popup keeps it open.
        this.menu.actor.connect('captured-event', (_a, event) => {
            const t = event.type();
            if (t === Clutter.EventType.BUTTON_PRESS || t === Clutter.EventType.KEY_PRESS ||
                t === Clutter.EventType.MOTION || t === Clutter.EventType.SCROLL ||
                t === Clutter.EventType.TOUCH_BEGIN)
                this._cancelAutoClose();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildNudge() {
        this._nudgeBox = new St.BoxLayout({style_class: 'nookdo-nudge', x_expand: true, visible: false});
        this._nudgeIcon = new St.Icon({icon_name: 'alarm-symbolic', icon_size: 16, style_class: 'nookdo-nudge-icon'});
        this._nudgeIcon.set_pivot_point(0.5, 0.5);
        const text = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._nudgeTitle = new St.Label({style_class: 'nookdo-nudge-title', text: 'Friendly nudge'});
        this._nudgeText = new St.Label({style_class: 'nookdo-nudge-text'});
        text.add_child(this._nudgeTitle);
        text.add_child(this._nudgeText);
        this._nudgeBox.add_child(this._nudgeIcon);
        this._nudgeBox.add_child(text);
        this._content.add_child(this._nudgeBox);
    }

    _buildHeader() {
        const header = new St.BoxLayout({style_class: 'nookdo-header', x_expand: true});
        const titles = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._dateLabel = new St.Label({style_class: 'nookdo-date'});
        this._title = new St.Label({style_class: 'nookdo-title'});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._subtitle = new St.Label({style_class: 'nookdo-subtitle'});
        titles.add_child(this._dateLabel);
        titles.add_child(this._title);
        titles.add_child(this._subtitle);
        this._titles = titles;

        this._ringWrap = new St.Widget({
            style_class: 'nookdo-ring',
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._ringWrap.set_pivot_point(0.5, 0.5);
        this._ring = new St.DrawingArea({x_expand: true, y_expand: true});
        this._ring.connect('repaint', area => this._paintRing(area));
        this._ringLabel = new St.Label({
            style_class: 'nookdo-ring-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            text: '0%',
        });
        this._ringWrap.add_child(this._ring);
        this._ringWrap.add_child(this._ringLabel);

        header.add_child(titles);
        header.add_child(this._ringWrap);
        this._header = header;
        this._content.add_child(header);
    }

    _buildAddBar() {
        this._addBar = new St.BoxLayout({style_class: 'nookdo-addbar', x_expand: true});
        this._entry = new St.Entry({
            style_class: 'nookdo-entry',
            hint_text: 'What needs doing?',
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const ct = this._entry.clutter_text;
        ct.set_max_length(500);
        ct.connect('activate', () => this._submit());
        ct.connect('key-focus-in', () => this._addBar.add_style_pseudo_class('focus'));
        ct.connect('key-focus-out', () => this._addBar.remove_style_pseudo_class('focus'));
        ct.connect('key-press-event', (_a, event) => {
            // Ctrl+1/2/3/0 sets priority while typing.
            if (event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                const map = {[Clutter.KEY_0]: 0, [Clutter.KEY_1]: 1, [Clutter.KEY_2]: 2, [Clutter.KEY_3]: 3};
                const sym = event.get_key_symbol();
                if (sym in map) {
                    this._setPriority(map[sym]);
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._prioDot = new St.Widget({style_class: 'nookdo-prio-dot', y_align: Clutter.ActorAlign.CENTER});
        this._prioLabel = new St.Label({text: PRIORITIES[0], y_align: Clutter.ActorAlign.CENTER});
        const chipBox = new St.BoxLayout({style_class: 'nookdo-prio-chip-box'});
        chipBox.add_child(this._prioDot);
        chipBox.add_child(this._prioLabel);
        this._prioBtn = new St.Button({
            style_class: 'nookdo-prio-chip nookdo-prio-0',
            child: chipBox,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._prioBtn.set_pivot_point(0.5, 0.5);
        this._prioBtn.connect('clicked', () => this._setPriority((this._priority + 1) % 4));

        this._addIcon = new St.Icon({icon_name: 'list-add-symbolic', icon_size: 16});
        this._addIcon.set_pivot_point(0.5, 0.5);
        this._addBtn = new St.Button({
            style_class: 'nookdo-add-btn',
            child: this._addIcon,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._addBtn.set_pivot_point(0.5, 0.5);
        this._addBtn.connect('clicked', () => this._submit());

        this._addBar.add_child(this._entry);
        this._addBar.add_child(this._prioBtn);
        this._addBar.add_child(this._addBtn);
        this._content.add_child(this._addBar);
    }

    _buildTabs() {
        this._tabsWrap = new St.Widget({
            style_class: 'nookdo-tabs',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this._pill = new St.Widget({
            style_class: 'nookdo-tab-pill',
            // x_expand is required so BinLayout honours START instead of centring.
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.FILL,
            y_expand: true,
        });
        const row = new St.BoxLayout({x_expand: true});
        this._tabs = FILTERS.map(f => {
            const box = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER, style_class: 'nookdo-tab-inner'});
            const label = new St.Label({text: f.label, y_align: Clutter.ActorAlign.CENTER});
            const count = new St.Label({style_class: 'nookdo-tab-count', text: '0', y_align: Clutter.ActorAlign.CENTER});
            box.add_child(label);
            box.add_child(count);
            const btn = new St.Button({style_class: 'nookdo-tab', child: box, x_expand: true, can_focus: true});
            btn.connect('clicked', () => this._setFilter(f.key));
            row.add_child(btn);
            return {key: f.key, btn, count};
        });
        this._tabsWrap.add_child(this._pill);
        this._tabsWrap.add_child(row);
        this._tabs[0].btn.add_style_pseudo_class('checked');
        this._content.add_child(this._tabsWrap);
    }

    _buildList() {
        this._list = vbox({style_class: 'nookdo-list', x_expand: true});
        this._scroll = new St.ScrollView({
            style_class: 'nookdo-scroll vfade',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        if (typeof this._scroll.set_child === 'function')
            this._scroll.set_child(this._list); // GNOME 46+
        else
            this._scroll.add_actor(this._list); // GNOME 45
        this._content.add_child(this._scroll);

        // Empty state
        this._empty = vbox({style_class: 'nookdo-empty', x_expand: true, visible: false});
        this._emptyIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._ext.path}/icons/nookdo-empty-symbolic.svg`),
            icon_size: 44,
            style_class: 'nookdo-empty-icon',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._emptyTitle = new St.Label({style_class: 'nookdo-empty-title', x_align: Clutter.ActorAlign.CENTER});
        this._emptyText = new St.Label({style_class: 'nookdo-empty-text', x_align: Clutter.ActorAlign.CENTER});
        this._empty.add_child(this._emptyIcon);
        this._empty.add_child(this._emptyTitle);
        this._empty.add_child(this._emptyText);
        this._content.add_child(this._empty);
    }

    _buildToast() {
        this._toast = new St.BoxLayout({style_class: 'nookdo-toast', x_expand: true, visible: false});
        this._toastLabel = new St.Label({style_class: 'nookdo-toast-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const undo = new St.Button({style_class: 'nookdo-toast-btn', label: 'Undo', can_focus: true, y_align: Clutter.ActorAlign.CENTER});
        undo.connect('clicked', () => this._undo());
        this._toast.add_child(this._toastLabel);
        this._toast.add_child(undo);
        this._content.add_child(this._toast);
    }

    _buildFooter() {
        const footer = new St.BoxLayout({style_class: 'nookdo-footer', x_expand: true});
        this._countLabel = new St.Label({style_class: 'nookdo-count', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._clearBtn = new St.Button({style_class: 'nookdo-ghost-btn', label: 'Clear done', can_focus: true, y_align: Clutter.ActorAlign.CENTER});
        this._clearBtn.connect('clicked', () => this._clearDone());
        const gear = new St.Button({
            style_class: 'nookdo-icon-btn',
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 14}),
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        gear.connect('clicked', () => {
            closeMenu(this.menu);
            this._ext.openPreferences();
        });
        footer.add_child(this._countLabel);
        footer.add_child(this._clearBtn);
        footer.add_child(gear);
        this._content.add_child(footer);
    }

    /* ---------------- settings ---------------- */

    _watchSettings() {
        const on = (key, fn) => this._settingsIds.push(this._settings.connect(`changed::${key}`, fn));
        on('accent', () => this._applyAppearance());
        on('theme', () => this._applyAppearance());
        // Follow the desktop's light/dark mode and accent colour live.
        for (const key of ['color-scheme', 'accent-color', 'gtk-theme']) {
            if (this._iface.settings_schema.has_key(key))
                this._ifaceIds.push(this._iface.connect(`changed::${key}`, () => this._applyAppearance()));
        }
        on('show-badge', () => this._refreshBadge(false));
        on('reminder-enabled', () => this._restartReminder());
        on('reminder-interval', () => this._restartReminder());
        on('reminder-preview', () => this._fireReminder(true));
        on('completed-to-bottom', () => this._resortAll());
    }

    _systemAccent() {
        if (this._iface.settings_schema.has_key('accent-color')) {
            const name = this._iface.get_string('accent-color');
            if (ACCENTS[name])
                return name;
        }
        // Ubuntu 24.04 and earlier encode the accent in the theme name: Yaru-<accent>[-dark]
        const gtk = this._iface.get_string('gtk-theme');
        const m = /^Yaru(?:-([a-z]+))?(?:-dark)?$/.exec(gtk);
        if (m)
            return m[1] && m[1] !== 'dark' ? YARU_ACCENTS[m[1]] ?? 'ubuntu' : 'ubuntu';
        return 'blue';
    }

    _systemTheme() {
        if (this._iface.get_string('color-scheme') === 'prefer-dark')
            return 'dark';
        return /-dark$/i.test(this._iface.get_string('gtk-theme')) ? 'dark' : 'light';
    }

    _applyAppearance() {
        const choice = this._settings.get_string('accent');
        const accent = choice === 'system' || !ACCENTS[choice] ? this._systemAccent() : choice;
        const themeChoice = this._settings.get_string('theme');
        const theme = themeChoice === 'light' || themeChoice === 'dark' ? themeChoice : this._systemTheme();

        for (const actor of [this, this._root, this.menu.actor]) {
            actor.remove_style_class_name(`nookdo-accent-${this._accent}`);
            actor.add_style_class_name(`nookdo-accent-${accent}`);
        }
        for (const actor of [this._root, this.menu.actor]) {
            actor.remove_style_class_name(`nookdo-${this._theme}`);
            actor.add_style_class_name(`nookdo-${theme}`);
        }
        this._accent = accent;
        this._theme = theme;
        this._ring.queue_repaint();
    }

    /* ---------------- helpers ---------------- */

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    _cancel(id) {
        if (id && this._timeouts.has(id)) {
            GLib.Source.remove(id);
            this._timeouts.delete(id);
        }
        return 0;
    }

    _matches(task) {
        if (this._filter === 'active')
            return !task.done;
        if (this._filter === 'done')
            return task.done;
        return true;
    }

    _desiredIndex(id) {
        return this._store.sorted(this._doneToBottom).findIndex(t => t.id === id);
    }

    _fxPoint(actor) {
        const [ax, ay] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const [fx, fy] = this._fx.get_transformed_position();
        return [ax - fx + w / 2, ay - fy + h / 2];
    }

    _confettiColors() {
        return [ACCENTS[this._accent], ACCENTS[this._accent], ...EXTRA_CONFETTI];
    }

    _createRow(task, index) {
        const row = new TaskRow(this, task);
        this._rows.set(task.id, row);
        if (index < 0)
            this._list.add_child(row.actor);
        else
            this._list.insert_child_at_index(row.actor, index);
        row.actor.visible = this._matches(task);
        return row;
    }

    /* ---------------- open / close ---------------- */

    _onOpen() {
        const now = GLib.DateTime.new_now_local();
        this._dateLabel.text = now.format('%A, %e %B').replace(/\s+/g, ' ').toUpperCase();
        this._title.text = `${greeting()}, ${firstName()}`;

        for (const row of this._rows.values())
            row.updateMeta();

        // Header entrance
        this._titles.opacity = 0;
        this._titles.translation_y = 8;
        this._titles.ease({opacity: 255, translation_y: 0, duration: 420, delay: 40, mode: M.EASE_OUT_EXPO});
        this._ringWrap.scale_x = this._ringWrap.scale_y = 0.6;
        this._ringWrap.opacity = 0;
        this._ringWrap.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 520, delay: 80, mode: M.EASE_OUT_BACK});
        this._animateRing(this._ratio(), 0);

        for (const [i, actor] of [this._addBar, this._tabsWrap].entries()) {
            actor.opacity = 0;
            actor.translation_y = 10;
            actor.ease({opacity: 255, translation_y: 0, duration: 380, delay: 90 + i * 45, mode: M.EASE_OUT_EXPO});
        }

        // Staggered rows
        const visible = this._list.get_children().filter(a => a.visible);
        visible.forEach((actor, i) => {
            if (i > 14)
                return;
            actor.opacity = 0;
            actor.translation_y = 12;
            actor.ease({
                opacity: 255,
                translation_y: 0,
                duration: 420,
                delay: 170 + i * 38,
                mode: M.EASE_OUT_EXPO,
            });
        });

        if (this._emptyShown)
            Fx.startFloat(this._emptyIcon);

        this._later(30, () => this._syncPill(false));
        this._later(120, () => {
            if (this.menu.isOpen && !this._nudge)
                this._entry.grab_key_focus();
        });

        if (this._nudge) {
            this._nudgeText.text = this._store.pendingCount === 1
                ? 'You still have 1 task waiting.'
                : `You still have ${this._store.pendingCount} tasks waiting.`;
            Fx.expandIn(this._nudgeBox, {duration: 360, delay: 120, fromY: -8});
            this._later(520, () => Fx.wiggle(this._nudgeIcon));
            const secs = this._settings.get_int('reminder-autoclose');
            if (secs > 0) {
                this._autoCloseTimer = this._later(secs * 1000, () => {
                    this._autoCloseTimer = 0;
                    if (this.menu.isOpen && this._nudge)
                        closeMenu(this.menu);
                });
            }
        } else {
            // A manual look counts as a check-in: restart the reminder clock.
            this._restartReminder();
        }
    }

    _onClose() {
        this._cancelAutoClose();
        Fx.stopFloat(this._emptyIcon);
        if (this._nudge) {
            this._nudge = false;
            this._later(300, () => {
                if (!this.menu.isOpen)
                    this._nudgeBox.hide();
            });
        }
        for (const row of this._rows.values())
            row.finishEdit(true);
        this._hideToast(false);
    }

    _cancelAutoClose() {
        this._autoCloseTimer = this._cancel(this._autoCloseTimer);
    }

    /* ---------------- progress ring ---------------- */

    _ratio() {
        const total = this._store.total;
        return total ? this._store.doneCount / total : 0;
    }

    _animateRing(target, from = this._ringValue) {
        if (this._ringTimeline) {
            this._ringTimeline.stop();
            this._ringTimeline = null;
        }
        const setValue = v => {
            this._ringValue = v;
            this._ringLabel.text = `${Math.round(v * 100)}%`;
            this._ring.queue_repaint();
        };
        if (!this._ring.mapped || from === target) {
            setValue(target);
            return;
        }
        const tl = new Clutter.Timeline({actor: this._ring, duration: 900});
        tl.set_progress_mode(M.EASE_OUT_CUBIC);
        tl.connect('new-frame', () => setValue(from + (target - from) * tl.get_progress()));
        tl.connect('completed', () => {
            setValue(target);
            if (this._ringTimeline === tl)
                this._ringTimeline = null;
        });
        this._ringTimeline = tl;
        setValue(from);
        tl.start();
    }

    _paintRing(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const lw = Math.max(4, Math.round(Math.min(w, h) * 0.095));
        const r = Math.min(w, h) / 2 - lw / 2 - 1;
        const cx = w / 2, cy = h / 2;

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(lw);
        if (this._theme === 'light')
            cr.setSourceRGBA(0, 0, 0, 0.08);
        else
            cr.setSourceRGBA(1, 1, 1, 0.1);
        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.stroke();

        const v = Math.max(0, Math.min(1, this._ringValue));
        if (v > 0.001) {
            cr.setSourceRGBA(...hexToRgb(ACCENTS[this._accent]), 1);
            const start = -Math.PI / 2;
            cr.arc(cx, cy, r, start, start + 2 * Math.PI * v);
            cr.stroke();
        }
        cr.$dispose();
    }

    /* ---------------- meta, badge, empty ---------------- */

    _refreshMeta(animate = true) {
        const total = this._store.total;
        const done = this._store.doneCount;
        const pending = total - done;

        if (total === 0)
            this._subtitle.text = 'A clean slate. What’s first?';
        else if (pending === 0)
            this._subtitle.text = 'Everything’s done — lovely work ✨';
        else
            this._subtitle.text = pending === 1 ? '1 task to go' : `${pending} tasks to go`;

        this._countLabel.text = total ? `${pending} open · ${done} done` : 'No tasks yet';
        const counts = {all: total, active: pending, done};
        for (const tab of this._tabs)
            tab.count.text = String(counts[tab.key]);

        this._clearBtn.reactive = done > 0;
        this._clearBtn.can_focus = done > 0;
        this._clearBtn.ease({opacity: done > 0 ? 255 : 90, duration: 200, mode: M.EASE_OUT_QUAD});

        if (animate)
            this._animateRing(this._ratio());
        else
            this._animateRing(this._ratio(), this._ratio());

        this._refreshBadge(animate);
    }

    _refreshBadge(animate = true) {
        const pending = this._store.pendingCount;
        const show = pending > 0 && this._settings.get_boolean('show-badge');
        const changed = pending !== this._lastPending;
        this._badge.text = pending > 99 ? '99+' : String(pending);
        this._lastPending = pending;

        if (show && !this._badge.visible) {
            this._badge.show();
            this._badge.scale_x = this._badge.scale_y = 0;
            this._badge.ease({scale_x: 1, scale_y: 1, duration: 380, mode: M.EASE_OUT_BACK});
        } else if (!show && this._badge.visible) {
            if (!animate || !this._badge.mapped) {
                this._badge.hide();
            } else {
                this._badge.ease({
                    scale_x: 0,
                    scale_y: 0,
                    duration: 200,
                    mode: M.EASE_IN_BACK,
                    onComplete: () => this._badge.hide(),
                });
            }
        } else if (show && changed && animate) {
            Fx.pop(this._badge, 1.45, 450);
        }
    }

    _refreshEmpty(animate = true) {
        const copy = {
            all: ['Nothing here yet', 'Type a task above and press Enter'],
            active: ['All caught up', 'No open tasks — enjoy the calm'],
            done: ['Nothing finished yet', 'Completed tasks will land here'],
        }[this._filter];
        this._emptyTitle.text = copy[0];
        this._emptyText.text = copy[1];

        const show = !this._store.tasks.some(t => this._matches(t));
        if (show === this._emptyShown)
            return;
        this._emptyShown = show;

        if (!animate) {
            this._empty.visible = show;
            return;
        }
        if (show) {
            Fx.expandIn(this._empty, {duration: 360, delay: 140, fromY: 10, onComplete: () => {
                if (this._emptyShown && this.menu.isOpen)
                    Fx.startFloat(this._emptyIcon);
            }});
        } else {
            Fx.stopFloat(this._emptyIcon);
            Fx.collapseOut(this._empty, {duration: 200, onComplete: () => this._empty.hide()});
        }
    }

    /* ---------------- actions ---------------- */

    _setPriority(p) {
        this._priority = p;
        this._prioBtn.style_class = `nookdo-prio-chip nookdo-prio-${p}`;
        this._prioLabel.text = PRIORITIES[p];
        Fx.pop(this._prioBtn, 0.82, 380);
    }

    _submit() {
        const text = this._entry.get_text().trim();
        if (!text) {
            Fx.shake(this._addBar);
            return;
        }
        const task = this._store.add(text, this._priority);
        this._entry.set_text('');
        if (this._priority !== 0)
            this._setPriority(0);

        // Spin the plus.
        this._addIcon.remove_transition('rotation-angle-z');
        this._addIcon.rotation_angle_z = 0;
        this._addIcon.ease({
            rotation_angle_z: 180,
            duration: 460,
            mode: M.EASE_OUT_BACK,
            onComplete: () => (this._addIcon.rotation_angle_z = 0),
        });
        Fx.pop(this._addBtn, 0.8, 380);

        if (this._filter === 'done')
            this._setFilter('all');

        const row = this._createRow(task, this._desiredIndex(task.id));
        row.actor.visible = false;
        Fx.expandIn(row.actor, {duration: 340, fromX: 28});
        this._later(200, () => {
            if (!row.destroyed && row.actor.mapped) {
                const [x, y] = this._fxPoint(row.check);
                Fx.ripple(this._fx, x, y, ACCENTS[this._accent]);
            }
        });

        this._refreshMeta();
        this._refreshEmpty();
        this._entry.grab_key_focus();
    }

    toggleTask(row) {
        const before = this._store.pendingCount;
        const task = this._store.toggle(row.task.id);
        if (!task)
            return;
        row.task = task;
        row.animateToggle();

        if (task.done && this._settings.get_boolean('celebrate') && row.check.mapped) {
            const [x, y] = this._fxPoint(row.check);
            Fx.ripple(this._fx, x, y, ACCENTS[this._accent]);
            Fx.burst(this._fx, x, y, this._confettiColors(), {count: 12, distance: 40});
        }

        this._refreshMeta();
        if (before > 0 && this._store.pendingCount === 0 && task.done)
            this._later(260, () => this._celebrate());

        this._later(430, () => this._reflow(row));
    }

    _celebrate() {
        if (!this.menu.isOpen)
            return;
        Fx.pop(this._ringWrap, 1.25, 600);
        if (!this._settings.get_boolean('celebrate'))
            return;
        const [x, y] = this._fxPoint(this._ringWrap);
        Fx.burst(this._fx, x, y, this._confettiColors(), {count: 26, distance: 120, size: 6, duration: 1100});
        this._later(140, () => Fx.burst(this._fx, x, y, this._confettiColors(), {count: 18, distance: 70, size: 5, duration: 900}));
    }

    /** Move a row to its sorted slot / hide it if the filter excludes it. */
    _reflow(row) {
        if (row.destroyed)
            return;
        const actor = row.actor;
        const want = this._desiredIndex(row.task.id);
        const cur = this._list.get_children().indexOf(actor);
        const show = this._matches(row.task);

        if (!show) {
            Fx.collapseOut(actor, {duration: 260, onComplete: () => {
                actor.hide();
                this._list.set_child_at_index(actor, this._desiredIndex(row.task.id));
                this._refreshEmpty();
            }});
            this._refreshEmpty();
            return;
        }
        if (want === cur || want < 0)
            return;
        Fx.collapseOut(actor, {duration: 220, onComplete: () => {
            if (row.destroyed)
                return;
            this._list.set_child_at_index(actor, this._desiredIndex(row.task.id));
            Fx.expandIn(actor, {duration: 320, fromY: want > cur ? -10 : 10});
        }});
    }

    _resortAll() {
        for (const task of this._store.sorted(this._doneToBottom)) {
            const row = this._rows.get(task.id);
            if (row)
                this._list.set_child_at_index(row.actor, this._desiredIndex(task.id));
        }
    }

    renameTask(row, text) {
        const task = this._store.rename(row.task.id, text);
        if (task) {
            row.task = task;
            row.sync();
        }
    }

    removeTask(row) {
        const task = this._store.remove(row.task.id);
        if (!task)
            return;
        this._rows.delete(task.id);
        row.destroyed = true;
        Fx.swipeAway(row.actor, {onComplete: () => row.actor.destroy()});
        this._refreshMeta();
        this._later(260, () => this._refreshEmpty());
        this._showToast([task], 'Task removed');
    }

    _clearDone() {
        const removed = this._store.clearDone();
        if (!removed.length)
            return;
        let i = 0;
        for (const actor of this._list.get_children()) {
            const row = [...this._rows.values()].find(r => r.actor === actor);
            if (!row || !row.task.done)
                continue;
            this._rows.delete(row.task.id);
            row.destroyed = true;
            const delay = actor.visible ? i++ * 45 : 0;
            Fx.swipeAway(actor, {delay, onComplete: () => actor.destroy()});
        }
        this._refreshMeta();
        this._later(260 + i * 45, () => this._refreshEmpty());
        this._showToast(removed, removed.length === 1 ? 'Cleared 1 task' : `Cleared ${removed.length} tasks`);
    }

    _setFilter(key) {
        if (key === this._filter)
            return;
        this._filter = key;
        for (const tab of this._tabs) {
            if (tab.key === key)
                tab.btn.add_style_pseudo_class('checked');
            else
                tab.btn.remove_style_pseudo_class('checked');
        }
        this._syncPill(true);

        let k = 0;
        for (const row of this._rows.values()) {
            const show = this._matches(row.task);
            const actor = row.actor;
            if (show && !actor.visible) {
                actor.visible = false;
                Fx.expandIn(actor, {duration: 300, delay: 60 + Math.min(k++, 10) * 28, fromY: 8});
            } else if (!show && actor.visible) {
                Fx.collapseOut(actor, {duration: 220, onComplete: () => actor.hide()});
            }
        }
        this._refreshEmpty();
    }

    _syncPill(animate) {
        const tab = this._tabs.find(t => t.key === this._filter);
        if (!tab || tab.btn.width <= 0)
            return;
        this._pill.width = tab.btn.width;
        if (animate && this._pill.mapped) {
            this._pill.ease({translation_x: tab.btn.x, duration: 340, mode: M.EASE_OUT_BACK});
        } else {
            this._pill.remove_transition('translation-x');
            this._pill.translation_x = tab.btn.x;
        }
    }

    /* ---------------- undo toast ---------------- */

    _showToast(tasks, text) {
        this._undoTasks = tasks;
        this._toastLabel.text = text;
        this._toastTimer = this._cancel(this._toastTimer);
        if (!this._toast.visible)
            Fx.expandIn(this._toast, {duration: 300, fromY: 10});
        else
            Fx.pop(this._toastLabel, 1.08, 260);
        this._toastTimer = this._later(5000, () => {
            this._toastTimer = 0;
            this._hideToast(true);
        });
    }

    _hideToast(animate) {
        this._toastTimer = this._cancel(this._toastTimer);
        this._undoTasks = [];
        if (!this._toast.visible)
            return;
        if (animate)
            Fx.collapseOut(this._toast, {duration: 220, onComplete: () => this._toast.hide()});
        else
            this._toast.hide();
    }

    _undo() {
        const tasks = this._undoTasks;
        if (!tasks.length)
            return;
        this._store.restore(tasks);
        tasks.forEach((task, i) => {
            const row = this._createRow(task, this._desiredIndex(task.id));
            const show = row.actor.visible;
            row.actor.visible = false;
            if (show)
                Fx.expandIn(row.actor, {duration: 320, delay: i * 40, fromX: -28});
        });
        this._hideToast(true);
        this._refreshMeta();
        this._refreshEmpty();
    }

    /* ---------------- reminders ---------------- */

    _restartReminder() {
        if (this._reminderId) {
            GLib.Source.remove(this._reminderId);
            this._reminderId = 0;
        }
        if (!this._settings.get_boolean('reminder-enabled'))
            return;
        const minutes = Math.max(1, this._settings.get_int('reminder-interval'));
        this._reminderId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._fireReminder(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _fireReminder(preview) {
        if (this._store.pendingCount === 0) {
            if (preview)
                Main.notify('Nookdo', 'Reminders only pop up while you have open tasks — add one first.');
            return;
        }
        if (this.menu.isOpen || Main.sessionMode.isLocked)
            return;
        if (!preview) {
            if (Main.modalCount > 0 || Main.overview.visible)
                return;
            if (this._settings.get_boolean('reminder-skip-fullscreen')) {
                const win = global.display.focus_window;
                if (win && win.is_fullscreen())
                    return;
            }
        }
        this._nudge = true;
        Fx.wiggle(this._panelIcon);
        this._later(380, () => {
            if (this._nudge && !this.menu.isOpen)
                openMenu(this.menu);
        });
    }

    toggle() {
        this.menu.toggle();
    }

    /* ---------------- teardown ---------------- */

    destroy() {
        if (this._reminderId) {
            GLib.Source.remove(this._reminderId);
            this._reminderId = 0;
        }
        for (const id of this._timeouts)
            GLib.Source.remove(id);
        this._timeouts.clear();
        if (this._ringTimeline) {
            this._ringTimeline.stop();
            this._ringTimeline = null;
        }
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        for (const id of this._ifaceIds)
            this._iface.disconnect(id);
        this._ifaceIds = [];
        this._iface = null;
        this._rows.clear();
        super.destroy();
    }
});
