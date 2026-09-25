// modules/perfGuard.js
// «Облегчить таверну»: разово для всего интерфейса выключает тяжёлые эффекты.
//
//   blur      — backdrop-filter и blur() в filter;
//   shadow    — мягкие box-shadow и drop-shadow(). Тени без размытия
//               (0 0 0 1px — ими часто рисуют рамки) остаются: они дешёвые;
//   gradient  — градиентные фоны заменяются сплошным цветом первой точки.
//               Картинки в том же background остаются.
//
// Как работает: проходим по всем таблицам стилей страницы (ST, тема,
// расширения) и для каждого правила с тяжёлым эффектом пишем правило-заплатку
// с тем же селектором и !important. Результат записывается в CSS темы. Тот же селектор = та же специфичность,
// а наш <style> стоит последним — поэтому заплатка побеждает даже
// !important из темы. Глобальный «* { ... }» так не умеет: его специфичность
// нулевая, и любое правило темы с !important его перебьёт.
//
// Анимации и тени текста здесь намеренно не трогаются: для них в самой
// SillyTavern есть свои переключатели.

/* Заплатки больше не живут отдельным слоем поверх страницы: они
   записываются прямо в CSS темы отдельным блоком «Облегчение ♡». Так они
   видны в коде, переезжают вместе с темой и не требуют слежки за
   страницей. Этот модуль только собирает текст блока. */

export const PERF_START = '/* ♡ Облегчение ♡ */';
export const PERF_END = '/* ♡ конец облегчения ♡ */';

let opts = { blur: false, shadow: false, gradient: false };
let sheetKind = 'other';   // откуда текущая таблица: core (ST) | theme | other
let rootStyle = null;

function sourceOf(sheet) {
    if (sheet.ownerNode?.id === 'custom-style') return 'theme';
    try {
        const u = new URL(sheet.href || '', location.href);
        if (sheet.href && u.origin === location.origin && /^\/(style\.css|css\/[^/]+\.css)$/.test(u.pathname)) return 'core';
    } catch {}
    return 'other';
}

/**
 * Переменные в значениях, которые мы переносим в тему, заменяем их
 * значением. Иначе в теме появлялись var(--black50a), var(--csi-accent)…
 * — объявленные где-то в чужих стилях, а проверка ошибок считала их
 * «нигде не объявленными». Переменные SmartTheme оставляем: они меняются
 * вместе с темой ST и известны проверке.
 */
function resolveVars(value) {
    return String(value).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name, fb) => {
        if (/^--SmartTheme/.test(name)) return m;
        const v = rootStyle?.getPropertyValue(name).trim();
        if (v) return v;
        if (fb && fb.trim()) return fb.trim();
        return m;
    });
}

/** Где в теме блок облегчения */
export function findPerfBlock(css) {
    const src = String(css || '');
    const s = src.indexOf(PERF_START);
    if (s === -1) return null;
    const e = src.indexOf(PERF_END, s);
    if (e === -1) return null;
    return { start: s, end: e + PERF_END.length, body: src.slice(s + PERF_START.length, e) };
}

