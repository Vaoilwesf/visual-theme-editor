// modules/panels.js
// «Панели ♡»: фон выезжающих панелей SillyTavern, кнопки в них и все
// ползунки таверны (полоса и кругляшок).
//
// Разметка ST: у каждой кнопки верхней полосы своя выезжающая панель —
// .drawer-content с id: #left-nav-panel (настройки ИИ), #rm_api_block
// (подключение и профили соединения), #AdvancedFormatting (форматирование
// ответа), #WorldInfo, #user-settings-block, #Backgrounds,
// #rm_extensions_block, #PersonaManagement, #right-nav-panel (персонажи).
// Плавающие окна (заметки автора, CFG, вероятности токенов, менеджер
// промптов) — тоже .drawer-content.
//
// Что пишется (всё в «Мои правки»):
//   .drawer-content                    — фон всех панелей сразу;
//   #<id панели>                       — своё у отдельной панели (id сильнее
//                                        класса — перекрывает общее);
//   .drawer-content .menu_button        — кнопки в панелях (+ .popup, если
//                                        включено «и во всплывающих окнах»);
//   input[type="range"]:not([class^="vte-"])  — все ползунки таверны.
//     :not(...) — чтобы не перекрасить ползунки в окнах самого расширения:
//     у всех наших ползунков класс начинается с «vte-». Проверка одного
//     атрибута — браузер делает её почти даром.
//   … ::-webkit-slider-thumb и … ::-moz-range-thumb — кругляшок. Это два
//     отдельных правила, не через запятую: чужой для браузера псевдоэлемент
//     в списке выкидывает правило целиком.
//
// Лёгкость:
//  - затемнение поверх картинки — внутренняя тень без размытия (один
//    сплошной слой), а не градиент и не лишний ::before;
//  - «Без размытия» снимает backdrop-filter у панели;
//  - значок Font Awesome на кругляшке рисуется один раз в маленькую
//    картинку PNG: шрифт картинке недоступен, а ::before у кругляшка нет.

import { ruleRows } from './ruleList.js';

let onApply = null;
let onReadRules = null;
let onThemeRules = null;
let onReveal = null;
let onDeleteRule = null;       // (from, to) => убрать правило из кода
let onCleanOverridden = null;  // (starts) => убрать перекрытое
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
    onThemeRules = options.onThemeRules || null;
    onReveal = options.onReveal || null;
    onDeleteRule = options.onDeleteRule || null;
    onCleanOverridden = options.onCleanOverridden || null;
    onToast = options.onToast || (() => {});
    picker = options.picker || null;
    onSnapshot = options.onSnapshot || null;
    onRestore = options.onRestore || null;
}

const say = (t) => onToast?.(t);

/* ============================================================
   ПАНЕЛИ И СЕЛЕКТОРЫ
============================================================ */
const ALL = '*';

/* Панели самой ST. Порядок — как значки в верхней полосе */
const KNOWN = [
    ['left-nav-panel', 'Настройки ИИ (левая панель)'],
    ['rm_api_block', 'Подключение к API и профили соединения'],
    ['AdvancedFormatting', 'Форматирование ответа ИИ'],
    ['WorldInfo', 'Миры (World Info)'],
    ['user-settings-block', 'Настройки пользователя'],
    ['Backgrounds', 'Фоны'],
    ['rm_extensions_block', 'Расширения'],
    ['PersonaManagement', 'Персоны'],
    ['right-nav-panel', 'Персонажи (правая панель)'],
    ['floatingPrompt', 'Заметки автора (плавающее окно)'],
    ['cfgConfig', 'CFG (плавающее окно)'],
    ['logprobsViewer', 'Вероятности токенов (плавающее окно)'],
    ['completion_prompt_manager_popup', 'Менеджер промптов'],
];

/** Все панели: известные + добавленные расширениями (.drawer-content с id) */
function panelList(s) {
    const map = new Map(KNOWN);
    try {
        for (const el of document.querySelectorAll('.drawer-content[id]')) {
            if (!map.has(el.id)) map.set(el.id, el.id);
        }
    } catch {}
    for (const id of Object.keys(s?.pan || {})) if (id !== ALL && !map.has(id)) map.set(id, id);
    return [...map.entries()];
}

