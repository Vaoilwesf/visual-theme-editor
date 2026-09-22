// modules/avatars.js
// «Аватарки ♡»: форма аватарки (обтравочная маска), её размер и положение,
// подложка за ней и слой поверх, плюс растянутый текст в сообщениях.
//
// Что пишется в CSS (раздел «Сообщения ♡» блока «Мои правки»):
//   .mes .mesAvatarWrapper          — размер «сцены» аватарки;
//   .mes .avatar                    — сама аватарка: форма, рамка, сдвиг;
//   .mes .avatar img                — кадрирование картинки;
//   .mes .mesAvatarWrapper::after   — подложка позади;
//   .mes .mesAvatarWrapper::before  — слой поверх (рамка-картинка);
//   .mes / .mes_block / .mes_text   — раскладка и ширина текста.
//
// Почему так, а не иначе:
//  - размеры «резиновые»: clamp(телефон, формула от ширины, ПК). Одна строка
//    вместо четырёх @media, как обычно пишут в темах;
//  - форма — mask-image с готовыми SVG внутри расширения: они лежат прямо
//    в CSS как data-ссылка, ничего не грузится и работает всегда;
//  - своя картинка-маска с чужого сайта браузеру нужна с разрешением CORS,
//    поэтому ссылку сразу проверяем и честно говорим, подойдёт ли она;
//  - аватарка остаётся в потоке (не абсолютная): бейджи под ней не уезжают,
//    а высота сообщения считается сама.

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
    mes: '.mes',
    wrap: '.mes .mesAvatarWrapper',
    av: '.mes .avatar',
    img: '.mes .avatar img',
    back: '.mes .mesAvatarWrapper::after',    // подложка
    over: '.mes .mesAvatarWrapper::before',   // слой поверх
    banner: '.mes::before',                   // шапка позади сообщения
    block: '.mes .mes_block',
    chname: '.mes .ch_name',
    // Строка «ник + призрак + дата». Двигаем её — ник и дата едут вместе,
    // а кнопки сообщения (они в соседнем блоке) стоят на месте
    nameRow: '.mes .ch_name .alignItemsBaseline',
    nameText: '.mes .name_text',
    date: '.mes .timestamp',
    badges: '.mes .mesIDDisplay, .mes .mes_timer, .mes .tokenCounterDisplay',
    b1: '.mes .mesIDDisplay',
    b2: '.mes .mes_timer',
    b3: '.mes .tokenCounterDisplay',
    badgesEmpty: '.mes .mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):empty',
    stair1: '.mes .mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty) ~ :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty)',
    stair2: '.mes .mesAvatarWrapper > :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty) ~ :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty) ~ :is(.mesIDDisplay, .mes_timer, .tokenCounterDisplay):not(:empty)',
    text: '.mes .mes_text',
    name: '.mes .ch_name',
};

/* Текст сообщений: бот и пользователь отдельно.
   Вверх-вниз — это отступ под строкой с ником. Под ней идёт то, что есть:
   блок рассуждений (если он есть) или сразу текст. Браузер сам ставит
   первым существующий блок, поэтому расстояние одинаковое во всех
   сообщениях и ничего проверять не нужно.
   Вбок — сдвиг самого текста и рассуждений, ник остаётся на месте. */
const TXT = {
    bot: '.mes[is_user="false"] .mes_text',
    botName: '.mes[is_user="false"] .ch_name',
    botReason: '.mes[is_user="false"] .mes_reasoning_details',
    user: '.mes[is_user="true"] .mes_text',
    userName: '.mes[is_user="true"] .ch_name',
    // ST у последнего сообщения добавляет под аватаркой пустое место
    // высотой с аватарку (для стрелок свайпа сбоку от текста). Когда
    // текст под аватаркой, это место становится дырой над ником
    lastWrap: '.mes.last_mes .mesAvatarWrapper',
    // …а стрелкам свайпа место нужно снизу, под текстом — и только когда они видны
    lastSwipes: '.mes.last_mes:is(.swipes_visible, .last_swipe) .mes_block',
};
/* Старая схема (сдвиг через margin-top текста) — только чтобы прочитать и стереть */
const TXT_OLD = {
    botReason: '.mes[is_user="false"].reasoning .mes_reasoning_details[data-has-content="true"]',
    botAfterReason: '.mes[is_user="false"].reasoning .mes_reasoning_details[data-has-content="true"] + .mes_text',
};

const VW_MIN = 360;
const VW_MAX = 1280;

