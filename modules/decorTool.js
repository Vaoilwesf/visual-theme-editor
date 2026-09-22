// modules/decorTool.js
// Декоративные картинки поверх интерфейса: якорь, размер, сдвиг, уровень.
//
// ── ПОЧЕМУ ВСЁ В VW ─────────────────────────────────────────────────
// vw привязан к ширине окна. Картинка, заданная в vw, сохраняет пропорции
// и положение относительно чата при зуме браузера и при изменении ширины
// чата в настройках ST. В пикселях она бы разъезжалась: чат ужимается,
// а картинка остаётся прежнего размера и наползает на текст.
//
// ── ЯКОРЬ ПЛЮС СДВИГ ────────────────────────────────────────────────
// Положение задаётся в два шага: сначала слой прижимается к краю хозяина
// (right: 0, top: 50% и т.п.), потом сдвигается через transform. Так сдвиг
// не ломает привязку к краю: элемент остаётся приклеенным, даже если хозяин
// меняет размер. Отрицательный сдвиг выносит картинку за границу.
//
// ── ДВА СЛОТА ───────────────────────────────────────────────────────
// У элемента есть только ::before и ::after. Больше двух картинок на один
// элемент повесить нельзя — нужен другой элемент-хозяин.

let onApply = null;
let onLive = null;
let onRequestLayer = null;
let picker = null;

let root = null;
let els = {};

let ctxInfo = { selector: '', pseudo: '', computed: null, element: null };
let targetKey = null;
let lastElement = null;

/* Состояние формы */
let st = {
    unit: 'vw',
    anchor: 'right',
    w: 40,
    h: 30,
    dx: 0,
    dy: 0,
    fit: 'contain',
    level: 'over',
    z: 5,
    opacity: 100,
    rotate: 0,
    flip: false,
    mobile: false,
    mW: 90, mH: 60, mDx: 0, mDy: 0,
};

const UNIT_RANGE = {
    vw: { size: [0, 200], off: [-200, 200], step: 0.5 },
    px: { size: [0, 1600], off: [-1600, 1600], step: 1 },
    '%': { size: [0, 400], off: [-400, 400], step: 1 },
};

/* ============================================================
   ЯКОРЯ
   Каждый задаёт, к каким краям прижать слой и как построить transform.
============================================================ */
const ANCHORS = {
    'top-left':     { label: '↖', title: 'Левый верхний угол' },
    'top':          { label: '↑', title: 'Середина верхнего края' },
    'top-right':    { label: '↗', title: 'Правый верхний угол' },
    'left':         { label: '←', title: 'Середина левого края' },
    'center':       { label: '●', title: 'Центр элемента' },
    'right':        { label: '→', title: 'Середина правого края' },
    'bottom-left':  { label: '↙', title: 'Левый нижний угол' },
    'bottom':       { label: '↓', title: 'Середина нижнего края' },
    'bottom-right': { label: '↘', title: 'Правый нижний угол' },
};

/** Свойства привязки к краям для якоря. Неиспользуемые стороны гасим. */
function anchorSides(anchor) {
    const out = { top: '', right: '', bottom: '', left: '' };

    if (anchor.includes('top')) out.top = '0';
    else if (anchor.includes('bottom')) out.bottom = '0';
    else out.top = '50%';

    if (anchor.includes('left')) out.left = '0';
    else if (anchor.includes('right')) out.right = '0';
    else out.left = '50%';

    return out;
}

/** transform для якоря: центровка по нужным осям плюс сдвиг */
function anchorTransform(anchor, dx, dy, unit, rotate, flip) {
    const centerX = anchor === 'top' || anchor === 'bottom' || anchor === 'center';
    const centerY = anchor === 'left' || anchor === 'right' || anchor === 'center';

    // Короткая запись: без calc(-50% + 0vw) и без translate(0, 0)
    const axis = (center, d) => center
        ? (d ? `calc(-50% + ${d}${unit})` : '-50%')
        : (d ? `${d}${unit}` : '0');
    const x = axis(centerX, dx);
    const y = axis(centerY, dy);

    const parts = [];
    if (x !== '0' || y !== '0') parts.push(y === '0' ? `translateX(${x})` : `translate(${x}, ${y})`);
    if (rotate) parts.push(`rotate(${rotate}deg)`);
    if (flip) parts.push('scaleX(-1)');
    return parts.join(' ');
}

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

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================ */
export function init(options = {}) {
    onApply = options.onApply || (() => {});
    onLive = options.onLive || null;
    onRequestLayer = options.onRequestLayer || null;
    picker = options.picker || null;
}

