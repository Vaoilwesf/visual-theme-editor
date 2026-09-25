// modules/codeEditor.js
// Панель кода на CodeMirror 6.
//
// Снаружи модуль выглядит так же, как старый редактор на textarea:
// init, createPanel, showPanel, hidePanel, setContent, getContent,
// flushPending, hasPendingEdits, revealRange, revealLine, revealAutoBlock,
// clearFlash, setReadOnly, resetHistory, isOpen. index.js менять не нужно.
//
// Что даёт движок:
//  - рисуются только видимые строки, поэтому размер темы на скорость
//    набора почти не влияет;
//  - перенос строк, номера строк и каретка всегда совпадают с текстом;
//  - настоящий разбор CSS: подсветка понимает @media, вложенность и
//    значения без пробела после двоеточия;
//  - автодополнение свойств, значений и переменных из самой темы;
//  - сворачивание блоков, парные скобки, мультикурсор (Alt+клик).

import * as CM from './vendor/codemirror.js';

/* ============================================================
   НАСТРОЙКИ И СОСТОЯНИЕ
============================================================ */
let onCodeChange = () => {};
let onValidate = () => [];
// Общая история редактора. Если передана — Ctrl+Z в коде идёт в неё,
// а своей истории у панели нет. Две независимые истории расходились:
// отмена в одном окне создавала лишний шаг в другом.
let onUndo = null;
let onRedo = null;
let onOpenEditor = null;   // открыть окно редактора (свойства элемента)

let panel = null;
let view = null;
let statusEl = null;
let problemsEl = null;
let undoBtn = null;
let redoBtn = null;
let wrapBtn = null;

let readOnly = false;
let pending = false;        // в панели набран текст, который ещё не отдан наружу
let brokenWaited = false;   // уже подождали, пока допишут скобку
let changeTimer = null;
let flashTimer = null;

const CHANGE_DEBOUNCE = 500;
// Текст с незакрытой скобкой не применяем сразу: иначе посреди набора
// «.mes {» весь интерфейс ST разъезжается. Ждём дольше, потом применяем
// всё равно — вдруг так и задумано.
const BROKEN_WAIT = 3000;
const DIAG_DELAY = 700;
const DIAG_LIMIT = 1500000;  // проверка линейная: тема в 1 МБ проверяется за ~40 мс
const MATCH_LIMIT = 5000;

// Метки блока правок: новые короткие и старые длинные
const AUTO_MARKS = [
    ['/* ♡ Мои правки ♡ */', '/* ♡ конец правок ♡ */'],
    ['VTE:AUTO START', 'VTE:AUTO END'],
];

const INDENT = '    ';

// Изменение пришло снаружи (инспектор, откат темы) — не отправлять обратно
const External = CM.Annotation.define();

const wrapComp = new CM.Compartment();
const roComp = new CM.Compartment();
const langComp = new CM.Compartment();

/* Подсветка синтаксиса — это разбор всего CSS. На огромной теме разбор
   каждой правки съедал сотни миллисекунд: CodeMirror разбирает наперёд
   только ~100 КБ, а блок «Мои правки» лежит в самом конце, и после каждой
   правки его приходилось разбирать заново. Больше порога подсветку
   выключаем — текст, поиск и проверка ошибок остаются. Включить можно
   кликом по надписи в строке состояния. */
const HIGHLIGHT_LIMIT = 200000;
let highlightForced = false;
let highlightOn = true;

function syncHighlight() {
    if (!view) return;
    const want = highlightForced || view.state.doc.length <= HIGHLIGHT_LIMIT;
    if (want === highlightOn) return;
    highlightOn = want;
    view.dispatch({ effects: langComp.reconfigure(want ? CM.css() : []) });
    updateStats();
}
const historyComp = new CM.Compartment();

/* --- Запоминаемые настройки панели: тот же ключ, что у старой версии --- */
const UI_KEY = 'vte-code-ui-v2';
const UI_KEY_OLD = 'vte-code-ui';
const FS_MIN = 9;
const FS_MAX = 30;
const FS_DEFAULT = 12;

let ui = {
    fontSize: FS_DEFAULT,
    wrap: true,
    theme: 'default',        // тема панели кода: default | adaptive | rose
    collapsed: false,
    left: null,
    top: null,
    width: null,
    height: null,
};
let uiSaveTimer = null;

/* --- Поиск: переживает закрытие панели поиска --- */
let searchCase = false;
let searchRegex = false;
let lastFind = '';
let lastReplace = '';
let searchUi = null;        // живая панель поиска, если открыта

/* ============================================================
   МИНИ-ХЕЛПЕР DOM
============================================================ */
function h(tagSpec, attrs, children) {
    const idMatch = tagSpec.match(/#([\w-]+)/);
    const clsList = (tagSpec.match(/\.[\w-]+/g) || []).map(s => s.slice(1));
    const tag = (tagSpec.match(/^[\w-]+/) || ['div'])[0];

    const el = document.createElement(tag);
    if (idMatch) el.id = idMatch[1];
    if (clsList.length) el.className = clsList.join(' ');

    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'text') { el.textContent = v; continue; }
            if (k === 'style') { el.style.cssText = v; continue; }
            if (k === 'dataset') { Object.assign(el.dataset, v); continue; }
            if (k === 'on') {
                for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
                continue;
            }
            if (k in el && typeof el[k] !== 'object' && k !== 'list') {
                try { el[k] = v; continue; } catch {}
            }
            el.setAttribute(k, v === true ? '' : v);
        }
    }
    for (const c of [].concat(children || [])) {
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}

/* Няшные значки для темы «Сахарная роза». Рисуются только в ней,
   в остальных темах остаются обычные значки Font Awesome. */
const HEART = 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z';
const miniHeart = (x, y, k = 0.32) =>
    `<path transform="translate(${x} ${y}) scale(${k})" d="${HEART}" fill="currentColor" stroke="none"/>`;

const CUTE = {
    'fa-code': `<path d="${HEART}" fill="currentColor" fill-opacity=".18"/><path d="m9.6 10.2-1.8 1.9 1.8 1.9M14.4 10.2l1.8 1.9-1.8 1.9"/>`,
    'fa-rotate-left': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    'fa-rotate-right': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    'fa-magnifying-glass': `<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/>${miniHeart(7.2, 7.4)}`,
    'fa-magnifying-glass-minus': '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4M8 11h6"/>',
    'fa-magnifying-glass-plus': '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4M8 11h6M11 8v6"/>',
    'fa-arrow-down': `<path d="${HEART}"/><path d="M12 8.5v6.5M9.3 12.4l2.7 2.7 2.7-2.7"/>`,
    'fa-indent': '<path d="M4 6h16M11 12h9M11 18h9"/><path d="m4.5 10 3 2-3 2"/>',
    'fa-text-width': '<path d="M4 6h16M4 18h6"/><path d="M4 12h13a3 3 0 0 1 0 6h-3"/><path d="m16 16-2 2 2 2"/>',
    'fa-palette': '<path d="M12 12C10 8.5 6 6.5 4 7.5s-1 7 1.5 7.5S10 14 12 12z"/><path d="M12 12c2-3.5 6-5.5 8-4.5s1 7-1.5 7.5S14 14 12 12z"/><path d="M11 13.5 9 20.5M13 13.5l2 7"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
    'fa-copy': `<rect x="8" y="8" width="13" height="13" rx="3.5"/><path d="M16 8V6.5A3.5 3.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A3.5 3.5 0 0 0 6.5 16H8"/>${miniHeart(10.6, 10.9, 0.34)}`,
    'fa-window-minimize': '<path d="M6.5 13h11"/>',
    'fa-xmark': '<path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/>',
    'fa-font': '<path d="m5 19 7-14 7 14M8.2 13.5h7.6"/>',
    'fa-circle-check': `<path d="${HEART}" fill="currentColor" fill-opacity=".2"/><path d="m8.8 12.3 2.2 2.1 4.2-4.3"/>`,
    'fa-circle-minus': `<path d="${HEART}"/><path d="M9 12.5h6"/>`,
    'fa-triangle-exclamation': '<path d="M10.3 4 2 18.2A2 2 0 0 0 3.7 21h16.6a2 2 0 0 0 1.7-2.8L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17.2h.01"/>',
    'fa-chevron-up': '<path d="m6.5 15 5.5-5.5 5.5 5.5"/>',
    'fa-chevron-down': '<path d="m6.5 9 5.5 5.5L17.5 9"/>',
    'fa-arrow-right-arrow-left': '<path d="m16 3.5 4 3.5-4 3.5M20 7H5M8 13.5 4 17l4 3.5M4 17h15"/>',
    'fa-grip-lines-vertical': miniHeart(3, 3, 0.75),
};

/* Набор для «Лунного сна»: там, где у розы сердечки, — луна и звёзды */
const MOON = 'M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2z';
const STAR = (x, y, k = 0.3) =>
    `<path transform="translate(${x} ${y}) scale(${k})" d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21.2l1.6-7L2 9.5l7.1-.6z" fill="currentColor" stroke="none"/>`;

const DREAM = {
    ...CUTE,
    'fa-code': `<path d="${MOON}" fill="currentColor" fill-opacity=".18"/><path d="m8.6 11.2-1.8 1.9 1.8 1.9M13 11.2l1.8 1.9-1.8 1.9"/>`,
    'fa-magnifying-glass': `<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4-4"/>${STAR(7.4, 7.4, 0.31)}`,
    'fa-arrow-down': `<path d="${MOON}"/><path d="M11.5 8.5v6.5M8.8 12.4l2.7 2.7 2.7-2.7"/>`,
    'fa-palette': '<path d="M7 18.5a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.3 1.5 3.8 3.8 0 0 1-.4 7.5z"/><path d="M9.5 14h.01M13 14h.01"/>',
    'fa-copy': `<rect x="8" y="8" width="13" height="13" rx="3.5"/><path d="M16 8V6.5A3.5 3.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A3.5 3.5 0 0 0 6.5 16H8"/>${STAR(10.9, 10.9, 0.34)}`,
    'fa-circle-check': `<path d="${MOON}" fill="currentColor" fill-opacity=".2"/><path d="m7.8 12.3 2.2 2.1 4.2-4.3"/>`,
    'fa-circle-minus': `<path d="${MOON}"/><path d="M8 12.5h6"/>`,
    'fa-grip-lines-vertical': STAR(3, 3, 0.75),
};

