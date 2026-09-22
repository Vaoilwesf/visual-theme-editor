// modules/cssRules.js
// Индекс правил пользовательского CSS с точными позициями в ИСХОДНОМ тексте.
//
// Зачем нужен: чтобы редактор мог менять значение прямо в том правиле,
// которое уже написал пользователь, а не дублировать его в авто-блоке.
//
// Три вещи, которые здесь сделаны специально и важны:
//  1. Комментарии НЕ вырезаются из текста, а пропускаются при разборе.
//     Иначе все позиции сдвинулись бы и запись попадала не туда.
//  2. Правила внутри @media помнят своё условие. Правка мобильного блока,
//     когда пользователь смотрит десктоп, — самая коварная ошибка.
//  3. Псевдоэлементы (::after и т.п.) хранятся отдельно от базового
//     селектора, потому что element.matches('#x::after') всегда падает.

/* ============================================================
   СПИСОК ПСЕВДОЭЛЕМЕНТОВ
============================================================ */
// Порядок в списке критичен: он превращается в альтернацию регулярки,
// а она жадная слева. Без сортировки по длине '::-webkit-scrollbar-thumb'
// совпадал как '::-webkit-scrollbar' (дефис не входит в \w, поэтому \b
// проходил), и хвост '-thumb' оставался приклеенным к базовому селектору.
// Правки скроллбаров из-за этого уезжали в никуда.
const PSEUDO_ELEMENTS = [
    'before', 'after',
    'first-line', 'first-letter', 'selection', 'placeholder',
    'marker', 'backdrop', 'cue', 'file-selector-button', 'target-text',
    '-webkit-scrollbar', '-webkit-scrollbar-thumb', '-webkit-scrollbar-track',
    '-webkit-scrollbar-track-piece', '-webkit-scrollbar-corner',
    '-webkit-scrollbar-button', '-webkit-resizer',
    '-webkit-input-placeholder', '-moz-placeholder', '-ms-input-placeholder',
    '-moz-focus-inner', '-webkit-slider-thumb', '-moz-range-thumb',
    '-webkit-slider-runnable-track', '-moz-range-track',
    '-webkit-progress-bar', '-webkit-progress-value',
    '-webkit-details-marker', '-webkit-calendar-picker-indicator',
].sort((a, b) => b.length - a.length);

const PSEUDO_EL_SOURCE =
    '::?(?:' + PSEUDO_ELEMENTS.map(escapeRe).join('|') + ')\\b';

// Псевдоклассы-состояния: их нельзя проверить через matches(),
// потому что элемент прямо сейчас не в этом состоянии.
const STATE_PSEUDO = [
    'hover', 'focus', 'focus-visible', 'focus-within', 'active',
    'visited', 'link', 'any-link', 'target', 'user-invalid', 'user-valid',
];

const AT_NESTED = ['media', 'supports', 'container', 'layer', 'scope', 'document'];

// Границы блока, который пишет редактор. Короткие и по-русски; старые
// длинные метки тоже узнаются и при первой же правке заменяются новыми.
export const AUTO_START = '/* ♡ Мои правки ♡ */';
export const AUTO_END   = '/* ♡ конец правок ♡ */';

const AUTO_MARKERS = [
    [AUTO_START, AUTO_END],
    ['/* ==== VTE:AUTO START — не редактируйте вручную ==== */', '/* ==== VTE:AUTO END ==== */'],
];

/**
 * Где в тексте блок правок редактора (новые или старые метки).
 * { start, end, bodyStart, bodyEnd } или null.
 */
export function findAutoRange(text) {
    const src = String(text || '');
    for (const [a, b] of AUTO_MARKERS) {
        const s = src.indexOf(a);
        if (s === -1) continue;
        const e = src.indexOf(b, s + a.length);
        if (e === -1) continue;
        return { start: s, end: e + b.length, bodyStart: s + a.length, bodyEnd: e };
    }
    return null;
}

/* ============================================================
   ПУБЛИЧНОЕ API
============================================================ */

/**
 * Строит индекс по тексту CSS.
 * Возвращает { text, rules, autoRange }.
 * ВАЖНО: после любого изменения текста индекс надо построить заново —
 * все позиции в нём привязаны к конкретной строке.
 */
