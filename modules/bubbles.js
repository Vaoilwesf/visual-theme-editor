// modules/bubbles.js
// «Пузыри ♡»: всё, что внутри сообщения, кроме самой аватарки —
// пузырь (фон, обводка, скругление, отступы, ширина, размер текста),
// цвета текста, положение текста, ник и дата, бейджи.
//
// Бот и пользователь: в каждом разделе есть связка. Пока связаны —
// пишется одно общее правило (.mes …), код короче. Разведёшь — пишутся
// два правила .mes[is_user="false"] и .mes[is_user="true"], общее стирается.
//
// Привязки — к ближайшему соседу, без пикселей «от угла экрана»:
//  - текст стоит на выбранном расстоянии от ника, рассуждения учитываются
//    сами (браузер ставит первым тот блок, что есть);
//  - дата живёт в строке ника и едет вместе с ним;
//  - бейджи «на аватарке» лежат внутри её рамки: ник больше не зависит
//    от того, сколько бейджей у сообщения;
//  - кнопки сообщения цепляются к ближайшему: к строке ника (остаются в
//    ней и сдвигаются от своего места) или к углу блока с текстом;
//  - размеры и сдвиги — clamp(телефон 360px → ПК 1280px).
//
// Кнопки SillyTavern показывает и прячет встроенными стилями (style=""
// прямо на элементе): «…», дополнительные кнопки, режим правки. Поэтому
// display у них мы не трогаем никогда — только положение и вид.
//
// Цвета текста — через переменные самой SillyTavern (--SmartThemeEmColor
// и т.д.) на уровне сообщения: курсив внутри кавычек, рассуждения и прочие
// тонкости ST продолжает делать сама.

import { explainRule } from './ruleExplain.js';

let onApply = null;
let onReadRules = null;
let onThemeRules = null;
let onReveal = null;
let onToast = null;
let picker = null;
let onSnapshot = null;
let onRestore = null;
let onRulesMatching = null;
let onDeleteRule = null;
let onCleanOverridden = null; // (ruleStarts) => убрать перекрытое, вернёт сколько
let onThemeValue = null;      // (selector, prop) => { value, from, to } что задаёт тема      // (from, to) => убрать правило из кода   // (test) => правила темы и «Моих правок» по селектору
let onMdSnapshot = null;   // окно «Markdown» — свой снимок «как было до открытия»
let onMdRestore = null;

let panel = null;
let els = {};
let state = null;

const VW_MIN = 360;
const VW_MAX = 1280;

/* ============================================================
   СЕЛЕКТОРЫ
============================================================ */
const ROLES = ['all', 'bot', 'user'];
const base = (r) => (r === 'all' ? '.mes' : `.mes[is_user="${r === 'bot' ? 'false' : 'true'}"]`);

const S = {
    // ник и дата
    nameRow: (r) => `${base(r)} .ch_name .alignItemsBaseline`,
    nameText: (r) => `${base(r)} .name_text`,
    date: (r) => `${base(r)} .timestamp`,
    chname: (r) => `${base(r)} .ch_name`,
    // текст
    text: (r) => `${base(r)} .mes_text`,
    reason: (r) => `${base(r)} .mes_reasoning_details`,
    blockR: (r) => `${base(r)} .mes_block`,
    // последнее сообщение с видимыми стрелками свайпа — место под них снизу
    lastText: (r) => `${base(r)}.last_mes:is(.swipes_visible, .last_swipe) .mes_text`,
    strong: (r) => `${base(r)} .mes_text strong`,
    link: (r) => `${base(r)} .mes_text a`,          // бывшая настройка «Ссылки» — только стереть
    quote: (r) => `${base(r)} .mes_text blockquote`,
    hr: (r) => `${base(r)} .mes_text hr`,
    // вид разметки
    q: (r) => `${base(r)} .mes_text q`,
    em: (r) => `${base(r)} .mes_text em`,
    emB: (r) => `${base(r)} .mes_text em::before`,
    u: (r) => `${base(r)} .mes_text u`,
    quoteB: (r) => `${base(r)} .mes_text blockquote::before`,
    code: (r) => `${base(r)} .mes_text :not(pre) > code`,
    hrA: (r) => `${base(r)} .mes_text hr::after`,
    para: (r) => `${base(r)} .mes_text p`,
    paraA: (r) => `${base(r)} .mes_text p::after`,
    // кнопки
    btns: (r) => `${base(r)} .mes_buttons`,
    btnAll: (r) => `${base(r)} :is(.mes_button, .extraMesButtons > div)`,
    btnHover: (r) => `${base(r)} :is(.mes_button, .extraMesButtons > div):hover`,
    btnRows: (r) => `${base(r)} :is(.mes_buttons, .extraMesButtons)`,
    edit: (r) => `${base(r)} .mes_edit_buttons`,
    // панель «…»: сама панель и её кнопки — сильнее общих правил кнопок
    extra: (r) => `${base(r)} .mes_buttons .extraMesButtons`,
    exBtn: (r) => `${base(r)} .extraMesButtons > .mes_button`,
    exHover: (r) => `${base(r)} .extraMesButtons > .mes_button:hover`,
    editBtn: (r) => `${base(r)} .mes_edit_buttons .menu_button`,
    nameBox: (r) => `${base(r)} .ch_name > .flex1`,
    // пузырь: #chat — чтобы надёжно перекрыть и тему, и «Аватарки»
    box: (r, t) => (t === 'mes' ? `#chat ${base(r)}` : t === 'text' ? `#chat ${base(r)} .mes_text` : `#chat ${base(r)} .mes_block`),
};

/* Общие (без деления на бота и пользователя) */
const G = {
    mes: '.mes',
    chat: '#chat .mes',
    block: '.mes .mes_block',
    text: '.mes .mes_text',
    chname: '.mes .ch_name',
    wrap: '.mes .mesAvatarWrapper',
    av: '.mes .avatar',
    badges: '.mes .mesIDDisplay, .mes .mes_timer, .mes .tokenCounterDisplay',
    b1: '.mes .mesIDDisplay',
    b2: '.mes .mes_timer',
    b3: '.mes .tokenCounterDisplay',
    badgesEmpty: '.mes .mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):empty',
    stair1: '.mes .mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty) ~ :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty)',
    stair2: '.mes .mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty) ~ :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty) ~ :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty)',
};

/* Значки кнопок: класс → подпись. Порядок — как в разметке ST */
const GLYPHS = [
    ['Видимые', [['extraMesButtonsHint', '«…» — ещё кнопки'], ['mes_edit', 'Править'], ['mes_bookmark', 'Открыть закладку']]],
    ['Появляются после «…»', [
        ['mes_translate', 'Перевести'], ['sd_message_gen', 'Картинка'], ['mes_narrate', 'Озвучить'],
        ['mes_prompt', 'Промпт'], ['mes_hide', 'Скрыть от ИИ'], ['mes_unhide', 'Вернуть ИИ'],
        ['mes_media_gallery', 'Медиа: галерея'], ['mes_media_list', 'Медиа: список'], ['mes_embed', 'Прикрепить'],
        ['mes_swipe_picker', 'История свайпов'], ['mes_create_bookmark', 'Закладка'], ['mes_create_branch', 'Ветка'],
        ['mes_copy', 'Копировать'],
    ]],
    ['В режиме правки', [
        ['mes_edit_done', 'Готово'], ['mes_edit_copy', 'Копия сообщения'], ['mes_edit_add_reasoning', 'Добавить рассуждения'],
        ['mes_edit_delete', 'Удалить'], ['mes_edit_up', 'Выше'], ['mes_edit_down', 'Ниже'], ['mes_edit_cancel', 'Отмена'],
    ]],
];
const glyphSel = (cls) => `.mes .${cls}::before`;

/** Отступ блока с текстом слева в теме — у живого сообщения этой роли */
function blockPadLeft(r) {
    try {
        const q = r === 'user' ? '[is_user="true"]' : r === 'bot' ? '[is_user="false"]' : '';
        const b = document.querySelector(`#chat .mes${q}:not(.smallSysMes) .mes_block`);
        return b ? Math.round(parseFloat(getComputedStyle(b).paddingLeft) || 0) : 10;
    } catch { return 10; }
}

/* Декор по бокам чата переехал в окно «Декор» (decor.js) */

/* Условия для полосы прокрутки. Телефон — сенсорный экран без мыши,
   ПК — есть мышь: так узкое окно браузера на ПК не примут за телефон */
const DEV = {
    phone: '@media (hover: none) and (pointer: coarse)',
    pc: '@media (hover: hover) and (pointer: fine)',
};
const FF = '@supports not selector(::-webkit-scrollbar)';
const COND_SEP = '\u0001';
/** Ключ правила внутри условия — так же, как хранит блок «Мои правки» */
const ck = (cond, sel) => (cond ? `${cond}${COND_SEP}${sel}` : sel);
function splitCond(key) {
    const i = key.indexOf(COND_SEP);
    return i === -1 ? { cond: '', sel: key } : { cond: key.slice(0, i), sel: key.slice(i + 1) };
}

/* Старая схема сдвига текста (margin-top у текста) — только стереть */
const OLD = {
    botReason: '.mes[is_user="false"].reasoning .mes_reasoning_details[data-has-content="true"]',
    botAfterReason: '.mes[is_user="false"].reasoning .mes_reasoning_details[data-has-content="true"] + .mes_text',
};

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
    onMdSnapshot = options.onMdSnapshot || null;
    onRulesMatching = options.onRulesMatching || null;
    onDeleteRule = options.onDeleteRule || null;
    onCleanOverridden = options.onCleanOverridden || null;
    onThemeValue = options.onThemeValue || null;
    onMdRestore = options.onMdRestore || null;
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
/* Поля, которые бывают разными у бота и у пользователя, по разделам */
const ROLE_GROUPS = {
    bubble: ['bg', 'bw', 'bc', 'radius', 'padT', 'padB', 'padX', 'maxW', 'trimT', 'trimB'],
    // «Текст»: размер, цвет и вид текста целиком
    textall: ['fsMin', 'fsMax', 'cText', 'tLh', 'tPGap', 'tIndent', 'tLetter', 'tHyph', 'tNoShadow',
        'tBg', 'tBgPad', 'tBgRad', 'tBgBw', 'tBgBs', 'tBgBc', 'tBgBlock'],
    colors: ['cEm', 'cStrong', 'cQuote', 'cU', 'bqText', 'bqBar', 'bqBarW', 'bqBg', 'hrColor', 'hrStyle', 'hrThick', 'hrOp',
        'qStyle', 'emStyle', 'strongStyle', 'uStyle', 'bqStyle', 'codeStyle',
        'qAcc', 'qFill', 'emAcc', 'emFill', 'strongAcc', 'strongFill', 'uAcc', 'uFill', 'bqAcc', 'bqFill', 'codeAcc', 'codeFill',
        'hrSign', 'hrSignColor'],
    text: ['textFull', 'offY', 'offX', 'textW', 'textAlign'],
    names: ['nameCorner', 'nameX', 'nameY', 'datePos', 'dateX', 'dateY', 'nameSize', 'nameColor', 'nameNoWrap', 'nameWidth', 'dateSize', 'dateColor'],
    buttons: ['btnTop', 'btnPlace', 'btnCorner', 'btnXMin', 'btnXMax', 'btnYMin', 'btnYMax', 'btnDir',
        'btnSMin', 'btnSMax', 'btnColor', 'btnOpacity', 'btnHover', 'btnBg', 'btnRadius', 'btnPad', 'btnGap', 'btnNoShadow',
        'edPlace', 'edCorner', 'edXMin', 'edXMax', 'edYMin', 'edYMax', 'edSize', 'edOpacity', 'edRadius', 'edGap',
        'exOwn', 'exXMin', 'exXMax', 'exYMin', 'exYMax', 'exDir', 'exSMin', 'exSMax', 'exColor', 'exOpacity', 'exHover', 'exBg', 'exRadius', 'exPad', 'exGap', 'edSame', 'edColor', 'edBg', 'btnPanBg', 'btnPanPad', 'btnPanBw', 'btnPanBs', 'btnPanBc', 'btnPanRad', 'exPanBg', 'exPanPad', 'exPanBw', 'exPanBs', 'exPanBc', 'exPanRad', 'edPanBg', 'edPanPad', 'edPanBw', 'edPanBs', 'edPanBc', 'edPanRad'],
};
const GROUP_OF = Object.fromEntries(Object.entries(ROLE_GROUPS).flatMap(([g, keys]) => keys.map(k => [k, g])));

function roleDefaults() {
    return {
        bg: '', bw: 0, bc: '', radius: 0, padT: 0, padB: 0, padX: 0, maxW: 0, fsMin: 0, fsMax: 0,
        trimT: 0, trimB: 0,   // фон пузыря короче сверху / снизу (сам пузырь и текст не двигаются)
        // текст целиком: межстрочный (×100), между абзацами (px), красная строка (×10 em),
        // межбуквенный (×100 em), переносы, без тени
        tLh: 0, tPGap: 0, tIndent: 0, tLetter: 0, tHyph: false, tNoShadow: false,
        // фон под абзацами обычного текста: цвет, насколько больше текста, края, рамка
        tBg: '', tBgPad: 0, tBgRad: 0, tBgBw: 0, tBgBs: '', tBgBc: '',
        tBgBlock: false,   // фон прямоугольником на весь абзац (иначе — только под буквами)
        cText: '', cEm: '', cStrong: '', cQuote: '', cU: '',
        // цитата (> текст): текст, полоса слева, её толщина, фон
        bqText: '', bqBar: '', bqBarW: 0, bqBg: '',
        // горизонтальная линия (---): цвет, вид, толщина, видимость
        hrColor: '', hrStyle: '', hrThick: 0, hrOp: 0,
        // вид разметки: готовые шаблоны для кавычек, курсива, жирного и т.д.
        qStyle: '', emStyle: '', strongStyle: '', uStyle: '', bqStyle: '', codeStyle: '',
        // цвета шаблонов: Acc — линии и рамки, Fill — подложка
        qAcc: '', qFill: '', emAcc: '', emFill: '', strongAcc: '', strongFill: '', uAcc: '', uFill: '', bqAcc: '', bqFill: '', codeAcc: '', codeFill: '',
        hrSign: '', hrSignColor: '',  // знак посередине линии (---)
        offY: 0, offX: 0,
        textFull: false,   // текст во всю ширину пузыря (без запаса ST под стрелки)
        textW: 0,          // ширина текста, % от пузыря (0 — как в теме)
        textAlign: '',     // '' | left | center | right | justify
        // nameCorner: '' — сдвиг от своего места; 'top-left' и т.д. — в углу
        // пузыря, nameX / nameY — расстояние от его краёв
        nameCorner: '', nameX: 0, nameY: 0, datePos: '', dateX: 0, dateY: 0,
        nameSize: 0, nameColor: '', nameNoWrap: false, nameWidth: 0,
        dateSize: 0, dateColor: '',
        // кнопки: где стоят ('' как в теме | row — в строке ника | after — сразу
        // после ника и даты | block — в углу блока с текстом), сдвиги телефон/ПК
        btnTop: false,     // поверх всего в сообщении и соседних сообщениях
        btnPlace: '', btnCorner: 'top-right', btnXMin: 0, btnXMax: 0, btnYMin: 0, btnYMax: 0, btnDir: '',
        btnSMin: 0, btnSMax: 0, btnColor: '', btnOpacity: 0, btnHover: 0, btnBg: '', btnRadius: 0, btnPad: 0, btnGap: 0,
        btnNoShadow: false,
        edPlace: '', edCorner: 'top-right', edXMin: 0, edXMax: 0, edYMin: 0, edYMax: 0,
        edSize: 0, edOpacity: 0, edRadius: 0, edGap: 0,
        // панель «…» (дополнительные кнопки): exOwn — своя, не как у основных
        exOwn: false, exXMin: 0, exXMax: 0, exYMin: 0, exYMax: 0, exDir: '',
        exSMin: 0, exSMax: 0, exColor: '', exOpacity: 0, exHover: 0, exBg: '', exRadius: 0, exPad: 0, exGap: 0,
        // кнопки правки: edSame — цвет, фон и видимость как у основных
        edSame: false, edColor: '', edBg: '',
        // подложка под группой кнопок (btn — основные, ex — «…», ed — правка)
        ...panDefaults('btn'), ...panDefaults('ex'), ...panDefaults('ed'),
    };
}

/* Подложка под группой кнопок: фон чуть больше кнопок (отступ + такой же
   отрицательный margin — кнопки не сдвигаются) и рамка любого вида */
function panDefaults(pre) {
    return { [`${pre}PanBg`]: '', [`${pre}PanPad`]: 0, [`${pre}PanBw`]: 0, [`${pre}PanBs`]: '', [`${pre}PanBc`]: '', [`${pre}PanRad`]: 0 };
}
const LINE_STYLES = [['', 'сплошная'], ['dashed', 'пунктир'], ['dotted', 'точки'], ['double', 'двойная']];

function panRules(put, sel, v, pre) {
    const bg = v?.[`${pre}PanBg`] || '';
    const pad = v?.[`${pre}PanPad`] || 0;
    const bw = v?.[`${pre}PanBw`] || 0;
    put(sel, 'background-color', bg);
    put(sel, 'padding', pad ? `${pad}px` : '');
    put(sel, 'margin', pad ? `-${pad}px` : '');
    put(sel, 'border', bw ? `${bw}px ${v[`${pre}PanBs`] || 'solid'} ${v[`${pre}PanBc`] || 'currentColor'}` : '');
    put(sel, 'border-radius', v?.[`${pre}PanRad`] ? `${v[`${pre}PanRad`]}px` : '');
}

function panRead(get, sel, pre) {
    const o = {};
    o[`${pre}PanBg`] = get(sel, 'background-color');
    o[`${pre}PanPad`] = num(get(sel, 'padding'));
    const b = get(sel, 'border').match(/^(\d+)px\s+(solid|dashed|dotted|double)\s+(.+)$/);
    o[`${pre}PanBw`] = b ? +b[1] : 0;
    o[`${pre}PanBs`] = b && b[2] !== 'solid' ? b[2] : '';
    o[`${pre}PanBc`] = b && b[3] !== 'currentColor' ? b[3] : '';
    o[`${pre}PanRad`] = num(get(sel, 'border-radius'));
    return o;
}