function icon(name) {
    const cute = CUTE[name];
    const fa = `<i class="fa-solid ${name} vte-ic-fa"></i>`;
    if (!cute) return h('i', { className: `fa-solid ${name}` });
    const svg = (cls, body) => `<svg class="vte-ic-cute ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
        + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
    const wrap = h('span.vte-ic');
    // Оба набора лежат рядом, показывается тот, что подходит к теме, —
    // так смена темы не требует перерисовывать панель
    wrap.innerHTML = fa + svg('vte-ic-rose', cute) + svg('vte-ic-moon', DREAM[name] || cute);
    return wrap;
}

function iconBtn(faName, title, onClick, extraClass) {
    return h(`button.vte-code-btn${extraClass ? '.' + extraClass : ''}`, {
        type: 'button',
        title,
        on: { click: onClick },
    }, [icon(faName)]);
}

/* ============================================================
   ЗАПОМИНАНИЕ НАСТРОЕК ПАНЕЛИ
============================================================ */
let uiLoaded = false;

function ensureUi() {
    if (uiLoaded) return;
    uiLoaded = true;
    loadUi();
}

function loadUi() {
    try {
        const raw = localStorage.getItem(UI_KEY);
        if (raw) {
            Object.assign(ui, JSON.parse(raw) || {});
        } else {
            const old = localStorage.getItem(UI_KEY_OLD);
            if (old) {
                const prev = JSON.parse(old) || {};
                for (const k of ['fontSize', 'left', 'top', 'width', 'height']) {
                    if (prev[k] != null) ui[k] = prev[k];
                }
            }
            localStorage.removeItem(UI_KEY_OLD);
        }
    } catch {}

    const fs = Number(ui.fontSize);
    ui.fontSize = Number.isFinite(fs) ? Math.max(FS_MIN, Math.min(FS_MAX, fs)) : FS_DEFAULT;
    if (typeof ui.wrap !== 'boolean') ui.wrap = true;
    // Перенос строк теперь включён по умолчанию: один раз включаем его и тем,
    // у кого сохранилось «выключено». Дальше окно снова помнит выбор
    if (!ui.wrapDefaultOn) { ui.wrap = true; ui.wrapDefaultOn = 1; }
    if (!CODE_THEMES.some(t => t.id === ui.theme)) ui.theme = 'default';
    delete ui.forceHighlight;   // от старой версии: облегчённого режима больше нет
}

function saveUi() {
    clearTimeout(uiSaveTimer);
    uiSaveTimer = setTimeout(() => {
        try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch {}
    }, 250);
}

function applyFontSize() {
    if (!panel) return;
    panel.style.setProperty('--vte-code-fs', `${ui.fontSize}px`);
    panel.style.setProperty('--vte-code-lh', `${Math.round(ui.fontSize * 1.5)}px`);

    const label = panel.querySelector('#vte-code-zoom-val');
    if (label) label.textContent = `${ui.fontSize}px`;

    const range = panel.querySelector('#vte-code-zoom-range');
    if (range && Number(range.value) !== ui.fontSize) range.value = String(ui.fontSize);

    view?.requestMeasure();
}

function setFontSize(next, quiet) {
    const v = Math.max(FS_MIN, Math.min(FS_MAX, Math.round(next)));
    if (v === ui.fontSize) return;
    ui.fontSize = v;
    applyFontSize();
    saveUi();
    if (!quiet) flashStatus(`Шрифт ${v}px`);
}

function applyGeometry() {
    if (!panel || window.innerWidth <= 768) return;

    if (ui.width) panel.style.width = `${Math.max(340, ui.width)}px`;
    if (ui.height) panel.style.height = `${Math.max(220, ui.height)}px`;

    if (ui.left != null && ui.top != null) {
        const maxLeft = Math.max(0, window.innerWidth - 140);
        const maxTop = Math.max(0, window.innerHeight - 60);
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = `${Math.min(Math.max(0, ui.left), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, ui.top), maxTop)}px`;
    }
}

function rememberGeometry() {
    if (!panel || window.innerWidth <= 768) return;
    const r = panel.getBoundingClientRect();
    ui.left = Math.round(r.left);
    ui.top = Math.round(r.top);
    ui.width = Math.round(r.width);
    if (!panel.classList.contains('vte-code-collapsed')) {
        ui.height = Math.round(r.height);
    }
    saveUi();
}

/* ============================================================
   ОФОРМЛЕНИЕ РЕДАКТОРА
   Все цвета — CSS-переменные на самой панели. Тема панели кода просто
   подставляет свой набор значений, и перерисовывать редактор не нужно.
============================================================ */
const MONO = "'JetBrains Mono','Consolas','SF Mono',ui-monospace,monospace";

// Полупрозрачные оттенки акцента без отдельных переменных на каждый
const acc = (pct) => `color-mix(in srgb, var(--vte-accent) ${pct}%, transparent)`;

const vteTheme = CM.EditorView.theme({
    '&': {
        flex: '1',
        minWidth: '0',
        height: '100%',
        color: 'var(--cm-fg)',
        backgroundColor: 'var(--cm-bg)',
        fontSize: 'var(--vte-code-fs, 12px) !important',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        fontFamily: `${MONO} !important`,
        lineHeight: '1.5 !important',
        overflow: 'auto',
    },
    // Темы ST любят задавать шрифт и интервалы всем подряд — защищаемся
    '.cm-content, .cm-gutters, .cm-line, .cm-content *': {
        fontFamily: `${MONO} !important`,
        letterSpacing: 'normal !important',
        wordSpacing: 'normal !important',
        textTransform: 'none !important',
        textShadow: 'none !important',
        fontVariantLigatures: 'none',
    },
    '.cm-content': { caretColor: 'var(--cm-caret)', padding: '6px 0 40px' },
    '.cm-line': { padding: '0 10px 0 6px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cm-caret)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
        backgroundColor: acc(32),
    },
    '.cm-selectionBackground': { backgroundColor: acc(18) },
    '.cm-activeLine': { backgroundColor: 'var(--cm-active)' },
    '.cm-selectionMatch': { backgroundColor: acc(14) },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: acc(22),
        outline: `1px solid ${acc(55)}`,
    },
    '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
        backgroundColor: 'rgba(229, 96, 95, 0.25)',
    },

    '.cm-gutters': {
        backgroundColor: 'var(--cm-gutter-bg)',
        color: 'var(--cm-gutter-fg)',
        borderRight: '1px solid var(--vte-line-soft)',
    },
    // Узкая колонка номеров: только сами цифры и небольшой отступ
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 3px 0 6px', minWidth: '0' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--cm-active)', color: 'var(--cm-fg)' },
    '.cm-foldGutter .cm-gutterElement': {
        color: 'var(--cm-gutter-fg)', cursor: 'pointer', padding: '0 3px 0 0', fontSize: '0.85em',
    },
    '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--cm-fg)' },
    '.cm-foldPlaceholder': {
        backgroundColor: 'var(--vte-bg-raised)',
        border: '1px solid var(--vte-line-strong)',
        color: 'var(--vte-fg-dim)',
        padding: '0 5px',
        borderRadius: '4px',
    },

    // Поиск
    '.cm-panels': { backgroundColor: 'var(--vte-bg-soft)', color: 'var(--vte-fg)', border: 'none' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--vte-line-soft)' },
    '.cm-searchMatch': {
        backgroundColor: 'rgba(224, 164, 88, 0.22)',
        outline: '1px solid rgba(224, 164, 88, 0.5)',
        borderRadius: '2px',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: acc(45),
        outline: '1px solid var(--vte-accent)',
    },

    // Подсказки: автодополнение и ошибки
    '.cm-tooltip': {
        backgroundColor: 'var(--vte-bg-raised)',
        color: 'var(--vte-fg)',
        border: '1px solid var(--vte-line-strong)',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.45)',
        fontFamily: `${MONO} !important`,
        fontSize: 'var(--vte-code-fs, 12px)',
    },
    '.cm-tooltip-autocomplete > ul': { fontFamily: `${MONO} !important`, maxHeight: '14em' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: acc(28),
        color: 'var(--vte-fg)',
    },
    '.cm-completionIcon': { opacity: '0.6' },
    '.cm-completionDetail': { color: 'var(--vte-fg-mute)', fontStyle: 'normal' },
    '.cm-diagnostic': { padding: '4px 8px', fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" },
    '.cm-diagnostic-warning': { borderLeft: '3px solid #e0a458' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #e5605f' },
    '.cm-lintRange-warning': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy rgba(224, 164, 88, 0.8)',
        textUnderlineOffset: '3px',
    },
    '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy rgba(229, 96, 95, 0.9)',
        textUnderlineOffset: '3px',
    },

    // Свои слои
    '.vte-cm-auto': {
        backgroundColor: acc(5),
        boxShadow: `inset 2px 0 ${acc(55)}`,
    },
    '.vte-cm-flash': {
        backgroundColor: acc(16),
        boxShadow: 'inset 3px 0 var(--vte-accent)',
    },
    '.vte-cm-color': {
        borderBottom: '0.2em solid var(--tkc, transparent)',
        paddingBottom: '1px',
    },
}, { dark: true });

const vteHighlight = CM.HighlightStyle.define([
    { tag: CM.tags.blockComment, color: 'var(--tk-comment)', fontStyle: 'italic' },
    { tag: CM.tags.string, color: 'var(--tk-string)' },
    { tag: [CM.tags.definitionKeyword, CM.tags.keyword], color: 'var(--tk-keyword)' },
    { tag: CM.tags.variableName, color: 'var(--tk-variable)' },
    { tag: CM.tags.operatorKeyword, color: 'var(--tk-func)' },           // rgba(, var(, calc(
    { tag: CM.tags.modifier, color: 'var(--tk-important)' },             // !important
    { tag: CM.tags.color, color: 'var(--tk-color)' },
    { tag: [CM.tags.number, CM.tags.unit], color: 'var(--tk-number)' },
    { tag: CM.tags.constant(CM.tags.className), color: 'var(--tk-pseudo)' },   // :hover, ::before
    { tag: CM.tags.labelName, color: 'var(--tk-id)' },                   // #id и имена keyframes
    { tag: CM.tags.className, color: 'var(--tk-class)' },
    { tag: CM.tags.attributeName, color: 'var(--tk-attr)' },
    { tag: CM.tags.tagName, color: 'var(--tk-tag)' },
    { tag: CM.tags.propertyName, color: 'var(--tk-prop)' },
    { tag: CM.tags.atom, color: 'var(--tk-atom)' },
    { tag: [CM.tags.punctuation, CM.tags.separator, CM.tags.brace, CM.tags.paren,
        CM.tags.squareBracket, CM.tags.derefOperator, CM.tags.logicOperator,
        CM.tags.compareOperator, CM.tags.arithmeticOperator, CM.tags.definitionOperator],
      color: 'var(--tk-punct)' },
]);

/* ============================================================
   ТЕМЫ ПАНЕЛИ КОДА
============================================================ */
export const CODE_THEMES = [
    { id: 'default', name: 'Стандартная', hint: 'Тёмно-синяя, как у остальных панелей' },
    { id: 'adaptive', name: 'Под тему таверны', hint: 'Цвета берутся из текущей темы SillyTavern' },
    { id: 'rose', name: 'Пепельная роза ♡', hint: 'Серая с розовым текстом, мягкими углами и значками-сердечками' },
    { id: 'moon', name: 'Лунный сон ☾', hint: 'Серо-синяя (Paynes Grey) с жемчужным текстом, луной и звёздами' },
];

/* Стандартная: те же цвета, что были всегда */
const PALETTE_DEFAULT = {
    '--vte-bg': '#14161a', '--vte-bg-soft': '#191c21', '--vte-bg-raised': '#1e2228',
    '--vte-bg-inset': '#0f1114', '--vte-line': '#2a2f37', '--vte-line-soft': '#22262c',
    '--vte-line-strong': '#363d47', '--vte-fg': '#dfe4ea', '--vte-fg-dim': '#99a2ad',
    '--vte-fg-mute': '#6b7480', '--vte-accent': '#4ea1ff',
    '--vte-accent-soft': 'rgba(78, 161, 255, 0.14)',
    '--vte-ok': '#4ec97f', '--vte-warn': '#e0a458', '--vte-danger': '#e5605f',

    '--cm-bg': '#0f1114', '--cm-fg': '#c8cdd4', '--cm-caret': '#f0f3f6',
    '--cm-gutter-bg': '#0c0e10', '--cm-gutter-fg': '#4a525c',
    '--cm-active': 'rgba(255, 255, 255, 0.03)',

    '--tk-comment': '#5c6470', '--tk-string': '#c39a6b', '--tk-keyword': '#d38ad3',
    '--tk-variable': '#c48fe8', '--tk-func': '#63b8d8', '--tk-important': '#e5605f',
    '--tk-color': '#e0a458', '--tk-number': '#d8a35f', '--tk-pseudo': '#86c46f',
    '--tk-id': '#f0c674', '--tk-class': '#8fd07a', '--tk-attr': '#9ab8d8',
    '--tk-tag': '#e08c78', '--tk-prop': '#7fb8e8', '--tk-atom': '#c8cdd4',
    '--tk-punct': '#7d848f',
};

/* Графит и роза. Роза — только на акцентах и свойствах, остальное
   спокойное и разных оттенков, чтобы код не сливался в одно розовое */
const PALETTE_ROSE = {
    // Основа #333539, текст #CDBEC4. Рамка и шапка чуть темнее основы,
    // розовый акцент — на курсоре, выделении, свойствах и сердечках.
    '--vte-bg': '#333539', '--vte-bg-soft': '#2f3135', '--vte-bg-raised': '#2c2e32',
    '--vte-bg-inset': '#333539', '--vte-line': '#46444a', '--vte-line-soft': '#3d3c41',
    '--vte-line-strong': '#57515a', '--vte-fg': '#e3d6db', '--vte-fg-dim': '#b3a5ab',
    '--vte-fg-mute': '#8c8087', '--vte-accent': '#f4a6c6',
    '--vte-accent-soft': 'rgba(244, 166, 198, 0.16)',
    '--vte-ok': '#a8dcb4', '--vte-warn': '#f6c79a', '--vte-danger': '#ff8fa8',

    '--cm-bg': '#333539', '--cm-fg': '#cdbec4', '--cm-caret': '#ffb1d2',
    '--cm-gutter-bg': '#303236', '--cm-gutter-fg': '#7d7278',
    '--cm-active': 'rgba(244, 166, 198, 0.06)',

    '--tk-comment': '#958890', '--tk-string': '#efcaa8', '--tk-keyword': '#ff93c4',
    '--tk-variable': '#d4b8ff', '--tk-func': '#a7d7e6', '--tk-important': '#ff7f9f',
    '--tk-color': '#f7c1a4', '--tk-number': '#f7c1a4', '--tk-pseudo': '#cdb0ff',
    '--tk-id': '#ffd8a8', '--tk-class': '#e9c0ef', '--tk-attr': '#c2c9f3',
    '--tk-tag': '#f0adb5', '--tk-prop': '#f7a8cb', '--tk-atom': '#cdbec4',
    '--tk-punct': '#a0949a',
};

/* Лунный сон: Paynes Grey #536878 и Pearl #EAE0C8. Шапка и рамки — сам
   Paynes Grey, код — на его более глубоком оттенке, чтобы цвета читались.
   Акцент — лунное золото, остальное — пастель ночного неба */
const PALETTE_MOON = {
    '--vte-bg': '#536878', '--vte-bg-soft': '#4b5f6e', '--vte-bg-raised': '#5a7080',
    '--vte-bg-inset': '#3f5160', '--vte-line': '#6a8090', '--vte-line-soft': '#5e7484',
    '--vte-line-strong': '#8a9fae', '--vte-fg': '#eae0c8', '--vte-fg-dim': '#cfc6b0',
    '--vte-fg-mute': '#aeb4ac', '--vte-accent': '#f3d99b',
    '--vte-accent-soft': 'rgba(243, 217, 155, 0.16)',
    '--vte-ok': '#bfe3c8', '--vte-warn': '#f6d09a', '--vte-danger': '#ffadb3',

    '--cm-bg': '#3f5160', '--cm-fg': '#eae0c8', '--cm-caret': '#f3d99b',
    '--cm-gutter-bg': '#3a4b59', '--cm-gutter-fg': '#8d9ba4',
    '--cm-active': 'rgba(243, 217, 155, 0.07)',

    '--tk-comment': '#a9b6c0', '--tk-string': '#f2cfa6', '--tk-keyword': '#f3d99b',
    '--tk-variable': '#d6c4f5', '--tk-func': '#b3dcea', '--tk-important': '#ffb0b6',
    '--tk-color': '#f5c9b0', '--tk-number': '#f5c9b0', '--tk-pseudo': '#bfe5d8',
    '--tk-id': '#ffe6ad', '--tk-class': '#dccdf5', '--tk-attr': '#c9d6f5',
    '--tk-tag': '#f2c4b3', '--tk-prop': '#c8dcf2', '--tk-atom': '#eae0c8',
    '--tk-punct': '#b6c1c8',
};

/** Палитра темы по её id */
function paletteOf(id) {
    if (id === 'rose') return PALETTE_ROSE;
    if (id === 'moon') return PALETTE_MOON;
    if (id === 'adaptive') return buildAdaptivePalette() || PALETTE_DEFAULT;
    return PALETTE_DEFAULT;
}

/**
 * Цвета для маленького образца темы: шапка, фон кода, текст и два цвета
 * кода. Образец «Под тему таверны» считается из текущей темы ST.
 */
export function themeSwatch(id) {
    const p = paletteOf(id);
    return {
        head: p['--vte-bg-raised'], bg: p['--cm-bg'], fg: p['--cm-fg'],
        accent: p['--vte-accent'], a: p['--tk-prop'], b: p['--tk-string'],
    };
}

/** Мини-панель: полоска шапки и три строчки «кода» в цветах темы */
export function swatchEl(id) {
    const c = themeSwatch(id);
    const el = document.createElement('span');
    el.className = 'vte-theme-swatch';
    el.style.cssText = `--sw-head:${c.head};--sw-bg:${c.bg};--sw-fg:${c.fg};--sw-acc:${c.accent};--sw-a:${c.a};--sw-b:${c.b}`;
    el.innerHTML = '<i class="sw-head"></i><i class="sw-l1"></i><i class="sw-l2"></i><i class="sw-l3"></i>';
    return el;
}

/* ------------------------------------------------------------
   «Под тему таверны»: палитра считается из цветов SmartTheme.
   Фон — полупрозрачный оттенок панелей ST, наложенный на тёмную
   (или светлую) основу: размытия нет, а цвет узнаётся. Цвета кода —
   от акцента темы с поворотом оттенка, и каждый дотягивается до
   читаемого контраста с фоном.
------------------------------------------------------------ */
const colorProbe = () => colorProbe._el || (colorProbe._el = document.createElement('span'));

function toRgba(value) {
    const v = String(value || '').trim();
    if (!v) return null;

    // Частые случаи разбираем сами: ST хранит цвета темы как rgba(...),
    // а проба через DOM — это принудительный пересчёт стилей на каждый цвет
    let m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
        let a = m[4] == null ? 1 : parseFloat(m[4]);
        if (String(m[4]).endsWith('%')) a /= 100;
        return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    m = v.match(/^#([0-9a-f]{3,8})$/i);
    if (m && [3, 4, 6, 8].includes(m[1].length)) {
        let hx = m[1];
        if (hx.length <= 4) hx = [...hx].map(c => c + c).join('');
        return {
            r: parseInt(hx.slice(0, 2), 16), g: parseInt(hx.slice(2, 4), 16), b: parseInt(hx.slice(4, 6), 16),
            a: hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1,
        };
    }

    const probe = colorProbe();
    probe.style.color = '';
    probe.style.color = v;
    if (!probe.style.color) return null;
    // Вычисленный цвет нужен только для rgb(a); color-mix и прочее
    // браузер уже свернул в probe.style.color
    document.body.appendChild(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    const mm = out.match(/rgba?\(([^)]+)\)/);
    if (!mm) return null;
    const p = mm[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

const rgbStr = (c, a) => a == null || a >= 1
    ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
    : `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;