/* Индекс строится по одному и тому же тексту из нескольких мест: разбор
   переменных в cssGenerator, needsImportant и прыжок к правке в index.js.
   На теме в 350 КБ одна сборка — это 40+ мс на быстром компьютере, поэтому
   держим последние результаты. Индекс после сборки никто не меняет. */
const indexCache = new Map();
const INDEX_CACHE_SIZE = 3;

export function buildIndex(cssText) {
    const text = String(cssText || '');
    const hit = indexCache.get(text);
    if (hit) return hit;

    const idx = buildIndexRaw(text);
    if (indexCache.size >= INDEX_CACHE_SIZE) indexCache.delete(indexCache.keys().next().value);
    indexCache.set(text, idx);
    return idx;
}

function buildIndexRaw(text) {
    const out = { rules: [] };

    scanBlock(text, 0, text.length, { conditions: [], parent: null }, out);

    const autoRange = findAutoRange(text);

    for (const rule of out.rules) {
        rule.inAutoBlock = !!autoRange
            && rule.ruleStart >= autoRange.start
            && rule.ruleEnd <= autoRange.end;
    }

    return { text, rules: out.rules, autoRange };
}

/**
 * Ищет правила темы, которые целятся в этот элемент (и, если задан,
 * в этот псевдоэлемент). Возвращает массив, лучший вариант первым.
 *
 * @param {object} index    результат buildIndex
 * @param {Element} element
 * @param {string|null} pseudo  '::after' | '::before' | null
 * @param {object} opts     { includeAuto: false } — учитывать авто-блок
 */
export function findMatches(index, element, pseudo = null, opts = {}) {
    if (!index || !element || element.nodeType !== 1) return [];

    const wantPseudo = normalizePseudo(pseudo);
    const includeAuto = opts.includeAuto === true;
    const found = [];

    for (const rule of index.rules) {
        if (rule.inAutoBlock && !includeAuto) continue;

        for (const part of rule.parts) {
            if (part.pseudo !== wantPseudo) continue;
            if (!safeMatches(element, part.matchable)) continue;

            found.push({
                rule,
                part,
                score: rankMatch(rule, part),
            });
            break; // одного совпавшего варианта из списка через запятую хватит
        }
    }

    found.sort((a, b) => b.score - a.score || b.rule.ruleStart - a.rule.ruleStart);
    return found;
}

/**
 * Что реально объявлено в теме для этого свойства.
 * Возвращает { value, important, rule, part, decl } или null.
 * Это и есть замена getComputedStyle там, где нужно ЗАЯВЛЕННОЕ значение.
 */
export function getDeclaredValue(index, element, pseudo, property, opts = {}) {
    const matches = findMatches(index, element, pseudo, opts);
    for (const m of matches) {
        const decl = findDeclaration(m.rule, property);
        if (decl) {
            return {
                value: decl.value,
                important: decl.important,
                rule: m.rule,
                part: m.part,
                decl,
            };
        }
    }
    return null;
}

/** Ищет объявление свойства внутри правила. Последнее побеждает, как в CSS. */
export function findDeclaration(rule, property) {
    const prop = String(property || '').trim().toLowerCase();
    let hit = null;
    for (const d of rule.decls) {
        if (d.prop.toLowerCase() === prop) hit = d;
    }
    return hit;
}

/**
 * Все свойства, которые тема задаёт для этого элемента, за ОДИН обход.
 * Возвращает Map: свойство -> { score, important, selector, value }.
 *
 * Зачем понадобилось: strongestDeclaration отвечал про одно свойство и
 * каждый раз проходил по всему индексу заново. При записи иконки таких
 * вопросов задаётся двадцать с лишним подряд — двадцать полных обходов
 * там, где достаточно одного.
 */
export function declarationMap(index, element, pseudo = null, opts = {}) {
    const out = new Map();
    if (!index || !element || element.nodeType !== 1) return out;

    for (const m of findMatches(index, element, pseudo, opts)) {
        if (m.part.states.length) continue;          // :hover вслепую не считаем
        if (!isContextActive(m.rule)) continue;      // спящий @media

        // Внутри одного правила последнее объявление побеждает, как в CSS
        const own = new Map();
        for (const d of m.rule.decls) {
            own.set(d.prop.toLowerCase(), d);
        }

        for (const [prop, d] of own) {
            const cand = {
                score: m.part.score,
                important: d.important,
                selector: m.part.raw,
                value: d.value,
            };
            const prev = out.get(prop);

            if (!prev) { out.set(prop, cand); continue; }
            if (cand.important !== prev.important) {
                if (cand.important) out.set(prop, cand);
                continue;
            }
            // findMatches отдаёт сильные первыми, поэтому при равном весе
            // уже записанный кандидат остаётся
            if (cand.score > prev.score) out.set(prop, cand);
        }
    }
    return out;
}

