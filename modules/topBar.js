// modules/topBar.js
// «Топ-бар ♡»: фон, форма и значки верхней панели SillyTavern в одном окне.
//
// Что пишется в CSS (всё в блок «Мои правки», раздел «Топ-бар ♡»):
//   #top-bar                          — фон, линия снизу, скругление, тень;
//   #top-settings-holder              — промежуток между значками;
//   #top-settings-holder .drawer-icon — размер и цвет значков;
//   … :hover / .openIcon               — наведение и открытые панели;
//   #<кнопка> .drawer-icon::before    — замена значка.
//
// Как устроено, чтобы было легко:
//  - размер значков «резиновый»: clamp(телефон, формула от ширины, ПК).
//    Одна строка вместо пачки @media под каждый экран;
//  - замена значка — это только content у ::before, который Font Awesome
//    и так рисует. Никаких font-size:0 + ::after с абсолютным
//    позиционированием: те же символы, меньше правил и пересчётов;
//  - размытие под топ-баром и тяжёлая тень ST (20px) снимаются одной
//    галочкой и выбором «лёгкая тень»;
//  - при движении ползунков значения ставятся прямо на топ-бар и значки
//    (пересчитываются только они, а не вся таверна), а в тему пишется
//    один раз — когда ползунок отпустили;
//  - своя картинка значка — тот же код, что пишет инструмент «Картинка»
//    при клике на элемент: фон 1em на месте символа. Один способ на всё
//    расширение. Маску не используем: картинку с чужого сайта браузер
//    для маски не загрузит (нужно разрешение CORS), и значок пропадает.

let onApply = null;       // (rules) => записать в тему одним шагом истории
let onReadRules = null;   // () => Map(селектор -> Map(свойство -> значение))
let onThemeRules = null;  // () => правила самой темы, которые трогают топ-бар
let onReveal = null;      // (from, to) => показать место в панели кода
let onIconRules = null;   // (элемент) => [{ from, to }] — места темы про этот значок
let onRevealMany = null;  // (список) => подсветить все эти места в коде
let onToast = null;
let picker = null;
let onSnapshot = null;   // запомнить тему на момент открытия окна
let onRestore = null;    // вернуть её обратно

let panel = null;
let els = {};
let state = null;
let icons = null;         // данные Font Awesome, грузятся при первом открытии

const SEL = {
    bar: '#top-bar',
    holder: '#top-settings-holder',
    icon: '#top-settings-holder .drawer-icon',
    closed: '#top-settings-holder .drawer-icon.closedIcon',
    closedHover: '#top-settings-holder .drawer-icon.closedIcon:hover',
    barImg: '#top-bar::before',
    active: '#top-settings-holder .drawer-icon:hover, #top-settings-holder .drawer-icon.openIcon',
    lift: '#top-settings-holder .drawer-icon:hover',
};

// Экран, на котором значок минимальный, и на котором максимальный
const VW_MIN = 360;
const VW_MAX = 1280;

const SHADOWS = {
    theme: '',
    light: '0 1px 6px rgba(0, 0, 0, 0.3)',
    none: 'none',
};

/* Подписи для кнопок самой SillyTavern */
const KNOWN = {
    'ai-config-button': 'Настройки ИИ',
    'sys-settings-button': 'Подключение к API',
    'advanced-formatting-button': 'Форматирование',
    'WI-SP-button': 'Миры (World Info)',
    'user-settings-button': 'Настройки пользователя',
    'backgrounds-button': 'Фоны',
    'extensions-settings-button': 'Расширения',
    'persona-management-button': 'Персоны',
    'rightNavHolder': 'Персонажи',
};

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================ */
export function init(options = {}) {
    onApply = options.onApply || null;
    onReadRules = options.onReadRules || null;
    onThemeRules = options.onThemeRules || null;
    onReveal = options.onReveal || null;
    onIconRules = options.onIconRules || null;
    onRevealMany = options.onRevealMany || null;
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
   ЗНАЧКИ ТОП-БАРА НА СТРАНИЦЕ
============================================================ */
/**
 * Все значки верхней панели, включая добавленные расширениями.
 * Селектор строится от id самого значка или от id кнопки-родителя —
 * оба стабильны, в отличие от номеров по порядку.
 */
/* В каком слое тема рисует значок. Считается один раз при открытии окна:
   getComputedStyle на каждом кадре предпросмотра был бы дорогим */
let layerCache = new WeakMap();

const isClear = (c) => /^(transparent|rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\))$/i.test(String(c || '').trim());

/**
 * Чем тема рисует значок, кроме символа шрифта: картинкой на самом значке,
 * маской, картинкой в слое. Всё это надо «выключить», когда ставим свой
 * значок, — иначе старая картинка остаётся поверх или маска прячет новый.
 */
let drawnCache = new WeakMap();

function glyphDrawn(el, layer) {
    if (drawnCache.has(el)) return drawnCache.get(el);
    const d = { elImg: false, elMask: false, layerImg: false, hiddenColor: false };
    try {
        const cs = getComputedStyle(el);
        const lay = getComputedStyle(el, layer);
        const hidden = isClear(cs.color) || parseFloat(cs.fontSize) === 0;
        d.elMask = !!urlOf(cs.maskImage || cs.webkitMaskImage);
        d.elImg = !!urlOf(cs.backgroundImage) && (hidden || d.elMask);
        d.layerImg = !!urlOf(lay.backgroundImage);
        d.hiddenColor = isClear(cs.color) && layer === '::before';
    } catch {}
    drawnCache.set(el, d);
    return d;
}

function glyphLayer(el) {
    if (layerCache.has(el)) return layerCache.get(el);
    let layer = '::before';
    try {
        const own = getComputedStyle(el);
        const after = getComputedStyle(el, '::after').content;
        // Приём «font-size:0 на значке + свой символ в ::after»
        if (parseFloat(own.fontSize) === 0 && after && after !== 'none' && after !== 'normal') layer = '::after';
    } catch {}
    layerCache.set(el, layer);
    return layer;
}

