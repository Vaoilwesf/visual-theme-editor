// modules/headers.js
// «Заголовки ♡»: оформление всех заголовков SillyTavern в одном окне.
//
// Что пишется в CSS (в блок «Мои правки», одним правилом на группу):
//   .inline-drawer-header, .standoutHeader, …           — сам заголовок;
//   …:hover / …:active                                  — наведение и нажатие;
//   …::before                                           — украшение перед текстом.
//
// Лёгкость:
//  - только классы и теги, ни одного градиента, размытия и мягкой тени.
//    Рамки — обычные border / outline, они рисуются дёшево;
//  - анимация только цвета и сдвига (transform) — без пересчёта раскладки;
//  - градиент, который SillyTavern рисует у «выделенных заголовков», при
//    включённом стиле заменяется сплошным фоном;
//  - пока двигаешь ползунки, значения ставятся прямо на заголовки, в тему
//    пишется один раз — когда отпустила.

let onApply = null;
let onReadRules = null;
let onThemeRules = null;
let onReveal = null;
let onToast = null;
let picker = null;
let onSnapshot = null;   // запомнить тему на момент открытия окна
let onRestore = null;    // вернуть её обратно

let panel = null;
let els = {};
let state = null;
let icons = null;

/* Какие заголовки бывают в SillyTavern (сверено с её разметкой) */
const KINDS = [
    { id: 'drawer', label: 'Раскрывающиеся (настройки, расширения)', parts: ['.inline-drawer-header'] },
    { id: 'standout', label: 'Выделенные заголовки', parts: ['.standoutHeader'] },
    { id: 'panel', label: 'Заголовки в панелях меню', parts: ['.drawer-content h3', '.drawer-content h4'] },
    { id: 'popup', label: 'Заголовки во всплывающих окнах', parts: ['.popup h3', '.popup h4'] },
];
const KINDS_KEY = 'vte-hd-kinds';

/* Готовые стили. Это просто стартовые значения полей — дальше всё можно
   подкрутить. Ни градиентов, ни размытия, ни мягких теней */
const PRESETS = [
    { id: 'pill', name: 'Пилюля', set: { border: 'all', bStyle: 'solid', bWidth: 1, radius: 30, bgAlpha: 0.06, outline: false, pad: 'normal' } },
    { id: 'underline', name: 'Подчёркивание', set: { border: 'bottom', bStyle: 'solid', bWidth: 2, radius: 0, bgAlpha: 0, outline: false, pad: 'normal' } },
    { id: 'tab', name: 'Закладка', set: { border: 'left', bStyle: 'solid', bWidth: 4, radius: 8, bgAlpha: 0.06, outline: false, pad: 'normal' } },
    { id: 'outline', name: 'Контур', set: { border: 'all', bStyle: 'solid', bWidth: 2, radius: 14, bgAlpha: 0, outline: false, pad: 'normal' } },
    { id: 'frame', name: 'Двойная рамка', set: { border: 'all', bStyle: 'solid', bWidth: 1, radius: 10, bgAlpha: 0.04, outline: true, pad: 'roomy' } },
    { id: 'double', name: 'Двойная линия', set: { border: 'topbottom', bStyle: 'double', bWidth: 3, radius: 0, bgAlpha: 0, outline: false, pad: 'normal' } },
    { id: 'dashed', name: 'Пунктир', set: { border: 'all', bStyle: 'dashed', bWidth: 1, radius: 8, bgAlpha: 0, outline: false, pad: 'normal' } },
    { id: 'plate', name: 'Плашка', set: { border: 'none', bStyle: 'solid', bWidth: 0, radius: 8, bgAlpha: 0.16, outline: false, pad: 'normal', upper: true, spacing: 8 } },
];

const PADS = { compact: '3px 10px', normal: '6px 14px', roomy: '9px 18px' };
const DECOR_SYMBOLS = ['✦', '✧', '♡', '❀', '✿', '☾', '★', '❖', '◆', '•', '»', '⟡'];

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================ */
export function init(options = {}) {
    onApply = options.onApply || null;
    onReadRules = options.onReadRules || null;
    onThemeRules = options.onThemeRules || null;
    onReveal = options.onReveal || null;
    onToast = options.onToast || (() => {});
    picker = options.picker || null;
    onSnapshot = options.onSnapshot || null;
    onRestore = options.onRestore || null;
}