/**
 * Самое сильное объявление одного свойства.
 *
 * Специфичность и важность — две разные оси: !important бьёт любую
 * специфичность, поэтому перебить его можно только своим !important,
 * а не более длинным селектором.
 */
export function strongestDeclaration(index, element, pseudo, property, opts = {}) {
    const map = declarationMap(index, element, pseudo, opts);
    return map.get(String(property || '').trim().toLowerCase()) || null;
}


/**
 * Меняет значение существующего объявления. Возвращает НОВЫЙ текст CSS.
 * Индекс после этого недействителен — постройте заново.
 */
export function replaceDeclarationValue(text, decl, newValue, opts = {}) {
    const keepBang = opts.important ?? decl.important;
    const value = stripBang(newValue);
    const replacement = keepBang ? `${value} !important` : value;
    return text.slice(0, decl.valueStart) + replacement + text.slice(decl.valueEnd);
}

/**
 * Добавляет новое объявление в конец тела существующего правила.
 * Отступ подбирается по уже написанным строкам, чтобы код не разъезжался.
 */
export function insertDeclaration(text, rule, property, value, opts = {}) {
    const bang = opts.important ? ' !important' : '';
    const indent = detectIndent(text, rule);
    const body = text.slice(rule.bodyStart, rule.bodyEnd);

    const line = `${indent}${property}: ${stripBang(value)}${bang};`;
    const needsNewline = /\S/.test(body) && !/\n[ \t]*$/.test(body);
    const insertion = (needsNewline ? '\n' : '') + line + '\n';

    // Вставляем перед закрывающей скобкой, сохраняя её отступ
    let at = rule.bodyEnd;
    const tailStart = body.search(/[ \t]*$/);
    if (tailStart >= 0 && !needsNewline) at = rule.bodyStart + tailStart;

    return text.slice(0, at) + insertion + text.slice(at);
}

/** Удаляет объявление целиком вместе с точкой с запятой и пустой строкой. */
export function removeDeclaration(text, decl) {
    let start = decl.start;
    let end = decl.end;

    // Съедаем ';' и хвостовые пробелы до конца строки
    while (end < text.length && (text[end] === ';' || text[end] === ' ' || text[end] === '\t')) end++;
    if (text[end] === '\n') end++;

    // Съедаем отступ перед объявлением
    while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--;

    return text.slice(0, start) + text.slice(end);
}

/* ============================================================
   ЧТЕНИЕ ВЫЧИСЛЕННЫХ СТИЛЕЙ С УЧЁТОМ ПСЕВДОЭЛЕМЕНТА
============================================================ */

/** Безопасная обёртка: getComputedStyle(el, '::after') */
export function computedFor(element, pseudo) {
    const p = normalizePseudo(pseudo);
    try {
        return p ? getComputedStyle(element, p) : getComputedStyle(element);
    } catch {
        return getComputedStyle(element);
    }
}

/** Есть ли у элемента реально отрисованный псевдоэлемент */
export function hasPseudo(element, pseudo) {
    const p = normalizePseudo(pseudo);
    if (!p || !element || element.nodeType !== 1) return false;
    try {
        const cs = getComputedStyle(element, p);
        if (!cs) return false;
        const content = cs.content;
        if (!content || content === 'none' || content === 'normal') return false;
        const w = parseFloat(cs.width) || 0;
        const h = parseFloat(cs.height) || 0;
        const hasBg = cs.backgroundImage !== 'none'
            || (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor));
        const hasMask = (cs.maskImage && cs.maskImage !== 'none')
            || (cs.webkitMaskImage && cs.webkitMaskImage !== 'none');
        return w > 0 || h > 0 || hasBg || hasMask || content !== '""';
    } catch {
        return false;
    }
}