function barIcons() {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('#top-settings-holder .drawer-icon')) {
        let sel = '';
        if (el.id) sel = `#${CSS.escape(el.id)}`;
        else {
            const drawer = el.closest('#top-settings-holder > *[id]');
            if (drawer) sel = `#${CSS.escape(drawer.id)} .drawer-icon`;
        }
        if (!sel || seen.has(sel)) continue;
        seen.add(sel);

        const drawerId = el.closest('#top-settings-holder > *[id]')?.id || '';
        const label = KNOWN[drawerId] || el.getAttribute('title') || drawerId || el.id || 'Значок';
        out.push({
            el,
            sel,
            label,
            // Значок самой SillyTavern или добавленный расширением
            builtIn: !!KNOWN[drawerId],
            // Замена работает через ::before шрифта Font Awesome
            isFa: /\bfa-/.test(el.className),
            layer: glyphLayer(el),
            drawn: glyphDrawn(el, glyphLayer(el)),
        });
    }
    return out;
}

/* ============================================================
   СОСТОЯНИЕ: читаем из уже записанных правил
============================================================ */
function defaults() {
    return {
        bg: '', noBlur: false, shadow: 'theme',
        bgImg: '', bgFit: 'cover', bgOpacity: 100,
        closedOpacity: 0,
        radiusTop: 0, radiusBottom: 0,
        borderWidth: 0, borderColor: '',
        icColor: '', icActive: '', icMin: 0, icMax: 0,
        gap: 0,
        // селектор значка -> имя значка Font Awesome или { img: ссылка }
        glyphs: {},
        // что мы уже «выключили» у значка: картинку, маску, прозрачный цвет
        neutral: {},
    };
}

const strip = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();
// Адрес из url(...): кавычки учитываем парами — внутри data:SVG бывают
// одинарные кавычки, и они не должны обрывать адрес
const urlOf = (v) => {
    const m = String(v || '').match(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/);
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};