const say = (t) => onToast?.(t);

/* ============================================================
   DOM-ХЕЛПЕРЫ
============================================================ */
function h(tagSpec, attrs, children) {
    const idMatch = tagSpec.match(/#([\w-]+)/);
    const cls = (tagSpec.match(/\.[\w-]+/g) || []).map(s => s.slice(1));
    const tag = (tagSpec.match(/^[\w-]+/) || ['div'])[0];
    const el = document.createElement(tag);
    if (idMatch) el.id = idMatch[1];
    if (cls.length) el.className = cls.join(' ');
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k in el && typeof el[k] !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children || [])) {
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}

const icon = (name, style = 'fa-solid') => h('i', { className: `${style} ${name}` });

function iconBtn(faName, title, onClick, extra) {
    return h(`button.vte-icon-btn${extra ? '.' + extra : ''}`, { type: 'button', title, on: { click: onClick } }, [icon(faName)]);
}

/* ============================================================
   СЕЛЕКТОРЫ ГРУППЫ
============================================================ */
function loadKinds() {
    try {
        const v = JSON.parse(localStorage.getItem(KINDS_KEY) || 'null');
        if (Array.isArray(v) && v.length) return v.filter(id => KINDS.some(k => k.id === id));
    } catch {}
    return ['drawer', 'standout', 'panel'];
}

function saveKinds(list) {
    try { localStorage.setItem(KINDS_KEY, JSON.stringify(list)); } catch {}
}

function partsOf(kinds) {
    return KINDS.filter(k => kinds.includes(k.id)).flatMap(k => k.parts);
}

function selectors(kinds) {
    const parts = partsOf(kinds);
    return {
        parts,
        main: parts.join(', '),
        hover: parts.map(p => `${p}:hover`).join(', '),
        active: parts.map(p => `${p}:active`).join(', '),
        before: parts.map(p => `${p}::before`).join(', '),
        // у раскрывающихся заголовков стрелка справа: с украшением слева
        // заголовок выравниваем к началу, а стрелку — к правому краю
        drawerIcon: kinds.includes('drawer') ? '.inline-drawer-header .inline-drawer-icon' : '',
        drawer: kinds.includes('drawer') ? '.inline-drawer-header' : '',
    };
}

/* ============================================================
   СОСТОЯНИЕ
============================================================ */
function defaults() {
    return {
        kinds: loadKinds(),
        on: false,             // стиль включён (иначе — всё как в теме)
        preset: '',
        text: '', bg: '', accent: '', hover: '',
        bgAlpha: 0,            // для пресетов: фон — акцент с этой прозрачностью
        border: 'none', bStyle: 'solid', bWidth: 0, outline: false,
        radius: 0, pad: '',
        upper: false, spacing: 0, weight: '',
        lively: false,
        decor: 'none', decorText: '✦', decorIcon: '', decorImg: '',
        bgImg: '',
    };
}

const strip = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();
const urlOf = (v) => {
    const m = String(v || '').match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/);
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};