/* ============================================================
   РАЗБОР СЕЛЕКТОРОВ
============================================================ */

/** '#x .y::after' → { base: '#x .y', pseudo: '::after' } */
export function splitPseudo(selector) {
    const re = new RegExp(PSEUDO_EL_SOURCE, 'i');
    const m = String(selector || '').match(re);
    if (!m) return { base: String(selector || '').trim(), pseudo: null };
    const base = (selector.slice(0, m.index) + selector.slice(m.index + m[0].length)).trim();
    return { base, pseudo: normalizePseudo(m[0]) };
}

/** ':after' → '::after'; мусор → null */
export function normalizePseudo(pseudo) {
    if (!pseudo) return null;
    let p = String(pseudo).trim().toLowerCase();
    if (!p) return null;
    p = p.replace(/^:+/, '');
    if (!PSEUDO_ELEMENTS.includes(p)) return null;
    return '::' + p;
}

/**
 * Убирает псевдоклассы-состояния на верхнем уровне, чтобы matches() сработал.
 * Внутрь :has(...) и :not(...) не лезем — там :focus осмыслен.
 */
export function stripStates(selector) {
    const src = String(selector || '');
    let out = '';
    const states = [];
    let i = 0;

    while (i < src.length) {
        if (src[i] === ':' && src[i + 1] !== ':') {
            const m = src.slice(i).match(/^:([\w-]+)/);
            if (m && STATE_PSEUDO.includes(m[1].toLowerCase())) {
                states.push(m[1].toLowerCase());
                i += m[0].length;
                continue;
            }
        }
        if (src[i] === '(') {
            const close = matchParen(src, i);
            out += src.slice(i, close + 1);
            i = close + 1;
            continue;
        }
        out += src[i];
        i++;
    }

    return { selector: out.trim() || '*', states };
}

/** Специфичность как [id, class, type]; сравнивать удобно через score() */
export function specificity(selector) {
    let s = String(selector || '').replace(/\\./g, 'x');
    let a = 0, b = 0, c = 0;

    const peRe = new RegExp(PSEUDO_EL_SOURCE, 'gi');
    c += (s.match(peRe) || []).length;
    s = s.replace(peRe, ' ');

    a += (s.match(/#[\w-]+/g) || []).length;
    s = s.replace(/#[\w-]+/g, ' ');

    b += (s.match(/\[[^\]]*\]/g) || []).length;
    s = s.replace(/\[[^\]]*\]/g, ' ');

    b += (s.match(/\.[\w-]+/g) || []).length;
    s = s.replace(/\.[\w-]+/g, ' ');

    const pcRe = /:{1,2}[\w-]+(\([^)]*\))?/g;
    for (const p of s.match(pcRe) || []) {
        if (/^:where\b/i.test(p)) continue;
        b++;
    }
    s = s.replace(pcRe, ' ');

    c += (s.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) || []).length;

    return [a, b, c];
}

/* Одни и те же селекторы разбираются десятками раз: при каждом
   buildIndex, при каждом сравнении в findMatches и needsImportant.
   Разбор строки дороже, чем её хранение. */
const specCache = new Map();

export function specificityScore(selector) {
    const key = String(selector || '');
    if (specCache.has(key)) return specCache.get(key);

    const [a, b, c] = specificity(key);
    const score = a * 10000 + b * 100 + c;

    if (specCache.size > 4000) specCache.clear();
    specCache.set(key, score);
    return score;
}

/** Активно ли сейчас условие @media/@supports вокруг правила */
export function isContextActive(rule) {
    for (const cond of rule.conditions) {
        const media = cond.match(/^@media\s+([\s\S]+)$/i);
        if (media) {
            try { if (!window.matchMedia(media[1].trim()).matches) return false; }
            catch { /* непонятный запрос — считаем активным */ }
            continue;
        }
        const supports = cond.match(/^@supports\s+([\s\S]+)$/i);
        if (supports) {
            try { if (window.CSS?.supports && !CSS.supports(supports[1].trim())) return false; }
            catch {}
        }
    }
    return true;
}

/** Короткая подпись правила для интерфейса */
export function describeRule(rule) {
    const line = rule.selectorRaw.replace(/\s+/g, ' ').trim();
    const media = rule.conditions.length
        ? ' — ' + rule.conditions.join(' ').replace(/\s+/g, ' ')
        : '';
    return line + media;
}

