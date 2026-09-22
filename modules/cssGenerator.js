// modules/cssGenerator.js
// Парсинг, поиск CSS-переменных и безопасная перезапись пользовательского CSS.
// Полностью тема-независим: карта переменных строится из самого CSS в рантайме.
import * as cssIndex from './cssRules.js';

// Метки блока правок — одни на всё расширение, живут в cssRules.js
const MARKER_START = cssIndex.AUTO_START;
const MARKER_END   = cssIndex.AUTO_END;

// Свойства, для которых имеет смысл искать переменную по имени
// Свойства, для которых имеет смысл искать переменную по имени.
// Подсказки специально сделаны длинными: короткое 'font' совпадало
// с --mainFontSize и ломало размеры интерфейса.
const VAR_NAME_HINTS = {
    'background-color': ['bg', 'background', 'tint', 'fill', 'surface', 'panel'],
    'color':            ['text', 'fg', 'foreground', 'font-color', 'fontcolor', 'bodycolor'],
    'border-color':     ['border', 'outline', 'stroke'],
    'font-family':      ['font-family', 'fontfamily', 'fontface', 'font-face', 'typeface', 'family'],
    'font-size':        ['font-size', 'fontsize', 'mainfontsize', 'fontscale'],
    'border-radius':    ['radius', 'rounded', 'corner'],
    'box-shadow':       ['boxshadow', 'box-shadow'],
    'text-shadow':      ['textshadow', 'text-shadow'],
    'opacity':          ['opacity', 'alpha'],
    'backdrop-filter':  ['blurstrength', 'blur'],
    'filter':           ['blurstrength', 'blur', 'filter'],
};

// Если имя переменной содержит одно из этих слов — она НЕ подходит
// для данного свойства, даже если подсказка совпала.
const VAR_NAME_DENY = {
    'font-family':      ['size', 'scale', 'weight', 'height', 'spacing', 'color', 'shadow', 'width'],
    'font-size':        ['family', 'face', 'color', 'weight', 'shadow'],
    'color':            ['bg', 'background', 'border', 'shadow', 'tint', 'size', 'width', 'radius', 'family'],
    'background-color': ['text', 'border', 'font', 'size', 'width', 'radius', 'shadow'],
    'border-color':     ['background', 'text', 'font', 'size', 'width', 'radius', 'shadow', 'tint'],
    'border-radius':    ['color', 'font', 'blur', 'shadow', 'family'],
    'box-shadow':       ['color', 'font', 'size', 'width', 'family'],
    'text-shadow':      ['color', 'font', 'size', 'family'],
    'opacity':          ['color', 'font', 'size', 'family'],
    'backdrop-filter':  ['color', 'font', 'size', 'family'],
    'filter':           ['color', 'font', 'size', 'family'],
};

// Системные переменные SillyTavern: в них можно писать ТОЛЬКО перечисленные
// свойства. Любая другая запись сломает вёрстку топбара и иконок.
const VAR_PROPERTY_LOCK = {
    '--mainfontsize':      ['font-size'],
    '--fontscale':         ['font-size'],
    '--blurstrength':      ['backdrop-filter', 'filter'],
    '--shadowwidth':       ['text-shadow'],
    '--topbarblocksize':   ['height', 'min-height'],
    '--avatar-base-width': ['width'],
    '--avatar-base-height':['height'],
};

let state = {
    rootVars: new Map(),      // name -> value (без --)
    varUsage: new Map(),      // varName -> [{ selector, property }]
    parsedRules: [],          // [{ selector, decls: Map }]
};

export function init() {
    state = { rootVars: new Map(), varUsage: new Map(), parsedRules: [] };
    idxCache.clear();
}

/* ---------- Кеш разобранного CSS ----------
   Индекс строился заново в parse, findThemeRule, findEditSpot и
   parseAutoBody. Одно движение ползунка при включённой правке на месте
   давало четыре полных разбора темы подряд.

   Ключ — сам текст, поэтому кеш не может отдать устаревший результат.
   Держим несколько записей: за один шаг записи разбирается и полный
   текст темы, и тело авто-блока отдельно, и оба нужны ещё раз. */
const idxCache = new Map();

function indexFor(css) {
    const src = String(css || '');
    if (idxCache.has(src)) return idxCache.get(src);

    let idx = null;
    try { idx = cssIndex.buildIndex(src); } catch { idx = null; }

    if (idxCache.size >= 4) idxCache.delete(idxCache.keys().next().value);
    idxCache.set(src, idx);
    return idx;
}

/* ============================================================
   ГЕНЕРАЦИЯ СЕЛЕКТОРА ДЛЯ ЭЛЕМЕНТА
============================================================ */
export function generateSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el === document.body) return 'body';
    if (el === document.documentElement) return 'html';

    // 1. Стабильный id — самый надёжный вариант
    if (el.id && isStableToken(el.id)) {
        return `#${cssEscape(el.id)}`;
    }

    // 2. Известные структурные паттерны SillyTavern
    const st = stPattern(el);
    if (st) return st;

    // 3. Классы: берём осмысленные, отбрасываем служебные и рантайм-мусор
    const classes = usefulClasses(el);
    if (classes.length) {
        let sel = '.' + classes.map(cssEscape).join('.');
        if (selWidth(sel) <= 40) {
            const scoped = scopeWithAncestor(el, sel);
            return scoped || sel;
        }
    }

    // 4. Фолбэк: путь от ближайшего id-родителя
    return pathFromIdAncestor(el);
}

function stPattern(el) {
    const mes = el.closest('.mes');
    if (!mes) return null;

    const isUser = mes.getAttribute('is_user') === 'true';
    const role = isUser ? '.mes[is_user="true"]' : '.mes[is_user="false"]';

    // Сам пузырь сообщения
    if (el.classList.contains('mes')) return role;

    const map = [
        ['mes_block', ' .mes_block'],
        ['mes_text', ' .mes_text'],
        ['mesAvatarWrapper', ' .mesAvatarWrapper'],
        ['avatar', ' .mesAvatarWrapper .avatar'],
        ['ch_name', ' .ch_name'],
        ['name_text', ' .ch_name .name_text'],
        ['mes_buttons', ' .mes_buttons'],
        ['mesIDDisplay', ' .mesIDDisplay'],
        ['tokenCounterDisplay', ' .tokenCounterDisplay'],
        ['mes_timer', ' .mes_timer'],
        ['mes_reasoning', ' .mes_reasoning'],
        ['mes_reasoning_header', ' .mes_reasoning_header'],
    ];

    for (const [cls, suffix] of map) {
        if (el.classList.contains(cls)) return role + suffix;
    }

    if (el.tagName === 'IMG' && el.closest('.avatar')) {
        return role + ' .mesAvatarWrapper .avatar img';
    }

    // Инлайн-разметка внутри текста
    const inline = { EM: 'em', I: 'i', STRONG: 'strong', B: 'b', Q: 'q', CODE: 'code', HR: 'hr', P: 'p' };
    if (inline[el.tagName] && el.closest('.mes_text')) {
        return `.mes_text ${inline[el.tagName]}`;
    }

    return null;
}