export function mount(container) {
    if (root && root.isConnected) return root;

    /* ---------- Источник ---------- */
    els.source = h('textarea.vte-icon-source', {
        rows: 3,
        spellcheck: false,
        placeholder: 'Ссылка на PNG, GIF, WEBP или код <svg>…</svg>',
        on: { input: () => { detectKind(); pushLive(); renderPreview(); } },
    });

    els.kind = h('div.vte-icon-kind');

    /* ---------- Слот ---------- */
    els.slotSeg = h('div.vte-seg', {}, [
        slotBtn('::after'),
        slotBtn('::before'),
    ]);

    els.slotNote = h('small.vte-note', { text: '' });

    /* ---------- Якорь ---------- */
    els.anchorGrid = h('div.vte-decor-anchor');
    for (const [id, def] of Object.entries(ANCHORS)) {
        els.anchorGrid.appendChild(h('button.vte-decor-anchor-btn', {
            type: 'button',
            text: def.label,
            title: def.title,
            dataset: { anchor: id },
            on: { click: () => { st.anchor = id; syncUI(); pushLive(); } },
        }));
    }

    /* ---------- Единицы ---------- */
    els.unitSeg = h('div.vte-seg', {}, [
        unitBtn('vw', 'vw', 'Доля ширины окна. Картинка держится рядом с чатом '
            + 'при зуме браузера и смене ширины чата — рекомендуется'),
        unitBtn('px', 'px', 'Жёсткий размер. При зуме и смене ширины чата '
            + 'картинка съедет относительно него'),
        unitBtn('%', '%', 'Доля размера элемента-хозяина'),
    ]);

    els.unitWarn = h('small.vte-icon-warn', { style: 'display:none', text: '' });

    /* ---------- Размер и сдвиг ---------- */
    els.wRow = numRow('Ширина', 'w');
    els.hRow = numRow('Высота', 'h');
    els.dxRow = numRow('Сдвиг X', 'dx');
    els.dyRow = numRow('Сдвиг Y', 'dy');

    els.lockRatio = h('input', {
        type: 'checkbox',
        on: { change: () => { if (els.lockRatio.checked) ratio = st.w / (st.h || 1); } },
    });

    els.nudge = buildNudgePad();

    /* ---------- Вписывание ---------- */
    els.fit = h('select.vte-select', {}, [
        h('option', { value: 'contain', text: 'contain — влезает целиком' }),
        h('option', { value: 'cover', text: 'cover — заполняет с обрезкой' }),
        h('option', { value: '100% 100%', text: '100% 100% — растянуть' }),
    ]);
    els.fit.value = st.fit;
    els.fit.addEventListener('change', () => {
        st.fit = els.fit.value;
        pushLive();
        renderPreview();
    });

    /* ---------- Уровень ---------- */
    els.levelSeg = h('div.vte-seg', {}, [
        levelBtn('over', 'Поверх всего', 'Картинка рисуется над содержимым чата'),
        levelBtn('under', 'Под текстом', 'Над фоном элемента, но под его текстом'),
    ]);

    els.zRow = numRow('z-index', 'z', { min: -5, max: 60, step: 1, plain: true });

    els.levelNote = h('small.vte-note', { text: '' });

    /* ---------- Вид ---------- */
    els.opacityRow = numRow('Прозрачность', 'opacity',
        { min: 0, max: 100, step: 1, plain: true, unit: '%' });
    els.rotateRow = numRow('Поворот', 'rotate',
        { min: -180, max: 180, step: 1, plain: true, unit: '°' });

    els.flip = h('input', {
        type: 'checkbox',
        on: { change: () => { st.flip = els.flip.checked; pushLive(); renderPreview(); } },
    });

    /* ---------- Мобилка ---------- */
    els.mobileChk = h('input', {
        type: 'checkbox',
        on: {
            change: () => {
                st.mobile = els.mobileChk.checked;
                els.mobileBox.style.display = st.mobile ? 'flex' : 'none';
            },
        },
    });

    els.mWRow = numRow('Ширина', 'mW');
    els.mHRow = numRow('Высота', 'mH');
    els.mDxRow = numRow('Сдвиг X', 'mDx');
    els.mDyRow = numRow('Сдвиг Y', 'mDy');

    els.mobileCopy = h('button.vte-btn', {
        type: 'button',
        title: 'Взять текущие значения с десктопа как основу',
        on: {
            click: () => {
                st.mW = st.w; st.mH = st.h; st.mDx = st.dx; st.mDy = st.dy;
                syncUI();
            },
        },
    }, [icon('fa-copy'), h('span', { text: ' Скопировать с десктопа' })]);

    els.mobileBox = h('div.vte-subgroup', { style: 'display:none' }, [
        h('small.vte-note', {
            text: 'Значения ниже уйдут в @media (max-width: 768px). '
                + 'Нужны, когда на узком экране картинка перекрывает чат.',
        }),
        els.mWRow, els.mHRow, els.mDxRow, els.mDyRow,
        h('div.vte-icon-actions', {}, [els.mobileCopy]),
    ]);

    /* ---------- Предупреждения о хозяине ---------- */
    els.hostWarn = h('div.vte-decor-warn', { style: 'display:none' });

    /* ---------- Предпросмотр ---------- */
    els.preview = h('div.vte-decor-preview');
    els.previewInner = h('div.vte-decor-preview-img');
    els.previewHost = h('div.vte-decor-preview-host', {}, [
        h('span.vte-decor-preview-label', { text: 'элемент-хозяин' }),
        els.previewInner,
    ]);
    els.preview.appendChild(els.previewHost);

    /* ---------- Кнопки ---------- */
    els.applyBtn = h('button.vte-btn.vte-btn-primary', {
        type: 'button',
        on: { click: apply },
    }, [icon('fa-check'), h('span', { text: ' Применить' })]);

    els.clearBtn = h('button.vte-btn.vte-btn-ghost', {
        type: 'button',
        title: 'Убрать картинку и весь каркас слоя',
        on: { click: clearDecor },
    }, [icon('fa-eraser'), h('span', { text: ' Убрать' })]);

    root = h('div.vte-icon-tool', {}, [
        // «Применить» наверху и прилипает при прокрутке — не надо листать вниз
        h('div.vte-icon-actions.vte-apply-top', {}, [els.applyBtn]),
        h('small.vte-note', {
            text: 'Инструмент вешает картинку в отдельный слой элемента. '
                + 'Слой вынут из потока, клики через него проходят, вёрстка не сдвигается.',
        }),

        h('div.vte-icon-block', {}, [
            h('div.vte-icon-head', {}, [h('span', { text: 'Картинка' }), els.kind]),
            els.source,
        ]),

        h('div.vte-icon-block', {}, [
            h('div.vte-icon-head', {}, [h('span', { text: 'Слой' })]),
            h('div.vte-field', {}, [
                h('label.vte-field-label', { text: 'Слот' }),
                h('div.vte-field-body', {}, [els.slotSeg]),
            ]),
            els.slotNote,
            els.hostWarn,
        ]),

        h('div.vte-icon-block', {}, [
            h('div.vte-icon-head', {}, [h('span', { text: 'Положение' })]),
            h('div.vte-field', {}, [
                h('label.vte-field-label', { text: 'Прижать к' }),
                h('div.vte-field-body', {}, [els.anchorGrid]),
            ]),
            h('div.vte-field', {}, [
                h('label.vte-field-label', { text: 'Единицы' }),
                h('div.vte-field-body', {}, [els.unitSeg]),
            ]),
            els.unitWarn,
            els.wRow,
            els.hRow,
            h('label.vte-check', {}, [els.lockRatio, h('span', { text: 'Держать пропорции' })]),
            els.dxRow,
            els.dyRow,
            h('div.vte-field', {}, [
                h('label.vte-field-label', { text: 'Подвинуть' }),
                h('div.vte-field-body', {}, [els.nudge]),
            ]),
            h('div.vte-field', {}, [
                h('label.vte-field-label', { text: 'Вписывание' }),
                h('div.vte-field-body', {}, [els.fit]),
            ]),
        ]),

        h('div.vte-icon-block', {}, [
            h('div.vte-icon-head', {}, [h('span', { text: 'Наложение' })]),
            h('div.vte-field', {}, [
                h('label.vte-field-label', { text: 'Уровень' }),
                h('div.vte-field-body', {}, [els.levelSeg]),
            ]),
            els.zRow,
            els.levelNote,
            els.opacityRow,
            els.rotateRow,
            h('label.vte-check', {}, [els.flip, h('span', { text: 'Отразить по горизонтали' })]),
        ]),

        h('div.vte-icon-block', {}, [
            h('div.vte-icon-head', {}, [h('span', { text: 'Мобильный экран' })]),
            h('label.vte-check', {}, [els.mobileChk,
                h('span', { text: 'Отдельные значения для узкого экрана' })]),
            els.mobileBox,
        ]),

        h('div.vte-icon-block', {}, [
            h('div.vte-icon-head', {}, [h('span', { text: 'Схема' })]),
            els.preview,
            h('small.vte-note', {
                text: 'Пунктиром — элемент-хозяин. Показывает, куда встанет картинка '
                    + 'относительно него, включая вынос за границу.',
            }),
        ]),

        h('div.vte-icon-actions', {}, [els.clearBtn]),
    ]);

    container.appendChild(root);
    syncUI();
    return root;
}