function defaults() {
    return {
        on: false,
        role: 'bot',                 // какую вкладку правим, когда разведены
        link: { bubble: true, textall: true, colors: true, text: true, names: true, buttons: true },
        glyphs: {},                  // класс кнопки → { code, brand } | { img }
        bot: roleDefaults(),
        user: roleDefaults(),

        target: 'block',             // block — текст с ником, mes — всё сообщение
        rightSpace: 0,               // место справа под стрелки свайпа (ST: 30px)
        gapMes: 0,                   // расстояние между сообщениями

        badgeMode: '',               // '' | stack | row | stairs | onBottom | onTop
        badgeAlign: 'center',
        badgeX: 0, badgeY: 0, badgeGap: 4, badgeStair: 14,
        badgeSize: 0, badgeColor: '', badgeBg: '', badgeRadius: 0, badgePad: 0,

        // полоса прокрутки
        sbScope: 'chat',   // chat — только чат | all — весь интерфейс
        sbHide: '',        // '' | phone | pc | both
        sbWhere: 'both',   // где менять вид: both | pc | phone
        sbW: 0, sbThumb: '', sbTrack: '', sbRadius: 0, sbImg: '', sbFit: 'stretch',


        // фон чата под пузырями
        cNoBlur: false, cColor: '', cOp: 100,
        cImg: '', cImgOp: 100, cFit: 'cover', cPos: 'center',
    };
}

function captureBubble() {
    try {
        const t = state.target;
        const q = state.link.bubble ? '' : `[is_user="${state.role === 'user'}"]`;
        const m = document.querySelector(`#chat .mes${q}:not(.smallSysMes)`);
        const el = m && (t === 'mes' ? m : m.querySelector(t === 'text' ? '.mes_text' : '.mes_block'));
        if (!el) return;
        const cs = getComputedStyle(el);
        const clear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
        if (!val('bg') && !clear(cs.backgroundColor)) setVal('bg', cs.backgroundColor);
        const bw = Math.round(parseFloat(cs.borderTopWidth) || 0);
        if (!val('bw') && bw && cs.borderTopStyle !== 'none') { setVal('bw', bw); setVal('bc', cs.borderTopColor); }
    } catch {}
}

/** Текущее значение поля: для раздела бот/пользователь — из нужной вкладки */
function val(key) {
    const g = GROUP_OF[key];
    if (!g) return state[key];
    return state[state.link[g] ? 'bot' : state.role][key];
}

function setVal(key, v) {
    // Обрезка фона: фон и рамка темы переезжают в слой за текстом — берём
    // их с живого пузыря, если своих ещё нет (видно в окне, можно поменять)
    if ((key === 'trimT' || key === 'trimB') && v && !val('trimT') && !val('trimB')) captureBubble();
    { const m = key.match(/^(btn|ed)[XY](Min|Max)$/); if (m && v && !val(`${m[1]}Place`)) setVal(`${m[1]}Place`, 'row'); }
    const g = GROUP_OF[key];
    state.on = true;
    if (!g) { state[key] = v; return; }
    if (state.link[g]) { state.bot[key] = v; state.user[key] = v; }
    else state[state.role][key] = v;
}

const strip = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();
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

/** Сдвиг «телефон → ПК»: может быть отрицательным и идти в любую сторону */
function fluidSigned(a, b) {
    a = a || 0; b = b || 0;
    if (!a && !b) return '';
    if (a === b) return `${a}px`;
    const slope = (b - a) / (VW_MAX - VW_MIN);
    const k = a - slope * VW_MIN;
    return `clamp(${Math.min(a, b)}px, ${r2(k)}px + ${r2(slope * 100)}vw, ${Math.max(a, b)}px)`;
}

function readSigned(v) {
    const m = String(v || '').match(/^clamp\(\s*-?[\d.]+px\s*,\s*(-?[\d.]+)px\s*\+\s*(-?[\d.]+)vw\s*,\s*-?[\d.]+px\s*\)$/);
    if (m) {
        const k = +m[1], sl = +m[2] / 100;
        return [Math.round(k + sl * VW_MIN), Math.round(k + sl * VW_MAX)];
    }
    const p = String(v || '').match(/^(-?[\d.]+)px$/);
    return p ? [Math.round(+p[1]), Math.round(+p[1])] : [0, 0];
}

const tr = (v) => {
    // Сдвиг бейджей пишется как translate(calc(Xpx …), Ypx) — calc тоже читаем:
    // раньше X и Y не узнавались и при следующей записи сбрасывались в 0
    const m = String(v || '').match(/translate\(\s*(?:calc\(\s*)?(-?\d+(?:\.\d+)?)px[^,]*,\s*(-?\d+(?:\.\d+)?)px/);
    return m ? [+m[1], +m[2]] : [0, 0];
};

/* ---------- чтение одного раздела для одной «роли» ---------- */
const READ = {
    bubble(get, r, t) {
        const box = S.box(r, t);
        const A = `${box}::after`;
        const trimmed = get(box, 'isolation') === 'isolate' && !!get(A, 'content');
        const bd = get(trimmed ? A : box, 'border').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
        const fs = readFluid(get(S.text(r), 'font-size'));
        return {
            bg: get(trimmed ? A : box, 'background-color'),
            trimT: trimmed ? num(get(A, 'top')) : 0,
            trimB: trimmed ? num(get(A, 'bottom')) : 0,
            bw: bd ? +bd[1] : 0, bc: bd && bd[2] !== 'currentColor' ? bd[2] : '',
            radius: num(get(box, 'border-radius')),
            padT: num(get(box, 'padding-top')), padB: num(get(box, 'padding-bottom')),
            padX: num(get(box, 'padding-left')),
            maxW: num(get(box, 'max-width')),
        };
    },
    colors(get, r) {
        return {
            cEm: get(S.text(r), '--SmartThemeEmColor'),
            cQuote: get(S.text(r), '--SmartThemeQuoteColor'),
            cU: get(S.text(r), '--SmartThemeUnderlineColor'),
            cStrong: get(S.strong(r), 'color'),
            bqText: get(S.quote(r), 'color'),
            bqBar: get(S.quote(r), 'border-left-color'),
            bqBarW: num(get(S.quote(r), 'border-left-width')),
            bqBg: get(S.quote(r), 'background-color'),
            hrColor: get(S.hr(r), '--vte-hr-color'),
            hrStyle: get(S.hr(r), '--vte-hr-style'),
            hrThick: num(get(S.hr(r), '--vte-hr-thick')),
            hrOp: Math.round((parseFloat(get(S.hr(r), 'opacity')) || 0) * 100),
            hrSign: get(S.hr(r), '--vte-hr-sign'),
            hrSignColor: (() => { const c = get(S.hrA(r), 'color'); return c && c !== (get(S.hr(r), '--vte-hr-color') || 'currentColor') ? c : ''; })(),
            ...readTextStyles(get, r),
        };
    },
    text(get, r) {
        // Старая схема: сдвиг лежал в margin-top текста
        const ta = get(S.text(r), 'text-align');
        const full = get(S.text(r), '--vte-text-full') === '1';
        const w = full ? null : get(S.text(r), 'width').match(/^(\d+)%$/);
        return {
            textFull: full,
            offY: num(get(S.chname(r), 'margin-bottom') || get(S.text(r), 'margin-top')),
            offX: num(get(S.text(r), 'left') || (ta || w ? '' : get(S.text(r), 'margin-left'))),
            textW: w ? +w[1] : 0,
            textAlign: ({ left: 'left', center: 'center', right: 'right', justify: 'justify' })[ta] || '',
        };
    },
    textall(get, r) {
        const fs = readFluid(get(S.text(r), 'font-size'));
        return {
            fsMin: fs.min, fsMax: fs.max,
            cText: get(S.text(r), 'color'),
            tLh: Math.round((parseFloat(get(S.text(r), 'line-height')) || 0) * 100),
            tPGap: num(get(S.para(r), 'margin-bottom') || (/px$/.test(get(S.paraA(r), 'height')) ? get(S.paraA(r), 'height') : '')),
            tIndent: Math.round((parseFloat(get(S.para(r), 'text-indent')) || 0) * 10),
            tLetter: Math.round((parseFloat(get(S.text(r), 'letter-spacing')) || 0) * 100),
            tHyph: get(S.text(r), 'hyphens') === 'auto',
            tNoShadow: get(S.text(r), 'text-shadow') === 'none',
            tBg: get(S.para(r), 'background-color'),
            tBgBlock: !!get(S.para(r), 'background-color') && get(S.para(r), 'display') !== 'inline',
            // по строкам паддинг пишется «пол / целый» — берём второй
            tBgPad: get(S.para(r), 'display') === 'inline'
                ? num((get(S.para(r), 'box-shadow').match(/^-(\d+)px/) || [])[1])
                : num(get(S.para(r), 'padding')),
            tBgRad: num(get(S.para(r), 'border-radius')),
            ...(() => {
                const b = get(S.para(r), 'border').match(/^(\d+)px\s+(solid|dashed|dotted|double)\s+(.+)$/);
                return { tBgBw: b ? +b[1] : 0, tBgBs: b && b[2] !== 'solid' ? b[2] : '', tBgBc: b && b[3] !== 'currentColor' ? b[3] : '' };
            })(),
        };
    },
    buttons(get, r) {
        const place = (sel, pre) => {
            const o = {};
            const mark = get(sel, '--vte-place');
            o[`${pre}Place`] = mark || '';
            const abs = mark === 'block';
            const y = abs && get(sel, 'bottom') ? 'bottom' : 'top';
            const x = abs && get(sel, 'right') ? 'right' : 'left';
            o[`${pre}Corner`] = abs ? `${y}-${x}` : 'top-right';
            [o[`${pre}XMin`], o[`${pre}XMax`]] = readSigned(get(sel, x));
            [o[`${pre}YMin`], o[`${pre}YMax`]] = readSigned(get(sel, y));
            if (!mark) { o[`${pre}Corner`] = ''; }
            return o;
        };
        const b = place(S.btns(r), 'btn');
        const e = place(S.edit(r), 'ed');
        const fs = readFluid(get(S.btnAll(r), 'font-size'));
        const o = {
            ...b, ...e,
            btnDir: get(S.btnRows(r), 'flex-direction') === 'column' ? 'column' : '',
            btnSMin: fs.min, btnSMax: fs.max,
            btnColor: get(S.btnAll(r), 'color'),
            btnOpacity: Math.round((parseFloat(get(S.btnAll(r), 'opacity')) || 0) * 100),
            btnHover: Math.round((parseFloat(get(S.btnHover(r), 'opacity')) || 0) * 100),
            btnBg: get(S.btnAll(r), 'background-color'),
            btnRadius: num(get(S.btnAll(r), 'border-radius')),
            btnPad: num(get(S.btnAll(r), 'padding')),
            btnGap: num(get(S.btnRows(r), 'gap')),
            btnNoShadow: get(S.btnAll(r), 'filter') === 'none',
            edSize: num(get(S.editBtn(r), 'height')),
            edOpacity: Math.round((parseFloat(get(S.editBtn(r), 'opacity')) || 0) * 100),
            edRadius: num(get(S.editBtn(r), 'border-radius')),
            edGap: num(get(S.edit(r), 'column-gap')),
            ...panRead(get, S.btns(r), 'btn'),
            ...panRead(get, S.extra(r), 'ex'),
            ...panRead(get, S.edit(r), 'ed'),
        };
        // панель «…»: своё — если есть хоть одно её правило
        const exf = readFluid(get(S.exBtn(r), 'font-size'));
        const ex = {
            exSMin: exf.min, exSMax: exf.max,
            exColor: get(S.exBtn(r), 'color'),
            exOpacity: Math.round((parseFloat(get(S.exBtn(r), 'opacity')) || 0) * 100),
            exHover: Math.round((parseFloat(get(S.exHover(r), 'opacity')) || 0) * 100),
            exBg: get(S.exBtn(r), 'background-color'),
            exRadius: num(get(S.exBtn(r), 'border-radius')),
            exPad: num(get(S.exBtn(r), 'padding')),
            exGap: num(get(S.extra(r), 'gap')),
            exDir: get(S.extra(r), 'flex-direction'),
        };
        [ex.exXMin, ex.exXMax] = readSigned(get(S.extra(r), 'left'));
        [ex.exYMin, ex.exYMax] = readSigned(get(S.extra(r), 'top'));
        ex.exOwn = get(S.extra(r), '--vte-own') === '1';
        Object.assign(o, ex);
        o.edSame = get(S.editBtn(r), '--vte-same') === '1';
        if (!o.edSame) {
            o.edColor = get(S.editBtn(r), 'color');
            o.edBg = get(S.editBtn(r), 'background-color');
        }
        return o;
    },
    names(get, r) {
        const corner = get(S.nameRow(r), '--vte-corner');
        let [nameX, nameY] = tr(get(S.nameRow(r), 'transform'));
        if (corner) {
            const [cy, cx] = corner.split('-');
            nameX = num(get(S.nameRow(r), cx));
            nameY = num(get(S.nameRow(r), cy));
        }
        const [dateX, dateY] = tr(get(S.date(r), 'transform'));
        const basis = get(S.date(r), 'flex-basis');
        const order = get(S.date(r), 'order');
        return {
            nameCorner: corner, nameX, nameY, dateX, dateY,
            datePos: basis === '100%' ? (order === '-1' ? 'above' : 'below') : (order === '-1' ? 'before' : ''),
            nameSize: num(get(S.nameText(r), 'font-size')),
            nameColor: get(S.nameText(r), 'color'),
            nameNoWrap: get(S.nameText(r), 'white-space') === 'nowrap',
            nameWidth: num(get(S.nameText(r), 'max-width')),
            dateSize: num(get(S.date(r), 'font-size')),
            dateColor: get(S.date(r), 'color'),
        };
    },
};

const isEmpty = (o) => Object.entries(o).every(([k, v]) => !v || /^(btn|ed)Corner$/.test(k));

/* ---------- фон чата под пузырями ----------
   #chat — лента сообщений; её фон ST красит в --SmartThemeChatTintColor
   и размывает обои под ней (backdrop-filter).
   Своя картинка — слой #sheld::after под лентой (#sheld — колонка чата,
   лента в ней выше: z-index 30). Картинка не прокручивается вместе с
   сообщениями и не перерисовывается при прокрутке. Когда картинка есть,
   фон ленты переезжает ещё ниже — в #sheld::before: так картинка ложится
   поверх фона, но под сообщения */
const CHAT = '#chat';
const CH_TINT = '#sheld::before';
const CH_IMG = '#sheld::after';
const CH_VAR = 'var(--SmartThemeChatTintColor)';

function chatTint(s) {
    const c = s.cColor || '';
    const op = s.cOp ?? 100;
    if (op >= 100) return c;
    return `color-mix(in srgb, ${c || CH_VAR} ${op}%, transparent)`;
}

function readChatTint(v) {
    const m = String(v || '').match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*transparent\)$/);
    const col = (x) => (x === CH_VAR ? '' : x);
    return m ? { cColor: col(m[1]), cOp: Math.round(+m[2]) } : { cColor: col(v || ''), cOp: 100 };
}

/* ============================================================
   ВИД РАЗМЕТКИ — готовые шаблоны
   Всё неподвижное и лёгкое: подчёркивания, заливки цветом, тонкие рамки,
   «маркер» — внутренняя тень без размытия. Без анимаций, градиентов и
   размытых теней. Цвет — от цвета самого элемента (currentColor), поэтому
   шаблон подходит к любой теме и к цветам выше.
   Каждый шаблон помечает правило: --vte-st: имя — так окно узнаёт его обратно.
============================================================ */
const mix = (p) => `color-mix(in srgb, currentColor ${p}%, transparent)`;
/* Цвета шаблона — переменные на самом элементе: --vte-ta (линии, рамки)
   и --vte-tb (подложка). Не заданы — берётся полупрозрачный цвет текста */
