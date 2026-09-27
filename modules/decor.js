// modules/decor.js
// «Декор ♡»: картинки и значки поверх таверны — несколько штук, их можно
// двигать, растягивать и вращать прямо на странице. Здесь же «декор по
// бокам чата» (раньше был в «Пузырях»).
//
// Как это лежит в теме (только CSS, без скриптов — тема работает и без
// расширения):
//   #movingDivs::before/::after, html::before/::after, body::before/::after —
//     шесть свободных слоёв, по картинке в каждом. Ни ST, ни другие окна их
//     не используют. position: fixed, положение — в % экрана, размер —
//     clamp(телефон → ПК): на любом экране картинка на своём месте и не
//     уезжает за край;
//   #top-settings-holder::before/::after — декор по бокам чата (держится
//     за края чата, размеры в vw) — как раньше.
//
// Лёгкость: каждая картинка — один неподвижный слой. pointer-events: none —
// она не мешает нажимать на то, что под ней. Перерисовки при прокрутке нет:
// слой fixed и не зависит от чата. Рамки с ручками на странице — только
// пока окно открыто, в тему не пишутся.

import { ruleRows } from './ruleList.js';

let onApply = null;
let onReadRules = null;
let onReveal = null;
let onDeleteRule = null;
let onCleanOverridden = null;
let onRulesMatching = null;
let onToast = null;
let picker = null;
let onSnapshot = null;
let onRestore = null;

let panel = null;
let els = {};
let state = null;

const VW_MIN = 360;
const VW_MAX = 1280;

export function init(options = {}) {
    onApply = options.onApply || null;
    onReadRules = options.onReadRules || null;
    onReveal = options.onReveal || null;
    onDeleteRule = options.onDeleteRule || null;
    onCleanOverridden = options.onCleanOverridden || null;
    onRulesMatching = options.onRulesMatching || null;
    onToast = options.onToast || (() => {});
    picker = options.picker || null;
    onSnapshot = options.onSnapshot || null;
    onRestore = options.onRestore || null;
}

const say = (t) => onToast?.(t);

/* ============================================================
   СЛОИ
============================================================ */
/* Сначала те, что темы почти никогда не занимают */
const HOSTS = ['#movingDivs::before', '#movingDivs::after', 'html::before', 'html::after', 'body::before', 'body::after'];

/* Поверх всего — но под окнами самого расширения */
const Z_FRONT = '2147483000';
/* «На обоях»: над фоном таверны, под чатом (#sheld — z-index 30) */
const Z_BACK = '1';

const BLENDS = [
    ['', 'обычное'], ['multiply', 'умножение'], ['screen', 'экран (светлее)'], ['overlay', 'перекрытие'],
    ['soft-light', 'мягкий свет'], ['lighten', 'замена светлым'], ['darken', 'замена тёмным'],
    ['color-dodge', 'осветление'], ['difference', 'разница'],
];

/* Декор по бокам чата (перенесён из «Пузырей») */
const DECOR = { L: '#top-settings-holder::before', R: '#top-settings-holder::after' };
const DECOR_START = {
    L: { w: 13, h: 33, x: -12, y: 15 },
    R: { w: 78, h: 27, x: 44, y: 35 },
};

/* ============================================================
   СОСТОЯНИЕ
============================================================ */
function itemDefaults() {
    return { host: '', src: '', ratio: 1, x: 50, y: 50, wMin: 80, wMax: 140, rot: 0, flip: false, op: 100, blend: '', layer: 'front' };
}
const ITEM_KEYS = new Set(Object.keys(itemDefaults()));

function decorDefaults(side) {
    const st = DECOR_START[side];
    return {
        [`d${side}img`]: '', [`d${side}w`]: st.w, [`d${side}h`]: st.h, [`d${side}x`]: st.x, [`d${side}y`]: st.y,
        [`d${side}op`]: 100, [`d${side}flip`]: false, [`d${side}front`]: false,
    };
}

function defaults() {
    return {
        on: false,
        items: [],
        ...decorDefaults('L'), ...decorDefaults('R'),
    };
}

let selHost = '';          // выбранная картинка (по слою)
const cur = () => state.items.find(it => it.host === selHost) || null;

/* Помощники ждут этих имён: «роль» здесь — выбранная картинка */
const GROUP_OF = Object.fromEntries([...ITEM_KEYS].map(k => [k, true]));
const roleDefaults = () => itemDefaults();
const val = (key) => (ITEM_KEYS.has(key) ? cur()?.[key] : state[key]);
function setVal(key, v) {
    if (ITEM_KEYS.has(key)) { const it = cur(); if (it) it[key] = v; }
    else state[key] = v;
    state.on = true;
}

const strip0 = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();
const urlIn = (v) => { const m = String(v).match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/); return m ? (m[1] ?? m[2] ?? m[3]) : ''; };
const urlOut = (u) => `url("${String(u).replace(/["\\\n\r]/g, encodeURIComponent)}")`;

