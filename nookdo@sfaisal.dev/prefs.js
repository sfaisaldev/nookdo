// Nookdo — preferences window

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ACCENTS = [
    ['system', 'System accent'],
    ['blue', 'Blue'],
    ['teal', 'Teal'],
    ['green', 'Green'],
    ['orange', 'Orange'],
    ['red', 'Red'],
    ['slate', 'Graphite'],
];

const THEMES = [
    ['system', 'Follow system'],
    ['light', 'Light'],
    ['dark', 'Dark'],
];

function addChoiceRow(group, settings, key, title, choices) {
    const model = new Gtk.StringList();
    for (const [, label] of choices)
        model.append(label);
    const row = new Adw.ComboRow({title, model});
    const sync = () => {
        const idx = choices.findIndex(([k]) => k === settings.get_string(key));
        row.selected = Math.max(0, idx);
    };
    sync();
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    settings.connect(`changed::${key}`, sync);
    group.add(row);
    return row;
}

export default class NookdoPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(620, 720);
        window.set_search_enabled(false);

        const page = new Adw.PreferencesPage({
            title: 'Nookdo',
            icon_name: 'object-select-symbolic',
        });
        window.add(page);

        /* Reminders */
        const reminders = new Adw.PreferencesGroup({
            title: 'Reminders',
            description: 'Nookdo can pop open on a timer — but only when you still have unfinished tasks.',
        });
        page.add(reminders);

        const enabled = new Adw.SwitchRow({
            title: 'Pop up with a reminder',
            subtitle: 'The timer restarts whenever you open the popup yourself',
        });
        settings.bind('reminder-enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        reminders.add(enabled);

        const interval = new Adw.SpinRow({
            title: 'Remind me every',
            subtitle: 'Minutes (60 = once an hour)',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 720, step_increment: 5, page_increment: 30}),
        });
        settings.bind('reminder-interval', interval, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('reminder-enabled', interval, 'sensitive', Gio.SettingsBindFlags.GET);
        reminders.add(interval);

        const autoclose = new Adw.SpinRow({
            title: 'Hide the reminder after',
            subtitle: 'Seconds, if you don’t touch it (0 keeps it open)',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 600, step_increment: 5, page_increment: 30}),
        });
        settings.bind('reminder-autoclose', autoclose, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('reminder-enabled', autoclose, 'sensitive', Gio.SettingsBindFlags.GET);
        reminders.add(autoclose);

        const fullscreen = new Adw.SwitchRow({
            title: 'Don’t interrupt fullscreen apps',
            subtitle: 'Skip the reminder while a video, game or presentation is fullscreen',
        });
        settings.bind('reminder-skip-fullscreen', fullscreen, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('reminder-enabled', fullscreen, 'sensitive', Gio.SettingsBindFlags.GET);
        reminders.add(fullscreen);

        const previewRow = new Adw.ActionRow({
            title: 'Preview a reminder',
            subtitle: 'Shows the popup exactly as the timer would',
        });
        const previewBtn = new Gtk.Button({label: 'Preview', valign: Gtk.Align.CENTER});
        previewBtn.add_css_class('pill');
        previewBtn.connect('clicked', () => {
            settings.set_int('reminder-preview', (settings.get_int('reminder-preview') + 1) % 100000);
        });
        previewRow.add_suffix(previewBtn);
        reminders.add(previewRow);

        /* Look & feel */
        const look = new Adw.PreferencesGroup({title: 'Look & feel'});
        page.add(look);

        addChoiceRow(look, settings, 'theme', 'Style', THEMES);
        addChoiceRow(look, settings, 'accent', 'Accent colour', ACCENTS);

        const badge = new Adw.SwitchRow({
            title: 'Show open-task count in the top bar',
        });
        settings.bind('show-badge', badge, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(badge);

        const celebrate = new Adw.SwitchRow({
            title: 'Celebrate completions',
            subtitle: 'A little confetti when you tick things off',
        });
        settings.bind('celebrate', celebrate, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(celebrate);

        const toBottom = new Adw.SwitchRow({
            title: 'Move completed tasks to the bottom',
        });
        settings.bind('completed-to-bottom', toBottom, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(toBottom);

        /* Shortcut */
        const keys = new Adw.PreferencesGroup({
            title: 'Keyboard',
            description: 'Inside the popup: Enter adds a task, Ctrl+1/2/3 sets priority (Ctrl+0 clears it), double-click a task to edit it.',
        });
        page.add(keys);

        const shortcut = new Adw.EntryRow({
            title: 'Open / close shortcut (e.g. <Super><Alt>t)',
            show_apply_button: true,
            text: settings.get_strv('toggle-shortcut')[0] ?? '',
        });
        shortcut.connect('apply', () => {
            const text = shortcut.text.trim();
            if (!text) {
                settings.set_strv('toggle-shortcut', []);
                shortcut.remove_css_class('error');
                return;
            }
            const [ok, key] = Gtk.accelerator_parse(text);
            if (ok && key !== 0) {
                settings.set_strv('toggle-shortcut', [text]);
                shortcut.remove_css_class('error');
            } else {
                shortcut.add_css_class('error');
            }
        });
        keys.add(shortcut);

        /* Data */
        const data = new Adw.PreferencesGroup({title: 'Your data'});
        page.add(data);
        const path = GLib.build_filenamev([GLib.get_user_data_dir(), 'nookdo', 'tasks.json']);
        const dataRow = new Adw.ActionRow({
            title: 'Tasks are saved locally',
            subtitle: path,
            subtitle_selectable: true,
        });
        data.add(dataRow);
    }
}
