// modules/recolor.js
// «Перекраска ♡»: все цвета, какие есть в коде темы, по разделам —
// топ-бар, нижняя панель, пузыри, панели, персонажи, полосы прокрутки,
// значки SVG и «общее». Любой цвет можно поменять — меняются все места,
// где он стоит (в разделе или, по галочке, во всей теме).
//
// Что считается цветом: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(),
// hsl()/hsla() и названия (white, black, red…) — в значениях свойств,
// включая переменные в :root и градиенты. Цвета внутри SVG-картинок
// (data:image/svg+xml, в т.ч. закодированные как %23…) — отдельный раздел.
// Картинки base64 не разбираются: цвет там не текстом.
//
// Правка — прямо в коде темы (не в «Моих правках»): это перекраска того,
// что уже есть. «Как было до открытия» возвращает всё назад.
// Пока цвет выбирается, предпросмотр — копией темы поверх (без записи);
// запись — один раз, когда цвет выбран.

import { buildIndex } from './cssRules.js';
import { explainRule } from './ruleExplain.js';

let onReadCSS = null;
let onWriteCSS = null;
let onReveal = null;
let onToast = null;
let picker = null;
let onSnapshot = null;
let onRestore = null;

let panel = null;
const els = {};

export function init(options = {}) {
    onReadCSS = options.onReadCSS || null;
    onWriteCSS = options.onWriteCSS || null;
    onReveal = options.onReveal || null;
    onToast = options.onToast || (() => {});
    picker = options.picker || null;
    onSnapshot = options.onSnapshot || null;
    onRestore = options.onRestore || null;
}

const say = (t) => onToast?.(t);

/* ============================================================
   РАЗДЕЛЫ
============================================================ */
const AREAS = [
    ['common', 'Общее', 'Переменные, вся страница и то, что не относится к одному месту'],
    ['top', 'Топ-бар', ''],
    ['bottom', 'Нижняя панель', ''],
    ['chat', 'Пузыри и текст', 'Сообщения, ник, кнопки у сообщений, разметка, лента чата'],
    ['panels', 'Панели и окна', 'Выезжающие панели, кнопки, поля, ползунки, всплывающие окна'],
    ['chars', 'Персонажи и персоны', 'Карточки, списки, Hot-swap'],
    ['scroll', 'Полосы прокрутки', ''],
    ['svg', 'Значки SVG', 'Цвета внутри SVG-картинок (в том числе закодированные %23…). Чёрный и белый здесь часто — это маски формы: их лучше не трогать'],
];