function readState() {
    const s = defaults();
    const rules = onReadRules?.() || new Map();
    const get = (sel, prop) => strip(rules.get(sel)?.get(prop));

    s.bg = get(SEL.bar, 'background-color');
    s.noBlur = get(SEL.bar, 'backdrop-filter') === 'none';
    const sh = get(SEL.bar, 'box-shadow');
    s.shadow = sh === 'none' ? 'none' : sh ? 'light' : 'theme';
    // border-radius: «верх верх низ низ» или от прошлых версий «0 0 низ низ»
    const rad = get(SEL.bar, 'border-radius').split(/\s+/).map(v => Math.round(parseFloat(v) || 0));
    if (rad.length === 4) { s.radiusTop = rad[0]; s.radiusBottom = rad[3]; }
    else if (rad.length === 1 && rad[0]) { s.radiusTop = s.radiusBottom = rad[0]; }
    const bd = get(SEL.bar, 'border').match(/^(\d+(?:\.\d+)?)px\s+solid\s+(.+)$/);
    if (bd) { s.borderWidth = +bd[1]; s.borderColor = bd[2]; }
    // Картинка фона: на самом топ-баре или (если прозрачная) в его ::before
    const layer = get(SEL.barImg, 'background');
    if (layer) {
        s.bgImg = urlOf(layer);
        s.bgFit = /\/\s*contain/.test(layer) ? 'contain' : /\/\s*auto/.test(layer) ? 'repeat' : 'cover';
        const op = parseFloat(get(SEL.barImg, 'opacity'));
        s.bgOpacity = Number.isFinite(op) ? Math.round(op * 100) : 100;
    } else {
        s.bgImg = urlOf(get(SEL.bar, 'background-image'));
        const size = get(SEL.bar, 'background-size');
        s.bgFit = size === 'contain' ? 'contain' : size === 'auto' ? 'repeat' : 'cover';
    }
    const cop = parseFloat(get(SEL.closed, 'opacity'));
    s.closedOpacity = Number.isFinite(cop) ? Math.round(cop * 100) : 0;

    s.icColor = get(SEL.icon, 'color');
    const fs = get(SEL.icon, 'font-size').match(/^clamp\(\s*(\d+(?:\.\d+)?)px\s*,.*,\s*(\d+(?:\.\d+)?)px\s*\)$/)
        || get(SEL.icon, 'font-size').match(/^()(\d+(?:\.\d+)?)px$/);
    if (fs) { s.icMax = Math.round(+fs[2]); s.icMin = fs[1] ? Math.round(+fs[1]) : s.icMax; }
    s.icActive = get(SEL.active, 'color');
    const gap = get(SEL.holder, 'gap').match(/(\d+(?:\.\d+)?)px\s*\)?\s*$/);
    s.gap = gap ? Math.round(+gap[1]) : 0;

    for (const it of barIcons()) {
        const own = rules.get(it.sel);
        const lay = rules.get(`${it.sel}${it.layer}`);
        s.neutral[it.sel] = {
            elImg: strip(own?.get('background-image')) === 'none',
            elMask: strip(own?.get('mask')) === 'none',
            hiddenColor: !!own?.get('color'),
            layerImg: strip(lay?.get('background')) === 'none',
        };
        const before = `${it.sel}${it.layer}`;
        // Маска — от прошлой версии: при следующей записи станет фоном
        const img = urlOf(get(before, 'background')) || urlOf(get(before, 'background-image'))
            || urlOf(get(before, 'mask') || get(before, '-webkit-mask'));
        if (img) { s.glyphs[it.sel] = { img }; continue; }
        // Значок Font Awesome: код символа -> имя
        const m = get(before, 'content').match(/^["']\\([0-9a-f]{4,5})["']$/i);
        if (m && icons) {
            const found = icons.byCode.get(m[1].toLowerCase());
            if (found) s.glyphs[it.sel] = found.name;
        }
    }
    return s;
}

/* ============================================================
   CSS ИЗ СОСТОЯНИЯ
============================================================ */
const r2 = (n) => Math.round(n * 100) / 100;

/** Резиновый размер: min на телефоне, max на широком экране, между — плавно */
function fluid(min, max) {
    if (!min && !max) return '';
    const lo = Math.min(min || max, max || min);
    const hi = Math.max(min || max, max || min);
    if (lo === hi) return `${lo}px`;
    const slope = (hi - lo) / (VW_MAX - VW_MIN);
    const base = lo - slope * VW_MIN;
    return `clamp(${lo}px, ${r2(base)}px + ${r2(slope * 100)}vw, ${hi}px)`;
}

/** Адрес картинки для url("…"): кавычки и переводы строк экранируем */
const cssUrl = (u) => `url("${String(u).replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;

/* Какие свойства — «выключатели» старого значка темы. Хранится скрыто
   (не перечисляется), чтобы не попасть в список правил */
function neutralSet(rules) {
    if (!rules.__neutral) Object.defineProperty(rules, '__neutral', { value: new Set(), enumerable: false });
    return rules.__neutral;
}

/** Правила в виде { селектор: { свойство: значение } }; '' — убрать */
function buildRules(s) {
    const rules = {};
    const put = (sel, prop, val) => { (rules[sel] ||= {})[prop] = val; };

    put(SEL.bar, 'background-color', s.bg);
    put(SEL.bar, 'backdrop-filter', s.noBlur ? 'none' : '');
    put(SEL.bar, '-webkit-backdrop-filter', s.noBlur ? 'none' : '');
    put(SEL.bar, 'box-shadow', SHADOWS[s.shadow] || '');
    put(SEL.bar, 'border-bottom', '');   // «линия снизу» из прошлых версий — стираем
    put(SEL.bar, 'border', s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor || 'currentColor'}` : '');
    const rt = s.radiusTop, rb = s.radiusBottom;
    put(SEL.bar, 'border-radius', rt || rb
        ? (rt === rb ? `${rt}px` : `${rt}px ${rt}px ${rb}px ${rb}px`)
        : '');
    // Картинка фона. Непрозрачная — прямо на топ-баре (одна строка url).
    // Полупрозрачная — в слое ::before: у картинки фона нет своей
    // прозрачности, а opacity на самом топ-баре погасил бы и цвет фона.
    const layered = s.bgImg && s.bgOpacity < 100;
    const size = s.bgFit === 'repeat' ? 'auto' : s.bgFit;
    const rep_ = s.bgFit === 'repeat' ? 'repeat' : 'no-repeat';
    put(SEL.bar, 'background-image', s.bgImg && !layered ? cssUrl(s.bgImg) : '');
    put(SEL.bar, 'background-size', s.bgImg && !layered ? size : '');
    put(SEL.bar, 'background-position', s.bgImg && !layered ? 'center' : '');
    put(SEL.bar, 'background-repeat', s.bgImg && !layered ? rep_ : '');
    put(SEL.barImg, 'content', layered ? '""' : '');
    put(SEL.barImg, 'position', layered ? 'absolute' : '');
    put(SEL.barImg, 'inset', layered ? '0' : '');
    put(SEL.barImg, 'background', layered ? `${cssUrl(s.bgImg)} center / ${size} ${rep_}` : '');
    put(SEL.barImg, 'opacity', layered ? String(s.bgOpacity / 100) : '');
    put(SEL.barImg, 'border-radius', layered ? 'inherit' : '');
    put(SEL.barImg, 'pointer-events', layered ? 'none' : '');

    put(SEL.holder, 'gap', s.gap ? fluid(Math.max(2, Math.round(s.gap * 0.35)), s.gap) : '');

    put(SEL.icon, 'font-size', fluid(s.icMin, s.icMax));
    put(SEL.icon, 'color', s.icColor);
    put(SEL.active, 'color', s.icActive);
    // Непрозрачность значков закрытых панелей; при наведении — полная
    put(SEL.closed, 'opacity', s.closedOpacity ? String(s.closedOpacity / 100) : '');
    put(SEL.closedHover, 'opacity', s.closedOpacity ? '1' : '');
    put(SEL.active, 'opacity', '');
    put(SEL.lift, 'transform', '');
    put(SEL.icon, 'transition', s.icActive ? 'color 0.2s' : '');

    for (const it of barIcons({ all: true })) {
        const g = s.glyphs[it.sel];
        // Если тема рисует значок в ::after (приём font-size:0 + ::after),
        // пишем туда же — иначе замена в ::before была бы не видна
        const sel = `${it.sel}${it.layer}`;
        if (it.layer === '::after') {
            // размер и цвет у такого значка задаются на самом слое
            put(sel, 'font-size', fluid(s.icMin, s.icMax));
            put(sel, 'color', s.icColor);
        }
        const fa = typeof g === 'string' ? icons?.byName.get(g) : null;
        const img = g && typeof g === 'object' && g.img ? g : null;

        // Своим значком перекрываем то, чем тема рисовала старый
        const was = it.drawn || {};
        const had = s.neutral?.[it.sel] || {};
        const on = !!(fa || img);
        const neutral = (key) => on && (was[key] || had[key]);
        const nput = (selector, prop, val) => {
            put(selector, prop, val);
            if (val) neutralSet(rules).add(`${selector}|${prop}`);
        };
        nput(it.sel, 'background-image', neutral('elImg') ? 'none' : '');
        nput(it.sel, 'mask', neutral('elMask') ? 'none' : '');
        nput(it.sel, '-webkit-mask', neutral('elMask') ? 'none' : '');
        nput(it.sel, 'background-color', neutral('elMask') ? 'transparent' : '');
        nput(it.sel, 'color', neutral('hiddenColor') || neutral('elMask') ? (s.icColor || 'var(--SmartThemeBodyColor)') : '');

        put(sel, 'content', fa ? `"\\${fa.code}"` : img ? '""' : '');
        // Значки брендов — в своём шрифте. Для обычных ничего не нужно:
        // шрифт уже задан классом fa-solid у самого значка
        put(sel, 'font-family', fa?.brand ? '"Font Awesome 6 Brands"' : '');
        put(sel, 'font-weight', fa?.brand ? '400' : '');

        // Своя картинка: ровно тот же набор, что пишет инструмент «Картинка»
        // в окне редактора (роль «Значок»), чтобы оба пути давали один код.
        // Квадрат 1em — размер задаёт тот же font-size, что и у символа.
        put(sel, 'background', img
            ? `${cssUrl(img.img)} center / contain no-repeat`
            : (fa && (was.layerImg || had.layerImg) ? 'none' : ''));
        if (fa && (was.layerImg || had.layerImg)) neutralSet(rules).add(`${sel}|background`);
        put(sel, 'display', img ? 'inline-block' : '');
        put(sel, 'width', img ? '1em' : '');
        put(sel, 'height', img ? '1em' : '');
        put(sel, 'flex-shrink', img ? '0' : '');
        put(sel, 'vertical-align', img ? 'middle' : '');
        // Остатки маски из прошлой версии — стираем
        put(sel, 'background-color', '');
        put(sel, 'mask', '');
        put(sel, '-webkit-mask', '');
    }
    return rules;
}