function over(top, base) {
    const a = top.a ?? 1;
    return {
        r: top.r * a + base.r * (1 - a),
        g: top.g * a + base.g * (1 - a),
        b: top.b * a + base.b * (1 - a),
        a: 1,
    };
}

function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
}

function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrast(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function toHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s, l };
}

function fromHsl({ h, s, l }) {
    h = ((h % 360) + 360) % 360 / 360;
    if (!s) return { r: l * 255, g: l * 255, b: l * 255, a: 1 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const t = (x) => {
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
    };
    return { r: t(h + 1 / 3) * 255, g: t(h) * 255, b: t(h - 1 / 3) * 255, a: 1 };
}

/** Сдвигать светлоту от фона, пока контраст не станет достаточным */
function readable(c, bg, min) {
    const hsl = toHsl(c);
    const up = lum(bg) < 0.4;   // тёмный фон — светлеем
    let cur = fromHsl(hsl);
    for (let i = 0; i < 40 && contrast(cur, bg) < min; i++) {
        hsl.l = Math.max(0, Math.min(1, hsl.l + (up ? 0.025 : -0.025)));
        cur = fromHsl(hsl);
    }
    return cur;
}

function shiftL(c, d) {
    const hsl = toHsl(c);
    hsl.l = Math.max(0, Math.min(1, hsl.l + d));
    return fromHsl(hsl);
}

function buildAdaptivePalette() {
    const root = getComputedStyle(document.documentElement);
    const v = (name) => toRgba(root.getPropertyValue(name));

    const body = v('--SmartThemeBodyColor');
    if (!body) return null;   // не SillyTavern или тема ещё не загружена

    const tint = v('--SmartThemeBlurTintColor') || v('--SmartThemeChatTintColor');
    const em = v('--SmartThemeEmColor');
    const quote = v('--SmartThemeQuoteColor');
    const underline = v('--SmartThemeUnderlineColor');
    const border = v('--SmartThemeBorderColor');

    const darkUi = lum(body) > 0.35;   // светлый текст — значит, тёмная тема
    const base = darkUi ? { r: 17, g: 18, b: 21, a: 1 } : { r: 246, g: 246, b: 247, a: 1 };
    let bg = tint ? over(tint, base) : base;

    // Фон должен оставаться фоном: если оттенок темы почти совпал с текстом,
    // уводим его к основе
    for (let i = 0; i < 10 && contrast(body, bg) < 7; i++) bg = mix(bg, base, 0.3);

    const d = darkUi ? 1 : -1;
    const inset = shiftL(bg, -0.03 * d);
    const fg = readable(body, inset, 7);

    // Акцент: подчёркивание, цитата или курсив — что из них цветное
    const colorful = [underline, quote, em].find(c => c && toHsl(c).s > 0.18);
    const accentBase = colorful || fromHsl({ h: 210, s: 0.7, l: 0.6 });
    const accent = readable(accentBase, bg, 3.2);

    const ah = toHsl(accentBase).h;
    const sat = Math.max(0.45, Math.min(0.75, toHsl(accentBase).s));
    const tone = (dh, s = sat) => readable(fromHsl({ h: ah + dh, s, l: darkUi ? 0.68 : 0.38 }), inset, 4.5);
    const own = (c, dh) => (c && toHsl(c).s > 0.18) ? readable(c, inset, 4.5) : tone(dh);

    const line = border ? over(border, bg) : mix(bg, fg, 0.14);

    return {
        '--vte-bg': rgbStr(bg),
        '--vte-bg-soft': rgbStr(shiftL(bg, 0.02 * d)),
        '--vte-bg-raised': rgbStr(shiftL(bg, 0.045 * d)),
        '--vte-bg-inset': rgbStr(inset),
        '--vte-line': rgbStr(mix(bg, line, 0.7)),
        '--vte-line-soft': rgbStr(mix(bg, line, 0.45)),
        '--vte-line-strong': rgbStr(line),
        '--vte-fg': rgbStr(fg),
        '--vte-fg-dim': rgbStr(readable(mix(fg, bg, 0.35), bg, 4.5)),
        '--vte-fg-mute': rgbStr(readable(mix(fg, bg, 0.55), bg, 3)),
        '--vte-accent': rgbStr(accent),
        '--vte-accent-soft': rgbStr(accent, 0.14),
        // Статусы тоже дотягиваем до контраста: на светлой теме
        // стандартный зелёный «Ошибок нет» почти не читался
        '--vte-ok': rgbStr(readable(fromHsl({ h: 145, s: 0.55, l: 0.55 }), bg, 3.5)),
        '--vte-warn': rgbStr(readable(fromHsl({ h: 35, s: 0.7, l: 0.6 }), bg, 3.5)),
        '--vte-danger': rgbStr(readable(fromHsl({ h: 0, s: 0.7, l: 0.62 }), bg, 3.5)),

        '--cm-bg': rgbStr(inset),
        '--cm-fg': rgbStr(fg),
        '--cm-caret': rgbStr(fg),
        '--cm-gutter-bg': rgbStr(shiftL(inset, -0.015 * d)),
        '--cm-gutter-fg': rgbStr(readable(mix(fg, inset, 0.6), inset, 2.6)),
        '--cm-active': rgbStr(fg, 0.04),

        '--tk-comment': rgbStr(readable(mix(fg, inset, 0.5), inset, 3)),
        '--tk-punct': rgbStr(readable(mix(fg, inset, 0.38), inset, 3.5)),
        '--tk-atom': rgbStr(fg),
        '--tk-prop': rgbStr(readable(accentBase, inset, 4.5)),
        '--tk-string': rgbStr(own(quote, 40)),
        '--tk-keyword': rgbStr(own(em, 300)),
        '--tk-class': rgbStr(tone(120)),
        '--tk-tag': rgbStr(tone(200)),
        '--tk-number': rgbStr(tone(35)),
        '--tk-color': rgbStr(tone(35)),
        '--tk-id': rgbStr(tone(60)),
        '--tk-variable': rgbStr(tone(270)),
        '--tk-func': rgbStr(tone(170)),
        '--tk-pseudo': rgbStr(tone(95)),
        '--tk-attr': rgbStr(tone(230, sat * 0.7)),
        '--tk-important': rgbStr(readable(fromHsl({ h: 355, s: 0.7, l: 0.6 }), inset, 4.5)),
    };
}

/* ------------------------------------------------------------
   Применение темы
------------------------------------------------------------ */
let themeObserver = null;
let themeTimer = null;

/* Все панели редактора, которые красит тема */
const THEMED_PANELS = '#vte-code-panel, #vte-inspector-panel, #vte-templates-panel, #vte-colorpicker, #vte-topbar-panel, #vte-fonts-panel, #vte-headers-panel, #vte-avatars-panel, #vte-bubbles-panel, #vte-gallery-panel, #vte-confirm';
let themeStyle = null;

/**
 * Тема применяется ко всем окнам редактора сразу: панели кода, свойств,
 * шаблонов, пипетке и топ-бару. Цвета — переменные в одном <style>,
 * поэтому окна, открытые позже, тоже получают тему без лишней работы.
 */
function applyCodeTheme() {
    ensureUi();
    const id = ui.theme || 'default';

    const palette = paletteOf(id);

    const body = Object.entries(palette).map(([k, v]) => `${k}:${v}`).join(';');
    // html :is(...) сильнее голого #id — порядок подключения стилей не важен
    const css = `html :is(${THEMED_PANELS}){${body}}`;

    if (!themeStyle) {
        themeStyle = document.createElement('style');
        themeStyle.id = 'vte-ui-theme';
    }
    // Последним в <head>: при той же специфичности побеждает объявленное позже
    if (themeStyle.parentNode !== document.head || document.head.lastElementChild !== themeStyle) {
        document.head.appendChild(themeStyle);
    }
    if (themeStyle.textContent !== css) themeStyle.textContent = css;

    document.documentElement.dataset.vteTheme = id;
    if (panel) panel.dataset.cmTheme = id;

    // «Под тему» следит за сменой темы ST: цвета SmartTheme ставятся
    // инлайном на <html>, а пользовательский CSS может их переопределить
    if (id === 'adaptive') watchStTheme();
    else { themeObserver?.disconnect(); themeObserver = null; }
}

/** Применить сохранённую тему окон при запуске, даже если код не открывали */
export function applyUiTheme() {
    applyCodeTheme();
}

/* Отпечаток цветов SmartTheme: пересобираем палитру, только если он изменился.
   Иначе каждая запись CSS (а за ней следим) пересчитывала бы палитру зря. */
let stSignature = '';
const ST_VARS = ['--SmartThemeBodyColor', '--SmartThemeBlurTintColor', '--SmartThemeChatTintColor',
    '--SmartThemeEmColor', '--SmartThemeQuoteColor', '--SmartThemeUnderlineColor', '--SmartThemeBorderColor'];

function readStSignature() {
    const cs = getComputedStyle(document.documentElement);
    return ST_VARS.map(v => cs.getPropertyValue(v).trim()).join('|');
}

function watchStTheme() {
    if (themeObserver) return;
    stSignature = readStSignature();
    const again = () => {
        clearTimeout(themeTimer);
        themeTimer = setTimeout(() => {
            if (ui.theme !== 'adaptive') return;
            const sig = readStSignature();
            if (sig === stSignature) return;
            stSignature = sig;
            applyCodeTheme();
        }, 400);
    };
    themeObserver = new MutationObserver(again);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const custom = document.getElementById('custom-style');
    if (custom) themeObserver.observe(custom, { childList: true, characterData: true, subtree: true });
}

export function getTheme() {
    ensureUi();
    return ui.theme || 'default';
}

export function setTheme(id) {
    if (!CODE_THEMES.some(t => t.id === id)) return;
    ensureUi();
    ui.theme = id;
    saveUi();
    applyCodeTheme();
    renderThemeMenu();
    // Плитки тем в настройках расширения — показать ту же тему
    document.dispatchEvent(new CustomEvent('vte-theme-changed', { detail: id }));
}

/* Меню тем в шапке панели */
let themeMenu = null;

function toggleThemeMenu(anchor) {
    if (themeMenu) { closeThemeMenu(); return; }
    themeMenu = h('div.vte-code-theme-menu');
    renderThemeMenu();
    panel.appendChild(themeMenu);

    const pr = panel.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    themeMenu.style.top = `${ar.bottom - pr.top + 4}px`;
    themeMenu.style.right = `${Math.max(6, pr.right - ar.right)}px`;

    setTimeout(() => document.addEventListener('pointerdown', outsideMenu, true), 0);
}

function outsideMenu(e) {
    if (themeMenu && !themeMenu.contains(e.target) && !e.target.closest?.('.vte-code-theme-btn')) {
        closeThemeMenu();
    }
}

function closeThemeMenu() {
    themeMenu?.remove();
    themeMenu = null;
    document.removeEventListener('pointerdown', outsideMenu, true);
}

function renderThemeMenu() {
    if (!themeMenu) return;
    themeMenu.textContent = '';
    const cur = getTheme();
    for (const t of CODE_THEMES) {
        // Мини-панель в настоящих цветах темы (у «Под тему таверны» — живых)
        const sample = swatchEl(t.id);
        themeMenu.appendChild(h(`button.vte-code-theme-item${t.id === cur ? '.active' : ''}`, {
            type: 'button',
            title: t.hint,
            on: { click: () => { setTheme(t.id); closeThemeMenu(); flashStatus(`Тема: ${t.name}`); } },
        }, [sample, h('span', { text: t.name })]));
    }
}

/* ============================================================
   ОБРАЗЦЫ ЦВЕТА ПОД ЗНАЧЕНИЯМИ
   MatchDecorator обходит только видимые строки и сам обновляет
   участки после правки — полного прохода по теме нет.
============================================================ */
const colorCache = new Map();

function isCssColor(value) {
    if (colorCache.has(value)) return colorCache.get(value);
    const probe = isCssColor._probe
        || (isCssColor._probe = document.createElement('span'));
    probe.style.color = '';
    probe.style.color = value;
    const ok = !!probe.style.color;
    if (colorCache.size > 800) colorCache.clear();
    colorCache.set(value, ok);
    return ok;
}

const colorMatcher = new CM.MatchDecorator({
    regexp: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\([^()\n]*\)/g,
    decoration: (m) => isCssColor(m[0])
        ? CM.Decoration.mark({ class: 'vte-cm-color', attributes: { style: `--tkc:${m[0]}` } })
        : null,
});

const colorChips = CM.ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = colorMatcher.createDeco(v); }
    update(u) { this.decorations = colorMatcher.updateDeco(u, this.decorations); }
}, { decorations: (p) => p.decorations });

