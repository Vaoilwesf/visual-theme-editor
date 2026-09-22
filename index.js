// ===== Visual Theme Editor for SillyTavern =====
const MODULE = 'visual-theme-editor';
const BASE = `/scripts/extensions/third-party/${MODULE}`;

/* ============================================================
   ПОДКЛЮЧЕНИЕ К ST
============================================================ */
let _script = null, _extApi = null, _power = null;

async function connectST() {
    const tryImport = async (path) => {
        try { return await import(path); } catch { return null; }
    };
    _extApi = await tryImport('../../../extensions.js');
    _script = await tryImport('../../../../script.js');
    _power  = await tryImport('../../../power-user.js');
}

function ctx() {
    try { return window.SillyTavern?.getContext?.() ?? null; } catch { return null; }
}

function settingsRoot() {
    const s = ctx()?.extensionSettings
        ?? _extApi?.extension_settings
        ?? (window.extension_settings ??= {});
    if (!s[MODULE] || typeof s[MODULE] !== 'object') s[MODULE] = {};
    return s[MODULE];
}

const DEFAULTS = {
    enabled: true,
    highlightColor: '#4ea1ff',
    showCode: true,
    useVariables: true,
    liveApply: true,
    editInPlace: false,             // экспериментально: править код темы на месте
    followCode: true,               // панель кода сама прыгает к новым строкам
    hotkey: true,
    pickerOnStart: false,           // включать прицел сразу вместе с редактором
    pickOnce: true,                 // после выбора элемента прицел выключается
    hotkeyToggle: 'Alt+Shift+KeyE', // включить / выключить редактор
    hotkeyPick: 'Alt+Shift+KeyS',   // включить / выключить выбор элемента
    liteEffects: true,              // не предлагать в панели размытие и градиенты
    dock: 'off',                    // окно редактора у панели кода: off | left | right | top
    dockWidth: 0,                   // ширина присоединённого окна
    themeOverwrite: 'ask',          // правка поверх правила темы: ask | replace | layer
};

function cfg() {
    const s = settingsRoot();
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = v;
    }
    return s;
}

function persist() {
    try { ctx()?.saveSettingsDebounced?.(); }
    catch { _extApi?.saveSettingsDebounced?.(); }
}

/* ============================================================
   ЗАГРУЗКА МОДУЛЕЙ
============================================================ */
let selector, inspector, generator, fonts, editor, picker, rules, templates, perf, topbar, headers, avatars, gallery, bubbles;

async function loadModules() {
    const load = (name) => import(`${BASE}/modules/${name}.js`);
    [selector, inspector, generator, fonts, editor, picker, rules, templates, perf, topbar, headers, avatars, gallery, bubbles] = await Promise.all([
        load('selector'),
        load('inspector'),
        load('cssGenerator'),
        load('fontManager'),
        load('codeEditor'),
        load('colorPicker'),
        load('cssRules'),
        load('templates'),
        load('perfGuard'),
        load('topBar'),
        load('headers'),
        load('avatars'),
        load('gallery'),
        load('bubbles'),
    ]);
}


/* ============================================================
   СОСТОЯНИЕ
============================================================ */
let active = false;
let customCSS = '';
let history = [];
let future = [];
const HISTORY_LIMIT = 100;

/* ============================================================
   ЧТЕНИЕ / ЗАПИСЬ ПОЛЬЗОВАТЕЛЬСКОГО CSS
============================================================ */
function cssTextarea() {
    return document.getElementById('customCSS');
}

function readCSS() {
    const ta = cssTextarea();
    if (ta) return ta.value || '';
    try { if (_power?.power_user?.custom_css != null) return _power.power_user.custom_css; } catch {}
    return document.getElementById('custom-style')?.textContent || '';
}

/* Снимок темы на момент открытия окна инструмента. Нужен, чтобы кнопка
   «Вернуть как было» возвращала и то, что редактор заменил прямо в теме:
   обычный сброс убирает только наши строки, а правки на месте — нет. */
const toolSnapshots = new Map();

function snapshotFor(id) {
    if (!toolSnapshots.has(id)) toolSnapshots.set(id, customCSS);
}

function restoreFor(id) {
    const css = toolSnapshots.get(id);
    if (css == null || css === customCSS) return false;
    settlePending();
    pushHistory(css);
    clearPreviewStyles();
    writeCSS(css);
    toolSnapshots.delete(id);
    return true;
}

/** Окна инструментов читают CSS при открытии — после правок обновляем их */
function refreshTools() {
    for (const tool of [topbar, headers, avatars, gallery, bubbles]) {
        try { if (tool?.isOpen?.()) tool.refresh?.(); } catch {}
    }
    try { if (fontsPanel && fontsPanel.style.display !== 'none') renderFontsTheme(); } catch {}
    inspector.refreshTools?.();
}

let toolWriting = false;   // пишет сам инструмент — обновлять его окно не надо

function writeCSS(css, opts = {}) {
    customCSS = css;
    // Любая правка CSS (код, отмена, другое окно) — окна инструментов
    // перечитывают свои значения из темы
    if (!toolWriting) setTimeout(refreshTools, 0);

    const ta = cssTextarea();
    if (ta) {
        ta.value = css;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        applyDirect(css);
        try {
            if (_power?.power_user) {
                _power.power_user.custom_css = css;
                persist();
            }
        } catch {}
    }

    if (!opts.skipEditor && editor?.isOpen?.()) {
        editor.setContent(css, { silent: true });
    }
    scheduleParse(css);
}

/** Разбор CSS на переменные — тяжёлая операция, откладываем её */
let parseTimer = null;
let parsedOutside = null;
function scheduleParse(css) {
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
        // Разбор ищет переменные темы. Если изменился только блок «Мои
        // правки» и в нём нет своих переменных — разбирать всю тему незачем
        // (на теме в 400+ КБ это ~50 мс на каждую правку)
        const r = rules.findAutoRange(css);
        const outside = r ? css.slice(0, r.start) + css.slice(r.end) : css;
        const autoHasVars = r ? /--[\w-]+\s*:/.test(css.slice(r.start, r.end)) : false;
        if (outside === parsedOutside && !autoHasVars) return;
        parsedOutside = outside;
        generator.parse(css);
    }, 400);
}


function applyDirect(css) {
    let style = document.getElementById('custom-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'custom-style';
        document.head.appendChild(style);
    }
    style.textContent = css;
}

/* ============================================================
   ИСТОРИЯ
============================================================ */
function pushHistory(css) {
    if (history[history.length - 1] === css) return;
    history.push(css);
    if (history.length > HISTORY_LIMIT) history.shift();
    future.length = 0;
    updateHistoryButtons();
}

/**
 * Довести до CSS всё, что ещё висит в очередях, — ОДНИМ шагом истории.
 *
 * Раньше перед отменой очередь просто выбрасывалась. Из-за этого было
 * два бага сразу:
 *  - запись из поля панели (у неё своя задержка 40 мс) срабатывала уже
 *    ПОСЛЕ отмены и возвращала значение назад — «отмена не сработала»;
 *  - если правка висела в очереди, предпросмотр гас, и вдобавок снимался
 *    предыдущий настоящий шаг — отмена перескакивала через шаг.
 * Теперь незаписанная правка становится обычным шагом, и отмена снимает
 * ровно её.
 */
function settlePending() {
    try { inspector.flushPending?.(); } catch {}
    flushCommits();
    try { editor.flushPending?.(); } catch {}
    clearTimeout(revealTimer);
    try { editor.clearFlash?.(); } catch {}
}

function undo() {
    settlePending();
    if (history.length < 2) return;

    future.push(history.pop());
    const css = history[history.length - 1];

    // Слой предпросмотра держит значения с !important и перекрывает
    // откаченный CSS. Без этой строки отмена не видна на экране.
    clearPreviewStyles();

    writeCSS(css);
    syncTemplateToCss(css);
    refreshTools();
    updateHistoryButtons();
    refreshInspector();
    toast('Отменено');
}

function redo() {
    // Новая правка до «вернуть» обнуляет будущее — как в любом редакторе
    settlePending();
    if (!future.length) return;

    const css = future.pop();
    history.push(css);
    clearPreviewStyles();
    writeCSS(css);
    syncTemplateToCss(css);
    refreshTools();
    updateHistoryButtons();
    refreshInspector();
    toast('Возвращено');
}

/**
 * После отмены поля панели обязаны перечитать значения из CSS.
 * Небольшая задержка нужна, чтобы браузер успел применить новый стиль.
 */
let refreshTimer = null;
function refreshInspector() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        try { inspector.refreshValues?.(); } catch {}
    }, 120);
}


function updateHistoryButtons() {
    const u = document.getElementById('vte-undo');
    const r = document.getElementById('vte-redo');
    if (u) u.disabled = history.length < 2;
    if (r) r.disabled = future.length === 0;
    // Кнопки панели кода показывают ту же общую историю
    try { editor?.setHistoryState?.(history.length >= 2, future.length > 0); } catch {}
}

/* ============================================================
   ЖИЗНЕННЫЙ ЦИКЛ РЕДАКТОРА
============================================================ */
function toggleEditor() {
    active ? deactivate() : activate();
}

function activate() {
    if (active) return;
    active = true;

    customCSS = readCSS();
    generator.parse(customCSS);
    picker.setSwatches(generator.getVariables().map(v => ({ name: v.name, value: v.value })));
    history = [customCSS];
    future = [];

    document.body.classList.add('vte-active');

    inspector.createPanel();
    selector.setHighlightColor(cfg().highlightColor);

    if (cfg().showCode) {
        editor.showPanel();
        editor.setContent(customCSS, { silent: true });
    }

    updateHistoryButtons();
    updateToggleUI();
    updatePickUI();
    applyDock();
    inspector.refreshTools?.();

    // Прицел больше не включается сам: только если это явно разрешено в настройках
    if (cfg().pickerOnStart) {
        startPicking();
    } else {
        toast(`Редактор включён. Выбор элемента — ${comboLabel(cfg().hotkeyPick)}`);
    }
}

function deactivate() {
    if (!active) return;
    active = false;

    // Сначала дописываем всё, что ещё висит в очереди, и только потом
    // снимаем слой предпросмотра. Иначе значения, не успевшие попасть
    // в CSS, просто исчезали с экрана.
    flushCommits();

    selector.deactivate();
    inspector.hidePanel();
    editor.hidePanel();
    templates?.stopCollect?.();
    templates?.hidePanel?.();
    if (fontsPanel) fontsPanel.style.display = 'none';
    headers?.hidePanel?.();
    avatars?.hidePanel?.();
    bubbles?.hidePanel?.();
    gallery?.hidePanel?.();
    // cleanup вместо stopPreview: снимает ещё и наблюдатель видимости
    // вместе с тегами <link>, подгруженными ради предпросмотра списка
    fonts.cleanup?.() ?? fonts.stopPreview?.();
    clearPreviewStyles();

    document.body.classList.remove('vte-active');
    updateToggleUI();
    updatePickUI();
    toast('Редактор выключен');
}


/* ---------- Режим выбора элемента: живёт отдельно от редактора ---------- */
function togglePicking() {
    selector.isActive() ? stopPicking() : startPicking();
}

function startPicking() {
    if (!active) {
        activate();
        if (selector.isActive()) return; // pickerOnStart уже включил
    }
    if (selector.isActive()) return;

    // Во время набора шаблона панель свойств не нужна: она открылась бы
    // пустой и накрыла собой панель шаблонов
    if (!templates?.isCollecting?.()) inspector.createPanel();

    selector.setHighlightColor(cfg().highlightColor);
    selector.activate();
    toast('Выберите элемент. Esc — выйти из режима выбора.');
}


function stopPicking() {
    if (!selector.isActive()) return;
    flushCommits();
    selector.deactivate();
}

function isPicking() {
    return !!selector?.isActive?.();
}

function clearPreviewStyles() {
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    document.getElementById('vte-live-preview')?.remove();
    previewStyle = null;
    previewRules.clear();
}

/* ============================================================
   ЖИВОЙ ПРЕДПРОСМОТР
============================================================ */
let previewRules = new Map();
let previewStyle = null;

function previewProperty(sel, prop, value) {
    if (!cfg().liveApply) return;
    if (!previewStyle || !previewStyle.isConnected) {
        previewStyle = document.createElement('style');
        previewStyle.id = 'vte-live-preview';
        document.head.appendChild(previewStyle);
    }
    if (!previewRules.has(sel)) previewRules.set(sel, new Map());
    if (value === '' || value == null) previewRules.get(sel).delete(prop);
    else previewRules.get(sel).set(prop, value);

    // Не чаще раза за кадр. Декор, например, присылает 13 свойств на одно
    // движение ползунка — раньше это были 13 перезаписей стиля подряд,
    // и каждая заставляла браузер заново разбирать и применять его
    if (!previewRaf) previewRaf = requestAnimationFrame(flushPreview);
}

let previewRaf = 0;

function flushPreview() {
    previewRaf = 0;
    if (!previewStyle) return;
    let css = '';
    for (const [s, decls] of previewRules) {
        if (!decls.size) continue;
        css += `${s}{`;
        for (const [p, v] of decls) css += `${p}:${v} !important;`;
        css += '}\n';
    }
    if (previewStyle.textContent !== css) previewStyle.textContent = css;
}

function dropPreviewFor(sel) {
    previewRules.delete(sel);
    if (previewStyle && !previewRules.size) previewStyle.textContent = '';
}

/* ============================================================
   ОБРАБОТЧИКИ МОДУЛЕЙ
============================================================ */
/* ---------- Индекс правил темы, пересобирается при смене CSS ---------- */
let ruleIndex = null;
let ruleIndexFor = null;