const ACC = (p) => `var(--vte-ta, ${mix(p)})`;
const FILL = (p) => `var(--vte-tb, ${mix(p)})`;
const CLONE = { 'box-decoration-break': 'clone', '-webkit-box-decoration-break': 'clone' };
/* [подпись, правила, правила ::before, есть ли подложка] */
const TEXT_STYLES = {
    q: {
        title: '«Кавычки»',
        list: {
            pill: ['плашка-таблетка', { ...CLONE, 'background-color': FILL(16), 'border-radius': '999px', padding: '0.05em 0.45em', 'box-shadow': `0 0 0 1px ${ACC(30)}` }, null, true],
            wavy: ['волнистое подчёркивание', { 'text-decoration-line': 'underline', 'text-decoration-style': 'wavy', 'text-decoration-color': ACC(70), 'text-decoration-thickness': '1px', 'text-underline-offset': '3px' }],
            frame: ['рамка пунктиром', { ...CLONE, border: `1px dashed ${ACC(60)}`, 'border-radius': '6px', padding: '0 0.3em', 'background-color': FILL(0) }, null, true],
            italic: ['курсивом', { 'font-style': 'italic' }],
        },
    },
    em: {
        title: '*Курсив*',
        list: {
            pencil: ['прямой, волна и ✎', { 'font-style': 'normal', 'text-decoration-line': 'underline', 'text-decoration-style': 'wavy', 'text-decoration-color': ACC(60), 'text-decoration-thickness': '1px', 'text-underline-offset': '3px' },
                { content: '"\\270E\\00a0"', opacity: '0.75', 'font-style': 'normal', color: 'var(--vte-ta, currentColor)' }],
            wavy: ['волнистое подчёркивание', { 'text-decoration-line': 'underline', 'text-decoration-style': 'wavy', 'text-decoration-color': ACC(60), 'text-decoration-thickness': '1px', 'text-underline-offset': '3px' }],
            dotted: ['пунктирное подчёркивание', { 'text-decoration-line': 'underline', 'text-decoration-style': 'dotted', 'text-decoration-color': ACC(70), 'text-underline-offset': '3px' }],
            hand: ['рукописный', { 'font-family': "'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive", 'font-style': 'normal' }],
            soft: ['тише (чуть прозрачнее)', { opacity: '0.8' }],
            pill: ['на подложке', { ...CLONE, 'background-color': FILL(12), 'border-radius': '5px', padding: '0 0.3em' }, null, true],
        },
    },
    strong: {
        title: '**Жирный**',
        list: {
            line: ['толстое подчёркивание', { 'text-decoration-line': 'underline', 'text-decoration-thickness': '2px', 'text-decoration-color': ACC(55), 'text-underline-offset': '3px' }],
            caps: ['капителью', { 'font-variant': 'small-caps', 'letter-spacing': '0.04em' }],
            pill: ['на подложке', { ...CLONE, 'background-color': FILL(14), 'border-radius': '5px', padding: '0 0.3em' }, null, true],
        },
    },
    u: {
        title: 'Подчёркнутый',
        list: {
            wavy: ['волной', { 'text-decoration-style': 'wavy', 'text-decoration-color': ACC(100), 'text-underline-offset': '3px' }],
            dotted: ['точками', { 'text-decoration-style': 'dotted', 'text-decoration-color': ACC(100), 'text-underline-offset': '3px' }],
            dashed: ['пунктиром', { 'text-decoration-style': 'dashed', 'text-decoration-color': ACC(100), 'text-underline-offset': '3px' }],
            double: ['двойной линией', { 'text-decoration-style': 'double', 'text-decoration-color': ACC(100), 'text-underline-offset': '2px' }],
        },
    },
    bq: {
        title: 'Цитата  (> текст)',
        list: {
            card: ['карточка', { 'border-radius': '0 10px 10px 0', padding: '0.45em 0.9em', 'box-shadow': 'inset 0 0 0 100vmax var(--vte-tb, color-mix(in srgb, var(--SmartThemeQuoteColor) 10%, transparent))' }, null, true],
            center: ['по центру между линиями', { 'border-left-style': 'none', 'border-top': `1px solid ${ACC(35)}`, 'border-bottom': `1px solid ${ACC(35)}`, 'text-align': 'center', 'font-style': 'italic', padding: '0.4em 1em' }],
            frame: ['рамка пунктиром', { 'border-left-style': 'dashed', 'border-top': `1px dashed ${ACC(45)}`, 'border-right': `1px dashed ${ACC(45)}`, 'border-bottom': `1px dashed ${ACC(45)}`, 'border-radius': '8px', padding: '0.4em 0.8em' }],
            mark: ['с большой кавычкой', { padding: '0.3em 0.8em' },
                { content: '"\\201C"', 'font-size': '2.2em', 'line-height': '0', 'vertical-align': '-0.4em', 'margin-right': '0.1em', opacity: '0.5', color: 'var(--vte-ta, var(--SmartThemeQuoteColor))' }],
        },
    },
    code: {
        title: '`Код`',
        list: {
            chip: ['плашка с рамкой', { 'background-color': FILL(12), border: `1px solid ${ACC(30)}`, 'border-radius': '6px', padding: '0.05em 0.35em' }, null, true],
            dashed: ['рамка пунктиром', { 'background-color': FILL(0), border: `1px dashed ${ACC(45)}`, 'border-radius': '4px', padding: '0 0.3em' }, null, true],
            plain: ['без фона и рамки', { 'background-color': 'transparent', border: 'none', padding: '0' }],
        },
    },
};
/* Где пишется каждый вид: основной селектор и слой ::before */
const TS_SEL = {
    q: ['q', null], em: ['em', 'emB'], strong: ['strong', null], u: ['u', null], bq: ['quote', 'quoteB'], code: ['code', null],
};
const TS_KEY = { q: 'qStyle', em: 'emStyle', strong: 'strongStyle', u: 'uStyle', bq: 'bqStyle', code: 'codeStyle' };
/* Знаки для линии: [ключ, подпись, символ в CSS] */
const HR_SIGNS = [
    ['heart', '♥ сердечко', '\\2665'], ['heart2', '❤ сердце', '\\2764'], ['star', '✦ звёздочка', '\\2726'],
    ['flower', '✿ цветок', '\\273F'], ['leaf', '❦ завиток', '\\2766'], ['moon', '☾ луна', '\\263E'], ['dot', '• точка', '\\2022'],
];
const TS_PRE = { q: 'q', em: 'em', strong: 'strong', u: 'u', bq: 'bq', code: 'code' };

/* Готовые наборы — сразу для всех видов разметки */
const TEXT_SETS = [
    ['soft', 'Мягкий', { q: 'pill', em: 'pencil', strong: '', u: '', bq: 'card', code: 'chip' }],
    ['book', 'Книжный', { q: 'italic', em: 'soft', strong: 'caps', u: 'dotted', bq: 'center', code: 'plain' }],
    ['strict', 'Строгий', { q: 'frame', em: 'dotted', strong: 'line', u: 'dashed', bq: 'center', code: 'chip' }],
    ['air', 'Воздушный', { q: 'frame', em: 'wavy', strong: 'line', u: 'wavy', bq: 'mark', code: 'dashed' }],
    ['clear', 'Убрать все шаблоны', { q: '', em: '', strong: '', u: '', bq: '', code: '' }],
];

function textStyleRules(put, r, v) {
    for (const [el, def] of Object.entries(TEXT_STYLES)) {
        const [mainK, beforeK] = TS_SEL[el];
        const chosen = v?.[TS_KEY[el]] || '';
        const cur = def.list[chosen];
        const main = S[mainK](r);
        // Пишем все свойства всех шаблонов этого вида: смена шаблона стирает прошлый
        const props = new Set(Object.values(def.list).flatMap(x => Object.keys(x[1])));
        for (const p of props) put(main, p, cur?.[1]?.[p] ?? '');
        put(main, '--vte-st', cur ? chosen : '');
        const pre = TS_PRE[el];
        put(main, '--vte-ta', cur ? (v[`${pre}Acc`] || '') : '');
        put(main, '--vte-tb', cur && cur[3] ? (v[`${pre}Fill`] || '') : '');
        if (beforeK) {
            const bProps = new Set(Object.values(def.list).flatMap(x => Object.keys(x[2] || {})));
            for (const p of bProps) put(S[beforeK](r), p, cur?.[2]?.[p] ?? '');
        }
    }
}

function readTextStyles(get, r) {
    const o = {};
    for (const el of Object.keys(TEXT_STYLES)) {
        const name = get(S[TS_SEL[el][0]](r), '--vte-st');
        o[TS_KEY[el]] = TEXT_STYLES[el].list[name] ? name : '';
        o[`${TS_PRE[el]}Acc`] = get(S[TS_SEL[el][0]](r), '--vte-ta');
        o[`${TS_PRE[el]}Fill`] = get(S[TS_SEL[el][0]](r), '--vte-tb');
    }
    return o;
}