function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const sel = selectors(s.kinds);
    const get = (key, prop) => strip(rules.get(key)?.get(prop));
    const main = rules.get(sel.main);
    if (!main || !main.size) return s;

    s.on = true;
    s.text = get(sel.main, 'color');
    s.bg = get(sel.main, 'background-color');
    s.bgImg = urlOf(get(sel.main, 'background-image'));
    s.radius = Math.round(parseFloat(get(sel.main, 'border-radius')) || 0);
    const pad = get(sel.main, 'padding');
    s.pad = Object.keys(PADS).find(k => PADS[k] === pad) || '';
    s.upper = get(sel.main, 'text-transform') === 'uppercase';
    s.spacing = Math.round((parseFloat(get(sel.main, 'letter-spacing')) || 0) * 100);
    s.weight = get(sel.main, 'font-weight');

    // Рамка: вокруг, снизу, слева или сверху-снизу
    const parseB = (v) => v.match(/^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double)\s+(.+)$/);
    const all = parseB(get(sel.main, 'border'));
    const bottom = parseB(get(sel.main, 'border-bottom'));
    const left = parseB(get(sel.main, 'border-left'));
    const top = parseB(get(sel.main, 'border-top'));
    const b = all || (top && bottom ? bottom : null) || bottom || left;
    if (b) {
        s.bWidth = +b[1]; s.bStyle = b[2]; s.accent = b[3];
        s.border = all ? 'all' : top && bottom ? 'topbottom' : bottom ? 'bottom' : 'left';
    }
    s.outline = !!get(sel.main, 'outline');
    if (!s.accent) s.accent = get(sel.main, 'outline').replace(/^\S+\s+\S+\s+/, '');

    s.hover = get(sel.hover, 'color');
    s.lively = !!get(sel.hover, 'transform');

    const content = get(sel.before, 'content');
    const img = urlOf(get(sel.before, 'background'));
    if (img) { s.decor = 'image'; s.decorImg = img; }
    else if (/^["']\\[0-9a-f]{4,5}["']$/i.test(content) && icons) {
        const code = content.slice(2, -1).toLowerCase();
        const fa = icons.byCode.get(code);
        if (fa) { s.decor = 'icon'; s.decorIcon = fa.name; }
    } else if (/^["'].+["']$/.test(content)) {
        s.decor = 'text'; s.decorText = content.slice(1, -1);
    }
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
function hexA(color, a) {
    // Акцент с прозрачностью — для фона пресетов. Работает с #hex и rgb()
    const c = String(color || '').trim();
    let m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) {
        const n = parseInt(m[1], 16);
        return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
    if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})`;
    return '';
}

const cssUrl = (u) => `url("${String(u).replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

function buildRules(s, kindsForSel = s.kinds) {
    const sel = selectors(kindsForSel);
    const rules = {};
    const put = (key, prop, val) => { if (key) (rules[key] ||= {})[prop] = val; };
    const on = s.on;
    const accent = s.accent || '';

    put(sel.main, 'color', on ? s.text : '');
    put(sel.main, 'background-color', on ? s.bg : '');
    // Градиент ST у «выделенных заголовков» убираем; своя картинка — вместо него
    put(sel.main, 'background-image', on ? (s.bgImg ? cssUrl(s.bgImg) : 'none') : '');
    put(sel.main, 'background-size', on && s.bgImg ? 'cover' : '');
    put(sel.main, 'background-position', on && s.bgImg ? 'center' : '');

    const line = on && s.bWidth && accent ? `${s.bWidth}px ${s.bStyle} ${accent}` : '';
    put(sel.main, 'border', on ? (s.border === 'all' ? line || 'none' : 'none') : '');
    put(sel.main, 'border-bottom', on && (s.border === 'bottom' || s.border === 'topbottom') ? line : '');
    put(sel.main, 'border-top', on && s.border === 'topbottom' ? line : '');
    put(sel.main, 'border-left', on && s.border === 'left' ? line : '');
    put(sel.main, 'outline', on && s.outline && accent ? `1px solid ${accent}` : '');
    put(sel.main, 'outline-offset', on && s.outline && accent ? '3px' : '');

    put(sel.main, 'border-radius', on && s.radius ? `${s.radius}px` : '');
    put(sel.main, 'padding', on && s.pad ? PADS[s.pad] : '');
    put(sel.main, 'text-transform', on && s.upper ? 'uppercase' : '');
    put(sel.main, 'letter-spacing', on && s.spacing ? `${s.spacing / 100}em` : '');
    put(sel.main, 'font-weight', on ? s.weight : '');
    put(sel.main, 'transition', on && (s.hover || s.lively) ? 'color 0.2s, transform 0.2s' : '');

    put(sel.hover, 'color', on ? s.hover : '');
    put(sel.hover, 'transform', on && s.lively ? 'translateY(-1px)' : '');
    put(sel.active, 'transform', on && s.lively ? 'scale(0.98)' : '');

    // Украшение перед текстом
    const d = on ? s.decor : 'none';
    const fa = d === 'icon' ? icons?.byName.get(s.decorIcon) : null;
    const text = d === 'text' && s.decorText ? s.decorText.replace(/["\\]/g, '') : '';
    const img = d === 'image' && s.decorImg ? s.decorImg : '';
    const any = !!(fa || text || img);
    put(sel.before, 'content', fa ? `"\\${fa.code}"` : text ? `"${text}"` : img ? '""' : '');
    put(sel.before, 'font-family', fa ? `"${fa.brand ? 'Font Awesome 6 Brands' : 'Font Awesome 6 Free'}"` : '');
    put(sel.before, 'font-weight', fa ? (fa.brand ? '400' : '900') : '');
    put(sel.before, 'color', any && accent ? accent : '');
    put(sel.before, 'margin-right', any ? '0.5em' : '');
    put(sel.before, 'display', img ? 'inline-block' : '');
    put(sel.before, 'width', img ? '1em' : '');
    put(sel.before, 'height', img ? '1em' : '');
    put(sel.before, 'vertical-align', img ? 'middle' : '');
    put(sel.before, 'background', img ? `${cssUrl(img)} center / contain no-repeat` : '');
    put(sel.drawer, 'justify-content', any ? 'flex-start' : '');
    put(sel.drawerIcon, 'margin-left', any ? 'auto' : '');
    return rules;
}

/* ============================================================
   ПРЕДПРОСМОТР: прямо на заголовках, не чаще раза за кадр
============================================================ */
const inlineSet = new Map();
let previewRaf = 0;

function setInline(el, prop, val) {
    if (val) {
        el.style.setProperty(prop, val, 'important');
        if (!inlineSet.has(el)) inlineSet.set(el, new Set());
        inlineSet.get(el).add(prop);
    } else if (inlineSet.get(el)?.has(prop)) {
        el.style.removeProperty(prop);
        inlineSet.get(el).delete(prop);
    }
}

function applyInline() {
    previewRaf = 0;
    const sel = selectors(state.kinds);
    if (!sel.parts.length) return;
    const decls = buildRules(state)[sel.main] || {};
    let list = [];
    try { list = document.querySelectorAll(sel.main); } catch {}
    for (const el of list) {
        for (const [p, v] of Object.entries(decls)) if (p !== 'transition') setInline(el, p, v);
    }
}

function preview() {
    if (!previewRaf) previewRaf = requestAnimationFrame(applyInline);
}

function clearPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    for (const [el, props] of inlineSet) for (const p of props) el.style.removeProperty(p);
    inlineSet.clear();
}

let writtenKinds = null;   // для какого набора заголовков правила уже лежат в теме

async function commit() {
    const list = [];
    // Набор заголовков поменяли — правила для старого набора стираем
    if (writtenKinds && writtenKinds.join() !== state.kinds.join()) {
        const old = buildRules({ ...defaults(), on: false }, writtenKinds);
        for (const [selector, decls] of Object.entries(old)) list.push({ selector, decls });
    }
    for (const [selector, decls] of Object.entries(buildRules(state))) list.push({ selector, decls });
    const changed = await onApply?.(list);
    writtenKinds = state.kinds.slice();
    clearPreview();
    return changed;
}

/* ============================================================
   ОКНО
============================================================ */
async function loadIcons() {
    if (icons) return icons;
    try {
        const mod = await import('./faIcons.js');
        const list = [];
        const byName = new Map();
        const byCode = new Map();
        for (const row of mod.ICON_DATA.split(';')) {
            const [name, code, style, terms] = row.split(':');
            const it = { name, code, brand: style === 'b', terms: terms ? terms.split(',') : [] };
            list.push(it); byName.set(name, it); byCode.set(code, it);
        }
        icons = { list, byName, byCode };
    } catch {}
    return icons;
}

export async function showPanel() {
    onSnapshot?.();
    await loadIcons();
    state = readState();
    writtenKinds = state.on ? state.kinds.slice() : null;
    if (!state.accent) state.accent = themeAccent();
    if (!panel) build();
    panel.style.display = 'flex';
    render();
}

/** Перечитать настройки из темы (её правили в коде или сменили) */
export function refresh() {
    if (!isOpen()) return;
    const screen = state?.screen;
    const scroll = els.body?.scrollTop || 0;
    state = readState();
    if (screen) state.screen = screen;
    render();
    // Прокрутку не сбрасываем: иначе после каждой правки окно прыгает вверх
    if (els.body) els.body.scrollTop = scroll;
}

export function hidePanel() {
    clearPreview();
    closeIconPicker();
    if (panel) panel.style.display = 'none';
}

export function isOpen() {
    return !!panel && panel.style.display !== 'none';
}

export function togglePanel() {
    isOpen() ? hidePanel() : showPanel();
}

/** Акцент по умолчанию — цвет цитат текущей темы ST */
function themeAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--SmartThemeQuoteColor').trim();
    return v || '#c98392';
}

function build() {
    const header = h('div.vte-header', {}, [
        h('div.vte-title', {}, [
            h('span.vte-title-ic', {}, [icon('fa-heading')]),
            h('span', { text: 'Заголовки' }),
        ]),
        h('div.vte-header-btns', {}, [
            iconBtn('fa-window-minimize', 'Свернуть', () => panel.classList.toggle('vte-collapsed')),
            iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close'),
        ]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-headers-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-headers-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

/* ---------- элементы управления ---------- */
function section(title, children) {
    return h('div.vte-tb-section', {}, [h('div.vte-tb-section-title', { text: title }), ...children.filter(Boolean)]);
}

function row(label, control, hint) {
    return h('div.vte-tb-row', { title: hint || '' }, [h('span.vte-tb-label', { text: label }), control]);
}

function slider(key, min, max, unit, zeroText, fmt) {
    const out = h('span.vte-tb-val');
    const show = () => { out.textContent = state[key] ? (fmt ? fmt(state[key]) : `${state[key]}${unit}`) : zeroText; };
    const input = h('input.vte-tb-range', {
        type: 'range', min: String(min), max: String(max), step: '1', value: String(state[key] || 0),
        on: {
            input: (e) => { state[key] = +e.target.value; state.on = true; show(); preview(); },
            change: () => commit(),
        },
    });
    show();
    // ↺ — вернуть «как в теме». Видна, только когда значение изменено
    const def = (defaults()[key] ?? 0);
    const reset = iconBtn('fa-rotate-left', 'Сбросить эту настройку', () => {
        state[key] = def;
        input.value = String(def || 0);
        show();
        sync();
        commit();
    }, 'vte-tb-mini.vte-tb-reset');
    const sync = () => reset.classList.toggle('vte-tb-reset-off', ((state[key] || 0)) === def);
    input.addEventListener('input', sync);
    sync();
    return h('span.vte-tb-slider', {}, [input, out, reset]);
}

function colorBtn(key, emptyText) {
    const sw = h('span.vte-tb-swatch');
    const txt = h('span.vte-tb-swatch-txt');
    const paint = () => {
        sw.style.background = state[key] || '';
        sw.classList.toggle('vte-tb-swatch-empty', !state[key]);
        txt.textContent = state[key] ? '' : emptyText;
    };
    const btn = h('button.vte-tb-color', {
        type: 'button', title: 'Выбрать цвет',
        on: {
            click: () => {
                if (!picker) return;
                const before = state[key];
                picker.open({
                    anchor: btn,
                    value: state[key] || '#ffffff',
                    allowGradient: false,
                    onChange: (v) => { state[key] = v; state.on = true; paint(); preview(); },
                    onCommit: (v) => { state[key] = v; state.on = true; paint(); commit(); },
                    onCancel: () => { state[key] = before; paint(); clearPreview(); },
                });
            },
        },
    }, [sw, txt]);
    const reset = iconBtn('fa-rotate-left', 'Как в теме', () => { state[key] = ''; paint(); commit(); }, 'vte-tb-mini');
    paint();
    return h('span.vte-tb-colorwrap', {}, [btn, reset]);
}

function check(key, label, hint) {
    const input = h('input', {
        type: 'checkbox', checked: !!state[key],
        on: { change: (e) => { state[key] = e.target.checked; state.on = true; commit(); } },
    });
    return h('label.vte-tb-check', { title: hint || '' }, [input, h('span', { text: label })]);
}

function select(key, options, after) {
    const sel = h('select.vte-tb-select', {
        on: { change: (e) => { state[key] = e.target.value; state.on = true; commit(); after?.(); } },
    }, options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = state[key];
    return sel;
}

/* ---------- отрисовка ---------- */
let themeOpen = false;

function render() {
    const b = els.body;
    b.textContent = '';

    b.append(
        themeSection(),
        section('Какие заголовки', KINDS.map(k => {
            const input = h('input', {
                type: 'checkbox', checked: state.kinds.includes(k.id),
                on: {
                    change: (e) => {
                        state.kinds = e.target.checked
                            ? [...new Set([...state.kinds, k.id])]
                            : state.kinds.filter(x => x !== k.id);
                        saveKinds(state.kinds);
                        if (state.on && state.kinds.length) commit();
                    },
                },
            });
            return h('label.vte-tb-check', {}, [input, h('span', { text: k.label })]);
        })),
        section('Стиль', [presetGrid()]),
        section('Цвета', [
            row('Текст', colorBtn('text', 'как в теме')),
            row('Фон', colorBtn('bg', 'как в теме')),
            row('Рамка и украшение', colorBtn('accent', 'выбрать')),
            row('Текст при наведении', colorBtn('hover', 'как в теме')),
        ]),
        section('Рамка', [
            row('Где', select('border', [['all', 'вокруг'], ['bottom', 'снизу'], ['left', 'слева'], ['topbottom', 'сверху и снизу'], ['none', 'без рамки']])),
            row('Линия', select('bStyle', [['solid', 'сплошная'], ['dashed', 'пунктир'], ['dotted', 'точки'], ['double', 'двойная']])),
            row('Толщина', slider('bWidth', 0, 6, 'px', 'нет')),
            check('outline', 'Вторая рамка снаружи', 'Тонкая линия с отступом 3px вокруг основной. Рисуется дёшево, без теней'),
        ]),
        section('Форма и текст', [
            row('Скругление', slider('radius', 0, 30, 'px', 'нет')),
            row('Отступы', select('pad', [['', 'как в теме'], ['compact', 'компактно'], ['normal', 'обычно'], ['roomy', 'просторно']])),
            row('Жирность', select('weight', [['', 'как в теме'], ['400', 'обычный'], ['600', 'полужирный'], ['700', 'жирный']])),
            row('Разрядка', slider('spacing', 0, 20, '', 'нет', (v) => `${v / 100}em`)),
            check('upper', 'ЗАГЛАВНЫМИ БУКВАМИ'),
            check('lively', 'Оживлять при наведении', 'Чуть приподнимается при наведении и «нажимается» при клике. Только сдвиг — дёшево'),
        ]),
        section('Украшение перед текстом', [
            row('Что', select('decor', [['none', 'ничего'], ['text', 'символ'], ['icon', 'значок'], ['image', 'картинка по ссылке']], render)),
            decorControl(),
        ]),
        section('Картинка фона', [bgImageControl()]),
        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', { type: 'button', on: { click: resetAll } },
                [icon('fa-rotate-left'), h('span', { text: ' Вернуть заголовки темы' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Вернуть тему к виду, какой был при открытии этого окна — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    );
}

function presetGrid() {
    const grid = h('div.vte-hd-presets');
    for (const p of PRESETS) {
        // Образец рисуется теми же свойствами, что пойдут в тему
        const accent = state.accent || themeAccent();
        const sample = h('span.vte-hd-sample', { text: 'Заголовок' });
        const st = p.set;
        const line = st.bWidth ? `${st.bWidth}px ${st.bStyle} ${accent}` : 'none';
        sample.style.cssText = [
            `color:${state.text || 'inherit'}`,
            `background-color:${st.bgAlpha ? hexA(accent, st.bgAlpha) : 'transparent'}`,
            `border:${st.border === 'all' ? line : 'none'}`,
            st.border === 'bottom' || st.border === 'topbottom' ? `border-bottom:${line}` : '',
            st.border === 'topbottom' ? `border-top:${line}` : '',
            st.border === 'left' ? `border-left:${line}` : '',
            st.outline ? `outline:1px solid ${accent};outline-offset:2px` : '',
            `border-radius:${st.radius}px`,
            st.upper ? 'text-transform:uppercase' : '',
            st.spacing ? `letter-spacing:${st.spacing / 100}em` : '',
        ].filter(Boolean).join(';');
        grid.appendChild(h(`button.vte-hd-preset${state.preset === p.id ? '.active' : ''}`, {
            type: 'button', title: p.name,
            on: { click: () => applyPreset(p) },
        }, [sample, h('span.vte-hd-preset-name', { text: p.name })]));
    }
    return grid;
}

function applyPreset(p) {
    const st = p.set;
    state.on = true;
    state.preset = p.id;
    if (!state.accent) state.accent = themeAccent();
    Object.assign(state, {
        border: st.border, bStyle: st.bStyle, bWidth: st.bWidth, radius: st.radius,
        outline: !!st.outline, pad: st.pad || state.pad, upper: !!st.upper, spacing: st.spacing || 0,
        bg: st.bgAlpha ? hexA(state.accent, st.bgAlpha) : '',
    });
    commit();
    render();
}

function decorControl() {
    if (state.decor === 'text') {
        const wrap = h('div.vte-hd-symbols');
        for (const ch of DECOR_SYMBOLS) {
            wrap.appendChild(h(`button.vte-hd-symbol${state.decorText === ch ? '.active' : ''}`, {
                type: 'button', text: ch,
                on: { click: () => { state.decorText = ch; state.on = true; commit(); render(); } },
            }));
        }
        const input = h('input.vte-input.vte-hd-symbol-input', {
            type: 'text', maxLength: 4, value: state.decorText, title: 'Любой свой символ или эмодзи',
            on: { change: (e) => { state.decorText = e.target.value.trim(); state.on = true; commit(); } },
        });
        wrap.appendChild(input);
        return wrap;
    }
    if (state.decor === 'icon') {
        const fa = icons?.byName.get(state.decorIcon);
        return h('div.vte-tb-row', {}, [
            h('span.vte-tb-icon-prev', {}, [fa ? icon(`fa-${fa.name}`, fa.brand ? 'fa-brands' : 'fa-solid') : h('span', { text: '—' })]),
            h('button.vte-btn.vte-tb-icon-btn', {
                type: 'button', on: { click: (e) => openIconPicker(e.currentTarget) },
            }, [h('span', { text: fa ? 'Сменить значок' : 'Выбрать значок' })]),
        ]);
    }
    if (state.decor === 'image') {
        const input = h('input.vte-input.vte-tb-url', {
            type: 'text', spellcheck: false, placeholder: 'https://… ссылка на .svg / .png',
            value: state.decorImg,
            on: {
                change: (e) => {
                    const v = e.target.value.trim();
                    if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v)) { say('Нужна ссылка http(s):// на картинку'); return; }
                    state.decorImg = v; state.on = true; commit();
                },
            },
        });
        return h('div.vte-tb-row', {}, [input]);
    }
    return null;
}

function bgImageControl() {
    const input = h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder: 'https://… ссылка на картинку (необязательно)',
        value: state.bgImg,
        on: {
            change: (e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v)) { say('Нужна ссылка http(s):// на картинку'); return; }
                state.bgImg = v; state.on = true; commit();
            },
        },
    });
    return h('div.vte-tb-row', {}, [input]);
}

/** «Уже в теме» — правила темы для заголовков, клик показывает в коде */
function themeSection() {
    const list = onThemeRules?.(partsOf(state.kinds)) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'правило' : 'правил'} для заголовков` })]));
    if (themeOpen) {
        for (const r of list) {
            box.appendChild(h('button.vte-tb-rule', {
                type: 'button', title: 'Показать в коде',
                on: { click: () => onReveal?.(r.from, r.to) },
            }, [h('code.vte-tb-rule-sel', { text: r.selector }), h('span.vte-tb-rule-props', { text: r.props })]));
        }
    }
    return box;
}

/* ---------- выбор значка для украшения ---------- */
let pop = null;

function openIconPicker() {
    closeIconPicker();
    if (!icons) { say('Список значков не загрузился'); return; }
    let found = [];
    let shown = 0;
    const grid = h('div.vte-tb-grid');
    const more = () => {
        for (const ic of found.slice(shown, shown + 240)) {
            grid.appendChild(h('button.vte-tb-glyph', {
                type: 'button', title: ic.name,
                on: { click: () => { state.decorIcon = ic.name; state.on = true; closeIconPicker(); commit(); render(); } },
            }, [icon(`fa-${ic.name}`, ic.brand ? 'fa-brands' : 'fa-solid')]));
        }
        shown = Math.min(found.length, shown + 240);
    };
    const run = (q) => {
        q = String(q || '').trim().toLowerCase();
        found = icons.list.filter(it => !q || it.name.includes(q) || it.terms.some(t => t.startsWith(q)));
        grid.textContent = '';
        shown = 0;
        more();
    };
    grid.addEventListener('scroll', () => {
        if (shown < found.length && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 80) more();
    });
    const search = h('input.vte-input.vte-tb-search', {
        type: 'text', placeholder: 'Поиск по-английски: star, heart, moon…',
        on: { input: (e) => run(e.target.value) },
    });
    pop = h('div.vte-tb-pop', {}, [
        h('div.vte-tb-pop-head', {}, [h('span', { text: 'Значок перед заголовком' }),
            iconBtn('fa-xmark', 'Закрыть', closeIconPicker, 'vte-tb-mini')]),
        h('div.vte-tb-pop-tools', {}, [search]),
        grid,
    ]);
    panel.appendChild(pop);
    run('');
    setTimeout(() => search.focus(), 0);
}

function closeIconPicker() {
    pop?.remove();
    pop = null;
}

function resetAll() {
    const kinds = state.kinds;
    state = { ...defaults(), kinds, accent: themeAccent() };
    commit();
    render();
    say('Заголовки снова как в теме');
}

/* ============================================================
   ПЕРЕТАСКИВАНИЕ
============================================================ */
/* ---------- размер окна ----------
   Окна инструментов можно тянуть за уголок, размер запоминается.
   Раньше они были узкими и во весь экран по высоте. */
function makeResizable(box, key) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } })();
    if (saved?.w) box.style.width = `${saved.w}px`;
    if (saved?.h) box.style.height = `${saved.h}px`;

    const grip = h('div.vte-resize-grip', { title: 'Потянуть за уголок — изменить размер' });
    box.appendChild(grip);
    let sw = 0, sh = 0, sx = 0, sy = 0, on = false;
    grip.addEventListener('pointerdown', (e) => {
        on = true;
        const r = box.getBoundingClientRect();
        sw = r.width; sh = r.height; sx = e.clientX; sy = e.clientY;
        grip.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
        if (!on) return;
        box.style.width = `${Math.max(300, sw + e.clientX - sx)}px`;
        box.style.height = `${Math.max(220, sh + e.clientY - sy)}px`;
        box.style.maxHeight = 'none';
    });
    const stop = () => {
        if (!on) return;
        on = false;
        const r = box.getBoundingClientRect();
        try { localStorage.setItem(key, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })); } catch {}
    };
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
}

function makeDraggable(box, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        on = true;
        const r = box.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
        if (!on) return;
        box.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx))}px`;
        box.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy))}px`;
    });
    const stop = () => { on = false; };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
}
