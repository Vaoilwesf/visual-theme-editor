// modules/bottomBar.js
// «Нижняя панель ♡»: панель ввода SillyTavern — фон, рамка, форма, размеры,
// поле ввода, своя надпись-подсказка, кнопки и их значки.
//
// Разметка ST: #form_sheld > #send_form > #nonQRFormItems >
//   #leftSendForm (#options_button, #extensionsMenuButton — добавляется скриптом)
//   #send_textarea
//   #rightSendForm (#mes_stop, #mes_impersonate, #mes_continue, #send_but, кнопки STscript)
//
// Важное из ST:
//  - кнопки «Отправить», «Продолжить», «Имперсонация», «Стоп» и палочку
//    расширений ST показывает и прячет встроенными стилями — display у них
//    не трогаем никогда;
//  - размер кнопок — переменные --bottomFormIconSize и --bottomFormBlockSize,
//    вторая считается от первой на :root: меняем обе на самой панели;
//  - прогресс генерации в поле ввода — верхняя рамка и фон, которые ST
//    ставит скриптом: обводку поля рисуем контуром внутрь (outline), а свою
//    надпись во время генерации убираем, чтобы не закрыть прогресс;
//  - текст подсказки лежит в атрибуте placeholder и ST его переписывает
//    («Not connected…» / «Type a message…») — CSS его не заменит. Поэтому,
//    как в теме Rusreal: настоящая подсказка прозрачная, а в пустом поле
//    рисуется картинка-надпись (SVG). Работает везде, и на телефоне.

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

/* Общие помощники из «Пузырей» ждут этих имён: здесь всё без бота/пользователя */
const GROUP_OF = {};
const roleDefaults = () => ({});
const val = (key) => state[key];
function setVal(key, v) { state[key] = v; state.on = true; }

/* ============================================================
   СЕЛЕКТОРЫ
============================================================ */
const SEL = {
    form: '#send_form',
    items: '#nonQRFormItems',
    sides: ':is(#leftSendForm, #rightSendForm)',
    btn: ':is(#leftSendForm, #rightSendForm) > div',
    btnHover: ':is(#leftSendForm, #rightSendForm) > div:hover',
    ta: '#send_textarea',
    ph: '#send_textarea::placeholder',
};
/* Кнопки расширений — всё в колонках кнопок, кроме кнопок самой ST.
   Проверка id у каждого ребёнка колонки — дешёвая */
const ST_KIDS = '#options_button, #extensionsMenuButton, #mes_impersonate, #mes_continue, #send_but, #mes_stop, #stscript_continue, #stscript_pause, #stscript_stop, #file_form';
const EXT = `:is(#leftSendForm, #rightSendForm) > :not(${ST_KIDS})`;
// Значок внутри кнопки расширения: <i>, картинка, svg или что-то с классом fa-…
const EXT_IC = `${EXT} :is(i, svg, img, [class*="fa-"])`;
const EXT_IMG = `${EXT} :is(svg, img)`;   // картинки — ровно в размер значка
/* Условие, при котором ST сама сужает боковые колонки (mobile-styles.css) */
const NARROW = '@media screen and (max-width: 450px)';
const COND_SEP = '\u0001';
const ck = (cond, sel) => (cond ? `${cond}${COND_SEP}${sel}` : sel);
function splitCond(key) {
    const i = key.indexOf(COND_SEP);
    return i === -1 ? { cond: '', sel: key } : { cond: key.slice(0, i), sel: key.slice(i + 1) };
}

/* Своя надпись: только в пустом поле и не во время генерации (иначе закроет прогресс) */
const phSel = (focus) => `body:not([data-generating="true"]) #send_textarea:placeholder-shown${focus ? '' : ':not(:focus)'}`;
const phHide = (focus) => `body:not([data-generating="true"]) #send_textarea${focus ? '' : ':not(:focus)'}::placeholder`;

/* Значки кнопок. У «Стоп» значок — вложенный <i> */
const GLYPHS = [
    ['options_button', 'Меню (≡)', '#options_button::before'],
    ['extensionsMenuButton', 'Расширения (палочка)', '#extensionsMenuButton::before'],
    ['mes_impersonate', 'Написать за меня', '#mes_impersonate::before'],
    ['mes_continue', 'Продолжить', '#mes_continue::before'],
    ['send_but', 'Отправить', '#send_but::before'],
    ['mes_stop', 'Остановить генерацию', '#mes_stop > i::before'],
];

