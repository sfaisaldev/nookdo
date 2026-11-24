// Nookdo — persistent task storage (~/.local/share/nookdo/tasks.json)

import GLib from 'gi://GLib';

const FILE_VERSION = 1;

function newId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalize(raw) {
    const now = Date.now();
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        text: String(raw.text ?? '').slice(0, 500),
        done: Boolean(raw.done),
        priority: Math.min(3, Math.max(0, Number.parseInt(raw.priority, 10) || 0)),
        created: Number(raw.created) || now,
        completedAt: raw.done ? Number(raw.completedAt) || now : 0,
    };
}

export class TaskStore {
    constructor() {
        this._dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'nookdo']);
        this._path = GLib.build_filenamev([this._dir, 'tasks.json']);
        this.tasks = [];
        this._migrateLegacy();
        this._load();
    }

    get path() {
        return this._path;
    }

    // Carry tasks over from the pre-release name ("Glint Tasks").
    _migrateLegacy() {
        if (GLib.file_test(this._path, GLib.FileTest.EXISTS))
            return;
        const legacy = GLib.build_filenamev([GLib.get_user_data_dir(), 'glint-tasks', 'tasks.json']);
        if (!GLib.file_test(legacy, GLib.FileTest.EXISTS))
            return;
        try {
            const [ok, bytes] = GLib.file_get_contents(legacy);
            if (ok) {
                GLib.mkdir_with_parents(this._dir, 0o755);
                GLib.file_set_contents(this._path, bytes);
            }
        } catch (e) {
            console.warn(`[Nookdo] Could not migrate old tasks: ${e.message}`);
        }
    }

    _load() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this._path);
            if (!ok)
                return;
            const data = JSON.parse(new TextDecoder().decode(bytes));
            const list = Array.isArray(data) ? data : data?.tasks;
            if (Array.isArray(list)) {
                this.tasks = list
                    .filter(t => t && typeof t.text === 'string' && t.text.trim())
                    .map(normalize);
            }
        } catch (e) {
            if (!(e instanceof GLib.Error && e.matches(GLib.FileError, GLib.FileError.NOENT)))
                console.warn(`[Nookdo] Could not read ${this._path}: ${e.message}`);
        }
    }

    save() {
        try {
            GLib.mkdir_with_parents(this._dir, 0o755);
            const json = JSON.stringify({version: FILE_VERSION, tasks: this.tasks}, null, 2);
            GLib.file_set_contents(this._path, new TextEncoder().encode(json));
        } catch (e) {
            console.error(`[Nookdo] Could not save tasks: ${e.message}`);
        }
    }

    get(id) {
        return this.tasks.find(t => t.id === id) ?? null;
    }

    get total() {
        return this.tasks.length;
    }

    get doneCount() {
        return this.tasks.reduce((n, t) => n + (t.done ? 1 : 0), 0);
    }

    get pendingCount() {
        return this.total - this.doneCount;
    }

    add(text, priority = 0) {
        const task = normalize({text: text.trim(), priority, created: Date.now()});
        this.tasks.push(task);
        this.save();
        return task;
    }

    toggle(id) {
        const task = this.get(id);
        if (!task)
            return null;
        task.done = !task.done;
        task.completedAt = task.done ? Date.now() : 0;
        this.save();
        return task;
    }

    rename(id, text) {
        const task = this.get(id);
        if (!task || !text.trim())
            return null;
        task.text = text.trim().slice(0, 500);
        this.save();
        return task;
    }

    remove(id) {
        const idx = this.tasks.findIndex(t => t.id === id);
        if (idx < 0)
            return null;
        const [task] = this.tasks.splice(idx, 1);
        this.save();
        return task;
    }

    clearDone() {
        const removed = this.tasks.filter(t => t.done);
        if (removed.length) {
            this.tasks = this.tasks.filter(t => !t.done);
            this.save();
        }
        return removed;
    }

    restore(tasks) {
        for (const t of tasks) {
            if (!this.get(t.id))
                this.tasks.push(t);
        }
        this.save();
    }

    /**
     * Display order. Open tasks first (highest priority, then newest),
     * completed tasks after (most recently completed first).
     *
     * @param {boolean} doneToBottom keep completed tasks at the bottom
     */
    sorted(doneToBottom = true) {
        return [...this.tasks].sort((a, b) => {
            if (doneToBottom && a.done !== b.done)
                return a.done ? 1 : -1;
            if (doneToBottom && a.done && b.done)
                return b.completedAt - a.completedAt;
            if (a.priority !== b.priority)
                return b.priority - a.priority;
            return b.created - a.created;
        });
    }
}
