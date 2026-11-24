// Nookdo — a beautifully animated task list for the GNOME top bar
// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 sfaisal.dev

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {NookdoIndicator} from './indicator.js';

export default class NookdoExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new NookdoIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        Main.wm.addKeybinding(
            'toggle-shortcut',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._indicator?.toggle()
        );
    }

    disable() {
        Main.wm.removeKeybinding('toggle-shortcut');
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