/* ============================================================
   ЧТЕНИЕ
============================================================ */
function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip0(rules.get(sel)?.get(prop));

    for (const host of HOSTS) {
        const src = urlIn(get(host, 'background-image'));
        if (!src || get(host, 'position') !== 'fixed') continue;
        const it = itemDefaults();
        it.host = host;
        it.src = src;
        const ar = get(host, 'aspect-ratio').match(/^([\d.]+)\s*(?:\/\s*([\d.]+))?$/);
        if (ar) it.ratio = ar[2] ? +ar[1] / +ar[2] : +ar[1];
        it.x = parseFloat(get(host, 'left')) || 0;
        it.y = parseFloat(get(host, 'top')) || 0;
        const w = readFluid(get(host, 'width')); it.wMin = w.min; it.wMax = w.max;
        const tr = get(host, 'transform');
        const rm = tr.match(/rotate\((-?[\d.]+)deg\)/);
        it.rot = rm ? Math.round(+rm[1]) : 0;
        it.flip = /scaleX\(-1\)/.test(tr);
        const op = get(host, 'opacity');
        it.op = op ? Math.round(parseFloat(op) * 100) : 100;
        it.blend = get(host, 'mix-blend-mode');
        it.layer = get(host, 'z-index') === Z_BACK ? 'back' : 'front';
        s.items.push(it);
    }

    for (const side of ['L', 'R']) {
        const sel = DECOR[side];
        const img = urlIn(get(sel, 'background-image'));
        if (!img) continue;
        s[`d${side}img`] = img;
        const vw = (v) => { const m = String(v).match(/(-?\d+(?:\.\d+)?)vw/); return m ? +m[1] : 0; };
        s[`d${side}w`] = vw(get(sel, 'width'));
        s[`d${side}h`] = vw(get(sel, 'height'));
        const t = get(sel, 'transform').match(/translate\(\s*(-?\d+(?:\.\d+)?)vw\s*,\s*calc\(-50%\s*\+\s*(-?\d+(?:\.\d+)?)vw\)\s*\)/);
        if (t) { s[`d${side}x`] = +t[1]; s[`d${side}y`] = +t[2]; }
        s[`d${side}flip`] = /scaleX\(-1\)/.test(get(sel, 'transform'));
        s[`d${side}op`] = Math.round((parseFloat(get(sel, 'opacity')) || 1) * 100);
        s[`d${side}front`] = get(sel, 'z-index') === '5';
    }

    s.on = [...HOSTS, DECOR.L, DECOR.R].some(k => rules.get(k)?.size);
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
function itemTransform(it) {
    return `translate(-50%, -50%)${it.rot ? ` rotate(${it.rot}deg)` : ''}${it.flip ? ' scaleX(-1)' : ''}`;
}

function buildRules(s) {
    const rules = {};
    const put = (sel, prop, v) => { (rules[sel] ||= {})[prop] = v; };
    const on = s.on;

    /* ---------- картинки поверх таверны ---------- */
    for (const host of HOSTS) {
        const it = on ? s.items.find(x => x.host === host && x.src) : null;
        put(host, 'content', it ? '""' : '');
        put(host, 'position', it ? 'fixed' : '');
        // Положение — в долях экрана (vw / dvh), а не в %: на телефоне ST
        // делает <body> fixed, у <html> высота 0, и «top: 40%» становилось 0.
        // dvh — видимая высота: картинка не уходит под панель браузера
        put(host, 'left', it ? `${r2(it.x)}vw` : '');
        put(host, 'top', it ? `${r2(it.y)}dvh` : '');
        put(host, 'width', it ? fluid(it.wMin, it.wMax) : '');
        put(host, 'height', it ? 'auto' : '');
        put(host, 'aspect-ratio', it ? String(r4(it.ratio || 1)) : '');
        put(host, 'background-image', it ? urlOut(it.src) : '');
        put(host, 'background-size', it ? 'contain' : '');
        put(host, 'background-position', it ? 'center' : '');
        put(host, 'background-repeat', it ? 'no-repeat' : '');
        put(host, 'transform', it ? itemTransform(it) : '');
        put(host, 'opacity', it && it.op < 100 ? String(r2(it.op / 100)) : '');
        put(host, 'mix-blend-mode', it ? it.blend : '');
        put(host, 'z-index', it ? (it.layer === 'back' ? Z_BACK : Z_FRONT) : '');
        put(host, 'pointer-events', it ? 'none' : '');
    }

    /* ---------- декор по бокам чата ---------- */
    for (const side of ['L', 'R']) {
        const sel = DECOR[side];
        const img = on ? s[`d${side}img`] : '';
        const n = (k) => r2(+s[`d${side}${k}`] || 0);
        put(sel, 'content', img ? '""' : '');
        put(sel, 'position', img ? 'absolute' : '');
        put(sel, 'top', img ? '50%' : '');
        put(sel, side === 'L' ? 'left' : 'right', img ? '0' : '');
        put(sel, 'width', img ? `${n('w')}vw` : '');
        put(sel, 'height', img ? `${n('h')}vw` : '');
        put(sel, 'background-image', img ? urlOut(img) : '');
        put(sel, 'background-size', img ? 'contain' : '');
        put(sel, 'background-position', img ? 'center' : '');
        put(sel, 'background-repeat', img ? 'no-repeat' : '');
        put(sel, 'transform', img ? `translate(${n('x')}vw, calc(-50% + ${n('y')}vw))${s[`d${side}flip`] ? ' scaleX(-1)' : ''}` : '');
        put(sel, 'opacity', img && s[`d${side}op`] < 100 ? String(r2(s[`d${side}op`] / 100)) : '');
        // Под открытыми панелями (но над чатом) или поверх всего
        put(sel, 'z-index', img ? (s[`d${side}front`] ? '5' : '-1') : '');
        put(sel, 'pointer-events', img ? 'none' : '');
    }
    return rules;
}