/** Какие галочки включены — записано второй строкой блока */
export function readPerfFlags(css) {
    const b = findPerfBlock(css);
    const line = b ? (b.body.match(/\/\*\s*выключено:([^*]*)\*\//) || [])[1] || '' : '';
    return {
        blur: /размытие/.test(line),
        shadow: /тени/.test(line),
        gradient: /градиенты/.test(line),
    };
}

/** Убрать блок облегчения из текста темы */
export function stripPerfBlock(css) {
    const b = findPerfBlock(css);
    if (!b) return String(css || '');
    return (css.slice(0, b.start).trimEnd() + '\n' + css.slice(b.end).replace(/^\s*\n/, '')).trimEnd() + '\n';
}

/**
 * Собрать блок облегчения по всем стилям страницы.
 * Правила с одинаковой заплаткой склеиваются в одно правило со списком
 * селекторов — так блок получается компактным.
 * @returns {{ block: string, stats: object }}
 */
export function buildPerfBlock(next = {}) {
    opts = { blur: !!next.blur, shadow: !!next.shadow, gradient: !!next.gradient };
    const stats = { blur: 0, shadow: 0, gradient: 0, rules: 0 };
    if (!opts.blur && !opts.shadow && !opts.gradient) return { block: '', stats };

    const groups = new Map();   // условие -> Map(объявления -> [селекторы])
    const count = { blur: 0, shadow: 0, gradient: 0 };

    rootStyle = getComputedStyle(document.documentElement);
    for (const sheet of Array.from(document.styleSheets)) {
        if (/\/visual-theme-editor\//.test(sheet.href || '')) continue;
        if (sheet.ownerNode?.id?.startsWith?.('vte-')) continue;
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        // Градиенты меняем только у самой SillyTavern и в теме. У расширений
        // градиенты часто рабочие (шкала оттенков в пипетке, ползунки) —
        // сплошной цвет их бы сломал
        sheetKind = sourceOf(sheet);
        if (rules) walk(rules, [], groups, count);
    }

    const flags = [opts.blur && 'размытие', opts.shadow && 'тени', opts.gradient && 'градиенты'].filter(Boolean);
    let out = `${PERF_START}\n/* выключено: ${flags.join(', ')} */\n`;

    // Размытие и тени выключаются ОДНИМ правилом на всё сразу. Хитрость в
    // :is(#id#id#id, *): совпадает с любым элементом, а весит как три id —
    // это сильнее почти любого правила темы. Раньше под каждое правило
    // темы писалась своя заплатка — отсюда сотни строк.
    const all = [];
    if (opts.blur) all.push('backdrop-filter: none !important; -webkit-backdrop-filter: none !important;');
    if (opts.shadow) all.push('box-shadow: none !important;');
    if (all.length) {
        const u = `:is(${WIDE}, *)`;
        out += `${u}, ${u}::before, ${u}::after { ${all.join(' ')} }\n`;
    }

    let n = 0;
    for (const [cond, map] of groups) {
        let body = '';
        for (const [decls, sels] of map) {
            // Селекторы с приставками браузеров — отдельно: в чужом браузере
            // такой селектор недопустим и погубил бы всё правило со списком
            const safe = sels.filter(s => !/-(webkit|moz|ms|o)-/.test(s));
            const risky = sels.filter(s => /-(webkit|moz|ms|o)-/.test(s));
            // Селекторы с большим весом склеиваем в одно :is(#id×4, a, b, c)
            const pre = `:is(${WIDER}, `;
            const inner = safe.filter(x => x.startsWith(pre) && x.endsWith(')') && !x.slice(pre.length, -1).includes('::'))
                .map(x => x.slice(pre.length, -1));
            const rest = safe.filter(x => !(x.startsWith(pre) && x.endsWith(')') && !x.slice(pre.length, -1).includes('::')));
            const list = inner.length ? [`${pre}${inner.join(', ')})`, ...rest] : rest;
            if (list.length) { body += `${list.join(', ')} { ${decls} }\n`; n++; }
            for (const s of risky) { body += `${s} { ${decls} }\n`; n++; }
        }
        if (!cond) { out += body; continue; }
        const levels = cond.split('\u0001');
        out += levels.map(c => `${c} {\n`).join('') + body + '}\n'.repeat(levels.length);
    }
    out += PERF_END;

    stats.blur = count.blur; stats.shadow = count.shadow; stats.gradient = count.gradient; stats.rules = n;
    return { block: out, stats };
}

function walk(rules, conds, groups, count) {
    for (const r of Array.from(rules)) {
        if (r.style && r.selectorText) {
            patchRule(r, conds, groups, count);
            continue;
        }
        if (r.styleSheet) {
            let inner = null;
            try { inner = r.styleSheet.cssRules; } catch {}
            const m = r.media?.mediaText;
            if (inner) walk(inner, m ? [...conds, `@media ${m}`] : conds, groups, count);
            continue;
        }
        if (!r.cssRules) continue;
        const name = r.constructor?.name;
        if (name === 'CSSMediaRule') walk(r.cssRules, [...conds, `@media ${r.media.mediaText}`], groups, count);
        else if (name === 'CSSSupportsRule') walk(r.cssRules, [...conds, `@supports ${r.conditionText}`], groups, count);
        else if (name === 'CSSContainerRule') walk(r.cssRules, [...conds, `@container ${r.conditionText}`], groups, count);
        else if (name === 'CSSLayerBlockRule') walk(r.cssRules, conds, groups, count);
    }
}

function patchRule(rule, conds, groups, count) {
    const sel = rule.selectorText;
    if (!sel || /vte-/.test(sel) || sel.includes('&')) return;
    // Служебные стили самих редакторов (CodeMirror вешает классы вида .ͼo)
    if (/ͼ|\.cm-/.test(sel)) return;

    const st = rule.style;
    const decls = [];

    const filter = st.getPropertyValue('filter').trim();
    if (filter && filter !== 'none') {
        const drop = [];
        if (opts.blur && /\bblur\(/i.test(filter)) drop.push('blur');
        if (opts.shadow && /drop-shadow\(/i.test(filter)) drop.push('drop-shadow');
        if (drop.length) {
            decls.push(['filter', removeFunctions(filter, drop) || 'none']);
            if (drop.includes('blur')) count.blur++;
            if (drop.includes('drop-shadow')) count.shadow++;
        }
    }

    // backdrop-filter отдельно не трогаем: его снимает общее правило выше

    // Тени: общее правило снимает все. Возвращаем только жёсткие тени без
    // размытия (рамки, обводки) — там, где они были, и с большим весом,
    // чтобы перебить общее правило
    let restore = null;
    if (opts.shadow) {
        const bs = st.getPropertyValue('box-shadow').trim();
        if (bs && bs !== 'none') {
            const hard = keepHardShadows(bs);
            const kept = hard === null ? bs : hard;
            if (kept && kept !== 'none') restore = kept;
            count.shadow++;
        }
    }

    // Градиенты темы меняются прямо в её коде (см. flattenThemeGradients),
    // сюда попадают только градиенты самой SillyTavern
    if (opts.gradient && sheetKind === 'core') {
        const g = patchGradient(st);
        if (g.length) { decls.push(...g); count.gradient++; }
    }

    const parts = sel.split(/,(?![^(]*\))/).map(x => x.trim()).filter(Boolean);
    const condKey = conds.join('\u0001');
    const add = (key, sels) => {
        if (!groups.has(condKey)) groups.set(condKey, new Map());
        const g = groups.get(condKey);
        if (!g.has(key)) g.set(key, []);
        const list = g.get(key);
        for (const x of sels) if (x && !list.includes(x)) list.push(x);
    };

    if (decls.length) add(decls.map(([p, v]) => `${p}: ${resolveVars(v)} !important;`).join(' '), parts);
    if (restore) add(`box-shadow: ${resolveVars(restore)} !important;`, parts.map(boost));
}

/* Вес «четыре id» для возврата жёстких теней — на один больше общего правила */
const WIDE = '#vte-lite#vte-lite#vte-lite';
const WIDER = '#vte-lite#vte-lite#vte-lite#vte-lite';

/** Селектор с большим весом: :is(#id×4, селектор) + псевдоэлемент в конце */
function boost(sel) {
    const m = sel.match(/^(.*?)(::?(?:before|after|placeholder|selection|marker|backdrop|first-line|first-letter|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+))$/i);
    const base = m ? m[1] : sel;
    const pe = m ? m[2] : '';
    if (!base.trim()) return '';
    return `:is(${WIDER}, ${base})${pe}`;
}

/* ============================================================
   ГРАДИЕНТЫ
============================================================ */
function patchGradient(st) {
    let bi = st.getPropertyValue('background-image').trim();
    const shorthand = st.getPropertyValue('background').trim();

    // Если в сокращённой записи есть var(), браузер не раскладывает её
    // на части, и background-image приходит пустым
    if (!bi && /gradient\(/i.test(shorthand)) bi = shorthand;
    if (!/gradient\(/i.test(bi)) return [];

    // Градиентный текст (background-clip: text + прозрачный цвет):
    // без градиента он станет невидимым — оставляем как есть
    const clip = `${st.getPropertyValue('background-clip')} ${st.getPropertyValue('-webkit-background-clip')}`;
    if (/text/i.test(clip)) return [];

    const out = [];
    const layers = splitTop(bi);
    const keep = layers.filter(l => !/gradient\(/i.test(l) && /url\(/i.test(l));
    out.push(['background-image', keep.length ? keep.join(', ') : 'none']);

    // Ничего не осталось — подставляем цвет первой точки градиента, иначе
    // элемент стал бы прозрачным. Если своё сплошное значение у правила уже
    // есть, не трогаем его.
    const bc = st.getPropertyValue('background-color').trim();
    const hasOwnColor = bc && !/^(initial|transparent|rgba\(0,\s*0,\s*0,\s*0\))$/i.test(bc);
    if (!keep.length && !hasOwnColor) {
        const c = firstColor(bi);
        if (c) out.push(['background-color', c]);
    }
    return out;
}

export function firstColor(v) {
    const m = String(v).match(/#[0-9a-f]{3,8}\b|rgba?\([^()]*\)|hsla?\([^()]*\)|oklch\([^()]*\)|var\(--[\w-]+(?:\s*,[^()]*)?\)/i);
    return m ? m[0] : '';
}

/* ============================================================
   ТЕНИ
============================================================ */
/**
 * Оставляет тени без размытия: '0 0 0 1px red' (рамка) остаётся,
 * '0 10px 30px rgba(...)' уходит. null — если менять нечего.
 */
function keepHardShadows(value) {
    const list = splitTop(value);
    const kept = list.filter((sh) => {
        const s = sh.trim();
        // Тень целиком в переменной — размытие не узнать; такие почти всегда мягкие
        if (/^var\([^()]*\)$/i.test(s)) return false;
        const lens = splitSpaces(s).filter(tok => /^-?(\d+\.?\d*|\.\d+)(px|em|rem|%|vh|vw)?$/i.test(tok));
        const blur = lens.length >= 3 ? parseFloat(lens[2]) : 0;
        return !blur;
    });
    if (kept.length === list.length) return null;
    return kept.length ? kept.join(', ') : 'none';
}

/* ============================================================
   РАЗБОР
============================================================ */
/** Убрать из filter функции с указанными именами, остальные сохранить */
function removeFunctions(value, names) {
    const re = new RegExp(`^(${names.map(n => n.replace('-', '\\-')).join('|')})\\(`, 'i');
    const parts = [];
    let depth = 0, buf = '';
    for (const c of value) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (/\s/.test(c) && depth === 0) {
            if (buf) parts.push(buf);
            buf = '';
            continue;
        }
        buf += c;
    }
    if (buf) parts.push(buf);
    return parts.filter(p => !re.test(p)).join(' ');
}

/** Разбить по запятым верхнего уровня */
export function splitTop(value) {
    const out = [];
    let depth = 0, buf = '';
    for (const c of String(value)) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
        buf += c;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

function splitSpaces(value) {
    const out = [];
    let depth = 0, buf = '';
    for (const c of String(value)) {
        if (c === '(') depth++;
        else if (c === ')') depth--;
        if (/\s/.test(c) && depth === 0) { if (buf) out.push(buf); buf = ''; continue; }
        buf += c;
    }
    if (buf) out.push(buf);
    return out;
}


/* ============================================================
   ГРАДИЕНТЫ ТЕМЫ — ПРЯМО В ЕЁ КОДЕ
   Заплатка на каждый градиент темы — это по правилу на градиент (у темы
   на 90 градиентов — 90 правил). Вместо этого меняем сам код темы:
   градиент превращается в цвет своей первой точки. Строк не прибавляется,
   тема становится даже короче. Вернуть — через «Отменить».
============================================================ */
const GRAD_RE = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/**
 * @param css   текст темы
 * @param index индекс правил темы (cssRules.buildIndex)
 * @param skip  (rule) => true для правил, которые трогать нельзя
 * @returns {{ css: string, count: number }}
 */
export function flattenThemeGradients(css, index, skip) {
    const edits = [];
    for (const rule of index.rules) {
        if (skip(rule)) continue;
        // Градиентный текст без градиента станет невидимым — не трогаем
        if (rule.decls.some(d => /background-clip$/.test(d.prop) && /text/i.test(d.value))) continue;

        for (const d of rule.decls) {
            if (d.prop !== 'background' && d.prop !== 'background-image') continue;
            if (!GRAD_RE.test(d.value)) continue;

            const layers = splitTop(d.value);
            const keep = layers.filter(l => !GRAD_RE.test(l));
            const bang = d.important ? ' !important' : '';
            let text;
            if (keep.some(l => /url\(/i.test(l))) {
                // Есть картинки — оставляем только их
                text = `${d.prop}: ${keep.join(', ')}${bang}`;
            } else {
                const grad = layers.find(l => GRAD_RE.test(l)) || '';
                const color = firstColor(grad);
                if (!color) continue;
                if (d.prop === 'background-image') {
                    text = `background-color: ${color}${bang}`;
                } else {
                    // background: linear-gradient(...) center / cover → background: цвет center / cover
                    const m = grad.match(GRAD_RE);
                    const start = grad.indexOf(m[0]);
                    let depth = 0, end = start;
                    for (let i = start; i < grad.length; i++) {
                        if (grad[i] === '(') depth++;
                        else if (grad[i] === ')') { depth--; if (depth === 0) { end = i + 1; break; } }
                    }
                    const rest = (grad.slice(0, start) + grad.slice(end)).trim();
                    text = `background: ${color}${rest ? ' ' + rest : ''}${bang}`;
                }
            }
            // Меняем ровно «свойство: значение»: отступ перед ним и «;» после
            // остаются на месте
            const lead = css.slice(d.start, d.valueStart).match(/^\s*/)[0].length;
            edits.push({ start: d.start + lead, end: d.valueEnd, text });
        }
    }
    edits.sort((a, b) => b.start - a.start);
    let out = css;
    for (const e of edits) {
        out = out.slice(0, e.start) + e.text + out.slice(e.end);
    }
    return { css: out, count: edits.length };
}