let ratio = 1;

function slotBtn(id) {
    return h('button.vte-seg-btn', {
        type: 'button', text: id,
        dataset: { slot: id },
        on: { click: () => onRequestLayer?.(id) },
    });
}

function unitBtn(id, label, title) {
    return h('button.vte-seg-btn', {
        type: 'button', text: label, title,
        dataset: { unit: id },
        on: { click: () => setUnit(id) },
    });
}

function levelBtn(id, label, title) {
    return h('button.vte-seg-btn', {
        type: 'button', text: label, title,
        dataset: { level: id },
        on: {
            click: () => {
                st.level = id;
                // Под текстом работает только через отрицательный z-index
                st.z = id === 'under' ? -1 : 5;
                syncUI();
                pushLive();
            },
        },
    });
}

/** Ползунок с числовым полем. key — имя поля в st. */
function numRow(label, key, opts = {}) {
    const plain = !!opts.plain;
    const range = h('input.vte-range', { type: 'range' });
    const num = h('input.vte-num-inline', { type: 'number' });
    const out = h('span.vte-range-val');

    const unitOf = () => plain ? (opts.unit || '') : st.unit;

    const push = (v, live) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        st[key] = n;

        // Пропорции: высота следует за шириной
        if (els.lockRatio?.checked) {
            if (key === 'w') st.h = Math.round((n / (ratio || 1)) * 10) / 10;
            if (key === 'h') st.w = Math.round((n * (ratio || 1)) * 10) / 10;
            syncUI();
        } else {
            range.value = String(n);
            num.value = String(n);
            out.textContent = `${n}${unitOf()}`;
        }

        if (live) pushLive();
        else { pushLive(); renderPreview(); }
    };

    range.addEventListener('input', () => push(range.value, true));
    range.addEventListener('change', () => push(range.value, false));
    num.addEventListener('change', () => push(num.value, false));

    const row = h('div.vte-field', {}, [
        h('label.vte-field-label', { text: label }),
        h('div.vte-field-body', {}, [range, num, out]),
    ]);

    row._sync = () => {
        const r = plain
            ? [opts.min ?? 0, opts.max ?? 100]
            : (/^(w|h|mW|mH)$/.test(key)
                ? UNIT_RANGE[st.unit].size
                : UNIT_RANGE[st.unit].off);
        range.min = String(r[0]);
        range.max = String(r[1]);
        range.step = String(plain ? (opts.step ?? 1) : UNIT_RANGE[st.unit].step);
        num.min = String(r[0]);
        num.max = String(r[1]);
        num.step = range.step;
        range.value = String(st[key]);
        num.value = String(st[key]);
        out.textContent = `${st[key]}${unitOf()}`;
    };

    return row;
}