/* ============================================================
   ВНУТРЕННОСТИ: СКАНЕР
============================================================ */
function scanBlock(text, i, end, ctx, out) {
    while (i < end) {
        i = skipTrivia(text, i, end);
        if (i >= end) break;
        if (text[i] === '}') return i + 1;

        const preludeStart = i;
        const stop = readUntil(text, i, end, '{;}');
        if (stop >= end) return end;

        if (text[stop] === ';' || text[stop] === '}') {
            // @import, @charset или мусор вне правила
            i = stop + 1;
            continue;
        }

        const prelude = text.slice(preludeStart, stop);
        const trimmed = prelude.trim();
        const bodyStart = stop + 1;

        if (trimmed.startsWith('@')) {
            const name = (trimmed.match(/^@([\w-]+)/) || [, ''])[1].toLowerCase();
            if (AT_NESTED.includes(name)) {
                i = scanBlock(text, bodyStart, end, {
                    conditions: ctx.conditions.concat(trimmed.replace(/\s+/g, ' ')),
                    parent: ctx.parent,
                }, out);
            } else {
                // @keyframes, @font-face, @page — внутрь не заходим
                i = skipBlock(text, bodyStart, end);
            }
            continue;
        }

        const rule = makeRule(text, preludeStart, stop, bodyStart, ctx);
        out.rules.push(rule);
        i = scanDecls(text, bodyStart, end, rule, ctx, out);
    }
    return i;
}

function scanDecls(text, i, end, rule, ctx, out) {
    while (i < end) {
        i = skipTrivia(text, i, end);
        if (i >= end) break;

        if (text[i] === '}') {
            rule.bodyEnd = i;
            rule.ruleEnd = i + 1;
            return i + 1;
        }

        const start = i;
        const stop = readUntil(text, i, end, '{;}');
        if (stop >= end) break;

        if (text[stop] === '{') {
            // Вложенное правило (CSS nesting). Пишем его как отдельное.
            const nestedCtx = { conditions: ctx.conditions, parent: rule.selectorRaw };
            const nested = makeRule(text, start, stop, stop + 1, nestedCtx);
            out.rules.push(nested);
            i = scanDecls(text, stop + 1, end, nested, nestedCtx, out);
            continue;
        }

        pushDecl(text, start, stop, rule);

        if (text[stop] === '}') {
            rule.bodyEnd = stop;
            rule.ruleEnd = stop + 1;
            return stop + 1;
        }
        i = stop + 1;
    }

    rule.bodyEnd = end;
    rule.ruleEnd = end;
    return end;
}

function makeRule(text, selStart, selEnd, bodyStart, ctx) {
    const raw = text.slice(selStart, selEnd);
    const trimmedStart = selStart + (raw.length - raw.trimStart().length);
    const selectorRaw = raw.trim();

    const effective = ctx.parent
        ? resolveNested(ctx.parent, selectorRaw)
        : selectorRaw;

    return {
        selectorRaw,
        effectiveSelector: effective,
        selectorStart: trimmedStart,
        selectorEnd: trimmedStart + selectorRaw.length,
        ruleStart: trimmedStart,
        bodyStart,
        bodyEnd: bodyStart,
        ruleEnd: bodyStart,
        conditions: ctx.conditions.slice(),
        parentSelector: ctx.parent || null,
        decls: [],
        // Запятые внутри :is(), :not(), :where() и [атрибутов] — не границы
        // селекторов. Раньше «:is(#a,#b) .x» резался на обрывки, и такие
        // правила темы редактор просто не видел
        parts: splitTopLevel(effective).map(one => {
            const piece = one.trim();
            const { base, pseudo } = splitPseudo(piece);
            const { selector: matchable, states } = stripStates(base);
            return {
                raw: piece,
                // Ключ для поиска правила по селектору. Считается здесь один
                // раз: иначе та же нормализация шла в цикле по всем правилам
                // темы на каждое движение ползунка.
                norm: piece.replace(/\s+/g, ' '),
                base,
                pseudo,
                matchable,
                states,
                score: specificityScore(piece),
            };
        }).filter(p => p.raw),
        inAutoBlock: false,
    };
}