const r4 = (n) => Math.round(n * 10000) / 10000;

/* ============================================================
   ПРЕДПРОСМОТР И ЗАПИСЬ
============================================================ */
let previewStyle = null;
let previewRaf = 0;

function paintPreview() {
    previewRaf = 0;
    let css = '';
    for (const [sel, decls] of Object.entries(buildRules(state))) {
        const body = Object.entries(decls).filter(([, v]) => v).map(([p, v]) => `${p}:${v} !important`).join(';');
        if (body) css += `${sel}{${body}}\n`;
    }
    if (!previewStyle) {
        previewStyle = document.createElement('style');
        previewStyle.id = 'vte-decor-preview';
        document.head.appendChild(previewStyle);
    }
    if (previewStyle.textContent !== css) previewStyle.textContent = css;
    drawFrames();
}

function preview() {
    if (!previewRaf) previewRaf = requestAnimationFrame(paintPreview);
}

function clearPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    previewStyle?.remove();
    previewStyle = null;
}

async function commit() {
    const list = Object.entries(buildRules(state)).map(([selector, decls]) => ({ selector, decls }));
    const changed = await onApply?.(list);
    clearPreview();
    drawFrames();
    return changed;
}

/* ============================================================
   РАМКИ НА СТРАНИЦЕ: двигать, растягивать, вращать
============================================================ */
let frames = null;
let dragging = null;

/** Ширина картинки сейчас, в px — та же формула clamp, что в теме */
function widthPx(it) {
    const lo = Math.min(it.wMin || it.wMax, it.wMax || it.wMin);
    const hi = Math.max(it.wMin || it.wMax, it.wMax || it.wMin);
    if (lo === hi) return lo;
    const slope = (hi - lo) / (VW_MAX - VW_MIN);
    return Math.max(lo, Math.min(hi, lo - slope * VW_MIN + slope * window.innerWidth));
}

/** Где картинка на экране: доли видимой области */
function geom(it) {
    const r = document.documentElement.getBoundingClientRect();
    const box = { left: r.left, top: r.top, width: window.innerWidth, height: window.visualViewport?.height || window.innerHeight };
    const w = widthPx(it);
    return { cx: box.left + box.width * it.x / 100, cy: box.top + box.height * it.y / 100, w, h: w / (it.ratio || 1), box };
}

function drawFrames() {
    if (!isOpen() || !state) { frames?.remove(); frames = null; return; }
    if (!frames) {
        frames = h('div#vte-decor-frames');
        document.body.appendChild(frames);
    }
    frames.textContent = '';
    for (const it of state.items) {
        if (!it.src) continue;
        const g = geom(it);
        const selected = it.host === selHost;
        const f = h(`div.vte-dc-frame${selected ? '.active' : ''}`, {
            style: `left:${g.cx - g.w / 2}px;top:${g.cy - g.h / 2}px;width:${g.w}px;height:${g.h}px;transform:rotate(${it.rot}deg)`,
            title: 'Тянуть — двигать. Уголок — размер. Кружок сверху — поворот',
        });
        f.addEventListener('pointerdown', (e) => startDrag(e, it, 'move'));
        if (selected) {
            const sc = h('div.vte-dc-h.vte-dc-h-scale', { title: 'Размер' });
            sc.addEventListener('pointerdown', (e) => startDrag(e, it, 'scale'));
            const ro = h('div.vte-dc-h.vte-dc-h-rot', { title: 'Поворот (с Shift — шагами по 15°)' });
            ro.addEventListener('pointerdown', (e) => startDrag(e, it, 'rot'));
            f.append(sc, ro);
        }
        frames.appendChild(f);
    }
}

function startDrag(e, it, mode) {
    e.preventDefault();
    e.stopPropagation();
    if (selHost !== it.host) { selHost = it.host; render(); }
    const g = geom(it);
    dragging = {
        it, mode, x0: e.clientX, y0: e.clientY, ix: it.x, iy: it.y, wMin: it.wMin, wMax: it.wMax,
        g, d0: Math.hypot(e.clientX - g.cx, e.clientY - g.cy) || 1, moved: false,
    };
    window.addEventListener('pointermove', onDrag, true);
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
}

function onDrag(e) {
    const d = dragging;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    d.moved = true;
    const { it, g } = d;
    if (d.mode === 'move') {
        // Не дальше края экрана: картинка не должна потеряться на телефоне
        it.x = clampN(d.ix + (e.clientX - d.x0) / g.box.width * 100, 0, 100);
        it.y = clampN(d.iy + (e.clientY - d.y0) / g.box.height * 100, 0, 100);
    } else if (d.mode === 'scale') {
        const k = Math.hypot(e.clientX - g.cx, e.clientY - g.cy) / d.d0;
        it.wMin = Math.round(clampN(d.wMin * k, 8, 2000));
        it.wMax = Math.round(clampN(d.wMax * k, 8, 2000));
    } else {
        let a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180 / Math.PI + 90;
        if (a > 180) a -= 360;
        a = Math.round(a);
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        else if (Math.abs(a) < 4) a = 0;           // прилипает к «прямо»
        it.rot = a;
    }
    state.on = true;
    preview();
}