function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip(rules.get(sel)?.get(prop));

    // Пузырь: какая цель задана — «всё сообщение» или «текст с ником»
    const hasBox = (t) => ROLES.some(r => rules.get(S.box(r, t))?.size);
    s.target = hasBox('text') ? 'text' : !hasBox('block') && hasBox('mes') ? 'mes' : 'block';

    for (const g of Object.keys(ROLE_GROUPS)) {
        const rd = (r) => READ[g](get, r, s.target);
        const all = rd('all'), bot = rd('bot'), user = rd('user');
        const split = !isEmpty(bot) || !isEmpty(user);
        s.link[g] = !split;
        const merge = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, b[k] || a[k]]));
        const fix = (o) => { for (const k of Object.keys(o)) if (/^(btn|ed)Corner$/.test(k) && !o[k]) o[k] = 'top-right'; return o; };
        Object.assign(s.bot, fix(split ? merge(all, bot) : all));
        Object.assign(s.user, fix(split ? merge(all, user) : all));
    }

    /* значки кнопок */
    for (const [, list] of GLYPHS) {
        for (const [cls] of list) {
            const sel = glyphSel(cls);
            const bg = get(sel, 'background').match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/);
            if (bg) { s.glyphs[cls] = { img: bg[1] ?? bg[2] ?? bg[3] }; continue; }
            const c = get(sel, 'content').match(/^["']\\([0-9a-f]{2,5})["']$/i);
            if (c) s.glyphs[cls] = { code: c[1].toLowerCase(), brand: /Brands/i.test(get(sel, 'font-family')) };
        }
    }

    s.rightSpace = num(get(G.mes, '--mes-right-spacing'));
    s.gapMes = num(get(G.chat, 'margin-bottom'));

    /* бейджи */
    const disp = get(G.wrap, 'display');
    const wd = get(G.wrap, 'flex-direction');
    const bmode = get(G.badges, '--vte-badge-mode');
    s.badgeMode = bmode || (disp === 'grid' ? 'onBottom' : wd === 'column' ? 'stack' : wd === 'row' ? 'row' : '');
    const js = get(G.badges, 'justify-self');
    s.badgeAlign = ({ 'flex-start': 'start', 'flex-end': 'end', start: 'start', end: 'end' })[get(G.wrap, 'align-items') || js] || 'center';
    [s.badgeX, s.badgeY] = tr(get(G.badges, 'transform'));
    s.badgeGap = num(get(G.wrap, 'gap')) || num(get(G.badges, '--vte-badge-gap')) || s.badgeGap;
    s.badgeStair = num(get(G.badges, '--vte-badge-stair')) || s.badgeStair;
    s.badgeSize = num(get(G.badges, 'font-size'));
    s.badgeColor = get(G.badges, 'color');
    s.badgeBg = get(G.badges, 'background-color');
    s.badgeRadius = num(get(G.badges, 'border-radius'));
    s.badgePad = num(get(G.badges, 'padding'));

    /* полоса прокрутки */
    {
        const hid = (c, e, p) => get(ck(c, e), 'scrollbar-width') === 'none' || get(ck(c, `${p}::-webkit-scrollbar`), 'display') === 'none';
        for (const [scope, e, p] of [['chat', '#chat', '#chat'], ['all', '*', '']]) {
            const inBoth = hid('', e, p), inPh = hid(DEV.phone, e, p), inPc = hid(DEV.pc, e, p);
            if (inBoth || inPh || inPc) { s.sbScope = scope; s.sbHide = inBoth ? 'both' : inPh ? 'phone' : 'pc'; }
            for (const [where, c] of [['both', ''], ['phone', DEV.phone], ['pc', DEV.pc]]) {
                const bar = get(ck(c, `${p}::-webkit-scrollbar`), 'width');
                const th = ck(c, `${p}::-webkit-scrollbar-thumb`);
                const tc = get(th, 'background-color'), bi = get(th, 'background-image');
                const tr2 = get(ck(c, `${p}::-webkit-scrollbar-track`), 'background-color');
                if (!bar && !tc && !bi && !tr2 && !get(th, 'border-radius')) continue;
                s.sbScope = scope;
                s.sbWhere = where;
                s.sbW = num(bar);
                s.sbThumb = tc === 'transparent' ? '' : tc;
                s.sbTrack = tr2;
                s.sbRadius = num(get(th, 'border-radius'));
                const m = bi.match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/);
                s.sbImg = m ? (m[1] ?? m[2] ?? m[3]) : '';
                s.sbFit = get(th, 'background-size') === 'contain' ? 'contain' : 'stretch';
            }
        }
    }

    /* фон чата */
    {
        const u = (v) => { const m = String(v).match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/); return m ? (m[1] ?? m[2] ?? m[3]) : ''; };
        s.cNoBlur = get(CHAT, 'backdrop-filter') === 'none';
        s.cImg = u(get(CH_IMG, 'background-image'));
        Object.assign(s, readChatTint(s.cImg ? get(CH_TINT, 'background-color') : get(CHAT, 'background-color')));
        if (s.cImg) {
            const op = get(CH_IMG, 'opacity');
            s.cImgOp = op ? Math.round(parseFloat(op) * 100) : 100;
            s.cFit = get(CH_IMG, 'background-repeat') === 'repeat' ? 'repeat' : get(CH_IMG, 'background-size') === 'contain' ? 'contain' : 'cover';
            s.cPos = get(CH_IMG, 'background-position') || 'center';
        }
    }

    const any = [...rules.keys()].some(k => (/\.mes\b|scrollbar/.test(k) || k.startsWith('#sheld') || k === CHAT) && rules.get(k)?.size);
    s.on = any;
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
function buildRules(s) {
    const rules = {};
    const put = (sel, prop, v) => { (rules[sel] ||= {})[prop] = v; };
    const on = s.on;
    const px = (v) => (v ? `${v}px` : '');

    /** Раздел «бот / пользователь»: общий — одно правило, разведён — два */
    const each = (g, fn) => {
        for (const r of ROLES) {
            const use = on && (s.link[g] ? r === 'all' : r !== 'all');
            fn(r, use ? (r === 'all' ? s.bot : s[r]) : null);
        }
    };

    /* ---------- пузырь ---------- */
    const trimRel = {};
    each('bubble', (r, v) => {
        for (const t of ['block', 'mes', 'text']) {
            const box = S.box(r, t);
            const w = v && s.target === t ? v : null;
            /* Фон короче пузыря (сверху / снизу): фон и рамка переезжают в
               слой ::after за текстом, а сам пузырь и текст не двигаются */
            const trim = !!(w && (w.trimT || w.trimB));
            const A = `${box}::after`;
            const line = w && w.bw ? `${w.bw}px solid ${w.bc || 'currentColor'}` : '';
            put(box, 'background-color', trim ? 'transparent' : (w?.bg || ''));
            put(box, 'isolation', trim ? 'isolate' : '');
            if (trim && t === 'block') trimRel[r] = true;
            put(box, 'position', trim && t !== 'block' ? 'relative' : '');
            put(A, 'content', trim ? '""' : '');
            put(A, 'position', trim ? 'absolute' : '');
            put(A, 'left', trim ? '0' : '');
            put(A, 'right', trim ? '0' : '');
            put(A, 'top', trim ? `${w.trimT || 0}px` : '');
            put(A, 'bottom', trim ? `${w.trimB || 0}px` : '');
            put(A, 'z-index', trim ? '-1' : '');
            put(A, 'pointer-events', trim ? 'none' : '');
            put(A, 'background-color', trim ? (w.bg || '') : '');
            put(A, 'border', trim ? line : '');
            put(A, 'border-radius', trim ? 'inherit' : '');
            // Цвет ещё не выбран — обводка цвета текста, толщина не теряется
            put(box, 'border', trim ? (line ? 'none' : '') : line);
            put(box, 'border-radius', w && w.radius ? `${w.radius}px` : '');
            put(box, 'padding-top', px(w?.padT));
            put(box, 'padding-bottom', px(w?.padB));
            put(box, 'padding-left', px(w?.padX));
            put(box, 'padding-right', px(w?.padX));
            put(box, 'max-width', w && w.maxW ? `${w.maxW}%` : '');
            // Сообщаем отступ «Аватаркам»: во всю ширину — до этой рамки
            put(box, '--vte-mes-pl', t === 'mes' && w?.padX ? `${w.padX}px` : '');
            put(box, '--vte-mes-pr', t === 'mes' && w?.padX ? `${w.padX}px` : '');
            put(box, 'box-sizing', w && (w.padX || w.bw || w.maxW) ? 'border-box' : '');
        }
    });

    /* ---------- цвета текста ---------- */
    each('colors', (r, v) => {
        put(S.text(r), '--SmartThemeEmColor', v?.cEm || '');
        put(S.text(r), '--SmartThemeQuoteColor', v?.cQuote || '');
        put(S.text(r), '--SmartThemeUnderlineColor', v?.cU || '');
        put(S.strong(r), 'color', v?.cStrong || '');
        put(S.link(r), 'color', '');

        /* Цитата. В ST: полоса слева цвета кавычек и тёмный фон */
        put(S.quote(r), 'color', v?.bqText || '');
        put(S.quote(r), 'border-left-color', v?.bqBar || '');
        put(S.quote(r), 'border-left-width', v?.bqBarW ? `${v.bqBarW}px` : '');
        put(S.quote(r), 'background-color', v?.bqBg || '');

        /* Горизонтальная линия. В ST это не рамка, а градиент, тающий к
           краям, высотой 1px и видимостью 40%. «Тающая» — тот же градиент
           своим цветом; «сплошная» — заливка; пунктир и точки — рамка */
        const hs = v?.hrStyle || '';
        const hc = v?.hrColor || (hs ? 'currentColor' : '');
        const ht = v?.hrThick || (hs ? 1 : 0);
        const hrOn = !!(v && (hs || v.hrColor || v.hrThick));
        const kind = hs || 'fade';
        const line = kind === 'dashed' || kind === 'dotted';
        const sign = kind === 'sign' || kind === 'signFade';
        put(S.hr(r), '--vte-hr-color', v?.hrColor || '');
        put(S.hr(r), '--vte-hr-style', hs);
        put(S.hr(r), '--vte-hr-thick', v?.hrThick ? String(v.hrThick) : '');
        /* Линия со знаком посередине: линия — фон (как у самой ST, градиент
           с разрывом под знак), знак — ::after по центру. Никакой подложки
           под знаком не нужно — разрыв в самой линии */
        const gap = 'calc(50% - 0.9em), transparent calc(50% - 0.9em) calc(50% + 0.9em)';
        const signBg = kind === 'sign'
            ? `linear-gradient(90deg, ${hc} ${gap}, ${hc} calc(50% + 0.9em))`
            : `linear-gradient(90deg, transparent, ${hc} ${gap}, ${hc} calc(50% + 0.9em), transparent)`;
        put(S.hr(r), 'background-image', hrOn ? (kind === 'fade' ? `linear-gradient(90deg, transparent, ${hc}, transparent)` : sign ? signBg : 'none') : '');
        put(S.hr(r), 'background-color', hrOn && kind === 'solid' ? hc : '');
        put(S.hr(r), 'height', hrOn ? (line ? '0' : sign ? '1.2em' : `${ht}px`) : '');
        put(S.hr(r), 'min-height', hrOn ? (line ? '0' : sign ? '1.2em' : `${ht}px`) : '');
        put(S.hr(r), 'background-size', sign ? `100% ${ht}px` : '');
        put(S.hr(r), 'background-position', sign ? 'center' : '');
        put(S.hr(r), 'background-repeat', sign ? 'no-repeat' : '');
        put(S.hr(r), 'position', sign ? 'relative' : '');
        put(S.hr(r), 'overflow', sign ? 'visible' : '');
        put(S.hr(r), 'border', sign ? 'none' : '');
        put(S.hr(r), '--vte-hr-sign', sign ? (v.hrSign || 'heart') : '');
        const HA = S.hrA(r);
        put(HA, 'content', sign ? `"${(HR_SIGNS.find(x => x[0] === (v.hrSign || 'heart')) || HR_SIGNS[0])[2]}"` : '');
        put(HA, 'position', sign ? 'absolute' : '');
        put(HA, 'left', sign ? '50%' : '');
        put(HA, 'top', sign ? '50%' : '');
        put(HA, 'transform', sign ? 'translate(-50%, -50%)' : '');
        put(HA, 'line-height', sign ? '1' : '');
        put(HA, 'font-size', sign ? '1em' : '');
        put(HA, 'color', sign ? (v.hrSignColor || hc) : '');
        put(S.hr(r), 'border-top', hrOn && line ? `${ht}px ${kind} ${hc}` : '');
        put(S.hr(r), 'opacity', v?.hrOp ? String(r2(v.hrOp / 100)) : '');

        textStyleRules(put, r, v);
    });

    /* ---------- текст целиком ---------- */
    each('textall', (r, v) => {
        // Размер текста: ST считает высоту строки от --mainFontSize, поэтому
        // меняем и её — строки не слипаются и не разъезжаются
        const fs = v ? fluid(v.fsMin, v.fsMax) : '';
        put(S.text(r), 'font-size', fs);
        put(S.text(r), '--mainFontSize', fs);
        put(S.text(r), 'color', v?.cText || '');
        put(S.text(r), 'line-height', v?.tLh ? String(r2(v.tLh / 100)) : '');
        put(S.text(r), 'letter-spacing', v?.tLetter ? `${r2(v.tLetter / 100)}em` : '');
        put(S.text(r), 'hyphens', v?.tHyph ? 'auto' : '');
        put(S.text(r), '-webkit-hyphens', v?.tHyph ? 'auto' : '');
        // Тень под буквами ST рисует на каждом сообщении — без неё легче
        put(S.text(r), 'text-shadow', v?.tNoShadow ? 'none' : '');
        /* Фон под буквами: абзац становится строчным — фон тогда идёт по
           строкам и кончается там, где кончается текст (с clone у каждой
           строки свои края). Конец абзаца — блок ::after: он переносит
           строку и держит расстояние между абзацами */
        const lines = !!v?.tBg && !v?.tBgBlock;
        const indent = v?.tIndent ? `${r2(v.tIndent / 10)}em` : '';
        put(S.para(r), 'display', lines ? 'inline' : '');
        put(S.para(r), 'box-decoration-break', lines ? 'clone' : '');
        put(S.para(r), '-webkit-box-decoration-break', lines ? 'clone' : '');
        put(S.para(r), 'line-height', lines && v?.tBgPad ? `calc(1em * ${r2((v.tLh || 150) / 100)} + ${v.tBgPad}px)` : '');
        put(S.paraA(r), 'content', lines ? '""' : '');
        put(S.paraA(r), 'display', lines ? 'block' : '');
        put(S.paraA(r), 'height', lines ? (v.tPGap ? `${v.tPGap}px` : '0.6em') : '');
        put(S.para(r), 'margin-bottom', !lines && v?.tPGap ? `${v.tPGap}px` : '');
        put(S.para(r), 'text-indent', !lines ? indent : '');
        // Строчному абзацу красную строку не даём: браузер повторяет отступ
        // у каждого кусочка фона, и следующий абзац уезжал вправо
        put(S.para(r), 'margin-left', '');
        // Фон: отступ — насколько фон больше текста
        put(S.para(r), 'background-color', v?.tBg || '');
        // По строкам фон шире текста за счёт теней без размытия, а не отступа:
        // у отступа по бокам остаётся пустой кусочек на следующей строке
        put(S.para(r), 'padding', v?.tBgPad ? (lines ? `${Math.round(v.tBgPad / 2)}px 0` : `${v.tBgPad}px ${Math.round(v.tBgPad * 1.4)}px`) : '');
        put(S.para(r), 'box-shadow', lines && v?.tBgPad && v?.tBg ? `-${v.tBgPad}px 0 0 ${v.tBg}, ${v.tBgPad}px 0 0 ${v.tBg}` : '');
        put(S.para(r), 'border-radius', v?.tBgRad ? `${v.tBgRad}px` : '');
        // Рамка — только прямоугольником: по строкам у неё тоже оставались бы кусочки
        put(S.para(r), 'border', v?.tBgBw && !lines ? `${v.tBgBw}px ${v.tBgBs || 'solid'} ${v.tBgBc || 'currentColor'}` : '');
    });

    /* ---------- положение текста ----------
       Вверх-вниз — отступ под строкой ника: под ней идёт то, что есть
       (рассуждения или сразу текст), расстояние одинаковое всегда. */
    let lifted = false;
    let textFullAll = false;   // «во всю ширину» в общем правиле — перенос слов не затирать
    each('text', (r, v) => {
        if (v && v.offY < 0) lifted = true;
        put(S.chname(r), 'margin-bottom', px(v?.offY));
        // У рассуждений в ST свой отступ сверху — при заданном сдвиге убираем
        put(S.reason(r), 'margin-top', v?.offY ? '0' : '');
        put(S.text(r), 'margin-top', '');   // старая схема

        /* Ширина и выравнивание. В ST у текста справа padding 30px — место
           под стрелки свайпа (они есть только у последнего сообщения). Из-за
           него отступы от краёв пузыря разные. Задаёшь ширину или
           выравнивание — этот запас убираем, а место под стрелки остаётся
           только у последнего сообщения, снизу. Блок текста встаёт в пузыре
           слева, по центру или справа — отступы по бокам одинаковые. */
        const al = v?.textAlign || '';
        // Во всю ширину — как в теме Rusreal: текст от края до края блока,
        // без запаса 30px справа, длинные слова переносятся, а не режутся
        const full = !!v?.textFull;
        if (full && r === 'all') textFullAll = true;
        put(S.text(r), '--vte-text-full', full ? '1' : '');
        const shaped = !!(v && (full || v.textW || al));
        const W = full ? '100%' : v?.textW ? `${v.textW}%` : '';
        const [ml, mr] = !shaped ? ['', ''] : full ? ['0', '0'] : al === 'left' ? ['0', 'auto'] : al === 'right' ? ['auto', '0'] : ['auto', 'auto'];
        if (r !== 'all') put(S.text(r), 'overflow-wrap', full ? 'anywhere' : '');
        for (const sel of [S.text(r), S.reason(r)]) {
            put(sel, 'width', W);
            put(sel, 'box-sizing', W ? 'border-box' : '');
            put(sel, 'margin-left', shaped ? ml : px(v?.offX));
            put(sel, 'margin-right', shaped ? mr : '');
            // Со своим выравниванием сдвиг вбок идёт поверх, а не вместо него
            put(sel, 'position', shaped && v.offX ? 'relative' : '');
            put(sel, 'left', shaped && v.offX ? `${v.offX}px` : '');
        }
        put(S.text(r), 'text-align', al);
        put(S.text(r), 'padding-right', shaped ? '0' : '');
        // У блока с текстом в ST отступ только слева (от аватарки) — ставим
        // такой же справа, чтобы «по центру» было по центру пузыря
        put(S.blockR(r), 'padding-right', shaped ? `${blockPadLeft(r)}px` : '');
        put(S.lastText(r), 'padding-bottom', shaped ? 'calc(25px + var(--swipeCounterHeight, 15px) + var(--swipeCounterMargin, 5px))' : '');
    });
    put(OLD.botReason, 'margin-top', '');
    put(OLD.botReason, 'margin-left', '');
    put(OLD.botAfterReason, 'margin-top', '');

    /* ---------- ник и дата ---------- */
    let nameMovedAny = false;
    // Какие роли используют блок с текстом как опору (угол пузыря)
    const blockRel = { all: false, bot: false, user: false };
    each('names', (r, v) => {
        const corner = v?.nameCorner || '';
        const moved = !!(v && (v.nameX || v.nameY)) && !corner;
        if (moved || corner) nameMovedAny = true;
        if (corner) blockRel[r] = true;
        const [cy, cx] = corner ? corner.split('-') : [];
        const dp = v?.datePos || '';
        const wrapDate = dp === 'below' || dp === 'above';
        put(S.nameRow(r), '--vte-corner', corner);
        put(S.nameRow(r), 'transform', moved ? `translate(${v.nameX}px, ${v.nameY}px)` : '');
        put(S.nameRow(r), 'position', corner ? 'absolute' : moved ? 'relative' : '');
        put(S.nameRow(r), 'z-index', moved || corner ? '4' : '');
        for (const side of ['top', 'bottom', 'left', 'right']) {
            const d = side === cy ? v.nameY : side === cx ? v.nameX : null;
            put(S.nameRow(r), side, corner && d != null ? `${d}px` : '');
        }
        put(S.nameRow(r), 'display', dp ? 'flex' : '');
        put(S.nameRow(r), 'align-items', dp ? 'baseline' : '');
        put(S.nameRow(r), 'column-gap', dp ? '6px' : '');
        put(S.nameRow(r), 'flex-wrap', wrapDate ? 'wrap' : '');
        put(S.date(r), 'flex-basis', wrapDate ? '100%' : '');
        put(S.date(r), 'order', dp === 'above' || dp === 'before' ? '-1' : '');
        put(S.date(r), 'margin-left', wrapDate ? '0' : '');
        const dm = !!(v && (v.dateX || v.dateY));
        put(S.date(r), 'transform', dm ? `translate(${v.dateX}px, ${v.dateY}px)` : '');
        put(S.date(r), 'display', dm ? 'inline-block' : '');
        put(S.chname(r), 'overflow', moved ? 'visible' : '');

        put(S.nameText(r), 'font-size', px(v?.nameSize));
        put(S.nameText(r), 'color', v?.nameColor || '');
        put(S.nameText(r), 'white-space', v?.nameNoWrap ? 'nowrap' : '');
        put(S.nameText(r), 'max-width', v?.nameWidth ? `${v.nameWidth}%` : '');
        put(S.nameText(r), 'overflow', v?.nameWidth ? 'hidden' : '');
        put(S.nameText(r), 'text-overflow', v?.nameWidth ? 'ellipsis' : '');
        put(S.date(r), 'font-size', px(v?.dateSize));
        put(S.date(r), 'color', v?.dateColor || '');
    });

    /* ---------- кнопки сообщения ----------
       Строка ника: кнопки остаются в ней и сдвигаются от своего места
       (position: relative — соседи не толкаются). «Сразу после ника»: имя
       перестаёт растягиваться на всю строку, кнопки идут следом за датой.
       Угол блока с текстом: блок становится опорой, кнопки встают в его
       угол. Сдвиги — clamp «телефон → ПК». display не трогаем: ST сам
       показывает и прячет кнопки встроенными стилями. */
    let btnOut = false;
    each('buttons', (r, v) => {
        const placeBox = (sel, pre) => {
            const p = v?.[`${pre}Place`] || '';
            const abs = p === 'block';
            if (abs) btnOut = true;
            const [cy, cx] = String(v?.[`${pre}Corner`] || 'top-right').split('-');
            const X = p ? fluidSigned(v[`${pre}XMin`], v[`${pre}XMax`]) : '';
            const Y = p ? fluidSigned(v[`${pre}YMin`], v[`${pre}YMax`]) : '';
            put(sel, '--vte-place', p);
            put(sel, 'position', p ? (abs ? 'absolute' : 'relative') : '');
            put(sel, 'z-index', p ? '5' : '');
            put(sel, 'top', abs ? (cy === 'top' ? (Y || '0') : '') : (p ? Y : ''));
            put(sel, 'bottom', abs && cy === 'bottom' ? (Y || '0') : '');
            put(sel, 'left', abs ? (cx === 'left' ? (X || '0') : '') : (p ? X : ''));
            put(sel, 'right', abs && cx === 'right' ? (X || '0') : '');
            put(sel, 'float', abs ? 'none' : '');
            return p;
        };
        const pb = placeBox(S.btns(r), 'btn');
        const pe = placeBox(S.edit(r), 'ed');
        /* Поверх: кнопки выше текста, аватарки и соседних сообщений, их не
           режет край пузыря. Сообщение под пальцем/мышью поднимается над
           соседними — иначе следующее сообщение перекрыло бы кнопки */
        const top = !!v?.btnTop;
        if (top) btnOut = true;
        for (const [sel, p] of [[S.btns(r), pb], [S.edit(r), pe]]) {
            if (!p) put(sel, 'position', top ? 'relative' : '');
            put(sel, 'z-index', top ? '100' : p ? '5' : '');
        }
        put(`${base(r)}:is(:hover, :focus-within)`, 'z-index', top ? '5' : '');
        // опора для «в углу блока с текстом»
        if (pb === 'block' || pe === 'block') blockRel[r] = true;
        // «сразу после ника»
        const after = pb === 'after' || pe === 'after';
        put(S.nameBox(r), 'flex-grow', after ? '0' : '');
        put(S.chname(r), 'justify-content', after ? 'flex-start' : '');
        put(S.chname(r), 'column-gap', after ? '6px' : '');

        const col = v?.btnDir === 'column';
        put(S.btnRows(r), 'flex-direction', col ? 'column' : '');
        put(S.btnRows(r), 'align-items', col ? 'center' : '');
        put(S.btnRows(r), 'gap', px(v?.btnGap));
        const fs = v ? fluid(v.btnSMin, v.btnSMax) : '';
        put(S.btnAll(r), 'font-size', fs);
        put(S.btnAll(r), 'color', v?.btnColor || '');
        put(S.btnAll(r), 'opacity', v?.btnOpacity ? String(r2(v.btnOpacity / 100)) : '');
        put(S.btnHover(r), 'opacity', v?.btnHover ? String(r2(v.btnHover / 100)) : '');
        put(S.btnAll(r), 'background-color', v?.btnBg || '');
        put(S.btnAll(r), 'border-radius', px(v?.btnRadius));
        put(S.btnAll(r), 'padding', v?.btnPad ? `${v.btnPad}px ${Math.round(v.btnPad * 1.5)}px` : '');
        // Тень под значками — лишняя работа браузеру на каждом сообщении
        put(S.btnAll(r), 'filter', v?.btnNoShadow ? 'none' : '');
        put(S.edit(r), 'filter', v?.btnNoShadow ? 'none' : '');
        put(S.edit(r), 'column-gap', px(v?.edGap));
        put(S.editBtn(r), 'height', px(v?.edSize));
        put(S.editBtn(r), 'font-size', v?.edSize ? `${Math.round(v.edSize * 0.5)}px` : '');
        // Кнопки правки: цвет, фон и видимость — свои или как у основных
        const same = !!v?.edSame;
        put(S.editBtn(r), '--vte-same', same ? '1' : '');
        put(S.editBtn(r), 'color', same ? (v.btnColor || '') : (v?.edColor || ''));
        put(S.editBtn(r), 'background-color', same ? (v.btnBg || '') : (v?.edBg || ''));
        put(S.editBtn(r), 'opacity', same
            ? (v.btnOpacity ? String(r2(v.btnOpacity / 100)) : '')
            : (v?.edOpacity ? String(r2(v.edOpacity / 100)) : ''));
        put(S.editBtn(r), 'border-radius', px(v?.edRadius));

        /* Панель «…»: по умолчанию — как основные кнопки и едет с ними.
           «Отдельно» — свой вид, своя видимость и свой сдвиг от места
           (position: relative — соседей не толкает). display не трогаем */
        const own = !!v?.exOwn;
        const EX = S.extra(r);
        const exX = own ? fluidSigned(v.exXMin, v.exXMax) : '';
        const exY = own ? fluidSigned(v.exYMin, v.exYMax) : '';
        put(EX, '--vte-own', own ? '1' : '');
        put(EX, 'position', exX || exY ? 'relative' : '');
        put(EX, 'left', exX);
        put(EX, 'top', exY);
        put(EX, 'z-index', exX || exY ? '6' : '');
        put(EX, 'flex-direction', own ? (v.exDir || '') : '');
        put(EX, 'align-items', own && v.exDir === 'column' ? 'center' : '');
        put(EX, 'gap', own ? px(v.exGap) : '');
        put(S.exBtn(r), 'font-size', own ? fluid(v.exSMin, v.exSMax) : '');
        put(S.exBtn(r), 'color', own ? (v.exColor || '') : '');
        put(S.exBtn(r), 'opacity', own && v.exOpacity ? String(r2(v.exOpacity / 100)) : '');
        put(S.exHover(r), 'opacity', own && v.exHover ? String(r2(v.exHover / 100)) : '');
        put(S.exBtn(r), 'background-color', own ? (v.exBg || '') : '');
        put(S.exBtn(r), 'border-radius', own ? px(v.exRadius) : '');
        put(S.exBtn(r), 'padding', own && v.exPad ? `${v.exPad}px ${Math.round(v.exPad * 1.5)}px` : '');

        // Подложки под группами кнопок
        panRules(put, S.btns(r), v, 'btn');
        panRules(put, EX, own ? v : null, 'ex');
        panRules(put, S.edit(r), v, 'ed');
    });

    // Опора для «в углу пузыря» (ник, кнопки) — одна строка на роль
    for (const r of ROLES) put(S.box(r, 'block'), 'position', blockRel[r] || trimRel[r] ? 'relative' : '');

    /* ---------- значки кнопок ---------- */
    for (const [, list] of GLYPHS) {
        for (const [cls] of list) {
            const g = on ? s.glyphs?.[cls] : null;
            const sel = glyphSel(cls);
            const fa = g && g.code ? g : null;
            const img = g && g.img ? g.img : '';
            put(sel, 'content', fa ? `"\\${fa.code}"` : img ? '""' : '');
            put(sel, 'font-family', fa?.brand ? '"Font Awesome 6 Brands"' : '');
            // ST у пары кнопок ставит fa-regular: у бесплатных значков Font
            // Awesome тонкого начертания почти нет — жирный рисуется всегда
            put(sel, 'font-weight', fa ? (fa.brand ? '400' : '900') : '');
            put(sel, 'background', img ? `url("${String(img).replace(/["\\\n\r]/g, encodeURIComponent)}") center / contain no-repeat` : '');
            put(sel, 'display', img ? 'inline-block' : '');
            put(sel, 'width', img ? '1em' : '');
            put(sel, 'height', img ? '1em' : '');
            put(sel, 'vertical-align', img ? 'middle' : '');
        }
    }

    /* ---------- полоса прокрутки ----------
       Скрыть — scrollbar-width: none (Firefox и новый Chrome) и
       ::-webkit-scrollbar { display: none } (Chrome, Android, Safari):
       полосы нет, листать можно как раньше — колёсиком и пальцем.
       Телефон и ПК различаем по устройству, а не по ширине окна. */
    {
        const pfx = s.sbScope === 'all' ? '' : '#chat';
        const el = s.sbScope === 'all' ? '*' : '#chat';
        const hideIn = !on || !s.sbHide ? [] : s.sbHide === 'both' ? [''] : [DEV[s.sbHide]];
        for (const c of ['', DEV.phone, DEV.pc]) {
            for (const [e, p] of [['*', ''], ['#chat', '#chat']]) {
                const mine = e === el;
                put(ck(c, e), 'scrollbar-width', mine && hideIn.includes(c) ? 'none' : '');
                put(ck(c, `${p}::-webkit-scrollbar`), 'display', mine && hideIn.includes(c) ? 'none' : '');
            }
        }
        // Вид — там, где полоса не спрятана
        const styleIn = on && s.sbWhere !== s.sbHide && s.sbHide !== 'both' ? (s.sbWhere === 'both' ? '' : DEV[s.sbWhere]) : null;
        const img = styleIn != null && s.sbImg
            ? `url("${String(s.sbImg).replace(/["\\\n\r]/g, encodeURIComponent)}")` : '';
        for (const c of ['', DEV.phone, DEV.pc]) {
            for (const p of ['', '#chat']) {
                const act = styleIn === c && p === pfx;
                const bar = ck(c, `${p}::-webkit-scrollbar`), thumb = ck(c, `${p}::-webkit-scrollbar-thumb`), track = ck(c, `${p}::-webkit-scrollbar-track`);
                put(bar, 'width', act && s.sbW ? `${s.sbW}px` : '');
                put(bar, 'height', act && s.sbW ? `${s.sbW}px` : '');
                put(thumb, 'border-radius', act && s.sbRadius ? `${s.sbRadius}px` : '');
                // Своя картинка: целиком на ползунке, без рамки и тени ST
                put(thumb, 'background-image', act ? img : '');
                put(thumb, 'background-size', act && img ? (s.sbFit === 'contain' ? 'contain' : '100% 100%') : '');
                put(thumb, 'background-position', act && img ? 'center' : '');
                put(thumb, 'background-repeat', act && img ? 'no-repeat' : '');
                put(thumb, 'background-color', act && img ? 'transparent' : (act ? s.sbThumb : ''));
                put(thumb, 'background-clip', act && img ? 'border-box' : '');
                put(thumb, 'border', act && img ? 'none' : '');
                put(thumb, 'box-shadow', act && img ? 'none' : '');
                put(track, 'background-color', act ? s.sbTrack : '');
            }
        }
        // Firefox не знает ::-webkit-scrollbar — ему цвета отдельно (только «везде»)
        const ff = styleIn === '' && (s.sbThumb || s.sbTrack);
        for (const e of ['*', '#chat']) {
            put(ck(FF, e), 'scrollbar-color', ff && e === el ? `${s.sbThumb || 'auto'} ${s.sbTrack || 'transparent'}` : '');
        }
    }

    /* ---------- место справа, обрезка, промежутки ---------- */
    const rs = on && s.rightSpace;
    put(G.mes, '--mes-right-spacing', rs ? `${s.rightSpace}px` : '');
    put(G.text, 'overflow-wrap', rs || textFullAll ? 'anywhere' : '');
    put(G.chname, 'min-width', rs ? '0' : '');
    // ST режет всё, что вылезает за край блока, — поднятый текст пропадал
    // сверху. Сверху открываем при подъёме текста или сдвиге ника; по бокам
    // режем (clip, а не hidden — иначе браузер добавит прокрутку)
    // Кнопки в углу блока можно вынести и за край — тогда не режем
    const openX = (rs && s.rightSpace < 30) || nameMovedAny || btnOut;
    put(G.block, 'overflow', '');
    put(G.block, 'overflow-x', openX ? 'visible' : lifted ? 'clip' : '');
    put(G.block, 'overflow-y', lifted || nameMovedAny || btnOut ? 'visible' : '');
    put(G.chat, 'margin-bottom', on && s.gapMes ? `${s.gapMes}px` : '');

    /* ---------- бейджи ----------
       Потоком (стопка / строка / лесенка): выключенный или пустой бейдж не
       занимает места, остальные встают на его место.
       На аватарке: обёртка становится сеткой, аватарка занимает её целиком,
       бейджи ложатся на её нижний (или верхний) край. Высота обёртки =
       высота аватарки, поэтому ник стоит на одном месте в любом сообщении. */
    const bm = on && s.badgeMode ? s.badgeMode : '';
    const grid = bm === 'onBottom' || bm === 'onTop';
    const flow = bm && !grid;
    const al = { start: 'flex-start', center: 'center', end: 'flex-end' }[s.badgeAlign] || 'center';
    put(G.wrap, 'display', grid ? 'grid' : flow ? 'flex' : '');
    put(G.wrap, 'flex-direction', flow ? (bm === 'row' ? 'row' : 'column') : '');
    put(G.wrap, 'flex-wrap', bm === 'row' ? 'wrap' : '');
    put(G.wrap, 'align-items', flow ? al : '');
    put(G.wrap, 'justify-content', bm === 'row' ? al : '');
    put(G.wrap, 'gap', flow ? `${s.badgeGap}px` : '');
    put(G.wrap, 'grid-template-columns', grid ? '100%' : '');
    put(G.wrap, 'grid-template-rows', bm === 'onBottom' ? '1fr auto auto auto' : bm === 'onTop' ? 'auto auto auto 1fr' : '');
    // У аватарки в ST flex: 1 — в колонке это растягивает её вместо
    // заданной высоты. Держим ровно свой размер
    put(G.av, 'flex', bm === 'row' ? '0 0 100%' : flow ? '0 0 auto' : '');
    put(G.av, 'grid-row', grid ? '1 / -1' : '');
    put(G.av, 'grid-column', grid ? '1' : '');

    put(G.badges, 'position', bm ? 'relative' : '');
    put(G.badges, 'z-index', bm ? '5' : '');
    put(G.badges, 'margin', flow ? '0' : grid ? `${Math.round(s.badgeGap / 2)}px 6px` : '');
    put(G.badges, 'white-space', bm ? 'nowrap' : '');
    put(G.badges, 'grid-column', grid ? '1' : '');
    put(G.badges, 'justify-self', grid ? ({ start: 'start', center: 'center', end: 'end' })[s.badgeAlign] || 'center' : '');
    put(G.badges, '--vte-badge-mode', bm || '');
    put(G.badges, '--vte-badge-gap', grid ? `${s.badgeGap}px` : '');
    put(G.badges, '--vte-badge-stair', bm === 'stairs' ? `${s.badgeStair}px` : '');
    put(G.b1, 'grid-row', bm === 'onBottom' ? '2' : bm === 'onTop' ? '1' : '');
    put(G.b2, 'grid-row', bm === 'onBottom' ? '3' : bm === 'onTop' ? '2' : '');
    put(G.b3, 'grid-row', bm === 'onBottom' ? '4' : bm === 'onTop' ? '3' : '');
    const stair = bm === 'stairs' ? ` + var(--vte-bi, 0) * ${s.badgeStair}px` : '';
    put(G.badges, 'transform', bm && (s.badgeX || s.badgeY || stair)
        ? `translate(calc(${s.badgeX}px${stair}), ${s.badgeY}px)` : '');
    put(G.badgesEmpty, 'display', bm ? 'none' : '');
    put(G.stair1, '--vte-bi', bm === 'stairs' ? '1' : '');
    put(G.stair2, '--vte-bi', bm === 'stairs' ? '2' : '');

    put(G.badges, 'font-size', on && s.badgeSize ? `${s.badgeSize}px` : '');
    put(G.badges, 'color', on ? s.badgeColor : '');
    put(G.badges, 'background-color', on ? s.badgeBg : '');
    put(G.badges, 'border-radius', on && s.badgeRadius ? `${s.badgeRadius}px` : '');
    put(G.badges, 'padding', on && s.badgePad ? `${s.badgePad}px ${s.badgePad * 2}px` : '');

    /* ---------- фон чата под пузырями ---------- */
    {
        const tint = on ? chatTint(s) : '';
        const img = on ? s.cImg : '';
        put(CHAT, 'background-color', img ? 'transparent' : tint);
        put(CHAT, 'backdrop-filter', on && s.cNoBlur ? 'none' : '');
        put(CHAT, '-webkit-backdrop-filter', on && s.cNoBlur ? 'none' : '');
        for (const [sel, z] of [[CH_TINT, '28'], [CH_IMG, '29']]) {
            put(sel, 'content', img ? '""' : '');
            put(sel, 'position', img ? 'absolute' : '');
            put(sel, 'inset', img ? '0' : '');
            put(sel, 'z-index', img ? z : '');
            put(sel, 'pointer-events', img ? 'none' : '');
        }
        put(CH_TINT, 'background-color', img ? (tint || CH_VAR) : '');
        put(CH_IMG, 'background-image', img ? `url("${String(img).replace(/["\\\n\r]/g, encodeURIComponent)}")` : '');
        put(CH_IMG, 'background-size', img ? (s.cFit === 'repeat' ? 'auto' : s.cFit) : '');
        put(CH_IMG, 'background-repeat', img ? (s.cFit === 'repeat' ? 'repeat' : 'no-repeat') : '');
        put(CH_IMG, 'background-position', img ? (s.cPos || 'center') : '');
        put(CH_IMG, 'opacity', img && s.cImgOp < 100 ? String(r2(s.cImgOp / 100)) : '');
    }
    return rules;
}