/* ============================================================
   АВТО-БЛОК РАСШИРЕНИЯ
   Позиции маркеров ищем один раз, дальше просто сдвигаем их вслед
   за правками. Полный поиск — только если правка задела сам маркер.
============================================================ */
function findAuto(doc) {
    // Обычный поиск по строке: SearchCursor с нормализацией на теме в 400+ КБ
    // тратил ~60 мс, а блок правок почти всегда в самом конце
    const text = doc.toString();
    for (const [a, b] of AUTO_MARKS) {
        const s = text.lastIndexOf(a);
        if (s === -1) continue;
        const e = text.indexOf(b, s);
        return { s, e, lenS: a.length, lenE: b.length };
    }
    return null;
}

const overlaps = (a, b, c, d) => a <= d && b >= c;

const autoField = CM.StateField.define({
    create: (state) => findAuto(state.doc),
    update(val, tr) {
        if (!tr.docChanged) return val;

        let again = false;
        tr.changes.iterChanges((fA, tA, _fB, _tB, ins) => {
            if (again) return;
            if (val && overlaps(fA, tA, val.s - 1, val.s + val.lenS + 1)) again = true;
            else if (val && val.e >= 0 && overlaps(fA, tA, val.e - 1, val.e + val.lenE + 1)) again = true;
            else if (ins.length >= 12 && /♡ Мои правки|VTE:AUTO/.test(ins.toString())) again = true;
        });
        if (again) return findAuto(tr.newDoc);
        if (!val) return null;
        return {
            ...val,
            s: tr.changes.mapPos(val.s, 1),
            e: val.e < 0 ? -1 : tr.changes.mapPos(val.e, 1),
        };
    },
});