/* ============================================================
   ПРЕДПРОСМОТР
   Раньше на каждое движение ползунка переписывался <style> в <head> —
   браузер перечитывал таблицу стилей и пересчитывал ВСЮ страницу
   таверны. Теперь значения ставятся прямо на сам топ-бар и его значки:
   пересчитываются только они, это десяток элементов. И не чаще одного
   раза за кадр.
============================================================ */
const inlineSet = new Map();   // элемент -> свойства, которые мы поставили
let layerStyle = null;
let previewRaf = 0;

function setInline(el, prop, val) {
    if (!el) return;
    if (val) {
        el.style.setProperty(prop, val, 'important');
        if (!inlineSet.has(el)) inlineSet.set(el, new Set());
        inlineSet.get(el).add(prop);
    } else if (inlineSet.get(el)?.has(prop)) {
        el.style.removeProperty(prop);
        inlineSet.get(el).delete(prop);
    }
}

function applyInline() {
    previewRaf = 0;
    const rules = buildRules(state);
    const bar = document.querySelector(SEL.bar);
    const holder = document.querySelector(SEL.holder);
    for (const [p, v] of Object.entries(rules[SEL.bar] || {})) setInline(bar, p, v);
    for (const [p, v] of Object.entries(rules[SEL.holder] || {})) setInline(holder, p, v);
    // Слой картинки ::before инлайном не достать — маленький стиль только
    // с этим правилом (браузер пересчитает один топ-бар, а не всю страницу)
    const layer = rules[SEL.barImg] || {};
    const layerCss = Object.entries(layer).filter(([, v]) => v).map(([p, v]) => `${p}:${v} !important`).join(';');
    if (layerCss || layerStyle) {
        if (!layerStyle) {
            layerStyle = document.createElement('style');
            layerStyle.id = 'vte-tb-layer-preview';
            document.head.appendChild(layerStyle);
        }
        const text = layerCss ? `${SEL.barImg}{${layerCss}}` : '';
        if (layerStyle.textContent !== text) layerStyle.textContent = text;
    }

    const ic = rules[SEL.icon] || {};
    for (const el of holder?.querySelectorAll('.drawer-icon') || []) {
        setInline(el, 'font-size', ic['font-size']);
        setInline(el, 'color', ic.color);
    }
}

function preview() {
    if (!previewRaf) previewRaf = requestAnimationFrame(applyInline);
}

function clearPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    for (const [el, props] of inlineSet) for (const p of props) el.style.removeProperty(p);
    inlineSet.clear();
    layerStyle?.remove();
    layerStyle = null;
}

async function commit() {
    const rules = buildRules(state);
    const neutral = neutralSet(rules);
    const list = Object.entries(rules).map(([selector, decls]) => ({
        selector,
        decls,
        neutral: Object.keys(decls).filter(p => neutral.has(`${selector}|${p}`)),
    }));
    // Запись может спросить, заменять ли правило темы, — ждём ответа
    const changed = await onApply?.(list);
    // Сначала записали в тему, потом сняли предпросмотр — без мигания
    clearPreview();
    renderIcons();
    if (changed === 'replaced') render();   // из темы что-то убрали — обновить список
    return changed;
}

/* ============================================================
   ДАННЫЕ ЗНАЧКОВ FONT AWESOME
============================================================ */
// Отдаём наружу: тем же списком и поиском пользуются «Пузыри»
export async function loadIcons() {
    if (icons) return icons;
    const mod = await import('./faIcons.js');
    const list = [];
    const byName = new Map();
    const byCode = new Map();
    for (const row of mod.ICON_DATA.split(';')) {
        const [name, code, style, terms] = row.split(':');
        const it = { name, code, brand: style === 'b', terms: terms ? terms.split(',') : [] };
        list.push(it);
        byName.set(name, it);
        byCode.set(code, it);
    }
    const cats = mod.CATEGORY_DATA.split('\n').map((line) => {
        const [label, names] = line.split('|');
        return { label, names: new Set(names.split(',')) };
    });
    icons = { list, byName, byCode, cats };
    return icons;
}

