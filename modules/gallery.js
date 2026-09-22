// modules/gallery.js
// «Боты и персоны ♡»: галерея персонажей, карточки, теги, блок персон
// и быстрые аватарки (hotswap).
//
// Что пишется в CSS (раздел «Персонажи ♡» блока «Мои правки»):
//   #rm_print_characters_block            — сетка карточек;
//   … .character_select                   — сама карточка;
//   … .character_select .avatar / img     — аватар на всю карточку;
//   … .character_select_container         — плашка с именем;
//   … .tag                                — теги на карточке;
//   #user_avatar_block …                  — персоны;
//   .hotswap .avatar, .avatars_inline …   — быстрые аватарки.
//
// Почему карточки перестают «растягиваться» при фильтре по тегу:
// у карточки нет своей высоты, и в сетке строка растягивается по самой
// высокой. Задаём карточке пропорции (aspect-ratio) и выравнивание по
// верху — тогда при любом числе карточек они одинаковые.

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

const SEL = {
    grid: '#rm_print_characters_block',
    card: '#rm_print_characters_block .character_select',
    av: '#rm_print_characters_block .character_select .avatar',
    img: '#rm_print_characters_block .character_select .avatar img',
    info: '#rm_print_characters_block .character_select_container',
    name: '#rm_print_characters_block .ch_name, #rm_print_characters_block .name_text',
    desc: '#rm_print_characters_block .ch_description',
    extra: '#rm_print_characters_block .ch_additional_info:not(.ch_fav_icon)',
    tag: '#rm_print_characters_block .tag',
    tagName: '#rm_print_characters_block .tag .tag_name',
    persona: '#user_avatar_block',
    personaCard: '#user_avatar_block .avatar-container',
    personaAv: '#user_avatar_block .avatar',
    personaImg: '#user_avatar_block .avatar img',
    quick: '.hotswap .avatar, .avatars_inline .avatar',
    quickImg: '.hotswap .avatar img, .avatars_inline .avatar img',
    quickWrap: '.hotswap, .avatars_inline, #rm_print_characters_block',
};

const VW_MIN = 360;
const VW_MAX = 1280;

const RATIOS = [
    ['', 'как в теме'],
    ['1 / 1', 'квадрат'],
    ['4 / 5', 'почти квадрат'],
    ['3 / 4', 'портрет'],
    ['2 / 3', 'высокий портрет'],
    ['9 / 16', 'телефонный'],
];

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
   СОСТОЯНИЕ
============================================================ */
function defaults() {
    return {
        on: false,

        /* сетка и карточка */
        gridOn: false, minW: 150, gap: 10, ratio: '3 / 4', radius: 12,
        /* аватар в карточке */
        focusY: 20,
        /* обводка карточки */
        border: 'none', bStyle: 'solid', bWidth: 0, bColor: '', outline: false,
        hoverColor: '', lively: false,
        /* имя */
        nameOver: true, nameColor: '', nameSize: 0, nameBg: '', namePad: 8, nameAlign: 'center',
        hideDesc: false, hideExtra: false,
        /* теги */
        tagsHide: false, tagColor: '', tagBg: '', tagBorder: '', tagRadius: 0, tagSize: 0,
        /* персоны */
        personaOn: false, personaLayout: 'stack', personaMinW: 120, personaGap: 10, personaRadius: 12, personaRing: 0, personaRingColor: '',
        /* быстрые аватарки */
        quickOn: false, quickSize: 0, quickRadius: 0, quickRing: 0, quickRingColor: '', hideScroll: false,
    };
}

const strip = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();
const num = (v) => Math.round(parseFloat(v) || 0);
const pct = (v) => (v ? Math.round(parseFloat(v) * 100) : 0);