const autoLineDeco = CM.Decoration.line({ class: 'vte-cm-auto' });

const autoBlockLines = CM.ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = this.build(v); }
    update(u) {
        if (u.docChanged || u.viewportChanged
            || u.startState.field(autoField) !== u.state.field(autoField)) {
            this.decorations = this.build(u.view);
        }
    }
    build(v) {
        const a = v.state.field(autoField);
        if (!a) return CM.Decoration.none;
        const doc = v.state.doc;
        const first = doc.lineAt(a.s).number;
        const last = a.e < 0 ? doc.lines : doc.lineAt(a.e).number;

        const b = new CM.RangeSetBuilder();
        let done = 0;
        // Только видимые строки: авто-блок может занимать тысячи строк
        for (const { from, to } of v.visibleRanges) {
            const l1 = Math.max(first, doc.lineAt(from).number, done + 1);
            const l2 = Math.min(last, doc.lineAt(to).number);
            for (let n = l1; n <= l2; n++) {
                const line = doc.line(n);
                b.add(line.from, line.from, autoLineDeco);
                done = n;
            }
        }
        return b.finish();
    }
}, { decorations: (p) => p.decorations });

/* ============================================================
   ВСПЫШКА «ВОТ ЗДЕСЬ ТОЛЬКО ЧТО ИЗМЕНИЛОСЬ»
============================================================ */
const setFlash = CM.StateEffect.define();
const flashLineDeco = CM.Decoration.line({ class: 'vte-cm-flash' });

// Подсветка — список участков: { from, to } или [{ from, to }, …]
const flashField = CM.StateField.define({
    create: () => null,
    update(val, tr) {
        if (val && tr.docChanged) {
            // Ручная правка снимает подсветку, внешняя — сдвигает её
            if (!tr.annotation(External)) val = null;
            else {
                val = val.map(r => {
                    const from = tr.changes.mapPos(r.from, 1);
                    const to = tr.changes.mapPos(r.to, -1);
                    return to >= from ? { from, to } : null;
                }).filter(Boolean);
                if (!val.length) val = null;
            }
        }
        for (const e of tr.effects) {
            if (e.is(setFlash)) val = e.value ? [].concat(e.value) : null;
        }
        return val;
    },
});

const flashDeco = CM.EditorView.decorations.compute([flashField], (state) => {
    const val = state.field(flashField);
    if (!val) return CM.Decoration.none;
    const doc = state.doc;
    const lines = new Set();
    for (const r of val) {
        const l1 = doc.lineAt(Math.min(r.from, doc.length)).number;
        const l2 = Math.min(doc.lineAt(Math.min(r.to, doc.length)).number, l1 + 400);
        for (let n = l1; n <= l2; n++) lines.add(n);
    }
    const b = new CM.RangeSetBuilder();
    for (const n of [...lines].sort((x, y) => x - y)) b.add(doc.line(n).from, doc.line(n).from, flashLineDeco);
    return b.finish();
});

/* ============================================================
   ПРОВЕРКА ОШИБОК
   Встроенный линтер CodeMirror сам ждёт паузу в наборе и не
   запускается, пока текст не изменился.
============================================================ */
/* Проверка ошибок — это полный проход по всей теме. Если текст поменял
   не человек в панели, а инструмент редактора (ползунок, цвет, топ-бар),
   на большой теме не проверяем заново: сдвигаем прошлые отметки вслед за
   правкой. Раньше каждое движение ползунка на теме в 400+ КБ стоило ещё
   ~50 мс проверки сверху. */
const LINT_EXTERNAL_LIMIT = 120000;
let lintCache = null;   // { diags, changes } — changes: правки с прошлой проверки

function lintSource(v) {
    const doc = v.state.doc;
    if (doc.length > DIAG_LIMIT) {
        showDiagnostics(null);
        return [];
    }

    if (lintCache?.changes && doc.length > LINT_EXTERNAL_LIMIT) {
        const m = lintCache.changes;
        const moved = lintCache.diags.map(d => {
            const from = m.mapPos(d.from, 1);
            return { ...d, from, to: Math.max(from, m.mapPos(d.to, -1)) };
        });
        lintCache = { diags: moved, changes: null };
        return moved;
    }

    let errors = [];
    try { errors = onValidate(doc.toString()) || []; } catch { errors = []; }
    showDiagnostics(errors);

    const out = [];
    for (const err of errors) {
        if (!err.line || err.line < 1 || err.line > doc.lines) continue;
        const line = doc.line(err.line);
        // Подчёркиваем строку без ведущих пробелов
        const lead = /^\s*/.exec(line.text)[0].length;
        out.push({
            from: Math.min(line.from + lead, line.to),
            to: line.to,
            severity: 'warning',
            message: err.message,
        });
    }
    lintCache = { diags: out, changes: null };
    return out;
}

function showDiagnostics(errors) {
    if (!statusEl) return;
    const diag = statusEl.querySelector('#vte-code-diag');
    diag.textContent = '';

    if (errors === null) {
        diag.classList.remove('vte-code-diag-bad');
        diag.append(icon('fa-circle-minus'), h('span', { text: ' Проверка отключена' }));
        diag.title = `Файл больше ${Math.round(DIAG_LIMIT / 1024)} КБ — проверка ошибок не выполняется`;
        problemsEl.style.display = 'none';
        problemsEl.textContent = '';
        return;
    }
    diag.title = '';

    if (!errors.length) {
        diag.classList.remove('vte-code-diag-bad');
        diag.append(icon('fa-circle-check'), h('span', { text: ' Ошибок нет' }));
        problemsEl.style.display = 'none';
        problemsEl.textContent = '';
        return;
    }

    diag.classList.add('vte-code-diag-bad');
    diag.append(
        icon('fa-triangle-exclamation'),
        h('span', { text: ` ${errors.length} ${plural(errors.length, 'проблема', 'проблемы', 'проблем')}` })
    );

    problemsEl.textContent = '';
    problemsEl.style.display = 'block';
    for (const err of errors.slice(0, 30)) {
        problemsEl.appendChild(h('div.vte-code-problem', {
            on: { click: () => err.line && revealLine(err.line) },
        }, [
            h('span.vte-code-problem-ic', {}, [icon('fa-triangle-exclamation')]),
            err.line ? h('span.vte-code-problem-line', { text: `стр. ${err.line}` }) : null,
            h('span.vte-code-problem-msg', { text: err.message }),
        ]));
    }
}

/* ============================================================
   ПАНЕЛЬ ПОИСКА И ЗАМЕНЫ
   Своя разметка (та же, что раньше), а искать и подсвечивать
   совпадения поручено CodeMirror.
============================================================ */
function escapeRe(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
}

function buildQuery(term, rep) {
    if (!term) return new CM.SearchQuery({ search: '', caseSensitive: searchCase });

    if (searchRegex) {
        return new CM.SearchQuery({ search: term, regexp: true, caseSensitive: searchCase, replace: rep });
    }

    // Запрос из нескольких строк: отступы в начале и конце строк почти
    // всегда отличаются от исходника, поэтому сравниваем без них
    if (/\r?\n/.test(term)) {
        const lines = term.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (!lines.length) return new CM.SearchQuery({ search: '' });
        return new CM.SearchQuery({
            search: lines.map(escapeRe).join('[ \\t]*\\n[ \\t]*'),
            regexp: true,
            literal: true,
            caseSensitive: searchCase,
            replace: rep.replace(/\$/g, '$$$$'),   // замена — буквальный текст
        });
    }

    return new CM.SearchQuery({ search: term, literal: true, caseSensitive: searchCase, replace: rep });
}

