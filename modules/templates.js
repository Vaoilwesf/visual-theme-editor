// modules/templates.js
// Шаблоны: именованные группы селекторов.
//
// Идея простая и надёжная: шаблон хранит список селекторов, а при правке
// они склеиваются в один селектор через запятую — «#a, .b, .c». Дальше
// работает обычный механизм записи CSS, поэтому любая вкладка редактора
// (цвет, размер, картинка, шрифт) применяется ко всей группе сразу.
//
// Набор можно прервать и продолжить позже: режим сбора включается для
// конкретного шаблона и просто дописывает в него новые селекторы.
//
// «Похожие»: по уже выбранным элементам расширение само предлагает общий
// селектор — «все такие на странице», «только внутри этой панели» и т.п.
// Одним кликом он заменяет ручной набор.
//
// Исключения: элемент можно не добавить, а вычесть из группы. Он уходит
// в :not(...) у каждого селектора списка.
//
// Правки группы едут вместе с составом: если шаблон уже правили, а потом
// добавили или убрали элемент, правила авто-блока переписываются на новый
// список селекторов (см. onItemsChanged в index.js).
//
// Экспорт и импорт: шаблоны сохраняются в маленький JSON-файл (только
// состав, без стилей) и загружаются обратно. Готовые шаблоны для
// SillyTavern лежат в stPresets.js.

import { ST_PRESETS } from './stPresets.js';

let store = null;              // объект настроек расширения
let persist = null;            // сохранить настройки
let onRequestPick = null;      // включить прицел
let onStopPick = null;         // выключить прицел
let onEditTemplate = null;     // навести панель свойств на шаблон
let onSelectorFor = null;      // построить селектор для элемента
let onToast = null;
let onItemsChanged = null;     // состав шаблона изменился: (t, было, стало)

let panel = null;
let els = {};

let collectingId = null;       // id шаблона, который сейчас набираем
let excludeMode = false;       // прицел не добавляет, а исключает
let suggestOpenId = null;      // у какого шаблона раскрыты «Похожие»
let lastSuggestions = null;    // { key, list } — чтобы не пересчитывать на каждый render
let presetsOpen = false;       // раскрыт ли список готовых шаблонов

/* ============================================================
   МИНИ-ХЕЛПЕР DOM
============================================================ */
function h(tagSpec, attrs, children) {
    const idMatch = tagSpec.match(/#([\w-]+)/);
    const clsList = (tagSpec.match(/\.[\w-]+/g) || []).map(s => s.slice(1));
    const tag = (tagSpec.match(/^[\w-]+/) || ['div'])[0];

    const node = document.createElement(tag);
    if (idMatch) node.id = idMatch[1];
    if (clsList.length) node.className = clsList.join(' ');

    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'text') { node.textContent = v; continue; }
            if (k === 'style') { node.style.cssText = v; continue; }
            if (k === 'dataset') { Object.assign(node.dataset, v); continue; }
            if (k === 'on') {
                for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
                continue;
            }
            if (k in node && typeof node[k] !== 'object' && k !== 'list') {
                try { node[k] = v; continue; } catch {}
            }
            node.setAttribute(k, v === true ? '' : v);
        }
    }
    for (const c of [].concat(children || [])) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
}

function icon(name) {
    return h('i', { className: `fa-solid ${name}` });
}

function iconBtn(faName, title, onClick, extraClass) {
    return h(`button.vte-icon-btn${extraClass ? '.' + extraClass : ''}`, {
        type: 'button', title, on: { click: onClick },
    }, [icon(faName)]);
}

function say(text) {
    onToast?.(text);
}

/* ============================================================
   ДИАЛОГИ

   window.prompt и confirm блокируют поток, игнорируют оформление ST и
   на части конфигураций браузера отключены совсем — тогда переименование
   шаблона просто не работало. Берём родные попапы SillyTavern, а если
   до них не дотянуться, откатываемся на нативные.
============================================================ */
function stContext() {
    try { return window.SillyTavern?.getContext?.() ?? null; } catch { return null; }
}

/** Ввод строки. Возвращает строку или null при отмене. */
async function askText(label, current) {
    const ctx = stContext();
    const popup = ctx?.callGenericPopup;
    const types = ctx?.POPUP_TYPE;

    if (typeof popup === 'function' && types?.INPUT != null) {
        try {
            const res = await popup(label, types.INPUT, current ?? '', {
                okButton: 'Сохранить',
                cancelButton: 'Отмена',
                rows: 1,
            });
            // Отмена возвращает false или null, пустая строка — тоже отказ
            if (res === false || res == null) return null;
            return String(res);
        } catch {}
    }

    try {
        const res = window.prompt(label, current ?? '');
        return res == null ? null : String(res);
    } catch {
        say('Диалоги заблокированы браузером');
        return null;
    }
}