/* ============================================================
   ФОРМЫ
   SVG рисуются в квадрате 100×100 и растягиваются под размер
   аватарки. Вес каждой — пара сотен байт.
============================================================ */
const SHAPES = [
    { id: 'none', name: 'Как в теме' },
    { id: 'circle', name: 'Круг', radius: '50%' },
    { id: 'rounded', name: 'Скруглённый', radius: '18%' },
    { id: 'squircle', name: 'Мягкий квадрат', radius: '32% / 28%' },
    { id: 'square', name: 'Квадрат', radius: '0' },
    { id: 'blob', name: 'Клякса', path: 'M50 4c17 0 36 8 43 24s0 37-11 50-29 20-45 16S7 73 4 56 12 22 25 13 38 4 50 4z' },
    { id: 'heart', name: 'Сердце', path: 'M50 90C21 69 7 53 7 35 7 21 18 10 32 10c9 0 15 4 18 10 3-6 9-10 18-10 14 0 25 11 25 25 0 18-14 34-43 55z' },
    { id: 'star', name: 'Звезда', path: 'M50 4l13 29 32 3-24 21 7 31-28-16-28 16 7-31-24-21 32-3z' },
    { id: 'hex', name: 'Шестиугольник', path: 'M50 3l41 23v48L50 97 9 74V26z' },
    { id: 'arch', name: 'Арка', path: 'M9 97V41a41 41 0 0 1 82 0v56z' },
    { id: 'drop', name: 'Капля', path: 'M50 5c30 21 41 41 41 57a41 41 0 0 1-82 0C9 46 20 26 50 5z' },
    { id: 'diamond', name: 'Ромб', path: 'M50 3 97 50 50 97 3 50z' },
    { id: 'custom', name: 'Своя картинка или SVG' },
];

const shapeUrl = (path) =>
    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath d='${path}' fill='%23000'/%3E%3C/svg%3E")`;

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
   Одна страница со свёрнутыми разделами: всё, что относится к
   сообщению, настраивается в одном месте, без беготни по экранам.
============================================================ */
function defaults() {
    return {
        on: false,
        screen: 'home',

        /* ---- аватарка ---- */
        full: false,               // во всю ширину сообщения
        wMin: 0, wMax: 0,
        hMin: 0, hMax: 0,
        shape: 'none', maskUrl: '',
        posX: 0,                   // положение по ширине: 0 — слева, 100 — справа
        dx: 0, dy: 0,              // точная подгонка
        ring: 0, ringColor: '',

        /* ---- подложка ---- */
        backOn: false, backImg: '', backColor: '',
        backW: 0, backH: 0, backX: 0, backY: 0,
        backRadius: 0, backOpacity: 100, backFront: false,
        backRing: 0, backRingColor: '',

        /* ---- слой поверх ---- */
        overOn: false, overImg: '',
        overW: 0, overH: 0, overX: 0, overY: 0, overRotate: 0, overOpacity: 100,

        /* ---- шапка ---- */
        bannerOn: false, bannerImg: '',
        bannerHMin: 0, bannerHMax: 0,
        bannerScale: 100, bannerX: 50, bannerY: 50,
        bannerRadius: 0, bannerOpacity: 100,
        bannerFade: 0, bannerBlur: 0,
        bannerRing: 0, bannerRingColor: '',
        bannerClip: true,

        /* ---- раскладка ---- (ник, бейджи, текст и сам пузырь — в окне «Пузыри») */
        below: false,
    };
}

const strip = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();
const urlOf = (v) => {
    const m = String(v || '').match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/);
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};
const num = (v) => Math.round(parseFloat(v) || 0);
const pct = (v) => (v ? Math.round(parseFloat(v) * 100) : 0);

function readFluid(v) {
    const m = String(v || '').match(/^clamp\(\s*(-?\d+(?:\.\d+)?)px\s*,.*,\s*(-?\d+(?:\.\d+)?)px\s*\)$/);
    if (m) return { min: Math.round(+m[1]), max: Math.round(+m[2]) };
    const p = String(v || '').match(/^(-?\d+(?:\.\d+)?)px$/);
    return p ? { min: Math.round(+p[1]), max: Math.round(+p[1]) } : { min: 0, max: 0 };
}

/** Из какого угла отсчитывается положение */
function anchorOf(get, sel) {
    const has = (p) => get(sel, p) !== '';
    if (has('right') && has('bottom')) return 'bottom-right';
    if (has('right')) return 'top-right';
    if (has('bottom')) return 'bottom-left';
    return 'top-left';
}