/* Русские слова для поиска -> английские слова Font Awesome */
const RU = {
    'сердц': 'heart', 'любов': 'heart', 'звезд': 'star', 'дом': 'house', 'настрой': 'gear,sliders,screwdriver-wrench',
    'шестер': 'gear', 'пользоват': 'user', 'человек': 'user', 'люди': 'users', 'персон': 'user,masks-theater',
    'книг': 'book', 'мир': 'globe,earth,book-atlas', 'карт': 'map', 'кист': 'brush,paintbrush', 'палитр': 'palette',
    'картин': 'image', 'фон': 'image,panorama', 'фото': 'camera,image', 'чат': 'comment,comments', 'сообщ': 'message,comment,envelope',
    'письм': 'envelope', 'луна': 'moon', 'солн': 'sun', 'облак': 'cloud', 'огон': 'fire', 'пламя': 'fire', 'кот': 'cat',
    'кошк': 'cat', 'собак': 'dog', 'лап': 'paw', 'цвет': 'seedling,spa,palette', 'корон': 'crown', 'ключ': 'key',
    'замок': 'lock', 'глаз': 'eye', 'музык': 'music', 'нот': 'music', 'игр': 'gamepad,dice', 'кубик': 'dice,cubes',
    'пазл': 'puzzle-piece', 'расшир': 'puzzle-piece,cubes', 'робот': 'robot', 'мозг': 'brain', 'маги': 'wand-magic,hat-wizard',
    'волшеб': 'wand-magic-sparkles,hat-wizard', 'искр': 'wand-magic-sparkles', 'призрак': 'ghost', 'череп': 'skull',
    'щит': 'shield', 'дракон': 'dragon', 'лист': 'leaf', 'дерев': 'tree', 'снег': 'snowflake', 'молни': 'bolt',
    'подар': 'gift', 'кофе': 'mug-hot', 'чай': 'mug-hot', 'торт': 'cake-candles', 'маск': 'mask,masks-theater',
    'театр': 'masks-theater', 'розет': 'plug', 'вилк': 'plug', 'подключ': 'plug,link', 'шрифт': 'font', 'текст': 'font,paragraph',
    'поиск': 'magnifying-glass', 'лупа': 'magnifying-glass', 'заклад': 'bookmark', 'флаг': 'flag', 'колок': 'bell',
    'час': 'clock', 'календ': 'calendar', 'телеф': 'phone,mobile', 'компьют': 'computer,laptop', 'код': 'code',
    'каранд': 'pencil', 'ручк': 'pen', 'перо': 'feather', 'радуг': 'rainbow', 'зонт': 'umbrella', 'звук': 'volume-high',
    'микроф': 'microphone', 'наушн': 'headphones', 'камер': 'camera', 'видео': 'video,film', 'кино': 'film',
    'ракет': 'rocket', 'самол': 'plane', 'машин': 'car', 'бант': 'ribbon', 'лент': 'ribbon', 'шляп': 'hat-cowboy,hat-wizard',
    'рубаш': 'shirt', 'одежд': 'shirt,vest', 'гардероб': 'shirt', 'ножн': 'scissors', 'магнит': 'magnet',
    'бабоч': 'feather', 'птиц': 'dove,crow', 'рыб': 'fish', 'паук': 'spider', 'смайл': 'face-smile', 'улыб': 'face-smile',
    'грус': 'face-sad-tear', 'смех': 'face-laugh', 'поцел': 'face-kiss', 'руч': 'hand', 'рук': 'hand', 'лайк': 'thumbs-up',
    'вниз': 'arrow-down', 'вверх': 'arrow-up', 'стрел': 'arrow-right', 'меню': 'bars', 'список': 'list',
    'папк': 'folder', 'файл': 'file', 'сохран': 'floppy-disk', 'загруз': 'download,upload', 'корзин': 'trash,basket-shopping',
    'удал': 'trash', 'плюс': 'plus', 'крест': 'xmark', 'галоч': 'check', 'инфо': 'circle-info', 'вопрос': 'question',
    'чаш': 'mug-hot', 'вин': 'wine-glass', 'свеч': 'candle-holder', 'зеркал': 'mirror', 'кристал': 'gem', 'алмаз': 'gem',
};

export function searchIcons(query, catIdx) {
    const all = icons.list;
    const cat = catIdx >= 0 ? icons.cats[catIdx] : null;
    const q = String(query || '').trim().toLowerCase();

    let words = [];
    if (q) {
        if (/[а-яё]/.test(q)) {
            for (const [ru, en] of Object.entries(RU)) {
                if (ru.startsWith(q.slice(0, ru.length)) && q.length >= Math.min(3, ru.length)) {
                    words.push(...en.split(','));
                }
            }
            if (!words.length) return [];
        } else {
            words = [q];
        }
    }

    return all.filter((it) => {
        if (cat && !cat.names.has(it.name)) return false;
        if (!words.length) return true;
        return words.some(w => it.name.includes(w) || it.terms.some(t => t.startsWith(w)));
    });
}

/* ============================================================
   ОКНО
============================================================ */
export async function showPanel() {
    onSnapshot?.();
    layerCache = new WeakMap();
    drawnCache = new WeakMap();
    try { await loadIcons(); } catch (e) { console.error('[VTE] значки', e); }
    state = readState();
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
    closeGlyphPicker();
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
            h('span.vte-title-ic', {}, [icon('fa-bars-staggered')]),
            h('span', { text: 'Топ-бар' }),
        ]),
        h('div.vte-header-btns', {}, [
            iconBtn('fa-window-minimize', 'Свернуть', () => panel.classList.toggle('vte-collapsed')),
            iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close'),
        ]),
    ]);
    els.body = h('div.vte-tb-body');
    panel = h('div#vte-topbar-panel.vte-panel.vte-tb-panel', {}, [header, els.body]);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
    makeResizable(panel, 'vte-topbar-size');
    ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
        panel.addEventListener(t, (e) => e.stopPropagation()));
}

/* ---------- элементы управления ---------- */
function section(title, children) {
    return h('div.vte-tb-section', {}, [h('div.vte-tb-section-title', { text: title }), ...children]);
}

function row(label, control, hint) {
    return h('div.vte-tb-row', { title: hint || '' }, [h('span.vte-tb-label', { text: label }), control]);
}

/** Ползунок: на движении — предпросмотр, на отпускании — запись */
function slider(key, min, max, unit, zeroText) {
    const out = h('span.vte-tb-val');
    const show = () => { out.textContent = state[key] ? `${state[key]}${unit}` : zeroText; };
    const input = h('input.vte-tb-range', {
        type: 'range', min: String(min), max: String(max), step: '1', value: String(state[key] || 0),
        on: {
            input: (e) => { state[key] = +e.target.value; show(); preview(); },
            change: () => commit(),
        },
    });
    show();
    return h('span.vte-tb-slider', {}, [input, out]);
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
        type: 'button',
        title: 'Выбрать цвет',
        on: {
            click: () => {
                if (!picker) return;
                const before = state[key];
                picker.open({
                    anchor: btn,
                    value: state[key] || '#ffffff',
                    allowGradient: false,
                    onChange: (v) => { state[key] = v; paint(); preview(); },
                    onCommit: (v) => { state[key] = v; paint(); commit(); },
                    onCancel: () => { state[key] = before; paint(); clearPreview(); },
                });
            },
        },
    }, [sw, txt]);
    const reset = iconBtn('fa-rotate-left', 'Как в теме', () => { state[key] = ''; paint(); commit(); }, 'vte-tb-mini');
    paint();
    return h('span.vte-tb-colorwrap', {}, [btn, reset]);
}

