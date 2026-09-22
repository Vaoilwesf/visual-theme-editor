// modules/fontManager.js
// Менеджер шрифтов: список, фильтр по алфавитам (кириллица и др.),
// живой предпросмотр интерфейса, автоматический @import + font-family.
//
// Источники: Google Fonts, Bunny Fonts (тот же каталог, без слежки)
// и своя ссылка — на CSS любого сервиса (cdnfonts, Fontshare, jsDelivr…)
// или прямо на файл шрифта.

let onFontSelected = null;
let onPreviewStart = null;
let onPreviewEnd = null;

let container = null;
let loadedFonts = new Set();
let previewFont = null;
let previewStyleEl = null;

// Куда применять шрифт.
// 'Весь интерфейс' — это именно '*': прежний список
// 'body, button, input, select, textarea, .drawer-content, .popup'
// покрывал далеко не всё, и шрифт ложился пятнами.
const TARGETS = [
    // Весь интерфейс SillyTavern берёт шрифт из одной переменной
    // --mainFontFamily. Меняем её — и это одна строка вместо правила на «*»
    // с десятком :not() и защитой значков
    { id: 'ui',      label: 'Весь интерфейс',      selector: ':root' },
    { id: 'chat',    label: 'Текст сообщений',     selector: '.mes_text, .mes_text p' },
    { id: 'names',   label: 'Имена персонажей',    selector: '.mes .ch_name .name_text' },
    { id: 'italics', label: 'Курсив в сообщениях', selector: '.mes_text em, .mes_text i' },
    { id: 'quotes',  label: 'Речь в кавычках',     selector: '.mes_text q' },
    { id: 'headers', label: 'Заголовки панелей',   selector: '.standoutHeader, .inline-drawer-header, .drawer-content h4' },
    { id: 'input',   label: 'Поле ввода',          selector: '#send_textarea' },
    { id: 'custom',  label: 'Свой селектор',       selector: '' },
];

/* ============================================================
   ЗАЩИТА ШРИФТОВЫХ ИКОНОК

   Иконки в SillyTavern — это символы шрифта Font Awesome. Если на них
   попадёт другой font-family, вместо иконки рисуется буква или квадрат.

   Одного :not() недостаточно, и это неочевидно: иконка ВНУТРИ
   стилизуемого блока наследует шрифт от родителя. Исключить <i class="fa-x">
   из основного правила мало — он всё равно получит новый шрифт по наследству
   от <p>. Поэтому пишем два правила: защитное :not() на основном селекторе
   плюс явный возврат шрифта самим иконкам.
============================================================ */

const ICON_GUARD = [
    ':not([class*="fa-"])',
    ':not(.fa)', ':not(.fas)', ':not(.far)', ':not(.fab)',
    ':not(.material-icons)',
    ':not(.material-icons-outlined)',
    ':not(.material-symbols-outlined)',
    ':not(.glyphicon)',
    ':not([class*="icomoon"])',
].join('');

const FA_SELECTOR = [
    '.fa', '.fas', '.far', '.fab', '.fal', '.fat',
    '.fa-solid', '.fa-regular', '.fa-brands', '.fa-light', '.fa-thin',
    '[class*="fa-"]',
].join(', ');

const FA_STACK = `'Font Awesome 6 Free', 'Font Awesome 6 Pro', `
    + `'Font Awesome 6 Brands', 'Font Awesome 5 Free', 'FontAwesome'`;

const FA_SOLID_SELECTOR = '.fa, .fas, .fa-solid, .fa-brands, .fab';
const FA_REGULAR_SELECTOR = '.far, .fa-regular, .fal, .fa-light, .fat, .fa-thin';

const MATERIAL_SELECTOR = [
    '.material-icons', '.material-icons-outlined',
    '.material-symbols-outlined', '.glyphicon',
].join(', ');

const MATERIAL_STACK = `'Material Icons', 'Material Symbols Outlined', 'Glyphicons Halflings'`;

