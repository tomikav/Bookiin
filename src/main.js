import './fonts.css';
import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { unzip } from 'fflate';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
/* recursos locales de pdf.js (ver vite.config.js) y sin eval, compatible con la CSP */
const PDF_OPTS = {
  isEvalSupported: false,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  cMapUrl: '/pdfjs/cmaps/', cMapPacked: true,
  wasmUrl: '/pdfjs/wasm/',
};

/* ================================================================
   IndexedDB  (v2: + estantes)
   ================================================================ */
const DB_NAME = 'bookiin-db';
let db = null;
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('shelves')) d.createObjectStore('shelves', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function store(name, mode) { return db.transaction(name, mode).objectStore(name); }
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const dbPut = (book) => reqP(store('books', 'readwrite').put(book));
const dbAll = () => reqP(store('books', 'readonly').getAll());
const dbDel = (id) => reqP(store('books', 'readwrite').delete(id));
const shelfPut = (s) => reqP(store('shelves', 'readwrite').put(s));
const shelfAll = () => reqP(store('shelves', 'readonly').getAll());
const shelfDel = (id) => reqP(store('shelves', 'readwrite').delete(id));

/* ================================================================
   Libros de muestra (dominio publico)
   ================================================================ */
const SEEDS = [
  { slug: 'quijote', title: 'Don Quijote de la Mancha', author: 'Miguel de Cervantes', kind: 'novela',
    grad: ['#1a1420', '#08070b'], ink: '#b98a94', sym: 'tree' },
  { slug: 'azul', title: 'Azul… (fragmentos)', author: 'Rubén Darío', kind: 'poesía',
    grad: ['#12161f', '#06070a'], ink: '#93a6b6', sym: 'moon' },
  { slug: 'rimas', title: 'Rimas (fragmentos)', author: 'Gustavo Adolfo Bécquer', kind: 'poesía',
    grad: ['#201811', '#090705'], ink: '#c9a15c', sym: 'candle' },
];
/* marcas de tiempo antiguas: los registros v1 usaban enteros pequenos (0 = mas reciente) */
const LEGACY_EPOCH = 1e12;

/* ================================================================
   Estado y utilidades
   ================================================================ */
let books = [];
let shelves = [];
let nextId = 1;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const natural = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const IMG_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function bookBytes(b) {
  let n = b.pdf && b.pdf.size ? b.pdf.size : 0;
  if (b.images) for (const im of b.images) n += im.size || 0;
  return n;
}
function pageFromProg(b) {
  const total = b.pages || 1;
  if (!b.prog) return 1;
  if (b.prog >= 1) return total;
  return Math.round(b.prog * (total - 1)) + 1;
}

/* toast discreto para importaciones largas */
let toastT = null;
function toast(msg, sticky = false) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT);
  if (!sticky) toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ================================================================
   Portadas procedurales (cuando no hay imagen)
   ================================================================ */
function symbolMarkup(name, ink) {
  const s = {
    tree: `<g stroke="${ink}" fill="none" stroke-width="1.4" opacity=".55"><path d="M150 250V150"/><path d="M150 168c-14-16-30-16-42-30M150 168c14-16 30-16 42-30M150 138c-10-14-24-12-32-26M150 138c10-14 24-12 32-26M150 118c-7-11-16-10-22-22M150 118c7-11 16-10 22-22"/></g><circle cx="150" cy="86" r="30" fill="none" stroke="${ink}" stroke-width="1" opacity=".3"/>`,
    moon: `<path d="M172 110a56 56 0 1 0 0 110 46 46 0 1 1 0-110z" fill="${ink}" opacity=".5"/><circle cx="150" cy="165" r="64" fill="none" stroke="${ink}" stroke-width=".7" opacity=".25"/>`,
    candle: `<g fill="none" stroke="${ink}" stroke-width="1.4" opacity=".6"><rect x="138" y="150" width="24" height="86"/><path d="M150 150v-18"/></g><path d="M150 108c0 12-9 14-9 24a9 9 0 0 0 18 0c0-8-9-12-9-24z" fill="${ink}" opacity=".55"/>`,
    book: `<g fill="none" stroke="${ink}" stroke-width="1.5" opacity=".6"><path d="M150 130c-16-12-38-14-56-8v96c18-6 40-4 56 8M150 130c16-12 38-14 56-8v96c-18-6-40-4-56 8"/><path d="M150 130v96"/></g>`,
  };
  return s[name] || s.book;
}
function coverSVG(b) {
  const id = b.id;
  return `<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="cg${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${b.grad ? b.grad[0] : '#1a1420'}"/><stop offset="1" stop-color="${b.grad ? b.grad[1] : '#08070b'}"/>
      </linearGradient>
      <radialGradient id="cv${id}" cx="0.5" cy="0.42" r="0.75">
        <stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/>
      </radialGradient>
      <filter id="cn${id}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer><feComposite operator="in" in2="SourceGraphic"/></filter>
    </defs>
    <rect width="300" height="400" fill="url(#cg${id})"/>
    <g transform="translate(0,20)">${symbolMarkup(b.sym, b.ink || '#9c93bf')}</g>
    <rect width="300" height="400" fill="url(#cv${id})"/>
    <rect width="300" height="400" fill="#fff" filter="url(#cn${id})"/>
  </svg>`;
}
function coverHTML(b) {
  return b.cover ? `<img src="${b.cover}" alt="" draggable="false" style="${fitStyle(b.coverFit)}">` : coverSVG(b);
}
function fitStyle(f) {
  if (!f || !f.z || f.z === 1) return '';
  return `transform:scale(${f.z}) translate(${f.x || 0}%,${f.y || 0}%)`;
}

/* ================================================================
   Biblioteca
   ================================================================ */