const panelSel = (id) => (id === ALL ? '.drawer-content' : `#${id}`);

const BTN_SCOPES = (popups) => (popups ? ['.drawer-content', '.popup'] : ['.drawer-content']);
const btnSel = (popups, tail = '') => BTN_SCOPES(popups).map(s => `${s} .menu_button${tail}`).join(', ');
const btnHoverSel = (popups) => BTN_SCOPES(popups).flatMap(s => [`${s} .menu_button:hover`, `${s} .menu_button.active`]).join(', ');
// Серый фильтр снимаем только у доступных кнопок: у выключенных ST им
// показывает, что нажать нельзя
const btnLiveSel = (popups) => btnSel(popups, ':not(.disabled, [disabled])');

const R = 'input[type="range"]:not([class^="vte-"])';
const THUMBS = [`${R}::-webkit-slider-thumb`, `${R}::-moz-range-thumb`];

/* ============================================================
   СОСТОЯНИЕ
============================================================ */
function panelDefaults() {
    return {
        bg: '', img: '', fit: 'cover', tint: '',
        noBlur: false, bw: 0, bc: '', noBorder: false, radius: 10,
    };
}
const PANEL_KEYS = new Set(Object.keys(panelDefaults()));

function defaults() {
    return {
        on: false,
        pan: {},                 // id панели (или '*') → настройки
        // кнопки
        btnPopups: false, bColor: '', bBg: '', bHover: '', bBw: 0, bBc: '', bNoBorder: false,
        bRadius: 5, bNoGray: false,
        // полоса ползунка
        hMin: 0, hMax: 0, rColor: '', rImg: '', rBw: 0, rBc: '', rRadius: '',
        rNoShadow: false, rNoDim: false,
        // кругляшок
        tMin: 0, tMax: 0, tColor: '', tBw: 0, tBc: '', tNoRing: false, tShape: '', tImg: '', tGlyphColor: '',
    };
}

let which = ALL;            // какую панель сейчас правим (только в окне, не в теме)
let lastGlyph = null;       // значок Font Awesome, выбранный в этом сеансе (для смены цвета)

const cur = () => (state.pan[which] ||= panelDefaults());