/* Кнопки расширений в панели. Известные — всегда в списке (значок у них во
   вложенном <i>), остальные находятся сами: всё, что расширения добавили
   в колонки кнопок, кроме кнопок самой ST */
const EXT_KNOWN = [
    ['sw-bar-btn', 'Гардероб', '#sw-bar-btn i::before'],
];
const ST_IDS = new Set(['options_button', 'extensionsMenuButton', 'mes_impersonate', 'mes_continue', 'send_but', 'mes_stop',
    'stscript_continue', 'stscript_pause', 'stscript_stop', 'send_textarea', 'leftSendForm', 'rightSendForm', 'file_form']);

/** Кнопки расширений, которые сейчас есть в панели: [id, подпись, селектор значка] */
function detectExt() {
    const out = [];
    try {
        for (const el of document.querySelectorAll('#send_form :is(#leftSendForm, #rightSendForm, #nonQRFormItems) > [id]')) {
            if (ST_IDS.has(el.id) || EXT_KNOWN.some(e => e[0] === el.id)) continue;
            const inner = !/\bfa-/.test(el.className) && el.querySelector('i[class*="fa-"]');
            if (!/\bfa-/.test(el.className) && !inner) continue;
            const label = (el.getAttribute('title') || el.id).slice(0, 40);
            out.push([el.id, label, `#${el.id}${inner ? ' i' : ''}::before`]);
        }
    } catch {}
    return out;
}

/** Все значки окна: кнопки ST, известные и найденные расширения, и те, что уже записаны */
function glyphList(s) {
    const map = new Map();
    for (const g of [...GLYPHS, ...EXT_KNOWN, ...detectExt()]) if (!map.has(g[0])) map.set(g[0], g);
    for (const [id, sel] of Object.entries(s?.glyphSel || {})) if (!map.has(id)) map.set(id, [id, id, sel]);
    return [...map.values()];
}
const glyphSelOf = (cls) => glyphList(state).find(g => g[0] === cls)?.[2];
const isExt = (cls) => !GLYPHS.some(g => g[0] === cls);

/* ============================================================
   СОСТОЯНИЕ
============================================================ */
function defaults() {
    return {
        on: false,
        // панель
        bg: '', bgImg: '', bgFit: 'cover', noBlur: false,
        bw: 0, bc: '', rTop: 0, rBot: 10,         // скругление как в ST: сверху 0, снизу 10
        widthPct: 0, liftMin: 0, liftMax: 0, pad: 0,
        // кнопки
        iconMin: 0, iconMax: 0, blockPad: 0,
        bColor: '', bOp: 0, bHover: 0, bBg: '', bShape: '', bRing: 0, bRingColor: '', bGap: 0, bNoGlow: false,
        glyphs: {},
        glyphSel: {},
        extFit: false, extScale: 0,   // подогнать кнопки расширений под кнопки ST      // id → селектор значка для кнопок расширений, найденных в теме
        // поле ввода
        taColor: '', taMin: 0, taMax: 0, taBg: '', taRadius: 0, taRing: 0, taRingColor: '',
        // своя надпись
        phText: '', phColor: '', phFont: 'serif', phItalic: true, phBold: false, phAlign: 'center',
        phMin: 0, phMax: 0, phFocus: false,
    };
}

const strip0 = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();

/* ---------- надпись-картинка ----------
   Внутри SVG единицы условные: шрифт 20, высота 40. Длина с запасом —
   лишнее обрезает само поле. Размер на экране задаёт background-size по
   высоте (телефон → ПК), ширина подстраивается сама — буквы не искажаются.
   Шрифты страницы картинке недоступны — только системные. */
const PH_FONTS = {
    serif: "Georgia, 'Times New Roman', serif",
    sans: "'Segoe UI', Roboto, Arial, sans-serif",
    cursive: "'Segoe Script', 'Comic Sans MS', cursive",
    mono: "Consolas, 'Courier New', monospace",
};

function phSvg(s) {
    const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const W = 4000, H = 40;
    const x = s.phAlign === 'left' ? 0 : s.phAlign === 'right' ? W : W / 2;
    const anchor = s.phAlign === 'left' ? 'start' : s.phAlign === 'right' ? 'end' : 'middle';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
        + `<text x="${x}" y="${H / 2}" fill="${esc(s.phColor || 'rgba(200,200,200,0.55)')}" font-family="${esc(PH_FONTS[s.phFont] || PH_FONTS.serif)}"`
        + ` font-size="20"${s.phItalic ? ' font-style="italic"' : ''}${s.phBold ? ' font-weight="bold"' : ''}`
        + ` text-anchor="${anchor}" dominant-baseline="middle">${esc(s.phText)}</text></svg>`;
    // Скобки и кавычки тоже кодируем: иначе rgba(…) в цвете оборвёт url(…)
    const enc = encodeURIComponent(svg).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `url("data:image/svg+xml,${enc}")`;
}