/* ============================================================
   ПРЕДПРОСМОТР — один маленький слой, не чаще раза за кадр
============================================================ */
let previewStyle = null;
let previewRaf = 0;

function paintPreview() {
    previewRaf = 0;
    let css = '';
    for (const [key, decls] of Object.entries(buildRules(state))) {
        const body = Object.entries(decls).filter(([, v]) => v).map(([p, v]) => `${p}:${v} !important`).join(';');
        if (!body) continue;
        const { cond, sel } = splitCond(key);
        css += cond ? `${cond}{${sel}{${body}}}\n` : `${sel}{${body}}\n`;
    }
    if (!previewStyle) {
        previewStyle = document.createElement('style');
        previewStyle.id = 'vte-bubbles-preview';
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
    const list = Object.entries(buildRules(state)).map(([key, decls]) => {
        const { cond, sel } = splitCond(key);
        return { selector: sel, decls, media: cond };
    });
    const changed = await onApply?.(list);
    clearPreview();
    return changed;
}

/* ============================================================
   ОКНО
============================================================ */
export async function showPanel() {
    onSnapshot?.();
    const role = state?.role || 'bot';
    state = readState();
    state.role = role;
    if (!panel) build();
    panel.style.display = 'flex';
    render();
}

export function refresh() {
    if (!isOpen() && !isMarkdownOpen()) return;
    const prev = state;
    const scroll = els.body?.scrollTop || 0;
    state = readState();
    state.role = prev?.role || 'bot';
    // «Отдельно» при пустом разделе в теме не видно (писать ещё нечего) —
    // не склеиваем обратно, пока в разделе ничего не задано
    for (const g of Object.keys(ROLE_GROUPS)) {
        const empty = ROLE_GROUPS[g].every(k => !state.bot[k] && !state.user[k]);
        if (prev && prev.link[g] === false && empty) state.link[g] = false;
    }
    render();
    if (els.body) els.body.scrollTop = scroll;
}

export function hidePanel() {
    clearPreview();
    showHidden(false);
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
        h('div.vte-title', {}, [h('span.vte-title-ic', {}, [icon('fa-comment-dots')]), h('span', { text: 'Пузыри' })]),
        h('div.vte-header-btns', {}, [
            iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close'),
        ]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-bubbles-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-bubbles-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

/* ---------- элементы управления ---------- */
function row(label, control, hint) {
    const key = control?.dataset?.key || control?.querySelector?.('[data-key]')?.dataset.key;
    const th = key ? themeHint(key) : null;
    return h('div.vte-tb-row', { title: hint || '' }, [
        h('span.vte-tb-label', {}, [label, th]),
        control,
    ]);
}

/* ============================================================
   «В ТЕМЕ: …» — что задаёт тема для этой настройки
   Пока настройка «как в теме», под её названием видно, что именно тема
   там ставит. Какие строки CSS пишет настройка, окно узнаёт само: пробует
   поменять её на время и смотрит, что изменилось в правилах (без записи)
============================================================ */
const probeCache = new Map();

function probeValue(key, cur) {
    const d = (GROUP_OF[key] ? roleDefaults() : defaults())[key];
    if (typeof d === 'boolean') return !d;
    if (typeof d === 'number') return d === 7 ? 9 : 7;
    return '#010203';
}

function pairsFor(key) {
    const ck = `${key}|${state.role}|${state.target}|${JSON.stringify(state.link)}`;
    if (probeCache.has(ck)) return probeCache.get(ck);
    let out = [];
    try {
        const saved = state;
        const copy = JSON.parse(JSON.stringify(saved));
        const a = buildRules(saved);
        let b;
        state = copy;
        try { setVal(key, probeValue(key)); b = buildRules(copy); } finally { state = saved; }
        for (const sel of new Set([...Object.keys(a), ...Object.keys(b)])) {
            for (const prop of new Set([...Object.keys(a[sel] || {}), ...Object.keys(b[sel] || {})])) {
                if (prop.startsWith('--vte')) continue;
                if ((a[sel]?.[prop] || '') !== (b[sel]?.[prop] || '')) out.push([sel, prop]);
            }
        }
    } catch {}
    out = out.slice(0, 6);
    probeCache.set(ck, out);
    return out;
}

function themeHint(key) {
    if (!onThemeValue) return null;
    const d = (GROUP_OF[key] ? roleDefaults() : defaults())[key];
    const v = val(key);
    if (v !== d && !(v === '' && d === '') && !(v === 0 && !d)) return null;   // своё задано — подсказка не нужна
    for (const [sel, prop] of pairsFor(key)) {
        let t = null;
        try { t = onThemeValue(sel, prop); } catch {}
        if (!t) continue;
        const short = t.value.length > 22 ? `${t.value.slice(0, 20)}…` : t.value;
        return h('span.vte-theme-hint', {
            title: `Задано в теме: ${t.selector} { ${prop}: ${t.value} } — нажмите, чтобы увидеть в коде`,
            on: { click: (e) => { e.preventDefault(); e.stopPropagation(); onReveal?.(t.from, t.to); } },
        }, [`в теме: ${short}`]);
    }
    return null;
}

function slider(key, min, max, unit, zeroText, hint, step = 1) {
    const out = h('span.vte-tb-val');
    const show = () => { const v = val(key); out.textContent = v ? `${v}${unit}` : zeroText; };
    const input = h('input.vte-tb-range', {
        type: 'range', min: String(min), max: String(max), step: String(step), value: String(val(key) || 0),
        title: hint || '',
        on: {
            input: (e) => { setVal(key, +e.target.value); show(); preview(); },
            change: () => { commit(); if (/PanBw$|^tBgBw$/.test(key)) render(); },
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
    return h('span.vte-tb-slider', { dataset: { key } }, [input, out, reset]);
}

/** Пара «телефон / ПК» со связкой */
function pair(title, aKey, bKey, max, hint, min = 0, zeroText = 'как в теме') {
    const LINK_KEY = `vte-bb-link-${aKey}`;
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
    // Сдвиги связываем «одинаково», размеры — пропорцией (на ПК крупнее)
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
        h('div.vte-tb-sizes-head', {}, [h('span.vte-tb-label', {}, [title, themeHint(aKey)]), link, resetBoth]),
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
                picker.open({
                    anchor: btn, value: val(key) || '#ffffff', allowGradient: false,
                    onChange: (v) => { setVal(key, v); paint(); preview(); },
                    onCommit: (v) => { setVal(key, v); paint(); commit(); },
                    onCancel: () => { setVal(key, before); paint(); clearPreview(); },
                });
            },
        },
    }, [sw, txt]);
    const reset = iconBtn('fa-rotate-left', 'Убрать', () => { setVal(key, ''); paint(); commit(); render(); }, 'vte-tb-mini');
    paint();
    return h('span.vte-tb-colorwrap', { dataset: { key } }, [btn, reset]);
}

function check(key, label, hint) {
    const input = h('input', {
        type: 'checkbox', checked: !!val(key),
        on: { change: (e) => { setVal(key, e.target.checked); commit(); render(); } },
    });
    return h('label.vte-tb-check', { title: hint || '' }, [input, h('span', { text: label }), themeHint(key)]);
}

function select(key, options, after) {
    const sel = h('select.vte-tb-select', {
        on: { change: (e) => { setVal(key, e.target.value); commit(); (after || (() => {}))(); } },
    }, options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = val(key);
    sel.dataset.key = key;
    return sel;
}

/* Какие разделы раскрыты */
const open = { bubble: true, textall: false, colors: false, text: false, names: false, buttons: false, chatbg: false, scroll: false, badges: false };

function chatBgUi() {
    const img = !!state.cImg;
    const url = h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder: 'https://… ссылка на картинку', value: state.cImg || '',
        on: {
            change: (e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v) && !/^data:image\//i.test(v)) {
                    say('Нужна ссылка http(s)://');
                    e.target.value = state.cImg || '';
                    return;
                }
                // Картинка появилась впервые — сразу без размытия: иначе ST её размоет
                if (v && !state.cImg) state.cNoBlur = true;
                setVal('cImg', v);
                commit();
                render();
            },
        },
    });
    return [
        h('small.vte-note', { text: 'Фон ленты сообщений — то, что под пузырями.' }),
        check('cNoBlur', 'Без размытия (легче)', 'ST размывает обои под чатом, и это пересчитывается при каждой прокрутке'),
        row('Цвет фона', colorBtn('cColor', 'как в теме')),
        row('Плотность фона', slider('cOp', 0, 100, '%', 'прозрачный'), '100% — как задано цветом, 0% — фона нет, видны обои'),
        row('Картинка поверх', url),
        img ? h('small.vte-note', { text: 'Картинка ложится поверх фона чата и под сообщения. Не прокручивается вместе с чатом.' }) : null,
        img ? row('Видимость картинки', slider('cImgOp', 0, 100, '%', 'не видно')) : null,
        img ? row('Как вписать', select('cFit', [['cover', 'заполнить'], ['contain', 'целиком'], ['repeat', 'плиткой']])) : null,
        img ? row('Где', select('cPos', [['center', 'по центру'], ['top', 'сверху'], ['bottom', 'снизу'], ['left', 'слева'], ['right', 'справа']])) : null,
    ];
}