/** Дописывает защиту иконок каждому селектору списка через запятую */
function withGuard(selector) {
    return String(selector || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        // Псевдоэлемент в конце не трогаем: ':not()' после '::after' невалиден.
        // Псевдоэлемент и так наследует шрифт от своего элемента.
        .map(s => (s.includes('::') ? s : s + ICON_GUARD))
        .join(', ');
}

/** Полный набор правил: основное плюс возврат шрифта иконкам */
function buildRuleset(font, weight, selector, guard) {
    const stack = buildStack(font);
    const rules = [];

    // Весь интерфейс: одна переменная ST. Значки Font Awesome задают свой
    // шрифт сами и её не используют — защищать их не нужно
    if (selector === ':root') {
        rules.push({ selector: ':root', decls: { '--mainFontFamily': stack }, important: true });
        if (weight && weight !== 400) rules.push({ selector: 'body', decls: { 'font-weight': String(weight) }, important: true });
        return rules;
    }

    // Защита значков нужна, только если селектор задевает сами значки
    // (например, «*»). У «.mes_text p» значки свой шрифт и так сохранят:
    // font-family на значке задан его собственным классом, а не унаследован
    if (!/\*/.test(selector)) guard = false;

    const mainDecls = { 'font-family': stack };
    if (weight && weight !== 400) mainDecls['font-weight'] = String(weight);

    rules.push({
        selector: guard ? withGuard(selector) : selector,
        decls: mainDecls,
        important: true,
    });

    if (!guard) return rules;

    rules.push({
        selector: FA_SELECTOR,
        decls: { 'font-family': FA_STACK, 'font-style': 'normal' },
        important: true,
    });

    // Насыщенность тоже наследуется, а Font Awesome Free различает
    // начертания именно весом: solid — 900, regular — 400.
    if (weight && weight !== 400) {
        rules.push({
            selector: FA_SOLID_SELECTOR,
            decls: { 'font-weight': '900' },
            important: true,
        });
        rules.push({
            selector: FA_REGULAR_SELECTOR,
            decls: { 'font-weight': '400' },
            important: true,
        });
    }

    rules.push({
        selector: MATERIAL_SELECTOR,
        decls: { 'font-family': MATERIAL_STACK, 'font-weight': 'normal' },
        important: true,
    });

    return rules;
}

const CATEGORIES = [
    ['all', 'Все'],
    ['sans', 'Sans'],
    ['serif', 'Serif'],
    ['display', 'Декор'],
    ['handwriting', 'Рукопис.'],
    ['monospace', 'Mono'],
];

const CATEGORY_LABELS = {
    sans: 'sans',
    serif: 'serif',
    display: 'декор',
    handwriting: 'рукопис.',
    monospace: 'mono',
};

/* ============================================================
   БИБЛИОТЕКА ШРИФТОВ
   c = категория, s = алфавиты, w = веса
============================================================ */
const FONTS = [
    // ── Кириллица: sans-serif ──
    { n: 'Roboto',            c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,700,900] },
    { n: 'Open Sans',         c: 'sans', s: ['cyrillic','latin'], w: [300,400,600,700,800] },
    { n: 'Montserrat',        c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Inter',             c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Nunito',            c: 'sans', s: ['cyrillic','latin'], w: [200,300,400,600,700,800,900] },
    { n: 'Nunito Sans',       c: 'sans', s: ['cyrillic','latin'], w: [200,300,400,600,700,800] },
    { n: 'Rubik',             c: 'sans', s: ['cyrillic','latin'], w: [300,400,500,600,700,800,900] },
    { n: 'Manrope',           c: 'sans', s: ['cyrillic','latin'], w: [200,300,400,500,600,700,800] },
    { n: 'Raleway',           c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Fira Sans',         c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,700,900] },
    { n: 'PT Sans',           c: 'sans', s: ['cyrillic','latin'], w: [400,700] },
    { n: 'PT Sans Narrow',    c: 'sans', s: ['cyrillic','latin'], w: [400,700] },
    { n: 'Ubuntu',            c: 'sans', s: ['cyrillic','latin'], w: [300,400,500,700] },
    { n: 'Oswald',            c: 'sans', s: ['cyrillic','latin'], w: [200,300,400,500,600,700] },
    { n: 'Exo 2',             c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Jost',              c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Comfortaa',         c: 'sans', s: ['cyrillic','latin'], w: [300,400,500,600,700] },
    { n: 'Golos Text',        c: 'sans', s: ['cyrillic','latin'], w: [400,500,600,700,800,900] },
    { n: 'Onest',             c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Unbounded',         c: 'sans', s: ['cyrillic','latin'], w: [200,300,400,500,600,700,800,900] },
    { n: 'Commissioner',      c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Alegreya Sans',     c: 'sans', s: ['cyrillic','latin'], w: [100,300,400,500,700,800,900] },
    { n: 'Anonymous Pro',     c: 'monospace', s: ['cyrillic','latin'], w: [400,700] },

    // ── Кириллица: serif ──
    { n: 'Playfair Display',  c: 'serif', s: ['cyrillic','latin'], w: [400,500,600,700,800,900] },
    { n: 'Merriweather',      c: 'serif', s: ['cyrillic','latin'], w: [300,400,700,900] },
    { n: 'PT Serif',          c: 'serif', s: ['cyrillic','latin'], w: [400,700] },
    { n: 'Lora',              c: 'serif', s: ['cyrillic','latin'], w: [400,500,600,700] },
    { n: 'EB Garamond',       c: 'serif', s: ['cyrillic','latin'], w: [400,500,600,700,800] },
    { n: 'Cormorant',         c: 'serif', s: ['cyrillic','latin'], w: [300,400,500,600,700] },
    { n: 'Cormorant Garamond',c: 'serif', s: ['cyrillic','latin'], w: [300,400,500,600,700] },
    { n: 'Alice',             c: 'serif', s: ['cyrillic','latin'], w: [400] },
    { n: 'Vollkorn',          c: 'serif', s: ['cyrillic','latin'], w: [400,500,600,700,800,900] },
    { n: 'Spectral',          c: 'serif', s: ['cyrillic','latin'], w: [200,300,400,500,600,700,800] },
    { n: 'Literata',          c: 'serif', s: ['cyrillic','latin'], w: [200,300,400,500,600,700,800,900] },
    { n: 'Noto Serif',        c: 'serif', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },
    { n: 'Alegreya',          c: 'serif', s: ['cyrillic','latin'], w: [400,500,600,700,800,900] },
    { n: 'Prata',             c: 'serif', s: ['cyrillic','latin'], w: [400] },
    { n: 'Ledger',            c: 'serif', s: ['cyrillic','latin'], w: [400] },
    { n: 'Bitter',            c: 'serif', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800,900] },

    // ── Кириллица: рукописные и декоративные ──
    { n: 'Caveat',            c: 'handwriting', s: ['cyrillic','latin'], w: [400,500,600,700] },
    { n: 'Bad Script',        c: 'handwriting', s: ['cyrillic','latin'], w: [400] },
    { n: 'Marck Script',      c: 'handwriting', s: ['cyrillic','latin'], w: [400] },
    { n: 'Pacifico',          c: 'handwriting', s: ['cyrillic','latin'], w: [400] },
    { n: 'Neucha',            c: 'handwriting', s: ['cyrillic','latin'], w: [400] },
    { n: 'Playball',          c: 'handwriting', s: ['latin'], w: [400] },
    { n: 'Yeseva One',        c: 'display', s: ['cyrillic','latin'], w: [400] },
    { n: 'Ruslan Display',    c: 'display', s: ['cyrillic','latin'], w: [400] },
    { n: 'Underdog',          c: 'display', s: ['cyrillic','latin'], w: [400] },
    { n: 'Kelly Slab',        c: 'display', s: ['cyrillic','latin'], w: [400] },
    { n: 'Russo One',         c: 'display', s: ['cyrillic','latin'], w: [400] },
    { n: 'Press Start 2P',    c: 'display', s: ['cyrillic','latin'], w: [400] },

    // ── Кириллица: monospace ──
    { n: 'JetBrains Mono',    c: 'monospace', s: ['cyrillic','latin'], w: [100,300,400,500,600,700,800] },
    { n: 'IBM Plex Mono',     c: 'monospace', s: ['cyrillic','latin'], w: [100,300,400,500,600,700] },
    { n: 'Roboto Mono',       c: 'monospace', s: ['cyrillic','latin'], w: [100,300,400,500,600,700] },
    { n: 'Source Code Pro',   c: 'monospace', s: ['cyrillic','latin'], w: [200,300,400,500,600,700,800,900] },
    { n: 'Fira Code',         c: 'monospace', s: ['cyrillic','latin'], w: [300,400,500,600,700] },

    // ── Только латиница ──
    { n: 'Cinzel',            c: 'serif', s: ['latin'], w: [400,500,600,700,800,900] },
    { n: 'Cinzel Decorative', c: 'display', s: ['latin'], w: [400,700,900] },
    { n: 'Great Vibes',       c: 'handwriting', s: ['latin'], w: [400] },
    { n: 'Dancing Script',    c: 'handwriting', s: ['latin'], w: [400,500,600,700] },
    { n: 'Parisienne',        c: 'handwriting', s: ['latin'], w: [400] },
    { n: 'Sacramento',        c: 'handwriting', s: ['latin'], w: [400] },
    { n: 'Tangerine',         c: 'handwriting', s: ['latin'], w: [400,700] },
    { n: 'Cormorant Unicase', c: 'serif', s: ['latin'], w: [300,400,500,600,700] },
    { n: 'Marcellus',         c: 'serif', s: ['latin'], w: [400] },
    { n: 'Italiana',          c: 'serif', s: ['latin'], w: [400] },
    { n: 'Bodoni Moda',       c: 'serif', s: ['latin'], w: [400,500,600,700,800,900] },
    { n: 'Libre Baskerville', c: 'serif', s: ['latin'], w: [400,700] },
    { n: 'Crimson Text',      c: 'serif', s: ['latin'], w: [400,600,700] },
    { n: 'Josefin Sans',      c: 'sans', s: ['latin'], w: [100,200,300,400,500,600,700] },
    { n: 'Poppins',           c: 'sans', s: ['latin'], w: [100,200,300,400,500,600,700,800,900] },
    { n: 'Quicksand',         c: 'sans', s: ['latin'], w: [300,400,500,600,700] },
    { n: 'Lexend',            c: 'sans', s: ['latin'], w: [100,200,300,400,500,600,700,800,900] },
    { n: 'Outfit',            c: 'sans', s: ['latin'], w: [100,200,300,400,500,600,700,800,900] },
    { n: 'Space Grotesk',     c: 'sans', s: ['latin'], w: [300,400,500,600,700] },
    { n: 'Orbitron',          c: 'display', s: ['latin'], w: [400,500,600,700,800,900] },
    { n: 'Audiowide',         c: 'display', s: ['latin'], w: [400] },
    { n: 'Creepster',         c: 'display', s: ['latin'], w: [400] },
    { n: 'Nosifer',           c: 'display', s: ['latin'], w: [400] },
    { n: 'Special Elite',     c: 'display', s: ['latin'], w: [400] },
    { n: 'Silkscreen',        c: 'display', s: ['latin'], w: [400,700] },
    { n: 'VT323',             c: 'monospace', s: ['latin'], w: [400] },
    { n: 'Share Tech Mono',   c: 'monospace', s: ['latin'], w: [400] },
];

/* ── Китайский, японский, корейский (есть и в Google, и в Bunny) ── */
FONTS.push(
    { n: 'Noto Sans SC',      c: 'sans', s: ['chinese','latin'], w: [100,300,400,500,700,900] },
    { n: 'Noto Serif SC',     c: 'serif', s: ['chinese','latin'], w: [200,300,400,500,600,700,900] },
    { n: 'ZCOOL XiaoWei',     c: 'serif', s: ['chinese','latin'], w: [400] },
    { n: 'ZCOOL KuaiLe',      c: 'display', s: ['chinese','latin'], w: [400] },
    { n: 'Ma Shan Zheng',     c: 'handwriting', s: ['chinese','latin'], w: [400] },
    { n: 'Long Cang',         c: 'handwriting', s: ['chinese','latin'], w: [400] },
    { n: 'Noto Sans JP',      c: 'sans', s: ['japanese','latin'], w: [100,300,400,500,700,900] },
    { n: 'Noto Sans KR',      c: 'sans', s: ['korean','latin'], w: [100,300,400,500,700,900] },
);

/* ============================================================
   ИСТОЧНИКИ
============================================================ */
const SOURCES = [
    { id: 'google', label: 'Google Fonts' },
    { id: 'bunny', label: 'Bunny Fonts' },
    { id: 'zeoseven', label: 'ZeoSeven Fonts' },
    { id: 'custom', label: 'Своя ссылка' },
];
const SOURCE_KEY = 'vte-font-source';
let source = (() => { try { return localStorage.getItem(SOURCE_KEY) || 'google'; } catch { return 'google'; } })();
if (!SOURCES.some(x => x.id === source)) source = 'google';

const SAMPLE_CYR = 'Съешь ещё этих мягких булок';
const SAMPLE_LAT = 'The quick brown fox jumps';

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

function icon(name) {
    return h('i', { className: `fa-solid ${name}` });
}

function checkbox(id, label, checked, onChange) {
    const input = h('input', { type: 'checkbox', id, checked: !!checked });
    if (typeof onChange === 'function') input.addEventListener('change', onChange);
    return h('label.vte-check', {}, [input, h('span', { text: label })]);
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================ */
// Ссылки на подгруженные шрифты и текущий наблюдатель видимости.
// Раньше и то, и другое накапливалось без предела: <link> оставались в <head>
// навсегда, а IntersectionObserver создавался заново на каждое нажатие
// клавиши в поиске, ни один не отключался.
let fontLinks = new Map();   // имя шрифта -> <link>
let cardObserver = null;

let onToast = null;

export function init(options = {}) {
    onToast = options.onToast || null;
    onFontSelected = options.onFontSelected || (() => {});
    onPreviewStart = options.onPreviewStart || (() => {});
    onPreviewEnd = options.onPreviewEnd || (() => {});
    // Слой предпросмотра создаём при первом обращении, а не при загрузке ST:
    // раньше пустой <style> висел в <head>, даже если редактор не открывали
}

export function mount(el) {
    if (!el) return;
    container = el;
    renderShell();
    bindControls();
    renderList();
}

function ensurePreviewStyle() {
    if (previewStyleEl && previewStyleEl.isConnected) return;
    previewStyleEl = document.createElement('style');
    previewStyleEl.id = 'vte-font-preview';
    document.head.appendChild(previewStyleEl);
}

/**
 * Снять всё, что вкладка добавила в документ.
 * Вызывается при выключении редактора.
 */
export function cleanup() {
    clearPreview();
    previewStyleEl?.remove();
    previewStyleEl = null;

    if (cardObserver) { cardObserver.disconnect(); cardObserver = null; }

    // Шрифт, который человек применил, живёт в самой теме через @import.
    // Ссылки, подгруженные ради предпросмотра списка, больше не нужны.
    for (const link of fontLinks.values()) link.remove();
    fontLinks.clear();
    loadedFonts.clear();
}

/* ============================================================
   РАЗМЕТКА ВКЛАДКИ
============================================================ */
function renderShell() {
    container.textContent = '';
    container.classList.add('vte-fonts');

    const search = h('input#vte-font-search.vte-input', {
        type: 'text', placeholder: 'Название шрифта…', spellcheck: false,
    });
    const clearBtn = h('button#vte-font-clear.vte-icon-btn', {
        type: 'button', title: 'Очистить поиск',
    }, [icon('fa-xmark')]);

    const searchRow = h('div.vte-fonts-search', {}, [
        h('span.vte-search-ic', {}, [icon('fa-magnifying-glass')]),
        search,
        clearBtn,
    ]);

    const sourceSelect = h('select#vte-font-source.vte-select', {},
        SOURCES.map(x => h('option', { value: x.id, text: x.label })));
    sourceSelect.value = source;

    const customUrl = h('input#vte-font-url.vte-input', {
        type: 'text', spellcheck: false,
        placeholder: 'https://… ссылка на CSS шрифта или на .woff2 / .ttf',
    });
    const customName = h('input#vte-font-name.vte-input', {
        type: 'text', spellcheck: false, placeholder: 'Название (найду сам, если смогу)',
    });
    const customBtn = h('button#vte-font-url-go.vte-btn.vte-btn-primary', { type: 'button' },
        [icon('fa-link'), h('span', { text: ' Подключить' })]);
    const customBox = h('div#vte-font-custom-src.vte-fonts-custom', { style: 'display:none' }, [
        customUrl,
        h('div.vte-fonts-custom-row', {}, [customName, customBtn]),
        h('small.vte-note', {
            text: 'Подойдёт ссылка из cdnfonts, Fontshare, jsDelivr/Fontsource, Bunny, Google '
                + 'и любых других сайтов, которые отдают CSS со шрифтом, — или прямо на файл шрифта.',
        }),
    ]);

    /* ---- ZeoSeven Fonts ----
       Их каталог отдаёт шрифт по номеру: fontsapi.zeoseven.com/<номер>/main.css.
       Номер виден в адресе страницы шрифта на сайте. Название и покрытие
       алфавитов читаем прямо из этого CSS: там есть font-family и unicode-range,
       по которому видно, есть ли кириллица. */
    const zsId = h('input#vte-font-zs-id.vte-input', {
        type: 'text', spellcheck: false, placeholder: 'номер шрифта или ссылка с zeoseven.com',
    });
    const zsName = h('input#vte-font-zs-name.vte-input', {
        type: 'text', spellcheck: false, placeholder: 'название (найду сам, если сайт разрешит)',
    });
    const zsBtn = h('button#vte-font-zs-go.vte-btn.vte-btn-primary', { type: 'button' },
        [icon('fa-link'), h('span', { text: ' Подключить' })]);
    const zsNote = h('small#vte-font-zs-note.vte-note', {
        text: 'Кириллицу поддерживают не все шрифты каталога. После подключения я проверю '
            + 'набор символов и предупрежу, если кириллицы в нём нет.',
    });
    const zsBox = h('div#vte-font-zs.vte-fonts-custom', { style: 'display:none' }, [
        zsId, h('div.vte-fonts-custom-row', {}, [zsName, zsBtn]), zsNote,
    ]);

    const sourceRow = h('div.vte-row', {}, [h('span.vte-label', { text: 'Источник' }), sourceSelect]);

    const toggles = h('div.vte-fonts-toggles', {}, [
        checkbox('vte-font-cyrillic', 'Только кириллица', true),
        checkbox('vte-font-live', 'Живой предпросмотр', true),
        checkbox('vte-font-extra-weights', 'Импорт 300/400/700', false),
        checkbox('vte-font-guard', 'Не менять шрифт у иконок', true),
    ]);

    const cats = h('div.vte-fonts-cats', {}, CATEGORIES.map(([id, label], i) => {
        const btn = h('button.vte-font-cat', {
            type: 'button', dataset: { cat: id }, text: label,
        });
        if (i === 0) btn.classList.add('active');
        return btn;
    }));

    const targetSelect = h('select#vte-font-target.vte-select', {},
        TARGETS.map(t => h('option', { value: t.id, text: t.label })));

    const customInput = h('input#vte-font-custom.vte-input', {
        type: 'text', spellcheck: false, placeholder: '.mes_text, #send_textarea',
    });

    const customRow = h('div#vte-font-custom-row.vte-row', { style: 'display:none' }, [
        h('span.vte-label', { text: 'Селектор' }),
        customInput,
    ]);

    const weightSelect = h('select#vte-font-weight.vte-select', {}, [
        h('option', { value: '400', text: '400 (обычный)' }),
    ]);

    const options = h('div.vte-fonts-options', {}, [
        h('div.vte-row', {}, [
            h('span.vte-label', { text: 'Применить к' }),
            targetSelect,
        ]),
        customRow,
        h('div.vte-row', {}, [
            h('span.vte-label', { text: 'Насыщенность' }),
            weightSelect,
        ]),
    ]);

    const counter = h('div.vte-fonts-counter', {}, [
        h('span#vte-font-count', { text: '0' }),
        h('span', { text: ' из ' }),
        h('span#vte-font-total', { text: String(FONTS.length) }),
    ]);

    const list = h('div#vte-font-list.vte-fonts-list');

    const current = h('div#vte-font-current.vte-fonts-current', {}, [
        h('span.vte-font-current-ic', {}, [icon('fa-font')]),
        h('strong', { text: 'шрифт не выбран' }),
    ]);

    const applyBtn = h('button#vte-font-apply.vte-btn.vte-btn-primary', {
        type: 'button', disabled: true,
    }, [icon('fa-check'), h('span', { text: ' Применить' })]);

    const footer = h('div.vte-fonts-footer', {}, [current, applyBtn]);

    // «Применить» и выбранный шрифт — наверху, прилипают при прокрутке списка
    footer.classList.add('vte-apply-top');
    container.append(footer, options, sourceRow, zsBox, customBox, searchRow, toggles, cats, counter, list);
}

/* ============================================================
   ОБРАБОТЧИКИ УПРАВЛЕНИЯ
============================================================ */
let listTimer = null;

/**
 * Отложенная перерисовка списка.
 *
 * renderList висел на 'input' напрямую: каждое нажатие клавиши перестраивало
 * все 90 карточек и создавало новый IntersectionObserver.
 */
function scheduleList() {
    clearTimeout(listTimer);
    listTimer = setTimeout(renderList, 180);
}

function bindControls() {
    const q = (sel) => container.querySelector(sel);

    q('#vte-font-search').addEventListener('input', scheduleList);
    q('#vte-font-clear').addEventListener('click', () => {
        q('#vte-font-search').value = '';
        renderList();
    });
    q('#vte-font-cyrillic').addEventListener('change', renderList);

    q('#vte-font-guard').addEventListener('change', () => {
        if (previewFont) applyPreview(previewFont);
    });

    q('#vte-font-live').addEventListener('change', (e) => {
        if (!e.target.checked) clearPreview();
        else if (previewFont) applyPreview(previewFont);
    });

    container.querySelectorAll('.vte-font-cat').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.vte-font-cat').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderList();
        });
    });

    q('#vte-font-target').addEventListener('change', (e) => {
        const isCustom = e.target.value === 'custom';
        q('#vte-font-custom-row').style.display = isCustom ? 'flex' : 'none';
        if (previewFont) applyPreview(previewFont);
    });

    q('#vte-font-custom').addEventListener('change', () => {
        if (previewFont) applyPreview(previewFont);
    });

    q('#vte-font-weight').addEventListener('change', () => {
        if (previewFont) applyPreview(previewFont);
    });

    q('#vte-font-apply').addEventListener('click', commit);

    const syncSource = () => {
        const custom = source === 'custom';
        const zs = source === 'zeoseven';
        q('#vte-font-custom-src').style.display = custom ? 'flex' : 'none';
        const zsBox = q('#vte-font-zs');
        if (zsBox) zsBox.style.display = zs ? 'flex' : 'none';
        for (const sel of ['.vte-fonts-search', '.vte-fonts-cats', '.vte-fonts-counter', '#vte-font-list']) {
            const el = container.querySelector(sel);
            if (el) el.style.display = custom || zs ? 'none' : '';
        }
    };
    q('#vte-font-source').addEventListener('change', (e) => {
        source = e.target.value;
        try { localStorage.setItem(SOURCE_KEY, source); } catch {}
        syncSource();
        // Предпросмотр грузится уже с нового сервиса
        if (previewFont && !previewFont.custom) { loadFont(previewFont); applyPreview(previewFont); }
    });
    q('#vte-font-url-go').addEventListener('click', connectCustom);
    q('#vte-font-zs-go')?.addEventListener('click', connectZeoSeven);
    q('#vte-font-zs-id')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectZeoSeven(); });
    q('#vte-font-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') connectCustom(); });
    syncSource();
}

