// Nookdo — animation helpers built on Clutter's implicit animations (actor.ease)

import Clutter from 'gi://Clutter';
import St from 'gi://St';

const M = Clutter.AnimationMode;

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

/** Resolve CSS for a freshly created subtree so it can be measured correctly. */
function ensureStyles(actor) {
    if (actor instanceof St.Widget)
        actor.ensure_style();
    for (const child of actor.get_children())
        ensureStyles(child);
}

function naturalHeight(actor) {
    // Use the parent's last real allocation: while a relayout is pending,
    // `parent.width` reports the preferred (minimum) width instead.
    const parent = actor.get_parent();
    const allocated = parent ? parent.get_allocation_box().get_width() : 0;
    const forWidth = allocated > 0 ? allocated : -1;
    actor.set_height(-1);
    ensureStyles(actor);
    const [, nat] = actor.get_preferred_height(forWidth);
    return nat;
}

/** Grow an actor from zero height, sliding and fading it in. */
export function expandIn(actor, {duration = 300, delay = 0, fromX = 0, fromY = 0, onComplete = null} = {}) {
    actor.remove_all_transitions();
    actor.show();

    if (!actor.mapped) {
        actor.set_height(-1);
        actor.opacity = 255;
        actor.translation_x = 0;
        actor.translation_y = 0;
        onComplete?.();
        return;
    }

    const target = naturalHeight(actor);
    actor.clip_to_allocation = true;
    actor.height = 0;
    actor.opacity = 0;
    actor.translation_x = fromX;
    actor.translation_y = fromY;

    actor.ease({
        height: target,
        duration,
        delay,
        mode: M.EASE_OUT_CUBIC,
        onComplete: () => actor.set_height(-1),
    });
    actor.ease({
        opacity: 255,
        translation_x: 0,
        translation_y: 0,
        duration: duration + 120,
        delay: delay + 50,
        mode: M.EASE_OUT_EXPO,
        onComplete: () => onComplete?.(),
    });
}

/** Collapse an actor to zero height while fading it out. */
export function collapseOut(actor, {duration = 240, delay = 0, onComplete = null} = {}) {
    actor.remove_all_transitions();
    if (!actor.mapped || !actor.visible) {
        onComplete?.();
        return;
    }
    actor.clip_to_allocation = true;
    actor.set_height(actor.height);
    actor.ease({
        height: 0,
        opacity: 0,
        duration,
        delay,
        mode: M.EASE_IN_OUT_CUBIC,
        onComplete: () => onComplete?.(),
    });
}

/** Swipe an actor sideways, then close the gap it leaves. */
export function swipeAway(actor, {delay = 0, onComplete = null} = {}) {
    actor.remove_all_transitions();
    if (!actor.mapped) {
        onComplete?.();
        return;
    }
    actor.ease({
        translation_x: 70 * scaleFactor(),
        opacity: 0,
        duration: 200,
        delay,
        mode: M.EASE_IN_QUAD,
        onComplete: () => collapseOut(actor, {duration: 200, onComplete}),
    });
}

/** Springy scale "pop". */
export function pop(actor, from = 1.3, duration = 420) {
    if (!actor.mapped)
        return;
    actor.set_pivot_point(0.5, 0.5);
    actor.remove_transition('scale-x');
    actor.remove_transition('scale-y');
    actor.scale_x = from;
    actor.scale_y = from;
    actor.ease({scale_x: 1, scale_y: 1, duration, mode: M.EASE_OUT_BACK});
}

/** "Nope" shake, used when submitting an empty task. */
export function shake(actor) {
    if (!actor.mapped)
        return;
    const s = scaleFactor();
    const steps = [-9, 8, -6, 4, -2, 0];
    actor.remove_transition('translation-x');
    const next = i => {
        if (i >= steps.length)
            return;
        actor.ease({
            translation_x: steps[i] * s,
            duration: 55,
            mode: M.EASE_IN_OUT_SINE,
            onComplete: () => next(i + 1),
        });
    };
    next(0);
}

/** Playful rotation wiggle, used on the panel icon for reminders. */
export function wiggle(actor) {
    if (!actor.mapped)
        return;
    actor.set_pivot_point(0.5, 0.5);
    const steps = [-16, 14, -10, 7, -3, 0];
    const next = i => {
        if (i >= steps.length)
            return;
        actor.ease({
            rotation_angle_z: steps[i],
            duration: 90,
            mode: M.EASE_IN_OUT_SINE,
            onComplete: () => next(i + 1),
        });
    };
    next(0);
}

/** Gentle, endless float (empty-state illustration). */
export function startFloat(actor) {
    stopFloat(actor);
    if (!actor.mapped)
        return;
    actor.ease({
        translation_y: -6 * scaleFactor(),
        duration: 1800,
        mode: M.EASE_IN_OUT_SINE,
        repeatCount: -1,
        autoReverse: true,
    });
}

export function stopFloat(actor) {
    actor.remove_transition('translation-y');
    actor.translation_y = 0;
}

/** An expanding ring that fades out — a "ripple". */
export function ripple(layer, x, y, color, size = 22) {
    if (!layer.mapped)
        return;
    const s = scaleFactor();
    const d = size * s;
    const ring = new St.Widget({
        style: `border: ${2 * s}px solid ${color}; border-radius: ${d}px;`,
        width: d,
        height: d,
        x: x - d / 2,
        y: y - d / 2,
        reactive: false,
    });
    ring.set_pivot_point(0.5, 0.5);
    layer.add_child(ring);
    ring.scale_x = ring.scale_y = 0.6;
    ring.ease({
        scale_x: 2.4,
        scale_y: 2.4,
        opacity: 0,
        duration: 560,
        mode: M.EASE_OUT_CUBIC,
        onComplete: () => ring.destroy(),
    });
}

/** Confetti burst from (x, y) inside a fixed-layout layer. */
export function burst(layer, x, y, colors, {count = 12, distance = 46, size = 5, duration = 700, lift = 0} = {}) {
    if (!layer.mapped)
        return;
    const s = scaleFactor();
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.7;
        const dist = distance * s * (0.55 + Math.random() * 0.75);
        const w = Math.round(size * s * (0.7 + Math.random() * 0.7));
        const h = Math.random() > 0.5 ? w : Math.round(w * 2.2);
        const color = colors[i % colors.length];
        const round = Math.random() > 0.55 ? w : Math.round(s);

        const p = new St.Widget({
            style: `background-color: ${color}; border-radius: ${round}px;`,
            width: w,
            height: h,
            x: Math.round(x - w / 2),
            y: Math.round(y - h / 2),
            reactive: false,
        });
        p.set_pivot_point(0.5, 0.5);
        layer.add_child(p);

        const d = duration * (0.8 + Math.random() * 0.5);
        p.ease({
            translation_x: Math.cos(angle) * dist,
            translation_y: Math.sin(angle) * dist - lift * s,
            rotation_angle_z: (Math.random() - 0.5) * 540,
            duration: d,
            mode: M.EASE_OUT_EXPO,
        });
        p.ease({
            opacity: 0,
            scale_x: 0.3,
            scale_y: 0.3,
            delay: d * 0.45,
            duration: d * 0.55,
            mode: M.EASE_IN_QUAD,
            onComplete: () => p.destroy(),
        });
    }
}