const shelf = $('shelf');
const kindLabel = { manga: 'Manga', webtoon: 'Webtoon', novela: 'Novela', ensayo: 'Ensayo', 'poesía': 'Poesía', pdf: 'PDF' };
const genreLabel = { manga: 'Manga y cómic', novela: 'Novelas', 'poesía': 'Poesía', ensayo: 'Ensayo', libre: 'Sin clasificar' };
let view = 'grid', sortKey = 'recent', query = '';
/* nav: 'all' | 'added' | 'kind:<g>' | 'shelf:<id>' | 'tag:<t>' */
let nav = 'all';

function genreOf(b) {
  if (b.kind === 'manga' || b.kind === 'webtoon') return 'manga';
  if (b.kind === 'novela' || b.kind === 'poesía' || b.kind === 'ensayo') return b.kind;
  return 'libre';
}
function statusText(b) {
  if (!b.prog) return 'Sin empezar';
  if (b.prog >= 1) return 'Terminado';
  return 'Página ' + pageFromProg(b) + ' · ' + Math.round(b.prog * 100) + '%';
}
function sortBooks(list) {
  const c = [...list];
  if (sortKey === 'recent') c.sort((a, b) => (b.recent || 0) - (a.recent || 0));
  else if (sortKey === 'added') c.sort((a, b) => (b.added || 0) - (a.added || 0));
  else if (sortKey === 'title') c.sort((a, b) => natural.compare(a.title, b.title));
  else if (sortKey === 'author') c.sort((a, b) => natural.compare(a.author || '', b.author || ''));
  else if (sortKey === 'progress') c.sort((a, b) => (b.prog || 0) - (a.prog || 0));
  return c;
}
function matchesNav(b) {
  const [type, v] = nav.split(/:(.*)/s);
  if (type === 'kind') return genreOf(b) === v;
  if (type === 'shelf') return (b.shelves || []).includes(+v);
  if (type === 'tag') return (b.tags || []).includes(v);
  return true;
}
function matchesQuery(b, q) {
  if (!q) return true;
  if (q.startsWith('#')) return (b.tags || []).some(t => t.includes(q.slice(1)));
  return b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)
    || (b.tags || []).some(t => t.includes(q));
}
function headText() {
  const [type, v] = nav.split(/:(.*)/s);
  if (type === 'kind') return ['Género', genreLabel[v]];
  if (type === 'shelf') { const s = shelves.find(x => x.id === +v); return ['Estante', s ? s.name : 'Estante']; }
  if (type === 'tag') return ['Etiqueta', '#' + v];
  if (type === 'added') return ['Tu colección · medianoche', 'Añadidos hace poco'];
  return ['Tu colección · medianoche', 'Biblioteca'];
}
function render() {
  const q = query.trim().toLowerCase();
  const list = sortBooks(books.filter(b => matchesNav(b) && matchesQuery(b, q)));
  const [sub, title] = headText();
  $('h1sub').textContent = sub;
  $('h1title').textContent = title;
  shelf.className = 'shelf' + (view === 'list' ? ' list' : '');
  if (!list.length) {
    const msg = q ? 'Nada en las sombras con ese nombre.'
      : nav.startsWith('shelf:') ? 'Este estante está vacío. Arrastra libros hasta su nombre en la barra lateral.'
      : nav === 'all' ? 'La biblioteca está vacía. Arrastra aquí un PDF, un CBZ o una carpeta de imágenes.'
      : 'Este estante está vacío.';
    shelf.innerHTML = '<p class="empty">' + msg + '</p>';
    return;
  }
  shelf.innerHTML = list.map((b, i) => {
    const isManga = b.kind === 'manga' || b.kind === 'webtoon';
    const delay = Math.min(i * 55, 560);
    const tags = (b.tags || []).map(t => `<button class="tagchip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
    return `<article class="book" data-id="${b.id}" draggable="true" style="animation-delay:${delay}ms">
      <div class="cover">
        <span class="glow"></span>
        ${coverHTML(b)}
        <span class="spine"></span>
        <span class="kindtag ${isManga ? 'manga' : ''}">${esc(kindLabel[b.kind] || b.kind)}</span>
        <button class="editbtn" data-edit="${b.id}" title="Editar libro">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m16.5 4.5 3 3L9 18l-4 1 1-4Z"/></svg>
        </button>
        <div class="titleplate">
          <h3>${esc(b.title)}</h3>
          <div class="by">${esc(b.author || 'Autor desconocido')}</div>
        </div>
      </div>
      <div class="lt list-only">
        <h3>${esc(b.title)}</h3><div class="by">${esc(b.author || 'Autor desconocido')}</div>
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </div>
      <div class="meta">
        <div class="line1"><span class="code">${b.format === 'images' ? 'IMG' : 'PDF'}</span><span class="pages">${b.pages} p.</span></div>
        <div class="progress"><i style="width:${Math.round((b.prog || 0) * 100)}%"></i></div>
        <div class="status">${statusText(b)}</div>
      </div>
    </article>`;
  }).join('');
}
$('search').addEventListener('input', e => { query = e.target.value; render(); });
$('sort').addEventListener('change', e => { sortKey = e.target.value; render(); });
$('viewtoggle').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  view = btn.dataset.view;
  [...e.currentTarget.children].forEach(c => c.classList.toggle('on', c === btn));
  render();
});
shelf.addEventListener('click', e => {
  const tag = e.target.closest('.tagchip');
  if (tag) { e.stopPropagation(); setNav('tag:' + tag.dataset.tag); return; }
  const edit = e.target.closest('.editbtn');
  if (edit) { openEdit(+edit.dataset.edit); return; }
  const card = e.target.closest('.book'); if (!card) return;
  openReader(+card.dataset.id);
});
/* arrastrar un libro hasta un estante de la barra lateral */
shelf.addEventListener('dragstart', e => {
  const card = e.target.closest('.book'); if (!card) return;
  e.dataTransfer.setData('application/x-bookiin-book', card.dataset.id);
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('dragging-book');
});
shelf.addEventListener('dragend', () => document.body.classList.remove('dragging-book'));

/* ================================================================
   Barra lateral: navegacion, generos y estantes editables
   ================================================================ */
function setNav(key) {
  nav = (nav === key && key !== 'all' && key !== 'added') ? 'all' : key;
  if (nav === 'added') { sortKey = 'added'; $('sort').value = 'added'; }
  renderRail(); render();
  $('stage').scrollTop = 0;
}
function renderRail() {
  $('navcount').textContent = books.length;
  document.querySelectorAll('.nav [data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
  document.querySelectorAll('.nav [data-kind]').forEach(a => {
    const n = books.filter(b => genreOf(b) === a.dataset.kind).length;
    a.querySelector('.count').textContent = n || '';
  });
  const list = $('shelflist');
  if (!shelves.length) {
    list.innerHTML = '<p class="shelfempty">Crea estantes con <b>+</b> y arrastra libros hasta ellos.</p>';
    return;
  }
  list.innerHTML = [...shelves].sort((a, b) => natural.compare(a.name, b.name)).map(s => {
    const n = books.filter(b => (b.shelves || []).includes(s.id)).length;
    return `<a href="#" class="shelfitem${nav === 'shelf:' + s.id ? ' active' : ''}" data-shelf="${s.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20h16M6 20V6M10 20V4M14 20l3-14 3 .6L17 20"/></svg>
      <span class="sname">${esc(s.name)}</span>
      <span class="sacts">
        <button class="sact" data-rename="${s.id}" title="Renombrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m16.5 4.5 3 3L9 18l-4 1 1-4Z"/></svg></button>
        <button class="sact" data-remove="${s.id}" title="Eliminar estante"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </span>
      <span class="count">${n || ''}</span>
    </a>`;
  }).join('');
}
document.querySelectorAll('.nav [data-nav]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  if (a.dataset.nav === 'all') { query = ''; $('search').value = ''; sortKey = 'recent'; $('sort').value = 'recent'; }
  setNav(a.dataset.nav);
}));
$('navcontinue').addEventListener('click', e => {
  e.preventDefault();
  const reading = books.filter(b => b.prog > 0 && b.prog < 1).sort((a, b) => (b.recent || 0) - (a.recent || 0));
  const target = reading[0] || sortBooks(books)[0];
  if (target) openReader(target.id);
});

/* edicion en linea de estantes */
function shelfInput(initial, onDone) {
  const inp = document.createElement('input');
  inp.className = 'shelfinput'; inp.value = initial; inp.maxLength = 40;
  inp.placeholder = 'Nombre del estante';
  let done = false;
  const finish = (ok) => { if (done) return; done = true; onDone(ok ? inp.value.trim() : null); };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
  return inp;
}
$('newshelf').addEventListener('click', () => {
  const list = $('shelflist');
  list.querySelector('.shelfempty')?.remove();
  const inp = shelfInput('', async (name) => {
    if (name) {
      const s = { id: Date.now(), name };
      shelves.push(s); await shelfPut(s);
    }
    renderRail();
  });
  list.prepend(inp); inp.focus();
});
$('shelflist').addEventListener('click', async e => {
  const ren = e.target.closest('[data-rename]');
  const rem = e.target.closest('[data-remove]');
  const item = e.target.closest('.shelfitem');
  if (ren) {
    e.preventDefault(); e.stopPropagation();
    const s = shelves.find(x => x.id === +ren.dataset.rename); if (!s) return;
    const inp = shelfInput(s.name, async (name) => {
      if (name && name !== s.name) { s.name = name; await shelfPut(s); }
      renderRail(); render();
    });
    item.replaceWith(inp); inp.focus(); inp.select();
    return;
  }
  if (rem) {
    e.preventDefault(); e.stopPropagation();
    /* doble confirmacion sin dialogos: primer clic arma, segundo borra */
    if (!rem.classList.contains('armed')) {
      rem.classList.add('armed'); rem.title = 'Clic otra vez para eliminar (los libros se conservan)';
      setTimeout(() => rem.classList.remove('armed'), 2800);
      return;
    }
    const id = +rem.dataset.remove;
    shelves = shelves.filter(x => x.id !== id); await shelfDel(id);
    for (const b of books) if ((b.shelves || []).includes(id)) { b.shelves = b.shelves.filter(x => x !== id); await dbPut(b); }
    if (nav === 'shelf:' + id) nav = 'all';
    renderRail(); render();
    return;
  }
  if (item) { e.preventDefault(); setNav('shelf:' + item.dataset.shelf); }
});
/* soltar libros sobre un estante */
$('shelflist').addEventListener('dragover', e => {
  const item = e.target.closest('.shelfitem');
  if (!item || !e.dataTransfer.types.includes('application/x-bookiin-book')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  document.querySelectorAll('.shelfitem.drop').forEach(x => x !== item && x.classList.remove('drop'));
  item.classList.add('drop');
});
$('shelflist').addEventListener('dragleave', e => e.target.closest('.shelfitem')?.classList.remove('drop'));
$('shelflist').addEventListener('drop', async e => {
  const item = e.target.closest('.shelfitem'); if (!item) return;
  const id = e.dataTransfer.getData('application/x-bookiin-book'); if (!id) return;
  e.preventDefault(); e.stopPropagation();
  item.classList.remove('drop');
  const b = books.find(x => x.id === +id); const sid = +item.dataset.shelf;
  if (b && !(b.shelves || []).includes(sid)) {
    b.shelves = [...(b.shelves || []), sid]; await dbPut(b);
    const s = shelves.find(x => x.id === sid);
    toast('"' + b.title + '" ahora está en ' + (s ? s.name : 'el estante'));
  }
  renderRail();
});

/* ================================================================
   Importar: PDF, CBZ/ZIP, imagenes sueltas y carpetas
   ================================================================ */
$('addbtn').addEventListener('click', () => $('pdffile').click());
$('addfolder').addEventListener('click', () => $('folderinput').click());
$('pdffile').addEventListener('change', async e => {
  await importEntries([...e.target.files].map(f => ({ file: f, path: f.name })));
  e.target.value = '';
});
$('folderinput').addEventListener('change', async e => {
  await importEntries([...e.target.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name })));
  e.target.value = '';
});

/* arrastrar y soltar archivos o carpetas sobre la ventana */
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', e => { if (!isFileDrag(e)) return; dragDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', e => { if (!isFileDrag(e)) return; if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', async e => {
  if (!isFileDrag(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
  const items = [...e.dataTransfer.items].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  const entries = [];
  if (items.length) for (const en of items) await walkEntry(en, '', entries);
  else for (const f of e.dataTransfer.files) entries.push({ file: f, path: f.name });
  await importEntries(entries);
});
async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, path: prefix + entry.name });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const child of batch) await walkEntry(child, prefix + entry.name + '/', out);
    } while (batch.length);
  }
}

async function importEntries(entries) {
  entries = entries.filter(x => !x.path.split('/').some(p => p.startsWith('.') || p === '__MACOSX'));
  const pdfs = entries.filter(x => /\.pdf$/i.test(x.path));
  const archives = entries.filter(x => /\.(cbz|zip)$/i.test(x.path));
  const images = entries.filter(x => IMG_RE.test(x.path));
  /* imagenes: un libro por carpeta contenedora */
  const groups = new Map();
  for (const x of images) {
    const parts = x.path.split('/'); parts.pop();
    const key = parts.join('/') || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const total = pdfs.length + archives.length + groups.size;
  if (!total) { toast('No encontré PDFs, CBZ ni imágenes en lo que soltaste.'); return; }
  let n = 0, added = 0;
  const step = (label) => toast(`Importando ${++n} de ${total} · ${label}`, true);
  for (const x of pdfs) { step(x.file.name); if (await addPdf(x.file)) added++; }
  for (const x of archives) { step(x.file.name); if (await addArchive(x.file)) added++; }
  for (const [key, list] of groups) {
    const parts = key.split('/').filter(Boolean);
    const title = parts.length ? parts.slice(-2).join(' · ') : (list.length === 1 ? list[0].file.name.replace(IMG_RE, '') : 'Imágenes sueltas');
    step(title);
    list.sort((a, b) => natural.compare(a.path, b.path));
    if (await addImageBook(prettyName(title), list.map(x => x.file))) added++;
  }
  renderRail(); render(); updateCounts();
  toast(added === 1 ? 'Un libro nuevo en la biblioteca.' : added + ' libros nuevos en la biblioteca.');
}
function prettyName(s) { return s.replace(/\.(pdf|cbz|zip)$/i, '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); }

/* conteo de paginas con limite de tiempo: un PDF raro no bloquea la importacion */
async function probePdf(buf) {
  const task = pdfjsLib.getDocument({ ...PDF_OPTS, data: buf.slice(0) });
  try {
    const doc = await Promise.race([task.promise, sleep(8000).then(() => { throw new Error('timeout'); })]);
    let meta = {};
    try { meta = await doc.getMetadata(); } catch (_) {}
    const pages = doc.numPages;
    task.destroy();
    return { pages, meta };
  } catch (err) {
    console.warn('PDF ilegible', err);
    task.destroy();
    return null;
  }
}
function newBookBase(extra) {
  const now = Date.now();
  return { id: nextId++, prog: 0, added: now, recent: now, shelves: [], tags: [], ...extra };
}
async function addPdf(file) {
  const buf = await file.arrayBuffer();
  const info = await probePdf(buf);
  if (!info) { toast('No pude abrir ' + file.name + ': no parece un PDF válido.'); return false; }
  const m = info.meta.info || {};
  const book = newBookBase({
    format: 'pdf',
    title: (m.Title && String(m.Title).trim()) || prettyName(file.name),
    author: (m.Author && String(m.Author).trim()) || '',
    kind: 'pdf', pages: info.pages,
    grad: ['#1a1420', '#08070b'], ink: '#9c93bf', sym: 'book',
    pdf: new Blob([buf], { type: 'application/pdf' }),
  });
  await dbPut(book); books.push(book);
  return true;
}
async function addArchive(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let files;
  try {
    files = await new Promise((res, rej) => unzip(buf, {
      filter: f => IMG_RE.test(f.name) && !f.name.split('/').some(p => p.startsWith('.') || p === '__MACOSX'),
    }, (err, out) => err ? rej(err) : res(out)));
  } catch (err) { toast('No pude abrir ' + file.name + ': el archivo parece dañado.'); return false; }
  const names = Object.keys(files).sort(natural.compare);
  if (!names.length) { toast(file.name + ' no contiene imágenes.'); return false; }
  const blobs = names.map(n => new Blob([files[n]], { type: MIME[n.split('.').pop().toLowerCase()] || 'image/jpeg' }));
  return addImageBook(prettyName(file.name), blobs);
}
async function addImageBook(title, blobs) {
  const ratios = [];
  let cover = null;
  for (let i = 0; i < blobs.length; i++) {
    try {
      const bmp = await createImageBitmap(blobs[i]);
      ratios.push(bmp.width / bmp.height);
      if (i === 0) cover = thumb(bmp);
      bmp.close();
    } catch (_) { ratios.push(2 / 3); }
    if (i % 25 === 24) toast(`Midiendo páginas de ${title}: ${i + 1} / ${blobs.length}`, true);
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 2 / 3;
  const webtoon = median < 0.45; /* tiras mucho mas altas que anchas */
  const book = newBookBase({
    format: 'images', title, author: '',
    kind: webtoon ? 'webtoon' : 'manga', mode: webtoon ? 'vertical' : 'horizontal',
    pages: blobs.length, images: blobs, ratios,
    cover, coverFit: null,
    grad: ['#201218', '#08070b'], ink: '#e7b7bd', sym: 'book',
  });
  await dbPut(book); books.push(book);
  return true;
}
/* miniatura de portada a partir de la primera pagina (recorta arriba en tiras largas) */
function thumb(bmp) {
  const W = 360, H = 480;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const s = Math.max(W / bmp.width, H / bmp.height);
  const w = bmp.width * s, h = bmp.height * s;
  const y = bmp.height / bmp.width > 2 ? 0 : (H - h) / 2;
  g.drawImage(bmp, (W - w) / 2, y, w, h);
  return c.toDataURL('image/jpeg', 0.82);
}

/* ================================================================
   Dialogo de edicion (portada, metadatos, genero, estantes, etiquetas)
   ================================================================ */
let editingId = null, pendingCover = null, pendingFit = null, pendingShelves = [];
function openEdit(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  editingId = id; pendingCover = null;
  pendingFit = b.coverFit ? { ...b.coverFit } : null;
  pendingShelves = [...(b.shelves || [])];
  $('edittitle').value = b.title;
  $('editauthor').value = b.author || '';
  $('editkind').value = kindLabel[b.kind] ? b.kind : 'pdf';
  $('edittags').value = (b.tags || []).join(', ');
  setEditCover(b.cover ? `<img src="${b.cover}" alt="" draggable="false">` : coverSVG(b));
  $('cropzoom').value = pendingFit ? pendingFit.z : 1;
  $('cropwrap').classList.toggle('has-img', !!b.cover);
  renderEditShelves();
  const del = $('editdelete'); del.classList.remove('armed'); del.textContent = 'Eliminar libro';
  $('editmodal').classList.add('open');
  $('editmodal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('edittitle').focus(), 30);
}
function renderEditShelves() {
  const box = $('editshelves');
  if (!shelves.length) { box.innerHTML = '<span class="muted">Aún no hay estantes. Créalos desde la barra lateral.</span>'; return; }
  box.innerHTML = [...shelves].sort((a, b) => natural.compare(a.name, b.name))
    .map(s => `<button type="button" class="chip${pendingShelves.includes(s.id) ? ' on' : ''}" data-sid="${s.id}">${esc(s.name)}</button>`).join('');
}
$('editshelves').addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  const id = +c.dataset.sid;
  pendingShelves = pendingShelves.includes(id) ? pendingShelves.filter(x => x !== id) : [...pendingShelves, id];
  c.classList.toggle('on');
});
function setEditCover(html) { $('cropwrap').innerHTML = html; applyPreviewTransform(); }
function applyPreviewTransform() {
  const img = $('cropwrap').querySelector('img');
  if (img) img.style.transform = fitStyle(pendingFit);
}
$('coverpick').addEventListener('click', () => $('coverfile').click());
$('coverfile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const fr = new FileReader();
  fr.onload = () => { pendingCover = fr.result; pendingFit = null; $('cropzoom').value = 1; $('cropwrap').classList.add('has-img'); setEditCover(`<img src="${pendingCover}" alt="" draggable="false">`); };
  fr.readAsDataURL(f);
  e.target.value = '';
});
$('cropzoom').addEventListener('input', e => {
  pendingFit = pendingFit || { z: 1, x: 0, y: 0 };
  pendingFit.z = parseFloat(e.target.value);
  applyPreviewTransform();
});
$('cropreset').addEventListener('click', () => { pendingFit = null; $('cropzoom').value = 1; applyPreviewTransform(); });
(function cropDrag() {
  const wrap = $('cropwrap');
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  wrap.addEventListener('pointerdown', e => {
    if (!wrap.querySelector('img')) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    ox = pendingFit ? pendingFit.x || 0 : 0; oy = pendingFit ? pendingFit.y || 0 : 0;
    wrap.setPointerCapture(e.pointerId); wrap.style.cursor = 'grabbing';
  });
  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    pendingFit = pendingFit || { z: 1, x: 0, y: 0 };
    const z = pendingFit.z || 1;
    const r = wrap.getBoundingClientRect();
    pendingFit.x = Math.max(-100, Math.min(100, ox + (e.clientX - sx) * 100 / r.width / z));
    pendingFit.y = Math.max(-100, Math.min(100, oy + (e.clientY - sy) * 100 / r.height / z));
    applyPreviewTransform();
  });
  wrap.addEventListener('pointerup', () => { dragging = false; wrap.style.cursor = 'grab'; });
})();
$('editcancel').addEventListener('click', closeEdit);
$('editmodal').addEventListener('click', e => { if (e.target === $('editmodal')) closeEdit(); });
$('editdelete').addEventListener('click', async () => {
  const del = $('editdelete');
  const b = books.find(x => x.id === editingId); if (!b) return closeEdit();
  if (!del.classList.contains('armed')) {
    del.classList.add('armed'); del.textContent = 'Clic otra vez para eliminar';
    setTimeout(() => { del.classList.remove('armed'); del.textContent = 'Eliminar libro'; }, 3000);
    return;
  }
  await dbDel(b.id);
  books = books.filter(x => x.id !== b.id);
  closeEdit(); renderRail(); render(); updateCounts();
  toast('"' + b.title + '" salió de la biblioteca. El archivo original sigue en su sitio.');
});
function closeEdit() { $('editmodal').classList.remove('open'); $('editmodal').setAttribute('aria-hidden', 'true'); }
$('editsave').addEventListener('click', saveEdit);
$('editmodal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') saveEdit(); });
async function saveEdit() {
  const b = books.find(x => x.id === editingId); if (!b) return closeEdit();
  b.title = $('edittitle').value.trim() || b.title;
  b.author = $('editauthor').value.trim();
  b.kind = $('editkind').value;
  b.tags = [...new Set($('edittags').value.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean))];
  b.shelves = pendingShelves;
  if (pendingCover) b.cover = pendingCover;
  b.coverFit = pendingFit;
  await dbPut(b);
  closeEdit(); renderRail(); render();
}

/* ================================================================
   Lector
   Paginas perezosas: solo se pintan las cercanas al viewport y se
   liberan las lejanas, asi un libro de 800 paginas o un webtoon de
   300 tiras ocupa la misma memoria que uno de 10.
   ================================================================ */
const reader = $('reader');
const viewport = $('viewport');
const track = $('track');
let pdfTask = null;
let R = { book: null, page: 1, total: 1, mode: 'horizontal', doc: null, images: null, ratios: [], calm: false, zen: false, rtl: false, gen: 0 };
const urls = new Map();

function buildTicks(total) {
  $('ticks').innerHTML = Array.from({ length: Math.min(total, 40) }, () => '<span></span>').join('');
}
function pageMarkup(p, extra = '') {
  const ar = R.ratios[p - 1] || R.ratios[0] || 2 / 3;
  return `<div class="page${R.images ? ' img' : ''}${extra}" data-p="${p}" style="--ar:${ar}"><span class="pnum">${String(p).padStart(2, '0')} / ${String(R.total).padStart(2, '0')}</span><div class="veil"></div></div>`;
}
async function paint(el) {
  if (el.dataset.painted) return;
  el.dataset.painted = '1';
  const gen = R.gen, p = +el.dataset.p;
  if (R.images) {
    let url = urls.get(p);
    if (!url) { url = URL.createObjectURL(R.images[p - 1]); urls.set(p, url); }
    const img = new Image();
    img.decoding = 'async'; img.draggable = false; img.alt = '';
    img.src = url;
    el.prepend(img);
    return;
  }
  if (!R.doc) return;
  try {
    const page = await R.doc.getPage(p);
    if (gen !== R.gen || !el.dataset.painted) return;
    const base = page.getViewport({ scale: 1 });
    const ar = base.width / base.height;
    if (Math.abs(ar - (R.ratios[p - 1] || 0)) > 0.01) { R.ratios[p - 1] = ar; el.style.setProperty('--ar', ar); }
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const scale = Math.max(1, Math.min(4, (el.clientWidth || 600) * dpr / base.width));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    el.prepend(canvas);
    const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp });
    el._task = task;
    await task.promise;
    el._task = null;
  } catch (_) { /* render cancelado o pagina inexistente */ }
}
function release(el) {
  if (!el.dataset.painted) return;
  delete el.dataset.painted;
  if (el._task) { try { el._task.cancel(); } catch (_) {} el._task = null; }
  const c = el.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; c.remove(); }
  const img = el.querySelector('img'); if (img) img.remove();
  const p = +el.dataset.p;
  if (urls.has(p)) { URL.revokeObjectURL(urls.get(p)); urls.delete(p); }
}
function releaseAll() {
  track.querySelectorAll('.page').forEach(release);
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

let loaderIO = null, revealIO = null, vPages = [];
function renderPages() {
  R.gen++;
  if (loaderIO) loaderIO.disconnect();
  if (revealIO) revealIO.disconnect();
  releaseAll();
  const vertical = R.mode === 'vertical';
  track.classList.toggle('vertical', vertical);
  track.classList.toggle('strip', vertical && !!R.images);
  viewport.classList.toggle('vertical', vertical);
  reader.classList.toggle('isvertical', vertical);
  if (!vertical) {
    vPages = [];
    track.innerHTML = pageMarkup(R.page, ' reveal');
    paint(track.querySelector('.page'));
  } else {
    let html = '';
    for (let p = 1; p <= R.total; p++) html += pageMarkup(p);
    track.innerHTML = html;
    vPages = [...track.querySelectorAll('.page')];
    loaderIO = new IntersectionObserver(entries => {
      for (const en of entries) en.isIntersecting ? paint(en.target) : release(en.target);
    }, { root: viewport, rootMargin: '160% 0px' });
    revealIO = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target.dataset.shown) continue;
        en.target.dataset.shown = '1';
        en.target.classList.add('reveal');
        revealIO.unobserve(en.target);
      }
    }, { root: viewport, rootMargin: '0px 0px -8% 0px' });
    vPages.forEach(el => { loaderIO.observe(el); revealIO.observe(el); });
  }
  $('hinttext').textContent = vertical ? 'Desplázate o usa' : (R.rtl ? 'Lectura derecha a izquierda ·' : 'Clic a los lados o');
  updateChrome();
}
/* pagina actual en vertical: la que cruza el 40% superior del viewport */
let scrollRaf = 0, saveT = null;
viewport.addEventListener('scroll', () => {
  if (R.mode !== 'vertical' || scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    const line = viewport.scrollTop + viewport.clientHeight * 0.4;
    let lo = 0, hi = vPages.length - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (vPages[mid].offsetTop <= line) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const p = found + 1;
    if (p !== R.page) {
      R.page = p; updateChrome();
      clearTimeout(saveT); saveT = setTimeout(saveProgress, 350);
    }
  });
}, { passive: true });

function updateChrome() {
  $('rcount').textContent = String(R.page).padStart(2, '0') + ' / ' + String(R.total).padStart(2, '0');
  $('scnum').textContent = R.page;
  $('sctotal').textContent = R.total;
  const pct = R.total > 1 ? ((R.page - 1) / (R.total - 1)) * 100 : 0;
  $('scfill').style.width = pct + '%';
  $('scknob').style.left = pct + '%';
}
async function saveProgress() {
  const b = R.book; if (!b) return;
  b.pages = R.total;
  b.prog = R.page >= R.total ? 1 : (R.total > 1 ? (R.page - 1) / (R.total - 1) : 0);
  b.recent = Date.now();
  await dbPut(b);
}
function goPage(n, instant = false) {
  n = Math.max(1, Math.min(R.total, n));
  if (R.mode === 'horizontal') {
    if (n === R.page) { flashReveal(); return; }
    R.page = n; renderPages(); saveProgress();
  } else {
    const el = vPages[n - 1];
    if (el) viewport.scrollTo({ top: el.offsetTop - (R.images ? 0 : 60), behavior: instant ? 'auto' : 'smooth' });
  }
  wake();
}
const next = () => goPage(R.page + 1);
const prev = () => goPage(R.page - 1);
function flashReveal() {
  const cur = track.querySelector('.page'); if (!cur) return;
  cur.classList.remove('reveal'); void cur.offsetWidth; cur.classList.add('reveal');
}
async function openReader(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  R.book = b; R.doc = null; R.images = null;
  R.rtl = !!b.rtl;
  $('rtitle').textContent = b.title;
  $('rauthor').textContent = b.author || '';
  if (b.format === 'images' && b.images) {
    R.images = b.images; R.total = b.images.length;
    R.ratios = b.ratios && b.ratios.length === R.total ? [...b.ratios] : new Array(R.total).fill(2 / 3);
  } else {
    let data = null;
    try {
      if (b.pdf instanceof Blob) data = await b.pdf.arrayBuffer();
      else if (b.seedSlug) data = await (await fetch('books/' + b.seedSlug + '.pdf')).arrayBuffer();
      pdfTask = pdfjsLib.getDocument({ ...PDF_OPTS, data });
      R.doc = await pdfTask.promise;
      R.total = R.doc.numPages;
      const first = (await R.doc.getPage(1)).getViewport({ scale: 1 });
      R.ratios = new Array(R.total).fill(first.width / first.height);
    } catch (err) {
      console.error('PDF', err);
      toast('No pude abrir este PDF.');
      return;
    }
  }
  R.page = Math.min(pageFromProg(b), R.total);
  R.mode = b.mode || 'horizontal';
  syncReaderButtons();
  buildTicks(R.total);
  reader.classList.add('open'); reader.setAttribute('aria-hidden', 'false');
  renderPages();
  if (R.mode === 'vertical' && R.page > 1) requestAnimationFrame(() => goPage(R.page, true));
  showHint(); wake();
}
function syncReaderButtons() {
  [...$('modetoggle').children].forEach(c => c.classList.toggle('on', c.dataset.mode === R.mode));
  reader.classList.toggle('rtl', R.rtl);
  $('dirbtn').classList.toggle('on', R.rtl);
}
function closeReader() {
  if (R.book) { clearTimeout(saveT); saveProgress(); }
  if (R.zen) toggleZen();
  reader.classList.add('closing');
  setTimeout(() => {
    reader.classList.remove('open', 'closing'); reader.setAttribute('aria-hidden', 'true');
    R.gen++;
    if (loaderIO) loaderIO.disconnect();
    if (revealIO) revealIO.disconnect();
    releaseAll(); track.innerHTML = ''; vPages = [];
    if (pdfTask) { pdfTask.destroy(); pdfTask = null; }
    R.doc = null;
    R.images = null; R.book = null;
    render();
  }, 320);
}
$('rback').addEventListener('click', closeReader);
$('zoneL').addEventListener('click', () => (R.rtl ? next() : prev()));
$('zoneR').addEventListener('click', () => (R.rtl ? prev() : next()));
$('calmbtn').addEventListener('click', () => {
  R.calm = !R.calm;
  $('calmbtn').classList.toggle('on', R.calm);
  track.classList.toggle('paper', R.calm);
  wake();
});
$('dirbtn').addEventListener('click', async () => {
  R.rtl = !R.rtl; syncReaderButtons();
  if (R.book) { R.book.rtl = R.rtl; await dbPut(R.book); }
  $('hinttext').textContent = R.mode === 'vertical' ? 'Desplázate o usa' : (R.rtl ? 'Lectura derecha a izquierda ·' : 'Clic a los lados o');
  showHint(); wake();
});
$('zenbtn').addEventListener('click', () => toggleZen());
function toggleZen() {
  R.zen = !R.zen;
  reader.classList.toggle('zen', R.zen);
  $('zenbtn').classList.toggle('on', R.zen);
  clearTimeout(idleT);
  if (!R.zen) wake();
}
/* rueda: pasa pagina en horizontal (con freno para trackpads) */
let wheelLock = 0;
viewport.addEventListener('wheel', e => {
  if (R.mode !== 'horizontal' || !reader.classList.contains('open')) return;
  e.preventDefault();
  if (Math.abs(e.deltaY) < 8 && Math.abs(e.deltaX) < 8) return;
  const now = performance.now(); if (now < wheelLock) return; wheelLock = now + 180;
  (e.deltaY > 0 || e.deltaX > 0) ? next() : prev();
}, { passive: false });
$('modetoggle').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn || btn.dataset.mode === R.mode) return;
  R.mode = btn.dataset.mode;
  syncReaderButtons();
  renderPages();
  if (R.mode === 'vertical') requestAnimationFrame(() => goPage(R.page, true));
  if (R.book) { R.book.mode = R.mode; await dbPut(R.book); }
  wake();
});
/* barra de progreso arrastrable */
const railtrack = $('railtrack');
function scrubTo(clientX) {
  const r = railtrack.getBoundingClientRect();
  let pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  if (R.rtl && R.mode === 'horizontal') pct = 1 - pct;
  goPage(Math.round(pct * (R.total - 1)) + 1, true);
}
let scrubbing = false;
railtrack.addEventListener('pointerdown', e => { scrubbing = true; railtrack.setPointerCapture(e.pointerId); scrubTo(e.clientX); });
railtrack.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e.clientX); });
railtrack.addEventListener('pointerup', () => scrubbing = false);
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
$('fsbtn').addEventListener('click', toggleFullscreen);

/* teclado */
document.addEventListener('keydown', e => {
  if ($('editmodal').classList.contains('open')) { if (e.key === 'Escape') closeEdit(); return; }
  if (e.target.tagName === 'INPUT') return;
  if (!reader.classList.contains('open')) {
    if (e.key === '/' ) { e.preventDefault(); $('search').focus(); }
    return;
  }
  const k = e.key;
  if (k.toLowerCase() === 'z') { toggleZen(); e.preventDefault(); return; }
  if (k.toLowerCase() === 'f') { toggleFullscreen(); return; }
  if (k === 'Escape') { R.zen ? toggleZen() : closeReader(); return; }
  if (k === 'Home') { goPage(1, true); e.preventDefault(); return; }
  if (k === 'End') { goPage(R.total, true); e.preventDefault(); return; }
  if (R.mode === 'vertical') {
    const step = viewport.clientHeight * 0.85;
    if (k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) { viewport.scrollBy({ top: step, behavior: 'smooth' }); e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) { viewport.scrollBy({ top: -step, behavior: 'smooth' }); e.preventDefault(); }
    else if (k === 'ArrowRight') { next(); e.preventDefault(); }
    else if (k === 'ArrowLeft') { prev(); e.preventDefault(); }
    return;
  }
  const fwd = R.rtl ? 'ArrowLeft' : 'ArrowRight', back = R.rtl ? 'ArrowRight' : 'ArrowLeft';
  if (k === fwd || k === 'ArrowDown' || k === 'PageDown' || k === ' ') { next(); e.preventDefault(); }
  else if (k === back || k === 'ArrowUp' || k === 'PageUp') { prev(); e.preventDefault(); }
});

/* el chrome del lector se desvanece solo */
let idleT = null;
function wake() {
  reader.classList.remove('idle'); clearTimeout(idleT);
  idleT = setTimeout(() => { if (reader.classList.contains('open')) reader.classList.add('idle'); }, 2600);
}
reader.addEventListener('pointermove', wake);
reader.addEventListener('click', wake);
let hintT = null;
function showHint() { const h = $('hint'); h.style.opacity = '1'; clearTimeout(hintT); hintT = setTimeout(() => { h.style.opacity = '0'; }, 3400); }

/* ================================================================
   Contadores
   ================================================================ */
function updateCounts() {
  $('volcount').textContent = books.length;
  const totalMB = books.reduce((s, b) => s + bookBytes(b), 0) / 1048576;
  $('storagesize').textContent = totalMB < 1000 ? totalMB.toFixed(1) + ' MB' : (totalMB / 1024).toFixed(2) + ' GB';
  $('meterfill').style.width = Math.min(100, Math.max(2, totalMB / 2048 * 100)) + '%'; /* 2 GB de referencia */
}

/* ================================================================
   Arranque
   ================================================================ */
async function seedIfFirstRun() {
  if ((await dbAll()).length) return;
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i];
    try {
      const buf = await (await fetch('books/' + s.slug + '.pdf')).arrayBuffer();
      const info = await probePdf(buf);
      await dbPut({
        id: i + 1, format: 'pdf', title: s.title, author: s.author, kind: s.kind, pages: info ? info.pages : 1, prog: 0,
        added: LEGACY_EPOCH - i, recent: LEGACY_EPOCH - i, grad: s.grad, ink: s.ink, sym: s.sym,
        shelves: [], tags: [], seedSlug: s.slug, pdf: new Blob([buf], { type: 'application/pdf' }),
      });
    } catch (err) { console.warn('muestra', s.slug, err); }
  }
}
/* registros de la v0.x: enteros pequenos de recencia y sin formato */
async function migrate() {
  for (const b of books) {
    let dirty = false;
    if (b.recent != null && b.recent < LEGACY_EPOCH / 10) { b.recent = LEGACY_EPOCH - b.recent; dirty = true; }
    if (b.added != null && b.added < LEGACY_EPOCH / 10) { b.added = LEGACY_EPOCH - b.added; dirty = true; }
    if (!b.format) {
      b.format = b.images ? 'images' : 'pdf'; dirty = true;
      /* las muestras de la v0.x se generaron con un PDF defectuoso: se recargan */
      if (b.seedSlug) {
        try { b.pdf = new Blob([await (await fetch('books/' + b.seedSlug + '.pdf')).arrayBuffer()], { type: 'application/pdf' }); } catch (_) {}
      }
    }
    if (!b.shelves) { b.shelves = []; dirty = true; }
    if (!b.tags) { b.tags = []; dirty = true; }
    if (dirty) await dbPut(b);
  }
}
(async function boot() {
  try {
    db = await openDB();
    await seedIfFirstRun();
    books = await dbAll();
    shelves = await shelfAll();
    await migrate();
    nextId = books.reduce((m, b) => Math.max(m, b.id), 0) + 1;
    renderRail(); render(); updateCounts();
  } catch (err) {
    console.error('arranque', err);
    shelf.innerHTML = '<p class="empty">No pude abrir la biblioteca local. Detalle: ' + esc(err && err.message || err) + '</p>';
  }
})();