function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip(rules.get(sel)?.get(prop));
    if (!rules.get(SEL.grid) && !rules.get(SEL.card) && !rules.get(SEL.persona) && !rules.get(SEL.quick)) return s;
    s.on = true;

    s.gridOn = get(SEL.grid, 'display') === 'grid';
    const mw = get(SEL.grid, 'grid-template-columns').match(/minmax\((\d+)px/);
    if (mw) s.minW = +mw[1];
    s.gap = num(get(SEL.grid, 'gap')) || s.gap;
    s.ratio = get(SEL.av, 'aspect-ratio') || get(SEL.card, 'aspect-ratio') || '';
    s.radius = num(get(SEL.card, 'border-radius'));

    const fy = get(SEL.img, 'object-position').match(/(\d+)%\s*$/);
    if (fy) s.focusY = +fy[1];

    const parseB = (v) => v.match(/^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double)\s+(.+)$/);
    const all = parseB(get(SEL.card, 'border'));
    const bottom = parseB(get(SEL.card, 'border-bottom'));
    const b = all || bottom;
    if (b) { s.bWidth = +b[1]; s.bStyle = b[2]; s.bColor = b[3]; s.border = all ? 'all' : 'bottom'; }
    s.outline = !!get(SEL.card, 'outline');
    s.hoverColor = get(`${SEL.card}:hover`, 'border-color') || get(`${SEL.card}:hover`, 'outline-color');
    s.lively = !!get(`${SEL.card}:hover`, 'transform');

    s.nameOver = get(SEL.info, 'position') === 'absolute';
    s.nameColor = get(SEL.name, 'color');
    s.nameSize = num(get(SEL.name, 'font-size'));
    s.nameBg = get(SEL.info, 'background-color');
    s.namePad = num(get(SEL.info, 'padding')) || s.namePad;
    s.nameAlign = get(SEL.name, 'text-align') || 'center';
    s.hideDesc = get(SEL.desc, 'display') === 'none';
    s.hideExtra = get(SEL.extra, 'display') === 'none';

    s.tagsHide = get(SEL.tag, 'display') === 'none';
    s.tagColor = get(SEL.tag, 'color');
    s.tagBg = get(SEL.tag, 'background-color');
    s.tagBorder = (get(SEL.tag, 'border').match(/solid\s+(.+)$/) || [])[1] || '';
    s.tagRadius = num(get(SEL.tag, 'border-radius'));
    s.tagSize = num(get(SEL.tag, 'font-size'));

    const pd = get(SEL.persona, 'display');
    s.personaOn = pd === 'grid' || pd === 'flex';
    s.personaLayout = pd === 'grid' ? 'grid' : 'stack';
    const pw = get(SEL.persona, 'grid-template-columns').match(/minmax\((\d+)px/);
    if (pw) s.personaMinW = +pw[1];
    s.personaGap = num(get(SEL.persona, 'gap')) || s.personaGap;
    s.personaRadius = num(get(SEL.personaAv, 'border-radius'));
    const pr = get(SEL.personaAv, 'outline').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
    if (pr) { s.personaRing = +pr[1]; s.personaRingColor = pr[2]; }

    s.quickSize = num(get(SEL.quick, 'width'));
    s.quickOn = !!s.quickSize || !!get(SEL.quick, 'border-radius');
    s.quickRadius = num(get(SEL.quick, 'border-radius'));
    const qr = get(SEL.quick, 'outline').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
    if (qr) { s.quickRing = +qr[1]; s.quickRingColor = qr[2]; }
    s.hideScroll = get(SEL.quickWrap, 'scrollbar-width') === 'none';
    void pct;
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
function buildRules(s) {
    const rules = {};
    const put = (sel, prop, val) => { (rules[sel] ||= {})[prop] = val; };
    const on = s.on;
    const grid = on && s.gridOn;

    /* ---------- сетка ----------
       align-content / align-items: start — карточки не растягиваются,
       когда после фильтра по тегу их осталось мало */
    put(SEL.grid, 'display', grid ? 'grid' : '');
    put(SEL.grid, 'grid-template-columns', grid ? `repeat(auto-fill, minmax(${s.minW}px, 1fr))` : '');
    // max-content: высота строки — по самой карточке. С «auto» браузер
    // делил высоту списка поровну между строками, и на полном списке
    // карточки налезали друг на друга
    put(SEL.grid, 'grid-auto-rows', grid ? 'max-content' : '');
    put(SEL.grid, 'align-content', grid ? 'start' : '');
    put(SEL.grid, 'align-items', grid ? 'start' : '');
    put(SEL.grid, 'gap', grid ? `${s.gap}px` : '');

    /* ---------- карточка ---------- */
    const line = grid && s.bWidth && s.bColor ? `${s.bWidth}px ${s.bStyle} ${s.bColor}` : '';
    put(SEL.card, 'position', grid ? 'relative' : '');
    put(SEL.card, 'padding', grid ? '0' : '');
    put(SEL.card, 'margin', grid ? '0' : '');
    // Пропорции задаёт сам аватар, а не карточка: он в потоке, и сетка
    // честно считает высоту строки по нему. С пропорциями у карточки и
    // аватаром поверх (absolute) строки сжимались и карточки налезали
    // друг на друга — это и была «мешанина» на полном списке
    put(SEL.card, 'aspect-ratio', '');
    put(SEL.card, 'flex-direction', grid ? 'column' : '');
    put(SEL.card, 'border-radius', grid && s.radius ? `${s.radius}px` : '');
    put(SEL.card, 'overflow', grid ? 'hidden' : '');
    put(SEL.card, 'height', grid ? 'auto' : '');
    put(SEL.card, 'border', grid ? (s.border === 'all' ? line || 'none' : 'none') : '');
    put(SEL.card, 'border-bottom', grid && s.border === 'bottom' ? line : '');
    put(SEL.card, 'outline', grid && s.outline && s.bColor ? `1px solid ${s.bColor}` : '');
    put(SEL.card, 'outline-offset', grid && s.outline && s.bColor ? '3px' : '');
    put(SEL.card, 'transition', grid && (s.hoverColor || s.lively) ? 'border-color 0.2s, outline-color 0.2s, transform 0.2s' : '');
    put(`${SEL.card}:hover`, 'border-color', grid ? s.hoverColor : '');
    put(`${SEL.card}:hover`, 'outline-color', grid && s.outline ? s.hoverColor : '');
    put(`${SEL.card}:hover`, 'transform', grid && s.lively ? 'translateY(-2px)' : '');

    /* ---------- аватар на всю карточку ---------- */
    put(SEL.av, 'position', grid ? 'relative' : '');
    put(SEL.av, 'inset', '');
    put(SEL.av, 'display', grid ? 'block' : '');
    put(SEL.av, 'width', grid ? '100%' : '');
    put(SEL.av, 'height', grid ? 'auto' : '');
    put(SEL.av, 'flex', grid ? '0 0 auto' : '');
    put(SEL.av, 'aspect-ratio', grid ? (s.ratio || '3 / 4') : '');
    put(SEL.av, 'border-radius', grid ? '0' : '');
    put(SEL.av, 'overflow', grid ? 'hidden' : '');
    put(SEL.av, 'border', grid ? 'none' : '');
    put(SEL.av, 'box-shadow', grid ? 'none' : '');
    put(SEL.img, 'width', grid ? '100%' : '');
    put(SEL.img, 'height', grid ? '100%' : '');
    put(SEL.img, 'object-fit', grid ? 'cover' : '');
    put(SEL.img, 'object-position', grid ? `center ${s.focusY}%` : '');
    put(SEL.img, 'border-radius', grid ? 'inherit' : '');
    put(SEL.img, 'border', grid ? 'none' : '');

    /* ---------- имя ---------- */
    const over = grid && s.nameOver;
    put(SEL.info, 'position', over ? 'absolute' : '');
    put(SEL.info, 'left', over ? '0' : '');
    put(SEL.info, 'right', over ? '0' : '');
    put(SEL.info, 'bottom', over ? '0' : '');
    put(SEL.info, 'width', over ? '100%' : '');
    put(SEL.info, 'flex-direction', grid ? 'column' : '');
    put(SEL.info, 'align-items', grid ? (s.nameAlign === 'left' ? 'flex-start' : s.nameAlign === 'right' ? 'flex-end' : 'center') : '');
    put(SEL.info, 'padding', grid && s.namePad ? `${s.namePad}px` : '');
    put(SEL.info, 'background-color', over ? s.nameBg : '');
    put(SEL.info, 'z-index', over ? '1' : '');
    put(SEL.name, 'text-align', grid ? s.nameAlign : '');
    put(SEL.name, 'color', grid ? s.nameColor : '');
    put(SEL.name, 'font-size', grid && s.nameSize ? `${s.nameSize}px` : '');
    put(SEL.desc, 'display', grid && s.hideDesc ? 'none' : '');
    put(SEL.extra, 'display', grid && s.hideExtra ? 'none' : '');

    /* ---------- теги ---------- */
    put(SEL.tag, 'display', on && s.tagsHide ? 'none' : '');
    put(SEL.tag, 'color', on && !s.tagsHide ? s.tagColor : '');
    put(SEL.tag, 'background-color', on && !s.tagsHide ? s.tagBg : '');
    put(SEL.tag, 'border', on && !s.tagsHide && s.tagBorder ? `1px solid ${s.tagBorder}` : '');
    put(SEL.tag, 'border-radius', on && !s.tagsHide && s.tagRadius ? `${s.tagRadius}px` : '');
    put(SEL.tag, 'font-size', on && !s.tagsHide && s.tagSize ? `${s.tagSize}px` : '');
    put(SEL.tagName, 'color', on && !s.tagsHide ? s.tagColor : '');

    /* ---------- персоны ----------
       «Стопкой» — как в карточках персонажа: большая аватарка слева,
       описание справа, персоны одна под другой. «Сеткой» — плитками. */
    const per = on && s.personaOn;
    const stack = per && s.personaLayout !== 'grid';
    put(SEL.persona, 'display', per ? (stack ? 'flex' : 'grid') : '');
    put(SEL.persona, 'flex-direction', stack ? 'column' : '');
    put(SEL.persona, 'grid-template-columns', per && !stack ? `repeat(auto-fill, minmax(${s.personaMinW}px, 1fr))` : '');
    put(SEL.persona, 'grid-auto-rows', per && !stack ? 'max-content' : '');
    put(SEL.persona, 'align-content', per ? 'start' : '');
    put(SEL.persona, 'gap', per ? `${s.personaGap}px` : '');
    put(SEL.personaCard, 'display', stack ? 'flex' : '');
    put(SEL.personaCard, 'flex-direction', stack ? 'row' : '');
    put(SEL.personaCard, 'align-items', stack ? 'flex-start' : '');
    put(SEL.personaCard, 'gap', stack ? '12px' : '');
    put(SEL.personaCard, 'width', stack ? '100%' : '');
    put(SEL.personaAv, 'width', per ? (stack ? `${s.personaMinW}px` : '100%') : '');
    put(SEL.personaAv, 'height', per ? 'auto' : '');
    put(SEL.personaAv, 'flex', stack ? '0 0 auto' : '');
    put(SEL.personaAv, 'aspect-ratio', per ? '1 / 1' : '');
    put(SEL.personaAv, 'border-radius', per && s.personaRadius ? `${s.personaRadius}px` : '');
    put(SEL.personaAv, 'overflow', per ? 'hidden' : '');
    put(SEL.personaAv, 'outline', per && s.personaRing && s.personaRingColor ? `${s.personaRing}px solid ${s.personaRingColor}` : '');
    put(SEL.personaImg, 'width', per ? '100%' : '');
    put(SEL.personaImg, 'height', per ? '100%' : '');
    put(SEL.personaImg, 'object-fit', per ? 'cover' : '');
    put(SEL.personaImg, 'object-position', per ? 'center top' : '');
    put(SEL.personaImg, 'border-radius', per ? 'inherit' : '');

    /* ---------- быстрые аватарки ---------- */
    const q = on && s.quickOn;
    put(SEL.quick, 'width', q && s.quickSize ? `${s.quickSize}px` : '');
    put(SEL.quick, 'height', q && s.quickSize ? `${s.quickSize}px` : '');
    put(SEL.quick, 'border-radius', q && s.quickRadius ? `${s.quickRadius}px` : '');
    put(SEL.quick, 'outline', q && s.quickRing && s.quickRingColor ? `${s.quickRing}px solid ${s.quickRingColor}` : '');
    put(SEL.quickImg, 'width', q ? '100%' : '');
    put(SEL.quickImg, 'height', q ? '100%' : '');
    put(SEL.quickImg, 'object-fit', q ? 'cover' : '');
    put(SEL.quickImg, 'border-radius', q ? 'inherit' : '');
    put(SEL.quickWrap, 'scrollbar-width', on && s.hideScroll ? 'none' : '');
    put(`${SEL.quickWrap}::-webkit-scrollbar`, 'display', on && s.hideScroll ? 'none' : '');
    return rules;
}

/* ============================================================
   ПРЕДПРОСМОТР
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
        previewStyle.id = 'vte-gallery-preview';
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
    const list = Object.entries(buildRules(state)).map(([selector, decls]) => ({ selector, decls }));
    const changed = await onApply?.(list);
    clearPreview();
    return changed;
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

/** Перечитать настройки из темы (её правили в коде или сменили) */
export function refresh() {
    if (!isOpen()) return;
    const scroll = els.body?.scrollTop || 0;
    state = readState();
    render();
    if (els.body) els.body.scrollTop = scroll;
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
        h('div.vte-title', {}, [
            h('span.vte-title-ic', {}, [icon('fa-address-card')]),
            h('span', { text: 'Боты и персоны' }),
        ]),
        h('div.vte-header-btns', {}, [
            iconBtn('fa-window-minimize', 'Свернуть', () => panel.classList.toggle('vte-collapsed')),
            iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close'),
        ]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-gallery-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-gallery-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

const open = { grid: true, border: false, name: false, tags: false, persona: false, quick: false };

function group(id, title, children) {
    const list = children.filter(Boolean);
    if (!list.length) return null;
    const head = h(`button.vte-av-group-head${open[id] ? '.open' : ''}`, {
        type: 'button',
        on: { click: () => { open[id] = !open[id]; render(); } },
    }, [icon(open[id] ? 'fa-chevron-down' : 'fa-chevron-right'), h('span', { text: title })]);
    return h('div.vte-av-group', {}, [head, open[id] ? h('div.vte-av-group-body', {}, list) : null]);
}

function render() {
    const b = els.body;
    b.textContent = '';
    b.append(...[
        themeSection(),

        group('grid', 'Галерея персонажей', [
            check('gridOn', 'Крупные карточки сеткой',
                'Аватар занимает всю карточку, имя — плашкой снизу'),
            state.gridOn ? row('Ширина карточки', slider('minW', 90, 420, 'px', '150px'),
                'Меньше — больше карточек в ряду. Сетка сама подстраивается под экран') : null,
            state.gridOn ? row('Пропорции', select('ratio', RATIOS),
                'Из-за отсутствия пропорций карточки и растягивались при фильтре по тегу') : null,
            state.gridOn ? row('Промежуток', slider('gap', 0, 40, 'px', '10px')) : null,
            state.gridOn ? row('Скругление', slider('radius', 0, 40, 'px', 'нет')) : null,
            state.gridOn ? row('Видимая часть фото', slider('focusY', 0, 100, '%', 'сверху'),
                'Обычно лучше 10–25%: тогда видно лицо, а не середину картинки') : null,
        ]),

        group('border', 'Обводка карточки', [
            row('Где', select('border', [['none', 'без рамки'], ['all', 'вокруг'], ['bottom', 'снизу']])),
            row('Линия', select('bStyle', [['solid', 'сплошная'], ['dashed', 'пунктир'], ['dotted', 'точки'], ['double', 'двойная']])),
            row('Толщина', slider('bWidth', 0, 6, 'px', 'нет')),
            row('Цвет', colorBtn('bColor', 'выбрать')),
            check('outline', 'Вторая рамка снаружи'),
            row('Цвет при наведении', colorBtn('hoverColor', 'как обычно')),
            check('lively', 'Приподнимать при наведении'),
        ]),

        group('name', 'Имя на карточке', [
            check('nameOver', 'Имя плашкой поверх фото'),
            row('Цвет имени', colorBtn('nameColor', 'как в теме')),
            row('Размер имени', slider('nameSize', 0, 32, 'px', 'как в теме')),
            row('Фон плашки', colorBtn('nameBg', 'нет')),
            row('Отступы плашки', slider('namePad', 0, 24, 'px', '8px')),
            row('Выравнивание', select('nameAlign', [['center', 'по центру'], ['left', 'слева'], ['right', 'справа']])),
            check('hideDesc', 'Скрыть описание'),
            check('hideExtra', 'Скрыть мелкие подписи (версия, файл)'),
        ]),

        group('tags', 'Теги', [
            check('tagsHide', 'Скрыть теги на карточках'),
            state.tagsHide ? null : row('Цвет текста', colorBtn('tagColor', 'как в теме')),
            state.tagsHide ? null : row('Фон', colorBtn('tagBg', 'как в теме')),
            state.tagsHide ? null : row('Рамка', colorBtn('tagBorder', 'нет')),
            state.tagsHide ? null : row('Скругление', slider('tagRadius', 0, 20, 'px', 'как в теме')),
            state.tagsHide ? null : row('Размер текста', slider('tagSize', 0, 20, 'px', 'как в теме')),
        ]),

        group('persona', 'Персоны', [
            check('personaOn', 'Крупные аватарки персон'),
            state.personaOn ? row('Раскладка', select('personaLayout', [['stack', 'стопкой: фото слева, текст справа'], ['grid', 'сеткой-плитками']], render)) : null,
            state.personaOn ? row(state.personaLayout === 'grid' ? 'Ширина плитки' : 'Размер аватарки', slider('personaMinW', 70, 400, 'px', '120px')) : null,
            state.personaOn ? row('Промежуток', slider('personaGap', 0, 40, 'px', '10px')) : null,
            state.personaOn ? row('Скругление', slider('personaRadius', 0, 50, 'px', 'нет')) : null,
            state.personaOn ? row('Обводка', slider('personaRing', 0, 8, 'px', 'нет')) : null,
            state.personaOn ? row('Цвет обводки', colorBtn('personaRingColor', 'выбрать')) : null,
        ]),

        group('quick', 'Быстрые аватарки и прокрутка', [
            check('quickOn', 'Настроить быстрые аватарки (hotswap)'),
            state.quickOn ? row('Размер', slider('quickSize', 0, 140, 'px', 'как в теме')) : null,
            state.quickOn ? row('Скругление', slider('quickRadius', 0, 50, 'px', 'как в теме')) : null,
            state.quickOn ? row('Обводка', slider('quickRing', 0, 6, 'px', 'нет')) : null,
            state.quickOn ? row('Цвет обводки', colorBtn('quickRingColor', 'выбрать')) : null,
            check('hideScroll', 'Спрятать полосы прокрутки в списках'),
        ]),

        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', { type: 'button', on: { click: resetAll } },
                [icon('fa-rotate-left'), h('span', { text: ' Вернуть как в теме' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Вернуть тему к виду, какой был при открытии этого окна — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    ].filter(Boolean));
}

let themeOpen = false;

function themeSection() {
    const list = onThemeRules?.([SEL.grid, '.character_select', '#user_avatar_block', '.hotswap']) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'правило' : 'правил'} про галерею` })]));
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

function resetAll() {
    state = defaults();
    commit();
    render();
    say('Галерея снова как в теме');
}

/* ---------- элементы управления ---------- */
function section(title, children) {
    return h('div.vte-tb-section', {}, [title ? h('div.vte-tb-section-title', { text: title }) : null, ...children].filter(Boolean));
}

function row(label, control, hint) {
    return h('div.vte-tb-row', { title: hint || '' }, [h('span.vte-tb-label', { text: label }), control]);
}

function slider(key, min, max, unit, zeroText, hint) {
    const out = h('span.vte-tb-val');
    const show = () => { out.textContent = state[key] ? `${state[key]}${unit}` : zeroText; };
    const input = h('input.vte-tb-range', {
        type: 'range', min: String(min), max: String(max), step: '1', value: String(state[key] || 0),
        title: hint || '',
        on: {
            input: (e) => { state[key] = +e.target.value; state.on = true; show(); preview(); },
            change: () => commit(),
        },
    });
    show();
    return h('span.vte-tb-slider', {}, [input, out]);
}

/** Пара «телефон / ПК» со связкой */
function pair(title, aKey, bKey, max, hint) {
    const LINK_KEY = `vte-av-link-${aKey}`;
    let linked = (() => { try { return localStorage.getItem(LINK_KEY) !== '0'; } catch { return true; } })();
    const mk = (key, label) => {
        const out = h('span.vte-tb-val');
        const input = h('input.vte-tb-range', { type: 'range', min: '0', max: String(max), step: '1' });
        const show = () => {
            input.value = String(state[key] || 0);
            out.textContent = state[key] ? `${state[key]}px` : 'как в теме';
        };
        show();
        return { key, input, show, row: row(label, h('span.vte-tb-slider', {}, [input, out])) };
    };
    const A = mk(aKey, 'На телефоне');
    const B = mk(bKey, 'На ПК');
    const ratio = () => (state[aKey] && state[bKey] ? state[bKey] / state[aKey] : 1.4);
    let k = ratio();
    const bind = (me, other, to) => {
        me.input.addEventListener('input', () => {
            state[me.key] = +me.input.value;
            state.on = true;
            if (linked) {
                state[other.key] = state[me.key] ? Math.max(0, Math.min(max, Math.round(to(state[me.key])))) : 0;
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

    return h('div.vte-tb-sizes', { title: hint || '' }, [
        h('div.vte-tb-sizes-head', {}, [h('span.vte-tb-label', { text: title }), link]),
        A.row, B.row,
    ]);
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
                    anchor: btn, value: state[key] || '#ffffff', allowGradient: false,
                    onChange: (v) => { state[key] = v; state.on = true; paint(); preview(); },
                    onCommit: (v) => { state[key] = v; state.on = true; paint(); commit(); },
                    onCancel: () => { state[key] = before; paint(); clearPreview(); },
                });
            },
        },
    }, [sw, txt]);
    const reset = iconBtn('fa-rotate-left', 'Убрать', () => { state[key] = ''; paint(); commit(); render(); }, 'vte-tb-mini');
    paint();
    return h('span.vte-tb-colorwrap', {}, [btn, reset]);
}

function check(key, label, hint, after) {
    const input = h('input', {
        type: 'checkbox', checked: !!state[key],
        on: { change: (e) => { state[key] = e.target.checked; state.on = true; commit(); (after || render)(); } },
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

function urlRow(key, placeholder, after) {
    const input = h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder, value: state[key],
        on: {
            change: (e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v) && !/^data:image\//i.test(v)) {
                    say('Нужна ссылка http(s):// на картинку');
                    return;
                }
                state[key] = v;
                state.on = true;
                commit();
                after ? after(v) : render();
            },
        },
    });
    const clear = state[key]
        ? iconBtn('fa-xmark', 'Убрать', () => { state[key] = ''; commit(); render(); }, 'vte-tb-mini')
        : null;
    return h('span.vte-tb-urlwrap', {}, [input, clear]);
}


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