/** Подтверждение. Возвращает true только при явном согласии. */
async function askConfirm(text, okLabel) {
    const ctx = stContext();
    const popup = ctx?.callGenericPopup;
    const types = ctx?.POPUP_TYPE;

    if (typeof popup === 'function' && types?.CONFIRM != null) {
        try {
            const res = await popup(text, types.CONFIRM, '', {
                okButton: okLabel || 'Удалить',
                cancelButton: 'Отмена',
            });
            return res === true || res === 1;
        } catch {}
    }

    try { return window.confirm(text); } catch { return false; }
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ И ХРАНИЛИЩЕ
============================================================ */
export function init(options = {}) {
    store = options.store || {};
    persist = options.persist || (() => {});
    onRequestPick = options.onRequestPick || (() => {});
    onStopPick = options.onStopPick || (() => {});
    onEditTemplate = options.onEditTemplate || (() => {});
    onSelectorFor = options.onSelectorFor || (() => '');
    onToast = options.onToast || (() => {});
    onItemsChanged = options.onItemsChanged || null;

    if (!Array.isArray(store.templates)) store.templates = [];
    if (typeof store.activeTemplate !== 'string') store.activeTemplate = '';

    // Чистим мусор, если настройки правились руками
    store.templates = store.templates
        .filter(t => t && typeof t === 'object' && t.id)
        .map(t => ({
            id: String(t.id),
            name: String(t.name || 'Без названия'),
            edited: !!t.edited,
            preset: t.preset ? String(t.preset) : undefined,
            items: Array.isArray(t.items)
                ? t.items.filter(i => i && i.selector).map(i => ({
                    selector: String(i.selector),
                    label: String(i.label || i.selector),
                    exclude: !!i.exclude,
                }))
                : [],
        }));
}

function list() {
    return store.templates;
}

function byId(id) {
    return list().find(t => t.id === id) || null;
}

export function getById(id) {
    return byId(id);
}

function save() {
    persist();
}

function newId() {
    return 'tpl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ============================================================
   ПУБЛИЧНОЕ API
============================================================ */
export function getActive() {
    return byId(store.activeTemplate);
}

/**
 * Части группового селектора: по одной на каждый добавленный селектор,
 * к каждой дописаны исключения. '.a:not(#x .b)', '.c:not(#x .b)'.
 * Отдельные :not() вместо одного со списком — внутри не бывает запятых,
 * и список можно безопасно резать по запятой.
 */
export function groupParts(t) {
    if (!t) return [];
    const not = t.items
        .filter(i => i.exclude)
        .map(i => `:not(${i.selector})`)
        .join('');
    return t.items
        .filter(i => !i.exclude)
        .map(i => i.selector + not);
}

/** Склеенный селектор шаблона: '#a, .b, .c' */
export function groupSelectorOf(t) {
    return groupParts(t).join(', ');
}

/** Селектор активного шаблона. Пусто, если шаблон не выбран */
export function activeSelector() {
    return groupSelectorOf(getActive());
}

/** Отметить, что шаблон уже правили: дальше правки едут за составом */
export function markEdited(t) {
    if (!t || t.edited) return;
    t.edited = true;
    save();
}

export function setActive(id) {
    const t = byId(id);
    store.activeTemplate = t ? t.id : '';
    save();
    render();
    return t;
}

export function clearActive() {
    store.activeTemplate = '';
    save();
    render();
}

export function isCollecting() {
    return !!collectingId;
}

/** Шаблон, который сейчас набирается */
export function collectingTemplate() {
    return byId(collectingId);
}

/**
 * Прицел выбрал элемент. Возвращает true, если элемент ушёл в шаблон —
 * тогда index.js не открывает обычную панель свойств.
 */
export function handlePicked(element) {
    if (!collectingId) return false;

    const t = byId(collectingId);
    if (!t) { stopCollect(); return false; }

    // Для исключения нужен селектор ровно на этот элемент. Обычный
    // генератор нарочно берёт шире (до 20 похожих) — исключение по нему
    // вычеркнуло бы из группы всех соседей разом.
    const selector = excludeMode ? preciseSelector(element) : onSelectorFor(element);
    if (!selector) {
        say('Для этого элемента не удалось построить селектор');
        return true;
    }

    if (t.items.some(i => i.selector === selector && !!i.exclude === excludeMode)) {
        say('Такой селектор уже в шаблоне');
        return true;
    }

    if (excludeMode) {
        if (!groupElements(t).includes(element)) {
            say('Этот элемент и так не входит в группу');
            return true;
        }
        commitItems(t, () => {
            t.items.push({ selector, label: describe(element, selector), exclude: true });
        });
        say(`Исключено из «${t.name}»`);
        return true;
    }

    // Элемент уже попадает в один из селекторов — второй такой же не нужен.
    // Раньше так и набирались списки из одинаковых строк.
    const holder = t.items.findIndex(i => !i.exclude && matchesOf(i.selector).includes(element));
    if (holder !== -1) {
        say(`Этот элемент уже в группе — входит в №${holder + 1}`);
        return true;
    }

    commitItems(t, () => {
        t.items.push({ selector, label: describe(element, selector) });
    });
    const got = matchesOf(selector).length;
    say(got > 1
        ? `Добавлено в «${t.name}»: этот селектор находит ${got} ${plural(got, 'элемент', 'элемента', 'элементов')}`
        : `Добавлено в «${t.name}»`);
    return true;
}

/** Вернуть состав шаблона как был — при отмене переноса правок */
export function restoreItems(id, items) {
    const t = byId(id);
    if (!t || !Array.isArray(items)) return;
    t.items = items.map(i => ({ ...i }));
    save();
    lastSuggestions = null;
    render();
}

/** Снимок состава — чтобы index.js мог вернуть его при отмене */
export function snapshotItems(t) {
    return t ? t.items.map(i => ({ ...i })) : [];
}

/**
 * Любое изменение состава идёт через эту функцию: она сообщает наружу
 * «было / стало», и index.js переносит уже сделанные правки группы.
 */
function commitItems(t, mutate) {
    const before = groupParts(t);
    const itemsBefore = snapshotItems(t);
    mutate();
    save();
    lastSuggestions = null;
    render();
    const after = groupParts(t);
    if (before.join('\n') !== after.join('\n')) {
        try {
            onItemsChanged?.(t, before, after, { itemsBefore, itemsAfter: snapshotItems(t) });
        } catch (e) { console.error('[VTE]', e); }
    }
}

/* ============================================================
   РЕЖИМ НАБОРА
============================================================ */
export function startCollect(id) {
    const t = byId(id);
    if (!t) return;
    collectingId = t.id;
    excludeMode = false;
    showPanel();
    render();
    onRequestPick();
    say(`Набор в «${t.name}». Кликайте по элементам, потом нажмите «Готово».`);
}

export function stopCollect() {
    if (!collectingId) return;
    const t = byId(collectingId);

    // Прицел гасим ДО обнуления collectingId: обработчик onStateChange
    // в index.js спрашивает isCollecting(), чтобы не показывать лишний тост.
    onStopPick();

    collectingId = null;
    excludeMode = false;
    clearHighlight();
    render();
    if (t) {
        say(t.items.length
            ? `Шаблон «${t.name}»: ${t.items.length} ${plural(t.items.length, 'элемент', 'элемента', 'элементов')}`
            : `Шаблон «${t.name}» пока пуст`);
    }
}


/* ============================================================
   ОПЕРАЦИИ С ШАБЛОНАМИ
============================================================ */
/** Два шаблона с одинаковым именем в списке различить невозможно */
function uniqueName(name) {
    if (!list().some(t => t.name === name)) return name;
    let n = 2;
    while (list().some(t => t.name === `${name} ${n}`)) n++;
    return `${name} ${n}`;
}

function createTemplate() {
    const name = uniqueName((els.newName.value || '').trim() || `Шаблон ${list().length + 1}`);

    const t = { id: newId(), name, items: [] };
    list().push(t);
    store.activeTemplate = t.id;
    save();
    els.newName.value = '';
    startCollect(t.id);
}


async function renameTemplate(t) {
    const next = await askText('Название шаблона', t.name);
    if (next == null) return;

    const clean = next.trim();
    if (!clean) { say('Название не может быть пустым'); return; }
    if (clean === t.name) return;

    t.name = clean;
    save();
    render();
    say(`Переименовано: «${clean}»`);
}

async function deleteTemplate(t) {
    const ok = await askConfirm(
        `Удалить шаблон «${t.name}»?\n\n`
        + `В нём ${t.items.length} `
        + `${plural(t.items.length, 'селектор', 'селектора', 'селекторов')}. `
        + 'Правила CSS, сделанные через этот шаблон, останутся в теме — '
        + 'убрать их можно кнопкой «Сбросить» в панели свойств.',
        'Удалить шаблон');

    if (!ok) return;

    store.templates = list().filter(x => x.id !== t.id);
    if (store.activeTemplate === t.id) store.activeTemplate = '';
    if (collectingId === t.id) { collectingId = null; onStopPick(); }
    save();
    render();
    say('Шаблон удалён');
}


function duplicateTemplate(t) {
    const copy = {
        id: newId(),
        name: `${t.name} — копия`,
        edited: false,   // правки остались за оригиналом
        items: t.items.map(i => ({ ...i })),
    };
    list().push(copy);
    save();
    render();
}

function removeItem(t, index) {
    clearHighlight();
    commitItems(t, () => { t.items.splice(index, 1); });
}

/** Убрать селекторы, чьи элементы целиком покрыты остальными */
function dropRedundant(t) {
    const extra = redundantMap(t);
    if (!extra.size) return;
    commitItems(t, () => {
        t.items = t.items.filter((_, i) => !extra.has(i));
    });
    say(`Убрано лишних: ${extra.size}`);
}

function editTemplate(t) {
    if (!t.items.length) {
        say('Сначала наберите элементы в шаблон');
        return;
    }
    if (!t.items.some(i => !i.exclude)) {
        say('В шаблоне одни исключения — добавьте, что править');
        return;
    }
    store.activeTemplate = t.id;
    save();
    render();
    onEditTemplate(groupSelectorOf(t), t);
}

/* ============================================================
   ПАНЕЛЬ
============================================================ */
export function createPanel() {
    if (panel) {
        panel.style.display = 'flex';
        render();
        return panel;
    }

    els.header = h('div#vte-tpl-header.vte-header', {}, [
        h('div.vte-title', {}, [
            h('span.vte-title-ic', {}, [icon('fa-layer-group')]),
            h('span', { text: 'Шаблоны групп' }),
        ]),
        h('div.vte-header-btns', {}, [
            iconBtn('fa-file-import', 'Импорт шаблонов из файла', importFromFile),
            iconBtn('fa-file-export', 'Экспорт всех шаблонов в файл', () => exportTemplates(list())),
            iconBtn('fa-window-minimize', 'Свернуть',
                () => panel.classList.toggle('vte-collapsed')),
            iconBtn('fa-xmark', 'Закрыть', hidePanel, 'vte-icon-btn-close'),
        ]),
    ]);

    els.newName = h('input.vte-input', {
        type: 'text', spellcheck: false,
        placeholder: 'Название нового шаблона',
        on: {
            keydown: (e) => { if (e.key === 'Enter') createTemplate(); },
        },
    });

    els.createRow = h('div.vte-tpl-create', {}, [
        els.newName,
        h('button.vte-btn.vte-btn-primary', {
            type: 'button',
            title: 'Создать шаблон и сразу начать набор элементов',
            on: { click: createTemplate },
        }, [icon('fa-plus'), h('span', { text: ' Создать' })]),
    ]);

    els.presets = h('div.vte-tpl-presets');
    els.collectBar = h('div#vte-tpl-collect.vte-tpl-collect', { style: 'display:none' });
    els.list = h('div#vte-tpl-list.vte-tpl-list');

    els.note = h('small.vte-note', {
        text: 'Правки применяются ко всем элементам шаблона сразу: '
            + 'в CSS пишется одно правило со списком селекторов через запятую.',
    });

    panel = h('div#vte-templates-panel.vte-panel.vte-tpl-panel', {}, [
        els.header,
        h('div.vte-tpl-body', {}, [els.createRow, els.presets, els.collectBar, els.list, els.note]),
    ]);

    document.body.appendChild(panel);
    makeDraggable(panel, els.header);
    shield(panel);
    render();
    return panel;
}

export function showPanel() {
    if (!panel) createPanel();
    panel.style.display = 'flex';
    render();
}

export function hidePanel() {
    clearHighlight();
    if (panel) panel.style.display = 'none';
}

export function isOpen() {
    return !!panel && panel.style.display !== 'none';
}

export function togglePanel() {
    isOpen() ? hidePanel() : showPanel();
}

/* ============================================================
   ОТРИСОВКА
============================================================ */
function render() {
    if (!panel) return;
    renderPresets();
    renderCollectBar();
    renderList();
}

function renderCollectBar() {
    const bar = els.collectBar;
    const t = byId(collectingId);

    if (!t) { bar.style.display = 'none'; bar.textContent = ''; return; }

    bar.textContent = '';
    bar.style.display = 'flex';
    bar.classList.toggle('vte-tpl-collect-excl', excludeMode);

    const n = groupElements(t).length;
    const modeBtn = (on, faName, label, title) => h(
        `button.vte-tpl-mode-btn${excludeMode === on ? '.active' : ''}`, {
            type: 'button', title,
            on: { click: () => { excludeMode = on; render(); } },
        }, [icon(faName), h('span', { text: ' ' + label })]);

    bar.append(
        h('div.vte-tpl-collect-row', {}, [
            h('span.vte-tpl-collect-ic', {}, [icon(excludeMode ? 'fa-ban' : 'fa-crosshairs')]),
            h('span.vte-tpl-collect-text', {
                text: excludeMode
                    ? `Исключение из «${t.name}»: кликните элемент, который НЕ должен меняться.`
                    : `Набор в «${t.name}» — в группе ${n} ${plural(n, 'элемент', 'элемента', 'элементов')}. `
                      + 'Кликните хотя бы один — ниже появятся похожие.',
            }),
            h('button.vte-btn.vte-btn-primary', {
                type: 'button',
                on: { click: stopCollect },
            }, [icon('fa-check'), h('span', { text: ' Готово' })]),
        ]),
        h('div.vte-tpl-mode', {}, [
            modeBtn(false, 'fa-plus', 'Добавлять', 'Клик по элементу добавляет его в группу'),
            modeBtn(true, 'fa-ban', 'Исключать', 'Клик по элементу вычитает его из группы'),
        ]),
        !excludeMode && t.items.some(i => !i.exclude) ? suggestBox(t) : null,
    );
}

function renderList() {
    const box = els.list;
    box.textContent = '';

    if (!list().length) {
        box.appendChild(h('div.vte-tpl-empty', {}, [
            h('span.vte-empty-ic', {}, [icon('fa-layer-group')]),
            h('div', { text: 'Шаблонов пока нет' }),
            h('small', {
                text: 'Введите название, нажмите «Создать» и прицелом соберите '
                    + 'однотипные элементы — например все заголовки панелей',
            }),
        ]));
        return;
    }

    for (const t of list()) {
        box.appendChild(templateCard(t));
    }
}

function templateCard(t) {
    const isActive = store.activeTemplate === t.id;
    const isCollect = collectingId === t.id;

    const head = h('div.vte-tpl-head', {}, [
        h('button.vte-tpl-name', {
            type: 'button',
            title: 'Сделать этот шаблон текущим',
            on: { click: () => setActive(t.id) },
        }, [
            icon(isActive ? 'fa-circle-dot' : 'fa-circle'),
            h('span', { text: ' ' + t.name }),
        ]),
        h('span.vte-tpl-count', {
            text: `${t.items.length}`,
            title: `${t.items.length} ${plural(t.items.length, 'селектор', 'селектора', 'селекторов')}`,
        }),
        h('div.vte-tpl-btns', {}, [
            iconBtn('fa-wand-magic-sparkles', 'Похожие: обобщить группу одним селектором', () => {
                suggestOpenId = suggestOpenId === t.id ? null : t.id;
                lastSuggestions = null;
                render();
            }, suggestOpenId === t.id ? 'active' : ''),
            iconBtn('fa-pen', 'Переименовать', () => renameTemplate(t)),
            iconBtn('fa-download', 'Экспорт шаблона в файл', () => exportTemplates([t])),
            iconBtn('fa-copy', 'Дублировать', () => duplicateTemplate(t)),
            iconBtn('fa-trash', 'Удалить', () => deleteTemplate(t), 'vte-icon-btn-close'),
        ]),
    ]);

    const items = h('div.vte-tpl-items');
    if (!t.items.length) {
        items.appendChild(h('div.vte-tpl-item-empty', {
            text: 'Пусто — нажмите «Добавить элементы»',
        }));
    } else {
        const extra = redundantMap(t);
        t.items.forEach((item, i) => {
            const cover = extra.get(i);
            const row = h(`div.vte-tpl-item${item.exclude ? '.vte-tpl-item-excl' : ''}${cover ? '.vte-tpl-item-extra' : ''}`, {
                on: {
                    mouseenter: () => highlight(matchesOf(item.selector), item.exclude),
                    mouseleave: clearHighlight,
                },
            }, [
                h('span.vte-tpl-item-n', { text: String(i + 1) }),
                item.exclude ? h('span.vte-tpl-item-tag', { title: 'Исключение', text: 'кроме' }) : null,
                isHeavySelector(item.selector)
                    ? h('span.vte-tpl-item-tag.vte-tpl-item-tag-warn', {
                        text: 'тяжёлый',
                        title: 'В селекторе есть *, :has() или поиск по части атрибута. Браузер '
                            + 'перепроверяет такие при каждом изменении чата — лучше заменить '
                            + 'на класс через «Похожие»',
                    })
                    : null,
                // Показываем сам селектор, а не «div.класс.класс»: подписи
                // у разных строк совпадали, и понять, чем они отличаются,
                // было невозможно
                h('code.vte-tpl-item-sel', {
                    text: item.selector,
                    title: item.selector,
                }),
                cover
                    ? h('span.vte-tpl-item-tag.vte-tpl-item-tag-warn', {
                        text: cover === -1 ? 'дубль' : `в №${cover}`,
                        title: cover === -1
                            ? 'Все эти элементы уже покрыты остальными строками'
                            : `Все эти элементы уже входят в строку №${cover}. Строку можно убрать`,
                    })
                    : null,
                (() => {
                    const label = hitsLabel(item.selector);
                    // У готовых шаблонов часть строк относится к окнам, которых
                    // может не быть на экране (всплывающее окно не открыто) —
                    // это не ошибка, красным не отмечаем
                    const dead = label === '0' && !t.preset;
                    return h(`span.vte-tpl-item-hits${dead ? '.vte-tpl-item-dead' : ''}`, {
                        text: label,
                        title: dead
                            ? 'Ни один элемент не найден. Разметка SillyTavern могла '
                              + 'измениться — селектор больше не попадает в цель'
                            : 'Сколько элементов попадают в этот селектор. Наведите — покажу на странице',
                    });
                })(),
                iconBtn('fa-xmark', 'Убрать из шаблона', () => removeItem(t, i)),
            ]);
            items.appendChild(row);
        });
    }

    const extraCount = t.items.length ? redundantMap(t).size : 0;
    const total = groupElements(t).length;
    const summary = t.items.length
        ? h('div.vte-tpl-summary', {
            on: {
                mouseenter: () => highlight(groupElements(t)),
                mouseleave: clearHighlight,
            },
        }, [
            h('span', {
                text: `Всего в группе: ${total} ${plural(total, 'элемент', 'элемента', 'элементов')}`,
                title: 'Наведите — покажу все элементы группы на странице',
            }),
            extraCount
                ? h('button.vte-tpl-link', {
                    type: 'button',
                    title: 'Убрать строки, которые ничего не добавляют к группе',
                    on: { click: () => dropRedundant(t) },
                }, [icon('fa-broom'), h('span', { text: ` Убрать лишние (${extraCount})` })])
                : null,
        ])
        : null;

    const suggest = suggestOpenId === t.id && !isCollect && t.items.some(i => !i.exclude)
        ? suggestBox(t)
        : null;

    const actions = h('div.vte-tpl-actions', {}, [
        isCollect
            ? h('button.vte-btn', {
                type: 'button',
                on: { click: stopCollect },
            }, [icon('fa-check'), h('span', { text: ' Закончить набор' })])
            : h('button.vte-btn', {
                type: 'button',
                title: 'Включить прицел и дописать элементы в этот шаблон',
                on: { click: () => startCollect(t.id) },
            }, [icon('fa-crosshairs'), h('span', { text: ' Добавить элементы' })]),

        h('button.vte-btn.vte-btn-primary', {
            type: 'button',
            title: 'Открыть панель свойств и править всю группу сразу',
            disabled: !t.items.length,
            on: { click: () => editTemplate(t) },
        }, [icon('fa-sliders'), h('span', { text: ' Править группу' })]),
    ]);

    const card = h('div.vte-tpl-card', {}, [head, items, summary, suggest, actions]);
    if (isActive) card.classList.add('vte-tpl-active');
    if (isCollect) card.classList.add('vte-tpl-collecting');
    return card;
}

/* ============================================================
   СОВПАДЕНИЯ
============================================================ */

/* Свои панели и слои подсветки в группу попадать не должны */
function isOurs(el) {
    return !!el.closest?.('[id^="vte-"]');
}

/* Кеш живёт полторы секунды, как и счётчик попаданий: за один render
   один и тот же селектор спрашивается несколько раз */
const matchCache = new Map();
let matchCacheAt = 0;

function matchesOf(selector) {
    const now = Date.now();
    if (now - matchCacheAt > 1500) {
        matchCache.clear();
        matchCacheAt = now;
    }
    if (matchCache.has(selector)) return matchCache.get(selector);

    let out = [];
    try {
        out = Array.from(document.querySelectorAll(selector)).filter(el => !isOurs(el));
    } catch {}
    matchCache.set(selector, out);
    return out;
}

/**
 * Селектор ровно на один элемент: путь вверх по дереву с :nth-child,
 * пока совпадение не станет единственным, с опорой на ближайший id.
 */
function preciseSelector(el) {
    const base = onSelectorFor(el);
    if (base) {
        const m = matchesOf(base);
        if (m.length === 1 && m[0] === el) return base;
    }

    const compound = (node) => {
        let out = node.tagName.toLowerCase();
        for (const c of stableClasses(node).slice(0, 2)) out += '.' + esc(c);
        const parent = node.parentElement;
        if (parent) {
            const idx = Array.prototype.indexOf.call(parent.children, node);
            out += `:nth-child(${idx + 1})`;
        }
        return out;
    };

    const path = [];
    let cur = el;
    for (let depth = 0; cur && cur !== document.body && depth < 10; depth++) {
        path.unshift(compound(cur));
        const parent = cur.parentElement;

        // Ближайший предок со стабильным id — надёжная опора
        let anchor = parent;
        while (anchor && anchor !== document.body && !(anchor.id && isStableId(anchor.id))) {
            anchor = anchor.parentElement;
        }
        const tail = path.join(' > ');
        const tries = [];
        if (anchor && anchor !== document.body) tries.push(`#${esc(anchor.id)} ${tail}`);
        tries.push(tail);

        for (const sel of tries) {
            const m = matchesOf(sel);
            if (m.length === 1 && m[0] === el) return sel;
        }
        cur = parent;
    }
    return base || '';
}

/** Все элементы, которые сейчас попадают в группу (с учётом исключений) */
function groupElements(t) {
    const seen = new Set();
    for (const part of groupParts(t)) {
        for (const el of matchesOf(part)) seen.add(el);
    }
    return [...seen];
}

/**
 * Какие строки лишние: всё, что они находят, уже покрыто остальными.
 * Возвращает Map(индекс -> номер строки, которая его покрывает, или -1,
 * если покрывают несколько вместе).
 */
function redundantMap(t) {
    const out = new Map();
    const inc = t.items.map((it, i) => ({ it, i })).filter(x => !x.it.exclude);
    const sets = new Map(inc.map(x => [x.i, new Set(matchesOf(x.it.selector))]));

    for (const { i } of inc) {
        const own = sets.get(i);
        if (!own.size) continue;

        // Сначала ищем одну строку, которая покрывает целиком — так понятнее
        let by = 0;
        for (const { i: j } of inc) {
            if (j === i || out.has(j)) continue;
            const other = sets.get(j);
            if (other.size >= own.size && [...own].every(el => other.has(el))) { by = j + 1; break; }
        }
        if (by) { out.set(i, by); continue; }

        // Потом — покрытие всеми остальными вместе
        const union = new Set();
        for (const { i: j } of inc) {
            if (j === i || out.has(j)) continue;
            for (const el of sets.get(j)) union.add(el);
        }
        if ([...own].every(el => union.has(el))) out.set(i, -1);
    }
    return out;
}

/* ============================================================
   ПОХОЖИЕ: ОБЩИЙ СЕЛЕКТОР ПО ВЫБРАННЫМ ЭЛЕМЕНТАМ

   Берём элементы группы и ищем селекторы, которые находят их все:
     - по общим классам самих элементов: .inline-drawer-header;
     - те же, но внутри общего «контейнера» — id или класса, который
       есть у предков всех выбранных: #extensions_settings .inline-drawer-header.
   Из кандидатов, дающих одинаковый набор элементов, оставляем самый
   короткий, а в список выводим несколько вариантов от узкого к широкому.
============================================================ */

/* Классы состояния и служебные: по ним группировать нельзя, они
   появляются и исчезают (open, active) или принадлежат библиотекам */
const STATE_CLASS = /^(ui-|jq|select2|swiper|ng-|is-|has-|active|selected|open|opened|closed|hidden|shown|show|visible|dragging|animated|interactable|last_mes|vte-|aa-|ag-|hover|focus|disabled|expanded|collapsed|current|toggled|checked|fa-fw$|fa-lg$|fa-xl$)/i;

function stableClasses(el) {
    return Array.from(el.classList).filter(c =>
        c.length > 1 && !STATE_CLASS.test(c) && !/^\d/.test(c) && !/\d{3,}/.test(c));
}

function isStableId(v) {
    return /^[a-z][\w-]{1,60}$/i.test(v) && !/^\w{0,3}\d{4,}$/.test(v);
}

function esc(v) {
    return window.CSS?.escape ? CSS.escape(v) : String(v).replace(/([^\w-])/g, '\\$1');
}

/** id и классы предков — «контейнеры», по которым можно сузить выбор */
function ancestorTokens(el) {
    const out = [];
    let p = el.parentElement;
    let depth = 0;
    while (p && p !== document.body && p !== document.documentElement && depth < 12) {
        if (p.id && isStableId(p.id)) out.push('#' + esc(p.id));
        for (const c of stableClasses(p).slice(0, 4)) out.push('.' + esc(c));
        p = p.parentElement;
        depth++;
    }
    return out;
}

function sameSet(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

function suggestFor(elements) {
    const E = [...new Set(elements)].filter(el => el && el.isConnected && !isOurs(el));
    if (!E.length) return [];

    const tags = new Set(E.map(el => el.tagName.toLowerCase()));
    const tag = tags.size === 1 ? [...tags][0] : null;

    // Общие классы самих элементов
    const common = stableClasses(E[0]).filter(c => E.every(el => el.classList.contains(c)));

    const bases = [];
    for (const c of common.slice(0, 5)) bases.push('.' + esc(c));
    const top = common.slice(0, 4);
    for (let i = 0; i < top.length; i++) {
        for (let j = i + 1; j < top.length; j++) bases.push(`.${esc(top[i])}.${esc(top[j])}`);
    }
    if (tag) {
        for (const c of common.slice(0, 3)) bases.push(`${tag}.${esc(c)}`);
        if (!common.length) bases.push(tag);
    }
    if (!bases.length) return [];

    // Контейнеры, общие для всех: сохраняем порядок «от ближнего к дальнему»
    let scopes = ancestorTokens(E[0]);
    for (const el of E.slice(1)) {
        const mine = new Set(ancestorTokens(el));
        scopes = scopes.filter(s => mine.has(s));
    }
    scopes = [...new Set(scopes)].slice(0, 8);

    const candidates = [...bases.slice(0, 12)];
    for (const sc of scopes) {
        for (const b of bases.slice(0, 4)) candidates.push(`${sc} ${b}`);
    }

    const need = new Set(E);
    const found = [];
    for (const sel of candidates) {
        const m = matchesOf(sel);
        if (m.length < E.length || m.length > 600) continue;
        const ms = new Set(m);
        let ok = true;
        for (const el of need) if (!ms.has(el)) { ok = false; break; }
        if (!ok) continue;

        const twin = found.find(f => sameSet(f.els, m));
        if (twin) {
            if (sel.length < twin.sel.length) twin.sel = sel;
            continue;
        }
        found.push({ sel, els: m, count: m.length, scoped: /\s/.test(sel) });
    }

    found.sort((a, b) => a.count - b.count || a.sel.length - b.sel.length);

    // Не больше пяти вариантов, равномерно от узкого к широкому
    let pick = found;
    if (found.length > 5) {
        pick = [];
        for (let k = 0; k < 5; k++) {
            const f = found[Math.round(k * (found.length - 1) / 4)];
            if (!pick.includes(f)) pick.push(f);
        }
    }

    const widest = pick[pick.length - 1];
    return pick.map(f => ({
        ...f,
        label: f.count === E.length
            ? 'Те же, одной строкой'
            : (f.scoped ? `Внутри ${f.sel.split(' ')[0]}` : (f === widest ? 'Все такие на странице' : 'Все такие')),
    }));
}

function suggestionsFor(t) {
    const els = groupElements(t);
    const key = t.id + '|' + groupParts(t).join('\n') + '|' + els.length;
    if (lastSuggestions?.key === key && Date.now() - lastSuggestions.at < 1500) {
        return lastSuggestions.list;
    }
    // Вариант «те же элементы» полезен, только когда строк несколько:
    // он сворачивает их в одну. Для одной строки это пустая замена.
    const single = t.items.filter(i => !i.exclude).length < 2;
    const list = suggestFor(els).filter(s => !(single && s.count === els.length));
    lastSuggestions = { key, list, at: Date.now() };
    return list;
}

/** Заменить набранные строки одним общим селектором */
function applySuggestion(t, s) {
    const set = new Set(s.els);
    clearHighlight();
    commitItems(t, () => {
        // Строки, которые общий селектор покрывает целиком, больше не нужны.
        // Непокрытые и исключения остаются как были.
        const keep = t.items.filter(i => i.exclude || !matchesOf(i.selector).every(el => set.has(el)));
        t.items = [{ selector: s.sel, label: s.sel }, ...keep];
    });
    suggestOpenId = null;
    say(`Группа «${t.name}»: ${s.count} ${plural(s.count, 'элемент', 'элемента', 'элементов')} одним селектором`);
}

function suggestBox(t) {
    const list = suggestionsFor(t);
    const box = h('div.vte-tpl-suggest');

    if (!list.length) {
        box.appendChild(h('div.vte-tpl-suggest-empty', {
            text: 'Общего селектора не нашлось: у выбранных элементов нет общих классов. '
                + 'Добавьте элементы вручную.',
        }));
        return box;
    }

    box.appendChild(h('div.vte-tpl-suggest-title', {
        text: 'Похожие — наведите, чтобы увидеть; клик заменит список одним селектором',
    }));

    for (const s of list) {
        box.appendChild(h('button.vte-tpl-chip', {
            type: 'button',
            title: s.sel,
            on: {
                mouseenter: () => highlight(s.els),
                mouseleave: clearHighlight,
                click: () => applySuggestion(t, s),
            },
        }, [
            h('span.vte-tpl-chip-label', { text: s.label }),
            h('code.vte-tpl-chip-sel', { text: s.sel }),
            h('span.vte-tpl-chip-n', { text: `×${s.count}` }),
        ]));
    }
    return box;
}

/* ============================================================
   ПОДСВЕТКА ЭЛЕМЕНТОВ НА СТРАНИЦЕ
============================================================ */
let hlLayer = null;

function highlight(elements, isExclude) {
    clearHighlight();
    if (!elements || !elements.length) return;

    hlLayer = h('div#vte-tpl-hl-layer');
    let shown = 0;
    for (const el of elements) {
        if (shown >= 300) break;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        hlLayer.appendChild(h(`div.vte-tpl-hl${isExclude ? '.vte-tpl-hl-excl' : ''}`, {
            style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`,
        }));
        shown++;
    }
    document.body.appendChild(hlLayer);
}

function clearHighlight() {
    hlLayer?.remove();
    hlLayer = null;
}

/* ============================================================
   ГОТОВЫЕ ШАБЛОНЫ ДЛЯ SILLYTAVERN
============================================================ */
function presetOf(p) {
    // По id, а если шаблон пришёл из файла — по совпадающему составу
    const sig = signature(p.items.map(sel => ({ selector: sel })));
    return list().find(t => t.preset === p.id || signature(t.items) === sig) || null;
}

function addPreset(p) {
    const have = presetOf(p);
    if (have) {
        store.activeTemplate = have.id;
        save();
        render();
        say(`«${have.name}» уже в списке`);
        return;
    }
    const t = {
        id: newId(),
        name: uniqueName(p.name),
        preset: p.id,
        edited: false,
        items: p.items.map(sel => ({ selector: sel, label: sel })),
    };
    list().push(t);
    store.activeTemplate = t.id;
    save();
    render();
    say(`Добавлен «${t.name}». Нажмите «Править группу», чтобы задать оформление`);
}

function renderPresets() {
    const box = els.presets;
    if (!box) return;
    box.textContent = '';

    box.appendChild(h('button.vte-tpl-presets-toggle', {
        type: 'button',
        on: { click: () => { presetsOpen = !presetsOpen; render(); } },
    }, [
        icon('fa-box-open'),
        h('span', { text: ' Готовые шаблоны для SillyTavern' }),
        h('span.vte-tpl-presets-chev', {}, [icon(presetsOpen ? 'fa-chevron-up' : 'fa-chevron-down')]),
    ]));

    if (!presetsOpen) return;

    const rows = h('div.vte-tpl-presets-list');
    for (const p of ST_PRESETS) {
        const els_ = () => {
            const seen = new Set();
            for (const sel of p.items) for (const el of matchesOf(sel)) seen.add(el);
            return [...seen];
        };
        const n = els_().length;
        const have = presetOf(p);

        rows.appendChild(h('div.vte-tpl-preset', {
            on: {
                mouseenter: () => highlight(els_()),
                mouseleave: clearHighlight,
            },
        }, [
            h('div.vte-tpl-preset-head', {}, [
                h('span.vte-tpl-preset-name', { text: p.name }),
                h('span.vte-tpl-preset-n', {
                    text: n ? `×${n}` : '—',
                    title: n
                        ? 'Сколько таких элементов сейчас на странице. Наведите — покажу'
                        : 'Сейчас на странице таких нет (например, окно не открыто)',
                }),
                h(`button.vte-btn.vte-tpl-preset-add${have ? '.vte-tpl-preset-have' : ''}`, {
                    type: 'button',
                    title: have ? 'Уже в списке — открыть его' : 'Добавить в мои шаблоны',
                    on: { click: () => addPreset(p) },
                }, [icon(have ? 'fa-check' : 'fa-plus'), h('span', { text: have ? ' В списке' : ' Добавить' })]),
            ]),
            h('div.vte-tpl-preset-desc', { text: p.desc || '' }),
            h('code.vte-tpl-preset-sel', { text: p.items.join(', ') }),
        ]));
    }
    box.appendChild(rows);
}

/* Селекторы, которые браузер проверяет дорого */
function isHeavySelector(sel) {
    return /:has\(|(^|[\s>+~(])\*(?!=)|\[[^\]]*[*^$|~]=/.test(String(sel || ''));
}

/* ============================================================
   ЭКСПОРТ И ИМПОРТ
   Файл хранит только состав шаблонов — несколько строк селекторов.
   Стили в него не попадают: они живут в теме.
============================================================ */
const EXPORT_FORMAT = 'vte-templates';

function serialize(tpls) {
    return JSON.stringify({
        format: EXPORT_FORMAT,
        version: 1,
        templates: tpls.map(t => ({
            name: t.name,
            items: t.items.map(i => i.exclude ? { selector: i.selector, exclude: true } : i.selector),
        })),
    }, null, 1);
}

function fileSafe(v) {
    return String(v).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '-').slice(0, 60) || 'template';
}

function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportTemplates(tpls) {
    if (!tpls.length) { say('Шаблонов пока нет — экспортировать нечего'); return; }
    const name = tpls.length === 1
        ? `vte-шаблон-${fileSafe(tpls[0].name)}.json`
        : `vte-шаблоны-${new Date().toISOString().slice(0, 10)}.json`;
    download(name, serialize(tpls));
    say(tpls.length === 1 ? `Шаблон «${tpls[0].name}» сохранён в файл` : `Сохранено шаблонов: ${tpls.length}`);
}

function importFromFile() {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        if (f.size > 512 * 1024) { say('Файл слишком большой для шаблонов'); return; }
        try {
            importText(await f.text());
        } catch {
            say('Не удалось прочитать файл');
        }
    });
    input.click();
}

/**
 * Разрезать строку по запятым верхнего уровня. Один пункт шаблона —
 * один селектор: иначе исключения :not() легли бы только на последний.
 */
function splitList(sel) {
    const out = [];
    let depth = 0, quote = '', buf = '';
    for (const c of sel) {
        if (quote) { buf += c; if (c === quote) quote = ''; continue; }
        if (c === '"' || c === "'") { quote = c; buf += c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
        if (c === ',' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; continue; }
        buf += c;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

const probeFragment = document.createDocumentFragment();

/**
 * Проверка селектора из чужого файла. Селектор потом попадает в CSS темы,
 * поэтому скобки блоков, точка с запятой, @ и комментарии запрещены:
 * через них в тему можно было бы протащить посторонние правила.
 */
function safeSelector(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim().replace(/\s+/g, ' ');
    if (!s || s.length > 400) return null;
    if (/[{};<@]|\/\*|\*\//.test(s)) return null;   // «>» — обычный комбинатор, он разрешён
    if (s === '*' || /^(html|:root)$/i.test(s)) return null;
    try { probeFragment.querySelector(s); } catch { return null; }
    return s;
}

const signature = (items) => items
    .map(i => (i.exclude ? '-' : '+') + i.selector)
    .sort()
    .join('\n');

function importText(text) {
    let data;
    try { data = JSON.parse(text); } catch { say('Это не файл шаблонов (не JSON)'); return; }

    const arr = Array.isArray(data) ? data
        : Array.isArray(data?.templates) ? data.templates
        : Array.isArray(data?.items) ? [data]
        : null;
    if (!arr) { say('В файле не нашлось шаблонов'); return; }

    let added = 0, dup = 0, dropped = 0, empty = 0;
    for (const raw of arr.slice(0, 200)) {
        if (!raw || !Array.isArray(raw.items)) { empty++; continue; }

        const items = [];
        const seen = new Set();
        for (const it of raw.items.slice(0, 100)) {
            const exclude = !!(it && typeof it === 'object' && it.exclude);
            const src = typeof it === 'string' ? it : it?.selector;
            for (const part of (typeof src === 'string' ? splitList(src) : [null])) {
                const sel = safeSelector(part);
                if (!sel) { dropped++; continue; }
                const key = (exclude ? '-' : '+') + sel;
                if (seen.has(key)) continue;
                seen.add(key);
                items.push({ selector: sel, label: sel, exclude });
            }
        }
        if (!items.some(i => !i.exclude)) { empty++; continue; }

        const sig = signature(items);
        if (list().some(t => signature(t.items) === sig)) { dup++; continue; }

        list().push({
            id: newId(),
            name: uniqueName(String(raw.name || 'Импорт').trim().slice(0, 80) || 'Импорт'),
            edited: false,
            items,
        });
        added++;
    }

    save();
    render();

    const parts = [`Импортировано шаблонов: ${added}`];
    if (dup) parts.push(`уже были: ${dup}`);
    if (empty) parts.push(`пустых: ${empty}`);
    if (dropped) parts.push(`отброшено неверных селекторов: ${dropped}`);
    say(parts.join(', '));
}

/* ============================================================
   МЕЛОЧИ
============================================================ */
function describe(element, selector) {
    let out = element.tagName.toLowerCase();
    if (element.id) out += '#' + element.id;
    else {
        const cls = Array.from(element.classList)
            .filter(c => !c.startsWith('vte-'))
            .slice(0, 2);
        if (cls.length) out += '.' + cls.join('.');
    }
    return out.length > 2 ? out : selector;
}

/* Счётчик попаданий вызывался для каждого селектора при каждом render(),
   а render() дёргается на каждый клик прицела. Кеш сбрасывается по времени:
   разметка ST меняется, но не за доли секунды. */
const hitsCache = new Map();
let hitsCacheAt = 0;

function hitsLabel(selector) {
    const now = Date.now();
    if (now - hitsCacheAt > 1500) {
        hitsCache.clear();
        hitsCacheAt = now;
    }
    if (hitsCache.has(selector)) return hitsCache.get(selector);

    let out;
    try {
        const n = document.querySelectorAll(selector).length;
        // Ноль попаданий — важный сигнал: разметка ST изменилась,
        // и шаблон молча перестал работать
        out = n === 0 ? '0' : (n === 1 ? '1' : `×${n}`);
    } catch {
        out = '?';
    }

    hitsCache.set(selector, out);
    return out;
}


function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
}

function makeDraggable(box, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, active = false;

    handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.vte-icon-btn')) return;
        active = true;
        const r = box.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        box.style.right = 'auto';
        box.style.left = `${ox}px`;
        box.style.top = `${oy}px`;
        handle.setPointerCapture(e.pointerId);
        box.classList.add('vte-dragging');
    });

    handle.addEventListener('pointermove', (e) => {
        if (!active) return;
        box.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx))}px`;
        box.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy))}px`;
    });

    const stop = () => { active = false; box.classList.remove('vte-dragging'); };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
}

function shield(node) {
    ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(t =>
        node.addEventListener(t, (e) => e.stopPropagation()));
}