function readPh(url) {
    const m = String(url).match(/data:image\/svg\+xml,([^"]*)/);
    if (!m) return null;
    let svg = '';
    try { svg = decodeURIComponent(m[1]); } catch { return null; }
    const unesc = (t) => String(t).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const attr = (n) => unesc((svg.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] || '');
    const fam = attr('font-family');
    return {
        phText: unesc((svg.match(/<text[^>]*>([\s\S]*)<\/text>/) || [])[1] || ''),
        phColor: attr('fill'),
        phFont: Object.keys(PH_FONTS).find(k => PH_FONTS[k] === fam) || 'serif',
        phItalic: /font-style="italic"/.test(svg),
        phBold: /font-weight="bold"/.test(svg),
        phAlign: { start: 'left', end: 'right' }[attr('text-anchor')] || 'center',
    };
}

/* ============================================================
   ЧТЕНИЕ
============================================================ */
function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip0(rules.get(sel)?.get(prop));
    const urlIn = (v) => { const m = String(v).match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/); return m ? (m[1] ?? m[2] ?? m[3]) : ''; };

    // панель
    s.bg = get(SEL.form, 'background-color');
    s.bgImg = urlIn(get(SEL.form, 'background-image'));
    s.bgFit = get(SEL.form, 'background-size') === 'contain' ? 'contain' : 'cover';
    s.noBlur = get(SEL.form, 'backdrop-filter') === 'none';
    const bd = get(SEL.form, 'border').match(/^(\d+)px\s+solid\s+(.+)$/);
    if (bd) { s.bw = +bd[1]; s.bc = bd[2] === 'currentColor' ? '' : bd[2]; }
    const rr = get(SEL.form, 'border-radius').match(/^(\d+)px \1px (\d+)px \2px$/);
    if (rr) { s.rTop = +rr[1]; s.rBot = +rr[2]; }
    s.widthPct = num((get(SEL.form, 'width').match(/^(\d+)%$/) || [])[1]);
    const lf = readFluid(get(SEL.form, 'margin-bottom')); s.liftMin = lf.min; s.liftMax = lf.max;
    s.pad = num(get(SEL.form, 'padding'));

    // кнопки
    const ic = readFluid(get(SEL.form, '--bottomFormIconSize')); s.iconMin = ic.min; s.iconMax = ic.max;
    s.blockPad = num(get(SEL.form, '--bottomFormBlockPadding'));
    s.bColor = get(SEL.btn, 'color');
    s.bOp = Math.round((parseFloat(get(SEL.btn, 'opacity')) || 0) * 100);
    s.bHover = Math.round((parseFloat(get(SEL.btnHover, 'opacity')) || 0) * 100);
    s.bBg = get(SEL.btn, 'background-color');
    s.bShape = { '0': 'square', '8px': 'rounded', '50%': 'circle' }[get(SEL.btn, 'border-radius')] || '';
    const bo = get(SEL.btn, 'outline').match(/^(\d+)px\s+solid\s+(.+)$/);
    if (bo) { s.bRing = +bo[1]; s.bRingColor = bo[2] === 'currentColor' ? '' : bo[2]; }
    s.bGap = num(get(SEL.sides, 'column-gap'));
    s.bNoGlow = get(SEL.btnHover, 'filter') === 'none';
    // Значки расширений, записанные раньше: #id::before или #id i::before —
    // берём только те, что живут в панели (у «Топ-бара» свои #…::before)
    for (const key of rules.keys()) {
        const m = key.match(/^#([\w-]+)( i)?::before$/);
        if (!m || GLYPHS.some(g => g[0] === m[1])) continue;
        const known = EXT_KNOWN.some(e => e[0] === m[1]);
        let inBar = false;
        try { inBar = !!document.querySelector(`#send_form #${CSS.escape(m[1])}`); } catch {}
        if (known || inBar) s.glyphSel[m[1]] = key;
    }
    for (const [cls, , sel] of glyphList(s)) {
        const img = urlIn(get(sel, 'background'));
        if (img) { s.glyphs[cls] = { img }; continue; }
        const c = get(sel, 'content').match(/^["']\\([0-9a-f]{2,5})["']$/i);
        if (c) s.glyphs[cls] = { code: c[1].toLowerCase(), brand: /Brands/i.test(get(sel, 'font-family')) };
    }

    s.extFit = get(EXT, 'width') === 'var(--bottomFormBlockSize)';
    const es = get(EXT, 'font-size').match(/^calc\(var\(--bottomFormIconSize\) \* ([\d.]+)\)$/);
    s.extScale = es ? Math.round(+es[1] * 100) : 0;

    // поле ввода
    s.taColor = get(SEL.ta, 'color');
    const tf = readFluid(get(SEL.ta, 'font-size')); s.taMin = tf.min; s.taMax = tf.max;
    s.taBg = get(SEL.ta, 'background-color');
    s.taRadius = num(get(SEL.ta, 'border-radius'));
    const to = get(SEL.ta, 'outline').match(/^(\d+)px\s+solid\s+(.+)$/);
    if (to) { s.taRing = +to[1]; s.taRingColor = to[2] === 'currentColor' ? '' : to[2]; }

    // надпись
    for (const focus of [false, true]) {
        const ph = readPh(get(phSel(focus), 'background-image'));
        if (!ph) continue;
        Object.assign(s, ph);
        s.phFocus = focus;
        const hh = readFluid(String(get(phSel(focus), 'background-size')).replace(/^auto\s+/, ''));
        s.phMin = Math.round(hh.min / 2); s.phMax = Math.round(hh.max / 2);
    }

    s.on = [...rules.keys()].some(k => /send_form|send_textarea|SendForm|nonQRFormItems|options_button|extensionsMenuButton|mes_impersonate|mes_continue|send_but|mes_stop/.test(k) && rules.get(k)?.size);
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
function buildRules(s) {
    const rules = {};
    const put = (sel, prop, v) => { (rules[sel] ||= {})[prop] = v; };
    const on = s.on;
    const px = (v) => (on && v ? `${v}px` : '');

    /* ---------- панель ---------- */
    put(SEL.form, 'background-color', on ? s.bg : '');
    put(SEL.form, 'background-image', on && s.bgImg ? `url("${String(s.bgImg).replace(/["\\\n\r]/g, encodeURIComponent)}")` : '');
    put(SEL.form, 'background-size', on && s.bgImg ? s.bgFit : '');
    put(SEL.form, 'background-position', on && s.bgImg ? 'center' : '');
    put(SEL.form, 'background-repeat', on && s.bgImg ? 'no-repeat' : '');
    // Размытие под панелью пересчитывается на каждом кадре прокрутки
    put(SEL.form, 'backdrop-filter', on && s.noBlur ? 'none' : '');
    put(SEL.form, '-webkit-backdrop-filter', on && s.noBlur ? 'none' : '');
    put(SEL.form, 'border', on && s.bw ? `${s.bw}px solid ${s.bc || 'currentColor'}` : '');
    const rDiff = on && (s.rTop !== 0 || s.rBot !== 10);
    put(SEL.form, 'border-radius', rDiff ? `${s.rTop}px ${s.rTop}px ${s.rBot}px ${s.rBot}px` : '');
    put(SEL.form, 'width', on && s.widthPct ? `${s.widthPct}%` : '');
    put(SEL.form, 'margin-bottom', on ? fluid(s.liftMin, s.liftMax) : '');
    put(SEL.form, 'padding', px(s.pad));
    put(SEL.form, 'box-sizing', on && (s.pad || s.bw) ? 'border-box' : '');

    /* ---------- размер кнопок ----------
       --bottomFormBlockSize на :root уже посчитан от :root-значения значка,
       поэтому, меняя значок, пересчитываем и её прямо на панели */
    const icon = on ? fluid(s.iconMin, s.iconMax) : '';
    const sized = !!(icon || (on && s.blockPad));
    put(SEL.form, '--bottomFormIconSize', icon);
    put(SEL.form, '--bottomFormBlockPadding', px(s.blockPad));
    put(SEL.form, '--bottomFormBlockSize', sized ? 'calc(var(--bottomFormIconSize) + var(--bottomFormBlockPadding))' : '');

    /* ---------- кнопки (display не трогаем — им управляет ST) ---------- */
    put(SEL.btn, 'color', on ? s.bColor : '');
    put(SEL.btn, 'opacity', on && s.bOp ? String(r2(s.bOp / 100)) : '');
    put(SEL.btnHover, 'opacity', on && s.bHover ? String(r2(s.bHover / 100)) : '');
    put(SEL.btnHover, 'filter', on && s.bNoGlow ? 'none' : '');
    put(SEL.btn, 'background-color', on ? s.bBg : '');
    put(SEL.btn, 'border-radius', on && s.bShape ? { square: '0', rounded: '8px', circle: '50%' }[s.bShape] : '');
    // Обводка — контуром внутрь: размер кнопки не меняется
    put(SEL.btn, 'outline', on && s.bRing ? `${s.bRing}px solid ${s.bRingColor || 'currentColor'}` : '');
    put(SEL.btn, 'outline-offset', on && s.bRing ? `-${s.bRing}px` : '');
    /* На телефоне ST сужает боковые колонки до 1.15em — кнопки там сжаты по
       ширине. Без фона этого не видно, а с фоном и формой вышли бы овалы.
       Когда у кнопок есть видимая форма — колонка по кнопке, кнопка ровная */
    const shaped = on && !!(s.bBg || s.bShape || s.bRing);
    // Там же, где ST сужает колонку, — ширина по самой широкой кнопке:
    // кнопки остаются стопкой, как в ST, но не сжимаются
    put(ck(NARROW, SEL.sides), 'width', shaped ? 'min-content' : '');
    put(SEL.btn, 'flex-shrink', shaped ? '0' : '');
    put(SEL.sides, 'column-gap', px(s.bGap));
    put(SEL.sides, 'row-gap', px(s.bGap));
    put(SEL.items, 'column-gap', px(s.bGap));

    for (const [cls, , sel] of glyphList(s)) {
        const g = on ? s.glyphs?.[cls] : null;
        const fa = g && g.code ? g : null;
        const img = g && g.img ? g.img : '';
        put(sel, 'content', fa ? `"\\${fa.code}"` : img ? '""' : '');
        put(sel, 'font-family', fa?.brand ? '"Font Awesome 6 Brands"' : '');
        put(sel, 'font-weight', fa ? (fa.brand ? '400' : '900') : '');
        put(sel, 'background', img ? `url("${String(img).replace(/["\\\n\r]/g, encodeURIComponent)}") center / contain no-repeat` : '');
        put(sel, 'display', img ? 'inline-block' : '');
        put(sel, 'width', img ? '1em' : '');
        put(sel, 'height', img ? '1em' : '');
    }

    /* ---------- кнопки расширений: как у ST ----------
       Расширения делают кнопки по-разному: <button> с отступами,
       <span> без размера, значок во вложенном <i> со своим размером.
       Даём им тот же квадрат, что у кнопок ST, и ставим по центру колонки.
       display не трогаем: кнопки расширений прячут себя сами */
    const fit = on && s.extFit;
    put(EXT, 'width', fit ? 'var(--bottomFormBlockSize)' : '');
    put(EXT, 'height', fit ? 'var(--bottomFormBlockSize)' : '');
    put(EXT, 'min-width', fit ? '0' : '');
    put(EXT, 'min-height', fit ? '0' : '');
    put(EXT, 'margin', fit ? '0' : '');
    put(EXT, 'padding', fit ? '0' : '');
    put(EXT, 'box-sizing', fit ? 'border-box' : '');
    put(EXT, 'align-self', fit ? 'center' : '');
    put(EXT, 'align-items', fit ? 'center' : '');
    put(EXT, 'justify-content', fit ? 'center' : '');
    put(EXT, 'text-align', fit ? 'center' : '');
    put(EXT, 'line-height', fit ? 'var(--bottomFormBlockSize)' : '');
    put(EXT, 'vertical-align', fit ? 'middle' : '');
    put(EXT, 'font-size', fit ? (s.extScale && s.extScale !== 100 ? `calc(var(--bottomFormIconSize) * ${r2(s.extScale / 100)})` : 'var(--bottomFormIconSize)') : '');
    // Значок внутри — размером с кнопку ST, без своих отступов
    put(EXT_IC, 'font-size', fit ? '1em' : '');
    put(EXT_IC, 'line-height', fit ? '1' : '');
    put(EXT_IC, 'margin', fit ? '0' : '');
    put(EXT_IC, 'vertical-align', fit ? 'middle' : '');
    put(EXT_IC, 'max-width', fit ? '1em' : '');
    put(EXT_IC, 'max-height', fit ? '1em' : '');
    put(EXT_IMG, 'width', fit ? '1em' : '');
    put(EXT_IMG, 'height', fit ? '1em' : '');
    put(EXT_IMG, 'object-fit', fit ? 'contain' : '');

    /* ---------- поле ввода ---------- */
    put(SEL.ta, 'color', on ? s.taColor : '');
    put(SEL.ta, 'font-size', on ? fluid(s.taMin, s.taMax) : '');
    put(SEL.ta, 'background-color', on ? s.taBg : '');
    put(SEL.ta, 'border-radius', px(s.taRadius));
    put(SEL.ta, 'outline', on && s.taRing ? `${s.taRing}px solid ${s.taRingColor || 'currentColor'}` : '');
    put(SEL.ta, 'outline-offset', on && s.taRing ? `-${s.taRing}px` : '');
    // Бывшие настройки (отступы и цвет курсора) — только стереть, если остались
    put(SEL.ta, 'padding-left', '');
    put(SEL.ta, 'padding-right', '');
    put(SEL.ta, 'caret-color', '');

    /* ---------- своя надпись ---------- */
    const ph = on && String(s.phText || '').trim();
    for (const focus of [false, true]) {
        /* Своя надпись — только пока поле не в фокусе. Родную подсказку ST
           прячем всегда (и в фокусе): раньше при нажатии в поле она
           возвращалась, и казалось, что надпись «сбросилась» */
        const act = ph && !focus;
        const sel = phSel(focus);
        put(phHide(focus), 'opacity', ph && focus ? '0' : '');
        put(sel, 'background-image', act ? phSvg(s) : '');
        put(sel, 'background-repeat', act ? 'no-repeat' : '');
        put(sel, 'background-position', act ? ({ left: 'left 8px center', right: 'right 8px center' }[s.phAlign] || 'center') : '');
        // Высота картинки = 2 × размер букв (внутри SVG строка 40 при шрифте 20)
        const sz = fluid((s.phMin || 15) * 2, (s.phMax || s.phMin || 15) * 2);
        put(sel, 'background-size', act ? `auto ${sz}` : '');
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
    for (const [key, decls] of Object.entries(buildRules(state))) {
        const body = Object.entries(decls).filter(([, v]) => v).map(([p, v]) => `${p}:${v} !important`).join(';');
        if (!body) continue;
        const { cond, sel } = splitCond(key);
        css += cond ? `${cond}{${sel}{${body}}}\n` : `${sel}{${body}}\n`;
    }
    if (!previewStyle) {
        previewStyle = document.createElement('style');
        previewStyle.id = 'vte-bottom-preview';
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
    state = readState();
    if (!panel) build();
    panel.style.display = 'flex';
    render();
}

export function refresh() {
    if (!isOpen()) return;
    const scroll = els.body?.scrollTop || 0;
    state = readState();
    render();
    if (els.body) els.body.scrollTop = scroll;
}

/** Своя надпись из вкладки «Текст» редактора: для поля сообщения — сюда,
    иначе было бы два разных способа на одно поле */
export async function setPlaceholder(text) {
    onSnapshot?.();
    state = readState();
    state.phText = String(text || '');
    state.on = true;
    await commit();
    if (isOpen()) render();
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
        h('div.vte-title', {}, [h('span.vte-title-ic', {}, [icon('fa-keyboard')]), h('span', { text: 'Нижняя панель' })]),
        h('div.vte-header-btns', {}, [iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close')]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-bottom-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-bottom-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

const open = { panel: true, buttons: false, glyphs: false, ext: false, input: false, ph: false };

function urlField(key, placeholder) {
    return h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false, placeholder, value: state[key] || '',
        on: {
            change: (e) => {
                const v = e.target.value.trim();
                if (v && !/^https?:\/\/[^\s"'()<>\\]+$/i.test(v) && !/^data:image\//i.test(v)) {
                    say('Нужна ссылка http(s)://');
                    e.target.value = state[key] || '';
                    return;
                }
                setVal(key, v);
                commit();
                render();
            },
        },
    });
}

function phTextField() {
    let t = 0;
    return h('input.vte-input', {
        type: 'text', spellcheck: false, placeholder: 'например: перемен…', value: state.phText || '',
        on: {
            input: (e) => { setVal('phText', e.target.value); preview(); clearTimeout(t); t = setTimeout(() => commit(), 600); },
            change: () => { clearTimeout(t); commit(); render(); },
        },
    });
}

/* Перерисовка окна не сбрасывает прокрутку: раньше после любой
   настройки окно уезжало в самый верх */
function render() {
    const b = els.body;
    const top = b ? b.scrollTop : 0;
    renderInner();
    if (b && top) {
        b.scrollTop = top;
        // содержимое могло дорисоваться позже (картинки, шрифты)
        requestAnimationFrame(() => { if (b.scrollTop < top) b.scrollTop = top; });
    }
}

function renderInner() {
    els.body.textContent = '';
    els.body.append(...screen().filter(Boolean));
}

function glyphPreview(cls) {
    const g = state.glyphs[cls];
    if (g?.img) return h('i.vte-bb-glyph-now', { style: `background:url("${g.img}") center/contain no-repeat;width:16px;height:16px` });
    if (g?.code) {
        const el = h(`i.vte-bb-glyph-now.${g.brand ? 'fa-brands' : 'fa-solid'}`);
        el.textContent = String.fromCodePoint(parseInt(g.code, 16));
        return el;
    }
    const sel = glyphSelOf(cls) || '';
    const live = document.querySelector(cls === 'mes_stop' ? '#mes_stop > i' : sel.includes(' i::before') ? `#${cls} i` : `#${cls}`);
    const el = h('i.vte-bb-glyph-now');
    if (live) {
        const cs = getComputedStyle(live, '::before');
        el.textContent = cs.content && cs.content !== 'none' ? cs.content.replace(/^["']|["']$/g, '') : '';
        el.style.fontFamily = cs.fontFamily;
        el.style.fontWeight = cs.fontWeight;
    }
    return el;
}

function extRows() {
    const list = glyphList(state).filter(([cls]) => isExt(cls));
    return [
        h('small.vte-note', { text: 'Кнопки, которые добавили в панель расширения. Новые находятся сами, когда расширение включено.' }),
        check('extFit', 'Подогнать под остальные кнопки', 'Тот же размер кнопки и значка, что у кнопок SillyTavern, и ровно по центру'),
        state.extFit ? row('Размер значков', slider('extScale', 50, 150, '%', 'как у остальных'), 'Если значок расширения всё равно кажется мельче или крупнее') : null,
        ...list.map(([cls, label]) => {
            const here = !!document.getElementById(cls);
            return glyphRow(cls, here ? label : `${label} (сейчас нет в панели)`);
        }),
    ];
}

function glyphRow(cls, label) {
    return h('div.vte-bb-glyph-row', {}, [
        glyphPreview(cls),
        h('span.vte-bb-glyph-label', { text: label }),
        h('button.vte-btn.vte-bb-glyph-btn', { type: 'button', on: { click: () => openGlyphPicker(cls, label) } }, [h('span', { text: 'Сменить' })]),
        state.glyphs[cls] ? iconBtn('fa-rotate-left', 'Вернуть значок темы', () => {
            delete state.glyphs[cls];
            state.on = true;
            commit();
            render();
        }, 'vte-tb-mini') : null,
    ]);
}

function screen() {
    const ph = !!String(state.phText || '').trim();
    return [
        themeSection(),

        group('panel', 'Панель', [
            row('Фон', colorBtn('bg', 'как в теме')),
            row('Картинка фона', urlField('bgImg', 'https://… ссылка на картинку')),
            state.bgImg ? row('Как вписать', select('bgFit', [['cover', 'заполнить'], ['contain', 'целиком']])) : null,
            check('noBlur', 'Без размытия под панелью (легче)', 'Размытие пересчитывается при каждой прокрутке чата'),
            row('Обводка', slider('bw', 0, 6, 'px', 'как в теме')),
            state.bw ? row('Цвет обводки', colorBtn('bc', 'цвет текста')) : null,
            row('Скругление сверху', slider('rTop', 0, 40, 'px', 'нет')),
            row('Скругление снизу', slider('rBot', 0, 40, 'px', 'нет')),
            row('Ширина', slider('widthPct', 0, 100, '%', 'во всю ширину чата'), 'Доля ширины чата — на любом экране одна'),
            pair('Приподнять над низом', 'liftMin', 'liftMax', 60, 'Первое — на телефоне, второе — на ПК'),
            row('Внутренний отступ', slider('pad', 0, 24, 'px', 'как в теме')),
        ]),

        group('buttons', 'Кнопки', [
            h('small.vte-note', { text: 'Меню, палочка расширений, «Написать за меня», «Продолжить», «Отправить», «Стоп». '
                + 'Когда какие видны — решает SillyTavern, окно меняет только вид.' }),
            pair('Размер значков', 'iconMin', 'iconMax', 48, 'Первое — на телефоне, второе — на ПК'),
            row('Поле вокруг значка', slider('blockPad', 0, 30, 'px', 'как в теме'), 'Кнопка = значок + это поле'),
            row('Цвет значков', colorBtn('bColor', 'как в теме')),
            row('Видимость', slider('bOp', 0, 100, '%', 'как в теме (70%)')),
            row('При наведении', slider('bHover', 0, 100, '%', 'как в теме (100%)')),
            check('bNoGlow', 'Без подсветки при наведении'),
            row('Фон кнопок', colorBtn('bBg', 'нет')),
            row('Форма', select('bShape', [['', 'как в теме'], ['square', 'квадратные'], ['rounded', 'скруглённые'], ['circle', 'круглые']])),
            row('Обводка', slider('bRing', 0, 6, 'px', 'нет')),
            state.bRing ? row('Цвет обводки', colorBtn('bRingColor', 'цвет значка')) : null,
            row('Между кнопками', slider('bGap', 0, 24, 'px', 'как в теме')),
        ]),

        group('glyphs', 'Значки кнопок', [
            h('small.vte-note', { text: 'Font Awesome или своя картинка ссылкой / кодом SVG.' }),
            ...GLYPHS.map(([cls, label]) => glyphRow(cls, label)),
        ]),

        group('ext', 'Значки расширений', extRows()),

        group('input', 'Поле ввода', [
            row('Цвет текста', colorBtn('taColor', 'как в теме')),
            pair('Размер текста', 'taMin', 'taMax', 32, 'Первое — на телефоне, второе — на ПК'),
            row('Фон поля', colorBtn('taBg', 'как в теме')),
            row('Скругление', slider('taRadius', 0, 30, 'px', 'нет')),
            row('Обводка', slider('taRing', 0, 6, 'px', 'нет'), 'Рисуется внутрь — полоса прогресса генерации не ломается'),
            state.taRing ? row('Цвет обводки', colorBtn('taRingColor', 'цвет текста')) : null,
        ]),

        group('ph', 'Своя надпись в пустом поле', [
            row('Текст', phTextField()),
            ph ? row('Цвет', colorBtn('phColor', 'серый')) : null,
            ph ? pair('Размер букв', 'phMin', 'phMax', 40, 'Первое — на телефоне, второе — на ПК') : null,
            ph ? row('Шрифт', select('phFont', [['serif', 'с засечками'], ['sans', 'без засечек'], ['cursive', 'рукописный'], ['mono', 'моноширинный']])) : null,
            ph ? h('small.vte-note', { text: 'Надпись — картинка, шрифты темы ей недоступны: только системные, похожие по стилю.' }) : null,
            ph ? check('phItalic', 'Курсив') : null,
            ph ? check('phBold', 'Жирный') : null,
            ph ? row('Где', select('phAlign', [['center', 'по центру'], ['left', 'слева'], ['right', 'справа']])) : null,
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

let themeOpen = false;
function themeSection() {
    const list = onThemeRules?.(['#send_form', '#nonQRFormItems', '#send_textarea', '#options_button', '#send_but', '#leftSendForm', '#rightSendForm']) || [];
    if (!list.length) return null;
    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'правило' : 'правил'} про нижнюю панель` })]));
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
    state = { ...defaults() };
    commit();
    render();
    say('Нижняя панель снова как в теме');
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
    const LINK_KEY = `vte-bp-link-${aKey}`;
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

function group(id, title, children) {
    const list = children.filter(Boolean);
    const head = h(`button.vte-av-group-head${open[id] ? '.open' : ''}`, {
        type: 'button',
        on: { click: () => { open[id] = !open[id]; render(); } },
    }, [icon(open[id] ? 'fa-chevron-down' : 'fa-chevron-right'), h('span', { text: title })]);
    return h('div.vte-av-group', {}, [head, open[id] ? h('div.vte-av-group-body', {}, list) : null]);
}

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
        // Кнопку расширения запоминаем по селектору — даже если её потом не будет в панели
        if (isExt(cls)) state.glyphSel[cls] = glyphSelOf(cls);
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
            const el = document.querySelector(cls === 'mes_stop' ? '#mes_stop > i' : (glyphSelOf(cls) || '').includes(' i::before') ? `#${cls} i` : `#${cls}`);
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
