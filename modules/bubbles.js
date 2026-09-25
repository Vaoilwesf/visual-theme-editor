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

let onApply = null;
let onReadRules = null;
let onThemeRules = null;
let onReveal = null;
let onToast = null;
let picker = null;
let onSnapshot = null;
let onRestore = null;

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
    strong: (r) => `${base(r)} .mes_text strong`,
    link: (r) => `${base(r)} .mes_text a`,
    // кнопки
    btns: (r) => `${base(r)} .mes_buttons`,
    btnAll: (r) => `${base(r)} :is(.mes_button, .extraMesButtons > div)`,
    btnHover: (r) => `${base(r)} :is(.mes_button, .extraMesButtons > div):hover`,
    btnRows: (r) => `${base(r)} :is(.mes_buttons, .extraMesButtons)`,
    edit: (r) => `${base(r)} .mes_edit_buttons`,
    editBtn: (r) => `${base(r)} .mes_edit_buttons .menu_button`,
    nameBox: (r) => `${base(r)} .ch_name > .flex1`,
    // пузырь: #chat — чтобы надёжно перекрыть и тему, и «Аватарки»
    box: (r, t) => (t === 'mes' ? `#chat ${base(r)}` : `#chat ${base(r)} .mes_block`),
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
    bubble: ['bg', 'bw', 'bc', 'radius', 'padT', 'padB', 'padX', 'maxW', 'fsMin', 'fsMax'],
    colors: ['cText', 'cEm', 'cStrong', 'cQuote', 'cU', 'cLink'],
    text: ['offY', 'offX'],
    names: ['nameCorner', 'nameX', 'nameY', 'datePos', 'dateX', 'dateY', 'nameSize', 'nameColor', 'nameNoWrap', 'nameWidth', 'dateSize', 'dateColor'],
    buttons: ['btnPlace', 'btnCorner', 'btnXMin', 'btnXMax', 'btnYMin', 'btnYMax', 'btnDir',
        'btnSMin', 'btnSMax', 'btnColor', 'btnOpacity', 'btnHover', 'btnBg', 'btnRadius', 'btnPad', 'btnGap', 'btnNoShadow',
        'edPlace', 'edCorner', 'edXMin', 'edXMax', 'edYMin', 'edYMax', 'edSize', 'edOpacity', 'edRadius', 'edGap'],
};
const GROUP_OF = Object.fromEntries(Object.entries(ROLE_GROUPS).flatMap(([g, keys]) => keys.map(k => [k, g])));

function roleDefaults() {
    return {
        bg: '', bw: 0, bc: '', radius: 0, padT: 0, padB: 0, padX: 0, maxW: 0, fsMin: 0, fsMax: 0,
        cText: '', cEm: '', cStrong: '', cQuote: '', cU: '', cLink: '',
        offY: 0, offX: 0,
        // nameCorner: '' — сдвиг от своего места; 'top-left' и т.д. — в углу
        // пузыря, nameX / nameY — расстояние от его краёв
        nameCorner: '', nameX: 0, nameY: 0, datePos: '', dateX: 0, dateY: 0,
        nameSize: 0, nameColor: '', nameNoWrap: false, nameWidth: 0,
        dateSize: 0, dateColor: '',
        // кнопки: где стоят ('' как в теме | row — в строке ника | after — сразу
        // после ника и даты | block — в углу блока с текстом), сдвиги телефон/ПК
        btnPlace: '', btnCorner: 'top-right', btnXMin: 0, btnXMax: 0, btnYMin: 0, btnYMax: 0, btnDir: '',
        btnSMin: 0, btnSMax: 0, btnColor: '', btnOpacity: 0, btnHover: 0, btnBg: '', btnRadius: 0, btnPad: 0, btnGap: 0,
        btnNoShadow: false,
        edPlace: '', edCorner: 'top-right', edXMin: 0, edXMax: 0, edYMin: 0, edYMax: 0,
        edSize: 0, edOpacity: 0, edRadius: 0, edGap: 0,
    };
}

function defaults() {
    return {
        on: false,
        role: 'bot',                 // какую вкладку правим, когда разведены
        link: { bubble: true, colors: true, text: true, names: true, buttons: true },
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
    };
}