/* ============================================================
   СВОЯ ССЫЛКА
============================================================ */
function say(t) { try { onToast?.(t); } catch {} }

/** Подключить шрифт из каталога ZeoSeven по его номеру */
async function connectZeoSeven() {
    const q = (sel) => container.querySelector(sel);
    const raw = q('#vte-font-zs-id').value.trim();
    const note = q('#vte-font-zs-note');
    const id = (raw.match(/(\d{2,6})/) || [])[1];
    if (!id) {
        say('Нужен номер шрифта — он есть в адресе страницы шрифта на zeoseven.com');
        return;
    }
    // Можно вставить и готовую ссылку на CSS — тогда берём её как есть
    const url = /^https?:\/\/[^\s]+\.css/i.test(raw)
        ? raw
        : `https://fontsapi.zeoseven.com/${id}/main/result.css`;
    let name = q('#vte-font-zs-name').value.trim().replace(/["'\\;{}]/g, '');
    let cyr = null;

    note.textContent = 'Читаю описание шрифта…';
    try {
        const res = await fetch(url, { mode: 'cors' });
        const text = await res.text();
        if (!name) {
            const m = text.match(/font-family\s*:\s*['"]?([^;'"\n]+)['"]?/i);
            if (m) name = m[1].trim();
        }
        // Кириллица — это диапазон U+0400–04FF
        cyr = /U\+04\w\w/i.test(text) || /U\+0400/i.test(text);
    } catch {
        note.textContent = 'Сайт не дал прочитать описание — впишите название шрифта вручную.';
    }

    if (!name) {
        q('#vte-font-zs-name').focus();
        return;
    }
    q('#vte-font-zs-name').value = name;
    if (cyr === false) {
        note.textContent = `У «${name}» в наборе нет кириллицы — русский текст будет рисоваться запасным шрифтом.`;
    } else if (cyr === true) {
        note.textContent = `✓ «${name}»: кириллица есть.`;
    }

    selectFont({ n: name, c: 'sans', s: cyr ? ['cyrillic'] : [], w: [400, 700], custom: { type: 'css', url } }, null);
}

async function connectCustom() {
    const q = (sel) => container.querySelector(sel);
    const url = q('#vte-font-url').value.trim();
    let name = q('#vte-font-name').value.trim().replace(/["'\\;{}]/g, '');

    if (!/^https:\/\/[^\s"'()<>]+$/i.test(url)) {
        say('Нужна ссылка, начинающаяся с https://');
        return;
    }
    const isFile = /\.(woff2?|ttf|otf)(\?.*)?$/i.test(url);

    // Название пробуем достать из самого CSS. Google, Bunny и большинство
    // CDN разрешают его прочитать; если сайт не разрешит — попросим ввести
    if (!name && !isFile) {
        try {
            const res = await fetch(url, { mode: 'cors' });
            const text = await res.text();
            const m = text.match(/font-family\s*:\s*['"]?([^;'"\n]+)['"]?/i);
            if (m) name = m[1].trim();
        } catch {}
    }
    if (!name && isFile) {
        name = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.(woff2?|ttf|otf)$/i, '')
            .replace(/[-_]+(regular|normal|variable|vf|webfont)$/i, '').replace(/[-_]+/g, ' ').trim();
    }
    if (!name) {
        say('Не удалось узнать название шрифта — впишите его в поле «Название»');
        q('#vte-font-name').focus();
        return;
    }
    q('#vte-font-name').value = name;

    const font = {
        n: name, c: 'sans', s: [], w: [400, 700],
        custom: { type: isFile ? 'file' : 'css', url },
    };
    selectFont(font, null);
}

/* ============================================================
   СПИСОК ШРИФТОВ
============================================================ */
function renderList() {
    const q = (sel) => container.querySelector(sel);
    const list = q('#vte-font-list');
    if (!list) return;

    const term = q('#vte-font-search').value.trim().toLowerCase();
    const cyrOnly = q('#vte-font-cyrillic').checked;
    const cat = container.querySelector('.vte-font-cat.active')?.dataset.cat || 'all';

    const items = FONTS.filter(f => {
        if (cyrOnly && !f.s.includes('cyrillic')) return false;
        if (cat !== 'all' && f.c !== cat) return false;
        if (term && !f.n.toLowerCase().includes(term)) return false;
        return true;
    });

    q('#vte-font-count').textContent = String(items.length);
    q('#vte-font-total').textContent = String(FONTS.length);

    list.textContent = '';

    if (!items.length) {
        list.appendChild(h('div.vte-fonts-empty', {}, [
            h('span.vte-empty-ic', {}, [icon('fa-font')]),
            h('div', { text: 'Ничего не найдено' }),
            h('small', { text: 'Снимите фильтр кириллицы или очистите поиск' }),
        ]));
        return;
    }

    const frag = document.createDocumentFragment();
    for (const font of items) frag.appendChild(fontCard(font));
    list.appendChild(frag);

    observeCards(list);
}

function fontCard(font) {
    const hasCyr = font.s.includes('cyrillic');
    const sample = hasCyr ? SAMPLE_CYR : SAMPLE_LAT;
    const stack = buildStack(font);

    const badges = h('div.vte-font-badges', {}, [
        hasCyr ? h('span.vte-badge.vte-badge-cyr', { text: 'АБВ', title: 'Поддерживает кириллицу' }) : null,
        h('span.vte-badge', { text: CATEGORY_LABELS[font.c] || font.c }),
        h('span.vte-badge.vte-badge-dim', { text: `${font.w.length} вес.` }),
    ]);

    const head = h('div.vte-font-card-head', {}, [
        h('span.vte-font-name', { text: font.n }),
        badges,
    ]);

    const preview = h('div.vte-font-sample', {
        style: `font-family:${stack}`,
        text: sample,
    });

    const glyphs = h('div.vte-font-glyphs', {
        style: `font-family:${stack}`,
        text: hasCyr ? 'Aa Бб Вв Гг 123 — ,.!?' : 'Aa Bb Cc Dd 123 — ,.!?',
    });

    const card = h('div.vte-font-card', {
        dataset: { font: font.n },
        on: {
            click: () => selectFont(font, card),
            mouseenter: () => loadFont(font),
        },
    }, [head, preview, glyphs]);

    if (previewFont?.n === font.n) card.classList.add('selected');
    return card;
}

function observeCards(list) {
    if (!('IntersectionObserver' in window)) {
        list.querySelectorAll('.vte-font-card').forEach(c => {
            loadFont(FONTS.find(f => f.n === c.dataset.font));
        });
        return;
    }

    // Прошлый наблюдатель обязательно отключаем: карточки, за которыми он
    // следил, уже удалены из документа, но сам он оставался жить
    if (cardObserver) cardObserver.disconnect();

    cardObserver = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            loadFont(FONTS.find(f => f.n === entry.target.dataset.font));
            obs.unobserve(entry.target);
        }
    }, { root: list, rootMargin: '160px' });

    list.querySelectorAll('.vte-font-card').forEach(c => cardObserver.observe(c));
}
/* ============================================================
   ЗАГРУЗКА ШРИФТА В СТРАНИЦУ
============================================================ */
function loadFont(font) {
    if (!font || loadedFonts.has(font.n + '|' + source)) return;
    loadedFonts.add(font.n + '|' + source);

    // Прямая ссылка на файл — через FontFace, без лишнего CSS
    if (font.custom?.type === 'file') {
        try {
            const ff = new FontFace(font.n, `url("${font.custom.url}")`, { display: 'swap' });
            ff.load().then(f => document.fonts.add(f)).catch(() => say(`Файл шрифта не загрузился: ${font.custom.url}`));
        } catch {}
        return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.vteFont = font.n;
    link.href = buildCssUrl(font, [400, 700].filter(w => font.w.includes(w)));
    document.head.appendChild(link);

    // Держим ссылку, чтобы потом было что удалить: раньше при прокрутке
    // списка в <head> оседало до 90 тегов, и ни один не убирался
    fontLinks.set(font.n, link);
}

function buildCssUrl(font, weights) {
    if (font.custom) return font.custom.type === 'css' ? font.custom.url : '';
    const w = (weights && weights.length ? weights : [400])
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
    const plus = font.n.replace(/ /g, '+');
    if (source === 'bunny') {
        // Bunny понимает имена в нижнем регистре через дефис и веса через запятую
        const id = font.n.toLowerCase().replace(/ /g, '-');
        return `https://fonts.bunny.net/css?family=${id}:${w.join(',')}&display=swap`;
    }
    return `https://fonts.googleapis.com/css2?family=${plus}:wght@${w.join(';')}&display=swap`;
}

/* ============================================================
   ВЫБОР И ПРЕДПРОСМОТР
============================================================ */
function selectFont(font, card) {
    previewFont = font;

    container.querySelectorAll('.vte-font-card').forEach(c => c.classList.remove('selected'));
    card?.classList.add('selected');

    const sel = container.querySelector('#vte-font-weight');
    sel.textContent = '';
    for (const w of font.w) {
        const suffix = w === 400 ? ' (обычный)' : w === 700 ? ' (жирный)' : '';
        const opt = h('option', { value: String(w), text: `${w}${suffix}` });
        if (w === 400) opt.selected = true;
        sel.appendChild(opt);
    }
    if (!font.w.includes(400) && sel.firstElementChild) {
        sel.firstElementChild.selected = true;
    }

    setCurrentLabel(font.n, false);
    container.querySelector('#vte-font-apply').disabled = false;

    loadFont(font);
    if (container.querySelector('#vte-font-live').checked) applyPreview(font);
}

function setCurrentLabel(name, done) {
    const label = container.querySelector('#vte-font-current');
    if (!label) return;
    label.textContent = '';
    label.classList.toggle('vte-ok', !!done);
    label.append(
        h('span.vte-font-current-ic', {}, [icon(done ? 'fa-circle-check' : 'fa-font')]),
        h('strong', { text: name })
    );
    if (done) label.append(h('span', { text: ' применён' }));
}

/** Включена ли защита иконок */
function guardEnabled() {
    const chk = container?.querySelector('#vte-font-guard');
    return chk ? chk.checked : true;
}

function applyPreview(font) {
    if (!font) return;
    ensurePreviewStyle();

    const weight = Number(container.querySelector('#vte-font-weight').value) || 400;
    const rules = buildRuleset(font, weight, currentSelector(), guardEnabled());

    // Предпросмотр строим из того же набора правил, что уйдёт в CSS.
    // Раньше предпросмотр писал одно правило без защиты, поэтому в нём
    // иконки ломались, а после применения — нет. Или наоборот.
    previewStyleEl.textContent = rules.map(r => {
        const body = Object.entries(r.decls)
            .map(([p, v]) => `    ${p}: ${v} !important;`)
            .join('\n');
        return `${r.selector} {\n${body}\n}`;
    }).join('\n');

    onPreviewStart(font.n);
}

function clearPreview() {
    if (previewStyleEl) previewStyleEl.textContent = '';
    onPreviewEnd();
}

function currentSelector() {
    const id = container.querySelector('#vte-font-target').value;
    if (id === 'custom') {
        const v = container.querySelector('#vte-font-custom').value.trim();
        return v || 'body';
    }
    return TARGETS.find(t => t.id === id)?.selector || 'body';
}

function buildStack(font) {
    const fallback = {
        sans: `'Segoe UI', Arial, sans-serif`,
        serif: `'Times New Roman', Georgia, serif`,
        display: `Impact, sans-serif`,
        handwriting: `'Comic Sans MS', cursive`,
        monospace: `Consolas, monospace`,
    }[font.c] || 'sans-serif';
    return `'${font.n}', ${fallback}`;
}

/* ============================================================
   ПРИМЕНЕНИЕ В CSS
============================================================ */
function commit() {
    if (!previewFont) return;

    const font = previewFont;
    const weight = Number(container.querySelector('#vte-font-weight').value) || 400;
    const extra = container.querySelector('#vte-font-extra-weights').checked;
    const guard = guardEnabled();

    const weights = extra
        ? [300, 400, 700, weight].filter(w => font.w.includes(w))
        : [weight].filter(w => font.w.includes(w));

    onFontSelected({
        family: font.n,
        stack: buildStack(font),
        weight,
        selector: currentSelector(),
        importUrl: buildCssUrl(font, weights.length ? weights : [400]),
        fontFace: font.custom?.type === 'file' ? { family: font.n, url: font.custom.url } : null,
        subsets: font.s,
        category: font.c,
        // Готовый набор правил вместо одного селектора: сюда входит и
        // возврат шрифта иконкам, без которого они превращались в буквы
        rules: buildRuleset(font, weight, currentSelector(), guard),
        guarded: guard,
    });

    clearPreview();
    setCurrentLabel(font.n, true);
    setTimeout(() => {
        if (previewFont === font) setCurrentLabel(font.n, false);
    }, 2200);
}

/* ============================================================
   ПУБЛИЧНЫЕ ХЕЛПЕРЫ
============================================================ */
export function stopPreview() {
    clearPreview();
}

export function getFontList() {
    return FONTS.map(f => ({ ...f }));
}

export function isAvailable(family) {
    try { return document.fonts.check(`16px '${family}'`); } catch { return false; }
}