/** Разбить список селекторов по запятым верхнего уровня */
function splitTopLevel(sel) {
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
        if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
        buf += c;
    }
    out.push(buf);
    return out;
}

function resolveNested(parent, child) {
    if (child.includes('&')) return child.replace(/&/g, parent);
    return `${parent} ${child}`;
}

function pushDecl(text, start, end, rule) {
    const slice = text.slice(start, end);
    const colon = findColon(slice);
    if (colon < 1) return;

    const prop = slice.slice(0, colon).trim();
    if (!prop || /[{}]/.test(prop)) return;

    // Позиция значения в ОРИГИНАЛЬНОМ тексте
    const afterColon = start + colon + 1;
    const rawValue = text.slice(afterColon, end);
    const lead = rawValue.length - rawValue.trimStart().length;
    const valueStart = afterColon + lead;
    const valueEnd = end - (rawValue.length - rawValue.trimEnd().length);

    const full = text.slice(valueStart, valueEnd);
    const important = /!\s*important\s*$/i.test(full);

    rule.decls.push({
        prop,
        value: stripBang(full),
        rawValue: full,
        important,
        start,
        end,
        valueStart,
        valueEnd,
    });
}

/* ============================================================
   ВНУТРЕННОСТИ: ПОБУКВЕННЫЙ ОБХОД
============================================================ */
function skipTrivia(text, i, end) {
    while (i < end) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') {
            const j = text.indexOf('*/', i + 2);
            i = j === -1 ? end : j + 2;
            continue;
        }
        if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }
        break;
    }
    return i;
}

function readUntil(text, i, end, stops) {
    let depth = 0;
    while (i < end) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') {
            const j = text.indexOf('*/', i + 2);
            i = j === -1 ? end : j + 2;
            continue;
        }
        if (c === '"' || c === "'") { i = skipString(text, i, end); continue; }
        if (c === '(' || c === '[') { depth++; i++; continue; }
        if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); i++; continue; }
        if (depth === 0 && stops.includes(c)) return i;
        i++;
    }
    return end;
}

function skipString(text, i, end) {
    const quote = text[i];
    i++;
    while (i < end) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) return i + 1;
        i++;
    }
    return end;
}

function skipBlock(text, i, end) {
    let depth = 1;
    while (i < end) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') {
            const j = text.indexOf('*/', i + 2);
            i = j === -1 ? end : j + 2;
            continue;
        }
        if (c === '"' || c === "'") { i = skipString(text, i, end); continue; }
        if (c === '{') { depth++; i++; continue; }
        if (c === '}') {
            depth--;
            i++;
            if (depth === 0) return i;
            continue;
        }
        i++;
    }
    return end;
}

function findColon(slice) {
    let depth = 0;
    for (let i = 0; i < slice.length; i++) {
        const c = slice[i];
        if (c === '(' || c === '[') { depth++; continue; }
        if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); continue; }
        if (c === '"' || c === "'") { i = skipString(slice, i, slice.length) - 1; continue; }
        if (c === ':' && depth === 0) return i;
    }
    return -1;
}

function matchParen(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return src.length - 1;
}

/* ============================================================
   ВНУТРЕННОСТИ: РАНЖИРОВАНИЕ
============================================================ */
function rankMatch(rule, part) {
    let score = part.score;
    // Правило, чей @media сейчас не действует, почти бесполезно
    if (!isContextActive(rule)) score -= 100000;
    // Правило с :hover нельзя править «вслепую»
    if (part.states.length) score -= 5000;
    // Авто-блок уступает ручному коду темы
    if (rule.inAutoBlock) score -= 500;
    return score;
}

function safeMatches(element, selector) {
    if (!selector) return false;
    try { return element.matches(selector); } catch { return false; }
}

/* ============================================================
   МЕЛОЧИ
============================================================ */
function detectIndent(text, rule) {
    const body = text.slice(rule.bodyStart, rule.bodyEnd);
    const m = body.match(/\n([ \t]+)\S/);
    if (m) return m[1];
    const outer = text.slice(Math.max(0, rule.ruleStart - 200), rule.ruleStart);
    const om = outer.match(/\n([ \t]*)$/);
    return (om ? om[1] : '') + '    ';
}

function stripBang(v) {
    return String(v ?? '').replace(/\s*!\s*important\s*$/i, '').trim();
}

function escapeRe(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