function endDrag(e) {
    window.removeEventListener('pointermove', onDrag, true);
    window.removeEventListener('pointerup', endDrag, true);
    window.removeEventListener('pointercancel', endDrag, true);
    const d = dragging;
    dragging = null;
    e?.stopPropagation?.();
    if (d?.moved) { commit(); render(); }
}

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/* ============================================================
   ОКНО
============================================================ */
export async function showPanel() {
    onSnapshot?.();
    state = readState();
    if (!state.items.some(it => it.host === selHost)) selHost = state.items[0]?.host || '';
    if (!panel) build();
    panel.style.display = 'flex';
    render();
    drawFrames();
}

export function refresh() {
    if (!isOpen() || dragging) return;
    state = readState();
    if (!state.items.some(it => it.host === selHost)) selHost = state.items[0]?.host || '';
    render();
    drawFrames();
}

export function hidePanel() {
    clearPreview();
    closeGlyphPicker();
    if (panel) panel.style.display = 'none';
    drawFrames();
}

export function isOpen() {
    return !!panel && panel.style.display !== 'none';
}

export function togglePanel() {
    isOpen() ? hidePanel() : showPanel();
}

function build() {
    const header = h('div.vte-header', {}, [
        h('div.vte-title', {}, [h('span.vte-title-ic', {}, [icon('fa-shapes')]), h('span', { text: 'Декор' })]),
        h('div.vte-header-btns', {}, [iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close')]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-decor-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-decor-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
    window.addEventListener('resize', () => { if (isOpen()) drawFrames(); });
}

const open = { items: true, side: false };

function render() {
    if (!els.body) return;
    const scroll = els.body.scrollTop;
    els.body.textContent = '';
    els.body.append(...screen().filter(Boolean));
    els.body.scrollTop = scroll;
}

function thumb(src) {
    return h('i.vte-bb-glyph-now', { style: `background:${urlOut(src)} center/contain no-repeat` });
}

function itemRows() {
    return state.items.map((it, i) => h(`div.vte-dc-item${it.host === selHost ? '.active' : ''}`, {
        on: { click: () => { selHost = it.host; render(); drawFrames(); } },
    }, [
        thumb(it.src),
        h('span.vte-bb-glyph-label', { text: `Картинка ${i + 1}` }),
        iconBtn('fa-clone', 'Копия рядом', (e) => { e.stopPropagation(); duplicate(it); }, 'vte-tb-mini'),
        iconBtn('fa-trash-can', 'Убрать', (e) => { e.stopPropagation(); removeItem(it); }, 'vte-tb-mini'),
    ]));
}

function freeHost() {
    return HOSTS.find(hh => !state.items.some(it => it.host === hh)) || '';
}

function duplicate(it) {
    const host = freeHost();
    if (!host) { say(`Больше ${HOSTS.length} картинок нельзя: для каждой нужен свой слой`); return; }
    state.items.push({ ...it, host, x: clampN(it.x + 5, 0, 100), y: clampN(it.y + 5, 0, 100) });
    selHost = host;
    state.on = true;
    commit();
    render();
}

function removeItem(it) {
    state.items = state.items.filter(x => x !== it);
    if (selHost === it.host) selHost = state.items[0]?.host || '';
    state.on = true;
    commit();
    render();
}

function screen() {
    const it = cur();
    return [
        themeSection(),
        group('items', 'Картинки поверх таверны', [
            h('small.vte-note', {
                text: 'Картинки и значки поверх всей таверны: на ПК и на телефоне. Нажимать на то, что под ними, они не мешают. '
                    + `Можно до ${HOSTS.length} штук.`,
            }),
            ...itemRows(),
            h('button.vte-btn.vte-dc-add', {
                type: 'button', disabled: !freeHost(),
                on: { click: () => openGlyphPicker(null) },
            }, [icon('fa-plus'), h('span', { text: ' Добавить картинку' })]),
            it ? h('small.vte-note', {
                text: 'Пока окно открыто, картинку можно тянуть прямо на странице: за середину — двигать, '
                    + 'уголок — размер, кружок сверху — поворот (с Shift — шагами по 15°).',
            }) : null,
            it ? h('div.vte-bb-shared', { text: `Картинка ${state.items.indexOf(it) + 1}` }) : null,
            it ? h('div.vte-pn-actions', {}, [
                h('button.vte-btn', { type: 'button', on: { click: () => openGlyphPicker(it) } }, [icon('fa-image'), h('span', { text: ' Сменить картинку' })]),
            ]) : null,
            it ? row('Где лежит', select('layer', [['front', 'поверх всего'], ['back', 'на обоях, под чатом']])) : null,
            it ? pair('Размер', 'wMin', 'wMax', 1200, 'Ширина картинки: первое — на телефоне, второе — на ПК', 8, '—') : null,
            it ? row('По горизонтали', slider('x', 0, 100, '%', 'у левого края', 'Доля ширины экрана', 0.5)) : null,
            it ? row('По вертикали', slider('y', 0, 100, '%', 'у верхнего края', 'Доля высоты экрана', 0.5)) : null,
            it ? row('Поворот', slider('rot', -180, 180, '°', 'нет')) : null,
            it ? check('flip', 'Отразить по горизонтали') : null,
            it ? row('Непрозрачность', slider('op', 5, 100, '%', '—')) : null,
            it ? row('Наложение', select('blend', BLENDS), 'Как картинка смешивается с тем, что под ней') : null,
        ]),

        group('side', 'Декор по бокам чата', [
            h('small.vte-note', {
                text: 'Картинки держатся за левый и правый край чата. Меняешь ширину чата в таверне — едут вместе с ним; '
                    + 'при масштабе браузера (Ctrl +/−) не меняются. Раньше это было в окне «Пузыри».',
            }),
            ...decorSide('L', 'Слева'),
            ...decorSide('R', 'Справа'),
        ]),

        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', {
                type: 'button', title: 'Убрать всё, что это окно записало в тему. Останется оформление самой темы — не SillyTavern по умолчанию',
                on: { click: resetAll },
            }, [icon('fa-rotate-left'), h('span', { text: ' Сбросить все настройки окна' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Отменить всё, что сделано с момента открытия этого окна, — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
        h('small.vte-note.vte-foot-note', { text: '«Как было до открытия» — отменить всё, что сделано с момента открытия окна. «Сбросить все настройки окна» — убрать всё, что это окно когда-либо записало в тему: останется оформление самой темы.' }),
    ];
}

/* ---------- что про декор уже есть в коде ---------- */
let themeOpen = false;
const DECOR_TEST = (sel) => /^(html|body|#movingDivs|#top-settings-holder)::(before|after)$/.test(sel);

function themeSection() {
    const list = onRulesMatching?.(DECOR_TEST) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже есть про декор: ${list.length}` })]));
    if (themeOpen) box.append(...ruleRows(list, { h, icon, onReveal, onDeleteRule, onCleanOverridden, say }));
    return box;
}

/* ---------- декор по бокам чата ---------- */
function decorUrl(key) {
    return h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder: 'https://… ссылка на картинку', value: val(key) || '',
        on: {
            change: (e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v) && !/^data:image\//i.test(v)) {
                    say('Нужна ссылка http(s)://');
                    e.target.value = val(key) || '';
                    return;
                }
                setVal(key, v);
                commit();
                render();
            },
        },
    });
}

function decorSide(side, title) {
    const k = (x) => `d${side}${x}`;
    const on = !!val(k('img'));
    return [
        h('div.vte-bb-shared', { text: title }),
        row('Картинка', decorUrl(k('img')), 'Ссылкой. Как фон — работает с любого сайта'),
        on ? row('Ширина', slider(k('w'), 1, 150, 'vw', '—', 'Доля ширины окна браузера: не меняется при масштабе', 0.5)) : null,
        on ? row('Высота', slider(k('h'), 1, 150, 'vw', '—', '', 0.5)) : null,
        on ? row('Вбок', slider(k('x'), -80, 80, 'vw', 'у края', side === 'L' ? 'Минус — наружу, за левый край чата' : 'Плюс — наружу, за правый край чата', 0.5)) : null,
        on ? row('Вверх-вниз', slider(k('y'), -40, 120, 'vw', 'посередине полосы', 'От середины полосы со значками. Плюс — ниже', 0.5)) : null,
        on ? row('Непрозрачность', slider(k('op'), 5, 100, '%', '100%')) : null,
        on ? check(k('flip'), 'Отразить по горизонтали') : null,
        on ? check(k('front'), 'Поверх открытых панелей',
            'Обычно декор лежит над чатом, но под открытыми панелями ST — чтобы их не загораживать') : null,
    ];
}

function resetAll() {
    state = { ...defaults() };
    selHost = '';
    commit();
    render();
    say('Декор убран — осталось оформление темы');
}

/* ============================================================
   ВЫБОР КАРТИНКИ: Font Awesome, ссылка или код SVG
============================================================ */
/* Значок Font Awesome — картинкой PNG: шрифт картинке недоступен.
   Декор бывает крупным, поэтому рисуем покрупнее, чем значок ползунка */
const GLYPH_PX = 192;

/** Пропорции картинки: ширина / высота (не загрузилась — квадрат) */
function measure(src) {
    return new Promise((resolve) => {
        const img = new Image();
        const done = (r) => { clearTimeout(t); resolve(r); };
        const t = setTimeout(() => done(1), 4000);
        img.onload = () => done(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
        img.onerror = () => done(1);
        img.src = src;
    });
}

function svgRatio(svgText) {
    const vb = String(svgText).match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (vb && +vb[2]) return +vb[1] / +vb[2];
    const w = String(svgText).match(/\swidth\s*=\s*["']([\d.]+)/i), hh = String(svgText).match(/\sheight\s*=\s*["']([\d.]+)/i);
    return w && hh && +hh[1] ? +w[1] / +hh[1] : 0;
}

let glyphPop = null;

function closeGlyphPicker() {
    glyphPop?.remove();
    glyphPop = null;
}

let glyphColor = '';

async function setSource(target, src, ratio, text) {
    if (target) {
        target.src = src;
        target.ratio = ratio || target.ratio;
        selHost = target.host;
    } else {
        const host = freeHost();
        if (!host) { say(`Больше ${HOSTS.length} картинок нельзя`); return; }
        const it = itemDefaults();
        it.host = host;
        it.src = src;
        it.ratio = ratio || 1;
        // Новая картинка — по центру экрана и не одна поверх другой
        const n = state.items.length;
        it.x = clampN(50 + (n % 3) * 8 - 8, 5, 95);
        it.y = clampN(40 + n * 6, 5, 95);
        state.items.push(it);
        selHost = host;
    }
    state.on = true;
    closeGlyphPicker();
    await commit();
    render();
    say(text);
}

async function openGlyphPicker(target) {
    closeGlyphPicker();
    let tb;
    try { tb = await import('./topBar.js'); await tb.loadIcons(); } catch { say('Список значков не загрузился'); return; }
    const icons = await tb.loadIcons();
    let query = '', cat = -1, shown = 0, found = [];

    const colorIn = h('input.vte-dc-color', { type: 'color', value: glyphColor || '#f4a6c6', title: 'Цвет значка' });
    colorIn.addEventListener('input', () => { glyphColor = colorIn.value; });

    const setFa = async (g, name) => {
        if (!(await loadGlyphFont(g))) { say('Шрифт значков ещё не загрузился — попробуйте ещё раз'); return; }
        glyphColor = colorIn.value;
        const png = glyphPng(g, glyphColor);
        if (!png) { say('Этот значок нарисовать не вышло'); return; }
        setSource(target, png, 1, `Декор: ${name}`);
    };

    const grid = h('div.vte-tb-grid');
    const count = h('span.vte-tb-count');
    const more = () => {
        const next = found.slice(shown, shown + 240);
        for (const ic of next) {
            grid.appendChild(h('button.vte-tb-glyph', {
                type: 'button', title: ic.name,
                on: { click: () => setFa({ code: ic.code, brand: ic.brand }, ic.name) },
            }, [icon(`fa-${ic.name}`, ic.brand ? 'fa-brands' : 'fa-solid')]));
        }
        shown += next.length;
    };
    const run = () => {
        found = tb.searchIcons(query, cat);
        grid.textContent = '';
        shown = 0;
        count.textContent = `${found.length}`;
        more();
        grid.scrollTop = 0;
    };
    grid.addEventListener('scroll', () => {
        if (shown < found.length && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 80) more();
    });
    const search = h('input.vte-input.vte-tb-search', {
        type: 'text', placeholder: 'Поиск: сердце, star, moon…', spellcheck: false,
        on: { input: (e) => { query = e.target.value; run(); } },
    });
    const cats = h('select.vte-tb-select', { on: { change: (e) => { cat = +e.target.value; run(); } } },
        [h('option', { value: '-1', text: 'Все разделы' }), ...icons.cats.map((c, i) => h('option', { value: String(i), text: c.label }))]);
    const faPane = h('div.vte-tb-pane', {}, [
        h('div.vte-tb-pop-tools', {}, [search, cats, colorIn, count]),
        grid,
    ]);

    const nowImg = target && !/^data:image\/png/i.test(target.src) ? target.src : '';
    const was = tb.imageFields ? tb.imageFields(nowImg) : { url: nowImg, code: '' };
    const url = h('input.vte-input', { type: 'text', spellcheck: false, placeholder: 'https://… ссылка на .png / .svg / .webp / .gif', value: was.url });
    const code = h('textarea.vte-input.vte-tb-svg', { spellcheck: false, placeholder: 'или вставьте код <svg>…</svg>', rows: 4 });
    code.value = was.code;
    url.addEventListener('input', () => { if (url.value.trim()) code.value = ''; });
    code.addEventListener('input', () => { if (code.value.trim()) url.value = ''; });
    const imgPane = h('div.vte-tb-pane.vte-tb-imgpane', { style: nowImg || !target ? '' : 'display:none' }, [
        url, code,
        h('button.vte-btn.vte-btn-primary', {
            type: 'button',
            on: {
                click: async () => {
                    if (code.value.trim()) {
                        const img = svgData(code.value);
                        if (!img) { say('Это не похоже на код SVG'); return; }
                        if (img.length > 60000) { say('SVG тяжелее 60 КБ — для декора это много'); return; }
                        setSource(target, img, svgRatio(code.value) || await measure(img), 'Декор: своя картинка');
                    } else if (/^https?:\/\/[^\s"'()<>\\]+$/i.test(url.value.trim())) {
                        const u = url.value.trim();
                        setSource(target, u, await measure(u), 'Декор: картинка по ссылке');
                    } else { say('Вставьте ссылку http(s):// или код SVG'); }
                },
            },
        }, [icon('fa-check'), h('span', { text: target ? ' Поставить' : ' Добавить' })]),
        h('div.vte-note', { text: 'Ссылка работает с любого сайта. Пропорции картинки определятся сами.' }),
    ]);
    const showFa = !(nowImg || !target);
    faPane.style.display = showFa ? '' : 'none';
    const tab = (text, which) => h(`button.vte-tb-tab${(which === 'fa') === showFa ? '.active' : ''}`, {
        type: 'button',
        on: {
            click: (e) => {
                glyphPop.querySelectorAll('.vte-tb-tab').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                faPane.style.display = which === 'fa' ? '' : 'none';
                imgPane.style.display = which === 'img' ? '' : 'none';
            },
        },
    }, [h('span', { text })]);
    glyphPop = h('div.vte-tb-pop', {}, [
        h('div.vte-tb-pop-head', {}, [h('span', { text: target ? 'Сменить картинку' : 'Новая картинка' }), iconBtn('fa-xmark', 'Закрыть', closeGlyphPicker, 'vte-tb-mini')]),
        h('div.vte-tb-tabs', {}, [tab('Ссылка / SVG', 'img'), tab('Значок Font Awesome', 'fa')]),
        imgPane, faPane,
    ]);
    panel.appendChild(glyphPop);
    run();
}

/* ---------- значок Font Awesome → PNG ---------- */
async function loadGlyphFont(g) {
    const fam = g.brand ? '"Font Awesome 6 Brands"' : '"Font Awesome 6 Free"';
    const w = g.brand ? 400 : 900;
    try { await document.fonts.load(`${w} 48px ${fam}`, String.fromCodePoint(parseInt(g.code, 16))); } catch {}
    try { return document.fonts.check(`${w} 48px ${fam}`, String.fromCodePoint(parseInt(g.code, 16))); } catch { return true; }
}

function glyphPng(g, color) {
    try {
        const c = document.createElement('canvas');
        c.width = c.height = GLYPH_PX;
        const ctx = c.getContext('2d');
        const fam = g.brand ? '"Font Awesome 6 Brands"' : '"Font Awesome 6 Free"';
        const w = g.brand ? 400 : 900;
        const ch = String.fromCodePoint(parseInt(g.code, 16));
        let size = GLYPH_PX * 0.8;
        ctx.font = `${w} ${size}px ${fam}`;
        let m = ctx.measureText(ch);
        const gw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const gh = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        if (!gw || !gh) return '';
        // Вписать значок в квадрат с небольшим полем
        size *= Math.min((GLYPH_PX * 0.9) / gw, (GLYPH_PX * 0.9) / gh);
        ctx.font = `${w} ${size}px ${fam}`;
        m = ctx.measureText(ch);
        const x = (GLYPH_PX - (m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) / 2 + m.actualBoundingBoxLeft;
        const y = (GLYPH_PX - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) / 2 + m.actualBoundingBoxAscent;
        ctx.fillStyle = color || getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyColor').trim() || '#dcdcd2';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(ch, x, y);
        return c.toDataURL('image/png');
    } catch { return ''; }
}

function svgData(codeText) {
    let svg = String(codeText || '').trim();
    const start = svg.search(/<svg[\s>]/i);
    if (start === -1) return '';
    svg = svg.slice(start)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|metadata|title|desc)[\s\S]*?<\/\1>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
        .replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
    if (!/<\/svg>\s*$/i.test(svg)) return '';
    if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return `data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[%#<>{}\n\r;]/g, (c) => encodeURIComponent(c))}`;
}

/* ============================================================
   ОБЩИЕ ПОМОЩНИКИ (те же, что в «Пузырях»)
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

const num = (v) => Math.round(parseFloat(v) || 0);

const r2 = (n) => Math.round(n * 100) / 100;

function readFluid(v) {
    const m = String(v || '').match(/^clamp\(\s*(-?\d+(?:\.\d+)?)px\s*,.*,\s*(-?\d+(?:\.\d+)?)px\s*\)$/);
    if (m) return { min: Math.round(+m[1]), max: Math.round(+m[2]) };
    const p = String(v || '').match(/^(-?\d+(?:\.\d+)?)px$/);
    return p ? { min: Math.round(+p[1]), max: Math.round(+p[1]) } : { min: 0, max: 0 };
}

function fluid(min, max) {
    if (!min && !max) return '';
    const lo = Math.min(min || max, max || min);
    const hi = Math.max(min || max, max || min);
    if (lo === hi) return `${lo}px`;
    const slope = (hi - lo) / (VW_MAX - VW_MIN);
    const b = lo - slope * VW_MIN;
    return `clamp(${lo}px, ${r2(b)}px + ${r2(slope * 100)}vw, ${hi}px)`;
}

function row(label, control, hint) {
    return h('div.vte-tb-row', { title: hint || '' }, [h('span.vte-tb-label', { text: label }), control]);
}

function slider(key, min, max, unit, zeroText, hint, step = 1) {
    const out = h('span.vte-tb-val');
    const show = () => { const v = val(key); out.textContent = v ? `${v}${unit}` : zeroText; };
    const input = h('input.vte-tb-range', {
        type: 'range', min: String(min), max: String(max), step: String(step), value: String(val(key) || 0),
        title: hint || '',
        on: {
            input: (e) => { setVal(key, +e.target.value); show(); preview(); },
            change: () => commit(),
        },
    });
    show();
    // ↺ — вернуть «как в теме». Видна, только когда значение изменено
    const def = ((GROUP_OF[key] ? roleDefaults() : defaults())[key] ?? 0);
    const reset = iconBtn('fa-rotate-left', 'Сбросить эту настройку', () => {
        setVal(key, def);
        input.value = String(def || 0);
        show();
        sync();
        commit();
    }, 'vte-tb-mini.vte-tb-reset');
    const sync = () => reset.classList.toggle('vte-tb-reset-off', ((val(key) || 0)) === def);
    input.addEventListener('input', sync);
    sync();
    return h('span.vte-tb-slider', {}, [input, out, reset]);
}

function pair(title, aKey, bKey, max, hint, min = 0, zeroText = 'как в теме') {
    const LINK_KEY = `vte-dc-link-${aKey}`;
    let linked = (() => { try { return localStorage.getItem(LINK_KEY) !== '0'; } catch { return true; } })();
    const mk = (key, label) => {
        const out = h('span.vte-tb-val');
        const input = h('input.vte-tb-range', { type: 'range', min: String(min), max: String(max), step: '1' });
        const show = () => {
            input.value = String(val(key) || 0);
            out.textContent = val(key) ? `${val(key)}px` : zeroText;
        };
        show();
        return { key, input, show, row: row(label, h('span.vte-tb-slider', {}, [input, out])) };
    };
    const A = mk(aKey, 'На телефоне');
    const B = mk(bKey, 'На ПК');
    // Размеры связываем пропорцией (на ПК крупнее)
    const ratio = () => (val(aKey) && val(bKey) ? val(bKey) / val(aKey) : (min < 0 ? 1 : 1.15));
    let k = ratio();
    const bind = (me, other, to) => {
        me.input.addEventListener('input', () => {
            setVal(me.key, +me.input.value);
            if (linked) {
                setVal(other.key, val(me.key) ? Math.max(min, Math.min(max, Math.round(to(val(me.key))))) : 0);
                other.show();
            }
            me.show();
            preview();
        });
        me.input.addEventListener('change', () => { k = ratio(); commit(); });
    };
    bind(A, B, (v) => v * k);
    bind(B, A, (v) => v / k);

    const ic = icon(linked ? 'fa-link' : 'fa-link-slash');
    const txt = h('span', { text: linked ? ' связаны' : ' отдельно' });
    const link = h(`button.vte-tb-link${linked ? '.active' : ''}`, {
        type: 'button', title: 'Связать: меняешь один — второй подстраивается',
        on: {
            click: () => {
                linked = !linked;
                try { localStorage.setItem(LINK_KEY, linked ? '1' : '0'); } catch {}
                k = ratio();
                link.classList.toggle('active', linked);
                ic.className = `fa-solid ${linked ? 'fa-link' : 'fa-link-slash'}`;
                txt.textContent = linked ? ' связаны' : ' отдельно';
            },
        },
    }, [ic, txt]);

    // ↺ — сбросить обе (телефон и ПК)
    const defA = ((GROUP_OF[aKey] ? roleDefaults() : defaults())[aKey] ?? 0), defB = ((GROUP_OF[bKey] ? roleDefaults() : defaults())[bKey] ?? 0);
    const resetBoth = iconBtn('fa-rotate-left', 'Сбросить телефон и ПК', () => {
        setVal(aKey, defA);
        setVal(bKey, defB);
        A.show(); B.show();
        k = ratio();
        syncBoth();
        commit();
    }, 'vte-tb-mini.vte-tb-reset');
    const syncBoth = () => resetBoth.classList.toggle('vte-tb-reset-off', (val(aKey) || 0) === defA && (val(bKey) || 0) === defB);
    A.input.addEventListener('input', syncBoth);
    B.input.addEventListener('input', syncBoth);
    syncBoth();
    return h('div.vte-tb-sizes', { title: hint || '' }, [
        h('div.vte-tb-sizes-head', {}, [h('span.vte-tb-label', { text: title }), link, resetBoth]),
        A.row, B.row,
    ]);
}

function check(key, label, hint) {
    const input = h('input', {
        type: 'checkbox', checked: !!val(key),
        on: { change: (e) => { setVal(key, e.target.checked); commit(); render(); } },
    });
    return h('label.vte-tb-check', { title: hint || '' }, [input, h('span', { text: label })]);
}

function select(key, options, after) {
    const sel = h('select.vte-tb-select', {
        on: { change: (e) => { setVal(key, e.target.value); commit(); (after || (() => {}))(); } },
    }, options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = val(key);
    return sel;
}

function group(id, title, children) {
    const list = children.filter(Boolean);
    const head = h(`button.vte-av-group-head${open[id] ? '.open' : ''}`, {
        type: 'button',
        on: { click: () => { open[id] = !open[id]; render(); } },
    }, [icon(open[id] ? 'fa-chevron-down' : 'fa-chevron-right'), h('span', { text: title })]);
    return h('div.vte-av-group', {}, [head, open[id] ? h('div.vte-av-group-body', {}, list) : null]);
}

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