function createSearchPanel(v) {
    const fieldKeys = (e, isFind) => {
        if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (isFind) (e.shiftKey ? CM.findPrevious : CM.findNext)(v);
            else if (!readOnly) (e.shiftKey ? doReplaceAll : doReplaceNext)();
            return;
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            // Ctrl+Enter — перенос строки: так ищем по нескольким строкам
            e.preventDefault();
            const el = e.target;
            const s = el.selectionStart, en = el.selectionEnd;
            el.value = el.value.slice(0, s) + '\n' + el.value.slice(en);
            el.setSelectionRange(s + 1, s + 1);
            autoGrow(el);
            if (isFind) commit(true);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSearch();
        }
    };

    const find = h('textarea#vte-code-find.vte-code-find-input', {
        rows: 1, wrap: 'off', spellcheck: false,
        placeholder: 'Найти… (Ctrl+Enter — новая строка)',
        'main-field': 'true',
        value: lastFind,
        on: {
            input: (e) => { autoGrow(e.target); commit(true); },
            keydown: (e) => fieldKeys(e, true),
        },
    });

    const replace = h('textarea#vte-code-replace.vte-code-find-input', {
        rows: 1, wrap: 'off', spellcheck: false,
        placeholder: 'Заменить на…',
        value: lastReplace,
        on: {
            input: (e) => { autoGrow(e.target); commit(false); },
            keydown: (e) => fieldKeys(e, false),
        },
    });

    const counter = h('span#vte-code-find-count.vte-code-find-count', { text: '0/0' });

    const toggle = (label, title, get, set) => {
        const b = h('button.vte-code-btn.vte-code-toggle', {
            type: 'button', title, text: label,
            on: { click: () => { set(!get()); b.classList.toggle('active', get()); commit(true); } },
        });
        b.classList.toggle('active', get());
        return b;
    };
    const caseBtn = toggle('Aa', 'Учитывать регистр', () => searchCase, (x) => { searchCase = x; });
    const regexBtn = toggle('.*', 'Регулярное выражение', () => searchRegex, (x) => { searchRegex = x; });

    const dom = h('div#vte-code-search.vte-code-search', {}, [
        h('div.vte-code-search-row', {}, [
            h('span.vte-code-find-ic', {}, [icon('fa-magnifying-glass')]),
            find,
            counter,
            caseBtn,
            regexBtn,
            iconBtn('fa-chevron-up', 'Предыдущее (Shift+Enter)', () => CM.findPrevious(v)),
            iconBtn('fa-chevron-down', 'Следующее (Enter)', () => CM.findNext(v)),
            iconBtn('fa-xmark', 'Закрыть поиск (Esc)', closeSearch, 'vte-code-btn-close'),
        ]),
        h('div.vte-code-search-row', {}, [
            h('span.vte-code-find-ic', {}, [icon('fa-arrow-right-arrow-left')]),
            replace,
            h('button.vte-code-btn.vte-code-btn-text', {
                type: 'button', title: 'Заменить текущее (Enter)', text: 'Заменить',
                on: { click: doReplaceNext },
            }),
            h('button.vte-code-btn.vte-code-btn-text', {
                type: 'button', title: 'Заменить все (Shift+Enter)', text: 'Все',
                on: { click: doReplaceAll },
            }),
        ]),
    ]);

    let ownQuery = null;
    let countRaf = 0;

    function commit(jump) {
        lastFind = find.value;
        lastReplace = replace.value;
        const q = buildQuery(find.value, replace.value);
        ownQuery = q;
        if (!q.eq(CM.getSearchQuery(v.state))) v.dispatch({ effects: CM.setSearchQuery.of(q) });
        if (jump) jumpNearest(q);
        scheduleCount();
    }

    // Пока печатаешь запрос, выделяется ближайшее совпадение от каретки,
    // а фокус остаётся в поле поиска
    function jumpNearest(q) {
        if (!q.valid || !q.search) return;
        const start = v.state.selection.main.from;
        let hit = q.getCursor(v.state, start).next();
        if (hit.done) hit = q.getCursor(v.state).next();
        if (hit.done) return;
        v.dispatch({
            selection: CM.EditorSelection.single(hit.value.from, hit.value.to),
            effects: CM.EditorView.scrollIntoView(hit.value.from, { y: 'center' }),
            userEvent: 'select.search',
        });
    }

    function scheduleCount() {
        if (countRaf) return;
        countRaf = requestAnimationFrame(() => { countRaf = 0; count(); });
    }

    function count() {
        const q = CM.getSearchQuery(v.state);
        if (!q.valid || !q.search) {
            counter.textContent = '0/0';
            counter.classList.toggle('vte-code-find-none', !!find.value);
            return;
        }
        const sel = v.state.selection.main;
        const cur = q.getCursor(v.state);
        let n = 0, idx = -1;
        for (let r = cur.next(); !r.done; r = cur.next()) {
            if (r.value.from === sel.from && r.value.to === sel.to) idx = n;
            n++;
            if (n >= MATCH_LIMIT) break;
        }
        counter.classList.toggle('vte-code-find-none', n === 0);
        counter.textContent = n
            ? `${idx >= 0 ? idx + 1 : '–'}/${n}${n >= MATCH_LIMIT ? '+' : ''}`
            : '0/0';
    }

    function doReplaceNext() {
        if (readOnly) return;
        commit(false);
        CM.replaceNext(v);
        scheduleCount();
        flashStatus('Заменено');
    }

    function doReplaceAll() {
        if (readOnly) return;
        commit(false);
        const q = CM.getSearchQuery(v.state);
        if (!q.valid || !q.search) return;
        let n = 0;
        const cur = q.getCursor(v.state);
        for (let r = cur.next(); !r.done; r = cur.next()) n++;
        if (!n) { flashStatus('Совпадений нет'); return; }
        CM.replaceAll(v);
        scheduleCount();
        flashStatus(`Заменено: ${n}`);
    }

    searchUi = {
        find,
        commit,
        setFromSelection(text) {
            if (text) {
                find.value = text;
                // Выделенный кусок ищем буквально, даже если включены регулярки
                if (searchRegex) {
                    searchRegex = false;
                    regexBtn.classList.remove('active');
                }
            }
            autoGrow(find);
            autoGrow(replace);
            commit(false);
            find.focus();
            find.select();
        },
    };

    return {
        dom,
        top: true,
        mount() {
            autoGrow(find);
            autoGrow(replace);
            commit(false);
            find.focus();
            find.select();
        },
        update(u) {
            for (const tr of u.transactions) {
                for (const e of tr.effects) {
                    // Запрос поменяли в обход наших полей (например, штатной
                    // командой) — показываем его в полях
                    if (e.is(CM.setSearchQuery) && ownQuery && !e.value.eq(ownQuery)) {
                        ownQuery = e.value;
                        find.value = e.value.search;
                        replace.value = e.value.replace;
                        searchCase = e.value.caseSensitive;
                        searchRegex = e.value.regexp && !e.value.literal;
                        caseBtn.classList.toggle('active', searchCase);
                        regexBtn.classList.toggle('active', searchRegex);
                    }
                }
            }
            if (u.docChanged || u.selectionSet) scheduleCount();
        },
        destroy() {
            cancelAnimationFrame(countRaf);
            searchUi = null;
        },
    };
}

function openSearch() {
    if (!view) return true;
    const sel = view.state.selection.main;
    const text = (!sel.empty && sel.to - sel.from <= 500)
        ? view.state.sliceDoc(sel.from, sel.to)
        : '';
    if (!CM.searchPanelOpen(view.state)) CM.openSearchPanel(view);
    searchUi?.setFromSelection(text);
    return true;
}

function closeSearch() {
    if (!view) return;
    CM.closeSearchPanel(view);
    view.focus();
}

function toggleSearch() {
    if (!view) return;
    if (CM.searchPanelOpen(view.state)) closeSearch();
    else openSearch();
}

/* ============================================================
   ФОРМАТИРОВАНИЕ
   Прежняя версия резала url(data:...;base64,...) по точке с запятой
   и меняла пробелы внутри строк content: "...". Теперь строки,
   комментарии и всё, что в скобках, переносятся как есть.
============================================================ */
function formatCss(src) {
    const out = [];
    let depth = 0;
    let paren = 0;
    let buf = '';
    let i = 0;

    const pad = () => INDENT.repeat(Math.max(0, depth));
    const addSpace = () => { if (buf && !buf.endsWith(' ')) buf += ' '; };

    // prop:value → prop: value. Трогаем только первое двоеточие вне скобок
    // и строк, и только у объявлений, а не у селекторов.
    const normDecl = (s) => {
        let q = null, p = 0;
        for (let k = 0; k < s.length; k++) {
            const c = s[k];
            if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
            if (c === '"' || c === "'") { q = c; continue; }
            if (c === '(') p++;
            else if (c === ')') p--;
            else if (c === ':' && p === 0) {
                const prop = s.slice(0, k).trim();
                if (!/^(--)?[\w-]+$/.test(prop)) return s;
                return `${prop}: ${s.slice(k + 1).trim()}`;
            }
        }
        return s;
    };

    const flushDecl = (withSemi) => {
        const t = buf.trim();
        buf = '';
        if (!t) return;
        out.push(pad() + normDecl(t) + (withSemi ? ';' : ''));
    };

    while (i < src.length) {
        const ch = src[i];

        // Комментарий
        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end === -1 ? src.length : end + 2;
            const text = src.slice(i, stop);
            if (!buf.trim()) {
                // Отдельной строкой. Многострочный комментарий не трогаем
                out.push(pad() + text.trim());
            } else {
                addSpace();
                buf += text;
            }
            i = stop;
            continue;
        }

        // Строка — копируем побайтно
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < src.length) {
                if (src[j] === '\\') { j += 2; continue; }
                if (src[j] === ch || src[j] === '\n') { j++; break; }
                j++;
            }
            buf += src.slice(i, j);
            i = j;
            continue;
        }

        if (/\s/.test(ch)) { addSpace(); i++; continue; }

        if (ch === '(') { paren++; buf += ch; i++; continue; }
        if (ch === ')') { paren = Math.max(0, paren - 1); buf += ch; i++; continue; }

        // Внутри скобок ; { } ничего не значат: url(data:...;base64,...)
        if (paren > 0) { buf += ch; i++; continue; }

        if (ch === '{') {
            const sel = buf.trim();
            buf = '';
            out.push(pad() + (sel ? sel + ' {' : '{'));
            depth++;
            i++;
            continue;
        }
        if (ch === ';') {
            flushDecl(true);
            i++;
            continue;
        }
        if (ch === '}') {
            // Последнее объявление без точки с запятой — дописываем её
            if (buf.trim()) flushDecl(/:/.test(buf));
            depth = Math.max(0, depth - 1);
            out.push(pad() + '}');
            if (depth === 0) out.push('');
            i++;
            continue;
        }

        buf += ch;
        i++;
    }
    if (buf.trim()) out.push(pad() + buf.trim());

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function format() {
    if (readOnly || !view) return;
    const src = view.state.doc.toString();
    const next = formatCss(src);
    if (next === src) { flashStatus('Уже отформатировано'); return; }
    replaceDoc(next, { userEvent: 'input.format' });
    flashStatus('Отформатировано');
}

/* ============================================================
   ЗАМЕНА ТЕКСТА С МИНИМАЛЬНОЙ ПРАВКОЙ
   Меняем только отличающийся кусок в середине: каретка, прокрутка
   и свёрнутые блоки остаются на месте, а шаг истории — маленький.
============================================================ */
function replaceDoc(next, { external = false, userEvent } = {}) {
    const cur = view.state.doc.toString();
    if (cur === next) return false;

    const min = Math.min(cur.length, next.length);
    let a = 0;
    while (a < min && cur.charCodeAt(a) === next.charCodeAt(a)) a++;
    let b = 0;
    while (b < min - a
        && cur.charCodeAt(cur.length - 1 - b) === next.charCodeAt(next.length - 1 - b)) b++;

    const annotations = [CM.isolateHistory.of('full')];
    if (external) annotations.push(External.of(true));
    // Первая загрузка темы в пустую панель — не шаг истории. Иначе первый
    // же Ctrl+Z «отменил» бы всю тему до пустого текста и записал его в ST.
    if (external && cur.length === 0) annotations.push(CM.Transaction.addToHistory.of(false));

    view.dispatch({
        changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) },
        annotations,
        userEvent: userEvent || (external ? 'external' : 'input'),
    });
    return true;
}

/* ============================================================
   СЛЕЖЕНИЕ ЗА ИЗМЕНЕНИЯМИ
============================================================ */
function onUpdate(u) {
    if (u.docChanged) {
        const fromHistory = u.transactions.some(t => t.isUserEvent('undo') || t.isUserEvent('redo'));
        const onlyExternal = u.transactions.every(t => !t.docChanged || t.annotation(External));

        // Для проверки ошибок: копим правки инструментов, ручной ввод — сброс
        if (lintCache) {
            if (onlyExternal) lintCache.changes = lintCache.changes ? lintCache.changes.composeDesc(u.changes.desc) : u.changes.desc;
            else lintCache = null;
        }

        if (fromHistory) {
            // Откат внутри панели: снаружи это НЕ новый шаг
            clearTimeout(changeTimer);
            changeTimer = null;
            pending = false;
            onCodeChange(u.state.doc.toString(), { fromHistory: true });
            markDirty(false);
        } else if (!onlyExternal) {
            pending = true;
            brokenWaited = false;
            markDirty(true);
            clearTimeout(changeTimer);
            // На большой теме каждое применение — это пересчёт всей таверны,
            // поэтому ждём паузу подольше
            const wait = u.state.doc.length > 150000 ? 1100 : CHANGE_DEBOUNCE;
            changeTimer = setTimeout(autoApply, wait);
            clearTimeout(flashTimer);
        }
        // Переключение подсветки — отдельной транзакцией после текущей
        queueMicrotask(syncHighlight);
        updateStats();
    }
    if (u.docChanged || u.selectionSet) updatePos();
    if (u.transactions.length) updateHistoryBtns();
}