/* ============================================================
   «УЖЕ ЕСТЬ В ТЕМЕ» — у каждого раздела
   Какие правила про этот раздел уже есть: в самой теме и в «Моих
   правках». Ищется по селекторам, живые элементы не нужны — раздел
   видит правила про цитаты и код, даже если в чате их сейчас нет.
   Проверка — по последнему звену селектора (то, что он красит)
============================================================ */
const TAIL = (re) => (sel) => re.test(sel.split(/\s*[>+~]\s*|\s+/).pop() || '');
const MD_TAGS = /^(q|em|i|strong|b|u|s|del|blockquote|code|pre|hr|h[1-6]|ul|ol|li|table|th|td|a)\b/i;
const GROUP_MATCH = {
    textall: (s) => /\.mes_text\b/.test(s) && TAIL(/^(\.mes_text|p)\b/)(s),
    colors: (s) => /\.mes_text\b/.test(s) && TAIL(MD_TAGS)(s),
    bubble: (s) => TAIL(/^(\.mes(\[[^\]]*\]|\.[\w-]+|:[\w-]+(\([^)]*\))?)*|\.mes_block)(::?[\w-]+)?$/)(s),
    text: (s) => /\.mes_text\b/.test(s) && TAIL(/^\.mes_text\b/)(s),
    names: TAIL(/\.(ch_name|name_text|timestamp|alignItemsBaseline)\b/),
    buttons: (s) => /\.(mes_buttons|mes_button|mes_edit_buttons|extraMesButtons|extraMesButtonsHint|mes_edit)\b/.test(s),
    chatbg: (s) => /^#chat(::?[\w-]+)?$|^#sheld(::?[\w-]+)?$/.test(s),
    scroll: (s) => /#chat\b.*scrollbar|^#chat$/.test(s) && /scrollbar/.test(s),
    badges: (s) => /\.(mesIDDisplay|mes_timer|tokenCounterDisplay)\b/.test(s),
};
const ruleOpen = {};

function groupRules(id) {
    const test = GROUP_MATCH[id];
    if (!test || !onRulesMatching) return null;
    const list = onRulesMatching(test) || [];
    const mine = list.filter(r => r.mine).length;
    const theirs = list.length - mine;
    const box = h('div.vte-tb-section.vte-tb-theme.vte-grp-rules');
    if (!list.length) {
        box.appendChild(h('small.vte-note', { text: 'В теме про это пока ничего нет.' }));
        return box;
    }
    const parts = [];
    if (theirs) parts.push(`в теме: ${theirs}`);
    if (mine) parts.push(`в «Моих правках»: ${mine}`);
    const over = list.filter(r => r.over);
    const overLines = over.reduce((n, r) => n + r.over.dead, 0);
    if (over.length) parts.push(`перекрыто строк: ${overLines}`);
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button', title: 'Какие правила про этот раздел уже есть — нажмите на правило, чтобы увидеть его в коде',
        on: { click: () => { ruleOpen[id] = !ruleOpen[id]; render(); } },
    }, [icon(ruleOpen[id] ? 'fa-chevron-up' : 'fa-chevron-down'), h('span', { text: ` Уже есть — ${parts.join(', ')}` })]));
    if (ruleOpen[id] && over.length && onCleanOverridden) {
        let armed = 0;
        const btn = h('button.vte-btn.vte-grp-clean', {
            type: 'button', title: 'Удалить из кода строки темы, которые перекрыты и ничего не делают',
            on: {
                click: () => {
                    if (!armed) {
                        btn.classList.add('armed');
                        btn.lastChild.textContent = ' Нажмите ещё раз — убрать';
                        armed = setTimeout(() => { armed = 0; btn.classList.remove('armed'); btn.lastChild.textContent = ` Убрать перекрытое (${overLines})`; }, 3000);
                        return;
                    }
                    clearTimeout(armed);
                    const n = onCleanOverridden(over.map(r => r.start));
                    say(n ? `Убрано перекрытого: ${n}. Вернуть — «Как было до открытия»` : 'Убирать нечего');
                },
            },
        }, [icon('fa-broom'), h('span', { text: ` Убрать перекрытое (${overLines})` })]);
        box.appendChild(btn);
    }
    if (ruleOpen[id]) {
        for (const r of list) {
            box.appendChild(h('div.vte-grp-rule', {}, [
                h('button.vte-tb-rule', {
                    type: 'button', title: 'Показать в коде',
                    on: { click: () => onReveal?.(r.from, r.to) },
                }, [
                    h(`span.vte-grp-rule-tag${r.mine ? '.mine' : ''}`, { text: r.mine ? 'мои' : 'тема' }),
                    r.over ? h('span.vte-grp-rule-tag.over', {
                        text: r.over.dead >= r.over.total ? 'перекрыто' : `перекрыто ${r.over.dead} из ${r.over.total}`,
                        title: 'Эти строки уже ничего не делают: то же свойство берётся из другого правила (обычно из «Моих правок»)',
                    }) : null,
                    // «Что за что отвечает» — простыми словами
                    h('span.vte-grp-rule-what', { text: explainRule(r.parts || r.selector, r.decls || []) }),
                    h('code.vte-tb-rule-sel', { text: r.selector }),
                ]),
                // «Мои» правила пишут настройки окна — удалённое вернулось бы
                // при следующей правке. Их убирают ↺ у настройки
                onDeleteRule && !r.mine ? deleteBtn(r) : null,
            ]));
        }
    }
    return box;
}

/** Корзина у правила: первое нажатие — «точно?», второе — удалить */
function deleteBtn(r) {
    let armed = 0;
    const btn = h('button.vte-icon-btn.vte-tb-mini.vte-grp-rule-del', {
        type: 'button', title: 'Удалить это правило из кода целиком',
        on: {
            click: (e) => {
                e.stopPropagation();
                if (!armed) {
                    btn.classList.add('armed');
                    btn.title = 'Нажмите ещё раз — удалить. Вернуть: «Как было до открытия» или отмена в коде';
                    armed = setTimeout(() => { armed = 0; btn.classList.remove('armed'); btn.title = 'Удалить это правило из кода целиком'; }, 3000);
                    return;
                }
                clearTimeout(armed);
                if (onDeleteRule?.(r.from, r.to)) say('Правило удалено из кода');
            },
        },
    }, [icon('fa-trash-can')]);
    return btn;
}

function group(id, title, children) {
    const list = children.filter(Boolean);
    if (open[id]) { const rl = groupRules(id); if (rl) list.unshift(rl); }
    const head = h(`button.vte-av-group-head${open[id] ? '.open' : ''}`, {
        type: 'button',
        on: { click: () => { open[id] = !open[id]; render(); } },
    }, [icon(open[id] ? 'fa-chevron-down' : 'fa-chevron-right'), h('span', { text: title })]);
    return h('div.vte-av-group', { dataset: { gid: id } }, [head, open[id] ? h('div.vte-av-group-body', {}, list) : null]);
}

/** Связка «бот и пользователь вместе» + вкладки, когда разведены */
function roleBar(g) {
    const linked = state.link[g];
    const toggle = h(`button.vte-tb-link${linked ? '.active' : ''}`, {
        type: 'button',
        title: linked
            ? 'Сейчас одинаково у бота и у пользователя. Нажми, чтобы настроить отдельно'
            : 'Сейчас отдельно. Нажми, чтобы сделать как на открытой вкладке у обоих',
        on: {
            click: () => {
                if (linked) {
                    state.link[g] = false;
                } else {
                    // Связываем: обоим — значения открытой вкладки
                    const from = state[state.role];
                    for (const k of ROLE_GROUPS[g]) { state.bot[k] = from[k]; state.user[k] = from[k]; }
                    state.link[g] = true;
                }
                state.on = true;
                commit();
                render();
            },
        },
    }, [icon(linked ? 'fa-link' : 'fa-link-slash'), h('span', { text: linked ? ' бот и я — одинаково' : ' бот и я — отдельно' })]);
    const tabs = linked ? null : h('div.vte-seg.vte-bb-roles', {}, [['bot', 'Бот'], ['user', 'Пользователь']].map(([r, t]) =>
        h(`button.vte-seg-btn${state.role === r ? '.active' : ''}`, {
            type: 'button', text: t,
            on: { click: () => { state.role = r; render(); } },
        })));
    return h('div.vte-bb-rolebar', {}, [toggle, tabs]);
}

/* Перерисовка окна не сбрасывает прокрутку: раньше после любой
   настройки окно уезжало в самый верх */
function render() {
    // Два окна на одном состоянии: «Пузыри» и «Markdown»
    for (const [b, mode] of [[els.body, 'main'], [mdEls.body, 'md']]) {
        if (!b || b.parentElement?.style.display === 'none') continue;
        const top = b.scrollTop;
        b.textContent = '';
        b.append(...screen(mode).filter(Boolean));
        if (top) {
            b.scrollTop = top;
            // содержимое могло дорисоваться позже (картинки, шрифты)
            requestAnimationFrame(() => { if (b.scrollTop < top) b.scrollTop = top; });
        }
    }
}

/* Разделы окна «Markdown»: обычный текст и разметка */
const MD_GROUPS = new Set(['textall', 'colors']);

function screen(mode = 'main') {
    const all = screenAll();
    const isGroup = (x) => x?.dataset?.gid;
    if (mode === 'md') return [...all.filter(x => isGroup(x) && MD_GROUPS.has(x.dataset.gid)), ...mdFoot()];
    return all.filter(x => !(isGroup(x) && MD_GROUPS.has(x.dataset.gid)));
}