function areaOf(sel) {
    const s = sel;
    if (/scrollbar/.test(s)) return 'scroll';
    if (/#send_form|#send_textarea|#leftSendForm|#rightSendForm|#nonQRFormItems|#options_button|#send_but|#mes_stop|#extensionsMenuButton|#form_sheld|#qr--bar|#mes_impersonate|#mes_continue|#file_form|#options\b/.test(s)) return 'bottom';
    if (/#top-bar|#top-settings-holder|drawer-icon|DrawerIcon|drawer-toggle|#extensionTopBar/.test(s)) return 'top';
    if (/character_select|#rm_print_characters_block|#user_avatar_block|hotswap|avatars_inline|avatar-container|#HotSwapWrapper/.test(s)) return 'chars';
    if (/\.mes\b|\.mes_|#chat\b|#sheld|\.name_text|\.timestamp|\.swipe|mesAvatarWrapper|\.last_mes|\.ch_name|mesIDDisplay|tokenCounter|\.mes_text/.test(s)) return 'chat';
    if (/drawer-content|#left-nav-panel|#right-nav-panel|#rm_|\.popup|menu_button|text_pole|inline-drawer|\[type="?range|range-slider|#WorldInfo|#AdvancedFormatting|#user-settings-block|#Backgrounds|#PersonaManagement|standoutHeader|\bselect\b|\binput\b|\btextarea\b/.test(s)) return 'panels';
    return 'common';
}

/* ============================================================
   ПОИСК ЦВЕТОВ
============================================================ */
const NAMED = 'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen';
const COLOR_RE = new RegExp(`#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|\\b(?:rgba?|hsla?)\\([^()]*\\)|(?<![\\w-])(?:${NAMED})(?![\\w-])`, 'gi');
// Названия цветов — только в свойствах, где цвет ожидаем (иначе «red» в имени шрифта и т.п.)
const COLORISH = /color|background|border|outline|shadow|fill|stroke|decoration|caret|accent|^--/i;
const SVG_HEX_RE = /(%23|#)([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z])/g;
// Цвет словом или rgb() в атрибутах SVG: fill='white', stroke="rgb(…)"
const SVG_ATTR_RE = /(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(['"]|%22|%27)([^'"%]*(?:%(?!2[27])[^'"%]*)*)(?=\2)/gi;

/** Один цвет в одном месте: где стоит в тексте и к чему относится */
function scan(css) {
    const idx = buildIndex(css);
    const hits = [];
    for (const rule of idx.rules) {
        const sel = rule.parts.map(p => p.raw).join(', ');
        const area = areaOf(sel);
        for (const d of rule.decls) {
            const vs = d.valueStart, ve = d.valueEnd;
            if (!(vs >= 0 && ve > vs)) continue;
            const value = css.slice(vs, ve);
            // url(...) — отдельно: SVG разбираем, остальное (base64, ссылки) пропускаем
            const urls = [];
            value.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi, (m, off) => { urls.push([off, off + m.length]); return m; });
            const inUrl = (o) => urls.some(([a, b]) => o >= a && o < b);
            COLOR_RE.lastIndex = 0;
            let m;
            while ((m = COLOR_RE.exec(value))) {
                if (inUrl(m.index)) continue;
                const tok = m[0];
                if (/^[a-z]/i.test(tok) && !/^(rgb|hsl)/i.test(tok) && !COLORISH.test(d.prop)) continue;
                hits.push({ from: vs + m.index, to: vs + m.index + tok.length, tok, kind: 'css', area, sel, prop: d.prop, rule, decl: d });
            }
            /* Переменная-тройка «255, 105, 180» — цвет, который тема подставляет
               в rgba(var(--x), 0.5). Сам rgba(var(…)) цветом не считается: цвет
               в нём — эта переменная */
            if (d.prop.startsWith('--')) {
                const tm = value.match(/^(\s*)(\d{1,3})(\s*,\s*|\s+)(\d{1,3})(\s*,\s*|\s+)(\d{1,3})(\s*)$/);
                if (tm && [tm[2], tm[4], tm[6]].every(n => +n <= 255)) {
                    const from = vs + tm[1].length;
                    const text = value.trim();
                    hits.push({
                        from, to: from + text.length, tok: `rgb(${tm[2]}, ${tm[4]}, ${tm[6]})`, sep: tm[3],
                        kind: 'triplet', area, sel, prop: d.prop, rule, decl: d,
                    });
                }
            }
            for (const [a, b] of urls) {
                const u = value.slice(a, b);
                if (!/svg/i.test(u) || /base64/i.test(u)) continue;
                SVG_HEX_RE.lastIndex = 0;
                while ((m = SVG_HEX_RE.exec(u))) {
                    hits.push({
                        from: vs + a + m.index, to: vs + a + m.index + m[0].length, tok: `#${m[2]}`,
                        kind: m[1] === '%23' ? 'svgenc' : 'svgraw', area: 'svg', sel, prop: d.prop, rule, decl: d,
                    });
                }
                SVG_ATTR_RE.lastIndex = 0;
                while ((m = SVG_ATTR_RE.exec(u))) {
                    const v = decodeURIComponent(m[3]).trim();
                    if (!v || /^(#|%23|none|currentcolor|url|transparent|inherit)/i.test(v)) continue;
                    if (canon(v) === v.toLowerCase() && !/^(rgb|hsl)/i.test(v)) continue;   // не цвет
                    const off = m.index + m[0].length - m[3].length;
                    hits.push({
                        from: vs + a + off, to: vs + a + off + m[3].length, tok: v,
                        kind: 'svgenc', area: 'svg', sel, prop: d.prop, rule, decl: d,
                    });
                }
            }
        }
    }
    return hits;
}

/* Один цвет в разных записях (#fff и white) — одна строка */
let cctx = null;
function canon(tok) {
    try {
        cctx ||= document.createElement('canvas').getContext('2d');
        cctx.fillStyle = '#000';
        cctx.fillStyle = tok;
        const a = cctx.fillStyle;
        cctx.fillStyle = '#fff';
        cctx.fillStyle = tok;
        return a === cctx.fillStyle ? a : tok.toLowerCase();   // не разобрался — как написано
    } catch { return tok.toLowerCase(); }
}

/** Любой цвет CSS → #rrggbb или #rrggbbaa (для SVG) */
function toHex(v) {
    const c = canon(v);
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
    if (!m) return '#000000';
    const hx = (n) => Math.max(0, Math.min(255, Math.round(+n))).toString(16).padStart(2, '0');
    const a = m[4] == null ? '' : hx(+m[4] * 255);
    return `#${hx(m[1])}${hx(m[2])}${hx(m[3])}${a === 'ff' ? '' : a}`;
}

/* ============================================================
   ОКНО
============================================================ */
let hits = [];
let groups = new Map();       // area → Map(canon → { canon, sample, list })
let lastCSS = null;
let everywhere = false;
const openArea = { common: true };
const openColor = {};

function rescan() {
    const css = onReadCSS?.() || '';
    if (css === lastCSS) return;
    lastCSS = css;
    hits = [];
    try { hits = scan(css); } catch {}
    groups = new Map(AREAS.map(a => [a[0], new Map()]));
    for (const hIt of hits) {
        const c = canon(hIt.tok);
        const g = groups.get(hIt.area);
        if (!g.has(c)) g.set(c, { canon: c, sample: hIt.tok, list: [] });
        g.get(c).list.push(hIt);
    }
}

export function showPanel() {
    onSnapshot?.();
    lastCSS = null;
    rescan();
    if (!panel) build();
    panel.style.display = 'flex';
    render();
}

export function refresh() {
    if (!isOpen() || pickingNow) return;
    const before = lastCSS;
    rescan();
    if (before !== lastCSS) render();
}

export function hidePanel() {
    clearPreview();
    if (panel) panel.style.display = 'none';
}

export function isOpen() {
    return !!panel && panel.style.display !== 'none';
}

export function togglePanel() {
    isOpen() ? hidePanel() : showPanel();
}

function build() {
    const header = h('div.vte-header', {}, [
        h('div.vte-title', {}, [h('span.vte-title-ic', {}, [icon('fa-palette')]), h('span', { text: 'Перекраска' })]),
        h('div.vte-header-btns', {}, [iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close')]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-recolor-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-recolor-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

function render() {
    if (!els.body) return;
    const top = els.body.scrollTop;
    els.body.textContent = '';
    els.body.append(...screen().filter(Boolean));
    els.body.scrollTop = top;
}

function screen() {
    const total = [...groups.values()].reduce((n, g) => n + g.size, 0);
    const out = [
        h('small.vte-note', {
            text: `Все цвета из кода темы: ${hits.length} ${plural(hits.length, 'место', 'места', 'мест')}, ${total} разных по разделам. `
                + 'Нажмите на цвет — выберите новый: поменяются все места, где он стоит.',
        }),
        h('label.vte-tb-check', { title: 'Иначе меняется только в своём разделе' }, [
            h('input', { type: 'checkbox', checked: everywhere, on: { change: (e) => { everywhere = e.target.checked; } } }),
            h('span', { text: 'Одинаковый цвет менять во всей теме сразу' }),
        ]),
    ];
    for (const [id, title, hint] of AREAS) {
        const g = groups.get(id);
        if (!g?.size) continue;
        const isOpen = !!openArea[id];
        const head = h(`button.vte-av-group-head${isOpen ? '.open' : ''}`, {
            type: 'button', title: hint || '',
            on: { click: () => { openArea[id] = !openArea[id]; render(); } },
        }, [icon(isOpen ? 'fa-chevron-down' : 'fa-chevron-right'), h('span', { text: `${title} — ${g.size}` }),
            h('span.vte-rc-strip', {}, [...g.values()].slice(0, 12).map(c => h('i', { style: `background:${cssSafe(c.sample)}` })))]);
        const body = isOpen ? h('div.vte-av-group-body', {}, [...g.values()].map(c => colorRow(id, c))) : null;
        out.push(h('div.vte-av-group', {}, [head, body]));
    }
    if (!hits.length) out.push(h('small.vte-note', { text: 'В коде темы цветов не нашлось.' }));
    out.push(h('div.vte-tb-foot', {}, [
        h('button.vte-btn', {
            type: 'button', title: 'Вернуть все цвета как были при открытии окна',
            on: { click: () => { onRestore?.() ? say('Цвета как при открытии окна') : say('Возвращать нечего'); lastCSS = null; rescan(); render(); } },
        }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
    ]));
    return out;
}

function colorRow(area, c) {
    const key = `${area}|${c.canon}`;
    const sw = h('button.vte-rc-swatch', {
        type: 'button', title: 'Выбрать новый цвет',
        style: `background:${cssSafe(c.sample)}`,
        on: { click: (e) => pick(area, c, e.currentTarget) },
    });
    const places = c.list.length;
    const row = h('div.vte-rc-row', {}, [
        sw,
        h('code.vte-rc-val', { text: c.sample, title: c.canon }),
        // Цвет в переменной — видно её имя: по нему понятно, что это за цвет
        (() => {
            const vars = [...new Set(c.list.map(x => x.prop).filter(p => p.startsWith('--')))];
            return vars.length ? h('span.vte-rc-var', { text: vars.slice(0, 2).join(', ') + (vars.length > 2 ? '…' : ''), title: vars.join(', ') }) : null;
        })(),
        h('button.vte-rc-count', {
            type: 'button', title: 'Где этот цвет стоит',
            on: { click: () => { openColor[key] = !openColor[key]; render(); } },
        }, [h('span', { text: `${places} ${plural(places, 'место', 'места', 'мест')}` }), icon(openColor[key] ? 'fa-chevron-up' : 'fa-chevron-down')]),
    ]);
    if (!openColor[key]) return row;
    const where = h('div.vte-rc-where', {}, c.list.slice(0, 40).map(hIt => h('button.vte-tb-rule', {
        type: 'button', title: 'Показать в коде',
        on: { click: () => onReveal?.(hIt.from, hIt.to) },
    }, [
        h('span.vte-grp-rule-what', { text: explainRule(hIt.rule.parts.map(p => p.raw), [hIt.decl]) }),
        h('code.vte-tb-rule-sel', { text: `${short(hIt.sel, 70)} → ${hIt.prop}` }),
    ])));
    return h('div', {}, [row, where]);
}

/* ============================================================
   ЗАМЕНА
============================================================ */
let previewStyle = null;
let pickingNow = false;

function targetsFor(area, c) {
    if (!everywhere) return c.list;
    return hits.filter(x => canon(x.tok) === c.canon);
}

/** Новый текст темы: все места заменены (с конца — позиции не сдвигаются) */
function replaced(css, list, value) {
    const hex = toHex(value);
    const sorted = [...list].sort((a, b) => b.from - a.from);
    let out = css;
    for (const x of sorted) {
        if (out.slice(x.from, x.to) !== css.slice(x.from, x.to)) continue;
        const rep = x.kind === 'svgenc' ? `%23${hex.slice(1)}`
            : x.kind === 'svgraw' ? hex
            : x.kind === 'triplet' ? tripletOf(hex, x.sep)
            : value;
        out = out.slice(0, x.from) + rep + out.slice(x.to);
    }
    return out;
}

function pick(area, c, anchor) {
    if (!picker) return;
    const css = onReadCSS?.() || '';
    const list = targetsFor(area, c);
    pickingNow = true;
    picker.open({
        anchor, value: c.sample, allowGradient: false,
        onChange: (v) => showPreview(replaced(css, list, v)),
        onCommit: (v) => {
            pickingNow = false;
            clearPreview();
            if (!v || canon(v) === c.canon) return;
            onWriteCSS?.(replaced(css, list, v));
            say(`Перекрашено мест: ${list.length}`);
            lastCSS = null;
            rescan();
            render();
        },
        onCancel: () => { pickingNow = false; clearPreview(); },
    });
}

/* Предпросмотр: изменённая копия темы поверх, пока выбирается цвет */
let previewRaf = 0;
let pendingCSS = '';
function showPreview(css) {
    pendingCSS = css;
    if (previewRaf) return;
    previewRaf = requestAnimationFrame(() => {
        previewRaf = 0;
        if (!previewStyle) {
            previewStyle = document.createElement('style');
            previewStyle.id = 'vte-recolor-preview';
            document.head.appendChild(previewStyle);
        }
        previewStyle.textContent = pendingCSS.replace(/@import[^;]+;/g, '');
    });
}

function clearPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    previewStyle?.remove();
    previewStyle = null;
}

/** #rrggbb → «r, g, b» (прозрачность у тройки не бывает — отбрасывается) */
function tripletOf(hex, sep = ', ') {
    const n = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return n.join(/,/.test(sep) ? ', ' : ' ');
}

/* ============================================================
   МЕЛОЧИ
============================================================ */
const cssSafe = (v) => String(v).replace(/[;{}<>"]/g, '');
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function plural(n, one, few, many) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
    return many;
}

/* ============================================================
   ОБЩИЕ ПОМОЩНИКИ (те же, что в других окнах)
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
export { scan as scanColors };  // для проверок