// Элемент, который правится прямо сейчас. Нужен, чтобы решить, требуется ли
// !important: без элемента невозможно узнать, какое правило темы конкурирует.
let currentElement = null;

/* ---------- Кеш заявленных свойств темы ----------
   needsImportant спрашивается на каждое записываемое свойство, а внутри
   шёл полный обход индекса. При записи иконки это двадцать с лишним
   обходов подряд по одному и тому же индексу и одному элементу.
   Теперь карта строится один раз на элемент и живёт до изменения CSS. */
let declCache = new Map();
let declCacheFor = null;

function declMap(pseudo, includeAuto) {
    if (!currentElement || !currentElement.isConnected) return null;

    if (!declCacheFor
        || declCacheFor.css !== customCSS
        || declCacheFor.el !== currentElement) {
        declCache = new Map();
        declCacheFor = { css: customCSS, el: currentElement };
    }

    const key = (pseudo || '') + (includeAuto ? '|a' : '');
    if (declCache.has(key)) return declCache.get(key);

    let map = null;
    try {
        map = rules.declarationMap(
            getRuleIndex(), currentElement, pseudo || null,
            { includeAuto: !!includeAuto });
    } catch {}

    declCache.set(key, map);
    return map;
}

/**
 * Нужен ли !important, чтобы наша запись действительно сработала.
 *
 * Логика простая и честная:
 *   тема свойство не задаёт          → не нужен
 *   тема задаёт с !important         → нужен, иначе не перебить
 *   тема задаёт без !important       → нужен только если её селектор сильнее
 *
 * По незнанию отвечаем true: лучше лишний !important, чем правка,
 * которая молча не применилась.
 */
function needsImportant(sel, property) {
    const key = String(sel || '').trim();
    if (!key || key === ':root') return false;
    if (!currentElement || !currentElement.isConnected) return true;

    const parts = key.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return true;

    // Псевдоэлемент берём из первой части: у списка он одинаковый
    const { pseudo } = rules.splitPseudo(parts[0]);

    const map = declMap(pseudo, false);
    if (!map) return true;

    const hit = map.get(String(property).toLowerCase());
    if (!hit) return false;
    if (hit.important) return true;

    // Правило должно победить для КАЖДОЙ своей части, поэтому берём
    // самую слабую из них.
    let ownScore = Infinity;
    for (const p of parts) {
        ownScore = Math.min(ownScore, rules.specificityScore(p));
    }
    return ownScore <= hit.score;
}


function getRuleIndex() {
    const css = customCSS || readCSS();
    if (!ruleIndex || ruleIndexFor !== css) {
        ruleIndex = rules.buildIndex(css);
        ruleIndexFor = css;
    }
    return ruleIndex;
}

/* ---------- Кеш ширины селектора ----------
   Сколько элементов страницы задевает селектор. Спрашивается десятки раз
   на один клик: по трём псевдоэлементам, по цепочке родительских id и по
   каждому классу элемента. Раньше каждый такой вопрос был отдельным
   querySelectorAll по всему документу.
   Живёт полсекунды: за это время разметка не успевает измениться. */
let widthCache = new Map();
let widthCacheAt = 0;

function selectorWidth(sel) {
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


function shortLabel(v) {
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s.length > 46 ? s.slice(0, 43) + '…' : s;
}

/* Шире этого числа селектор темы не предлагаем: правка расползётся
   по всему интерфейсу вместо выбранного элемента. */
const THEME_MAX_HITS = 40;

/**
 * Селекторы из темы, которые реально попадают в этот элемент.
 *
 * Отбор идёт по трём признакам, в этом порядке важности:
 *   1. ширина — сколько элементов страницы задевает правило
 *   2. каскад — кто из подходящих побеждает прямо сейчас
 *   3. позиция — при равном весе ниже в файле значит сильнее
 *
 * Раньше ширина не проверялась вообще. Из-за этого 'body', '*' и
 * '.drawer-icon' попадали в список наравне с точным селектором, а
 * первым оказывался просто тот, что раньше встретился в тексте темы.
 * Клик по фону топбара перекрашивал что угодно, кроме топбара.
 */
function themeSelectorsFor(el, pseudo) {
    const out = [];
    let matches = [];
    try {
        matches = rules.findMatches(getRuleIndex(), el, pseudo || null) || [];
    } catch (err) {
        console.warn('[VTE] Не удалось разобрать CSS темы:', err);
        return out;
    }

    for (const m of matches) {
        if (m.part.states.length) continue;            // :hover вслепую не правим
        if (!rules.isContextActive(m.rule)) continue;  // @media, который сейчас не действует

        const value = m.part.raw;
        if (out.some(o => o.value === value)) continue;

        // Считаем по базовой части: '#x .y::after' проверяем как '#x .y',
        // иначе querySelectorAll вернёт ноль на любом псевдоэлементе
        const hits = selectorWidth(m.part.matchable || m.part.base || value);
        if (hits === 0 || hits > THEME_MAX_HITS) continue;

        out.push({
            value,
            label: (hits === 1 ? 'только этот · ' : `${hits} шт. · `) + shortLabel(value),
            source: 'theme',
            hint: rules.describeRule(m.rule) + (hits > 1
                ? ` — правка затронет ${hits} элементов`
                : ''),
            hits,
            score: m.score,
        });
    }

    out.sort((a, b) => a.hits - b.hits || b.score - a.score);
    return out.slice(0, 5);
}


/** Сам элемент ничего не рисует, а псевдоэлемент рисует? Значит правим псевдо. */
function isVisuallyEmpty(el) {
    try {
        const cs = getComputedStyle(el);
        const fs = parseFloat(cs.fontSize) || 0;
        const textHidden = fs < 4
            || cs.color === 'transparent'
            || /rgba\(0, 0, 0, 0\)/.test(cs.color || '');
        const noText = !String(el.textContent || '').trim() || textHidden;
        const noBg = cs.backgroundImage === 'none'
            && (!cs.backgroundColor || /transparent|rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor));
        return noText && noBg;
    } catch {
        return false;
    }
}

function cssEsc(v) {
    if (window.CSS?.escape) return CSS.escape(v);
    return String(v).replace(/([^\w-])/g, '\\$1');
}

/**
 * Собирает селектор, который целится ТОЛЬКО в этот элемент и при этом
 * сильнее правил темы. Без усиления `#rightNavDrawerIcon::after` (10001)
 * проигрывает `#top-settings-holder .drawer-icon::after` (10101),
 * и правка просто не видна.
 *
 * Обращения к DOM идут через selectorWidth: раньше каждая проверка
 * стоила el.matches плюс отдельный querySelectorAll по документу, и на
 * цепочке родителей со списком классов это давало десятки полных обходов.
 */
function strongSelectorFor(el, base, pseudo, competitors) {
    if (!base) return null;

    const need = competitors.reduce(
        (max, c) => Math.max(max, rules.specificityScore(c)), 0);

    const hits = (s) => {
        try { return el.matches(s) ? selectorWidth(s) : 0; }
        catch { return 0; }
    };
    const stronger = (s) => rules.specificityScore(s + pseudo) > need;

    if (hits(base) === 1 && stronger(base)) {
        return { value: base + pseudo, unique: true };
    }

    // Добавляем родительские id: каждый поднимает специфичность на 10000
    const ids = [];
    let p = el.parentElement;
    while (p && p !== document.documentElement && ids.length < 4) {
        if (p.id && /^[a-z][\w-]{1,60}$/i.test(p.id)) ids.push('#' + cssEsc(p.id));
        p = p.parentElement;
    }

    let cur = base;
    for (const id of ids) {
        cur = `${id} ${cur}`;
        if (hits(cur) === 1 && stronger(cur)) {
            return { value: cur + pseudo, unique: true };
        }
    }

    // Не хватило — доводим собственными классами элемента
    let withClasses = cur;
    for (const c of Array.from(el.classList)) {
        if (c.startsWith('vte-')) continue;
        withClasses += '.' + cssEsc(c);
        if (hits(withClasses) === 1 && stronger(withClasses)) {
            return { value: withClasses + pseudo, unique: true };
        }
    }

    const wide = hits(withClasses);
    const mid = hits(cur);
    const best = wide ? withClasses : (mid ? cur : base);
    return { value: best + pseudo, unique: hits(best) === 1 };
}

function buildTargets(el) {
    const base = generator.generateSelector(el);
    if (!base) return null;

    // Слои предлагаем всегда: ::before и ::after — это законные цели,
    // даже если сейчас они ничего не рисуют. Вкладка «Картинка» сама
    // допишет content, когда положит туда изображение.
    const pseudos = ['', '::before', '::after'];

    const options = {};
    for (const p of pseudos) {
        const theme = themeSelectorsFor(el, p);
        const list = [];

        // Персональный селектор идёт ПЕРВЫМ и становится выбором по
        // умолчанию: панель берёт options[pseudo][0]. Раньше первым стоял
        // селектор темы, поэтому клик по фону топбара уводил правку в
        // широкое чужое правило, и перекрашивалось не то, что выбрали.
        const own = strongSelectorFor(el, base, p, theme.map(t => t.value));
        if (own) {
            list.push({
                value: own.value,
                label: (own.unique ? 'только этот элемент — ' : 'этот элемент — ')
                    + shortLabel(own.value),
                source: 'generated',
                hint: own.unique
                    ? 'Новое правило, затронет только выбранный элемент'
                    : 'Новое правило, но селектор попадает и в другие элементы',
            });
        }

        // Правила темы — ниже, отсортированные от узких к широким.
        // Их всё равно видно в списке: если человек хочет править саму
        // тему, он выбирает их сам и осознанно.
        for (const t of theme) {
            if (list.some(o => o.value === t.value)) continue;
            list.push(t);
        }

        options[p] = list;
    }

    // Сам элемент ничего не рисует, а псевдоэлемент рисует — целимся в псевдо
    let pseudo = '';
    const painted = ['::before', '::after'].filter(p => rules.hasPseudo(el, p));
    if (painted.length && isVisuallyEmpty(el)) pseudo = painted[painted.length - 1];

    return { element: el, pseudos, pseudo, baseSelector: base, options };
}


function inspectElement(el) {
    if (!el || el.nodeType !== 1) return;

    currentElement = el;
    declCacheFor = null;   // карта свойств строится под конкретный элемент

    const info = buildTargets(el);
    if (!info) {
        toast('Не удалось определить селектор для этого элемента');
        return;
    }

    const start = info.options[info.pseudo]?.[0]?.value
        || (info.baseSelector + info.pseudo);

    inspector.populateProperties(el, rules.computedFor(el, info.pseudo), start, info);

    if (info.pseudo) {
        toast(`Целюсь в ${info.pseudo} — картинка нарисована там`);
    }
}

function handleElementSelected(el) {
    // Идёт набор шаблона — элемент уходит в группу, панель свойств не трогаем
    // и прицел не гасим: человек набирает несколько элементов подряд.
    if (templates?.isCollecting?.() && templates.handlePicked(el)) return;
    editingGroupId = null;   // обычный элемент — уже не группа

    inspectElement(el);
    // По умолчанию прицел выключается сразу после выбора, чтобы не мешал работать
    if (cfg().pickOnce) stopPicking();
}

/* ============================================================
   ПРАВКА ГРУППЫ ЭЛЕМЕНТОВ ПО ШАБЛОНУ

   У группы нет одного элемента, поэтому значения для полей панели
   читаются с первого найденного элемента-представителя, а запись
   идёт в общий селектор со списком через запятую.
============================================================ */
/** Режет список селекторов по запятым верхнего уровня, не трогая
 *  запятые внутри :not(...), :is(...) и [attr="a, b"] */