/** Крестовина для точной подстройки сдвига */
function buildNudgePad() {
    const step = () => st.unit === 'px' ? 4 : 0.5;

    const btn = (faName, title, fn) => h('button.vte-icon-btn', {
        type: 'button', title,
        on: { click: () => { fn(); syncUI(); pushLive(); renderPreview(); } },
    }, [icon(faName)]);

    return h('div.vte-decor-nudge', {}, [
        btn('fa-arrow-left', 'Влево', () => { st.dx -= step(); }),
        btn('fa-arrow-up', 'Вверх', () => { st.dy -= step(); }),
        btn('fa-arrow-down', 'Вниз', () => { st.dy += step(); }),
        btn('fa-arrow-right', 'Вправо', () => { st.dx += step(); }),
        btn('fa-crosshairs', 'Сбросить сдвиг', () => { st.dx = 0; st.dy = 0; }),
    ]);
}

function setUnit(next) {
    if (!UNIT_RANGE[next] || next === st.unit) return;

    // Пересчитываем значения, чтобы картинка визуально осталась на месте
    const vw = window.innerWidth / 100;
    const hostW = hostRect()?.width || vw * 100;

    const toPx = (v) => st.unit === 'vw' ? v * vw
        : st.unit === '%' ? (v / 100) * hostW : v;
    const fromPx = (v) => next === 'vw' ? v / vw
        : next === '%' ? (v / hostW) * 100 : v;
    const conv = (v) => Math.round(fromPx(toPx(v)) * 10) / 10;

    for (const k of ['w', 'h', 'dx', 'dy', 'mW', 'mH', 'mDx', 'mDy']) {
        st[k] = conv(st[k]);
    }

    st.unit = next;
    syncUI();
    pushLive();
    renderPreview();
}