function usefulClasses(el) {
    const banned = /^(ui-|jq|select2|swiper|ng-|is-|has-|active|selected|open|closed|hidden|shown|show|dragging|animated|fa-|interactable|last_mes|vte-|aa-|ag-)/i;
    return Array.from(el.classList)
        .filter(c => c && !banned.test(c) && !/^\d/.test(c) && c.length > 1)
        .slice(0, 3);
}

function scopeWithAncestor(el, sel) {
    let p = el.parentElement;
    let depth = 0;
    while (p && depth < 5) {
        if (p.id && isStableToken(p.id)) {
            const scoped = `#${cssEscape(p.id)} ${sel}`;
            // Раньше здесь было два обращения к DOM на каждый уровень:
            // querySelector ради проверки «это ровно наш элемент» и
            // querySelectorAll ради количества. Первое избыточно: p —
            // предок el, а sel в el попадает, значит попадает и составной.
            const hits = selWidth(scoped);
            if (hits >= 1 && hits <= 20) return scoped;
        }
        p = p.parentElement;
        depth++;
    }
    return null;
}

function pathFromIdAncestor(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
        if (cur.id && isStableToken(cur.id)) {
            parts.unshift(`#${cssEscape(cur.id)}`);
            break;
        }
        const cls = usefulClasses(cur);
        let part = cur.tagName.toLowerCase();
        if (cls.length) part += '.' + cls.map(cssEscape).join('.');
        else {
            const idx = Array.from(cur.parentElement?.children || [])
                .filter(c => c.tagName === cur.tagName).indexOf(cur);
            if (idx > 0) part += `:nth-of-type(${idx + 1})`;
        }
        parts.unshift(part);
        cur = cur.parentElement;
        if (cur === document.body) { parts.unshift('body'); break; }
    }
    return parts.join(' > ').replace(/ > /g, ' ');
}

function isStableToken(v) {
    // Отбрасываем сгенерированные id вида x123456, uid-..., :r1:
    return /^[a-z][\w-]{1,60}$/i.test(v) && !/^\w{0,3}\d{4,}$/.test(v);
}

/* ---------- Сколько элементов задевает селектор ----------
   Спрашивается для каждого предка и для каждого набора классов, а
   generateSelector вызывается трижды за клик — по одному разу на
   ::before, ::after и сам элемент. Раньше каждый вопрос был полным
   обходом документа.

   Живёт полсекунды: за это время разметка не успевает измениться. */
let widthCache = new Map();
let widthCacheAt = 0;

function selWidth(sel) {
    const key = String(sel || '').trim();
    if (!key) return 0;

    const now = Date.now();
    if (now - widthCacheAt > 500) {
        widthCache.clear();
        widthCacheAt = now;
    }
    if (widthCache.has(key)) return widthCache.get(key);

    let n = 0;
    try { n = document.querySelectorAll(key).length; } catch { n = 0; }

    widthCache.set(key, n);
    return n;
}

function cssEscape(v) {
    if (window.CSS?.escape) return CSS.escape(v);
    return String(v).replace(/([^\w-])/g, '\\$1');
}

/**
 * Разбор CSS: карта переменных и места их использования.
 *
 * Раньше здесь стояли две регулярки — свой, третий по счёту парсер CSS
 * в проекте. Обе спотыкались об одно и то же: `[^}]*` останавливается на
 * ПЕРВОЙ закрывающей скобке. Правило, вложенное внутрь :root (CSS Nesting),
 * обрывало разбор на середине, и часть переменных темы просто не находилась.
 * Плюс регулярка не понимала @media и комментарии с кодом внутри.
 *
 * Теперь работаем на том же индексе, что и весь остальной модуль: он
 * посимвольный, знает про вложенность, строки, комментарии и @media.
 */