function mdFoot() {
    return [
        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', {
                type: 'button', title: 'Убрать всё, что это окно записало в тему (обычный текст и разметку)',
                on: { click: resetMarkdown },
            }, [icon('fa-rotate-left'), h('span', { text: ' Сбросить все настройки окна' })]),
            h('button.vte-btn', {
                type: 'button', title: 'Отменить всё, что сделано с момента открытия этого окна',
                on: { click: () => { onMdRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    ];
}

function mdKeys() { return [...ROLE_GROUPS.textall, ...ROLE_GROUPS.colors]; }

function resetMarkdown() {
    const d = roleDefaults();
    for (const r of ['bot', 'user']) for (const k of mdKeys()) state[r][k] = d[k];
    state.link.textall = true;
    state.link.colors = true;
    state.on = true;
    commit();
    render();
    say('Текст и разметка снова как в теме');
}

/* ---------- окно «Markdown» ---------- */
let mdPanel = null;
const mdEls = {};

export async function showMarkdown() {
    onMdSnapshot?.();
    if (!isOpen()) {
        const role = state?.role || 'bot';
        state = readState();
        state.role = role;
    }
    if (!mdPanel) {
        const header = h('div.vte-header', {}, [
            h('div.vte-title', {}, [h('span.vte-title-ic', {}, [icon('fa-paragraph')]), h('span', { text: 'Markdown' })]),
            h('div.vte-header-btns', {}, [iconBtn('fa-xmark', 'Закрыть', hideMarkdown, 'vte-icon-btn-close')]),
        ]);
        mdEls.body = h('div.vte-tb-body');
        mdPanel = h('div#vte-markdown-panel.vte-panel.vte-tb-panel', {}, [header, mdEls.body]);
        document.body.appendChild(mdPanel);
        makeDraggable(mdPanel, header);
        makeResizable(mdPanel, 'vte-markdown-size');
        ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
            mdPanel.addEventListener(t, (e) => e.stopPropagation()));
    }
    open.textall = open.textall || !open.colors;
    mdPanel.style.display = 'flex';
    render();
}

export function hideMarkdown() {
    if (mdPanel) mdPanel.style.display = 'none';
    if (!isOpen()) clearPreview();
}

export function isMarkdownOpen() {
    return !!mdPanel && mdPanel.style.display !== 'none';
}

export function toggleMarkdown() {
    isMarkdownOpen() ? hideMarkdown() : showMarkdown();
}

function screenAll() {
    return [
        themeSection(),

        group('bubble', 'Пузырь', [
            row('Что считать пузырём', select('target', [
                ['block', 'текст с ником'], ['text', 'только текст (рамка идёт за ним)'], ['mes', 'всё сообщение с аватаркой'],
            ], () => render())),
            val('target') === 'text' ? h('small.vte-note', {
                text: 'Рамка и фон — у самого текста: поднимаешь, опускаешь, сдвигаешь или сужаешь текст — пузырь едет вместе с ним.',
            }) : null,
            roleBar('bubble'),
            row('Фон', colorBtn('bg', 'как в теме')),
            row('Обводка', slider('bw', 0, 8, 'px', 'нет')),
            val('bw') ? row('Цвет обводки', colorBtn('bc', 'цвет текста')) : null,
            row('Скругление', slider('radius', 0, 40, 'px', 'как в теме')),
            h('small.vte-note', { text: 'Внутренние отступы — от края пузыря до текста. Ник, текст и кнопки двигаются вместе с ними, ничего не наезжает.' }),
            row('Отступ сверху', slider('padT', 0, 60, 'px', 'как в теме')),
            row('Отступ снизу', slider('padB', 0, 60, 'px', 'как в теме')),
            row('Обрезать фон сверху', slider('trimT', 0, 200, 'px', 'нет'), 'Фон начинается ниже края пузыря. Сам пузырь и текст не двигаются'),
            row('Обрезать фон снизу', slider('trimB', 0, 200, 'px', 'нет'), 'Фон кончается выше края пузыря. Сам пузырь и текст не двигаются'),
            row('Отступ по бокам', slider('padX', 0, 60, 'px', 'как в теме')),
            row('Ширина пузыря', slider('maxW', 0, 100, '%', 'во всю ширину'),
                'Считается от ширины чата — на телефоне и ПК пропорция одна'),
            h('div.vte-bb-shared', { text: 'Общее для всех сообщений' }),
            // Старая настройка: заменена «Шириной текста» и «Выравниванием».
            // Видна, только если уже задана в теме — чтобы её можно было сбросить
            val('rightSpace') ? row('Старый отступ справа', slider('rightSpace', 0, 40, 'px', 'как в теме'),
                'Раньше здесь менялся запас 30px справа от текста. Теперь это делают «Ширина текста» и «Выравнивание» в «Положении текста» — эту можно сбросить') : null,
            row('Между сообщениями', slider('gapMes', 0, 40, 'px', 'как в теме')),
        ]),

        group('textall', 'Обычный текст', [
            roleBar('textall'),
            pair('Размер текста', 'fsMin', 'fsMax', 32, 'Первое — на узком экране, второе — на широком'),
            row('Цвет текста', colorBtn('cText', 'как в теме')),
            row('Межстрочный', slider('tLh', 80, 260, '%', 'как в теме', 'Расстояние между строками. 150% — полтора интервала', 5)),
            row('Между абзацами', slider('tPGap', 0, 40, 'px', 'как в теме')),
            row('Красная строка', slider('tIndent', 0, 40, '', 'нет', 'Отступ первой строки абзаца (десятые доли размера букв). С фоном под буквами не работает — только с фоном прямоугольником')),
            row('Между буквами', slider('tLetter', -5, 20, '', 'как в теме', 'Сотые доли размера букв: 5 — чуть шире, −2 — плотнее')),
            check('tHyph', 'Переносы слов', 'Длинные слова делятся по слогам — особенно помогает с выравниванием «по ширине»'),
            check('tNoShadow', 'Без тени под буквами (легче)'),
            h('div.vte-bb-shared', { text: 'Фон под абзацами' }),
            row('Фон', colorBtn('tBg', 'нет')),
            row('Фон больше текста на', slider('tBgPad', 0, 24, 'px', 'вплотную')),
            check('tBgBlock', 'Прямоугольником на весь абзац', 'Обычно фон идёт только под буквами, по строкам — и кончается там, где кончается текст'),
            row('Края', slider('tBgRad', 0, 30, 'px', 'прямые')),
            val('tBgBlock') || !val('tBg') ? row('Рамка', slider('tBgBw', 0, 6, 'px', 'нет')) : h('small.vte-note', { text: 'Рамка — в режиме «прямоугольником на весь абзац»: по строкам она рвалась бы на кусочки.' }),
            val('tBgBw') && (val('tBgBlock') || !val('tBg')) ? row('Линия', select('tBgBs', LINE_STYLES)) : null,
            val('tBgBw') && (val('tBgBlock') || !val('tBg')) ? row('Цвет рамки', colorBtn('tBgBc', 'цвет текста')) : null,
            h('small.vte-note', { text: 'Шрифт и его толщина — в окне «Шрифты». Где стоит текст в пузыре — в «Пузырях → Положение текста».' }),
        ]),

        group('colors', 'Markdown', [
            roleBar('colors'),
            row('*Курсив*', colorBtn('cEm', 'как в теме')),
            row('**Жирный**', colorBtn('cStrong', 'как в теме')),
            row('«Кавычки»', colorBtn('cQuote', 'как в теме')),
            row('Подчёркнутый', colorBtn('cU', 'как в теме')),
            h('div.vte-bb-shared', { text: 'Цитата  (> текст)' }),
            row('Текст цитаты', colorBtn('bqText', 'как в теме')),
            row('Полоса слева', colorBtn('bqBar', 'цвет «кавычек»')),
            row('Толщина полосы', slider('bqBarW', 0, 10, 'px', 'как в теме (3px)')),
            row('Фон цитаты', colorBtn('bqBg', 'как в теме')),
            h('div.vte-bb-shared', { text: 'Горизонтальная линия  (---)' }),
            row('Вид', select('hrStyle', [['', 'как в теме'], ['fade', 'тающая к краям'], ['solid', 'сплошная'], ['dashed', 'пунктир'], ['dotted', 'точки'],
                ['sign', 'сплошная, знак посередине'], ['signFade', 'тающая, знак посередине']], render)),
            /^sign/.test(val('hrStyle')) ? row('Знак', select('hrSign', HR_SIGNS)) : null,
            /^sign/.test(val('hrStyle')) ? row('Цвет знака', colorBtn('hrSignColor', 'как у линии')) : null,
            row('Цвет линии', colorBtn('hrColor', 'как в теме')),
            row('Толщина', slider('hrThick', 0, 8, 'px', 'как в теме (1px)')),
            row('Видимость', slider('hrOp', 0, 100, '%', 'как в теме (40%)')),
            h('div.vte-bb-shared', { text: 'Вид разметки — готовые шаблоны' }),
            row('Готовый набор', textSetSelect(), 'Сразу для кавычек, курсива, жирного, подчёркнутого, цитаты и кода. Потом любой можно поменять отдельно'),
            ...Object.entries(TEXT_STYLES).flatMap(([el, def]) => {
                const cur = def.list[val(TS_KEY[el])];
                const pre = TS_PRE[el];
                return [
                    row(def.title, select(TS_KEY[el], [['', 'как в теме'], ...Object.entries(def.list).map(([k, x]) => [k, x[0]])], render)),
                    cur && JSON.stringify(cur[1]).includes('--vte-ta') || cur?.[2] ? row('   цвет линий и значков', colorBtn(`${pre}Acc`, 'от цвета текста')) : null,
                    cur && cur[3] ? row('   цвет подложки', colorBtn(`${pre}Fill`, 'полупрозрачный от текста')) : null,
                ];
            }),
            h('small.vte-note', { text: 'Шаблоны лёгкие: линии, заливка цветом и тонкие рамки — без анимаций, градиентов и размытых теней. '
                + 'Цвет берут от самого текста, так что подходят к цветам выше.' }),
            h('div.vte-bb-shared', { text: 'Проверить на деле' }),
            h('button.vte-btn', {
                type: 'button', title: 'Скопировать сообщение со всеми видами разметки — вставьте его в чат и смотрите, как выглядит',
                on: { click: copyMarkdown },
            }, [icon('fa-copy'), h('span', { text: ' Скопировать маркдаун' })]),
            h('small.vte-note', { text: 'Курсив, кавычки и подчёркнутый меняются через цвета самой SillyTavern — '
                + 'курсив внутри кавычек и рассуждения она по-прежнему красит сама.' }),
        ]),

        group('text', 'Положение текста', [
            roleBar('text'),
            h('small.vte-note', { text: 'Выше-ниже — расстояние от ника, одинаковое в каждом сообщении, с блоком рассуждений и без него.' }),
            check('textFull', 'Текст во всю ширину пузыря',
                'Убирает запас 30px справа, который SillyTavern держит под стрелки свайпа: текст идёт от края до края, '
                + 'отступы по бокам одинаковые. Место под стрелки остаётся только у последнего сообщения, снизу'),
            row('Текст выше-ниже', slider('offY', -150, 300, 'px', 'нет')),
            row('Сдвиг вбок', slider('offX', -300, 300, 'px', 'нет')),
            val('textFull') ? null : row('Ширина текста', slider('textW', 0, 100, '%', 'как в теме'),
                'От ширины пузыря. Отступы по бокам становятся одинаковыми'),
            val('textFull') ? h('small.vte-note', { text: 'Выравнивание строк работает и во всю ширину — например, «по ширине», как в Rusreal.' }) : null,
            row('Выравнивание', select('textAlign', [
                ['', 'как в теме'], ['left', 'по левому краю'], ['center', 'по центру'], ['right', 'по правому краю'], ['justify', 'по ширине'],
            ], render), 'Выравнивает строки и ставит сам блок текста в пузыре слева, по центру или справа'),
        ]),

        group('names', 'Ник и дата', [
            roleBar('names'),
            magnet('Привязать к ближайшему', anchorName,
                'Сначала поставьте ник, куда нужно, — кнопка найдёт ближайший угол пузыря и посчитает отступы сама'),
            row('Привязка', select('nameCorner', [['', 'от своего места'], ...CORNERS.map(([v, t]) => [v, `в углу пузыря ${t}`])], render)),
            h('small.vte-note', { text: val('nameCorner')
                ? 'Ник держится за угол пузыря — на любом экране встаёт на то же расстояние от его краёв. Дата едет вместе с ником.'
                : 'Ник двигается от своего места, дата привязана к нику и едет вместе с ним.' }),
            row(val('nameCorner') ? 'От края по горизонтали' : 'Ник вбок', slider('nameX', -600, 600, 'px', val('nameCorner') ? 'вплотную' : 'на месте')),
            row(val('nameCorner') ? 'От края по вертикали' : 'Ник вверх-вниз', slider('nameY', -600, 600, 'px', val('nameCorner') ? 'вплотную' : 'на месте')),
            row('Дата относительно ника', select('datePos', [
                ['', 'справа от ника (как в теме)'], ['below', 'под ником'], ['above', 'над ником'], ['before', 'перед ником'],
            ])),
            row('Дата: вбок', slider('dateX', -300, 300, 'px', 'нет')),
            row('Дата: вверх-вниз', slider('dateY', -300, 300, 'px', 'нет')),
            row('Размер ника', slider('nameSize', 0, 48, 'px', 'как в теме')),
            row('Цвет ника', colorBtn('nameColor', 'как в теме')),
            check('nameNoWrap', 'Не переносить ник на вторую строку'),
            row('Макс. ширина ника', slider('nameWidth', 0, 100, '%', 'без ограничения'),
                'Длинное имя обрежется многоточием'),
            row('Размер даты', slider('dateSize', 0, 32, 'px', 'как в теме')),
            row('Цвет даты', colorBtn('dateColor', 'как в теме')),
        ]),

        group('buttons', 'Кнопки редактирования', buttonsUi()),

        group('chatbg', 'Фон чата (под пузырями)', chatBgUi()),

        group('scroll', 'Полоса прокрутки', scrollUi()),

        group('badges', 'Бейджи (номер, время, токены)', [
            magnet('Привязать к ближайшему', anchorBadges,
                'Найдёт ближайший край аватарки и выравнивание — бейджи останутся на месте, но будут держаться за аватарку'),
            row('Как расставить', select('badgeMode', [
                ['', 'как в теме'],
                ['onBottom', 'на аватарке, снизу'], ['onTop', 'на аватарке, сверху'],
                ['stack', 'стопкой под аватаркой'], ['row', 'в строку под аватаркой'], ['stairs', 'лесенкой под аватаркой'],
            ], render)),
            h('small.vte-note', {
                text: state.badgeMode === 'onBottom' || state.badgeMode === 'onTop'
                    ? 'Бейджи лежат внутри аватарки — ник стоит на одном месте, сколько бы бейджей ни было.'
                    : 'Под аватаркой бейджи толкают ник вниз: у бота (есть время ответа) он будет ниже, чем у вас. '
                        + 'Чтобы ник стоял ровно, выберите «на аватарке».',
            }),
            state.badgeMode ? row('Выравнивание', select('badgeAlign', [['start', 'по левому краю'], ['center', 'по центру'], ['end', 'по правому краю']])) : null,
            state.badgeMode ? row('Сдвиг вбок', slider('badgeX', -600, 600, 'px', 'нет')) : null,
            state.badgeMode ? row('Сдвиг вверх-вниз', slider('badgeY', -600, 600, 'px', 'нет')) : null,
            state.badgeMode ? row('Расстояние между', slider('badgeGap', 0, 40, 'px', 'вплотную')) : null,
            state.badgeMode === 'stairs' ? row('Шаг лесенки', slider('badgeStair', 0, 120, 'px', 'нет')) : null,
            row('Размер текста', slider('badgeSize', 0, 32, 'px', 'как в теме')),
            row('Цвет текста', colorBtn('badgeColor', 'как в теме')),
            row('Фон', colorBtn('badgeBg', 'нет')),
            row('Скругление', slider('badgeRadius', 0, 30, 'px', 'нет')),
            row('Внутренний отступ', slider('badgePad', 0, 16, 'px', 'нет')),
        ]),

        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', { type: 'button', title: 'Убрать всё, что это окно записало в тему. Останется оформление самой темы — не SillyTavern по умолчанию', on: { click: resetAll } },
                [icon('fa-rotate-left'), h('span', { text: ' Сбросить все настройки окна' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Отменить всё, что сделано с момента открытия этого окна, — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
        h('small.vte-note.vte-foot-note', { text: '«Как было до открытия» — отменить всё, что сделано с момента открытия окна. «Сбросить все настройки окна» — убрать всё, что это окно когда-либо записало в тему: останется оформление самой темы.' }),
    ];
}

/* ============================================================
   КНОПКИ СООБЩЕНИЯ — интерфейс
============================================================ */
const PLACES = [
    ['', 'как в теме (в строке ника)'],
    ['block', 'в углу пузыря — сами по себе, ник не влияет'],
    ['row', 'в строке ника, сдвинуть от своего места'],
    ['after', 'сразу после ника и даты'],
];
const CORNERS = [['top-right', 'сверху справа'], ['top-left', 'сверху слева'], ['bottom-right', 'снизу справа'], ['bottom-left', 'снизу слева']];

let hiddenShown = false;
let hiddenStyle = null;

/** Временно показать кнопки после «…» и режима правки — только для настройки, в тему не пишется */
function showHidden(on) {
    hiddenShown = on;
    if (!on) { hiddenStyle?.remove(); hiddenStyle = null; return; }
    if (!hiddenStyle) {
        hiddenStyle = document.createElement('style');
        hiddenStyle.id = 'vte-bubbles-showbtns';
        document.head.appendChild(hiddenStyle);
    }
    hiddenStyle.textContent = '#chat .mes .extraMesButtons{display:flex!important;opacity:1!important}'
        + '#chat .mes .mes_edit_buttons{display:inline-flex!important}';
}

function placeRows(pre, title) {
    const p = val(`${pre}Place`);
    return [
        row(title, select(`${pre}Place`, PLACES, render)),
        p === 'block' ? row('Угол', select(`${pre}Corner`, CORNERS, render)) : null,
        // Сдвигать можно всегда: сдвиг «на своём месте» сам включает режим
        // «в строке ника, сдвинуть» (иначе после переноса ника кнопки
        // поднимались вместе со строкой и опустить их было нечем)
        pair(p === 'block' ? 'От края по горизонтали' : 'Сдвиг вбок', `${pre}XMin`, `${pre}XMax`, 400,
            'Первое — на телефоне, второе — на ПК. Между ними плавно', -400, 'нет'),
        pair(p === 'block' ? 'От края по вертикали' : 'Сдвиг вверх-вниз', `${pre}YMin`, `${pre}YMax`, 400,
            p === 'block' ? 'Минус — за край блока' : 'Плюс — ниже, минус — выше', -400, 'нет'),
    ];
}

/** Готовый набор: все виды разметки одним шагом */
function textSetSelect() {
    const sel = h('select.vte-tb-select', {
        on: {
            change: (e) => {
                const set = TEXT_SETS.find(x => x[0] === e.target.value);
                if (!set) return;
                for (const [el, name] of Object.entries(set[2])) setVal(TS_KEY[el], name);
                commit();
                render();
                say(set[0] === 'clear' ? 'Шаблоны разметки убраны' : `Набор «${set[1].replace(/ —.*$/, '').replace(/[«»]/g, '')}»`);
            },
        },
    }, [h('option', { value: '', text: 'выбрать…' }), ...TEXT_SETS.map(([k, t]) => h('option', { value: k, text: t }))]);
    return sel;
}

/* Подложка под группой кнопок: фон, насколько он больше кнопок, рамка */
function panUi(pre) {
    const bw = val(`${pre}PanBw`);
    return [
        row('Подложка под кнопками', colorBtn(`${pre}PanBg`, 'нет'), 'Общий фон под всей группой кнопок'),
        row('Подложка больше на', slider(`${pre}PanPad`, 0, 20, 'px', 'вплотную'), 'Фон выходит за кнопки на столько с каждой стороны — сами кнопки не сдвигаются'),
        row('Рамка подложки', slider(`${pre}PanBw`, 0, 6, 'px', 'нет')),
        bw ? row('Линия', select(`${pre}PanBs`, LINE_STYLES)) : null,
        bw ? row('Цвет рамки', colorBtn(`${pre}PanBc`, 'цвет значков')) : null,
        row('Скругление подложки', slider(`${pre}PanRad`, 0, 30, 'px', 'нет')),
    ];
}

/** «Отдельно от основных»: при включении панель начинает с тех же значений */
function exOwnCheck() {
    const input = h('input', {
        type: 'checkbox', checked: !!val('exOwn'),
        on: {
            change: (e) => {
                if (e.target.checked) {
                    for (const k of ['SMin', 'SMax', 'Color', 'Opacity', 'Hover', 'Bg', 'Radius', 'Pad', 'Gap']) {
                        if (!val(`ex${k}`)) setVal(`ex${k}`, val(`btn${k}`));
                    }
                }
                setVal('exOwn', e.target.checked);
                commit();
                render();
            },
        },
    });
    return h('label.vte-tb-check', { title: 'Иначе панель выглядит как основные кнопки и едет вместе с ними' },
        [input, h('span', { text: 'Отдельно от основных кнопок' })]);
}

function buttonsUi() {
    return [
        roleBar('buttons'),
        check('btnTop', 'Кнопки поверх всего (и скрытые тоже)',
            'Выше текста, аватарки и соседних сообщений; край пузыря их не обрезает'),
        h('label.vte-tb-check', { title: 'Только на время настройки — в тему не пишется' }, [
            h('input', { type: 'checkbox', checked: hiddenShown, on: { change: (e) => showHidden(e.target.checked) } }),
            h('span', { text: 'Показать скрытые кнопки (после «…» и правки)' }),
        ]),
        h('small.vte-note', {
            text: 'Видимых кнопок две: «…» и карандаш. «…» раскрывает остальные — они едут вместе с ними. '
                + 'Кнопки правки появляются, пока сообщение редактируется, и настраиваются отдельно.',
        }),
        magnet('Привязать к ближайшему', () => anchorButtons('btn'),
            'Найдёт ближайший угол пузыря и посчитает отступы — кнопки останутся на месте, но будут держаться за угол'),
        ...placeRows('btn', 'Где стоят'),
        row('Раскладка', select('btnDir', [['', 'в строку'], ['column', 'столбиком']])),
        pair('Размер значков', 'btnSMin', 'btnSMax', 40),
        row('Цвет', colorBtn('btnColor', 'как в теме')),
        row('Видимость', slider('btnOpacity', 0, 100, '%', 'как в теме (30%)')),
        row('При наведении', slider('btnHover', 0, 100, '%', 'как в теме (100%)')),
        row('Фон', colorBtn('btnBg', 'нет')),
        row('Скругление', slider('btnRadius', 0, 20, 'px', 'нет')),
        row('Внутренний отступ', slider('btnPad', 0, 12, 'px', 'как в теме')),
        row('Между кнопками', slider('btnGap', 0, 24, 'px', 'как в теме')),
        check('btnNoShadow', 'Без тени под значками (легче)'),
        ...panUi('btn'),

        h('div.vte-bb-shared', { text: 'Панель «…» (открывается кнопкой «…»)' }),
        exOwnCheck(),
        ...(val('exOwn') ? [
            pair('Сдвиг вбок', 'exXMin', 'exXMax', 400, 'От своего места. Первое — на телефоне, второе — на ПК', -400, 'нет'),
            pair('Сдвиг вверх-вниз', 'exYMin', 'exYMax', 400, 'Минус — выше', -400, 'нет'),
            row('Раскладка', select('exDir', [['', 'как у основных'], ['row', 'в строку'], ['column', 'столбиком']])),
            pair('Размер значков', 'exSMin', 'exSMax', 40),
            row('Цвет', colorBtn('exColor', 'как в теме')),
            row('Видимость', slider('exOpacity', 0, 100, '%', 'как в теме')),
            row('При наведении', slider('exHover', 0, 100, '%', 'как в теме')),
            row('Фон кнопок', colorBtn('exBg', 'нет')),
            row('Скругление', slider('exRadius', 0, 20, 'px', 'нет')),
            row('Внутренний отступ', slider('exPad', 0, 12, 'px', 'как в теме')),
            row('Между кнопками', slider('exGap', 0, 24, 'px', 'как в теме')),
            ...panUi('ex'),
        ] : []),

        h('div.vte-bb-shared', { text: 'Кнопки в режиме правки (открываются карандашом)' }),
        magnet('Привязать к ближайшему', () => anchorButtons('ed'), 'То же для кнопок правки'),
        ...placeRows('ed', 'Где стоят'),
        check('edSame', 'Цвет, фон и видимость — как у основных кнопок'),
        row('Размер кнопок', slider('edSize', 0, 60, 'px', 'как в теме')),
        val('edSame') ? null : row('Цвет', colorBtn('edColor', 'как в теме')),
        val('edSame') ? null : row('Фон кнопок', colorBtn('edBg', 'как в теме')),
        val('edSame') ? null : row('Видимость', slider('edOpacity', 0, 100, '%', 'как в теме (50%)')),
        row('Скругление', slider('edRadius', 0, 30, 'px', 'как в теме')),
        row('Между кнопками', slider('edGap', 0, 24, 'px', 'как в теме')),
        ...panUi('ed'),

        h('div.vte-bb-shared', { text: 'Значки — общие для бота и пользователя' }),
        ...GLYPHS.map(([title, list]) => h('div.vte-bb-glyphs', {}, [
            h('div.vte-tb-label', { text: title }),
            ...list.map(([cls, label]) => glyphRow(cls, label)),
        ])),
    ];
}

function glyphPreview(cls) {
    const g = state.glyphs[cls];
    if (g?.img) return h('i.vte-bb-glyph-now', { style: `background:url("${g.img}") center/contain no-repeat;width:16px;height:16px` });
    if (g?.code) {
        const el = h(`i.vte-bb-glyph-now.${g.brand ? 'fa-brands' : 'fa-solid'}`);
        el.textContent = String.fromCodePoint(parseInt(g.code, 16));
        return el;
    }
    // Как в теме — берём значок с живой кнопки на странице
    const live = document.querySelector(`#chat .mes .${cls}`);
    const el = h('i.vte-bb-glyph-now');
    if (live) {
        const cs = getComputedStyle(live, '::before');
        const c = cs.content && cs.content !== 'none' ? cs.content.replace(/^["']|["']$/g, '') : '';
        el.textContent = c;
        el.style.fontFamily = cs.fontFamily;
        el.style.fontWeight = cs.fontWeight;
    }
    return el;
}

function glyphRow(cls, label) {
    return h('div.vte-bb-glyph-row', {}, [
        glyphPreview(cls),
        h('span.vte-bb-glyph-label', { text: label }),
        h('button.vte-btn.vte-bb-glyph-btn', { type: 'button', on: { click: (e) => openGlyphPicker(cls, label, e.currentTarget) } },
            [h('span', { text: 'Сменить' })]),
        state.glyphs[cls] ? iconBtn('fa-rotate-left', 'Вернуть значок темы', () => {
            delete state.glyphs[cls];
            state.on = true;
            commit();
            render();
        }, 'vte-tb-mini') : null,
    ]);
}

/* Выбор значка: тот же список и поиск, что в «Топ-баре» (один на расширение) */
let glyphPop = null;

function closeGlyphPicker() {
    glyphPop?.remove();
    glyphPop = null;
}

async function openGlyphPicker(cls, label) {
    closeGlyphPicker();
    let tb;
    try { tb = await import('./topBar.js'); await tb.loadIcons(); } catch { say('Список значков не загрузился'); return; }
    const icons = await tb.loadIcons();
    let query = '', cat = -1, shown = 0, found = [];
    const setGlyph = (g, text) => {
        state.glyphs[cls] = g;
        state.on = true;
        closeGlyphPicker();
        commit();
        render();
        say(`«${label}»: ${text}`);
    };
    const grid = h('div.vte-tb-grid');
    const count = h('span.vte-tb-count');
    const more = () => {
        const next = found.slice(shown, shown + 240);
        for (const ic of next) {
            grid.appendChild(h('button.vte-tb-glyph', {
                type: 'button', title: ic.name,
                on: { click: () => setGlyph({ code: ic.code, brand: ic.brand }, ic.name) },
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
    const faPane = h('div.vte-tb-pane', {}, [h('div.vte-tb-pop-tools', {}, [search, cats, count]), grid]);

    // Уже стоит картинка (наша или темы) — сразу показываем её ссылку или код
    let nowImg = state.glyphs[cls]?.img || '';
    if (!nowImg) {
        try {
            const el = document.querySelector(`#chat .mes .${cls}`);
            const m = el && getComputedStyle(el, '::before').backgroundImage.match(/url\(\s*"?([^")]*)"?\s*\)/);
            if (m) nowImg = m[1];
        } catch {}
    }
    const was = tb.imageFields ? tb.imageFields(nowImg) : { url: nowImg, code: '' };
    const url = h('input.vte-input', { type: 'text', spellcheck: false, placeholder: 'https://… ссылка на .svg / .png / .webp', value: was.url });
    const code = h('textarea.vte-input.vte-tb-svg', { spellcheck: false, placeholder: 'или вставьте код <svg>…</svg>', rows: 4 });
    code.value = was.code;
    // Что-то одно: ссылка или код — чтобы не гадать, что применится
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
                        if (img.length > 20000) { say('SVG тяжелее 20 КБ — для значка это много'); return; }
                    } else if (/^https?:\/\/[^\s"'()<>\\]+$/i.test(url.value.trim())) {
                        img = url.value.trim();
                    } else { say('Вставьте ссылку http(s):// или код SVG'); return; }
                    setGlyph({ img }, 'своя картинка');
                },
            },
        }, [icon('fa-check'), h('span', { text: ' Поставить' })]),
        h('div.vte-note', { text: 'Картинка встаёт на место значка и того же размера. Ссылка работает с любого сайта — это фон, а не маска.' }),
    ]);
    const tab = (text, which) => h('button.vte-tb-tab', {
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
    const tabFa = tab('Font Awesome', 'fa');
    const tabImg = tab('Ссылка / SVG', 'img');
    (nowImg ? tabImg : tabFa).classList.add('active');
    if (nowImg) faPane.style.display = 'none';
    glyphPop = h('div.vte-tb-pop', {}, [
        h('div.vte-tb-pop-head', {}, [h('span', { text: `Значок: ${label}` }), iconBtn('fa-xmark', 'Закрыть', closeGlyphPicker, 'vte-tb-mini')]),
        h('div.vte-tb-tabs', {}, [tabFa, tabImg]),
        faPane, imgPane,
    ]);
    panel.appendChild(glyphPop);
    run();
    if (!nowImg) setTimeout(() => search.focus(), 0);
}

/** SVG-код → компактная data-ссылка, без скриптов */
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
   ПРИВЯЗАТЬ К БЛИЖАЙШЕМУ
   Смотрим, где элемент стоит сейчас на живом сообщении, выбираем
   ближайший угол опоры (пузыря — для ника и кнопок, аватарки — для
   бейджей) и привязываем к нему. Затем сразу применяем, меряем ещё раз
   и поправляем отступ на разницу — элемент остаётся ровно там, где был,
   но теперь держится за угол и едет вместе с ним на любом экране.
============================================================ */
function sampleMes(g) {
    const r = !g || state.link[g] ? 'bot' : state.role;
    const list = [...document.querySelectorAll(`#chat .mes[is_user="${r === 'user' ? 'true' : 'false'}"]:not(.smallSysMes)`)];
    const onScreen = list.filter(m => { const b = m.getBoundingClientRect(); return b.bottom > 0 && b.top < innerHeight; });
    return onScreen[onScreen.length - 1] || list[list.length - 1] || null;
}

/** Ближайший угол опоры и расстояния до её краёв. Для absolute-позиции
    отсчёт идёт от внутреннего края опоры (без рамки) и учитывает поля
    самого элемента — поэтому элемент встаёт ровно туда, где его видно */
function nearestCorner(el, boxEl) {
    const r = el.getBoundingClientRect();
    const b = boxEl.getBoundingClientRect();
    const bc = getComputedStyle(boxEl), ec = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    const d = {
        left: r.left - (b.left + px(bc.borderLeftWidth)) - px(ec.marginLeft),
        right: (b.right - px(bc.borderRightWidth)) - r.right - px(ec.marginRight),
        top: r.top - (b.top + px(bc.borderTopWidth)) - px(ec.marginTop),
        bottom: (b.bottom - px(bc.borderBottomWidth)) - r.bottom - px(ec.marginBottom),
    };
    const y = d.top <= d.bottom ? 'top' : 'bottom';
    const x = d.left <= d.right ? 'left' : 'right';
    return { corner: `${y}-${x}`, x, y, dx: Math.round(d[x]), dy: Math.round(d[y]) };
}

/** «12px от края, на 6px выше пузыря» — понятно и при отрицательных */
function distText(n) {
    const x = n.dx >= 0 ? `${n.dx}px от края` : `на ${-n.dx}px за краем`;
    const y = n.dy >= 0 ? `${n.dy}px ${n.y === 'top' ? 'от верха' : 'от низа'}`
        : `на ${-n.dy}px ${n.y === 'top' ? 'выше' : 'ниже'} пузыря`;
    return `${x}, ${y}`;
}

const CORNER_RU = { 'top-left': 'левому верхнему', 'top-right': 'правому верхнему', 'bottom-left': 'левому нижнему', 'bottom-right': 'правому нижнему' };

/* В ST у элементов плавная анимация (transition) — сразу после смены
   элемент ещё «едет», и замер попадает в середину пути. На время замера
   анимации выключаем: всё встаёт в конечное положение мгновенно */
let freezeStyle = null;
function freeze(on) {
    if (on) {
        freezeStyle ||= document.head.appendChild(document.createElement('style'));
        freezeStyle.textContent = '#chat *, #chat *::before, #chat *::after{transition:none!important;animation:none!important}';
    } else {
        freezeStyle?.remove();
        freezeStyle = null;
    }
}

function anchorName() {
    freeze(true);
    try { anchorNameNow(); } finally { freeze(false); }
}

function anchorNameNow() {
    const m = sampleMes('names');
    const el = m?.querySelector('.ch_name .alignItemsBaseline');
    const box = m?.querySelector('.mes_block');
    if (!el || !box) { say('Не нашла сообщение в чате — откройте чат'); return; }
    const n = nearestCorner(el, box);
    setVal('nameCorner', n.corner);
    setVal('nameX', n.dx);
    setVal('nameY', n.dy);
    commit();
    render();
    say(`Ник привязан к ${CORNER_RU[n.corner]} углу пузыря: ${distText(n)}`);
}

function anchorButtons(pre) {
    freeze(true);
    try { anchorButtonsNow(pre); } finally { freeze(false); }
}

function anchorButtonsNow(pre) {
    const m = sampleMes('buttons');
    const el = m?.querySelector(pre === 'btn' ? '.mes_buttons' : '.mes_edit_buttons');
    const box = m?.querySelector('.mes_block');
    if (!el || !box) { say('Не нашла сообщение в чате — откройте чат'); return; }
    // Кнопки правки видны только при правке — на время замера показываем
    const temp = !el.getBoundingClientRect().width && !hiddenShown;
    if (temp) showHidden(true);
    if (!el.getBoundingClientRect().width) { if (temp) showHidden(false); say('Кнопок сейчас не видно — отметьте «Показать скрытые кнопки»'); return; }
    const n = nearestCorner(el, box);
    if (temp) showHidden(false);
    const set = (k, v) => { setVal(`${pre}${k}Min`, v); setVal(`${pre}${k}Max`, v); };
    setVal(`${pre}Place`, 'block');
    setVal(`${pre}Corner`, n.corner);
    set('X', n.dx);
    set('Y', n.dy);
    commit();
    render();
    say(`${pre === 'btn' ? 'Кнопки' : 'Кнопки правки'} привязаны к ${CORNER_RU[n.corner]} углу пузыря: ${distText(n)}`);
}

/* Бейджи лежат в сетке аватарки — где они встанут, заранее не посчитать.
   Записываем привязку, меряем по-настоящему и, если бейджи сдвинулись,
   дописываем поправку, чтобы они остались, где были */
async function anchorBadges() {
    const m = sampleMes();
    const av = m?.querySelector('.mesAvatarWrapper .avatar');
    const union = () => {
        const rs = [...(m?.querySelectorAll('.mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay)') || [])]
            .filter(e => e.textContent.trim() && e.getBoundingClientRect().width).map(e => e.getBoundingClientRect());
        return rs.length ? { left: Math.min(...rs.map(r => r.left)), top: Math.min(...rs.map(r => r.top)),
            right: Math.max(...rs.map(r => r.right)), bottom: Math.max(...rs.map(r => r.bottom)) } : null;
    };
    freeze(true);
    const was = union();
    const a = av?.getBoundingClientRect();
    freeze(false);
    if (!a || !was) { say('Бейджей не видно — включите их в настройках SillyTavern'); return; }
    const cx = (was.left + was.right) / 2, cy = (was.top + was.bottom) / 2;
    const inside = was.top < a.bottom - 2 && was.bottom > a.top + 2;
    // На аватарке — к её ближнему краю; под ней — стопкой под аватаркой
    state.badgeMode = inside ? (cy < a.top + a.height / 2 ? 'onTop' : 'onBottom') : (was.bottom <= a.top ? 'onTop' : 'stack');
    state.badgeAlign = cx < a.left + a.width / 3 ? 'start' : cx > a.right - a.width / 3 ? 'end' : 'center';
    state.badgeX = 0;
    state.badgeY = 0;
    state.on = true;
    await commit();
    freeze(true);
    const now = union();
    const a2 = av.getBoundingClientRect();
    freeze(false);
    if (now) {
        // Относительно своей аватарки: чат выше мог сдвинуться — это не в счёт
        const dx = Math.round((was.left - a.left) - (now.left - a2.left));
        const dy = Math.round((was.top - a.top) - (now.top - a2.top));
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) { state.badgeX = dx; state.badgeY = dy; await commit(); }
    }
    render();
    const where = { onTop: 'к верху аватарки', onBottom: 'к низу аватарки', stack: 'под аватаркой' }[state.badgeMode];
    const side = { start: 'слева', center: 'по центру', end: 'справа' }[state.badgeAlign];
    say(`Бейджи привязаны ${where}, ${side}`);
}

const magnet = (text, fn, hint) => h('button.vte-btn.vte-bb-magnet', { type: 'button', title: hint, on: { click: fn } },
    [icon('fa-magnet'), h('span', { text: ` ${text}` })]);

function scrollUi() {
    const hideAll = val('sbHide') === 'both';
    const styleOk = !hideAll && val('sbWhere') !== val('sbHide');
    const urlInput = h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder: 'https://… картинка ползунка (png)', value: val('sbImg') || '',
        on: {
            change: (e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v) && !/^data:image\//i.test(v)) { say('Нужна ссылка http(s)://'); e.target.value = val('sbImg') || ''; return; }
                setVal('sbImg', v);
                commit();
                render();
            },
        },
    });
    return [
        row('Какая', select('sbScope', [['chat', 'только в чате'], ['all', 'во всём интерфейсе']], render)),
        row('Спрятать', select('sbHide', [['', 'нет'], ['phone', 'на телефоне'], ['pc', 'на ПК'], ['both', 'везде']], render),
            'Полосы не видно, а листать можно как раньше — колёсиком или пальцем'),
        h('small.vte-note', { text: 'Телефон — сенсорный экран без мыши, ПК — с мышью. Узкое окно браузера на ПК остаётся ПК.' }),
        hideAll ? null : row('Менять вид', select('sbWhere', [['both', 'везде'], ['pc', 'только на ПК'], ['phone', 'только на телефоне']], render)),
        !hideAll && !styleOk ? h('small.vte-note', { text: 'Там полоса спрятана — менять нечего. Выберите другое место.' }) : null,
        styleOk ? row('Толщина', slider('sbW', 0, 24, 'px', 'как в теме')) : null,
        styleOk && !val('sbImg') ? row('Ползунок', colorBtn('sbThumb', 'как в теме')) : null,
        styleOk ? row('Дорожка', colorBtn('sbTrack', 'как в теме')) : null,
        styleOk ? row('Скругление', slider('sbRadius', 0, 20, 'px', 'как в теме')) : null,
        styleOk ? row('Своя картинка', urlInput, 'PNG ссылкой — встаёт на ползунок вместо цвета') : null,
        styleOk && val('sbImg') ? row('Как вписать', select('sbFit', [['stretch', 'растянуть по ползунку'], ['contain', 'целиком, без искажений']])) : null,
        styleOk ? h('small.vte-note', { text: 'Картинка и скругление видны в Chrome, Edge, Opera, Яндекс и на Android. Firefox умеет только цвета.' }) : null,
    ];
}

/* Готовое сообщение со всеми видами разметки — вставить в чат и смотреть.
   Подчёркнутый в ST — __текст__ (включено в самой таверне) */
const PANGRAM = 'Съешь же ещё этих мягких французских булок, да выпей чаю.';
/* Всё, что понимает разметка SillyTavern (showdown с её настройками):
   заголовки, курсив, жирный, зачёркнутый, подчёркнутый (__…__), речь в
   кавычках, код в строке и блоком, цитаты (и цитата в цитате), списки,
   таблица, ссылка и линия. Между видами — пустая строка, чтобы каждый шёл
   отдельным абзацем */
const MARKDOWN_SAMPLE = [
    '# Заголовок первого уровня',
    '## Заголовок второго уровня',
    '### Заголовок третьего уровня',
    PANGRAM,
    `*Курсив: ${PANGRAM}*`,
    `**Жирный: ${PANGRAM}**`,
    `***Жирный курсив: ${PANGRAM}***`,
    `~~Зачёркнутый: ${PANGRAM}~~`,
    `__Подчёркнутый: ${PANGRAM}__`,
    `"Речь в кавычках: ${PANGRAM}"`,
    `"Речь, а в ней *курсив* и **жирный** — внутри кавычек."`,
    'Код в строке: `const love = true;`',
    '```\nблок кода\n  с отступом\n```',
    `> Цитата: ${PANGRAM}`,
    '> Цитата снаружи\n>> Цитата в цитате',
    '- пункт списка\n- ещё пункт\n  - вложенный пункт',
    '1. первый\n2. второй\n3. третий',
    '| Имя | Настроение |\n|---|---|\n| Бот | *задумчивый* |\n| Я | **счастливый** |',
    'Ссылка: [SillyTavern](https://github.com/SillyTavern/SillyTavern)',
    '---',
    PANGRAM,
].join('\n\n');

async function copyMarkdown() {
    let ok = false;
    try { await navigator.clipboard.writeText(MARKDOWN_SAMPLE); ok = true; } catch {}
    if (!ok) {
        // Запасной путь — если браузер не дал доступ к буферу
        const ta = document.createElement('textarea');
        ta.value = MARKDOWN_SAMPLE;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch {}
        ta.remove();
    }
    say(ok ? 'Скопировано — вставьте в поле ввода и отправьте, чтобы увидеть все виды разметки' : 'Не удалось скопировать');
}

let themeOpen = false;
function themeSection() {
    const list = onThemeRules?.(['.mes .mes_block', '.mes .mes_text', '.mes .ch_name', '.mes .name_text', '.mes .timestamp',
        '.mes .mes_buttons', '.mes .mes_button', '.mes .mesIDDisplay', '.mes .mes_timer', '.mes .tokenCounterDisplay']) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'правило' : 'правил'} про пузыри, текст, ник, кнопки и бейджи` })]));
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
    const role = state.role;
    // Текст и разметка — это окно «Markdown»: их «Сбросить» в «Пузырях» не трогает
    const keep = { bot: {}, user: {}, link: { textall: state.link.textall, colors: state.link.colors } };
    for (const r of ['bot', 'user']) for (const k of mdKeys()) keep[r][k] = state[r][k];
    state = { ...defaults(), role };
    for (const r of ['bot', 'user']) Object.assign(state[r], keep[r]);
    Object.assign(state.link, keep.link);
    state.on = true;
    showHidden(hiddenShown);
    commit();
    render();
    say('Пузыри снова как в теме');
}

/* ============================================================
   РАЗМЕР И ПЕРЕТАСКИВАНИЕ
============================================================ */
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
