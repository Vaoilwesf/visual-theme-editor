// modules/ruleExplain.js
// «Что за что отвечает»: простое описание правила CSS по-русски.
// Смотрит на последнее звено селектора (что красится), на уточнения
// (бот / вы, последнее сообщение, при наведении, ::before) и на свойства.
// Ничего не угадывает сверх этого: незнакомое называется как есть.

/* Что красится — по последнему звену селектора. Порядок важен: сначала
   точные классы, потом общие */
const TARGETS = [
    [/scrollbar/, 'полоса прокрутки'],
    [/\.drawer-icon\b|DrawerIcon\b/, 'значки верхней полосы'],
    [/#leftSendForm|#rightSendForm/, 'колонки кнопок внизу'],
    [/#options_button\b/, 'кнопка меню внизу'],
    [/#send_but\b/, 'кнопка «отправить»'],
    [/#mes_stop\b/, 'кнопка «стоп»'],
    [/#mes_impersonate\b|#mes_continue\b/, 'кнопки «от себя» / «продолжить»'],
    [/#extensionsMenuButton\b/, 'кнопка расширений'],
    [/#nonQRFormItems\b/, 'нижняя панель'],
    [/\[type="?range"?\]|range-slider/, 'ползунки'],
    [/#rm_print_characters_block\b/, 'список персонажей'],
    [/\.character_select\b/, 'карточки персонажей'],
    [/#user_avatar_block\b|\.avatar-container\b/, 'список персон'],
    [/\.hotswap\b|\.avatars_inline\b/, 'избранные (Hot-swap)'],
    [/\.inline-drawer-header\b|\.standoutHeader\b/, 'заголовки разделов'],
    [/#movingDivs|^html\b|^body\b/, 'слой декора'],
    [/\.extraMesButtonsHint\b/, 'кнопка «…» у сообщения'],
    [/\.extraMesButtons\b/, 'панель «…» (доп. кнопки сообщения)'],
    [/\.mes_edit_buttons\b/, 'кнопки в режиме правки'],
    [/\.mes_buttons\b/, 'группа кнопок у сообщения'],
    [/\.mes_edit\b/, 'карандаш «править»'],
    [/\.mes_button\b/, 'кнопки у сообщения'],
    [/\.mesIDDisplay\b/, 'бейдж с номером сообщения'],
    [/\.mes_timer\b/, 'бейдж со временем ответа'],
    [/\.tokenCounterDisplay\b/, 'бейдж с токенами'],
    [/\.mesAvatarWrapper\b/, 'место под аватарку'],
    [/\.avatar\b.*\bimg\b|\.avatar img/, 'картинка аватарки'],
    [/\.avatar\b/, 'аватарка'],
    [/\.alignItemsBaseline\b/, 'ник с датой'],
    [/\.name_text\b/, 'ник'],
    [/\.timestamp\b/, 'дата сообщения'],
    [/\.ch_name\b/, 'строка с ником'],
    [/\.mes_reasoning_header/, 'заголовок блока размышлений'],
    [/\.mes_reasoning/, 'блок размышлений'],
    [/\.swipe_left\b|\.swipe_right\b/, 'стрелки свайпов'],
    [/\.swipes-counter\b/, 'счётчик свайпов'],
    [/\.mes_block\b/, 'блок с текстом сообщения'],
    [/\.mes_text\b/, 'текст сообщения'],
    [/\.mes\b/, 'сообщение целиком'],
    [/#chat\b/, 'лента чата'],
    [/#sheld\b/, 'колонка чата'],
    [/#send_form\b|#send_textarea\b/, 'поле ввода внизу'],
    [/#top-bar\b|#top-settings-holder\b/, 'верхняя полоса'],
    [/\.drawer-content\b/, 'выезжающая панель'],
    [/\.menu_button\b/, 'кнопки'],
];

/* Элементы разметки внутри текста */
const TAGS = [
    [/^q\b/, 'кавычки (речь)'], [/^(em|i)\b/, 'курсив'], [/^(strong|b)\b/, 'жирный'],
    [/^u\b/, 'подчёркнутый'], [/^(s|del)\b/, 'зачёркнутый'], [/^blockquote\b/, 'цитата'],
    [/^pre\b/, 'блок кода'], [/^code\b/, 'код'], [/^hr\b/, 'линия (---)'], [/^h[1-6]\b/, 'заголовки'],
    [/^(ul|ol|li)\b/, 'списки'], [/^(table|th|td|tr)\b/, 'таблица'], [/^a\b/, 'ссылки'],
    [/^p\b/, 'абзацы'], [/^img\b/, 'картинки'],
];

/* Свойства → что меняют. Похожие схлопываются в одно слово */
const PROPS = [
    [/^color$/, 'цвет текста'], [/^background(-color)?$/, 'фон'], [/^background-image$/, 'картинка фона'],
    [/^background-/, 'как лежит фон'], [/^border-radius$|radius$/, 'скругление'], [/^border|^outline/, 'рамка'],
    [/^padding/, 'внутренние отступы'], [/^margin/, 'внешние отступы'],
    [/^(min-|max-)?width$|^inline-size$/, 'ширина'], [/^(min-|max-)?height$|^block-size$/, 'высота'],
    [/^aspect-ratio$/, 'пропорции'], [/^font-size$|^--mainFontSize$/, 'размер шрифта'], [/^font-family$/, 'шрифт'],
    [/^font-weight$/, 'толщина букв'], [/^font-style$/, 'наклон'], [/^font-variant/, 'капитель'],
    [/^line-height$/, 'межстрочный'], [/^letter-spacing$/, 'между буквами'], [/^text-align$/, 'выравнивание'],
    [/^text-indent$/, 'красная строка'], [/^text-decoration|^text-underline/, 'подчёркивание'],
    [/^text-shadow$/, 'тень букв'], [/^box-shadow$/, 'тень'], [/^opacity$/, 'прозрачность'],
    [/^filter$/, 'фильтр'], [/backdrop-filter$/, 'размытие под элементом'],
    [/^(position|top|left|right|bottom|inset|transform|translate)$/, 'положение и сдвиг'],
    [/^z-index$/, 'что сверху'], [/^content$/, 'значок или надпись'], [/^overflow/, 'обрезка'],
    [/^(gap|row-gap|column-gap)$/, 'расстояние между'], [/^(flex|grid|align-|justify-|order|place-)/, 'раскладка'],
    [/^visibility$/, 'видимость'], [/^(transition|animation)/, 'анимация'], [/mask/, 'маска (форма)'],
    [/^object-/, 'как вписана картинка'], [/hyphens$/, 'переносы'], [/^white-space$|^word-|^overflow-wrap$/, 'перенос строк'],
    [/^cursor$/, 'курсор'], [/^vertical-align$/, 'выравнивание по высоте'], [/^pointer-events$/, 'можно ли нажать'], [/^isolation$|^contain$|^box-sizing$|^will-change$/, 'служебное'],
    [/^scrollbar-/, 'полоса прокрутки'], [/decoration-break$/, 'как рвётся по строкам'],
    [/^--SmartTheme(\w+)Color$/, 'цвета ST'], [/^--vte-/, 'метки редактора'], [/^--/, 'переменные'],
];

/** Последнее звено селектора (скобки :is(...) не режем) */
function lastCompound(sel) {
    let depth = 0, cut = 0;
    for (let i = 0; i < sel.length; i++) {
        const c = sel[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (depth === 0 && /[\s>+~]/.test(c)) cut = i + 1;
    }
    return sel.slice(cut).trim();
}

function whatOf(sel) {
    const tail = lastCompound(sel);
    const bare = tail.replace(/::?[\w-]+(\([^)]*\))?/g, '');
    const tag = TAGS.find(([re]) => re.test(bare));
    let what = '';
    if (tag) {
        what = tag[1];
        const inText = /\.mes_text\b/.test(sel);
        if (inText) what += ' в тексте';
    } else {
        const t = TARGETS.find(([re]) => re.test(tail)) || TARGETS.find(([re]) => re.test(sel));
        what = t ? t[1] : `«${tail}»`;
    }
    // уточнения
    const who = /is_user\s*=\s*"?true/.test(sel) ? ' — ваши' : /is_user\s*=\s*"?false/.test(sel) ? ' — бота' : '';
    const extra = [];
    if (/\.last_mes\b/.test(sel)) extra.push('у последнего сообщения');
    if (/:hover\b/.test(tail)) extra.push('при наведении');
    if (/:focus/.test(tail)) extra.push('в фокусе');
    if (/:empty\b/.test(tail)) extra.push('пустые');
    if (/::before\b/.test(tail)) extra.push('украшение перед');
    if (/::after\b/.test(tail)) extra.push('украшение после');
    if (/::placeholder\b/.test(tail)) extra.push('подсказка в пустом поле');
    if (/::-webkit-scrollbar-thumb|::-moz-range-thumb|slider-thumb/.test(tail)) extra.push('кругляшок');
    return what + who + (extra.length ? ` (${extra.join(', ')})` : '');
}

function propsOf(decls) {
    const out = [];
    const add = (w) => { if (w && !out.includes(w)) out.push(w); };
    for (const d of decls) {
        const p = String(d.prop || '').trim();
        const v = String(d.value || '').trim();
        if (p === 'display' && /^none$/i.test(v)) { add('прячет'); continue; }
        if (p === 'display') { add('раскладка'); continue; }
        if (p === 'content' && /^(none|normal|""|'')$/.test(v)) { add('убирает значок'); continue; }
        const hit = PROPS.find(([re]) => re.test(p));
        add(hit ? hit[1] : p);
    }
    // служебное и метки — в конец: главное видно сразу
    const tail = ['служебное', 'метки редактора'];
    return [...out.filter(x => !tail.includes(x)), ...out.filter(x => tail.includes(x))];
}

/**
 * Описание правила: «Кавычки в тексте — ваши: фон, скругление, рамка».
 * selectors — строка «a, b» или массив; decls — [{ prop, value }]
 */
export function explainRule(selectors, decls = []) {
    const list = (Array.isArray(selectors) ? selectors : splitList(String(selectors || '')))
        .map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const whats = [...new Set(list.map(whatOf))];
    const head = whats.length > 2 ? `${whats.slice(0, 2).join('; ')} и ещё ${whats.length - 2}` : whats.join('; ');
    const props = propsOf(decls);
    const cap = head.charAt(0).toUpperCase() + head.slice(1);
    return props.length ? `${cap}: ${props.join(', ')}` : cap;
}

function splitList(s) {
    const out = [];
    let depth = 0, cur = '';
    for (const c of s) {
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out;
}