function check(key, label, hint) {
    const input = h('input', {
        type: 'checkbox', checked: !!state[key],
        on: { change: (e) => { state[key] = e.target.checked; commit(); } },
    });
    return h('label.vte-tb-check', { title: hint || '' }, [input, h('span', { text: label })]);
}

function select(key, options) {
    const sel = h('select.vte-tb-select', {
        on: { change: (e) => { state[key] = e.target.value; commit(); } },
    }, options.map(([v, t]) => h('option', { value: v, text: t })));
    sel.value = state[key];
    return sel;
}

let extOpen = false;          // раскрыт ли список значков расширений
let themeOpen = false;        // раскрыт ли список правил темы

/**
 * «Уже в теме»: правила самой темы, которые трогают топ-бар и его значки.
 * Клик — показать место в панели кода.
 */
function themeSection() {
    const list = onThemeRules?.() || [];
    if (!list.length) return null;

    const box = h('div.vte-tb-section.vte-tb-theme');
    box.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        title: 'Эти правила задала сама тема. Правки отсюда их перекрывают',
        on: { click: () => { themeOpen = !themeOpen; render(); } },
    }, [icon(themeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'правило' : 'правил'} для топ-бара` })]));

    if (themeOpen) {
        for (const r of list) {
            box.appendChild(h('button.vte-tb-rule', {
                type: 'button',
                title: 'Показать в коде',
                on: { click: () => onReveal?.(r.from, r.to) },
            }, [
                h('code.vte-tb-rule-sel', { text: r.selector }),
                h('span.vte-tb-rule-props', { text: r.props }),
            ]));
        }
        box.appendChild(h('div.vte-note', {
            text: 'Если меняешь то, что тема уже задала, редактор спросит: заменить прямо '
                + 'в теме (старая строка удалится) или добавить поверх в «Мои правки».',
        }));
    }
    return box;
}

function render() {
    const b = els.body;
    b.textContent = '';

    b.append(
        themeSection(),
        section('Фон', [
            row('Цвет', colorBtn('bg', 'как в теме')),
            row('Картинка фона', bgImageControl()),
            state.bgImg ? row('Размещение', select('bgFit', [['cover', 'заполнить'], ['contain', 'целиком'], ['repeat', 'плиткой']])) : null,
            state.bgImg ? row('Непрозрачность картинки', slider('bgOpacity', 5, 100, '%', '100%'),
                'Меньше 100% — картинка просвечивает, под ней виден цвет фона') : null,
            check('noBlur', 'Без размытия под топ-баром',
                'Размытие пересчитывается на каждом кадре прокрутки — без него заметно легче'),
            row('Тень', select('shadow', [['theme', 'как в теме'], ['light', 'лёгкая'], ['none', 'без тени']]),
                'У SillyTavern по умолчанию тень с размытием 20px'),
        ].filter(Boolean)),
        section('Форма', [
            linkedPair({
                title: 'Скругление', storeKey: 'vte-tb-link-radius', mode: 'equal',
                a: { key: 'radiusTop', label: 'Сверху', max: 30, zero: 'нет' },
                b: { key: 'radiusBottom', label: 'Снизу', max: 30, zero: 'нет' },
            }),
            row('Обводка', slider('borderWidth', 0, 4, 'px', 'нет'), 'Рамка вокруг всего топ-бара'),
            row('Цвет обводки', colorBtn('borderColor', 'как у текста')),
        ].filter(Boolean)),
        section('Значки', [
            row('Цвет', colorBtn('icColor', 'как в теме')),
            row('Наведение и открытые', colorBtn('icActive', 'как в теме')),
            linkedPair({
                title: 'Размер значков', storeKey: 'vte-tb-size-link', mode: 'ratio',
                a: { key: 'icMin', label: 'На телефоне', max: 32, zero: 'как в теме',
                     hint: 'На узком экране (360px). Между телефоном и ПК размер меняется плавно' },
                b: { key: 'icMax', label: 'На ПК', max: 44, zero: 'как в теме',
                     hint: 'На широком экране (1280px и больше)' },
            }),
            row('Промежуток', slider('gap', 0, 24, 'px', 'как в теме'),
                'На телефоне автоматически уже, чтобы значки влезли'),
            row('Непрозрачность закрытых', slider('closedOpacity', 0, 100, '%', 'как в теме'),
                'Значки панелей, которые сейчас закрыты. В SillyTavern они полупрозрачные (30%). '
                + 'Открытая панель и значок под курсором — всегда 100%'),
        ]),
        section('Замена значков', [iconList()]),
        h('div.vte-tb-foot', {}, [
            h('button.vte-btn', {
                type: 'button',
                on: { click: resetAll },
            }, [icon('fa-rotate-left'), h('span', { text: ' Вернуть топ-бар темы' })]),
            h('button.vte-btn', {
                type: 'button',
                title: 'Вернуть тему к тому виду, какой был при открытии этого окна — включая строки, заменённые прямо в теме',
                on: { click: () => { onRestore?.() ? say('Вернула как было при открытии окна') : say('Возвращать нечего'); render(); } },
            }, [icon('fa-clock-rotate-left'), h('span', { text: ' Как было до открытия' })]),
        ]),
    );
}

/**
 * Два ползунка со связкой. mode 'ratio' держит отношение (размеры значков),
 * 'equal' — одинаковое значение (скругление сверху и снизу).
 * Связку можно выключить в любой момент, выбор запоминается.
 */
function linkedPair({ title, storeKey, mode, a, b }) {
    let linked = (() => { try { return localStorage.getItem(storeKey) !== '0'; } catch { return true; } })();

    const mk = (o) => {
        const out = h('span.vte-tb-val');
        const input = h('input.vte-tb-range', { type: 'range', min: '0', max: String(o.max), step: '1' });
        const show = () => {
            input.value = String(state[o.key] || 0);
            out.textContent = state[o.key] ? `${state[o.key]}px` : o.zero;
        };
        show();
        return { ...o, input, show, row: row(o.label, h('span.vte-tb-slider', {}, [input, out]), o.hint) };
    };
    const A = mk(a);
    const B = mk(b);

    const ratio = () => (state[a.key] && state[b.key] ? state[b.key] / state[a.key] : 1.5);
    let k = ratio();

    const bind = (me, other, toOther) => {
        me.input.addEventListener('input', () => {
            state[me.key] = +me.input.value;
            if (linked) {
                const v = mode === 'equal' ? state[me.key] : Math.round(toOther(state[me.key]));
                state[other.key] = state[me.key] ? Math.max(0, Math.min(other.max, v)) : 0;
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
        type: 'button',
        title: 'Связать: меняешь один — второй подстраивается. Нажми ещё раз, чтобы разъединить',
        on: {
            click: () => {
                linked = !linked;
                try { localStorage.setItem(storeKey, linked ? '1' : '0'); } catch {}
                k = ratio();
                link.classList.toggle('active', linked);
                ic.className = `fa-solid ${linked ? 'fa-link' : 'fa-link-slash'}`;
                txt.textContent = linked ? ' связаны' : ' отдельно';
            },
        },
    }, [ic, txt]);

    return h('div.vte-tb-sizes', {}, [
        h('div.vte-tb-sizes-head', {}, [h('span.vte-tb-label', { text: title }), link]),
        A.row,
        B.row,
    ]);
}

/* ---------- картинка фона ---------- */
function bgImageControl() {
    const input = h('input.vte-input.vte-tb-url', {
        type: 'text', spellcheck: false,
        placeholder: 'https://… ссылка на картинку',
        value: state.bgImg.startsWith('data:') ? '' : state.bgImg,
    });
    const apply = () => {
        const v = input.value.trim();
        if (v && !safeImageUrl(v)) { say('Нужна ссылка http(s):// на картинку'); return; }
        state.bgImg = v;
        commit();
        render();
    };
    input.addEventListener('change', apply);
    const clear = state.bgImg
        ? iconBtn('fa-xmark', 'Убрать картинку', () => { state.bgImg = ''; commit(); render(); }, 'vte-tb-mini')
        : null;
    const note = state.bgImg.startsWith('data:')
        ? h('span.vte-tb-note', { text: `встроена, ${Math.round(state.bgImg.length / 1024)} КБ` })
        : null;
    return h('span.vte-tb-urlwrap', {}, [note || input, clear]);
}

function iconList() {
    els.iconList = h('div.vte-tb-icons');
    renderIcons();
    return els.iconList;
}

/**
 * Что значок показывает на самом деле — с учётом темы. Читаем готовый
 * результат браузера в том слое, где тема рисует значок: символ шрифта
 * или картинку. Раньше в списке рисовались стандартные значки ST, даже
 * если тема давно заменила их своими.
 */
function currentGlyph(it) {
    try {
        const cs = getComputedStyle(it.el, it.layer);
        const url = urlOf(cs.backgroundImage);
        if (url) return { img: url };
        // Картинка или маска на самом значке
        const own = getComputedStyle(it.el);
        const mask = urlOf(own.maskImage || own.webkitMaskImage);
        if (mask) return { img: mask };
        const bg = urlOf(own.backgroundImage);
        if (bg && (isClear(own.color) || parseFloat(own.fontSize) === 0)) return { img: bg };
        const m = String(cs.content || '').match(/^["'](.)["']$/u);
        if (m) {
            const code = m[1].codePointAt(0).toString(16);
            const fa = icons?.byCode.get(code);
            if (fa) return { fa, brand: /Brands/i.test(cs.fontFamily) };
        }
    } catch {}
    return null;
}

function iconRow(it) {
    const g = state.glyphs[it.sel];
    const now = currentGlyph(it);

    let prev;
    if (now?.img) {
        prev = h('span.vte-tb-img-prev');
        prev.style.background = `${cssUrl(now.img)} center / contain no-repeat`;
    } else if (now?.fa) {
        prev = icon(`fa-${now.fa.name}`, now.brand || now.fa.brand ? 'fa-brands' : 'fa-solid');
    } else {
        prev = h('i', { className: it.el.className.split(/\s+/).filter(c => /^fa-/.test(c) && !/^fa-(fw|lg|xl)$/.test(c)).join(' ') });
    }

    // Места в коде темы, где меняется этот значок
    const places = onIconRules?.(it.el) || [];

    return h('div.vte-tb-icon', {}, [
        h('span.vte-tb-icon-prev', { title: now?.fa ? now.fa.name : '' }, [prev]),
        h('span.vte-tb-icon-label', { text: it.label, title: it.sel }),
        places.length
            ? h('button.vte-tb-code-btn', {
                type: 'button',
                title: 'Показать в коде темы все строки, которые меняют этот значок',
                on: { click: () => onRevealMany?.(places) },
            }, [icon('fa-code'), h('span', { text: ` ${places.length}` })])
            : null,
        it.isFa
            ? h('button.vte-btn.vte-tb-icon-btn', {
                type: 'button',
                on: { click: (e) => openGlyphPicker(it, e.currentTarget) },
            }, [h('span', { text: 'Сменить' })])
            : h('span.vte-note', { text: 'не Font Awesome' }),
        g ? iconBtn('fa-xmark', 'Убрать мою замену (останется значок темы)', () => {
            delete state.glyphs[it.sel];
            commit();
        }, 'vte-tb-mini') : null,
    ]);
}

function renderIcons() {
    const box = els.iconList;
    if (!box) return;
    box.textContent = '';
    const list = barIcons();
    if (!list.length) {
        box.appendChild(h('div.vte-note', { text: 'Значки топ-бара не найдены на странице.' }));
        return;
    }
    for (const it of list.filter(x => x.builtIn)) box.appendChild(iconRow(it));

    // Значки расширений есть не у всех — свёрнуты, чтобы не мешать
    const ext = list.filter(x => !x.builtIn);
    if (ext.length) {
        box.appendChild(h('button.vte-tb-ext-toggle', {
            type: 'button',
            on: { click: () => { extOpen = !extOpen; renderIcons(); } },
        }, [icon(extOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
            h('span', { text: ` Значки расширений (${ext.length})` })]));
        if (extOpen) for (const it of ext) box.appendChild(iconRow(it));
    }
}

/* ---------- картинки: ссылка, файл, код SVG ---------- */
function safeImageUrl(v) {
    const s = String(v || '').trim();
    if (/^https?:\/\/[^\s"'()<>\\]+$/i.test(s)) return s;
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(s) && s.length < 600000) return s;
    return '';
}

/** SVG-код -> компактный data:URL. Скрипты, комментарии и метаданные — вон */
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
    // Кодируем только то, что обязано быть закодировано: так короче base64
    const enc = svg.replace(/"/g, "'").replace(/[%#<>{}\n\r]/g, (c) => encodeURIComponent(c));
    return `data:image/svg+xml,${enc}`;
}

/* ---------- выбор значка ---------- */
let glyphPop = null;

function openGlyphPicker(it, anchor) {
    closeGlyphPicker();
    if (!icons) { say('Список значков не загрузился'); return; }

    let query = '';
    let cat = -1;
    let shown = 0;
    let found = [];

    const grid = h('div.vte-tb-grid');
    const count = h('span.vte-tb-count');
    const more = () => {
        const next = found.slice(shown, shown + 240);
        for (const ic of next) {
            grid.appendChild(h('button.vte-tb-glyph', {
                type: 'button',
                title: ic.name,
                on: {
                    click: () => {
                        state.glyphs[it.sel] = ic.name;
                        closeGlyphPicker();
                        commit();
                        say(`«${it.label}»: ${ic.name}`);
                    },
                },
            }, [icon(`fa-${ic.name}`, ic.brand ? 'fa-brands' : 'fa-solid')]));
        }
        shown += next.length;
    };
    const run = () => {
        found = searchIcons(query, cat);
        grid.textContent = '';
        shown = 0;
        count.textContent = `${found.length}`;
        more();
        grid.scrollTop = 0;
    };

    // Отрисовываем порциями по мере прокрутки: 1800 значков сразу —
    // лишние тысячи элементов в DOM
    grid.addEventListener('scroll', () => {
        if (shown < found.length && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 80) more();
    });

    const search = h('input.vte-input.vte-tb-search', {
        type: 'text', placeholder: 'Поиск: сердце, star, gear…', spellcheck: false,
        on: { input: (e) => { query = e.target.value; run(); } },
    });
    const cats = h('select.vte-tb-select', {
        on: { change: (e) => { cat = +e.target.value; run(); } },
    }, [h('option', { value: '-1', text: 'Все разделы' }),
        ...icons.cats.map((c, i) => h('option', { value: String(i), text: c.label }))]);

    const faPane = h('div.vte-tb-pane', {}, [h('div.vte-tb-pop-tools', {}, [search, cats, count]), grid]);
    const imgPane = imagePane(it);
    imgPane.style.display = 'none';

    const tab = (label, show) => h('button.vte-tb-tab', {
        type: 'button',
        on: {
            click: (e) => {
                glyphPop.querySelectorAll('.vte-tb-tab').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                faPane.style.display = show === 'fa' ? '' : 'none';
                imgPane.style.display = show === 'img' ? '' : 'none';
            },
        },
    }, [h('span', { text: label })]);
    const tabFa = tab('Font Awesome', 'fa');
    tabFa.classList.add('active');

    glyphPop = h('div.vte-tb-pop', {}, [
        h('div.vte-tb-pop-head', {}, [
            h('span', { text: `Значок: ${it.label}` }),
            iconBtn('fa-xmark', 'Закрыть', closeGlyphPicker, 'vte-tb-mini'),
        ]),
        h('div.vte-tb-tabs', {}, [tabFa, tab('Ссылка / SVG', 'img')]),
        faPane,
        imgPane,
    ]);
    panel.appendChild(glyphPop);
    run();
    setTimeout(() => search.focus(), 0);
}

/** Своя картинка для значка: ссылка или вставленный код SVG */
function imagePane(it) {
    const url = h('input.vte-input', { type: 'text', spellcheck: false, placeholder: 'https://… ссылка на .svg / .png / .webp' });
    const code = h('textarea.vte-input.vte-tb-svg', { spellcheck: false, placeholder: 'или вставьте код <svg>…</svg>', rows: 4 });

    const put = () => {
        let img = '';
        if (code.value.trim()) {
            img = svgToDataUrl(code.value);
            if (!img) { say('Это не похоже на код SVG'); return; }
            if (img.length > 20000) { say('SVG тяжелее 20 КБ — для значка это много'); return; }
        } else if (url.value.trim()) {
            img = safeImageUrl(url.value.trim());
            if (!img) { say('Нужна ссылка http(s):// на картинку'); return; }
        } else {
            say('Вставьте ссылку или код SVG');
            return;
        }
        state.glyphs[it.sel] = { img };
        closeGlyphPicker();
        commit();
        say(`«${it.label}»: своя картинка`);
    };

    return h('div.vte-tb-pane.vte-tb-imgpane', {}, [
        url,
        code,
        h('button.vte-btn.vte-btn-primary', { type: 'button', on: { click: put } },
            [icon('fa-check'), h('span', { text: ' Поставить' })]),
        h('div.vte-note', {
            text: 'Картинка встаёт на место значка и того же размера. Код такой же, как у '
                + 'инструмента «Картинка» в окне редактора, — один способ на всё расширение.',
        }),
    ]);
}

function closeGlyphPicker() {
    glyphPop?.remove();
    glyphPop = null;
}

function resetAll() {
    state = defaults();
    commit();
    render();
    say('Топ-бар снова как в теме');
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