function autoApply() {
    changeTimer = null;
    if (!view || !pending) return;
    if (!brokenWaited && !isBalanced(view.state.doc)) {
        brokenWaited = true;
        flashStatus('Не закрыта скобка или кавычка — применю после паузы');
        changeTimer = setTimeout(autoApply, BROKEN_WAIT);
        return;
    }
    applyNow();
}

/**
 * Быстрая проверка: все ли { } закрыты, нет ли оборванной строки или
 * комментария. Один линейный проход по кускам документа, без склейки
 * всего текста в одну строку.
 */
function isBalanced(doc) {
    let depth = 0;
    let quote = 0;       // код символа открытой кавычки
    let comment = false;
    let prev = 0;
    let escaped = false;

    for (const chunk of doc.iter()) {
        for (let i = 0; i < chunk.length; i++) {
            const c = chunk.charCodeAt(i);
            if (comment) {
                if (c === 47 && prev === 42) { comment = false; prev = 0; continue; }  // */
            } else if (quote) {
                if (escaped) escaped = false;
                else if (c === 92) escaped = true;                                      // \
                else if (c === quote) quote = 0;
                else if (c === 10) return false;                                        // строка оборвана переводом строки
            } else if (c === 42 && prev === 47) {                                       // /*
                comment = true; prev = 0; continue;
            } else if (c === 34 || c === 39) quote = c;
            else if (c === 123) depth++;
            else if (c === 125) { if (--depth < 0) return false; }
            prev = c;
        }
    }
    return depth === 0 && !quote && !comment;
}

function applyNow() {
    clearTimeout(changeTimer);
    changeTimer = null;
    if (!view) return;
    pending = false;
    onCodeChange(view.state.doc.toString());
    markDirty(false);
}

/* ============================================================
   СБОРКА РЕДАКТОРА
============================================================ */
function buildExtensions() {
    const ourKeys = [
        { key: 'Mod-s', preventDefault: true, run: () => { applyNow(); flashStatus('Применено'); return true; } },
        { key: 'Mod-f', preventDefault: true, run: openSearch },
        { key: 'Shift-Alt-f', preventDefault: true, run: () => { format(); return true; } },
        { key: 'Mod-=', preventDefault: true, run: () => { setFontSize(ui.fontSize + 1); return true; } },
        { key: 'Mod-+', preventDefault: true, run: () => { setFontSize(ui.fontSize + 1); return true; } },
        { key: 'Mod--', preventDefault: true, run: () => { setFontSize(ui.fontSize - 1); return true; } },
        { key: 'Mod-0', preventDefault: true, run: () => { setFontSize(FS_DEFAULT); return true; } },
    ];

    return [
        CM.lineNumbers({
            domEventHandlers: {
                // Клик по номеру выделяет строку, как раньше
                mousedown(v, line) {
                    v.dispatch({ selection: CM.EditorSelection.single(line.from, line.to) });
                    v.focus();
                    return true;
                },
            },
        }),
        CM.foldGutter({ openText: '▾', closedText: '▸' }),
        // Отдельная колонка под значки ошибок почти всегда пустая, а место
        // занимает постоянно. Ошибки и так подчёркнуты в тексте и собраны
        // в списке под кодом.
        CM.highlightActiveLineGutter(),
        CM.highlightSpecialChars(),
        historyComp.of(onUndo ? [] : CM.history()),
        CM.drawSelection(),
        CM.dropCursor(),
        CM.EditorState.allowMultipleSelections.of(true),
        CM.indentOnInput(),
        CM.indentUnit.of(INDENT),
        CM.EditorState.tabSize.of(4),
        CM.syntaxHighlighting(vteHighlight),
        CM.bracketMatching(),
        CM.closeBrackets(),
        CM.autocompletion({ icons: false, activateOnTypingDelay: 120 }),
        CM.rectangularSelection(),
        CM.crosshairCursor(),
        CM.highlightActiveLine(),
        CM.highlightSelectionMatches({ minSelectionLength: 2, maxMatches: 300 }),
        langComp.of(CM.css()),
        CM.search({
            top: true,
            createPanel: createSearchPanel,
            scrollToMatch: (range) => CM.EditorView.scrollIntoView(range, { y: 'center' }),
        }),
        CM.linter(lintSource, { delay: DIAG_DELAY }),
        colorChips,
        autoField,
        autoBlockLines,
        flashField,
        flashDeco,
        wrapComp.of(ui.wrap ? CM.EditorView.lineWrapping : []),
        roComp.of(CM.EditorState.readOnly.of(readOnly)),
        CM.keymap.of([
            ...ourKeys,
            ...CM.closeBracketsKeymap,
            ...CM.defaultKeymap,
            ...CM.searchKeymap,
            ...historyKeys(),
            ...CM.foldKeymap,
            CM.indentWithTab,
        ]),
        CM.EditorView.contentAttributes.of({
            spellcheck: 'false',
            autocorrect: 'off',
            autocapitalize: 'off',
            translate: 'no',
        }),
        vteTheme,
        CM.EditorView.updateListener.of(onUpdate),
    ];
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================ */
export function init(options = {}) {
    onCodeChange = options.onCodeChange || (() => {});
    onValidate = options.onValidate || (() => []);
    onUndo = typeof options.onUndo === 'function' ? options.onUndo : null;
    onOpenEditor = typeof options.onOpenEditor === 'function' ? options.onOpenEditor : null;
    onRedo = typeof options.onRedo === 'function' ? options.onRedo : null;
}

function historyKeys() {
    if (!onUndo) return CM.historyKeymap;
    const u = () => { onUndo(); return true; };
    const r = () => { (onRedo || (() => {}))(); return true; };
    return [
        { key: 'Mod-z', run: u, preventDefault: true },
        { key: 'Mod-y', run: r, preventDefault: true },
        { key: 'Mod-Shift-z', run: r, preventDefault: true },
    ];
}

function doUndo() {
    if (onUndo) { onUndo(); return; }
    if (view && !CM.undo(view)) flashStatus('Отменять больше нечего');
}

function doRedo() {
    if (onRedo) { onRedo(); return; }
    if (view && !CM.redo(view)) flashStatus('Возвращать нечего');
}

/** Состояние кнопок, когда история общая и живёт снаружи */
export function setHistoryState(canUndo, canRedo) {
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
}

export function createPanel() {
    if (panel) {
        panel.style.display = 'flex';
        return panel;
    }

    ensureUi();
    panel = h('div#vte-code-panel.vte-code-panel.vte-code-cm');

    const title = h('div.vte-code-title', {}, [
        h('span.vte-code-logo', {}, [icon('fa-code')]),
        h('span', { text: 'custom.css' }),
        h('span#vte-code-dirty.vte-code-dirty', { text: '' }),
    ]);

    undoBtn = iconBtn('fa-rotate-left', 'Отменить (Ctrl+Z)', doUndo);
    redoBtn = iconBtn('fa-rotate-right', 'Вернуть (Ctrl+Shift+Z)', doRedo);
    undoBtn.disabled = true;
    redoBtn.disabled = true;

    const zoom = h('div.vte-code-zoom', {}, [
        iconBtn('fa-magnifying-glass-minus', 'Мельче (Ctrl+-)', () => setFontSize(ui.fontSize - 1)),
        h('span#vte-code-zoom-val.vte-code-zoom-val', {
            title: 'Сбросить масштаб (Ctrl+0)',
            text: `${ui.fontSize}px`,
            on: { click: () => setFontSize(FS_DEFAULT) },
        }),
        iconBtn('fa-magnifying-glass-plus', 'Крупнее (Ctrl+=)', () => setFontSize(ui.fontSize + 1)),
    ]);

    wrapBtn = iconBtn('fa-text-width', 'Перенос строк', toggleWrap);

    const controls = h('div.vte-code-controls', {}, [
        undoBtn,
        redoBtn,
        h('span.vte-code-sep'),
        zoom,
        h('span.vte-code-sep'),
        iconBtn('fa-arrow-down', 'К блоку «Мои правки»', () => revealAutoBlock({ focus: true })),
        iconBtn('fa-magnifying-glass', 'Поиск и замена (Ctrl+F)', toggleSearch),
        iconBtn('fa-indent', 'Форматировать (Shift+Alt+F)', format),
        wrapBtn,
        iconBtn('fa-palette', 'Тема панели кода', (e) => toggleThemeMenu(e.currentTarget), 'vte-code-theme-btn'),
        onOpenEditor ? iconBtn('fa-wand-magic-sparkles', 'Открыть окно редактора', () => onOpenEditor()) : null,
        iconBtn('fa-copy', 'Скопировать всё', copyAll),
        iconBtn('fa-window-minimize', 'Свернуть', toggleCollapse),
        iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-code-btn-close'),
    ]);

    const header = h('div#vte-code-header.vte-code-header', {}, [title, controls]);

    const body = h('div.vte-code-body');
    problemsEl = h('div#vte-code-problems.vte-code-problems', { style: 'display:none' });

    const zoomRange = h('input#vte-code-zoom-range.vte-code-zoom-range', {
        type: 'range',
        min: String(FS_MIN), max: String(FS_MAX), step: '1',
        value: String(ui.fontSize),
        title: 'Размер шрифта',
        on: { input: (e) => setFontSize(Number(e.target.value), true) },
    });

    statusEl = h('div.vte-code-status', {}, [
        h('span#vte-code-pos.vte-code-status-item', { text: 'Стр 1, Кол 1' }),
        h('span#vte-code-stats.vte-code-status-item', { text: '0 строк' }),
        h('span.vte-code-status-spacer'),
        h('span.vte-code-zoom-wrap', {}, [icon('fa-font'), zoomRange]),
        h('span#vte-code-diag.vte-code-status-item.vte-code-diag', {}, [
            icon('fa-circle-check'),
            h('span', { text: ' Ошибок нет' }),
        ]),
        h('span.vte-code-status-item', { text: 'CSS' }),
    ]);

    panel.append(header, body, problemsEl, statusEl);
    statusEl.querySelector('#vte-code-stats').addEventListener('click', () => {
        if (highlightOn) return;
        highlightForced = true;
        syncHighlight();
        flashStatus('Подсветка включена — на такой большой теме может подтормаживать');
    });
    document.body.appendChild(panel);

    view = new CM.EditorView({
        state: CM.EditorState.create({ doc: '', extensions: buildExtensions() }),
        parent: body,
    });

    // Ctrl+колесо — масштаб. Слушатель не пассивный, иначе браузер
    // не даст отменить свой зум страницы.
    body.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setFontSize(ui.fontSize + (e.deltaY < 0 ? 1 : -1), true);
    }, { passive: false });

    makeDraggable(panel, header);
    makeResizable(panel);
    shield(panel);

    applyFontSize();
    applyCodeTheme();
    applyGeometry();
    wrapBtn.classList.toggle('active', ui.wrap);
    if (ui.collapsed) panel.classList.add('vte-code-collapsed');

    window.addEventListener('resize', () => applyGeometry());

    return panel;
}