function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip(rules.get(sel)?.get(prop));
    const any = [SEL.wrap, SEL.av, SEL.banner, SEL.mes].some(k => rules.get(k)?.size);
    if (!any) return s;
    s.on = true;

    const wRaw = get(SEL.wrap, 'width');
    s.full = wRaw === '100%';
    const w = readFluid(wRaw);
    s.wMin = w.min; s.wMax = w.max;
    const hh = readFluid(get(SEL.av, 'height'));
    s.hMin = hh.min; s.hMax = hh.max;

    const mask = urlOf(get(SEL.av, 'mask') || get(SEL.av, '-webkit-mask'));
    if (mask) {
        const known = SHAPES.find(x => x.path && mask.includes(x.path.slice(0, 18)));
        s.shape = known ? known.id : 'custom';
        if (!known) s.maskUrl = mask;
    } else {
        const r = get(SEL.av, 'border-radius');
        const byRadius = SHAPES.find(x => x.radius && x.radius === r);
        s.shape = byRadius ? byRadius.id : 'none';
    }

    const ml = get(SEL.wrap, 'margin-left').match(/\*\s*([\d.]+)\s*\)/);
    s.posX = ml ? Math.round(+ml[1] * 100) : 0;
    const shift = get(SEL.wrap, 'transform').match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/);
    if (shift) { s.dx = +shift[1]; s.dy = +shift[2]; }

    const ring = get(SEL.av, 'outline').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
    if (ring) { s.ring = +ring[1]; s.ringColor = ring[2]; }

    /* подложка */
    s.backImg = urlOf(get(SEL.back, 'background-image'));
    s.backColor = get(SEL.back, 'background-color');
    s.backOn = !!(s.backImg || s.backColor);
    s.backW = num(get(SEL.back, 'width'));
    s.backH = num(get(SEL.back, 'height'));
    s.backRadius = num(get(SEL.back, 'border-radius'));
    s.backOpacity = pct(get(SEL.back, 'opacity')) || 100;
    s.backFront = get(SEL.back, 'z-index') === '2';
    const bt = get(SEL.back, 'transform').match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)\s*$/);
    if (bt) { s.backX = +bt[1]; s.backY = +bt[2]; }
    const br = get(SEL.back, 'outline').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
    if (br) { s.backRing = +br[1]; s.backRingColor = br[2]; }

    /* слой поверх */
    s.overImg = urlOf(get(SEL.over, 'background-image'));
    s.overOn = !!s.overImg;
    s.overW = num(get(SEL.over, 'width'));
    s.overH = num(get(SEL.over, 'height'));
    const ot = get(SEL.over, 'transform');
    const om = ot.match(/translate\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)/);
    if (om) { s.overX = +om[1]; s.overY = +om[2]; }
    s.overRotate = num((ot.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/) || [])[1]);
    s.overOpacity = pct(get(SEL.over, 'opacity')) || 100;

    /* шапка */
    s.bannerImg = urlOf(get(SEL.banner, 'background-image'));
    s.bannerOn = !!s.bannerImg;
    const bh = readFluid(get(SEL.banner, 'height'));
    s.bannerHMin = bh.min; s.bannerHMax = bh.max;
    s.bannerScale = num(get(SEL.banner, 'background-size')) || 100;
    const bp = get(SEL.banner, 'background-position').match(/(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/);
    if (bp) { s.bannerX = +bp[1]; s.bannerY = +bp[2]; }
    s.bannerRadius = num(get(SEL.banner, 'border-radius'));
    s.bannerOpacity = pct(get(SEL.banner, 'opacity')) || 100;
    s.bannerBlur = num((get(SEL.banner, 'filter').match(/blur\((\d+)/) || [])[1]);
    const fade = get(SEL.banner, 'mask-image').match(/#000\s+(\d+)%/);
    s.bannerFade = fade ? 100 - +fade[1] : 0;
    const bnr = get(SEL.banner, 'outline').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
    if (bnr) { s.bannerRing = +bnr[1]; s.bannerRingColor = bnr[2]; }
    s.bannerClip = get(SEL.mes, 'overflow') === 'hidden';

    /* раскладка */
    s.below = get(SEL.mes, 'flex-direction') === 'column';
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
const r2 = (n) => Math.round(n * 100) / 100;

function fluid(min, max) {
    if (!min && !max) return '';
    const lo = Math.min(min || max, max || min);
    const hi = Math.max(min || max, max || min);
    if (lo === hi) return `${lo}px`;
    const slope = (hi - lo) / (VW_MAX - VW_MIN);
    const base = lo - slope * VW_MIN;
    return `clamp(${lo}px, ${r2(base)}px + ${r2(slope * 100)}vw, ${hi}px)`;
}

const cssUrl = (u) => `url("${String(u).replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

/** Стороны по выбранному углу: { x, y } — какие свойства писать */
const sides = (anchor) => ({
    x: anchor.includes('right') ? 'right' : 'left',
    y: anchor.includes('bottom') ? 'bottom' : 'top',
    ox: anchor.includes('right') ? 'left' : 'right',
    oy: anchor.includes('bottom') ? 'top' : 'bottom',
});

function buildRules(s) {
    const rules = {};
    const put = (sel, prop, val) => { (rules[sel] ||= {})[prop] = val; };
    const on = s.on;

    /* ---------- раскладка и текст ---------- */
    put(SEL.mes, 'flex-direction', on && s.below ? 'column' : '');
    put(SEL.mes, 'align-items', on && s.below ? 'flex-start' : '');
    put(SEL.block, 'width', on && s.below ? '100%' : '');
    put(SEL.block, 'padding-left', on && s.below ? '0' : '');
    // Старый общий сдвиг всего блока (двигал и ник) — стираем
    put(SEL.block, 'margin-top', '');
    put(SEL.block, 'margin-left', '');

    // Текст под аватаркой: убираем дыру у последнего сообщения, а место
    // для стрелок свайпа оставляем под текстом, когда стрелки видны
    put(TXT.lastWrap, 'padding-bottom', on && s.below ? '0' : '');
    put(TXT.lastSwipes, 'padding-bottom', on && s.below
        ? 'calc(25px + var(--swipeCounterHeight, 15px) + var(--swipeCounterMargin, 5px))' : '');


    /* ---------- аватарка ---------- */
    const w = s.full ? '100%' : fluid(s.wMin, s.wMax);
    const hgt = fluid(s.hMin, s.hMax);
    put(SEL.wrap, 'position', on ? 'relative' : '');
    put(SEL.wrap, 'width', on ? w : '');
    put(SEL.wrap, 'flex-shrink', on && w ? '0' : '');
    // Положение по ширине: 0 — у левого края, 100 — вплотную к правому.
    // Считается от ширины сообщения, поэтому на телефоне аватарка не уезжает
    put(SEL.wrap, 'margin-left', on && !s.full && s.posX && w ? `calc((100% - ${w}) * ${r2(s.posX / 100)})` : '');
    put(SEL.wrap, 'transform', on && (s.dx || s.dy) ? `translate(${s.dx}px, ${s.dy}px)` : '');
    put(SEL.wrap, 'z-index', on ? '1' : '');

    const shape = SHAPES.find(x => x.id === s.shape) || SHAPES[0];
    const mask = on
        ? (shape.path ? shapeUrl(shape.path) : (s.shape === 'custom' && s.maskUrl ? cssUrl(s.maskUrl) : ''))
        : '';
    put(SEL.av, 'width', on && w ? '100%' : '');
    put(SEL.av, 'height', on ? hgt : '');
    put(SEL.av, 'border-radius', on && shape.radius ? shape.radius : '');
    put(SEL.av, 'overflow', on ? 'hidden' : '');
    put(SEL.av, 'outline', on && s.ring && s.ringColor ? `${s.ring}px solid ${s.ringColor}` : '');
    put(SEL.av, 'outline-offset', on && s.ring ? '0' : '');
    put(SEL.av, 'mask', mask ? `${mask} center / contain no-repeat` : '');
    put(SEL.av, '-webkit-mask', mask ? `${mask} center / contain no-repeat` : '');

    put(SEL.img, 'width', on ? '100%' : '');
    put(SEL.img, 'height', on ? '100%' : '');
    put(SEL.img, 'object-fit', on ? 'cover' : '');
    put(SEL.img, 'border-radius', on ? 'inherit' : '');
    put(SEL.img, 'border', on ? 'none' : '');
    put(SEL.img, 'box-shadow', on ? 'none' : '');

    /* ---------- подложка ---------- */
    const back = on && s.backOn && (s.backImg || s.backColor);
    put(SEL.back, 'content', back ? '""' : '');
    put(SEL.back, 'position', back ? 'absolute' : '');
    put(SEL.back, 'left', back ? '50%' : '');
    put(SEL.back, 'top', back ? '50%' : '');
    put(SEL.back, 'width', back ? `${s.backW || 140}px` : '');
    put(SEL.back, 'height', back ? `${s.backH || 140}px` : '');
    put(SEL.back, 'transform', back ? `translate(-50%, -50%) translate(${s.backX}px, ${s.backY}px)` : '');
    put(SEL.back, 'background-color', back ? s.backColor : '');
    put(SEL.back, 'background-image', back && s.backImg ? cssUrl(s.backImg) : '');
    put(SEL.back, 'background-size', back && s.backImg ? 'contain' : '');
    put(SEL.back, 'background-position', back && s.backImg ? 'center' : '');
    put(SEL.back, 'background-repeat', back && s.backImg ? 'no-repeat' : '');
    put(SEL.back, 'border-radius', back && s.backRadius ? `${s.backRadius}%` : '');
    put(SEL.back, 'outline', back && s.backRing && s.backRingColor ? `${s.backRing}px solid ${s.backRingColor}` : '');
    put(SEL.back, 'opacity', back && s.backOpacity !== 100 ? r2(s.backOpacity / 100) : '');
    put(SEL.back, 'z-index', back ? (s.backFront ? '2' : '-1') : '');
    put(SEL.back, 'pointer-events', back ? 'none' : '');

    /* ---------- слой поверх ---------- */
    const over = on && s.overOn && s.overImg;
    put(SEL.over, 'content', over ? '""' : '');
    put(SEL.over, 'position', over ? 'absolute' : '');
    put(SEL.over, 'left', over ? '50%' : '');
    put(SEL.over, 'top', over ? '50%' : '');
    put(SEL.over, 'width', over ? `${s.overW || 140}px` : '');
    put(SEL.over, 'height', over ? `${s.overH || 140}px` : '');
    put(SEL.over, 'background-image', over ? cssUrl(s.overImg) : '');
    put(SEL.over, 'background-size', over ? 'contain' : '');
    put(SEL.over, 'background-position', over ? 'center' : '');
    put(SEL.over, 'background-repeat', over ? 'no-repeat' : '');
    put(SEL.over, 'transform', over
        ? `translate(-50%, -50%) translate(${s.overX}px, ${s.overY}px)${s.overRotate ? ` rotate(${s.overRotate}deg)` : ''}`
        : '');
    put(SEL.over, 'opacity', over && s.overOpacity !== 100 ? r2(s.overOpacity / 100) : '');
    put(SEL.over, 'z-index', over ? '3' : '');
    put(SEL.over, 'pointer-events', over ? 'none' : '');

    /* ---------- шапка ---------- */
    const ban = on && s.bannerOn && s.bannerImg;
    const bh = fluid(s.bannerHMin, s.bannerHMax);
    put(SEL.mes, 'position', ban ? 'relative' : '');
    put(SEL.mes, 'overflow', ban && s.bannerClip ? 'hidden' : '');
    put(SEL.banner, 'content', ban ? '""' : '');
    put(SEL.banner, 'position', ban ? 'absolute' : '');
    put(SEL.banner, 'left', ban ? '0' : '');
    put(SEL.banner, 'right', ban ? '0' : '');
    put(SEL.banner, 'top', ban ? '0' : '');
    put(SEL.banner, 'height', ban ? (bh || '160px') : '');
    put(SEL.banner, 'background-image', ban ? cssUrl(s.bannerImg) : '');
    put(SEL.banner, 'background-size', ban ? `${s.bannerScale}% auto` : '');
    put(SEL.banner, 'background-position', ban ? `${s.bannerX}% ${s.bannerY}%` : '');
    put(SEL.banner, 'background-repeat', ban ? 'no-repeat' : '');
    put(SEL.banner, 'border-radius', ban && s.bannerRadius ? `${s.bannerRadius}px` : '');
    put(SEL.banner, 'outline', ban && s.bannerRing && s.bannerRingColor ? `${s.bannerRing}px solid ${s.bannerRingColor}` : '');
    put(SEL.banner, 'opacity', ban && s.bannerOpacity !== 100 ? r2(s.bannerOpacity / 100) : '');
    put(SEL.banner, 'filter', ban && s.bannerBlur ? `blur(${s.bannerBlur}px)` : '');
    const fadeMask = ban && s.bannerFade
        ? `linear-gradient(to bottom, #000 ${100 - s.bannerFade}%, transparent 100%)`
        : '';
    put(SEL.banner, 'mask-image', fadeMask);
    put(SEL.banner, '-webkit-mask-image', fadeMask);
    put(SEL.banner, 'z-index', ban ? '0' : '');
    put(SEL.banner, 'pointer-events', ban ? 'none' : '');
    put(SEL.block, 'position', ban ? 'relative' : '');
    put(SEL.block, 'z-index', ban ? '1' : '');

    return rules;
}

/* ============================================================
   ПРЕДПРОСМОТР
   Аватарок в чате много, поэтому правим не каждую, а один маленький
   слой стилей с нашими правилами, и не чаще раза за кадр.
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
        previewStyle.id = 'vte-avatars-preview';
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
    const screen = state?.screen || 'home';
    state = readState();
    state.screen = screen;
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
    if (panel) panel.style.display = 'none';
}

export function isOpen() {
    return !!panel && panel.style.display !== 'none';
}

export function togglePanel() {
    isOpen() ? hidePanel() : showPanel();
}

function build() {
    els.title = h('span', { text: 'Аватарки' });
    els.back = h('button.vte-av-back', {
        type: 'button', title: 'Назад к списку', style: 'display:none',
        on: { click: () => { state.screen = 'home'; render(); } },
    }, [icon('fa-chevron-left')]);

    const header = h('div.vte-header', {}, [
        h('div.vte-title', {}, [els.back, h('span.vte-title-ic', {}, [icon('fa-user-astronaut')]), els.title]),
        h('div.vte-header-btns', {}, [
            iconBtn('fa-window-minimize', 'Свернуть', () => panel.classList.toggle('vte-collapsed')),
            iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close'),
        ]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-avatars-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-avatars-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
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
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v) && !/^data:image\//i.test(v) && !/^\/?user\/files\/[\w.-]+$/i.test(v)) {
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

/* ============================================================
   СТРАНИЦА НАСТРОЕК
   Шаблон — это набор стартовых значений. Дальше всё крутится на одной
   странице: разделы можно сворачивать, чтобы не мешали.
============================================================ */
const TEMPLATES = [
    {
        id: 'mask', name: 'Своя форма', icon: 'fa-shapes',
        hint: 'Аватарка обрезана по фигуре, текст под ней',
        set: { shape: 'blob', wMin: 200, wMax: 280, hMin: 240, hMax: 340, below: true },
    },
    {
        id: 'tumblr', name: 'Во всю ширину', icon: 'fa-image',
        hint: 'Широкая аватарка сверху, под ней имя и текст',
        set: { full: true, hMin: 220, hMax: 340, shape: 'rounded', below: true },
    },
    {
        id: 'banner', name: 'Шапка с аватаркой', icon: 'fa-panorama',
        hint: 'Картинка-шапка позади, аватарка поверх неё',
        set: {
            bannerOn: true, bannerHMin: 130, bannerHMax: 190, bannerFade: 30, bannerClip: true,
            wMin: 90, wMax: 120, hMin: 90, hMax: 120, shape: 'circle', dy: 60, below: true,
        },
    },
];

/* Какие разделы раскрыты (переживает перерисовку) */
const open = { shape: true, pos: true, back: false, over: false, banner: false, names: false, badges: false, text: true };

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
    const home = (state.screen || 'home') === 'home';
    els.title.textContent = home ? 'Аватарки' : 'Аватарки · настройки';
    els.back.style.display = home ? 'none' : '';
    b.append(...(home ? homeScreen() : editScreen()).filter(Boolean));
}

function homeScreen() {
    // Клик по шаблону НЕ перезаписывает настройки — он только открывает их.
    // Применить готовые значения шаблона — отдельной кнопкой на плитке.
    // Раньше повторный клик возвращал значения шаблона поверх сброса.
    const tiles = h('div.vte-av-tiles', {}, TEMPLATES.map(t => h('div.vte-av-tile', { title: t.hint }, [
        h('span.vte-av-tile-ic', {}, [icon(t.icon)]),
        h('span.vte-av-tile-name', { text: t.name }),
        h('span.vte-av-tile-hint', { text: t.hint }),
        h('span.vte-av-tile-btns', {}, [
            h('button.vte-btn.vte-btn-primary.vte-av-tile-apply', {
                type: 'button', title: 'Поставить готовые значения этого шаблона',
                on: { click: () => applyTemplate(t) },
            }, [h('span', { text: 'Применить шаблон' })]),
            h('button.vte-btn.vte-av-tile-open', {
                type: 'button', title: 'Открыть настройки как есть, ничего не меняя',
                on: { click: () => { state.screen = 'edit'; render(); } },
            }, [h('span', { text: 'Настройки' })]),
        ]),
    ])));
    return [
        themeSection(),
        h('small.vte-note', { text: 'Шаблон — это готовые значения. После него всё можно править на одной странице.' }),
        tiles,
        h('div.vte-tb-foot', {}, [
            h('button.vte-btn.vte-btn-primary', {
                type: 'button',
                on: { click: () => { state.screen = 'edit'; render(); } },
            }, [icon('fa-sliders'), h('span', { text: ' Открыть настройки' })]),
        ]),
        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', { type: 'button', on: { click: resetAll } },
                [icon('fa-rotate-left'), h('span', { text: ' Вернуть сообщения темы' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Вернуть тему к виду, какой был при открытии этого окна — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    ];
}

function applyTemplate(t) {
    Object.assign(state, { ...defaults(), ...t.set, on: true, screen: 'edit' });
    commit();
    render();
    say(`Шаблон «${t.name}» применён — дальше правьте под себя`);
}

function editScreen() {
    return [
        themeSection(),

        group('shape', 'Форма и размер', [
            // Во всю ширину текст сбоку не помещается — сразу ставим его под
            // аватарку (галочку в «Раскладке» можно снять)
            h('label.vte-tb-check', {}, [h('input', {
                type: 'checkbox', checked: !!state.full,
                on: {
                    change: (e) => {
                        state.full = e.target.checked;
                        state.on = true;
                        const moved = state.full && !state.below;
                        if (moved) state.below = true;
                        commit();   // одна запись — одна отмена
                        render();
                        if (moved) say('Текст перенесён под аватарку — выключить можно в «Раскладке»');
                    },
                },
            }), h('span', { text: 'Во всю ширину сообщения' })]),
            state.full ? null : pair('Ширина', 'wMin', 'wMax', 900, 'Первое значение — на узком экране, второе — на широком'),
            pair('Высота', 'hMin', 'hMax', 900),
            h('div.vte-av-shapes', {}, SHAPES.filter(s => s.path || s.radius || s.id === 'none').map(s => h(`button.vte-av-shape${state.shape === s.id ? '.active' : ''}`, {
                type: 'button', title: s.name,
                on: { click: () => { state.shape = s.id; state.on = true; commit(); render(); } },
            }, [s.path
                ? h('span.vte-av-shape-ic', { style: `-webkit-mask:${shapeUrl(s.path)} center/contain no-repeat;mask:${shapeUrl(s.path)} center/contain no-repeat` })
                : h('span.vte-av-shape-ic.vte-av-shape-plain', { style: s.radius ? `border-radius:${s.radius}` : 'opacity:.35' })]))),
            row('Своя форма', urlRow('maskUrl', 'ссылка на .png / .svg', (v) => { state.shape = v ? 'custom' : 'none'; commit(); render(); checkMask(v); })),
            h('textarea.vte-input.vte-av-svg', {
                spellcheck: false, rows: 2, placeholder: 'или код <svg>…</svg>',
                on: {
                    change: (e) => {
                        const svg = svgToDataUrl(e.target.value);
                        if (!svg) { say('Это не похоже на код SVG'); return; }
                        state.maskUrl = svg;
                        state.shape = 'custom';
                        state.on = true;
                        commit();
                        render();
                    },
                },
            }),
            h('div.vte-tb-foot', {}, [
                h('button.vte-btn', {
                    type: 'button', title: 'Картинка сохранится в самой таверне — маска работает всегда, с какого бы сайта ни была',
                    on: { click: () => pickMaskFile() },
                }, [icon('fa-upload'), h('span', { text: ' Загрузить с компьютера' })]),
            ]),
            els.maskNote = h('div.vte-note'),
        ]),

        group('pos', 'Положение аватарки', [
            row('По ширине', slider('posX', 0, 100, '%', 'слева'),
                'Считается от ширины сообщения: 0 — у левого края, 100 — вплотную к правому. На телефоне не уезжает'),
            row('Подвинуть вбок', slider('dx', -600, 600, 'px', 'нет'), 'Точная подгонка, можно и за край'),
            row('Подвинуть вверх-вниз', slider('dy', -600, 600, 'px', 'нет')),
            row('Обводка', slider('ring', 0, 12, 'px', 'нет')),
            row('Цвет обводки', colorBtn('ringColor', 'выбрать')),
        ]),

        group('back', 'Подложка позади', [
            check('backOn', 'Включить подложку'),
            state.backOn ? row('Картинка', urlRow('backImg', 'ссылка на картинку')) : null,
            state.backOn ? row('Цвет', colorBtn('backColor', 'нет')) : null,
            state.backOn ? row('Ширина', slider('backW', 0, 900, 'px', '140px')) : null,
            state.backOn ? row('Высота', slider('backH', 0, 900, 'px', '140px')) : null,
            state.backOn ? row('Сдвиг вбок', slider('backX', -600, 600, 'px', 'по центру')) : null,
            state.backOn ? row('Сдвиг вверх-вниз', slider('backY', -600, 600, 'px', 'по центру')) : null,
            state.backOn ? row('Скругление', slider('backRadius', 0, 50, '%', 'нет')) : null,
            state.backOn ? row('Непрозрачность', slider('backOpacity', 5, 100, '%', '100%')) : null,
            state.backOn ? check('backFront', 'Поверх аватарки') : null,
            state.backOn ? row('Обводка', slider('backRing', 0, 12, 'px', 'нет')) : null,
            state.backOn ? row('Цвет обводки', colorBtn('backRingColor', 'выбрать')) : null,
        ]),

        group('over', 'Слой поверх', [
            check('overOn', 'Включить слой поверх'),
            state.overOn ? row('Картинка', urlRow('overImg', 'рамка, уголок, блик')) : null,
            state.overOn ? row('Ширина', slider('overW', 0, 900, 'px', '140px')) : null,
            state.overOn ? row('Высота', slider('overH', 0, 900, 'px', '140px')) : null,
            state.overOn ? row('Сдвиг вбок', slider('overX', -600, 600, 'px', 'по центру')) : null,
            state.overOn ? row('Сдвиг вверх-вниз', slider('overY', -600, 600, 'px', 'по центру')) : null,
            state.overOn ? row('Поворот', slider('overRotate', -180, 180, '°', 'нет')) : null,
            state.overOn ? row('Непрозрачность', slider('overOpacity', 5, 100, '%', '100%')) : null,
        ]),

        group('banner', 'Шапка позади сообщения', [
            check('bannerOn', 'Включить шапку'),
            state.bannerOn ? row('Картинка', urlRow('bannerImg', 'широкая картинка')) : null,
            state.bannerOn ? pair('Высота шапки', 'bannerHMin', 'bannerHMax', 600) : null,
            state.bannerOn ? row('Масштаб картинки', slider('bannerScale', 50, 400, '%', '100%')) : null,
            state.bannerOn ? row('Сдвиг вбок', slider('bannerX', 0, 100, '%', '50%')) : null,
            state.bannerOn ? row('Сдвиг вверх-вниз', slider('bannerY', 0, 100, '%', '50%')) : null,
            state.bannerOn ? row('Скругление', slider('bannerRadius', 0, 60, 'px', 'нет')) : null,
            state.bannerOn ? row('Непрозрачность', slider('bannerOpacity', 5, 100, '%', '100%')) : null,
            state.bannerOn ? row('Растворение книзу', slider('bannerFade', 0, 90, '%', 'нет')) : null,
            state.bannerOn ? row('Размытие', slider('bannerBlur', 0, 20, 'px', 'нет'), 'Тяжёлый эффект') : null,
            state.bannerOn ? check('bannerClip', 'Не выходить за края сообщения') : null,
            state.bannerOn ? row('Обводка', slider('bannerRing', 0, 12, 'px', 'нет')) : null,
            state.bannerOn ? row('Цвет обводки', colorBtn('bannerRingColor', 'выбрать')) : null,
        ]),

        group('text', 'Раскладка', [
            check('below', 'Текст под аватаркой'),
            h('small.vte-note', { text: 'Ник, дата, бейджи, цвета текста и сам пузырь — в окне «Пузыри».' }),
        ]),

        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', { type: 'button', on: { click: resetAll } },
                [icon('fa-rotate-left'), h('span', { text: ' Вернуть сообщения темы' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Вернуть тему к виду, какой был при открытии этого окна — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    ];
}

const ANCHORS = [
    ['top-left', 'сверху слева'],
    ['top-right', 'сверху справа'],
    ['bottom-left', 'снизу слева'],
    ['bottom-right', 'снизу справа'],
];

/** Своя маска по ссылке: сразу говорим, возьмёт ли её браузер */
async function checkMask(url) {
    const note = els.maskNote;
    if (!note) return;
    if (!url) { note.textContent = ''; return; }
    if (/^data:/i.test(url)) { note.textContent = 'Встроенный SVG — работает всегда.'; return; }
    note.textContent = 'Проверяю ссылку…';
    try {
        const res = await fetch(url, { mode: 'cors' });
        note.textContent = res.ok
            ? '✓ Сайт разрешает брать картинку для маски — подойдёт.'
            : 'Сайт ответил ошибкой — маска не появится.';
    } catch {
        note.textContent = 'Этот сайт не разрешает брать картинку для маски (нужен CORS) — аватарка пропадёт. '
            + 'Как фон такая ссылка работает, а как форма — нет. Скачайте картинку и нажмите «Загрузить с компьютера».';
    }
}

/* ---------- своя форма с компьютера ----------
   Картинку уменьшаем (форме хватает 512px) и кладём в файлы самой
   SillyTavern: оттуда она грузится с того же адреса, что и таверна,
   поэтому разрешение CORS не нужно. Если сохранить не вышло — вписываем
   уменьшенную картинку прямо в тему (она станет чуть тяжелее). */
function pickMaskFile() {
    const input = h('input', { type: 'file', accept: 'image/png,image/webp,image/svg+xml,image/gif' });
    input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        const note = els.maskNote;
        try {
            if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
                const url = svgToDataUrl(await file.text());
                if (!url) throw new Error('svg');
                useMask(url, 'SVG вписан в тему — работает всегда.');
                return;
            }
            if (note) note.textContent = 'Готовлю картинку…';
            const b64 = await shrinkImage(file, 512);
            const name = `vte-mask-${Date.now().toString(36)}.png`;
            const path = await uploadToTavern(name, b64);
            if (path) useMask(path, '✓ Картинка сохранена в таверне — маска работает.');
            else useMask(`data:image/png;base64,${b64}`,
                `Сохранить в таверну не получилось — картинка вписана прямо в тему (${Math.round(b64.length * 0.75 / 1024)} КБ).`);
        } catch {
            say('Не получилось прочитать картинку');
            if (note) note.textContent = '';
        }
    });
    input.click();
}

function useMask(url, text) {
    state.maskUrl = url;
    state.shape = 'custom';
    state.on = true;
    commit();
    render();
    if (els.maskNote) els.maskNote.textContent = text;
}

/** Уменьшить до max по большей стороне, вернуть PNG в base64 (прозрачность сохраняется) */
function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.naturalWidth * k));
            c.height = Math.max(1, Math.round(img.naturalHeight * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
        img.src = url;
    });
}

/** Сохранить файл в user/files самой SillyTavern. Вернёт путь или '' */
async function uploadToTavern(name, b64) {
    try {
        const ctx = window.SillyTavern?.getContext?.();
        const headers = ctx?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
        const res = await fetch('/api/files/upload', {
            method: 'POST', headers, body: JSON.stringify({ name, data: b64 }),
        });
        if (!res.ok) return '';
        const { path } = await res.json();
        return path ? String(path).replace(/\\/g, '/') : '';
    } catch { return ''; }
}

/** SVG-код → компактная data-ссылка. Скрипты и лишнее вырезаем */
function svgToDataUrl(code) {
    let svg = String(code || '').trim();
    const start = svg.search(/<svg[\s>]/i);
    if (start === -1) return '';
    svg = svg.slice(start)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|metadata|title|desc)[\s\S]*?<\/\1>/gi, '')
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .trim();
    if (!/<\/svg>\s*$/i.test(svg)) return '';
    if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    const enc = svg.replace(/"/g, "'").replace(/[%#<>{}\n\r;]/g, (c) => encodeURIComponent(c));
    return `data:image/svg+xml,${enc}`;
}

/** «Уже в теме» — правила темы про сообщения */
let themeOpen = false;

function themeSection() {
    const list = onThemeRules?.(['.mes', '.mes .mesAvatarWrapper', '.mes .avatar', '.mes .mes_block', '.mes .mes_text']) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'правило' : 'правил'} про сообщения` })]));
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
    // Остаёмся на том же экране: сброс — это не «выход в меню»
    const screen = state.screen;
    state = { ...defaults(), screen };
    commit();
    render();
    say('Сообщения снова как в теме — все ползунки на нуле');
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