/* Общие помощники из «Пузырей» ждут этих имён: здесь «роль» — выбранная панель */
const GROUP_OF = Object.fromEntries([...PANEL_KEYS].map(k => [k, true]));
const roleDefaults = () => panelDefaults();
const val = (key) => (PANEL_KEYS.has(key) ? cur()[key] : state[key]);
function setVal(key, v) {
    if (PANEL_KEYS.has(key)) cur()[key] = v;
    else state[key] = v;
    // Цвет значка Font Awesome — перерисовать картинку сразу, до записи
    if (key === 'tGlyphColor' && lastGlyph) {
        const png = glyphPng(lastGlyph, v);
        if (png) state.tImg = png;
    }
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

    // Панели: общая и все, у которых есть своё (из списка или найденные в разметке)
    const ids = new Set([ALL, ...KNOWN.map(k => k[0])]);
    for (const key of rules.keys()) {
        const m = key.match(/^#([\w-]+)$/);
        if (!m) continue;
        let isDrawer = false;
        try { isDrawer = !!document.getElementById(m[1])?.classList.contains('drawer-content'); } catch {}
        if (isDrawer) ids.add(m[1]);
    }
    for (const id of ids) {
        const sel = panelSel(id);
        if (!rules.get(sel)?.size) continue;
        const p = panelDefaults();
        p.bg = get(sel, 'background-color');
        p.img = urlIn(get(sel, 'background-image'));
        p.fit = get(sel, 'background-repeat') === 'repeat' ? 'repeat' : get(sel, 'background-size') === 'contain' ? 'contain' : 'cover';
        p.tint = (get(sel, 'box-shadow').match(/^inset 0 0 0 100vmax (.+)$/) || [])[1] || '';
        p.noBlur = get(sel, 'backdrop-filter') === 'none';
        const bd = get(sel, 'border');
        if (bd === 'none') p.noBorder = true;
        const bm = bd.match(/^(\d+)px\s+solid\s+(.+)$/);
        if (bm) { p.bw = +bm[1]; p.bc = bm[2] === 'currentColor' ? '' : bm[2]; }
        const rr = get(sel, 'border-radius');
        if (rr) p.radius = num(rr);
        s.pan[id] = p;
    }

    // Кнопки: какой вариант записан — только панели или ещё и всплывающие окна
    s.btnPopups = !!rules.get(btnSel(true))?.size;
    const B = btnSel(s.btnPopups);
    s.bColor = get(B, 'color');
    s.bBg = get(B, 'background-color');
    s.bHover = get(btnHoverSel(s.btnPopups), 'background-color');
    // Своего фона при наведении нет — записанное там значение ST (var(--white30a))
    if (s.bHover === 'var(--white30a)') s.bHover = '';
    const bb = get(B, 'border');
    if (bb === 'none') s.bNoBorder = true;
    const bbm = bb.match(/^(\d+)px\s+solid\s+(.+)$/);
    if (bbm) { s.bBw = +bbm[1]; s.bBc = bbm[2] === 'currentColor' ? '' : bbm[2]; }
    const br = get(B, 'border-radius');
    if (br) s.bRadius = num(br);
    s.bNoGray = get(btnLiveSel(s.btnPopups), 'filter') === 'none';

    // Полоса
    const h = readFluid(get(R, 'height')); s.hMin = h.min; s.hMax = h.max;
    s.rColor = get(R, 'background-color');
    s.rImg = urlIn(get(R, 'background-image'));
    const rb = get(R, 'border').match(/^(\d+)px\s+solid\s+(.+)$/);
    if (rb) { s.rBw = +rb[1]; s.rBc = rb[2] === 'currentColor' ? '' : rb[2]; }
    s.rRadius = get(R, 'border-radius');
    s.rNoShadow = get(R, 'box-shadow') === 'none';
    s.rNoDim = get(R, 'filter') === 'none';

    // Кругляшок (читаем из правила для Chrome — второе такое же)
    const T = THUMBS[0];
    const t = readFluid(get(T, 'width')); s.tMin = t.min; s.tMax = t.max;
    s.tColor = get(T, 'background-color');
    s.tImg = urlIn(get(T, 'background-image'));
    const tb = get(T, 'border');
    if (tb === 'none') s.tNoRing = true;
    const tbm = tb.match(/^(\d+)px\s+solid\s+(.+)$/);
    if (tbm) { s.tBw = +tbm[1]; s.tBc = tbm[2] === 'currentColor' ? '' : tbm[2]; }
    s.tShape = { '50%': 'circle', '30%': 'rounded', '0': 'square' }[get(T, 'border-radius')] || '';

    const mine = [...ids].map(panelSel);
    s.on = [...mine, btnSel(false), btnSel(true), R, ...THUMBS].some(k => rules.get(k)?.size);
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
function buildRules(s) {
    const rules = {};
    const put = (sel, prop, v) => { (rules[sel] ||= {})[prop] = v; };
    const on = s.on;

    /* ---------- фон панелей ----------
       Пишем все панели из списка: у кого ничего нет — пустые значения,
       так «сбросить» и «убрать своё у панели» стирают строки из темы */
    const ids = new Set([ALL, ...panelList(s).map(p => p[0]), ...Object.keys(s.pan || {})]);
    for (const id of ids) {
        const p = on ? (s.pan[id] || null) : null;
        const sel = panelSel(id);
        const img = p && p.img ? p.img : '';
        put(sel, 'background-color', p ? p.bg : '');
        put(sel, 'background-image', img ? urlOut(img) : '');
        put(sel, 'background-size', img ? (p.fit === 'repeat' ? 'auto' : p.fit) : '');
        put(sel, 'background-repeat', img ? (p.fit === 'repeat' ? 'repeat' : 'no-repeat') : '');
        put(sel, 'background-position', img ? 'center' : '');
        // Затемнение картинки: сплошная внутренняя тень рисуется поверх фона,
        // но под текстом. Без размытия — это один залитый слой
        put(sel, 'box-shadow', img && p.tint ? `inset 0 0 0 100vmax ${p.tint}` : '');
        put(sel, 'backdrop-filter', p && p.noBlur ? 'none' : '');
        put(sel, '-webkit-backdrop-filter', p && p.noBlur ? 'none' : '');
        put(sel, 'border', !p ? '' : p.noBorder ? 'none' : p.bw ? `${p.bw}px solid ${p.bc || 'currentColor'}` : '');
        put(sel, 'border-radius', p && p.radius !== 10 ? `${p.radius}px` : '');
    }

    /* ---------- кнопки в панелях ---------- */
    for (const popups of [false, true]) {
        const act = on && s.btnPopups === popups;
        const B = btnSel(popups);
        put(B, 'color', act ? s.bColor : '');
        put(B, 'background-color', act ? s.bBg : '');
        put(B, 'border', !act ? '' : s.bNoBorder ? 'none' : s.bBw ? `${s.bBw}px solid ${s.bBc || 'currentColor'}` : '');
        put(B, 'border-radius', act && s.bRadius !== 5 ? `${s.bRadius}px` : '');
        // Свой фон перекрывает и подсветку ST при наведении (она без !important) —
        // тогда пишем подсветку заново: свою или как в ST
        put(btnHoverSel(popups), 'background-color', act && (s.bHover || s.bBg) ? (s.bHover || 'var(--white30a)') : '');
        put(btnLiveSel(popups), 'filter', act && s.bNoGray ? 'none' : '');
    }

    /* ---------- полоса ползунка ---------- */
    put(R, 'height', on ? fluid(s.hMin, s.hMax) : '');
    put(R, 'background-color', on ? s.rColor : '');
    put(R, 'background-image', on && s.rImg ? urlOut(s.rImg) : '');
    put(R, 'background-size', on && s.rImg ? '100% 100%' : '');
    put(R, 'border', on && s.rBw ? `${s.rBw}px solid ${s.rBc || 'currentColor'}` : '');
    put(R, 'border-radius', on ? s.rRadius : '');
    put(R, 'box-shadow', on && s.rNoShadow ? 'none' : '');
    // Без затемнения: ST делает ползунок на четверть темнее выбранного цвета
    put(R, 'filter', on && s.rNoDim ? 'none' : '');

    /* ---------- кругляшок ---------- */
    const size = on ? fluid(s.tMin, s.tMax) : '';
    for (const T of THUMBS) {
        put(T, 'width', size);
        put(T, 'height', size);
        put(T, 'background-color', on ? s.tColor : '');
        put(T, 'background-image', on && s.tImg ? urlOut(s.tImg) : '');
        put(T, 'background-size', on && s.tImg ? 'contain' : '');
        put(T, 'background-position', on && s.tImg ? 'center' : '');
        put(T, 'background-repeat', on && s.tImg ? 'no-repeat' : '');
        put(T, 'border', !on ? '' : s.tNoRing ? 'none' : s.tBw ? `${s.tBw}px solid ${s.tBc || 'currentColor'}` : '');
        put(T, 'border-radius', on && s.tShape ? { circle: '50%', rounded: '30%', square: '0' }[s.tShape] : '');
    }
    return rules;
}

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
        previewStyle.id = 'vte-panels-preview';
        document.head.appendChild(previewStyle);
    }
    if (previewStyle.textContent !== css) previewStyle.textContent = css;
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
    // Пустые настройки панели не храним — чтобы в списке не висела «своя» пустая
    for (const [id, p] of Object.entries(state.pan)) {
        if (id !== which && !hasOwn(p)) delete state.pan[id];
    }
    const list = Object.entries(buildRules(state)).map(([selector, decls]) => ({ selector, decls }));
    const changed = await onApply?.(list);
    clearPreview();
    return changed;
}