function splitSelectorList(sel) {
    const out = [];
    let depth = 0, quote = '', buf = '';
    const src = String(sel || '');
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            buf += c;
            if (c === '\\') { buf += src[++i] || ''; continue; }
            if (c === quote) quote = '';
            continue;
        }
        if (c === '"' || c === "'") { quote = c; buf += c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
        if (c === ',' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
        buf += c;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

let editingGroupId = null;   // шаблон, который сейчас открыт в панели свойств

function editTemplateGroup(groupSelector, tpl, opts = {}) {
    if (!groupSelector) return;
    if (!active) activate();

    const parts = splitSelectorList(groupSelector);

    // Представитель: первый элемент, который реально есть на странице
    let sample = null;
    for (const part of parts) {
        try { sample = document.querySelector(part); } catch { sample = null; }
        if (sample) break;
    }

    if (!sample) {
        toast('Ни один элемент шаблона сейчас не найден на странице', 'warning');
        return;
    }

    editingGroupId = tpl?.id || null;
    // С этого момента у шаблона есть правки: при смене состава они поедут следом
    templates?.markEdited?.(tpl);

    currentElement = sample;
    declCacheFor = null;

    // Псевдоэлемент нужно дописать КАЖДОМУ селектору списка.
    // 'a, b' + '::after' → 'a::after, b::after'.
    // Простая склейка давала 'a, b::after' и правило доезжало только до b.
    const spread = (p) => p
        ? parts.map(s => s + p).join(', ')
        : groupSelector;

    const pseudos = ['', '::before', '::after'];
    const options = {};
    for (const p of pseudos) {
        options[p] = [{
            value: spread(p),
            label: `группа «${tpl?.name || 'шаблон'}» — ${parts.length} ${parts.length === 1 ? 'селектор' : 'селект.'}`,
            source: 'generated',
            hint: spread(p),
        }];
    }

    const info = {
        element: sample,
        pseudos,
        pseudo: '',
        baseSelector: groupSelector,
        options,
    };

    inspector.populateProperties(sample, rules.computedFor(sample, ''), groupSelector, info);
    inspector.setGroup(tpl?.name || 'шаблон');
    if (!opts.quiet) toast(`Правим группу «${tpl?.name || 'шаблон'}» — правки пойдут на все элементы`);
}

/**
 * Состав шаблона изменился (добавили, убрали, обобщили, исключили).
 * Если группу уже правили, её правила в авто-блоке переписываются на новый
 * список: новый элемент сразу получает цвет, размеры и всё остальное,
 * а убранный — перестаёт.
 */
/* Состав шаблона на момент конкретного CSS. Шаблоны живут в настройках,
   а не в CSS, поэтому общая отмена сама их не откатывает: без этого
   после «Отменить» правило вернулось бы к старому списку, а шаблон
   остался с новым, и следующие правки легли бы в отдельное правило. */
const templateStates = new Map();   // css -> { id, items }

function rememberTemplateState(css, id, items) {
    templateStates.set(css, { id, items });
    if (templateStates.size > HISTORY_LIMIT * 2) {
        templateStates.delete(templateStates.keys().next().value);
    }
}

function syncTemplateToCss(css) {
    const st = templateStates.get(css);
    if (!st) return;
    try { templates.restoreItems(st.id, st.items); } catch {}

    // Панель свойств смотрит на этот шаблон — перенаводим на вернувшийся состав
    if (editingGroupId === st.id && active) {
        const t = templates.getById?.(st.id);
        const sel = t ? templates.groupSelectorOf(t) : '';
        if (sel) setTimeout(() => editTemplateGroup(sel, t, { quiet: true }), 150);
    }
}

/* ============================================================
   ПРАВИЛА ТЕМЫ ДЛЯ ТОП-БАРА
============================================================ */
function topbarTargets() {
    const bar = document.getElementById('top-bar');
    const holder = document.getElementById('top-settings-holder');
    const icons = [...(holder?.querySelectorAll('.drawer-icon') || [])];
    const els = [bar, holder, ...icons].filter(Boolean);
    // По чему узнаём селекторы топ-бара: id самих элементов и их кнопок
    const tokens = new Set(['top-bar', 'top-settings-holder', 'drawer-icon']);
    for (const el of icons) {
        if (el.id) tokens.add(el.id);
        const d = el.closest('#top-settings-holder > *[id]');
        if (d) tokens.add(d.id);
    }
    return { els, tokens: [...tokens] };
}

/** Где в теме лежит блок облегчения — его правила не считаем правилами темы */
function perfRange() {
    try { return perf.findPerfBlock(customCSS); } catch { return null; }
}

const inPerf = (rule, pb) => !!pb && rule.ruleStart >= pb.start && rule.ruleEnd <= pb.end;

const safeMatch = (el, sel) => {
    if (!sel) return false;
    try { return el.matches(sel); } catch { return false; }
};

/**
 * Правило касается только этих элементов? Тогда его строку можно удалить,
 * не задев ничего другого. Например, «#ai-config-button .drawer-icon,
 * #leftNavDrawerIcon { --icon: … }» — два селектора, но оба про один значок.
 */
function ruleIsExclusive(rule, targets) {
    const set = new Set(targets);
    return rule.parts.every(p => {
        let found;
        try { found = document.querySelectorAll(p.matchable || '*'); } catch { return false; }
        if (!found.length || found.length > set.size) return false;
        for (const el of found) if (!set.has(el)) return false;
        return true;
    });
}

/** Где в теме (не в наших блоках) объявлена переменная */
function findVarDecl(name) {
    let idx;
    try { idx = getRuleIndex(); } catch { return null; }
    const pb = perfRange();
    for (const rule of idx?.rules || []) {
        if (rule.inAutoBlock || inPerf(rule, pb)) continue;
        const d = rule.decls.find(x => x.prop === name);
        if (d) return d;
    }
    return null;
}

/** Сколько раз переменная используется через var(--имя) во всей теме */
function usesOf(css, name) {
    let n = 0, i = 0;
    const needle = `var(${name}`;
    while ((i = css.indexOf(needle, i)) !== -1) {
        const next = css[i + needle.length] || '';
        if (!/[\w-]/.test(next)) n++;
        i += needle.length;
    }
    return n;
}

/** В селекторе есть именно этот #id (а не #id-что-то-ещё) */
function hasToken(raw, token) {
    let i = raw.indexOf(token);
    while (i !== -1) {
        const next = raw[i + token.length] || '';
        if (!/[\w-]/.test(next)) return true;
        i = raw.indexOf(token, i + 1);
    }
    return false;
}

/**
 * Все места темы, которые меняют конкретный значок: его символ, картинку,
 * переменную вроде --icon, размер и цвет. Для кнопки «Показать в коде».
 */
function themeIconRules(el) {
    let idx;
    try { idx = getRuleIndex(); } catch { return []; }
    if (!idx || !el) return [];
    const pb = perfRange();
    const tokens = [el.id, el.closest('#top-settings-holder > *[id]')?.id].filter(Boolean).map(t => `#${t}`);

    // Правило именно про этот значок: в селекторе его #id или id кнопки,
    // либо селектор вообще находит всего пару элементов (класс значка,
    // позиция :first-child, атрибут…). Общие правила вроде «.drawer-icon»
    // сюда не попадают — они в списке «Уже в теме»
    const narrow = (p) => {
        if (tokens.some(t => hasToken(p.raw, t))) return true;
        try { return document.querySelectorAll(p.matchable).length <= 2; } catch { return false; }
    };

    const out = [];
    const vars = new Set();
    for (const rule of idx.rules) {
        if (rule.inAutoBlock || inPerf(rule, pb)) continue;
        const hit = rule.parts.some(p => safeMatch(el, p.matchable) && narrow(p));
        if (!hit) continue;
        out.push({ from: rule.ruleStart, to: rule.ruleEnd });
        // Какие переменные рисуют значок: content: var(--icon)
        for (const d of rule.decls) {
            const m = d.prop === 'content' && d.value.match(/var\(\s*(--[\w-]+)/);
            if (m) vars.add(m[1]);
        }
    }

    // Объявления этих переменных — только сами строки, а не весь :root
    if (vars.size) {
        for (const rule of idx.rules) {
            if (rule.inAutoBlock || inPerf(rule, pb)) continue;
            const scoped = rule.parts.some(p => safeMatch(el, p.matchable) || /^(:root|html)$/i.test(p.raw.trim()));
            if (!scoped) continue;
            for (const d of rule.decls) {
                if (vars.has(d.prop) && !out.some(r => d.start >= r.from && d.end <= r.to)) {
                    out.push({ from: d.start, to: d.end });
                }
            }
        }
    }
    return out;
}

/**
 * Правила темы для набора селекторов (окно «Заголовки»). Проверяем по одному
 * живому элементу на каждый селектор — на теме в тысячи правил проверка
 * всех двухсот заголовков страницы была бы слишком дорогой.
 */
function themeRulesForParts(parts) {
    let idx;
    try { idx = getRuleIndex(); } catch { return []; }
    if (!idx || !parts?.length) return [];
    const pb = perfRange();
    const samples = [];
    for (const p of parts) {
        try { const el = document.querySelector(p); if (el && !samples.includes(el)) samples.push(el); } catch {}
    }
    if (!samples.length) return [];
    // Слова из самих селекторов инструмента: так список «Уже в теме»
    // работает и для заголовков, и для аватарок, и для чего угодно
    const tokens = [...new Set(parts.flatMap(p => p.match(/[.#][\w-]+|\b[a-z]+\d?\b/gi) || [])
        .map(t => t.replace(/^[.#]/, ''))
        .filter(t => t.length > 2))];
    const out = [];
    for (const rule of idx.rules) {
        if (rule.inAutoBlock || inPerf(rule, pb)) continue;
        const hit = rule.parts.some(p => tokens.some(t => p.raw.includes(t)) && samples.some(el => safeMatch(el, p.matchable)));
        if (!hit) continue;
        const sel = rule.parts.map(p => p.raw).join(', ');
        out.push({
            selector: sel.length > 90 ? `${sel.slice(0, 88)}…` : sel,
            props: rule.decls.map(d => d.prop).slice(0, 6).join(', ') + (rule.decls.length > 6 ? '…' : ''),
            from: rule.ruleStart,
            to: rule.ruleEnd,
        });
    }
    return out;
}

/** Правила самой темы (не «Мои правки»), которые трогают топ-бар и его значки */
function themeTopbarRules() {
    let idx;
    try { idx = getRuleIndex(); } catch { return []; }
    if (!idx) return [];
    const pb = perfRange();
    const { els, tokens } = topbarTargets();
    const out = [];

    for (const rule of idx.rules) {
        if (rule.inAutoBlock || inPerf(rule, pb)) continue;
        const hit = rule.parts.some(p =>
            tokens.some(t => p.raw.includes(t)) && els.some(el => safeMatch(el, p.matchable)));
        if (!hit) continue;
        const sel = rule.parts.map(p => p.raw).join(', ');
        out.push({
            selector: sel.length > 90 ? `${sel.slice(0, 88)}…` : sel,
            props: rule.decls.map(d => d.prop).slice(0, 6).join(', ') + (rule.decls.length > 6 ? '…' : ''),
            from: rule.ruleStart,
            to: rule.ruleEnd,
        });
    }
    return out;
}

/**
 * Какие объявления темы перекроет запись. Считаем только правила того же
 * элемента и того же слоя (::before / ::after), без :hover и прочих состояний.
 */
function findThemeConflicts(entries) {
    let idx;
    try { idx = getRuleIndex(); } catch { return []; }
    if (!idx) return [];
    const pb = perfRange();
    const found = new Map();

    // Спрашиваем только про то, что меняется сейчас. Инструмент присылает
    // всё своё состояние целиком, и без этой проверки вопрос повторялся бы
    // на каждое движение любого ползунка
    const mine = generator.autoRules(customCSS);
    const bare = (v) => String(v || '').replace(/\s*!important\s*$/i, '').trim();

    for (const e of entries) {
        if (!e.value) continue;
        const key = e.selector.replace(/\s+/g, ' ').trim();
        if (bare(mine.get(key)?.get(e.property)) === bare(e.value)) continue;

        // Селектор может быть списком (окно «Заголовки» пишет одно правило на
        // группу). Все части должны быть про один слой и одно состояние —
        // «.a::before, .b::before» или «.a:hover, .b:hover»
        const pieces = splitSelectorList(e.selector).map(one => {
            const { base, pseudo } = rules.splitPseudo(one);
            const { selector: plain, states } = rules.stripStates(base);
            return { plain, pseudo, states: [...states].sort().join('') };
        });
        const { pseudo, states } = pieces[0];
        if (pieces.some(x => x.pseudo !== pseudo || x.states !== states)) continue;
        let targets = [];
        try {
            const set = new Set();
            for (const x of pieces) for (const el of document.querySelectorAll(x.plain)) { if (set.size < 400) set.add(el); }
            targets = [...set];
        } catch { continue; }
        if (!targets.length) continue;

        // Значок уже показывает этот символ (например, мы раньше поменяли
        // --icon прямо в теме) — менять и спрашивать нечего
        if (e.property === 'content') {
            const want = String(e.value).replace(/\\([0-9a-f]{1,6})\s?/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)));
            let shown = false;
            try { shown = getComputedStyle(targets[0], pseudo).content === want; } catch {}
            if (shown) {
                // Показывает сама тема, а не «Мои правки» (их проверили выше) —
                // дублировать в «Мои правки» не нужно
                e.value = '';
                continue;
            }
        }

        for (const rule of idx.rules) {
            if (!e.value) break;
            if (rule.inAutoBlock || inPerf(rule, pb)) continue;
            // «Выключатель» картинки должен найти и сокращённую запись:
            // тема могла написать background: url(...), а не background-image
            const FAMILY = { 'background-image': ['background-image', 'background'], 'mask': ['mask', '-webkit-mask'], '-webkit-mask': ['-webkit-mask', 'mask'] };
            const props = e.neutral && FAMILY[e.property] ? FAMILY[e.property] : [e.property];
            // Все подходящие строки правила (у маски их обычно две: mask и -webkit-mask)
            for (const decl of rule.decls.filter(d => props.includes(d.prop))) {
                // Одна строка темы может мешать сразу нескольким значкам —
                // ключ по строке И по записи
                const fkey = `${decl.start}|${e.selector}|${e.property}`;
                if (found.has(fkey)) continue;
                // Служебные части приёма «значок в ::after»: font-size:0 и
                // прозрачный цвет на самом значке. Это не оформление, а способ
                // спрятать старый символ — трогать и спрашивать про них нельзя
                if (!e.neutral && /^font-size$/.test(decl.prop) && /^0(px)?$/.test(decl.value.trim())) continue;
                if (!e.neutral && decl.prop === 'color' && /^transparent$/i.test(decl.value.trim())) continue;
                const part = rule.parts.find(p => p.pseudo === pseudo
                    && [...p.states].sort().join('') === states
                    && targets.some(el => safeMatch(el, p.matchable)));
                if (!part) continue;
                // Тема уже задаёт ровно это значение ЭТОМУ ЖЕ элементу —
                // писать и спрашивать нечего. Раньше эта проверка стояла до
                // сверки элемента, и чужое правило с тем же значением
                // (например, position: absolute у подписи карточки) молча
                // выбрасывало нашу строку для аватара
                if (bare(decl.value) === bare(e.value)) { e.value = ''; break; }
                found.set(fkey, {
                    rule, decl, prop: e.property, selector: part.raw,
                    single: ruleIsExclusive(rule, targets),
                    targets,
                    entry: e,
                });
            }
        }
    }
    return [...found.values()];
}

/* ---------- «Заменить в теме или добавить поверх?» ---------- */
const layeredOnce = new Set();   // на что в этом сеансе уже ответили «поверх»

function askOverwrite(conflicts) {
    return new Promise((resolve) => {
        const lines = [...new Set(conflicts.map(c => `${c.selector} → ${c.decl.prop}`))].slice(0, 6);
        if (conflicts.length > 6) lines.push(`…и ещё ${conflicts.length - 6}`);
        const remember = h('input', { type: 'checkbox' });

        const close = (answer) => {
            box.remove();
            if (answer && remember.checked) {
                cfg().themeOverwrite = answer;
                persist();
            }
            resolve(answer);
        };

        const box = h('div#vte-confirm.vte-confirm', {}, [
            h('div.vte-confirm-card', {}, [
                h('div.vte-confirm-title', { text: 'Это уже задано в теме' }),
                h('div.vte-confirm-text', { text: 'Тема сама задаёт то, что ты сейчас меняешь:' }),
                h('pre.vte-confirm-list', { text: lines.join('\n') }),
                h('div.vte-confirm-text', {
                    text: '«Заменить» — старая строка удалится из темы, новая запишется в «Мои правки». '
                        + '«Поверх» — тема не трогается, новое значение просто перекроет старое.',
                }),
                h('label.vte-confirm-check', {}, [remember, h('span', { text: ' Запомнить и больше не спрашивать' })]),
                h('div.vte-confirm-btns', {}, [
                    h('button.vte-btn', { type: 'button', on: { click: () => close(null) } }, [h('span', { text: 'Отмена' })]),
                    h('button.vte-btn', { type: 'button', on: { click: () => close('layer') } }, [h('span', { text: 'Поверх' })]),
                    h('button.vte-btn.vte-btn-primary', { type: 'button', on: { click: () => close('replace') } }, [h('span', { text: 'Заменить' })]),
                ]),
            ]),
        ]);
        box.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === box) close(null); });
        document.body.appendChild(box);
    });
}

/**
 * Запись от инструментов (топ-бар): набор правил одним шагом истории.
 * rules — [{ selector, decls: { свойство: значение } }], '' — убрать.
 * Если что-то из этого тема уже задаёт, спрашиваем: заменить в теме
 * (старое объявление удаляется) или записать поверх. С включённой
 * настройкой «Править код темы на месте» заменяем без вопроса.
 * @returns {Promise<false|true|'replaced'>}
 */
async function applyToolRules(list) {
    settlePending();
    const entries = [];
    for (const r of list || []) {
        for (const [property, value] of Object.entries(r.decls || {})) {
            entries.push({
                selector: r.selector,
                property,
                value,
                useVariables: false,
                editInPlace: false,
                important: true,
                media: '',
                // «выключатель» старого значка темы (картинка, маска…):
                // при замене в теме его строку просто удаляем
                neutral: (r.neutral || []).includes(property),
            });
        }
    }

    let base = customCSS;
    let replaced = false;
    const conflicts = findThemeConflicts(entries);
    if (conflicts.length) {
        let mode = cfg().editInPlace ? 'replace' : (cfg().themeOverwrite || 'ask');
        if (mode === 'ask') {
            // Уже ответили «поверх» на эти же строки — второй раз не спрашиваем
            const fresh = conflicts.filter(c => !layeredOnce.has(`${c.selector}|${c.prop}`));
            mode = fresh.length ? await askOverwrite(fresh) : 'layer';
            if (mode === 'layer') for (const c of conflicts) layeredOnce.add(`${c.selector}|${c.prop}`);
        }
        if (!mode) return false;   // отмена — ничего не пишем
        if (mode === 'replace') {
            const edits = [];   // { start, apply(text) } — применяем с конца

            // Строки, которые касаются только этого элемента, правим ПРЯМО
            // В ТЕМЕ: новое значение встаёт на место старого, лишние копии
            // удаляются, в «Мои правки» ничего не пишется. «Выключатели»
            // (убрать картинку, маску) — просто удаляем старую строку.
            // Правило, общее для нескольких элементов, не трогаем: там
            // строка нужна и другим
            const byEntry = new Map();
            for (const c of conflicts.filter(x => x.single)) {
                if (!byEntry.has(c.entry)) byEntry.set(c.entry, []);
                byEntry.get(c.entry).push(c);
            }
            for (const [entry, list] of byEntry) {
                list.sort((a, b) => b.decl.start - a.decl.start);
                const [last, ...rest] = list;
                if (entry.neutral) {
                    for (const c of list) edits.push({ start: c.decl.start, apply: (t) => rules.removeDeclaration(t, c.decl) });
                } else {
                    const v = entry.value;
                    // content: var(--x), и --x нужна только здесь — меняем саму
                    // переменную, строение темы остаётся как было
                    const vm = entry.property === 'content' && last.decl.value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
                    const varDecl = vm && usesOf(customCSS, vm[1]) === 1 ? findVarDecl(vm[1]) : null;
                    if (varDecl) edits.push({ start: varDecl.start, apply: (t) => rules.replaceDeclarationValue(t, varDecl, v) });
                    else edits.push({ start: last.decl.start, apply: (t) => rules.replaceDeclarationValue(t, last.decl, v) });
                    for (const c of rest) edits.push({ start: c.decl.start, apply: (t) => rules.removeDeclaration(t, c.decl) });
                }
                entry.value = '';   // в «Мои правки» уже не нужно
            }

            // Значок в теме задан переменной: общее «content: var(--icon)»
            // плюс у каждого значка своя «--icon: "\f238"». Тогда правильнее
            // всего поменять само значение --icon — ноль новых строк.
            let idx2 = null;
            try { idx2 = getRuleIndex(); } catch {}
            for (const c of conflicts.filter(x => !x.single && x.prop === 'content')) {
                const m = c.decl.value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
                const val = String(c.entry.value || '').trim();
                if (!m || !idx2 || !/^["'][^"']*["']$/.test(val)) continue;
                const fontEntry = entries.find(e => e.selector === c.entry.selector && e.property === 'font-family');
                if (fontEntry?.value) continue;   // значок бренда — нужен другой шрифт, правим отдельным правилом
                const pb = perfRange();
                let done = false;
                for (const rule of idx2.rules) {
                    if (done || rule.inAutoBlock || inPerf(rule, pb)) continue;
                    const d = rule.decls.find(x => x.prop === m[1]);
                    if (!d) continue;
                    if (!rule.parts.some(p => c.targets.some(el => safeMatch(el, p.matchable)))) continue;
                    if (!ruleIsExclusive(rule, c.targets)) continue;
                    edits.push({ start: d.start, apply: (t) => rules.replaceDeclarationValue(t, d, val) });
                    c.entry.value = '';   // в «Мои правки» уже не нужно
                    done = true;
                }
                // Переменная объявлена в :root (или где-то ещё), но нужна только
                // этому значку — во всей теме она встречается один раз. Тогда
                // тоже меняем её значение на месте
                if (!done && usesOf(customCSS, m[1]) === 1) {
                    for (const rule of idx2.rules) {
                        if (done || rule.inAutoBlock || inPerf(rule, pb)) continue;
                        const d = rule.decls.find(x => x.prop === m[1]);
                        if (!d) continue;
                        edits.push({ start: d.start, apply: (t) => rules.replaceDeclarationValue(t, d, val) });
                        c.entry.value = '';
                        done = true;
                    }
                }
            }

            // Одна и та же строка могла попасть дважды (mask и -webkit-mask
            // находят обе строки маски) — правим каждую строку один раз
            const seenStart = new Set();
            const uniq = edits.filter(e => (seenStart.has(e.start) ? false : (seenStart.add(e.start), true)));
            uniq.sort((a, b) => b.start - a.start);
            for (const e of uniq) base = e.apply(base);
            const del = edits;
            // Строки из правил со списком селекторов удалить нельзя — запоминаем,
            // чтобы не спрашивать про них снова
            for (const c of conflicts) if (!c.single && c.entry.value) layeredOnce.add(`${c.selector}|${c.prop}`);
            // Опустевшие правила «селектор { }» убираем целиком
            base = base.replace(/^[^{}\n]+\{\s*\}\s*\n?/gm, '');
            replaced = del.length > 0;
        }
    }

    const next = generator.updateRules(base, entries);
    if (next === customCSS) return false;
    pushHistory(next);
    clearPreviewStyles();
    toolWriting = true;
    writeCSS(next);
    toolWriting = false;
    // Показать в коде место, куда только что записали
    const shown = entries.find(e => e.value);
    if (shown) revealInEditor(shown.selector, shown.property);
    return replaced ? 'replaced' : true;
}

function handleTemplateItemsChanged(tpl, before, after, snaps = {}) {
    const known = tpl?.edited || before.length >= 2;

    if (known && before.length && after.length) {
        // Незаписанные правки из панели ушли бы на старый список
        settlePending();

        const { css: next, moved } = generator.retargetGroup(customCSS, before, after);
        if (moved && next !== customCSS) {
            if (snaps.itemsBefore) rememberTemplateState(customCSS, tpl.id, snaps.itemsBefore);
            if (snaps.itemsAfter) rememberTemplateState(next, tpl.id, snaps.itemsAfter);
            pushHistory(next);
            // Слой предпросмотра держит значения для СТАРОГО списка с !important:
            // исключённый элемент оставался бы покрашенным
            clearPreviewStyles();
            writeCSS(next);
            toast(`«${tpl.name}»: правки группы перенесены на новый состав (${moved} ${moved === 1 ? 'правило' : 'правил'})`);
        }
    }

    // Панель свойств смотрит на эту группу — перенаводим на новый список,
    // иначе следующие правки легли бы в правило со старым составом
    if (editingGroupId === tpl?.id && after.length && active) {
        editTemplateGroup(after.join(', '), tpl, { quiet: true });
    }
}

function toggleTemplates() {
    if (!active) activate();
    templates.togglePanel();
}

/* ============================================================
   ОТЛОЖЕННАЯ ЗАПИСЬ В CSS

   Раньше здесь был один таймер на всё расширение. Если панель успевала
   отправить два свойства подряд (backdrop-filter + -webkit-backdrop-filter,
   четыре стороны padding, ширина + высота иконки), clearTimeout убивал
   предыдущую запись, и до CSS доезжало только последнее свойство.

   Теперь правки складываются в очередь и пишутся одним пакетом —
   один шаг истории, ничего не теряется.
============================================================ */
let commitTimer = null;
let revealTimer = null;
const pendingCommits = new Map();   // селектор -> Map(свойство -> {value, useVariables})
const COMMIT_DELAY = 260;

function queueCommit(sel, property, value, useVariables, extra) {
    // Медиа-условие входит в ключ очереди: одно и то же свойство может
    // писаться и в базовое правило, и внутрь @media, и затирать друг друга
    // они не должны
    const media = extra?.media || '';
    const key = media ? `${media}\u0001${sel}` : sel;

    if (!pendingCommits.has(key)) pendingCommits.set(key, new Map());
    pendingCommits.get(key).set(property, { value, useVariables, extra, sel, media });

    clearTimeout(commitTimer);
    commitTimer = setTimeout(flushCommits, COMMIT_DELAY);
}


/** Немедленно дописать всё, что висит в очереди */
function flushCommits() {
    clearTimeout(commitTimer);
    commitTimer = null;
    if (!pendingCommits.size) return;

    // Очередь снимаем и очищаем ДО flushPending: внутри него сработает
    // handleCodeChange, а он вызывает dropPendingCommits и иначе стёр бы
    // правку ползунка, которую мы прямо сейчас собираемся записать.
    const queue = new Map(pendingCommits);
    pendingCommits.clear();

    // Человек мог печатать в панели кода — его текст ещё не применён.
    // Если не применить сначала его, следующая запись затрёт набранное.
    try { editor.flushPending?.(); } catch {}

    // Собираем всю пачку и отдаём одним вызовом. Раньше здесь шёл цикл
    // updateRule по свойству, и каждый проход заново разбирал и собирал
    // авто-блок целиком: на одном «Применить» во вкладке «Картинка» это
    // больше двадцати полных проходов по всему тексту CSS.
    const entries = [];
    let lastSel = null;
    let lastProp = null;

    for (const [, decls] of queue) {
        for (const [property, entry] of decls) {
            const sel = entry.sel;
            const media = entry.media || '';

            const inPlace = entry.extra?.editInPlace !== undefined
                ? entry.extra.editInPlace
                : (media ? false : cfg().editInPlace);

            entries.push({
                selector: sel,
                property,
                value: entry.value,
                useVariables: entry.useVariables,
                editInPlace: inPlace,
                important: needsImportant(sel, property),
                media,
            });
            if (!media) { lastSel = sel; lastProp = property; }
        }
    }

    const next = generator.updateRules(customCSS, entries);
    if (next === customCSS) return;

    pushHistory(next);
    writeCSS(next);
    if (lastSel) revealInEditor(lastSel, lastProp);
}


/** Выбросить очередь без записи — нужно для undo/redo и правки кода вручную */
function dropPendingCommits() {
    clearTimeout(commitTimer);
    commitTimer = null;
    pendingCommits.clear();
}

/** Прокручивает панель кода к тому месту, куда только что записали */
function revealInEditor(sel, property) {
    if (!cfg().followCode) return;
    if (!editor?.isOpen?.()) return;

    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
        const key = String(sel).replace(/\s+/g, ' ').trim();

        // Быстрый путь: правка почти всегда в блоке «Мои правки», а там
        // формат известен — «селектор {» с новой строки. Простой поиск по
        // строке вместо разбора всей темы (на большой теме это 40+ мс).
        const auto = rules.findAutoRange(customCSS);
        if (auto) {
            const at = customCSS.indexOf(`\n${key} {`, auto.start);
            if (at !== -1 && at < auto.end) {
                let from = at + 1;
                let to = customCSS.indexOf('}', from) + 1;
                if (property) {
                    const p = customCSS.indexOf(`\n  ${property}:`, from);
                    if (p !== -1 && p < to) {
                        from = p + 3;
                        to = customCSS.indexOf(';', p) + 1;
                    }
                }
                editor.revealRange(from, to, { focus: false });
                return;
            }
        }

        // Правка легла в саму тему — тогда уже по индексу
        let idx = null;
        try { idx = getRuleIndex(); } catch { return; }
        if (!idx) return;

        let hit = null;
        for (let i = idx.rules.length - 1; i >= 0; i--) {
            const rule = idx.rules[i];
            if (rule.parts.some(p => p.norm === key)) { hit = rule; break; }
        }
        if (!hit) return;

        let from = hit.ruleStart;
        let to = hit.ruleEnd;
        if (property) {
            const d = rules.findDeclaration(hit, property);
            if (d) { from = d.start; to = d.end; }
        }
        editor.revealRange(from, to, { focus: false });
    }, 140);
}

function handlePropertyChange(sel, property, value, opts = {}) {
    if (property === '__reset__') {
        dropPendingCommits();
        const next = generator.updateRule(customCSS, sel, '__reset__', '');
        dropPreviewFor(sel);
        pushHistory(next);
        writeCSS(next);
        toast('Правила для цели убраны');
        return;
    }

    previewProperty(sel, property, value);

    // Ползунок ещё тянут: показываем предпросмотр, но CSS не переписываем.
    if (opts.live) return;

    // Переменная темы живёт в :root и действует на весь интерфейс.
    // Для псевдоэлемента это почти всегда не то, что человек хотел:
    // менял одну иконку, а поехали все. Пишем обычное правило.
    const isPseudo = String(sel).includes('::');
    const useVariables = isPseudo
        ? false
        : (opts.useVariables ?? cfg().useVariables);

    // Пустота и 'unset' означают «убрать нашу правку», а не «удалить свойство
    // из темы». Без editInPlace: false путь editInPlace вызывал
    // removeDeclaration и вырезал строку прямо из рукописного CSS.
    const empty = value === '' || value === 'unset' || value == null
        || isNeutralReset(sel, property, value);

    queueCommit(sel, property, empty ? '' : value, useVariables, {
        editInPlace: empty ? false : undefined,
    });
}

/* Свойства, у которых 'none' — это просто «ничего нет».
   Ползунки панели, сведённые в ноль (размытие 0, фильтры по умолчанию,
   сдвиг 0), и очищенный цвет присылали 'none'. В коде вместо удаления
   нашей строки появлялось transform: none, filter: none и т.п. */
const NONE_IS_NEUTRAL = new Set([
    'transform', 'filter', 'backdrop-filter', '-webkit-backdrop-filter',
    'box-shadow', 'text-shadow', 'background-image', 'background',
    'mask-image', '-webkit-mask-image', 'clip-path',
]);
// Для цветов 'none' вообще недопустимое значение: браузер выбросил бы строку
const NONE_IS_INVALID = new Set([
    'color', 'background-color', 'border-color', 'outline-color',
    'text-decoration-color', 'caret-color', 'accent-color',
]);

/* Свойство задано где-то в стилях страницы (сама SillyTavern, расширения)?
   Тогда «none» нельзя превращать в «убрать строку»: без неё вернётся
   значение ST. Именно поэтому снятое размытие топ-бара не сохранялось. */
const pageDeclCache = new Map();

function declaredOnPage(el, prop) {
    if (!el) return false;
    const key = prop;
    const now = Date.now();
    const hit = pageDeclCache.get(key);
    let list = hit && now - hit.at < 5000 ? hit.list : null;
    if (!list) {
        list = [];
        for (const sheet of Array.from(document.styleSheets)) {
            if (sheet.ownerNode?.id === 'custom-style') continue;          // тему смотрим отдельно
            if (sheet.ownerNode?.id?.startsWith?.('vte-')) continue;       // свои слои
            if (/\/visual-theme-editor\//.test(sheet.href || '')) continue;
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            walkSheet(rules, prop, list);
        }
        pageDeclCache.set(key, { at: now, list });
    }
    return list.some(sel => safeMatch(el, sel));
}

function walkSheet(rules, prop, out) {
    for (const r of Array.from(rules || [])) {
        if (r.style && r.selectorText) {
            const v = r.style.getPropertyValue(prop).trim();
            if (v && v !== 'none' && !r.selectorText.includes('&')) out.push(r.selectorText);
            continue;
        }
        if (r.cssRules) walkSheet(r.cssRules, prop, out);
    }
}

/**
 * 'none' превращается в «убрать нашу строку», если тема сама это свойство
 * элементу не задаёт: тогда удаление и 'none' дают одно и то же, а код
 * остаётся чистым. Если тема задаёт, например, свой transform, 'none'
 * сохраняется — иначе убрать его было бы нечем.
 */
function isNeutralReset(sel, property, value) {
    if (String(value).trim().toLowerCase() !== 'none') return false;
    const prop = String(property).toLowerCase();
    if (NONE_IS_INVALID.has(prop)) return true;
    if (!NONE_IS_NEUTRAL.has(prop)) return false;

    const parts = String(sel || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return false;
    const { pseudo } = rules.splitPseudo(parts[0]);

    // Только сама тема, без нашего авто-блока
    const map = declMap(pseudo, false);
    if (!map) return false;                 // не знаем — оставляем как есть

    // Значение может прийти из стилей самой SillyTavern — тогда нужно
    // именно 'none', иначе после удаления строки эффект вернётся
    if (declaredOnPage(currentElement, prop)) return false;

    // Свойство могло прийти сокращённой записью: background: linear-gradient(...)
    const SHORT = {
        'background-image': 'background',
        'mask-image': 'mask',
        '-webkit-mask-image': '-webkit-mask',
        '-webkit-backdrop-filter': 'backdrop-filter',
    };
    for (const name of [prop, SHORT[prop]].filter(Boolean)) {
        const hit = map.get(name);
        if (!hit) continue;
        const v = String(hit.value || '').replace(/!important/i, '').trim();
        if (name === 'background') { if (/gradient\(|url\(/i.test(v)) return false; continue; }
        if (!/^none$/i.test(v)) return false;
    }
    return true;
}

/**
 * Пишет сразу несколько свойств. Несколько вызовов подряд склеиваются
 * в один шаг истории.
 *
 * @param opts.media  '@media (max-width: 768px)' — писать внутрь условия
 */
function handleBatchChange(sel, decls, opts = {}) {
    for (const [prop, value] of Object.entries(decls)) {
        // Та же защита, что в handlePropertyChange: iconTool шлёт десятки
        // пустых значений, чтобы снять остатки другой роли. Через editInPlace
        // это вырезало position, z-index и габариты из рукописной темы.
        const empty = value === '' || value === 'unset' || value == null;
        queueCommit(sel, prop, empty ? '' : value, false, {
            editInPlace: empty ? false : undefined,
            media: opts.media || '',
        });
    }

    // Нулевая задержка: все writeDecls внутри одного «Применить» выполняются
    // подряд, поэтому успевают попасть в одну очередь и один шаг истории.
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
        flushCommits();
        dropPreviewFor(sel);
    }, 0);
}

function handleVarInfoRequest(sel, property, opts = {}) {
    const wantVars = opts.useVariables ?? cfg().useVariables;

    if (wantVars) {
        try {
            const v = generator.findVariable(sel, property);
            if (v?.name) return { mode: 'variable', name: v.name };
        } catch {}
    }

    if (cfg().editInPlace) {
        try {
            const spot = generator.findEditSpot(customCSS, sel, property);
            if (spot) {
                return {
                    mode: 'in-place',
                    line: spot.line,
                    selector: spot.selector,
                    hasProperty: spot.hasProperty,
                };
            }
        } catch {}
    }

    return { mode: 'auto' };
}

/**
 * Значение свойства, КАК ОНО НАПИСАНО в CSS, а не как его посчитал браузер.
 *
 * Зачем это нужно: getComputedStyle нормализует значения и теряет исходную
 * запись. 'transform: translateZ(0)' превращается в матрицу, список фильтров
 * переписывается, множественные тени склеиваются. Панель разбирала именно
 * computed, поэтому первое движение любого ползунка стирало всё, что она
 * не умеет распознать. Заявленный текст позволяет сохранить чужие части.
 *
 * includeAuto: true — учитываем и собственный авто-блок: если transform уже
 * правился раньше, актуально именно наше значение.
 */
function handleDeclaredRequest(sel, property) {
    const parts = String(sel || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;

    const { pseudo } = rules.splitPseudo(parts[0]);

    // includeAuto: true — если transform уже правился раньше, актуально
    // именно наше значение из авто-блока, а не исходное из темы
    const map = declMap(pseudo, true);
    if (!map) return null;

    const hit = map.get(String(property).toLowerCase());
    return hit ? hit.value : null;
}


function handleFontSelected(payload) {
    settlePending();
    let next = generator.addFontImport(customCSS, payload.importUrl);
    // Шрифт по прямой ссылке на файл — через @font-face
    if (payload.fontFace) next = generator.addFontFace(next, payload.fontFace.family, payload.fontFace.url);

    // font-family и font-weight пишем ТОЛЬКО обычным правилом.
    // Через переменные темы это ломает системные расчёты SillyTavern.
    const rules = Array.isArray(payload.rules) && payload.rules.length
        ? payload.rules
        : [{
            selector: payload.selector,
            decls: payload.weight && payload.weight !== 400
                ? { 'font-family': payload.stack, 'font-weight': String(payload.weight) }
                : { 'font-family': payload.stack },
            important: true,
        }];

    const entries = [];
    for (const rule of rules) {
        if (!rule?.selector) continue;
        for (const [prop, value] of Object.entries(rule.decls || {})) {
            entries.push({
                selector: rule.selector,
                property: prop,
                value,
                useVariables: false,
                // Шрифт пишется поверх темы, а темы почти всегда задают
                // font-family с !important. Без важности правило проиграет.
                important: rule.important !== false,
            });
        }
    }
    next = generator.updateRules(next, entries);


    pushHistory(next);
    writeCSS(next);
    toast(payload.guarded
        ? `Шрифт ${payload.family} применён, иконки защищены`
        : `Шрифт ${payload.family} применён`);
}

function handleCodeChange(css, opts = {}) {
    // Человек правит код руками — это источник истины,
    // отложенные правки ползунков выбрасываем
    dropPendingCommits();

    // Проверку ошибок панель кода делает сама и показывает у себя.
    // Здесь она шла второй раз и на каждую паузу в наборе выдавала тост.

    if (opts.fromHistory && history.length >= 2 && history[history.length - 2] === css) {
        // Откат внутри панели совпал с предыдущим общим шагом — это та же
        // отмена. Раньше здесь заменялась верхушка стека, получались два
        // одинаковых шага подряд, и следующая «Отменить» ничего не меняла.
        future.push(history.pop());
        updateHistoryButtons();
    } else {
        pushHistory(css);
    }
    writeCSS(css, { skipEditor: true });
    previewRules.clear();
    if (previewStyle) previewStyle.textContent = '';
}

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

function toast(text, kind = 'info') {
    try { window.toastr?.[kind]?.(text, 'Theme Editor', { timeOut: 2600 }); }
    catch { console.log('[VTE]', text); }
}

/* ============================================================
   ПУНКТ В МЕНЮ-ПАЛОЧКЕ
============================================================ */
function mountWandItem() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) return;

    if (!document.getElementById('vte-wand')) {
        menu.appendChild(h('div#vte-wand.list-group-item.flex-container.flexGap5.interactable', {
            tabIndex: 0,
            on: { click: toggleEditor },
        }, [
            h('div.fa-solid.fa-wand-magic-sparkles.extensionsMenuExtensionButton'),
            h('span#vte-wand-label', { text: 'Визуальный редактор темы' }),
        ]));
    }

    if (!document.getElementById('vte-wand-pick')) {
        menu.appendChild(h('div#vte-wand-pick.list-group-item.flex-container.flexGap5.interactable', {
            tabIndex: 0,
            on: { click: togglePicking },
        }, [
            h('div.fa-solid.fa-crosshairs.extensionsMenuExtensionButton'),
            h('span#vte-wand-pick-label', { text: 'Выбрать элемент для правки' }),
        ]));
    }

    if (!document.getElementById('vte-wand-tb')) {
        menu.appendChild(h('div#vte-wand-tb.list-group-item.flex-container.flexGap5.interactable', {
            tabIndex: 0,
            on: { click: () => topbar.togglePanel() },
        }, [
            h('div.fa-solid.fa-bars-staggered.extensionsMenuExtensionButton'),
            h('span', { text: 'Топ-бар' }),
        ]));
    }

    if (!document.getElementById('vte-wand-tpl')) {
        menu.appendChild(h('div#vte-wand-tpl.list-group-item.flex-container.flexGap5.interactable', {
            tabIndex: 0,
            on: { click: toggleTemplates },
        }, [
            h('div.fa-solid.fa-layer-group.extensionsMenuExtensionButton'),
            h('span', { text: 'Шаблоны групп элементов' }),
        ]));
    }

    updateToggleUI();
    updatePickUI();
}

function updateToggleUI() {
    const label = document.getElementById('vte-wand-label');
    if (label) {
        label.textContent = active
            ? 'Выключить редактор темы'
            : 'Визуальный редактор темы';
    }
    const btn = document.getElementById('vte-settings-toggle');
    if (btn) {
        btn.textContent = '';
        btn.append(
            icon(active ? 'fa-circle-stop' : 'fa-wand-magic-sparkles'),
            h('span', { text: active ? ' Выключить редактор' : ' Включить редактор' })
        );
        btn.classList.toggle('vte-btn-danger', active);
    }
}

function updatePickUI() {
    const picking = isPicking();

    const label = document.getElementById('vte-wand-pick-label');
    if (label) {
        label.textContent = picking
            ? 'Выключить выбор элемента'
            : 'Выбрать элемент для правки';
    }

    const btn = document.getElementById('vte-settings-pick');
    if (btn) {
        btn.textContent = '';
        btn.append(
            icon(picking ? 'fa-ban' : 'fa-crosshairs'),
            h('span', { text: picking ? ' Выключить выбор' : ' Выбрать элемент' })
        );
        btn.classList.toggle('vte-btn-danger', picking);
    }
}
/* ============================================================
   СОЧЕТАНИЯ КЛАВИШ: РАЗБОР И ПОДПИСЬ
============================================================ */
const MOD_KEYS = ['Control', 'Alt', 'Shift', 'Meta'];

/** Собирает строку вида "Alt+Shift+KeyE" из события клавиатуры */
function comboFromEvent(e) {
    if (MOD_KEYS.includes(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    if (!e.code) return null;
    parts.push(e.code);
    return parts.join('+');
}

/** Человеческая подпись: "Alt + Shift + E" */
function comboLabel(combo) {
    const raw = String(combo || '').trim();
    if (!raw) return 'не задано';
    return raw.split('+').map(part => {
        if (part.startsWith('Key')) return part.slice(3);
        if (part.startsWith('Digit')) return part.slice(5);
        if (part.startsWith('Numpad')) return 'Num ' + part.slice(6);
        if (part === 'Escape') return 'Esc';
        if (part === 'Meta') return 'Cmd';
        if (part === 'Control') return 'Ctrl';
        return part;
    }).join(' + ');
}

function matchCombo(e, combo) {
    const raw = String(combo || '').trim();
    if (!raw) return false;
    const parts = raw.split('+');
    const code = parts[parts.length - 1];
    if (e.code !== code) return false;
    return e.ctrlKey === parts.includes('Ctrl')
        && e.altKey === parts.includes('Alt')
        && e.shiftKey === parts.includes('Shift')
        && e.metaKey === parts.includes('Meta');
}

/* ============================================================
   ПАНЕЛЬ НАСТРОЕК
============================================================ */
function mountSettingsPanel() {
    const host = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!host || document.getElementById('vte-settings')) return;

    const body = h('div.inline-drawer-content#vte-settings-body', { style: 'display:none' });
    const chevron = h('div.inline-drawer-icon.fa-solid.fa-circle-chevron-down.down');

    const header = h('div.inline-drawer-header', {
        style: 'cursor:pointer',
        on: {
            click: () => {
                const open = body.style.display !== 'none';
                body.style.display = open ? 'none' : 'block';
                // Образец «Под тему таверны» пересчитать по текущей теме ST
                if (!open) document.dispatchEvent(new Event('vte-settings-open'));
                chevron.classList.toggle('fa-circle-chevron-down', open);
                chevron.classList.toggle('fa-circle-chevron-up', !open);
                chevron.classList.toggle('down', open);
                chevron.classList.toggle('up', !open);
            },
        },
    }, [
        h('b', {}, [icon('fa-wand-magic-sparkles'), h('span', { text: ' Визуальный редактор темы' })]),
        chevron,
    ]);

    const toggleBtn = h('button#vte-settings-toggle.menu_button.vte-wide-btn', {
        type: 'button',
        on: { click: toggleEditor },
    });

    const pickBtn = h('button#vte-settings-pick.menu_button.vte-wide-btn', {
        type: 'button',
        on: { click: togglePicking },
    });

    const check = (key, label, hint, onAfter) => {
        const input = h('input', {
            type: 'checkbox',
            checked: !!cfg()[key],
            on: {
                change: (e) => {
                    cfg()[key] = e.target.checked;
                    persist();
                    onAfter?.(e.target.checked);
                },
            },
        });
        return h('div.vte-settings-row', {}, [
            h('label.checkbox_label', {}, [input, h('span', { text: label })]),
            hint ? h('small.vte-settings-hint', { text: hint }) : null,
        ]);
    };

    const options = h('div.vte-settings-options', {}, [
        check('showCode', 'Показывать панель кода', null, (v) => {
            if (!active) return;
            v ? editor.showPanel() : editor.hidePanel();
        }),
        check('pickerOnStart', 'Сразу включать выбор элемента', null),
        check('pickOnce', 'Выключать выбор после клика', null),
        check('hotkey', 'Горячие клавиши', null),
        check('liteEffects', 'Не предлагать тяжёлые эффекты',
            'Размытие и градиенты в окне редактора прячутся, мягкие тени — не больше 10px',
            () => { if (active) refreshInspector(); }),
    ]);

    /* ---- Что делать, если тема это уже задаёт ----
       Раньше тут было две настройки про одно и то же: галочка «Править код
       темы на месте» и этот выбор. Теперь одна. */
    const owSelect = h('select.text_pole.vte-settings-select', {
        on: {
            change: (e) => {
                cfg().themeOverwrite = e.target.value;
                cfg().editInPlace = e.target.value === 'replace';
                persist();
            },
        },
    }, [
        ['ask', 'Спрашивать'],
        ['replace', 'Менять прямо в теме'],
        ['layer', 'Добавлять в «Мои правки»'],
    ].map(([v, t]) => h('option', { value: v, text: t })));
    owSelect.value = cfg().themeOverwrite || 'ask';
    options.appendChild(h('div.vte-settings-field', {}, [
        h('div.vte-settings-label', { text: 'Если это уже есть в теме' }),
        owSelect,
        h('small.vte-settings-hint', {
            text: '«Менять прямо в теме» — старое значение в коде заменяется новым, лишних строк нет. '
                + '«Добавлять» — тема не трогается, новое перекрывает старое.',
        }),
    ]));

    /* ---- Тема окон редактора: плитки с образцами ---- */
    const themeBox = h('div.vte-settings-themes');
    const paintThemes = () => {
        themeBox.textContent = '';
        const cur = editor.getTheme?.() || 'default';
        for (const t of editor.CODE_THEMES || []) {
            themeBox.appendChild(h(`button.vte-settings-theme${t.id === cur ? '.active' : ''}`, {
                type: 'button',
                title: t.hint,
                dataset: { theme: t.id },
                on: { click: () => { editor.setTheme?.(t.id); paintThemes(); } },
            }, [editor.swatchEl?.(t.id), h('span', { text: t.name })]));
        }
    };
    paintThemes();
    // Меню темы в шапке панели кода тоже переключает — держим плитки в курсе
    document.addEventListener('vte-theme-changed', paintThemes);
    document.addEventListener('vte-settings-open', paintThemes);
    options.appendChild(h('div.vte-settings-field', {}, [
        h('div.vte-settings-label', { text: 'Оформление окон редактора' }),
        themeBox,
    ]));

    /* ---- Переназначение сочетаний ---- */
    const hotkeyRow = (key, label, hint) => {
        const btn = h('button.vte-hotkey-input.menu_button', {
            type: 'button',
            title: 'Нажмите, затем введите сочетание. Backspace — очистить, Esc — отмена.',
            text: comboLabel(cfg()[key]),
        });

        const reset = () => {
            btn.classList.remove('vte-capturing');
            btn.textContent = comboLabel(cfg()[key]);
        };

        btn.addEventListener('click', () => {
            btn.classList.add('vte-capturing');
            btn.textContent = 'нажмите сочетание…';
            btn.focus();
        });

        btn.addEventListener('keydown', (e) => {
            if (!btn.classList.contains('vte-capturing')) return;
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') { reset(); return; }
            if (e.key === 'Backspace' || e.key === 'Delete') {
                cfg()[key] = '';
                persist();
                reset();
                return;
            }
            const combo = comboFromEvent(e);
            if (!combo) return;
            cfg()[key] = combo;
            persist();
            reset();
            toast(`Сочетание сохранено: ${comboLabel(combo)}`);
        });

        btn.addEventListener('blur', reset);

        // Одной строкой: подпись слева, сочетание справа, пояснение — подсказкой
        return h('div.vte-hotkey-line', { title: hint || '' }, [
            h('span.vte-settings-label', { text: label }),
            btn,
        ]);
    };

    const hotkeys = h('div.vte-settings-options', {}, [
        h('div.vte-settings-subtitle', { text: 'Горячие клавиши' }),
        hotkeyRow('hotkeyToggle', 'Редактор темы', 'Открыть или закрыть панели редактора'),
        hotkeyRow('hotkeyPick', 'Выбор элемента', 'Включить или выключить прицел'),
    ]);

    const colorInput = h('input.vte-color-input', {
        type: 'color',
        value: cfg().highlightColor,
        on: {
            input: (e) => {
                cfg().highlightColor = e.target.value;
                persist();
                selector?.setHighlightColor?.(e.target.value);
            },
        },
    });

    const colorRow = h('div.vte-settings-row', {}, [
        h('label.vte-settings-label', { text: 'Цвет рамки выбора' }),
        colorInput,
    ]);

    const undoBtn = h('button#vte-undo.menu_button', {
        type: 'button', disabled: true, on: { click: undo },
    }, [icon('fa-rotate-left'), h('span', { text: ' Отменить' })]);

    const redoBtn = h('button#vte-redo.menu_button', {
        type: 'button', disabled: true, on: { click: redo },
    }, [icon('fa-rotate-right'), h('span', { text: ' Вернуть' })]);

    const historyRow = h('div.vte-settings-actions', {}, [undoBtn, redoBtn]);

    const codeBtn = h('button.menu_button', {
        type: 'button',
        on: {
            click: () => {
                editor.showPanel();
                editor.setContent(readCSS(), { silent: true });
            },
        },
    }, [icon('fa-code'), h('span', { text: ' Открыть код' })]);


    const tplBtn = h('button.menu_button', {
        type: 'button',
        title: 'Собрать группу однотипных элементов и править их вместе',
        on: { click: toggleTemplates },
    }, [icon('fa-layer-group'), h('span', { text: ' Шаблоны групп' })]);



    const toolsRow = h('div.vte-settings-actions', {}, [codeBtn, tplBtn]);

    const hint = h('small.vte-settings-note', {}, [
        icon('fa-circle-info'),
        h('span', { text: ' Новые правила складываются в блок «Мои правки» в конце CSS темы. Топ-бар и облегчение — в окне редактора.' }),
    ]);

    body.append(toggleBtn, pickBtn, options, hotkeys, colorRow, historyRow, toolsRow, hint);

    const drawer = h('div#vte-settings.inline-drawer', {}, [header, body]);
    host.appendChild(drawer);

    updateToggleUI();
    updatePickUI();
    updateHistoryButtons();
}

/* ============================================================
   ОБЛЕГЧЕНИЕ: ЗАПИСЬ В CSS ТЕМЫ
   Блок «Облегчение ♡» в конце темы: заплатки для всех тяжёлых правил
   страницы. Стоит последним — перебивает и тему, и «Мои правки».
============================================================ */
function perfFlags() {
    return perf.readPerfFlags(customCSS);
}

function applyPerf(flags) {
    settlePending();
    let base = perf.stripPerfBlock(customCSS);
    // Градиенты самой темы меняем прямо в её коде — без заплаток
    let flat = 0;
    if (flags.gradient) {
        const r = perf.flattenThemeGradients(base, rules.buildIndex(base), (rule) => rule.inAutoBlock);
        base = r.css;
        flat = r.count;
    }
    const { block, stats } = perf.buildPerfBlock(flags);
    stats.flat = flat;
    const head = base.trim() ? `${base.trimEnd()}\n\n` : '';
    const next = block ? `${head}${block}\n` : base;
    if (next === customCSS) return stats;
    pushHistory(next);
    writeCSS(next);
    inspector.refreshTools?.();
    return stats;
}

/* ---------- Окно «Шрифты» ----------
   Раньше было вкладкой окна свойств и открывалось только после выбора
   элемента, хотя шрифт ставится на «весь интерфейс», «сообщения» и т.п. */
let fontsPanel = null;

/* ---------- «Уже в теме» для окна «Шрифты» ----------
   Правила темы со шрифтами (font-family, font, --…Font…), подключения
   @import и @font-face. Наши собственные правки сюда не попадают — как
   и в остальных окнах. Клик — показать место в коде. */
function themeFontRules() {
    const out = [];
    const css = customCSS || '';
    const cut = (t) => (t.length > 90 ? `${t.slice(0, 88)}…` : t);
    const skip = [/\/\*[\s\S]*?\*\//g];
    const inComment = (() => {
        const ranges = [];
        for (const re of skip) for (const m of css.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
        return (i) => ranges.some(([a, b]) => i >= a && i < b);
    })();
    for (const m of css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)[^;]*;/gi)) {
        if (inComment(m.index)) continue;
        out.push({ selector: '@import', props: cut(m[1]), from: m.index, to: m.index + m[0].length });
    }
    for (const m of css.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
        if (inComment(m.index)) continue;
        const fam = (m[0].match(/font-family\s*:\s*([^;}]+)/i) || [, ''])[1].trim();
        out.push({ selector: '@font-face', props: cut(fam || 'шрифт из файла'), from: m.index, to: m.index + m[0].length });
    }
    let idx = null;
    try { idx = getRuleIndex(); } catch {}
    const pb = perfRange();
    for (const rule of idx?.rules || []) {
        if (rule.inAutoBlock || inPerf(rule, pb)) continue;
        const d = rule.decls.filter(x => /^(font-family|font|--[\w-]*font[\w-]*)$/i.test(x.prop));
        if (!d.length) continue;
        const sel = rule.parts.map(p => p.raw).join(', ');
        out.push({
            selector: cut(sel),
            props: cut(d.map(x => `${x.prop}: ${x.value}`).join('; ')),
            from: rule.ruleStart, to: rule.ruleEnd,
        });
    }
    return out.sort((a, b) => a.from - b.from);
}

let fontsThemeOpen = false;
function renderFontsTheme() {
    const host = fontsPanel?.querySelector('.vte-fonts-theme');
    if (!host) return;
    host.textContent = '';
    const list = themeFontRules();
    if (!list.length) return;
    host.appendChild(h('button.vte-tb-ext-toggle', {
        type: 'button',
        on: { click: () => { fontsThemeOpen = !fontsThemeOpen; renderFontsTheme(); } },
    }, [icon(fontsThemeOpen ? 'fa-chevron-up' : 'fa-chevron-down'),
        h('span', { text: ` Уже в теме: ${list.length} ${list.length === 1 ? 'место' : 'мест'} со шрифтами` })]));
    if (!fontsThemeOpen) return;
    for (const r of list) {
        host.appendChild(h('button.vte-tb-rule', {
            type: 'button', title: 'Показать в коде',
            on: {
                click: () => {
                    if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
                    setTimeout(() => editor.revealRange?.(r.from, r.to, { focus: true, hold: 4000 }), 60);
                },
            },
        }, [h('code.vte-tb-rule-sel', { text: r.selector }), h('span.vte-tb-rule-props', { text: r.props })]));
    }
}

function toggleFontsWindow() {
    if (fontsPanel && fontsPanel.style.display !== 'none') {
        fontsPanel.style.display = 'none';
        fonts.stopPreview?.();
        inspector.refreshTools?.();
        return;
    }
    if (!fontsPanel) {
        const body = h('div.vte-fonts-window-body');
        const themeBox = h('div.vte-tb-section.vte-tb-theme.vte-fonts-theme');
        const fontsHost = h('div.vte-fonts-host');
        const header = h('div.vte-header', {}, [
            h('div.vte-title', {}, [
                h('span.vte-title-ic', {}, [icon('fa-font')]),
                h('span', { text: 'Шрифты' }),
            ]),
            h('div.vte-header-btns', {}, [
                h('button.vte-icon-btn.vte-icon-btn-close', {
                    type: 'button', title: 'Закрыть', on: { click: () => toggleFontsWindow() },
                }, [icon('fa-xmark')]),
            ]),
        ]);
        body.append(themeBox, fontsHost);
        fontsPanel = h('div#vte-fonts-panel.vte-panel', {}, [header, body]);
        ['pointerdown', 'mousedown', 'touchstart', 'click', 'keydown'].forEach(t =>
            fontsPanel.addEventListener(t, (e) => e.stopPropagation()));
        document.body.appendChild(fontsPanel);
        dragByHeader(fontsPanel, header);
        fonts.mount(fontsHost);
    }
    fontsPanel.style.display = 'flex';
    renderFontsTheme();
    inspector.refreshTools?.();
}

/** Простое перетаскивание окна за шапку */
function dragByHeader(box, handle) {
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

/* ---------- всплывающее меню в окне редактора ---------- */
let toolPop = null;

function closeToolPop() {
    toolPop?.remove();
    toolPop = null;
    document.removeEventListener('pointerdown', outsideToolPop, true);
}

function outsideToolPop(e) {
    if (toolPop && !toolPop.contains(e.target) && !e.target.closest?.('.vte-tools-btn')) closeToolPop();
}

function openToolPop(anchor, build) {
    const was = toolPop?.dataset.for;
    closeToolPop();
    if (was === anchor.dataset.tool) return;   // второй клик — закрыть
    const host = document.getElementById('vte-inspector-panel');
    if (!host) return;
    toolPop = h('div.vte-tools-pop', { dataset: { for: anchor.dataset.tool } });
    build(toolPop);
    host.appendChild(toolPop);
    const hr = host.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    toolPop.style.top = `${ar.bottom - hr.top + 4}px`;
    toolPop.style.left = `${Math.max(6, Math.min(ar.left - hr.left, hr.width - 260))}px`;
    setTimeout(() => document.addEventListener('pointerdown', outsideToolPop, true), 0);
}

function buildPerfPop(box) {
    box.textContent = '';
    // Размытие выключается в настройках самой SillyTavern — здесь его больше нет.
    // Если в теме остался такой кусок от старой версии, он уберётся при
    // первом же переключении или «Обновить»
    const raw = perfFlags();
    const flags = { ...raw, blur: false };
    const status = h('div.vte-tools-note');

    const toggle = (key, label, hint) => {
        const input = h('input', { type: 'checkbox', checked: flags[key] });
        input.addEventListener('change', () => {
            flags[key] = input.checked;
            status.textContent = 'Записываю…';
            // Дать меню перерисоваться до тяжёлого прохода по стилям
            setTimeout(() => {
                const st = applyPerf(flags);
                const parts = [];
                if (st.rules) parts.push(`облегчение: ${st.rules} ${st.rules === 1 ? 'правило' : 'правил'}`);
                if (st.flat) parts.push(`градиентов темы заменено прямо в коде: ${st.flat}`);
                toast(parts.length ? `Записано — ${parts.join(', ')}` : 'Облегчение убрано из темы');
                buildPerfPop(box);
            }, 30);
        });
        return h('label.vte-tools-check', { title: hint }, [input, h('span', { text: label })]);
    };

    box.append(
        h('div.vte-tools-title', { text: 'Облегчить таверну' }),
        toggle('shadow', 'Без мягких теней', 'box-shadow с размытием и drop-shadow(). Тени-рамки без размытия остаются'),
        toggle('gradient', 'Градиенты → сплошной цвет',
            'Градиенты темы заменяются цветом первой точки прямо в её коде — без лишних строк. '
            + 'Вернуть — через «Отменить». Картинки и градиентный текст не трогаются'),
        status,
    );

    const b = perf.findPerfBlock(customCSS);
    if (b) {
        const lines = b.body.split('\n').filter(l => l.includes('{')).length;
        status.textContent = `В теме блок «Облегчение ♡» — ${(b.body.length / 1024).toFixed(1)} КБ. `
            + (raw.blur ? 'В нём осталось выключение размытия от старой версии — «Обновить» его уберёт. ' : '')
            + 'Размытие, анимации и тени текста — в настройках самой SillyTavern.';
        box.append(h('button.vte-btn', {
            type: 'button',
            title: 'Пересобрать после новых правок темы или новых расширений',
            on: { click: () => { applyPerf({ ...perfFlags(), blur: false }); toast('Облегчение пересобрано'); buildPerfPop(box); } },
        }, [icon('fa-rotate'), h('span', { text: ` Обновить (${lines})` })]));
    } else {
        status.textContent = 'Заплатки пишутся в CSS темы отдельным блоком в самом конце. '
            + 'Размытие, анимации и тени текста — в настройках самой SillyTavern.';
    }
}

/* ---------- присоединение окна редактора к панели кода ---------- */
const DOCK_SIDES = [
    ['off', 'Отдельным окном'],
    ['right', 'Справа от кода'],
    ['left', 'Слева от кода'],
    ['top', 'Над кодом'],
];

function buildDockPop(box) {
    box.textContent = '';
    box.append(h('div.vte-tools-title', { text: 'Окно редактора' }));
    for (const [id, label] of DOCK_SIDES) {
        box.append(h(`button.vte-tools-item${cfg().dock === id ? '.active' : ''}`, {
            type: 'button',
            on: {
                click: () => {
                    cfg().dock = id;
                    persist();
                    closeToolPop();
                    if (id !== 'off') editor.showPanel?.();
                    applyDock();
                    inspector.refreshTools?.();
                },
            },
        }, [h('span', { text: label })]));
    }
    box.append(h('div.vte-tools-note', {
        text: 'Присоединённое окно ездит вместе с панелью кода и тянется по её высоте. '
            + 'На телефоне окна и так снизу — там присоединение не нужно.',
    }));
}

let dockCleanup = null;
let dockRaf = 0;

function applyDock() {
    dockCleanup?.();
    dockCleanup = null;

    const insp = document.getElementById('vte-inspector-panel');
    const code = document.getElementById('vte-code-panel');
    const side = cfg().dock || 'off';
    insp?.classList.remove('vte-docked');
    if (insp) delete insp.dataset.dock;

    if (!insp || !code || side === 'off') return;

    insp.classList.add('vte-docked');
    insp.dataset.dock = side;

    const GAP = 6;
    const place = () => {
        dockRaf = 0;
        if (window.innerWidth <= 768) return;
        if (code.style.display === 'none' || insp.style.display === 'none') return;
        const r = code.getBoundingClientRect();
        // Ширину присоединённого окна помним: её могли растянуть руками
        const W = Math.max(280, Math.round(cfg().dockWidth || insp.offsetWidth || 340));
        const s = insp.style;
        s.right = 'auto';
        s.bottom = 'auto';

        let where = side;
        if (where === 'right' && r.right + GAP + W > window.innerWidth) where = 'left';
        else if (where === 'left' && r.left - GAP - W < 0) where = 'right';
        else if (where === 'top' && r.top < 220) where = 'right';

        if (where === 'top') {
            const h = Math.min(r.top - GAP - 8, window.innerHeight * 0.55);
            s.left = `${r.left}px`;
            s.width = `${r.width}px`;
            s.top = `${r.top - GAP - h}px`;
            s.height = `${h}px`;
            s.maxHeight = `${h}px`;
        } else {
            s.width = `${W}px`;
            s.left = `${where === 'right' ? r.right + GAP : Math.max(0, r.left - GAP - W)}px`;
            s.top = `${r.top}px`;
            s.height = `${r.height}px`;
            s.maxHeight = `${r.height}px`;
        }
    };
    const schedule = () => { if (!dockRaf) dockRaf = requestAnimationFrame(place); };

    // Панель кода двигают и тянут — следуем за ней
    const ro = new ResizeObserver(schedule);
    ro.observe(code);
    const mo = new MutationObserver(schedule);
    mo.observe(code, { attributes: true, attributeFilter: ['style', 'class'] });
    mo.observe(insp, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', schedule);

    // Шапку присоединённого окна тянуть — значит двигать пару целиком
    const head = insp.querySelector('.vte-header');
    let drag = null;
    const down = (e) => {
        if (e.target.closest('button') || window.innerWidth <= 768) return;
        // Панель кода закрыта — окно редактора двигается само, как обычно.
        // Раньше перехват оставался, и окно после закрытия кода не тащилось
        if (code.style.display === 'none' || !code.isConnected) return;
        e.stopImmediatePropagation();
        const r = code.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        head.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
        if (!drag) return;
        e.stopImmediatePropagation();
        editor.moveTo?.(drag.left + e.clientX - drag.x, drag.top + e.clientY - drag.y);
    };
    const up = () => {
        if (!drag) return;
        drag = null;
        editor.moveTo?.(null, null, true);   // запомнить положение
    };
    head?.addEventListener('pointerdown', down, true);
    head?.addEventListener('pointermove', move, true);
    head?.addEventListener('pointerup', up, true);

    place();

    // Потянули окно за уголок, пока оно присоединено — запоминаем ширину
    const roSelf = new ResizeObserver(() => {
        if (!dockRaf && insp.offsetWidth && Math.abs((cfg().dockWidth || 0) - insp.offsetWidth) > 4
            && side !== 'top') {
            cfg().dockWidth = insp.offsetWidth;
            persist();
        }
    });
    roSelf.observe(insp);

    dockCleanup = () => {
        roSelf.disconnect();
        ro.disconnect();
        mo.disconnect();
        window.removeEventListener('resize', schedule);
        head?.removeEventListener('pointerdown', down, true);
        head?.removeEventListener('pointermove', move, true);
        head?.removeEventListener('pointerup', up, true);
        cancelAnimationFrame(dockRaf);
        dockRaf = 0;
        const s = insp.style;
        s.height = ''; s.maxHeight = ''; s.width = '';
    };
}

function renderVarsSummary(box) {
    generator.parse(readCSS());
    const list = generator.getVariables();
    box.textContent = '';

    if (!list.length) {
        box.appendChild(h('div.vte-settings-empty', {
            text: 'В теме не найдено CSS-переменных. Расширение будет создавать свои.',
        }));
        return;
    }

    box.appendChild(h('div.vte-vars-head', {
        text: `Найдено переменных: ${list.length}`,
    }));

    const table = h('div.vte-vars-table');
    for (const v of list.slice(0, 200)) {
        const isColor = /^(#|rgba?\(|hsla?\()/i.test(v.value);
        table.appendChild(h('div.vte-vars-row', {}, [
            isColor
                ? h('span.vte-vars-swatch', { style: `background:${v.value}` })
                : h('span.vte-vars-swatch.vte-vars-swatch-empty'),
            h('code.vte-vars-name', { text: v.name }),
            h('span.vte-vars-value', { text: v.value, title: v.value }),
            h('span.vte-vars-uses', {
                text: v.usedIn ? `×${v.usedIn}` : '—',
                title: v.usedIn ? `Используется в ${v.usedIn} объявлениях` : 'Не используется',
            }),
        ]));
    }
    box.appendChild(table);
}

function removeAutoBlock() {
    const css = readCSS();
    const r = rules.findAutoRange(css);
    if (!r) {
        toast('Блока «Мои правки» в теме нет', 'info');
        return;
    }
    const next = (css.slice(0, r.start) + css.slice(r.end)).replace(/\n{3,}/g, '\n\n');
    pushHistory(next);
    writeCSS(next);
    toast('Блок «Мои правки» удалён');
}

function exportCSS() {
    const blob = new Blob([readCSS()], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'custom-theme.css' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ============================================================
   ГОРЯЧИЕ КЛАВИШИ
============================================================ */
function bindHotkeys() {
    document.addEventListener('keydown', (e) => {
        // Пока переназначаем клавишу — глобальные сочетания молчат
        if (document.activeElement?.classList?.contains('vte-capturing')) return;
        if (!cfg().hotkey) return;

        // Панель кода на CodeMirror — это не textarea, а div с contenteditable.
        // Без второй проверки Esc внутри кода выключал весь редактор, а Ctrl+Z
        // уходил в общую историю вместо истории панели.
        const ae = document.activeElement;
        const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName || '') || !!ae?.isContentEditable;

        // Сочетание без модификаторов внутри поля ввода — это обычный набор
        // текста, а не команда. Раньше проверки не было вообще, и любая
        // простая клавиша, назначенная на редактор, срабатывала при печати.
        const plain = (combo) => !/Ctrl|Alt|Meta/.test(String(combo || ''));

        if (matchCombo(e, cfg().hotkeyToggle) && !(inField && plain(cfg().hotkeyToggle))) {
            e.preventDefault();
            toggleEditor();
            return;
        }
        if (matchCombo(e, cfg().hotkeyPick) && !(inField && plain(cfg().hotkeyPick))) {
            e.preventDefault();
            togglePicking();
            return;
        }
        if (!active) return;

        // Esc в режиме выбора обрабатывает сам selector: гасит только прицел
        if (e.key === 'Escape' && !inField) {
            if (isPicking()) return;
            deactivate();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !inField) {
            e.preventDefault();
            e.shiftKey ? redo() : undo();
        }
    }, true);
}

/* ============================================================
   ОТСЛЕЖИВАНИЕ DOM
============================================================ */
function watchDom() {
    let timer = null;
    const isOurs = (n) =>
        n.nodeType === 1 && ((n.id || '').startsWith('vte-') ||
            (n.className || '').toString().includes('vte-'));

    const obs = new MutationObserver((records) => {
        const added = records.flatMap(r => Array.from(r.addedNodes));
        if (added.length && added.every(isOurs)) return;

        clearTimeout(timer);
        timer = setTimeout(() => {
            mountWandItem();
            mountSettingsPanel();
        }, 220);
    });

    const attach = (id, opts) => {
        const el = document.getElementById(id);
        if (el) obs.observe(el, opts);
    };

    setTimeout(() => {
        attach('extensionsMenu', { childList: true });
        attach('extensions_settings2', { childList: true });
        attach('extensions_settings', { childList: true });
    }, 800);
}

function watchThemeSwitch() {
    const ev = _script?.eventSource ?? ctx()?.eventSource;
    const et = _script?.event_types ?? ctx()?.eventTypes ?? ctx()?.event_types;
    if (!ev || !et) return;

    const resync = () => {
        const css = readCSS();
        if (css === customCSS) return;
        customCSS = css;
        generator.parse(css);

        if (active) {
            // Редактор открыт — это просто ещё один шаг, а не новая тема.
            // Раньше здесь история обнулялась, и отменять становилось нечего.
            if (history[history.length - 1] !== css) {
                history.push(css);
                if (history.length > HISTORY_LIMIT) history.shift();
            }
        } else {
            history = [css];
            future = [];
        }

        updateHistoryButtons();
        if (editor?.isOpen?.()) editor.setContent(css, { silent: true });
        // Сменили тему — окна инструментов показывают настройки новой
        refreshTools();
    };

    [et.SETTINGS_UPDATED, et.SETTINGS_LOADED, et.APP_READY].forEach(name => {
        if (name) { try { ev.on(name, () => setTimeout(resync, 300)); } catch {} }
    });
}

function handleTextApply(ruleset, opts = {}) {
    if (!ruleset?.length) return;

    for (const { selector, decls } of ruleset) {
        for (const [prop, value] of Object.entries(decls)) {
            const empty = value === '' || value == null;
            // Сброс должен убирать ТОЛЬКО нашу строку из авто-блока.
            // Раньше пустота превращалась в 'unset', а editInPlace понимал
            // это как «удалить объявление» и вырезал свойство из самой темы.
            queueCommit(selector, prop, empty ? '' : value, false, {
                editInPlace: empty ? false : undefined,
            });
        }
    }

    flushCommits();
    clearPreviewStyles();
}

/* ============================================================
   СТАРТ
============================================================ */
async function boot() {
    await connectST();

    try {
        await loadModules();
    } catch (err) {
        console.error('[VTE] Не удалось загрузить модули:', err);
        return;
    }

    generator.init();
    picker.init({ swatches: [] });

    // Настройки прошлых версий: «Мгновенный предпросмотр» теперь всегда
    // включён, а галочка «Править код темы на месте» стала вариантом
    // «Менять прямо в теме» в одной общей настройке
    {
        const c = cfg();
        c.liveApply = true;
        if (c.editInPlace && (c.themeOverwrite || 'ask') === 'ask') c.themeOverwrite = 'replace';
        c.editInPlace = c.themeOverwrite === 'replace';
    }

    selector.init({
        onElementSelected: handleElementSelected,
        onStateChange: (on) => {
            updatePickUI();
            // Во время набора шаблона прицел гаснет по кнопке «Готово»,
            // сообщать об этом отдельно не нужно
            if (!on && active && !templates.isCollecting()) {
                toast('Выбор элемента выключен');
            }
        },
        highlightColor: cfg().highlightColor,
    });

    inspector.init({
        onQuickTarget: (el) => inspectElement(el),
        onPropertyChange: handlePropertyChange,
        onBatchChange: handleBatchChange,
        onTextApply: handleTextApply,
        onDone: () => flushCommits(),
        onRequestVarInfo: handleVarInfoRequest,
        onRequestDeclared: handleDeclaredRequest,
        onFontsTabMount: (el) => fonts.mount(el),
        onPickAgain: () => startPicking(),
        onOpenTemplates: () => toggleTemplates(),
        onUndo: undo,
        onRedo: redo,
        isLite: () => !!cfg().liteEffects,
        picker,
        // Инструменты прямо в окне редактора
        tools: [
            { id: 'topbar', icon: 'fa-bars-staggered', label: 'Топ-бар',
              title: 'Фон, форма и значки верхней панели', onClick: () => topbar.togglePanel() },
            { id: 'gallery', icon: 'fa-address-card', label: 'Боты',
              title: 'Галерея персонажей, теги, персоны, быстрые аватарки', onClick: () => gallery.togglePanel(),
              isActive: () => !!gallery.isOpen?.() },
            { id: 'avatars', icon: 'fa-user-astronaut', label: 'Аватарки',
              title: 'Форма аватарки, подложка, слой поверх, шапка, текст под аватаркой', onClick: () => avatars.togglePanel(),
              isActive: () => !!avatars.isOpen?.() },
            { id: 'bubbles', icon: 'fa-comment-dots', label: 'Пузыри',
              title: 'Пузырь сообщения, цвета текста, ник и дата, бейджи — у бота и у вас вместе или отдельно',
              onClick: () => bubbles.togglePanel(),
              isActive: () => !!bubbles.isOpen?.() },
            { id: 'headers', icon: 'fa-heading', label: 'Заголовки',
              title: 'Стили всех заголовков: рамки, цвета, украшения', onClick: () => headers.togglePanel(),
              isActive: () => !!headers.isOpen?.() },
            { id: 'fonts', icon: 'fa-font', label: 'Шрифты',
              title: 'Шрифты: весь интерфейс, сообщения, имена, поле ввода…', onClick: () => toggleFontsWindow(),
              isActive: () => !!document.getElementById('vte-fonts-panel') && document.getElementById('vte-fonts-panel').style.display !== 'none' },
            { id: 'perf', icon: 'fa-feather', label: 'Облегчить',
              title: 'Выключить размытие, мягкие тени и градиенты во всей таверне — записывается в CSS',
              onClick: (el) => openToolPop(el, buildPerfPop),
              isActive: () => { const f = perfFlags(); return f.shadow || f.gradient; } },
            { id: 'code', icon: 'fa-code', label: 'Код',
              title: 'Показать или скрыть панель кода',
              onClick: () => { editor.isOpen?.() ? editor.hidePanel() : (editor.showPanel(), editor.setContent(customCSS)); inspector.refreshTools?.(); },
              isActive: () => !!editor.isOpen?.() },
            { id: 'dock', icon: 'fa-table-columns', label: 'К коду',
              title: 'Присоединить это окно к панели кода',
              onClick: (el) => openToolPop(el, buildDockPop),
              isActive: () => (cfg().dock || 'off') !== 'off' },
        ],
    });


    templates.init({
        store: cfg(),
        persist,
        onRequestPick: () => startPicking(),
        onStopPick: () => stopPicking(),
        onEditTemplate: editTemplateGroup,
        onItemsChanged: handleTemplateItemsChanged,
        onSelectorFor: (el) => generator.generateSelector(el),
        onToast: (text) => toast(text),
    });

    fonts.init({
        onToast: (t) => toast(t),
        onFontSelected: handleFontSelected,
    });

    editor.init({
        onCodeChange: handleCodeChange,
        onValidate: (css) => generator.validate(css),
        // Одна история на весь редактор: Ctrl+Z в коде и кнопка в панели
        // свойств делают одно и то же
        onUndo: undo,
        onRedo: redo,
        // Кнопка в шапке панели кода: открыть окно редактора
        onOpenEditor: () => {
            if (!active) { activate(); return; }
            inspector.createPanel();
            applyDock();
            inspector.refreshTools?.();
        },
    });
    // Тема окон (стандартная / под таверну / роза) — сразу для всех панелей
    try { editor.applyUiTheme?.(); } catch {}

    gallery.init({
        onApply: applyToolRules,
        onSnapshot: () => snapshotFor('gallery'),
        onRestore: () => restoreFor('gallery'),
        onReadRules: () => generator.autoRules(customCSS),
        onThemeRules: themeRulesForParts,
        onReveal: (from, to) => {
            if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
            setTimeout(() => editor.revealRange?.(from, to, { focus: true, hold: 4000 }), 60);
        },
        onToast: (t) => toast(t),
        picker,
    });

    avatars.init({
        onApply: applyToolRules,
        onSnapshot: () => snapshotFor('avatars'),
        onRestore: () => restoreFor('avatars'),
        onReadRules: () => generator.autoRules(customCSS),
        onThemeRules: themeRulesForParts,
        onReveal: (from, to) => {
            if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
            setTimeout(() => editor.revealRange?.(from, to, { focus: true, hold: 4000 }), 60);
        },
        onToast: (t) => toast(t),
        picker,
    });

    bubbles.init({
        onApply: applyToolRules,
        onSnapshot: () => snapshotFor('bubbles'),
        onRestore: () => restoreFor('bubbles'),
        onReadRules: () => generator.autoRules(customCSS),
        onThemeRules: themeRulesForParts,
        onReveal: (from, to) => {
            if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
            setTimeout(() => editor.revealRange?.(from, to, { focus: true, hold: 4000 }), 60);
        },
        onToast: (t) => toast(t),
        picker,
    });

    headers.init({
        onApply: applyToolRules,
        onSnapshot: () => snapshotFor('headers'),
        onRestore: () => restoreFor('headers'),
        onReadRules: () => generator.autoRules(customCSS),
        onThemeRules: themeRulesForParts,
        onReveal: (from, to) => {
            if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
            setTimeout(() => editor.revealRange?.(from, to, { focus: true, hold: 4000 }), 60);
        },
        onToast: (t) => toast(t),
        picker,
    });

    topbar.init({
        onApply: applyToolRules,
        onSnapshot: () => snapshotFor('topbar'),
        onRestore: () => restoreFor('topbar'),
        onThemeRules: themeTopbarRules,
        onIconRules: themeIconRules,
        onRevealMany: (list) => {
            if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
            setTimeout(() => editor.revealRanges?.(list, { hold: 6000 }), 60);
        },
        onReveal: (from, to) => {
            if (!editor.isOpen?.()) { editor.showPanel(); editor.setContent(customCSS); }
            setTimeout(() => editor.revealRange?.(from, to, { focus: true, hold: 4000 }), 60);
        },
        onReadRules: () => generator.autoRules(customCSS),
        onToast: (t) => toast(t),
        picker,
    });

    customCSS = readCSS();
    generator.parse(customCSS);

    bindHotkeys();
    watchDom();
    watchThemeSwitch();

    [300, 900, 2000, 4000].forEach(delay => setTimeout(() => {
        mountWandItem();
        mountSettingsPanel();
    }, delay));

    window.VisualThemeEditor = {
        toggle: toggleEditor,
        activate,
        deactivate,
        isActive: () => active,
        startPicking,
        stopPicking,
        togglePicking,
        isPicking,
        inspect: inspectElement,
        getCSS: readCSS,
        setCSS: (css) => { pushHistory(css); writeCSS(css); },
        undo,
        redo,
        variables: () => { generator.parse(readCSS()); return generator.getVariables(); },
        selectorFor: (el) => generator.generateSelector(el),
        targetsFor: (el) => buildTargets(el),
        ruleIndex: () => getRuleIndex(),
        topbar: () => topbar.togglePanel(),
        templates: {
            panel: () => templates.togglePanel(),
            list: () => cfg().templates,
            active: () => templates.getActive(),
            selector: () => templates.activeSelector(),
            edit: (id) => {
                const t = templates.setActive(id);
                if (t) editTemplateGroup(templates.groupSelectorOf(t), t);
            },
        },
    };

    console.log('[VTE] Visual Theme Editor готов ✓');
}

/* ============================================================
   ЗАПУСК
============================================================ */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