export function parse(css) {
    state.rootVars.clear();
    state.varUsage.clear();
    state.parsedRules = [];

    const index = indexFor(css || '');

    if (index) {
        for (const rule of index.rules) {
            // Источником переменных считаем ТОЛЬКО настоящий :root.
            // Сравнение точное, не по началу строки: у вложенного правила
            // effectiveSelector тоже начинается на ':root', и селектор вида
            // ':root .mes .mes_text p' по ошибке попадал бы в источники.
            const isRootRule = rule.parts.some(p => {
                const s = normSel(p.raw).toLowerCase();
                return s === ':root' || s === 'html' || s === ':root:root';
            });

            const selector = normSel(rule.effectiveSelector || rule.selectorRaw);

            for (const d of rule.decls) {
                // Последнее объявление побеждает, как в самом CSS:
                // правила идут в порядке текста, Map перезаписывает значение
                if (d.prop.startsWith('--') && isRootRule) {
                    state.rootVars.set(d.prop, d.value);
                }

                const varRe = /var\(\s*(--[\w-]+)/g;
                let vm;
                while ((vm = varRe.exec(d.value)) !== null) {
                    if (!state.varUsage.has(vm[1])) state.varUsage.set(vm[1], []);
                    state.varUsage.get(vm[1]).push({ selector, property: d.prop });
                }
            }
        }
    }

    // Переменные из живого DOM (SmartTheme* и всё, что задал сам ST)
    collectLiveVars();

    return {
        vars: new Map(state.rootVars),
        usage: new Map(state.varUsage),
        rules: index ? index.rules.length : 0,
    };
}

function collectLiveVars() {
    try {
        const cs = getComputedStyle(document.documentElement);
        // computedStyleMap недоступен везде — перебираем известные префиксы ST
        const known = [
            '--SmartThemeBodyColor', '--SmartThemeEmColor', '--SmartThemeUnderlineColor',
            '--SmartThemeQuoteColor', '--SmartThemeBlurTintColor', '--SmartThemeChatTintColor',
            '--SmartThemeUserMesBlurTintColor', '--SmartThemeBotMesBlurTintColor',
            '--SmartThemeShadowColor', '--SmartThemeBorderColor',
            '--mainFontSize', '--blurStrength', '--shadowWidth',
        ];
        for (const name of known) {
            const v = cs.getPropertyValue(name).trim();
            if (v && !state.rootVars.has(name)) {
                state.rootVars.set(name, v);
            }
        }
    } catch {}
}

/* Имена переменных, объявленных где-либо в стилях страницы (кроме темы).
   Список обновляется, если число таблиц стилей поменялось, и не чаще раза в 5 с */
let pageVarsCache = null;
let pageVarsAt = 0;
let pageVarsSheets = -1;

function pageVarNames() {
    if (typeof document === 'undefined') return [];
    const n = document.styleSheets.length;
    if (pageVarsCache && n === pageVarsSheets && Date.now() - pageVarsAt < 5000) return pageVarsCache;
    const names = new Set();
    const walk = (list) => {
        for (const r of Array.from(list || [])) {
            if (r.style) {
                for (let i = 0; i < r.style.length; i++) {
                    const p = r.style[i];
                    if (p.startsWith('--')) names.add(p);
                }
            }
            if (r.cssRules) walk(r.cssRules);
        }
    };
    for (const sh of Array.from(document.styleSheets)) {
        if (sh.ownerNode?.id === 'custom-style') continue;   // тему проверяем по её тексту
        try { walk(sh.cssRules); } catch {}
    }
    for (const el of [document.documentElement, document.body]) {
        for (let i = 0; i < (el?.style.length || 0); i++) {
            if (el.style[i].startsWith('--')) names.add(el.style[i]);
        }
    }
    pageVarsCache = names;
    pageVarsAt = Date.now();
    pageVarsSheets = n;
    return names;
}

function parseDecls(body) {
    const out = new Map();
    // Разбиваем по ; с учётом вложенных скобок (градиенты, shadow, url)
    let depth = 0, buf = '';
    const chunks = [];
    for (const ch of body) {
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ';' && depth === 0) { chunks.push(buf); buf = ''; continue; }
        buf += ch;
    }
    if (buf.trim()) chunks.push(buf);

    for (const chunk of chunks) {
        const i = chunk.indexOf(':');
        if (i < 1) continue;
        const name = chunk.slice(0, i).trim();
        const value = chunk.slice(i + 1).trim();
        if (name && value) out.set(name, value);
    }
    return out;
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ============================================================
   ПОИСК ПОДХОДЯЩЕЙ ПЕРЕМЕННОЙ
============================================================ */

// Селекторы, для которых можно менять глобальные переменные темы.
// Для всех остальных элементов переменные не трогаем: иначе правка
// одного сообщения меняет размер шрифта во всём интерфейсе.
const GLOBAL_SELECTORS = [':root', 'html', 'body', '*', 'html, body', 'body, html'];

function isGlobalSelector(selector) {
    const parts = String(selector || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
    if (!parts.length) return false;
    return parts.every(p => GLOBAL_SELECTORS.includes(p));
}

export function findVariable(selector, property, currentValue) {
    if (property.startsWith('--')) return { name: property, source: 'direct' };

    const global = isGlobalSelector(selector);
    const typeOk = valueTypeChecker(property);
    const known = (name) => state.rootVars.get(name);

    // Переменная годится, если она не заблокирована для этого свойства
    // и её текущее значение того же типа, что записываемое свойство.
    const usable = (name, checkNameDeny) => {
        if (isVarLocked(name, property)) return false;
        if (checkNameDeny && isVarDenied(name, property)) return false;
        const v = known(name);
        if (v != null && !typeOk(v)) return false;
        return true;
    };

    // Переменная «принадлежит» выбранному элементу только если ВСЕ места
    // её использования совпадают с этим селектором. Иначе запись в неё
    // затронет другие части интерфейса.
    const usedOnlyHere = (name) => {
        const uses = state.varUsage.get(name) || [];
        if (!uses.length) return false;
        return uses.every(u => selectorsMatch(u.selector, selector));
    };

    // 1. Точное совпадение selector + property
    for (const [name, uses] of state.varUsage) {
        if (!usable(name, false)) continue;
        if (!uses.some(u => u.property === property && selectorsMatch(u.selector, selector))) continue;
        if (!global && !usedOnlyHere(name)) continue;
        return { name, value: known(name), source: 'exact' };
    }

    // Дальше идут «догадки». Для конкретного элемента они запрещены:
    // пишем обычное правило в авто-блок — это всегда безопасно.
    if (!global) return null;

    // 2. Тот же элемент, но правило описано другим селектором
    const base = baseToken(selector);
    if (base) {
        for (const [name, uses] of state.varUsage) {
            if (!usable(name, true)) continue;
            if (uses.some(u => u.property === property && u.selector.includes(base))) {
                return { name, value: known(name), source: 'related' };
            }
        }
    }

    // 3. По имени и совместимости типа значения
    const hints = VAR_NAME_HINTS[property];
    if (!hints) return null;

    let best = null;
    for (const [name, value] of state.rootVars) {
        const lower = name.toLowerCase();
        const hit = hints.find(x => lower.includes(x));
        if (hit === undefined) continue;
        if (!usable(name, true)) continue;
        if (!typeOk(value)) continue;

        const score = hints.indexOf(hit) * 10
            + (base && lower.includes(base.replace(/[.#\[\]"=]/g, '')) ? -25 : 0)
            + name.length * 0.1;

        if (!best || score < best.score) best = { name, value, score, source: 'name' };
    }

    return best ? { name: best.name, value: best.value, source: best.source } : null;
}


function isVarDenied(name, property) {
    const bad = VAR_NAME_DENY[property];
    if (!bad) return false;
    const lower = name.toLowerCase();
    return bad.some(x => lower.includes(x));
}

function isVarLocked(name, property) {
    const allow = VAR_PROPERTY_LOCK[name.toLowerCase()];
    if (!allow) return false;
    return !allow.includes(property);
}

function selectorsMatch(a, b) {
    const norm = (s) => s.split(',').map(x => x.trim().replace(/\s+/g, ' '));
    const A = norm(a), B = norm(b);
    return A.some(x => B.includes(x));
}

function baseToken(selector) {
    const m = selector.match(/[#.][\w-]+/);
    return m ? m[0] : null;
}

function valueTypeChecker(property) {
    const str = (v) => String(v ?? '').trim();

    const isColor = (v) =>
        /^(#|rgba?\(|hsla?\(|hwb\(|lab\(|lch\(|oklch\(|oklab\(|[a-z]+$)/i.test(str(v));

    const isLength = (v) =>
        /^-?[\d.]+(px|em|rem|vw|vh|vmin|vmax|%|pt|ch|ex)$/i.test(str(v))
        || /calc\(/i.test(str(v));

    if (/color$/i.test(property) || property === 'color') return isColor;

    if (property === 'font-family') {
        return (v) => {
            const s = str(v);
            if (!s) return false;
            if (/^-?[\d.]/.test(s)) return false;                    // 15px, 1.2 — это не шрифт
            if (/calc\(|var\(/i.test(s)) return false;
            if (/^(#|rgba?\(|hsla?\()/i.test(s)) return false;
            if (/^(none|unset|inherit|initial|normal|bold)$/i.test(s)) return false;
            return /[a-z]/i.test(s);
        };
    }

    if (property === 'font-size') {
        return (v) => /^-?[\d.]+(px|em|rem|pt|%)$/i.test(str(v)) || /calc\(/i.test(str(v));
    }

    if (property === 'font-weight') {
        return (v) => /^(\d{3}|normal|bold|lighter|bolder)$/i.test(str(v));
    }

    if (property === 'box-shadow' || property === 'text-shadow') {
        return (v) => /px/i.test(str(v)) && /(rgba?\(|hsla?\(|#[0-9a-f]{3,8})/i.test(str(v));
    }

    if (property === 'opacity') {
        // Панель отдаёт значение как (n/100).toFixed(2), то есть «1.00» и «0.00».
        // Старая проверка /^(0|1|0?\.\d+)$/ отбрасывала «1.00» и проценты,
        // и подходящая переменная считалась негодной.
        return (v) => /^(?:0|1|0?\.\d+|1\.0+|\d{1,3}%)$/.test(str(v));
    }

    if (/(radius|width|height|size|spacing|indent|top|left|right|bottom|gap)/i.test(property)) {
        return isLength;
    }

    return () => true;
}

/* ============================================================
   ЗАПИСЬ ИЗМЕНЕНИЙ
============================================================ */
export function updateRule(css, selector, property, value, opts = {}) {
    let out = css || '';

    if (property === '__reset__') {
        return removeFromAutoBlock(out, selector);
    }

    const empty = value === '' || value === 'unset' || value == null;

    // Пустое значение означает «убрать правку». В переменную темы пустоту
    // писать нельзя: получалось `--var: ;` или `--var: unset;`, и переменная
    // умирала сразу во всём интерфейсе. Такие случаи идут в авто-блок,
    // где upsertAutoBlock просто удаляет строку.
    if (opts.useVariables !== false && !empty) {
        const found = findVariable(selector, property, value);
        if (found?.name && !isInlineVar(found.name)) {
            const updated = setRootVariable(out, found.name, value);
            if (updated !== out) {
                state.rootVars.set(found.name, value);
                return updated;
            }
        }
    }

    // Экспериментально: менять значение прямо в правиле темы,
    // вместо того чтобы дублировать его в авто-блоке.
    if (opts.editInPlace) {
        const edited = editInPlace(out, selector, property, value);
        if (edited != null) return edited;
    }

    return setDeclaration(out, selector, property, value, opts);
}

/**
 * SillyTavern задаёт часть переменных темы прямо в атрибуте style у <html>
 * через documentElement.style.setProperty. Инлайновый стиль сильнее любого
 * правила :root в таблице стилей, поэтому наша запись в такую переменную
 * видна только в слое предпросмотра и пропадает вместе с ним.
 * Такие переменные не трогаем — пишем обычное правило в авто-блок.
 */
function isInlineVar(name) {
    const clean = name.startsWith('--') ? name : `--${name}`;
    try {
        return document.documentElement.style.getPropertyValue(clean).trim() !== '';
    } catch {
        return false;
    }
}

/* ============================================================
   ПРАВКА СУЩЕСТВУЮЩЕГО ПРАВИЛА ТЕМЫ
============================================================ */
function normSel(v) {
    return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Ищет в теме правило, которое описывает РОВНО этот селектор.
 *
 * Правила со списком через запятую сознательно пропускаются: правка в них
 * задела бы все селекторы списка сразу. Такие случаи уходят в авто-блок,
 * где видно, что именно добавлено.
 */
function findThemeRule(css, selector) {
    const key = normSel(selector);
    if (!key) return null;

    const index = indexFor(css);
    if (!index) return null;

    let hit = null;
    for (const rule of index.rules) {
        if (rule.inAutoBlock) continue;
        if (!cssIndex.isContextActive(rule)) continue;   // @media, который сейчас не действует

        if (rule.parts.length === 1) {
            if (normSel(rule.parts[0].raw) !== key) continue;
        } else if (normSel(rule.effectiveSelector) !== key) {
            continue;
        }
        hit = rule;   // последнее правило в файле побеждает, как в самом CSS
    }
    return hit;
}

/** Куда пойдёт правка. Нужно для подсказки в панели. */
export function findEditSpot(css, selector, property) {
    const rule = findThemeRule(css, selector);
    if (!rule) return null;

    const decl = property ? cssIndex.findDeclaration(rule, property) : null;
    const pos = decl ? decl.start : rule.ruleStart;

    return {
        selector: rule.selectorRaw,
        line: String(css).slice(0, pos).split('\n').length,
        hasProperty: !!decl,
        inMedia: rule.conditions.length > 0,
    };
}

function editInPlace(css, selector, property, value) {
    const rule = findThemeRule(css, selector);
    if (!rule) return null;

    const decl = cssIndex.findDeclaration(rule, property);
    const empty = value === '' || value === 'unset' || value == null;

    if (decl) {
        if (empty) return cssIndex.removeDeclaration(css, decl);
        // !important сохраняем таким, каким его написал автор темы
        return cssIndex.replaceDeclarationValue(css, decl, value, {
            important: decl.important,
        });
    }

    if (empty) return null;

    // Нового свойства ещё нет — дописываем в конец правила,
    // с той же важностью, что у соседних строк
    const important = rule.decls.some(d => d.important);
    return cssIndex.insertDeclaration(css, rule, property, value, { important });
}


/** Меняет значение переменной в существующем :root, иначе создаёт :root в авто-блоке */
export function setRootVariable(css, name, value) {
    const clean = name.startsWith('--') ? name : `--${name}`;
    const re = new RegExp(
        `(:root[^{}]*\\{[^}]*?)(\\s*${escapeRe(clean)}\\s*:)([^;}]*)(;?)`,
        'gi'
    );

    // В CSS побеждает ПОСЛЕДНЕЕ объявление. Раньше правился первый найденный
    // :root, а второй продолжал перекрывать его — правка выглядела так, будто
    // не сработала вообще. Темы с несколькими секциями :root ломались об это.
    let last = null;
    let m;
    while ((m = re.exec(css)) !== null) {
        last = m;
        if (m.index === re.lastIndex) re.lastIndex++;
    }

    if (last) {
        const replacement = `${last[1]}${last[2]} ${value}${last[4] || ';'}`;
        return css.slice(0, last.index)
            + replacement
            + css.slice(last.index + last[0].length);
    }

    // Переменной нет — добавляем в авто-блок
    return upsertAutoBlock(css, ':root', clean, value);
}

/** Пишет обычное объявление в авто-блок (не трогая ручной CSS темы) */
export function setDeclaration(css, selector, property, value, opts = {}) {
    return upsertAutoBlock(css, selector, property, value, opts);
}

/**
 * Записать сразу пачку объявлений.
 *
 * Раньше вызывающая сторона гоняла updateRule по одному свойству, а внутри
 * каждый вызов заново разбирал авто-блок, менял одну ячейку и собирал блок
 * обратно, после чего склеивал весь текст CSS. На одном нажатии «Применить»
 * во вкладке «Картинка» это давало больше двадцати полных проходов.
 *
 * Теперь всё, что идёт в авто-блок, накапливается и пишется за один разбор.
 * Записи в переменные темы и правки на месте по-прежнему выполняются по
 * очереди: они меняют исходный текст, а значит сдвигают позиции, и работать
 * с ними пачкой нельзя.
 *
 * @param entries [{ selector, property, value, useVariables, editInPlace, important }]
 */
export function updateRules(css, entries) {
    let out = css || '';

    // Группируем по типу записи
    const varWrites = [];
    const inPlaceWrites = [];
    const autoWrites = [];

    for (const e of entries || []) {
        if (!e || !e.selector || !e.property) continue;

        if (e.property === '__reset__') {
            out = removeFromAutoBlock(out, e.selector);
            continue;
        }

        const empty = e.value === '' || e.value === 'unset' || e.value == null;

        // Определяем, куда пойдёт запись
        if (e.useVariables !== false && !empty) {
            const found = findVariable(e.selector, e.property, e.value);
            if (found?.name && !isInlineVar(found.name)) {
                varWrites.push({ ...e, varName: found.name });
                continue;
            }
        }

        if (e.editInPlace) {
            inPlaceWrites.push(e);
            continue;
        }

        autoWrites.push(e);
    }

    // 1. Переменные (последовательно, каждая меняет текст)
    for (const e of varWrites) {
        const updated = setRootVariable(out, e.varName, e.value);
        if (updated !== out) {
            state.rootVars.set(e.varName, e.value);
            out = updated;
        }
    }

    // 2. Правки на месте (последовательно, каждая меняет текст)
    for (const e of inPlaceWrites) {
        const edited = editInPlace(out, e.selector, e.property, e.value);
        if (edited != null) {
            out = edited;
        } else {
            // Не получилось на месте — уходит в авто-блок
            autoWrites.push(e);
        }
    }

    // 3. Авто-блок (одной пачкой)
    if (autoWrites.length) {
        const batch = autoWrites.map(e => ({
            selector: e.selector,
            property: e.property,
            value: e.value,
            important: e.important !== false,
            media: e.media || '',
        }));
        out = applyAutoBatch(out, batch);
    }

    return out;
}

/** Применяет пачку объявлений к авто-блоку: один разбор, одна сборка */
function applyAutoBatch(css, items) {
    const block = getAutoBlock(css);
    const rules = parseAutoBody(block ? block.body : '\n');

    for (const it of items) {
        const sel = String(it.selector).trim().replace(/\s+/g, ' ');
        if (!sel) continue;

        const key = makeKey(it.media || '', sel);
        const empty = it.value === '' || it.value === 'unset' || it.value == null;

        if (empty) {
            const decls = rules.get(key);
            if (decls) {
                decls.delete(it.property);
                if (!decls.size) rules.delete(key);
            }
            continue;
        }

        if (!rules.has(key)) rules.set(key, new Map());
        const needBang = sel === ':root' ? false : it.important !== false;
        rules.get(key).set(it.property,
            `${stripBang(it.value)}${needBang ? ' !important' : ''}`);
    }

    const newBody = serializeAutoBody(rules);
    const newBlock = newBody ? `${MARKER_START}\n${newBody}${MARKER_END}` : '';

    if (block) {
        const merged = css.slice(0, block.start) + newBlock + css.slice(block.end);
        // Схлопывать пустые строки можно только когда блок исчез целиком:
        // на всём тексте эта замена съела бы отступы в рукописном CSS
        return newBlock ? merged : merged.replace(/\n{3,}/g, '\n\n');
    }

    if (!newBlock) return css;
    return `${css.trimEnd()}\n\n${newBlock}\n`;
}


/** Правила блока «Мои правки»: Map(селектор -> Map(свойство -> значение)) */
export function autoRules(css) {
    const block = getAutoBlock(String(css || ''));
    return block ? parseAutoBody(block.body) : new Map();
}

/* ---------- Авто-блок: единственная зона, которую расширение переписывает ---------- */
function getAutoBlock(css) {
    const r = cssIndex.findAutoRange(css);
    if (!r) return null;
    return { start: r.start, end: r.end, body: css.slice(r.bodyStart, r.bodyEnd) };
}

/**
 * @param opts.important  true — дописать !important, false — не дописывать.
 *                        Не задано — считаем, что нужен: так ведёт себя
 *                        старый код, который решение не передаёт.
 *
 * Раньше !important ставился безусловно на всё, кроме :root. Это давало
 * стену из !important на каждую строку, но без этого правки просто не были
 * видны: перебить правило темы честной специфичностью было нельзя, потому
 * что специфичность считалась без учёта важности конкурента.
 */
function upsertAutoBlock(css, selector, property, value, opts = {}) {
    const block = getAutoBlock(css);
    let body = block ? block.body : '\n';

    const rules = parseAutoBody(body);
    const key = selector.trim().replace(/\s+/g, ' ');
    if (!rules.has(key)) rules.set(key, new Map());

    if (value === '' || value === 'unset' || value == null) {
        rules.get(key).delete(property);
        if (rules.get(key).size === 0) rules.delete(key);
    } else {
        const needBang = key === ':root' ? false : opts.important !== false;
        rules.get(key).set(property, `${stripBang(value)}${needBang ? ' !important' : ''}`);
    }

    const newBody = serializeAutoBody(rules);
    const newBlock = `${MARKER_START}\n${newBody}${MARKER_END}`;

    if (block) {
        return css.slice(0, block.start) + newBlock + css.slice(block.end);
    }
    return `${css.trimEnd()}\n\n${newBlock}\n`;
}

/* ============================================================
   ПЕРЕНОС ПРАВОК ГРУППЫ НА НОВЫЙ СОСТАВ
============================================================ */

/** Режет список селекторов по запятым верхнего уровня: :not(a, b) и
 *  [title="a, b"] остаются целыми */
function splitSelectorList(sel) {
    const out = [];
    let depth = 0, quote = '', buf = '';
    for (let i = 0; i < sel.length; i++) {
        const c = sel[i];
        if (quote) {
            buf += c;
            if (c === '\\') { buf += sel[++i] || ''; continue; }
            if (c === quote) quote = '';
            continue;
        }
        if (c === '"' || c === "'") { quote = c; buf += c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
        if (c === ',' && depth === 0) { out.push(normSel(buf)); buf = ''; continue; }
        buf += c;
    }
    if (normSel(buf)) out.push(normSel(buf));
    return out;
}

/**
 * Правило написано для группы? Тогда возвращает общий «хвост», который
 * дописан к каждому селектору группы: '' для самих элементов, '::after',
 * ':hover', ':hover::after' и т.п. Иначе null.
 */
function groupSuffix(parts, oldList, oldSet) {
    if (parts.length !== oldList.length) return null;
    const first = parts[0];
    const cands = oldList.filter(o => first.startsWith(o)).sort((a, b) => b.length - a.length);

    for (const o of cands) {
        const suffix = first.slice(o.length);
        // Хвост может быть только псевдоклассом или псевдоэлементом:
        // '.a' + 'b' или '.a' + '.b' — это уже другой селектор
        if (suffix && suffix[0] !== ':') continue;

        const bases = [];
        let ok = true;
        for (const p of parts) {
            if (!p.endsWith(suffix)) { ok = false; break; }
            bases.push(p.slice(0, p.length - suffix.length));
        }
        if (!ok) continue;

        const set = new Set(bases);
        if (set.size === oldSet.size && [...set].every(b => oldSet.has(b))) return suffix;
    }
    return null;
}

/**
 * Состав шаблона изменился: переписать правила авто-блока, сделанные для
 * старого списка, на новый. Работает для самих элементов, ::before/::after,
 * :hover и правил внутри @media.
 *
 * Пример: было '.a, .b { color: red }', в шаблон добавили .c —
 * станет '.a, .b, .c { color: red }', и новый элемент сразу получает
 * все правки группы.
 *
 * @returns {{ css: string, moved: number }}
 */
export function retargetGroup(css, oldParts, newParts) {
    const src = String(css || '');
    const block = getAutoBlock(src);
    const oldList = (oldParts || []).map(normSel).filter(Boolean);
    const newList = (newParts || []).map(normSel).filter(Boolean);
    if (!block || !oldList.length || !newList.length) return { css: src, moved: 0 };

    const oldSet = new Set(oldList);
    const rules = parseAutoBody(block.body);
    const next = new Map();
    let moved = 0;

    for (const [key, decls] of rules) {
        const { cond, sel } = splitKey(key);
        const suffix = groupSuffix(splitSelectorList(sel), oldList, oldSet);

        let k = key;
        if (suffix !== null) {
            k = makeKey(cond, newList.map(p => p + suffix).join(', '));
            moved++;
        }
        // Если такое правило уже есть — сливаем, групповые значения сильнее
        if (next.has(k)) {
            for (const [p, v] of decls) next.get(k).set(p, v);
        } else {
            next.set(k, new Map(decls));
        }
    }

    if (!moved) return { css: src, moved: 0 };

    const body = serializeAutoBody(next);
    const newBlock = body ? `${MARKER_START}\n${body}${MARKER_END}` : '';
    return { css: src.slice(0, block.start) + newBlock + src.slice(block.end), moved };
}

function removeFromAutoBlock(css, selector) {
    const block = getAutoBlock(css);
    if (!block) return css;

    const rules = parseAutoBody(block.body);
    const target = selector.trim().replace(/\s+/g, ' ');

    // Селектор мог получить правила и в @media: убираем все варианты,
    // иначе после «Сбросить» мобильные значения оставались висеть
    for (const key of [...rules.keys()]) {
        if (splitKey(key).sel === target) rules.delete(key);
    }

    const newBlock = rules.size
        ? `${MARKER_START}\n${serializeAutoBody(rules)}${MARKER_END}`
        : '';
    return (css.slice(0, block.start) + newBlock + css.slice(block.end))
        .replace(/\n{3,}/g, '\n\n');
}


/* ============================================================
   СМЫСЛОВЫЕ РАЗДЕЛЫ АВТО-БЛОКА
   Раздел определяется по селектору: одно правило CSS физически
   не может лежать в двух разделах одновременно.
============================================================ */
const AUTO_GROUPS = [
    {
        id: 'vars',
        title: 'Переменные',
        test: (s) => s === ':root' || s.startsWith(':root'),
    },
    {
        id: 'base',
        title: 'Основа',
        test: (s) => /^(html|body|\*)\b/.test(s),
    },
    {
        id: 'scroll',
        title: 'Прокрутка',
        test: (s) => /scrollbar|-webkit-resizer/i.test(s),
    },
    {
        id: 'send',
        title: 'Нижняя панель',
        test: (s) => /#send_form|#send_but|#send_textarea|#leftSendForm|#rightSendForm|#form_sheld|#mes_stop|#nonQRFormItems|#options_button|#extensionsMenuButton|#sw-bar-btn|#qr--bar/i.test(s),
    },
    {
        id: 'chars',
        title: 'Персонажи',
        test: (s) => /rm_print_characters|character_select|user_avatar_block|hotswap|avatars_inline|\.tag\b/i.test(s),
    },
    {
        id: 'messages',
        title: 'Сообщения',
        test: (s) => /\.mes\b|mesAvatarWrapper|\.avatar\b|mes_block|mes_text|ch_name|name_text|mesIDDisplay|mes_timer|tokenCounter/i.test(s),
    },
    {
        id: 'headers',
        title: 'Заголовки',
        test: (s) => /inline-drawer-header|standoutHeader|drawer-content h[1-6]|popup h[1-6]/i.test(s),
    },
    {
        id: 'topbar',
        title: 'Топ-бар',
        test: (s) => /#top-bar|#top-settings-holder|drawer-icon|drawer-toggle|drawer-header|DrawerIcon|drawer_icon|#nav-toggle|#API-status-top/i.test(s),
    },
    {
        id: 'chat',
        title: 'Чат',
        test: (s) => /#chat\b|\.mes\b|\.mes[_-]|#chat_|swipe|\.last_mes|#bg1|#bg_custom/i.test(s),
    },
    {
        id: 'avatar',
        title: 'Аватарки',
        test: (s) => /avatar|persona|#user_avatar_block/i.test(s),
    },
    {
        id: 'panels',
        title: 'Панели',
        test: (s) => /#right-nav-panel|#left-nav-panel|#WorldInfo|#rm_|drawer-content|#extensions_settings|#character_popup|inline-drawer/i.test(s),
    },
    {
        id: 'popups',
        title: 'Окна и меню',
        test: (s) => /dialogue_popup|#dialogue|#shadow_popup|\.popup|toast|tooltip|menu|context/i.test(s),
    },
    {
        id: 'other',
        title: 'Прочее',
        test: () => true,
    },
];

function sectionFor(selector) {
    const s = normSel(selector);
    for (const g of AUTO_GROUPS) {
        if (g.test(s)) return g;
    }
    return AUTO_GROUPS[AUTO_GROUPS.length - 1];
}

/* Ключ правила в авто-блоке: условие и селектор в одной строке.
   Символ-разделитель в CSS встретиться не может. */
const COND_SEP = '\u0001';

function makeKey(cond, sel) {
    const s = String(sel).trim().replace(/\s+/g, ' ');
    return cond ? `${cond}${COND_SEP}${s}` : s;
}

function splitKey(key) {
    const i = String(key).indexOf(COND_SEP);
    return i === -1
        ? { cond: '', sel: key }
        : { cond: key.slice(0, i), sel: key.slice(i + 1) };
}

/**
 * Разбор авто-блока.
 *
 * Прежняя регулярка не умела @media: вложенный блок она читала как правило
 * с селектором '@media (max-width: 768px)', а его содержимое теряла.
 * Мобильные значения из-за этого записать было нельзя. Берём тот же
 * посимвольный индекс, что используется во всём остальном модуле.
 */
function parseAutoBody(body) {
    const rules = new Map();

    const index = indexFor(String(body || ''));
    if (!index) return rules;

    for (const rule of index.rules) {
        const sel = normSel(rule.effectiveSelector || rule.selectorRaw);
        if (!sel) continue;

        const cond = rule.conditions.length
            ? rule.conditions.join(' ').replace(/\s+/g, ' ').trim()
            : '';

        const key = makeKey(cond, sel);
        if (!rules.has(key)) rules.set(key, new Map());

        for (const d of rule.decls) {
            rules.get(key).set(d.prop, d.rawValue.trim());
        }
    }
    return rules;
}

/** Правила одного условия, сгруппированные по смысловым разделам */
function serializeFlat(map, pad) {
    const groups = new Map();

    for (const [sel, decls] of map) {
        if (!decls || !decls.size) continue;
        const g = sectionFor(sel);
        if (!groups.has(g.id)) groups.set(g.id, []);
        groups.get(g.id).push([sel, decls]);
    }

    let out = '';
    // Разделы идут в фиксированном порядке, :root всегда первым,
    // чтобы переменные объявлялись до использования
    for (const def of AUTO_GROUPS) {
        const items = groups.get(def.id);
        if (!items || !items.length) continue;

        // Раздел: короткий заголовок, правила подряд без пустых строк,
        // между разделами — одна пустая строка
        out += `${pad}/* ${def.title} ♡ */\n`;
        for (const [sel, decls] of items) {
            out += `${pad}${sel} {\n`;
            for (const [p, v] of decls) out += `${pad}  ${p}: ${v};\n`;
            out += `${pad}}\n`;
        }
        out += '\n';
    }
    return out;
}

function serializeAutoBody(rules) {
    const byCond = new Map();

    for (const [key, decls] of rules) {
        if (!decls || !decls.size) continue;
        const { cond, sel } = splitKey(key);
        if (!byCond.has(cond)) byCond.set(cond, new Map());
        byCond.get(cond).set(sel, decls);
    }

    let out = '';

    // Базовые правила первыми: @media должен идти после того, что он
    // переопределяет, иначе при равной специфичности победит база
    const base = byCond.get('');
    if (base) out += serializeFlat(base, '');

    for (const [cond, map] of byCond) {
        if (!cond) continue;
        const body = serializeFlat(map, '  ');
        if (!body) continue;
        out += `${cond} {\n${body.replace(/\n\n$/, '\n')}}\n\n`;
    }

    return out;
}

function stripBang(v) {
    return String(v).replace(/\s*!important\s*$/i, '').trim();
}

function escapeRe(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ============================================================
   ИМПОРТЫ ШРИФТОВ
============================================================ */
export function addFontImport(css, importUrl) {
    if (!importUrl) return css;
    const src = css || '';
    if (src.includes(importUrl)) return src;

    return insertAfterImports(src, `@import url("${importUrl}");`);
}

/** Вставить строку после @charset/@import и комментариев в начале темы */
function insertAfterImports(src, line) {
    // Блоки редактора («Мои правки», «Облегчение») начинаются с комментария.
    // Проскакивать их нельзя: строка оказалась бы внутри блока, а его
    // содержимое при следующей правке пересобирается — и строка терялась
    const auto = cssIndex.findAutoRange(src);
    const perf = src.indexOf('/* ♡ Облегчение ♡ */');
    const limit = Math.min(auto ? auto.start : Infinity, perf === -1 ? Infinity : perf);

    // Ищем позицию после всех комментариев, @charset и уже существующих
    // @import. Разбор идёт по символам, поэтому многострочные комментарии
    // больше не разрезаются пополам.
    let i = 0;
    let insertAt = 0;

    while (i < src.length) {
        if (i >= limit) break;
        if (/\s/.test(src[i])) { i++; insertAt = i; continue; }

        if (src[i] === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? src.length : end + 2;
            insertAt = i;
            continue;
        }

        if (src[i] === '@' && /^@(charset|import)\b/i.test(src.slice(i, i + 12))) {
            const end = src.indexOf(';', i);
            i = end === -1 ? src.length : end + 1;
            insertAt = i;
            continue;
        }

        break;
    }

    const head = src.slice(0, insertAt).replace(/\s*$/, '');
    const tail = src.slice(insertAt).replace(/^\s*/, '');

    return (head ? head + '\n' : '') + line + '\n' + (tail ? '\n' + tail : '');
}

/**
 * Подключить шрифт по прямой ссылке на файл (.woff2, .woff, .ttf, .otf):
 * @font-face в начале темы, сразу после @import.
 */
export function addFontFace(css, family, url) {
    const src = css || '';
    if (!family || !url || src.includes(url)) return src;
    const ext = (String(url).split('?')[0].match(/\.(woff2|woff|ttf|otf)$/i) || [])[1]?.toLowerCase();
    const fmt = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' }[ext];
    const safeFamily = String(family).replace(/["\\]/g, '');
    const line = `@font-face { font-family: "${safeFamily}"; src: url("${url}")${fmt ? ` format("${fmt}")` : ''}; font-display: swap; }`;
    return insertAfterImports(src, line);
}

export function removeFontImport(css, importUrl) {
    return css.split('\n')
        .filter(l => !(l.includes('@import') && l.includes(importUrl)))
        .join('\n');
}

/* ============================================================
   ДИАГНОСТИКА
============================================================ */
export function getVariables() {
    return Array.from(state.rootVars, ([name, value]) => ({
        name,
        value,
        usedIn: (state.varUsage.get(name) || []).length,
    }));
}

/* ---------- Номера строк по ОРИГИНАЛЬНОМУ тексту ---------- */
function makeLineIndex(text) {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') offsets.push(i + 1);
    }
    return offsets;
}

function lineFromIndex(offsets, pos) {
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= pos) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
}

/**
 * Проверка CSS.
 *
 * Что изменилось против прежней версии:
 *
 *  1. Обход идёт по ОРИГИНАЛЬНОМУ тексту, комментарии пропускаются, а не
 *     вырезаются. Раньше номера строк считались по тексту без комментариев,
 *     и на теме с большой шапкой сдвиг доходил до сотни строк.
 *
 *  2. Скобки и точки с запятой внутри строк и комментариев больше не
 *     считаются. '{' в content: "{" ломал подсчёт.
 *
 *  3. Проверка «свойство вне селектора» теперь смотрит на реальную глубину
 *     вложенности вместо регулярки по всему файлу. Прежняя видела ошибку в
 *     любом валидном CSS Nesting и сыпала ложными предупреждениями на
 *     каждое нажатие клавиши.
 *
 *  4. Добавлена проверка var(--x) на переменную, которой нигде нет. Такое
 *     объявление браузер выбрасывает целиком и молча — самая незаметная
 *     ошибка в теме: строка написана, выглядит правильно, не работает.
 */
export function validate(css) {
    const src = String(css || '');
    const errors = [];
    const lines = makeLineIndex(src);
    const at = (pos) => lineFromIndex(lines, pos);

    let depth = 0;
    let i = 0;
    const openAt = [];

    while (i < src.length) {
        const ch = src[i];

        if (ch === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            if (end === -1) {
                errors.push({ line: at(i), message: 'Не закрыт комментарий /*' });
                break;
            }
            i = end + 2;
            continue;
        }

        if (ch === '"' || ch === "'") {
            const quote = ch;
            i++;
            let closed = false;
            while (i < src.length) {
                if (src[i] === '\\') { i += 2; continue; }
                if (src[i] === quote) { i++; closed = true; break; }
                i++;
            }
            if (!closed) {
                errors.push({ line: at(i - 1), message: `Не закрыта кавычка ${quote}` });
            }
            continue;
        }

        if (ch === '{') { depth++; openAt.push(i); i++; continue; }

        if (ch === '}') {
            if (depth === 0) {
                errors.push({ line: at(i), message: 'Лишняя закрывающая скобка }' });
            } else {
                depth--;
                openAt.pop();
            }
            i++;
            continue;
        }

        /* --- Объявление на верхнем уровне: блок точно отвалился --- */
        if (depth === 0 && /[a-z-]/i.test(ch)) {
            const chunk = src.slice(i, i + 120);
            // Требуем завершающую ';' и запрещаем '{' внутри — иначе под
            // проверку попадали бы обычные селекторы вида 'a:hover {'
            const m = chunk.match(/^([a-z-]{2,})\s*:\s*([^;{}]{1,90});/i);
            if (m && !/^(https?|url|data)$/i.test(m[1])) {
                errors.push({
                    line: at(i),
                    message: `Свойство вне селектора: ${m[1]}: ${m[2].trim().slice(0, 34)}`,
                });
                i += m[0].length;
                continue;
            }
        }

        i++;
    }

    if (depth > 0) {
        errors.push({
            line: openAt.length ? at(openAt[0]) : null,
            message: `Не закрыто скобок: ${depth}. Проверьте блок, начатый здесь`,
        });
    }

    /* ---------- Переменные, которых нигде нет ---------- */
    const declared = new Set(state.rootVars.keys());
    // Переменные самой ST и расширений тоже считаются объявленными: раньше
    // любая --black50a или --csi-accent из чужих стилей давала ложную ошибку
    for (const n of pageVarNames()) declared.add(n);
    const declRe = /(--[\w-]+)\s*:/g;
    let dm;
    while ((dm = declRe.exec(src)) !== null) declared.add(dm[1]);

    const seen = new Set();
    // Только без запасного значения: var(--x, 10px) при отсутствии --x
    // работает штатно и ошибкой не является
    const useRe = /var\(\s*(--[\w-]+)\s*\)/g;
    let um;
    while ((um = useRe.exec(src)) !== null) {
        const name = um[1];
        if (declared.has(name) || seen.has(name)) continue;
        seen.add(name);
        errors.push({
            line: at(um.index),
            message: `Переменная ${name} нигде не объявлена — строка не сработает`,
        });
        if (seen.size >= 20) break;
    }

    return errors;
}

function lineAt(text, index) {
    return text.slice(0, index).split('\n').length;
}