function hostRect() {
    try { return ctxInfo.element?.getBoundingClientRect() || null; }
    catch { return null; }
}

/* ============================================================
   СОСТОЯНИЕ ХОЗЯИНА
============================================================ */

/** Что помешает картинке отобразиться так, как задумано */
function hostProblems() {
    const out = [];
    const el = ctxInfo.element;
    if (!el) return out;

    let cs;
    try { cs = getComputedStyle(el); } catch { return out; }

    if (String(cs.position || 'static') === 'static') {
        out.push({
            fix: { position: 'relative' },
            text: 'У хозяина position: static — абсолютный слой отсчитает координаты '
                + 'не от него, а от ближайшего позиционированного предка, и уедет. '
                + 'Нужен position: relative.',
        });
    }

    const clipsSelf = /hidden|clip/.test(cs.overflow || '')
        || /paint|content|strict/.test(cs.contain || '');
    if (clipsSelf) {
        out.push({
            fix: { overflow: 'visible', contain: 'none' },
            text: 'Хозяин обрезает содержимое (overflow: hidden или contain: paint). '
                + 'Всё, что выходит за его границы, будет отрезано — а вынос за край '
                + 'здесь основной приём.',
        });
    }

    // Ближайший обрезающий предок: слой не вылезет и за него
    let p = el.parentElement;
    let depth = 0;
    while (p && depth < 6 && p !== document.body) {
        try {
            const pcs = getComputedStyle(p);
            if (/hidden|clip/.test(pcs.overflow || '')
                || /paint|content|strict/.test(pcs.contain || '')) {
                const name = p.id ? '#' + p.id
                    : (p.classList[0] ? '.' + p.classList[0] : p.tagName.toLowerCase());
                out.push({
                    text: `Предок ${name} тоже обрезает содержимое. `
                        + 'Даже при исправленном хозяине картинка не выйдет за его границы.',
                });
                break;
            }
        } catch {}
        p = p.parentElement;
        depth++;
    }

    return out;
}

function renderHostWarn() {
    const box = els.hostWarn;
    box.textContent = '';
    const problems = hostProblems();

    if (!problems.length) { box.style.display = 'none'; return; }
    box.style.display = 'flex';

    const fixes = {};
    for (const p of problems) {
        box.appendChild(h('div.vte-decor-warn-row', {}, [
            h('span.vte-decor-warn-ic', {}, [icon('fa-triangle-exclamation')]),
            h('span', { text: p.text }),
        ]));
        if (p.fix) Object.assign(fixes, p.fix);
    }

    if (Object.keys(fixes).length) {
        box.appendChild(h('button.vte-btn', {
            type: 'button',
            title: Object.entries(fixes).map(([k, v]) => `${k}: ${v}`).join('; '),
            on: {
                click: () => onApply(null, { hostDecls: fixes, message: 'Хозяин исправлен' }),
            },
        }, [icon('fa-wrench'), h('span', { text: ' Исправить хозяина' })]));
    }
}