/**
 * Сдвинуть панель кода (нужно присоединённому окну редактора: его шапку
 * тянут — едут оба). save=true — запомнить положение.
 */
export function moveTo(left, top, save) {
    if (!panel) return;
    if (left != null && top != null) {
        const maxLeft = Math.max(0, window.innerWidth - 140);
        const maxTop = Math.max(0, window.innerHeight - 60);
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
    }
    if (save) rememberGeometry();
}

export function hidePanel() {
    closeThemeMenu();
    if (panel) panel.style.display = 'none';
}

export function showPanel() {
    if (!panel) createPanel();
    panel.style.display = 'flex';
    // Пока панель была скрыта, размеры не измерялись
    view?.requestMeasure();
    // Тему ST могли сменить, пока панель была закрыта
    if (ui.theme === 'adaptive') applyCodeTheme();
}

/* ============================================================
   ЗНАЧЕНИЕ
============================================================ */
export function setContent(css) {
    if (!panel) createPanel();
    const next = css || '';

    replaceDoc(next, { external: true });

    // Текст в панели снова совпадает с темой
    clearTimeout(changeTimer);
    changeTimer = null;
    pending = false;
    markDirty(false);
}

/** Есть ли в панели набранный текст, который ещё не применён к теме */
export function hasPendingEdits() {
    return !!view && pending;
}

/**
 * Применить набранный текст немедленно, не дожидаясь задержки.
 * Нужно перед любой записью CSS со стороны панели свойств: иначе
 * setContent затрёт то, что человек только что напечатал.
 */
export function flushPending() {
    if (!hasPendingEdits()) return false;
    applyNow();
    return true;
}

export function getContent() {
    return view ? view.state.doc.toString() : '';
}

export function isOpen() {
    return !!panel && panel.style.display !== 'none';
}

export function setReadOnly(v) {
    readOnly = !!v;
    view?.dispatch({ effects: roComp.reconfigure(CM.EditorState.readOnly.of(readOnly)) });
}

/** Сбросить историю: нужно при полной перезагрузке темы */
export function resetHistory() {
    if (!view || onUndo) return;
    view.dispatch({ effects: historyComp.reconfigure([]) });
    view.dispatch({ effects: historyComp.reconfigure(CM.history()) });
    updateHistoryBtns();
}

/* ============================================================
   НАВИГАЦИЯ
============================================================ */
/** Прокрутить к строке. focus=false — не забирать фокус у ползунков */
export function revealLine(line, opts = {}) {
    if (!view) return;
    const doc = view.state.doc;
    const n = Math.max(1, Math.min(doc.lines, line | 0));
    const l = doc.line(n);

    const spec = { effects: CM.EditorView.scrollIntoView(l.from, { y: 'center' }) };
    if (opts.focus !== false) spec.selection = CM.EditorSelection.single(l.from, l.to);
    view.dispatch(spec);
    if (opts.focus !== false) view.focus();
}

/** Прыгнуть к авто-блоку расширения */
export function revealAutoBlock(opts = {}) {
    if (!view) return false;
    const a = view.state.field(autoField);
    if (!a) {
        flashStatus('Блока «Мои правки» пока нет');
        return false;
    }
    revealLine(view.state.doc.lineAt(a.s).number, { focus: opts.focus === true });
    return true;
}

/**
 * Подсветить участок, который только что изменился. Вызывается из
 * index.js после записи в CSS.
 * @param from  индекс первого символа участка
 * @param to    индекс последнего символа участка
 * @param opts  { focus: false, hold: 3000 }
 */
export function revealRange(from, to, opts = {}) {
    if (!view || !isOpen()) return;

    const len = view.state.doc.length;
    const a = Math.max(0, Math.min(len, from | 0));
    const b = Math.max(a, Math.min(len, to | 0));

    const spec = {
        effects: [
            setFlash.of({ from: a, to: b }),
            CM.EditorView.scrollIntoView(CM.EditorSelection.range(a, b), { y: 'center' }),
        ],
    };
    if (opts.focus === true) spec.selection = CM.EditorSelection.single(a, b);
    view.dispatch(spec);
    if (opts.focus === true) view.focus();

    clearTimeout(flashTimer);
    flashTimer = setTimeout(clearFlash, opts.hold != null ? opts.hold : 3000);
}

/**
 * Подсветить сразу несколько мест (например, все строки темы, которые
 * меняют один значок). Прокрутка — к первому, стрелки ↑↓ в статусе не нужны:
 * все места видны полосой у номеров строк.
 */
export function revealRanges(list, opts = {}) {
    if (!view || !isOpen() || !list?.length) return;
    const len = view.state.doc.length;
    const clean = list
        .map(r => ({ from: Math.max(0, Math.min(len, r.from | 0)), to: Math.max(0, Math.min(len, r.to | 0)) }))
        .sort((a, b) => a.from - b.from);
    const first = clean[0];
    view.dispatch({
        effects: [
            setFlash.of(clean),
            CM.EditorView.scrollIntoView(CM.EditorSelection.range(first.from, first.to), { y: 'center' }),
        ],
        selection: opts.focus ? CM.EditorSelection.single(first.from, first.to) : undefined,
    });
    if (opts.focus) view.focus();
    flashStatus(`Подсвечено мест: ${clean.length}`);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(clearFlash, opts.hold != null ? opts.hold : 6000);
}

export function clearFlash() {
    clearTimeout(flashTimer);
    if (view && view.state.field(flashField)) {
        view.dispatch({ effects: setFlash.of(null) });
    }
}

/* ============================================================
   ПРОЧИЕ ДЕЙСТВИЯ
============================================================ */
function copyAll() {
    navigator.clipboard?.writeText(getContent())
        .then(() => flashStatus('Скопировано в буфер'))
        .catch(() => flashStatus('Не удалось скопировать'));
}

function toggleWrap() {
    ui.wrap = !ui.wrap;
    view?.dispatch({ effects: wrapComp.reconfigure(ui.wrap ? CM.EditorView.lineWrapping : []) });
    wrapBtn?.classList.toggle('active', ui.wrap);
    saveUi();
    flashStatus(ui.wrap ? 'Перенос строк включён' : 'Перенос строк выключен');
}

function toggleCollapse() {
    panel.classList.toggle('vte-code-collapsed');
    ui.collapsed = panel.classList.contains('vte-code-collapsed');
    saveUi();
    if (!ui.collapsed) view?.requestMeasure();
}

function markDirty(v) {
    const dot = panel?.querySelector('#vte-code-dirty');
    if (dot) dot.textContent = v ? '●' : '';
}

function flashStatus(text) {
    const el = statusEl?.querySelector('#vte-code-stats');
    if (!el) return;
    el.textContent = text;
    el.classList.add('vte-code-flash');
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => {
        el.classList.remove('vte-code-flash');
        updateStats();
    }, 1600);
}

function updateStats() {
    const el = statusEl?.querySelector('#vte-code-stats');
    if (!el || !view || el.classList.contains('vte-code-flash')) return;
    // Число строк и длина у CodeMirror хранятся готовыми — это бесплатно
    const doc = view.state.doc;
    const kb = (doc.length / 1024).toFixed(1);
    el.textContent = `${doc.lines} ${plural(doc.lines, 'строка', 'строки', 'строк')} · ${kb} КБ`
        + (highlightOn ? '' : ' · без подсветки');
    el.title = highlightOn ? '' : 'Тема очень большая — подсветка выключена, чтобы не тормозило. Клик — включить';
    el.style.cursor = highlightOn ? '' : 'pointer';
}

function updatePos() {
    const el = statusEl?.querySelector('#vte-code-pos');
    if (!el || !view) return;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    const col = sel.head - line.from + 1;
    const selLen = sel.to - sel.from;
    const multi = view.state.selection.ranges.length;
    el.textContent = `Стр ${line.number}, Кол ${col}`
        + (selLen ? ` (выделено ${selLen})` : '')
        + (multi > 1 ? ` · курсоров: ${multi}` : '');
}

function updateHistoryBtns() {
    if (!view || onUndo) return;   // общая история: кнопки ведёт index.js
    if (undoBtn) undoBtn.disabled = CM.undoDepth(view.state) === 0;
    if (redoBtn) redoBtn.disabled = CM.redoDepth(view.state) === 0;
}

/* ============================================================
   ПЕРЕТАСКИВАНИЕ И РАЗМЕР
============================================================ */
function makeDraggable(box, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, active = false;

    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.vte-code-btn')) return;
        if (e.target.closest('.vte-code-zoom')) return;
        active = true;
        const r = box.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        box.style.left = `${ox}px`;
        box.style.top = `${oy}px`;
        handle.setPointerCapture(e.pointerId);
        box.classList.add('vte-dragging');
    });

    handle.addEventListener('pointermove', (e) => {
        if (!active) return;
        const nx = Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
        const ny = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
        box.style.left = `${nx}px`;
        box.style.top = `${ny}px`;
    });

    const stop = () => {
        if (!active) return;
        active = false;
        box.classList.remove('vte-dragging');
        rememberGeometry();
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
}

function makeResizable(box) {
    const grip = h('div.vte-code-resize', {}, [icon('fa-grip-lines-vertical')]);
    box.appendChild(grip);

    let sw = 0, sh = 0, sx = 0, sy = 0, active = false;

    grip.addEventListener('pointerdown', (e) => {
        active = true;
        const r = box.getBoundingClientRect();
        sw = r.width; sh = r.height; sx = e.clientX; sy = e.clientY;
        grip.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    // Размер редактора CodeMirror отслеживает сам, пересчитывать ничего не нужно
    grip.addEventListener('pointermove', (e) => {
        if (!active) return;
        box.style.width = `${Math.max(340, sw + e.clientX - sx)}px`;
        box.style.height = `${Math.max(220, sh + e.clientY - sy)}px`;
    });

    const stop = () => {
        if (!active) return;
        active = false;
        rememberGeometry();
    };
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
}

/**
 * ST закрывает свои панели по клику вне них и ловит клавиши на document
 * (стрелка вверх — правка последнего сообщения и т.п.). Всплытие из
 * панели гасим. CodeMirror к этому моменту событие уже обработал:
 * его слушатели висят глубже, на самом редакторе.
 */
function shield(el) {
    ['mousedown', 'touchstart', 'pointerdown', 'click', 'keydown', 'keyup', 'keypress'].forEach(type =>
        el.addEventListener(type, (e) => e.stopPropagation()));
}

/* ============================================================
   УТИЛИТЫ
============================================================ */
function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}
