import { LEVELS, MENU_GROUPS, MENU_ORDER } from './skate/levels.js';

// The start menu: every level as a card (picture, name, one line), the one you last played first. Choosing a card loads that level
// (a level is a page load: only one is ever in memory). `showMenu` is used on its own when the page is opened without a level, and
// from the "Levels" button while playing.

const KEY = 'skatepark:lastLevel';
const assetUrl = window.__skateparkUrl || ((file) => `./${file}?t=${Date.now()}`);

export const lastLevel = () => { try { const id = localStorage.getItem(KEY); return LEVELS[id] ? id : null; } catch { return null; } };
export const rememberLevel = (id) => { try { localStorage.setItem(KEY, id); } catch { /* private window: nothing to remember */ } };

const STYLE = `
  .menu{position:fixed;inset:0;z-index:50;overflow:auto;background:radial-gradient(circle at 20% 0,#1d474b 0,#0d2022 55%,#081416 100%);color:#f8f4e8;padding:max(28px,env(safe-area-inset-top)) 28px 40px}
  .menu header{max-width:1100px;margin:0 auto 22px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px}
  .menu header span{display:block;font-size:11px;letter-spacing:.24em;font-weight:600;opacity:.75;margin-bottom:6px}.menu header strong{font-size:34px;letter-spacing:-.02em}
  .menu .close{padding:10px 16px;background:#ffffff14;border:1px solid #fff3;color:#f8f4e8;border-radius:8px}
  .menu section{max-width:1100px;margin:0 auto 26px}.menu h2{font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.7;margin:0 0 12px;font-weight:600}
  .menu .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .menu a.card{display:block;position:relative;text-decoration:none;color:inherit;background:#12292c;border:1px solid #ffffff1c;border-radius:12px;overflow:hidden;transition:transform .12s,border-color .12s,background .12s}
  .menu a.card:hover,.menu a.card:focus-visible{transform:translateY(-3px);border-color:#d9a779;background:#17353a;outline:0}
  .menu a.card img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#0b1b1d}
  .menu a.card .text{padding:12px 14px 14px}.menu a.card b{display:block;font-size:17px;margin-bottom:4px}.menu a.card small{display:block;font-size:12.5px;line-height:1.5;color:#b9cbc7}
  .menu .badge{position:absolute;top:10px;left:10px;padding:4px 9px;border-radius:99px;font:600 11px system-ui;background:#d9a779;color:#1b2b2c}
  .menu a.card.current{border-color:#d9a779}
  @media(max-width:650px){.menu{padding:max(18px,env(safe-area-inset-top)) 16px 28px}.menu header strong{font-size:26px}}
  body.in-vr .menu{display:none}
`;

function card(id, { current, last }) {
  const level = LEVELS[id];
  const a = document.createElement('a');
  a.className = `card${current ? ' current' : ''}`;
  a.dataset.id = id;
  a.href = `./?level=${id}`;
  a.innerHTML = `<img alt="" loading="lazy" src="${assetUrl(`assets/menu/${id}.jpg`)}">${current ? '<i class="badge">Playing</i>' : last ? '<i class="badge">Last played</i>' : ''}<div class="text"><b></b><small></small></div>`;
  a.querySelector('b').textContent = level.name;
  a.querySelector('small').textContent = level.menu?.short ?? '';
  a.querySelector('img').addEventListener('error', (event) => event.target.remove());   // no picture yet: the card is just text
  a.addEventListener('click', () => rememberLevel(id));
  return a;
}

export function showMenu({ currentId = null, canClose = false } = {}) {
  document.querySelector('.menu')?.remove();
  if (!document.querySelector('#menu-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'menu-style', textContent: STYLE }));
  const last = lastLevel();
  const root = document.createElement('div');
  root.className = 'menu';
  root.innerHTML = `<header><div><span>SKATE PARK</span><strong>Choose a park</strong></div>${canClose ? '<button class="close" type="button">Close (Esc)</button>' : ''}</header>`;
  const ids = [...MENU_ORDER.filter((id) => LEVELS[id]), ...Object.keys(LEVELS).filter((id) => !MENU_ORDER.includes(id))];
  for (const group of MENU_GROUPS) {
    const inGroup = ids.filter((id) => LEVELS[id].menu?.group === group);
    if (!inGroup.length) continue;
    const section = document.createElement('section');
    section.innerHTML = `<h2></h2><div class="grid"></div>`;
    section.querySelector('h2').textContent = group;
    // the park you last played comes first in its group
    inGroup.sort((a, b) => (b === last) - (a === last));
    for (const id of inGroup) section.querySelector('.grid').append(card(id, { current: id === currentId, last: id === last && id !== currentId }));
    root.append(section);
  }
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (event) => { if (event.key === 'Escape' && canClose) close(); };
  root.querySelector('.close')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  (root.querySelector(`a.card[data-id="${last}"]`) || root.querySelector('a.card'))?.focus({ preventScroll: true });
  return root;
}