/** Слот занят чем-то, что уже рисуется */
function slotBusy(pseudo) {
    const el = ctxInfo.element;
    if (!el || !pseudo) return null;
    try {
        const cs = getComputedStyle(el, pseudo);
        if (!cs) return null;
        const c = String(cs.content || '');
        const bg = String(cs.backgroundImage || '');
        const mk = String(cs.maskImage || cs.webkitMaskImage || '');

        if (/url\(/i.test(bg)) return 'картинка';
        if (/url\(/i.test(mk)) return 'силуэт';
        if (c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''") {
            return 'символ или текст';
        }
    } catch {}
    return null;
}

function renderSlotNote() {
    const cur = ctxInfo.pseudo || '::after';
    const other = cur === '::after' ? '::before' : '::after';
    const busyOther = slotBusy(other);

    let text = `Пишем в ${cur}. `;
    text += busyOther
        ? `Слот ${other} занят (${busyOther}) — вторую картинку туда не поставить `
          + 'без потери того, что там сейчас.'
        : `Слот ${other} свободен: вторую картинку можно повесить туда. `
          + 'Больше двух на один элемент не получится — их всего два.';

    els.slotNote.textContent = text;
}

/* ============================================================
   ОБНОВЛЕНИЕ ПОД ЦЕЛЬ
============================================================ */
export function update(info = {}) {
    ctxInfo = {
        selector: info.selector || '',
        pseudo: info.pseudo || '',
        computed: info.computed || null,
        element: info.element || null,
    };
    if (!root) return;

    if (ctxInfo.element !== lastElement) {
        lastElement = ctxInfo.element;
    }

    const key = `${ctxInfo.selector}|${ctxInfo.pseudo}`;
    const changed = key !== targetKey;
    targetKey = key;

    if (changed) readFromTarget();

    renderSlotNote();
    renderHostWarn();
    detectKind();
    syncUI();
    renderPreview();
}

/** Считать то, что уже стоит в слое, чтобы можно было доправить */
function readFromTarget() {
    const cs = ctxInfo.computed;
    if (!cs) return;

    const url = firstUrl(cs.backgroundImage);
    els.source.value = url ? prettifySource(url) : '';

    if (!url) return;

    const size = String(cs.backgroundSize || 'contain').trim();
    if (['contain', 'cover', '100% 100%'].includes(size)) st.fit = size;

    const op = Math.round((parseFloat(cs.opacity) || 1) * 100);
    if (Number.isFinite(op)) st.opacity = op;

    const z = parseInt(cs.zIndex, 10);
    if (Number.isFinite(z)) {
        st.z = z;
        st.level = z < 0 ? 'under' : 'over';
    }

    // Размеры читаем в пикселях и переводим в текущую единицу
    const vw = window.innerWidth / 100;
    const hostW = hostRect()?.width || vw * 100;
    const px = (v) => parseFloat(v) || 0;
    const toUnit = (p) => st.unit === 'vw' ? Math.round((p / vw) * 10) / 10
        : st.unit === '%' ? Math.round((p / hostW) * 1000) / 10
        : Math.round(p);

    if (px(cs.width)) st.w = toUnit(px(cs.width));
    if (px(cs.height)) st.h = toUnit(px(cs.height));

    ratio = st.w / (st.h || 1);
}

/* ============================================================
   СИНХРОНИЗАЦИЯ UI
============================================================ */
function syncUI() {
    els.slotSeg.querySelectorAll('.vte-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.slot === (ctxInfo.pseudo || '::after')));

    els.anchorGrid.querySelectorAll('.vte-decor-anchor-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.anchor === st.anchor));

    els.unitSeg.querySelectorAll('.vte-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.unit === st.unit));

    els.levelSeg.querySelectorAll('.vte-seg-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.level === st.level));

    els.unitWarn.style.display = st.unit === 'px' ? '' : 'none';
    els.unitWarn.textContent = st.unit === 'px'
        ? 'В пикселях картинка не будет следовать за чатом: при зуме браузера и '
          + 'смене ширины чата она съедет относительно него. Для декора вокруг '
          + 'чата берите vw.'
        : '';

    els.levelNote.textContent = st.level === 'under'
        ? 'Под текстом: слою даётся z-index: -1, а хозяину — isolation: isolate, '
          + 'чтобы отрицательный уровень не провалился ниже его фона.'
        : 'Поверх всего: слой рисуется над содержимым. Клики сквозь него проходят, '
          + 'потому что стоит pointer-events: none.';

    els.fit.value = st.fit;
    els.flip.checked = st.flip;
    els.mobileChk.checked = st.mobile;
    els.mobileBox.style.display = st.mobile ? 'flex' : 'none';

    for (const row of [els.wRow, els.hRow, els.dxRow, els.dyRow, els.zRow,
                       els.opacityRow, els.rotateRow,
                       els.mWRow, els.mHRow, els.mDxRow, els.mDyRow]) {
        row?._sync?.();
    }
}

/* ============================================================
   ИСТОЧНИК
============================================================ */
let sourceKind = 'none';

function detectKind() {
    const s = els.source.value.trim();
    els.kind.textContent = '';

    if (!s) {
        sourceKind = 'none';
        els.applyBtn.disabled = true;
        return;
    }
    els.applyBtn.disabled = false;

    if (/^<svg[\s>]/i.test(s)) sourceKind = 'svg';
    else if (/^data:/i.test(s)) sourceKind = 'data';
    else sourceKind = 'url';

    const labels = {
        svg: ['fa-code', 'код SVG'],
        data: ['fa-database', 'data-URI'],
        url: ['fa-link', 'ссылка'],
    };
    const [ic, text] = labels[sourceKind];
    els.kind.append(icon(ic), h('span', { text: ' ' + text }));

    if (sourceKind === 'url' && /^https?:\/\//i.test(s)) {
        els.kind.append(h('span.vte-icon-warn', {
            text: ' — внешняя ссылка',
            title: 'Картинка лежит на чужом сервере. Если он станет недоступен, '
                + 'она перестанет отображаться у всех, кто пользуется темой',
        }));
    }
}

function buildUrlValue() {
    const s = els.source.value.trim();
    if (!s) return '';
    if (sourceKind === 'svg') return svgToUrl(s);

    let inner = s;
    const m = s.match(/^url\(\s*(['"]?)([\s\S]*?)\1\s*\)$/i);
    if (m) inner = m[2].trim();
    return `url("${inner.replace(/"/g, '%22')}")`;
}

function svgToUrl(svg) {
    // Мнемоника собирается из \u0026 ('&'), а не пишется литералом:
    // литеральное ''' в тексте, прошедшем через HTML, становится
    // самим апострофом и рвёт строку.
    const APOS = '\u0026#39;';

    let clean = String(svg)
        .replace(/<\?xml[\s\S]*?\?>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .replace(/'/g, APOS)
        .replace(/"/g, "'")
        .trim();

    if (!/xmlns=/i.test(clean)) {
        clean = clean.replace(/^<svg/i, "<svg xmlns='http://www.w3.org/2000/svg'");
    }

    const enc = clean
        .replace(/%/g, '%25').replace(/#/g, '%23').replace(/&/g, '%26')
        .replace(/</g, '%3C').replace(/>/g, '%3E')
        .replace(/{/g, '%7B').replace(/}/g, '%7D');

    return `url("data:image/svg+xml,${enc}")`;
}

function prettifySource(urlValue) {
    const m = String(urlValue).match(/^url\(\s*(['"]?)([\s\S]*?)\1\s*\)$/i);
    return m ? m[2].trim() : String(urlValue).trim();
}

function firstUrl(v) {
    const s = String(v || '');
    if (!s || s === 'none') return '';
    const m = s.match(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/i);
    return m ? `url("${m[2]}")` : '';
}

/* ============================================================
   СБОРКА ПРАВИЛ
============================================================ */
function buildDecls(url) {
    const sides = anchorSides(st.anchor);
    const u = st.unit;

    const decls = {
        'content': '""',
        // display: block не нужен — абсолютный слой и так блочный
        'display': '',
        'position': 'absolute',
        'top': sides.top,
        'right': sides.right,
        'bottom': sides.bottom,
        'left': sides.left,
        'width': `${st.w}${u}`,
        'height': `${st.h}${u}`,
        'transform': anchorTransform(st.anchor, st.dx, st.dy, u, st.rotate, st.flip),
        // Шорткат вместо четырёх longhand: -image, -position, -size, -repeat
        'background': `${url} center / ${st.fit} no-repeat`,
        // Без этого декор перехватывал бы клики по интерфейсу под ним
        'pointer-events': 'none',
        'z-index': String(st.z),
        // inset мог остаться от роли «Наклейка» во вкладке «Картинка»
        'inset': '',
    };

    if (st.opacity < 100) decls['opacity'] = (st.opacity / 100).toFixed(2);
    else decls['opacity'] = '';

    return decls;
}

function buildMobileDecls() {
    const u = st.unit;
    return {
        'width': `${st.mW}${u}`,
        'height': `${st.mH}${u}`,
        // На телефоне «без сдвига» должно перебить сдвиг с ПК — пишем none
        'transform': anchorTransform(st.anchor, st.mDx, st.mDy, u, st.rotate, st.flip) || 'none',
    };
}

function buildHostDecls() {
    const el = ctxInfo.element;
    const out = {};
    if (!el) return null;

    try {
        if (String(getComputedStyle(el).position || 'static') === 'static') {
            out['position'] = 'relative';
        }
    } catch { out['position'] = 'relative'; }

    // Отрицательный z-index без isolation провалится под фон хозяина
    if (st.level === 'under') out['isolation'] = 'isolate';

    return Object.keys(out).length ? out : null;
}

/** Живой предпросмотр прямо в интерфейсе */
function pushLive() {
    if (!onLive) return;
    const url = buildUrlValue();
    if (!url) return;
    onLive(buildDecls(url));
}

function apply() {
    const url = buildUrlValue();
    if (!url) return;

    onApply(buildDecls(url), {
        hostDecls: buildHostDecls(),
        mediaDecls: st.mobile
            ? { '@media (max-width: 768px)': buildMobileDecls() }
            : null,
        message: 'Картинка размещена',
    });
}

function clearDecor() {
    const empty = {
        'content': '', 'display': '', 'position': '',
        'top': '', 'right': '', 'bottom': '', 'left': '', 'inset': '',
        'width': '', 'height': '', 'transform': '',
        'background': '', 'background-image': '', 'background-size': '',
        'background-position': '', 'background-repeat': '',
        'pointer-events': '', 'z-index': '', 'opacity': '',
    };

    els.source.value = '';
    detectKind();
    renderPreview();

    onApply(empty, {
        hostDecls: { 'isolation': '' },
        mediaDecls: {
            '@media (max-width: 768px)': {
                'width': '', 'height': '', 'transform': '',
            },
        },
        message: 'Картинка убрана',
    });
}

/* ============================================================
   СХЕМА РАСПОЛОЖЕНИЯ
============================================================ */
function renderPreview() {
    const url = buildUrlValue();
    const box = els.previewInner;

    if (!url) {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'block';

    // Схема условная: считаем хозяина за 100 единиц и переводим в проценты
    // его размера, иначе vw пришлось бы соотносить с окном, а не с окошком схемы
    const hostW = hostRect()?.width || window.innerWidth;
    const hostH = hostRect()?.height || 120;
    const vw = window.innerWidth / 100;

    const toPct = (v, base) => {
        const px = st.unit === 'vw' ? v * vw
            : st.unit === '%' ? (v / 100) * base : v;
        return (px / base) * 100;
    };

    const wPct = Math.min(400, toPct(st.w, hostW));
    const hPct = Math.min(400, toPct(st.h, hostH));
    const dxPct = toPct(st.dx, hostW);
    const dyPct = toPct(st.dy, hostH);

    const sides = anchorSides(st.anchor);
    box.style.top = sides.top || 'auto';
    box.style.right = sides.right || 'auto';
    box.style.bottom = sides.bottom || 'auto';
    box.style.left = sides.left || 'auto';

    box.style.width = `${wPct}%`;
    box.style.height = `${hPct}%`;
    box.style.transform = anchorTransform(
        st.anchor, dxPct, dyPct, '%', st.rotate, st.flip);
    box.style.backgroundImage = url.replace(/^url\(|\)$/g, '').replace(/^["']|["']$/g, '')
        ? url : 'none';
    box.style.backgroundSize = st.fit;
    box.style.backgroundPosition = 'center';
    box.style.backgroundRepeat = 'no-repeat';
    box.style.opacity = String(st.opacity / 100);
}