/** Текущее значение поля: для раздела бот/пользователь — из нужной вкладки */
function val(key) {
    const g = GROUP_OF[key];
    if (!g) return state[key];
    return state[state.link[g] ? 'bot' : state.role][key];
}

function setVal(key, v) {
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
    const m = String(v || '').match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
    return m ? [+m[1], +m[2]] : [0, 0];
};

/* ---------- чтение одного раздела для одной «роли» ---------- */
const READ = {
    bubble(get, r, t) {
        const box = S.box(r, t);
        const bd = get(box, 'border').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
        const fs = readFluid(get(S.text(r), 'font-size'));
        return {
            bg: get(box, 'background-color'),
            bw: bd ? +bd[1] : 0, bc: bd && bd[2] !== 'currentColor' ? bd[2] : '',
            radius: num(get(box, 'border-radius')),
            padT: num(get(box, 'padding-top')), padB: num(get(box, 'padding-bottom')),
            padX: num(get(box, 'padding-left')),
            maxW: num(get(box, 'max-width')),
            fsMin: fs.min, fsMax: fs.max,
        };
    },
    colors(get, r) {
        return {
            cText: get(S.text(r), 'color'),
            cEm: get(S.text(r), '--SmartThemeEmColor'),
            cQuote: get(S.text(r), '--SmartThemeQuoteColor'),
            cU: get(S.text(r), '--SmartThemeUnderlineColor'),
            cStrong: get(S.strong(r), 'color'),
            cLink: get(S.link(r), 'color'),
        };
    },
    text(get, r) {
        // Старая схема: сдвиг лежал в margin-top текста
        return {
            offY: num(get(S.chname(r), 'margin-bottom') || get(S.text(r), 'margin-top')),
            offX: num(get(S.text(r), 'margin-left')),
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
        };
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

function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip(rules.get(sel)?.get(prop));

    // Пузырь: какая цель задана — «всё сообщение» или «текст с ником»
    const hasBox = (t) => ROLES.some(r => rules.get(S.box(r, t))?.size);
    s.target = !hasBox('block') && hasBox('mes') ? 'mes' : 'block';

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

    const any = [...rules.keys()].some(k => /\.mes\b/.test(k) && rules.get(k)?.size);
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
    each('bubble', (r, v) => {
        for (const t of ['block', 'mes']) {
            const box = S.box(r, t);
            const w = v && s.target === t ? v : null;
            put(box, 'background-color', w?.bg || '');
            // Цвет ещё не выбран — обводка цвета текста, толщина не теряется
            put(box, 'border', w && w.bw ? `${w.bw}px solid ${w.bc || 'currentColor'}` : '');
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
        // Размер текста: ST считает высоту строки от --mainFontSize, поэтому
        // меняем и её — строки не слипаются и не разъезжаются
        const fs = v ? fluid(v.fsMin, v.fsMax) : '';
        put(S.text(r), 'font-size', fs);
        put(S.text(r), '--mainFontSize', fs);
    });

    /* ---------- цвета текста ---------- */
    each('colors', (r, v) => {
        put(S.text(r), 'color', v?.cText || '');
        put(S.text(r), '--SmartThemeEmColor', v?.cEm || '');
        put(S.text(r), '--SmartThemeQuoteColor', v?.cQuote || '');
        put(S.text(r), '--SmartThemeUnderlineColor', v?.cU || '');
        put(S.strong(r), 'color', v?.cStrong || '');
        put(S.link(r), 'color', v?.cLink || '');
    });

    /* ---------- положение текста ----------
       Вверх-вниз — отступ под строкой ника: под ней идёт то, что есть
       (рассуждения или сразу текст), расстояние одинаковое всегда. */
    let lifted = false;
    each('text', (r, v) => {
        if (v && v.offY < 0) lifted = true;
        put(S.chname(r), 'margin-bottom', px(v?.offY));
        put(S.text(r), 'margin-left', px(v?.offX));
        put(S.reason(r), 'margin-left', px(v?.offX));
        // У рассуждений в ST свой отступ сверху — при заданном сдвиге убираем
        put(S.reason(r), 'margin-top', v?.offY ? '0' : '');
        put(S.text(r), 'margin-top', '');   // старая схема
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
        put(S.editBtn(r), 'opacity', v?.edOpacity ? String(r2(v.edOpacity / 100)) : '');
        put(S.editBtn(r), 'border-radius', px(v?.edRadius));
    });

    // Опора для «в углу пузыря» (ник, кнопки) — одна строка на роль
    for (const r of ROLES) put(S.box(r, 'block'), 'position', blockRel[r] ? 'relative' : '');

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

    /* ---------- место справа, обрезка, промежутки ---------- */
    const rs = on && s.rightSpace;
    put(G.mes, '--mes-right-spacing', rs ? `${s.rightSpace}px` : '');
    put(G.text, 'overflow-wrap', rs ? 'anywhere' : '');
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
    for (const [sel, decls] of Object.entries(buildRules(state))) {
        const body = Object.entries(decls).filter(([, v]) => v).map(([p, v]) => `${p}:${v} !important`).join(';');
        if (body) css += `${sel}{${body}}\n`;
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
    const role = state?.role || 'bot';
    state = readState();
    state.role = role;
    if (!panel) build();
    panel.style.display = 'flex';
    render();
}

export function refresh() {
    if (!isOpen()) return;
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
    return h('div.vte-tb-row', { title: hint || '' }, [h('span.vte-tb-label', { text: label }), control]);
}

function slider(key, min, max, unit, zeroText, hint) {
    const out = h('span.vte-tb-val');
    const show = () => { const v = val(key); out.textContent = v ? `${v}${unit}` : zeroText; };
    const input = h('input.vte-tb-range', {
        type: 'range', min: String(min), max: String(max), step: '1', value: String(val(key) || 0),
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

/* Какие разделы раскрыты */
const open = { bubble: true, colors: false, text: false, names: false, buttons: false, badges: false };

function group(id, title, children) {
    const list = children.filter(Boolean);
    const head = h(`button.vte-av-group-head${open[id] ? '.open' : ''}`, {
        type: 'button',
        on: { click: () => { open[id] = !open[id]; render(); } },
    }, [icon(open[id] ? 'fa-chevron-down' : 'fa-chevron-right'), h('span', { text: title })]);
    return h('div.vte-av-group', {}, [head, open[id] ? h('div.vte-av-group-body', {}, list) : null]);
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

function render() {
    const b = els.body;
    b.textContent = '';
    b.append(...screen().filter(Boolean));
}

function screen() {
    return [
        themeSection(),

        group('bubble', 'Пузырь', [
            row('Что считать пузырём', select('target', [
                ['block', 'текст с ником'], ['mes', 'всё сообщение с аватаркой'],
            ], () => render())),
            roleBar('bubble'),
            row('Фон', colorBtn('bg', 'как в теме')),
            row('Обводка', slider('bw', 0, 8, 'px', 'нет')),
            val('bw') ? row('Цвет обводки', colorBtn('bc', 'цвет текста')) : null,
            row('Скругление', slider('radius', 0, 40, 'px', 'как в теме')),
            h('small.vte-note', { text: 'Внутренние отступы — от края пузыря до текста. Ник, текст и кнопки двигаются вместе с ними, ничего не наезжает.' }),
            row('Отступ сверху', slider('padT', 0, 60, 'px', 'как в теме')),
            row('Отступ снизу', slider('padB', 0, 60, 'px', 'как в теме')),
            row('Отступ по бокам', slider('padX', 0, 60, 'px', 'как в теме')),
            row('Ширина пузыря', slider('maxW', 0, 100, '%', 'во всю ширину'),
                'Считается от ширины чата — на телефоне и ПК пропорция одна'),
            pair('Размер текста', 'fsMin', 'fsMax', 32, 'Первое — на узком экране, второе — на широком'),
            h('div.vte-bb-shared', { text: 'Общее для всех сообщений' }),
            row('Место справа под стрелки', slider('rightSpace', 0, 40, 'px', 'как в теме (30px)'),
                'В SillyTavern справа от текста оставлено 30px под стрелки свайпа. Меньше — текст шире'),
            row('Между сообщениями', slider('gapMes', 0, 40, 'px', 'как в теме')),
        ]),

        group('colors', 'Цвета текста', [
            roleBar('colors'),
            row('Обычный текст', colorBtn('cText', 'как в теме')),
            row('*Курсив*', colorBtn('cEm', 'как в теме')),
            row('**Жирный**', colorBtn('cStrong', 'как в теме')),
            row('«Кавычки»', colorBtn('cQuote', 'как в теме')),
            row('Подчёркнутый', colorBtn('cU', 'как в теме')),
            row('Ссылки', colorBtn('cLink', 'как в теме')),
            h('small.vte-note', { text: 'Курсив, кавычки и подчёркнутый меняются через цвета самой SillyTavern — '
                + 'курсив внутри кавычек и рассуждения она по-прежнему красит сама.' }),
        ]),

        group('text', 'Положение текста', [
            roleBar('text'),
            h('small.vte-note', { text: 'Отступ от ника — одинаковый в каждом сообщении, с блоком рассуждений и без него.' }),
            row('Отступ от ника', slider('offY', -150, 300, 'px', 'нет')),
            row('Сдвиг вбок', slider('offX', -300, 300, 'px', 'нет')),
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

        group('buttons', 'Кнопки сообщения', buttonsUi()),

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
            h('button.vte-btn', { type: 'button', on: { click: resetAll } },
                [icon('fa-rotate-left'), h('span', { text: ' Вернуть как в теме' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Вернуть тему к виду, какой был при открытии этого окна — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    ];
}

/* ============================================================
   КНОПКИ СООБЩЕНИЯ — интерфейс
============================================================ */
const PLACES = [
    ['', 'как в теме'],
    ['row', 'в строке ника (сдвинуть от своего места)'],
    ['after', 'сразу после ника и даты'],
    ['block', 'в углу блока с текстом'],
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
        p ? pair(p === 'block' ? 'От края по горизонтали' : 'Сдвиг вбок', `${pre}XMin`, `${pre}XMax`, 400,
            'Первое — на телефоне, второе — на ПК. Между ними плавно', -400, 'нет') : null,
        p ? pair(p === 'block' ? 'От края по вертикали' : 'Сдвиг вверх-вниз', `${pre}YMin`, `${pre}YMax`, 400,
            'Минус — за край блока', -400, 'нет') : null,
    ];
}

function buttonsUi() {
    return [
        roleBar('buttons'),
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

        h('div.vte-bb-shared', { text: 'Кнопки в режиме правки' }),
        magnet('Привязать к ближайшему', () => anchorButtons('ed'), 'То же для кнопок правки'),
        ...placeRows('ed', 'Где стоят'),
        row('Размер кнопок', slider('edSize', 0, 60, 'px', 'как в теме')),
        row('Видимость', slider('edOpacity', 0, 100, '%', 'как в теме (50%)')),
        row('Скругление', slider('edRadius', 0, 30, 'px', 'как в теме')),
        row('Между кнопками', slider('edGap', 0, 24, 'px', 'как в теме')),

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

    const url = h('input.vte-input', { type: 'text', spellcheck: false, placeholder: 'https://… ссылка на .svg / .png / .webp' });
    const code = h('textarea.vte-input.vte-tb-svg', { spellcheck: false, placeholder: 'или вставьте код <svg>…</svg>', rows: 4 });
    const imgPane = h('div.vte-tb-pane.vte-tb-imgpane', { style: 'display:none' }, [
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
    tabFa.classList.add('active');
    glyphPop = h('div.vte-tb-pop', {}, [
        h('div.vte-tb-pop-head', {}, [h('span', { text: `Значок: ${label}` }), iconBtn('fa-xmark', 'Закрыть', closeGlyphPicker, 'vte-tb-mini')]),
        h('div.vte-tb-tabs', {}, [tabFa, tab('Ссылка / SVG', 'img')]),
        faPane, imgPane,
    ]);
    panel.appendChild(glyphPop);
    run();
    setTimeout(() => search.focus(), 0);
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
    state = { ...defaults(), role };
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
