// modules/ruleList.js
// Общий вид списков «Уже в теме» / «Уже есть» во всех окнах:
// подпись «что за что отвечает», метки «тема» / «мои» / «перекрыто»,
// корзина у правил темы и кнопка «Убрать перекрытое».
//
// Окна передают свои h() и icon() — чтобы элементы были как у остального окна.

import { explainRule } from './ruleExplain.js';

/**
 * @param list  правила: { selector, props, from, to, mine, start, over, parts, decls }
 * @param ctx   { h, icon, onReveal, onDeleteRule, onCleanOverridden, say }
 * @returns     массив элементов: кнопка уборки (если есть что убирать) и строки
 */
export function ruleRows(list, ctx) {
    const { h, icon } = ctx;
    const out = [];
    const over = list.filter(r => r.over);
    const overLines = over.reduce((n, r) => n + r.over.dead, 0);

    if (over.length && ctx.onCleanOverridden) {
        let armed = 0;
        const label = h('span', { text: ` Убрать перекрытое (${overLines})` });
        const btn = h('button.vte-btn.vte-grp-clean', {
            type: 'button', title: 'Удалить из кода строки темы, которые перекрыты и ничего не делают',
            on: {
                click: () => {
                    if (!armed) {
                        btn.classList.add('armed');
                        label.textContent = ' Нажмите ещё раз — убрать';
                        armed = setTimeout(() => { armed = 0; btn.classList.remove('armed'); label.textContent = ` Убрать перекрытое (${overLines})`; }, 3000);
                        return;
                    }
                    clearTimeout(armed);
                    const n = ctx.onCleanOverridden(over.map(r => r.start));
                    ctx.say?.(n ? `Убрано перекрытого: ${n}. Вернуть — «Как было до открытия»` : 'Убирать нечего');
                },
            },
        }, [icon('fa-broom'), label]);
        out.push(btn);
    }

    for (const r of list) {
        out.push(h('div.vte-grp-rule', {}, [
            h('button.vte-tb-rule', {
                type: 'button', title: 'Показать в коде',
                on: { click: () => ctx.onReveal?.(r.from, r.to) },
            }, [
                h(`span.vte-grp-rule-tag${r.mine ? '.mine' : ''}`, { text: r.mine ? 'мои' : 'тема' }),
                r.over ? h('span.vte-grp-rule-tag.over', {
                    text: r.over.dead >= r.over.total ? 'перекрыто' : `перекрыто ${r.over.dead} из ${r.over.total}`,
                    title: 'Эти строки уже ничего не делают: то же свойство берётся из другого правила (обычно из «Моих правок»)',
                }) : null,
                h('span.vte-grp-rule-what', { text: explainRule(r.parts || r.selector, r.decls || []) }),
                h('code.vte-tb-rule-sel', { text: r.selector }),
            ]),
            // «Мои» правила пишут настройки окна — удалённое вернулось бы при
            // следующей правке. Их убирают ↺ у настройки
            ctx.onDeleteRule && !r.mine && r.from != null ? deleteBtn(r, ctx) : null,
        ]));
    }
    return out;
}

/** Корзина: первое нажатие — «точно?», второе — удалить */
function deleteBtn(r, ctx) {
    const { h, icon } = ctx;
    let armed = 0;
    const btn = h('button.vte-icon-btn.vte-tb-mini.vte-grp-rule-del', {
        type: 'button', title: 'Удалить это правило из кода целиком',
        on: {
            click: (e) => {
                e.stopPropagation();
                if (!armed) {
                    btn.classList.add('armed');
                    btn.title = 'Нажмите ещё раз — удалить. Вернуть: «Как было до открытия» или отмена в коде';
                    armed = setTimeout(() => { armed = 0; btn.classList.remove('armed'); btn.title = 'Удалить это правило из кода целиком'; }, 3000);
                    return;
                }
                clearTimeout(armed);
                if (ctx.onDeleteRule?.(r.from, r.to)) ctx.say?.('Правило удалено из кода');
            },
        },
    }, [icon('fa-trash-can')]);
    return btn;
}