function hasOwn(p) {
    if (!p) return false;
    const d = panelDefaults();
    return Object.keys(d).some(k => k !== 'fit' && p[k] !== d[k]);
}

/* ============================================================
   ОКНО
============================================================ */
export async function showPanel() {
    onSnapshot?.();
    state = readState();
    if (!panel) build();
    panel.style.display = 'flex';
    render();
}

export function refresh() {
    if (!isOpen()) return;
    state = readState();
    render();
}

export function hidePanel() {
    clearPreview();
    closeGlyphPicker();
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
        h('div.vte-title', {}, [h('span.vte-title-ic', {}, [icon('fa-window-restore')]), h('span', { text: 'Панели' })]),
        h('div.vte-header-btns', {}, [iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close')]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-panels-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-panels-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

const open = { bg: true, buttons: false, track: false, thumb: false };

function render() {
    // Перерисовка не должна сбрасывать прокрутку окна
    const scroll = els.body.scrollTop;
    els.body.textContent = '';
    els.body.append(...screen().filter(Boolean));
    els.body.scrollTop = scroll;
}

function urlField(key, placeholder) {
    return h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder, value: val(key) || '',
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

/* ---------- выбор панели ---------- */
function panelPicker() {
    const list = panelList(state);
    const mark = (id) => (hasOwn(state.pan[id]) ? ' ✓' : '');
    const sel = h('select.vte-tb-select.vte-pn-which', {
        on: { change: (e) => { which = e.target.value; render(); } },
    }, [
        h('option', { value: ALL, text: `Все панели сразу${mark(ALL)}` }),
        ...list.map(([id, label]) => {
            const here = !!document.getElementById(id);
            return h('option', { value: id, text: `${label}${here ? '' : ' (сейчас нет)'}${mark(id)}` });
        }),
    ]);
    if (which !== ALL && !list.some(p => p[0] === which)) which = ALL;
    sel.value = which;
    return sel;
}

function showDrawer() {
    const el = document.getElementById(which);
    if (!el) { say('Этой панели сейчас нет на странице'); return; }
    if (el.classList.contains('openDrawer') || getComputedStyle(el).display !== 'none') { say('Эта панель уже открыта'); return; }
    const toggle = el.closest('.drawer')?.querySelector(':scope > .drawer-toggle');
    if (!toggle) { say('Это окно открывается из своего меню в таверне'); return; }
    toggle.click();
}

function screen() {
    const p = cur();
    const one = which !== ALL;
    return [
        themeSection(),

        group('bg', 'Фон панелей', [
            h('small.vte-note', { text: 'Выезжающие панели верхнего меню: настройки ИИ, подключение, форматирование, миры, '
                + 'настройки пользователя, фоны, расширения, персоны, персонажи — и плавающие окна.' }),
            row('Какая панель', panelPicker()),
            one ? h('small.vte-note', { text: 'Своё у этой панели — поверх общего «Все панели сразу». Что не задано здесь, берётся из общего.' }) : null,
            one ? h('div.vte-pn-actions', {}, [
                h('button.vte-btn', { type: 'button', title: 'Открыть эту панель в таверне, чтобы видеть изменения', on: { click: showDrawer } },
                    [icon('fa-eye'), h('span', { text: ' Показать' })]),
                hasOwn(state.pan[which]) ? h('button.vte-btn', {
                    type: 'button', title: 'Убрать всё своё у этой панели — останется общее',
                    on: { click: () => { state.pan[which] = panelDefaults(); state.on = true; commit(); render(); say('У панели снова общее оформление'); } },
                }, [icon('fa-rotate-left'), h('span', { text: ' Как у всех' })]) : null,
            ]) : null,
            row('Фон', colorBtn('bg', one ? 'как у всех' : 'как в теме')),
            row('Картинка фона', urlField('img', 'https://… ссылка на картинку')),
            p.img ? row('Как вписать', select('fit', [['cover', 'заполнить'], ['contain', 'целиком'], ['repeat', 'плиткой']])) : null,
            p.img ? row('Затемнить картинку', colorBtn('tint', 'нет'), 'Полупрозрачный цвет поверх картинки — текст читается легче') : null,
            check('noBlur', 'Без размытия под панелью (легче)', 'Размытие того, что под панелью, пересчитывается при каждой прокрутке'),
            row('Рамка', slider('bw', 0, 6, 'px', 'как в теме')),
            p.bw ? row('Цвет рамки', colorBtn('bc', 'цвет текста')) : null,
            check('noBorder', 'Без рамки'),
            row('Скругление', slider('radius', 0, 40, 'px', 'нет')),
        ]),

        group('buttons', 'Кнопки в панелях', [
            h('small.vte-note', { text: 'Обычные кнопки SillyTavern внутри панелей: «Подключиться», «Сохранить», значки-кнопки и т.п.' }),
            check('btnPopups', 'И во всплывающих окнах', 'Кнопки «Да / Нет / Сохранить» в окнах поверх таверны'),
            row('Цвет текста и значков', colorBtn('bColor', 'как в теме')),
            row('Фон', colorBtn('bBg', 'как в теме')),
            row('Фон при наведении', colorBtn('bHover', 'как в теме')),
            row('Рамка', slider('bBw', 0, 6, 'px', 'как в теме')),
            state.bBw ? row('Цвет рамки', colorBtn('bBc', 'цвет текста')) : null,
            check('bNoBorder', 'Без рамки'),
            row('Скругление', slider('bRadius', 0, 30, 'px', 'нет')),
            check('bNoGray', 'Без приглушения', 'ST делает кнопки немного серыми. Недоступные кнопки останутся серыми'),
        ]),

        group('track', 'Ползунки — полоса', [
            h('small.vte-note', { text: 'Все ползунки таверны разом: температура, размер контекста, ответ и все остальные.' }),
            pair('Толщина', 'hMin', 'hMax', 30, 'Первое — на телефоне, второе — на ПК'),
            row('Цвет', colorBtn('rColor', 'как в теме')),
            row('Картинка', urlField('rImg', 'https://… растянется по полосе')),
            row('Рамка', slider('rBw', 0, 6, 'px', 'нет')),
            state.rBw ? row('Цвет рамки', colorBtn('rBc', 'цвет текста')) : null,
            row('Края', select('rRadius', [['', 'как в теме'], ['0', 'прямые'], ['4px', 'чуть скруглённые'], ['999px', 'круглые']])),
            check('rNoShadow', 'Без тени внутри полосы'),
            check('rNoDim', 'Без затемнения', 'ST делает ползунки на четверть темнее выбранного цвета и ярче при наведении'),
        ]),

        group('thumb', 'Ползунки — кругляшок', [
            pair('Размер', 'tMin', 'tMax', 48, 'Первое — на телефоне, второе — на ПК'),
            row('Цвет', colorBtn('tColor', 'как в теме')),
            row('Форма', select('tShape', [['', 'как в теме'], ['circle', 'круг'], ['rounded', 'скруглённый квадрат'], ['square', 'квадрат']])),
            row('Обводка', slider('tBw', 0, 6, 'px', 'как в теме')),
            state.tBw ? row('Цвет обводки', colorBtn('tBc', 'цвет текста')) : null,
            check('tNoRing', 'Без обводки'),
            h('div.vte-bb-glyph-row', {}, [
                thumbPreview(),
                h('span.vte-bb-glyph-label', { text: state.tImg ? 'Своя картинка' : 'Картинка на кругляшке' }),
                h('button.vte-btn.vte-bb-glyph-btn', { type: 'button', on: { click: openGlyphPicker } }, [h('span', { text: state.tImg ? 'Сменить' : 'Выбрать' })]),
                state.tImg ? iconBtn('fa-rotate-left', 'Убрать картинку', () => {
                    setVal('tImg', '');
                    lastGlyph = null;
                    commit();
                    render();
                }, 'vte-tb-mini') : null,
            ]),
            lastGlyph && state.tImg ? row('Цвет значка', colorBtn('tGlyphColor', 'цвет текста')) : null,
            h('small.vte-note', { text: 'Значок Font Awesome, ссылка на картинку или код SVG. Картинка встаёт на кругляшок целиком.' }),
        ]),

        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', {
                type: 'button', title: 'Убрать всё, что это окно записало в тему. Останется оформление самой темы — не SillyTavern по умолчанию',
                on: { click: resetAll },
            }, [icon('fa-rotate-left'), h('span', { text: ' Сбросить все настройки окна' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Отменить всё, что сделано с момента открытия этого окна, — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
        h('small.vte-note.vte-foot-note', { text: '«Как было до открытия» — отменить всё, что сделано с момента открытия окна. «Сбросить все настройки окна» — убрать всё, что это окно когда-либо записало в тему: останется оформление самой темы.' }),
    ];
}

function thumbPreview() {
    const el = h('i.vte-bb-glyph-now');
    if (state.tImg) {
        el.style.cssText = `background:${urlOut(state.tImg)} center/contain no-repeat;`;
    } else {
        el.style.cssText = `background:${state.tColor || 'var(--vte-fg-dim)'};border-radius:50%;width:12px;height:12px;flex:0 0 12px;margin:0 5px`;
    }
    return el;
}

let themeOpen = false;
function themeSection() {
    const list = onThemeRules?.(['.drawer-content', ...KNOWN.map(k => `#${k[0]}`), '.menu_button', '[type="range"]']) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${plural(list.length)} про панели, кнопки и ползунки` })]));
    if (themeOpen) {
        box.append(...ruleRows(list, {
            h, icon, onReveal, onDeleteRule, onCleanOverridden,
            say: (t) => onToast?.(t),
        }));
    }
    return box;
}

function plural(n) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'правило';
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'правила';
    return 'правил';
}

function resetAll() {
    state = { ...defaults() };
    lastGlyph = null;
    commit();
    render();
    say('Панели, кнопки и ползунки снова как в теме');
}

/* ============================================================
   ЗНАЧОК НА КРУГЛЯШКЕ
============================================================ */
/* Шрифт Font Awesome картинке недоступен, а у кругляшка нет ::before.
   Поэтому значок рисуется один раз в маленькую PNG (64×64 — чётко и на
   экранах с двойной плотностью) и ставится фоном. */
const GLYPH_PX = 64;

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

let glyphPop = null;

function closeGlyphPicker() {
    glyphPop?.remove();
    glyphPop = null;
}

/** Картинка появилась впервые — кругляшок без своей заливки, рамки и
    скругления, чтобы картинку было видно целиком. Всё это видно в окне
    и меняется как обычно */
function imageDefaults() {
    if (state.tImg) return;
    if (!state.tColor) state.tColor = 'transparent';
    if (!state.tBw) state.tNoRing = true;
    if (!state.tShape) state.tShape = 'square';
}

async function openGlyphPicker() {
    closeGlyphPicker();
    let tb;
    try { tb = await import('./topBar.js'); await tb.loadIcons(); } catch { say('Список значков не загрузился'); return; }
    const icons = await tb.loadIcons();
    let query = '', cat = -1, shown = 0, found = [];

    const setImage = (img, text) => {
        imageDefaults();
        state.tImg = img;
        state.on = true;
        closeGlyphPicker();
        commit();
        render();
        say(`Кругляшок: ${text}`);
    };
    const setFa = async (g, name) => {
        if (!(await loadGlyphFont(g))) { say('Шрифт значков ещё не загрузился — попробуйте ещё раз'); return; }
        const png = glyphPng(g, state.tGlyphColor);
        if (!png) { say('Этот значок нарисовать не вышло'); return; }
        lastGlyph = g;
        setImage(png, name);
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
        type: 'text', placeholder: 'Поиск: сердце, star, gear…', spellcheck: false,
        on: { input: (e) => { query = e.target.value; run(); } },
    });
    const cats = h('select.vte-tb-select', { on: { change: (e) => { cat = +e.target.value; run(); } } },
        [h('option', { value: '-1', text: 'Все разделы' }), ...icons.cats.map((c, i) => h('option', { value: String(i), text: c.label }))]);
    const faPane = h('div.vte-tb-pane', {}, [
        h('div.vte-tb-pop-tools', {}, [search, cats, count]),
        grid,
        h('div.vte-note', { text: 'Значок станет картинкой цвета «Цвет значка» (его можно поменять потом).' }),
    ]);

    // Уже стоит картинка — сразу показываем её ссылку или код (PNG значка — нет смысла)
    const nowImg = /^data:image\/png/i.test(state.tImg) ? '' : state.tImg;
    const was = tb.imageFields ? tb.imageFields(nowImg) : { url: nowImg, code: '' };
    const url = h('input.vte-input', { type: 'text', spellcheck: false, placeholder: 'https://… ссылка на .svg / .png / .webp', value: was.url });
    const code = h('textarea.vte-input.vte-tb-svg', { spellcheck: false, placeholder: 'или вставьте код <svg>…</svg>', rows: 4 });
    code.value = was.code;
    url.addEventListener('input', () => { if (url.value.trim()) code.value = ''; });
    code.addEventListener('input', () => { if (code.value.trim()) url.value = ''; });
    const imgPane = h('div.vte-tb-pane.vte-tb-imgpane', { style: nowImg ? '' : 'display:none' }, [
        nowImg ? h('div.vte-note', { text: 'Сейчас стоит эта картинка — можно поправить или вставить другую.' }) : null,
        url, code,
        h('button.vte-btn.vte-btn-primary', {
            type: 'button',
            on: {
                click: () => {
                    let img = '';
                    if (code.value.trim()) {
                        img = svgData(code.value);
                        if (!img) { say('Это не похоже на код SVG'); return; }
                        if (img.length > 20000) { say('SVG тяжелее 20 КБ — для кругляшка это много'); return; }
                    } else if (/^https?:\/\/[^\s"'()<>\\]+$/i.test(url.value.trim())) {
                        img = url.value.trim();
                    } else { say('Вставьте ссылку http(s):// или код SVG'); return; }
                    lastGlyph = null;
                    setImage(img, 'своя картинка');
                },
            },
        }, [icon('fa-check'), h('span', { text: ' Поставить' })]),
        h('div.vte-note', { text: 'Ссылка работает с любого сайта — это фон, а не маска.' }),
    ]);
    const tab = (text, whichPane) => h('button.vte-tb-tab', {
        type: 'button',
        on: {
            click: (e) => {
                glyphPop.querySelectorAll('.vte-tb-tab').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                faPane.style.display = whichPane === 'fa' ? '' : 'none';
                imgPane.style.display = whichPane === 'img' ? '' : 'none';
            },
        },
    }, [h('span', { text })]);
    const tabFa = tab('Font Awesome', 'fa');
    const tabImg = tab('Ссылка / SVG', 'img');
    (nowImg ? tabImg : tabFa).classList.add('active');
    if (nowImg) faPane.style.display = 'none';
    glyphPop = h('div.vte-tb-pop', {}, [
        h('div.vte-tb-pop-head', {}, [h('span', { text: 'Картинка на кругляшке' }), iconBtn('fa-xmark', 'Закрыть', closeGlyphPicker, 'vte-tb-mini')]),
        h('div.vte-tb-tabs', {}, [tabFa, tabImg]),
        faPane, imgPane,
    ]);
    panel.appendChild(glyphPop);
    run();
    if (!nowImg) setTimeout(() => search.focus(), 0);
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
            change: () => { commit(); if (key === 'bw' || key === 'bBw' || key === 'rBw' || key === 'tBw') render(); },
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
    const LINK_KEY = `vte-pn-link-${aKey}`;
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

function colorBtn(key, emptyText) {
    const sw = h('span.vte-tb-swatch');
    const txt = h('span.vte-tb-swatch-txt');
    const paint = () => {
        const v = val(key);
        sw.style.background = v || '';
        sw.classList.toggle('vte-tb-swatch-empty', !v);
        txt.textContent = v ? '' : emptyText;
    };
    const btn = h('button.vte-tb-color', {
        type: 'button', title: 'Выбрать цвет',
        on: {
            click: () => {
                if (!picker) return;
                const before = val(key);
                const beforeImg = state.tImg;
                picker.open({
                    anchor: btn, value: (val(key) && val(key) !== 'transparent') ? val(key) : '#ffffff', allowGradient: false,
                    onChange: (v) => { setVal(key, v); paint(); preview(); },
                    onCommit: (v) => { setVal(key, v); paint(); commit(); render(); },
                    onCancel: () => { setVal(key, before); state.tImg = beforeImg; paint(); clearPreview(); },
                });
            },
        },
    }, [sw, txt]);
    const reset = iconBtn('fa-rotate-left', 'Убрать', () => { setVal(key, ''); paint(); commit(); render(); }, 'vte-tb-mini');
    paint();
    return h('span.vte-tb-colorwrap', {}, [btn, reset]);
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
