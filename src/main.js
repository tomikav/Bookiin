import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* ---------------- IndexedDB ---------------- */
const DB_NAME = 'bookiin-db';
let db = null;
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('books', { keyPath: 'id' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
function tx(mode) { return db.transaction('books', mode).objectStore('books'); }
function dbPut(book) { return new Promise((res, rej) => { const r = tx('readwrite').put(book); r.onsuccess = res; r.onerror = () => rej(r.error); }); }
function dbAll() { return new Promise((res, rej) => { const r = tx('readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function dbGet(id) { return new Promise((res, rej) => { const r = tx('readonly').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

/* ---------------- sample seeds (dominio publico) ---------------- */
const SEEDS = [
  { slug: 'quijote', title: 'Don Quijote de la Mancha', author: 'Miguel de Cervantes', kind: 'novela',
    grad: ['#1a1420', '#08070b'], ink: '#b98a94', sym: 'tree' },
  { slug: 'azul', title: 'Azul… (fragmentos)', author: 'Rubén Darío', kind: 'poesía',
    grad: ['#12161f', '#06070a'], ink: '#93a6b6', sym: 'moon' },
  { slug: 'rimas', title: 'Rimas (fragmentos)', author: 'Gustavo Adolfo Bécquer', kind: 'poesía',
    grad: ['#201811', '#090705'], ink: '#c9a15c', sym: 'candle' },
];

/* ---------------- state ---------------- */
let books = [];
let nextId = 1;
const $ = (id) => document.getElementById(id);

/* ---------------- procedural cover art (fallback) ---------------- */
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
    <g transform="translate(0,20)">${symbolMarkup(b.sym, b.ink)}</g>
    <rect width="300" height="400" fill="url(#cv${id})"/>
    <rect width="300" height="400" fill="#fff" filter="url(#cn${id})"/>
  </svg>`;
}
function coverHTML(b) {
  return b.cover ? `<img src="${b.cover}" alt="" style="${fitStyle(b.coverFit)}">` : coverSVG(b);
}
function fitStyle(f) {
  if (!f || !f.z || f.z === 1) return '';
  return `transform:scale(${f.z}) translate(${f.x || 0}%,${f.y || 0}%)`;
}

/* ---------------- library render ---------------- */
const shelf = $('shelf');
const kindLabel = { manga: 'Manga', novela: 'Novela', ensayo: 'Ensayo', 'poesía': 'Poesía', pdf: 'PDF' };
let view = 'grid', sortKey = 'recent', query = '', kindFilter = null;

function statusText(b) {
  if (!b.prog) return 'Sin empezar';
  if (b.prog >= 1) return 'Terminado';
  return 'Página ' + Math.round(b.prog * b.pages) + ' · ' + Math.round(b.prog * 100) + '%';
}
function sortBooks(list) {
  const c = [...list];
  if (sortKey === 'recent') c.sort((a, b) => (a.recent ?? 9) - (b.recent ?? 9));
  else if (sortKey === 'added') c.sort((a, b) => (a.added ?? 99) - (b.added ?? 99));
  else if (sortKey === 'title') c.sort((a, b) => a.title.localeCompare(b.title));
  else if (sortKey === 'author') c.sort((a, b) => (a.author || '').localeCompare(b.author || ''));
  else if (sortKey === 'progress') c.sort((a, b) => (b.prog || 0) - (a.prog || 0));
  return c;
}
function kindOf(b) {
  if (b.kind === 'manga' || b.kind === 'novela' || b.kind === 'poesía') return b.kind;
  return 'libre'; // PDFs sin género -> Sin clasificar
}
function render() {
  const q = query.trim().toLowerCase();
  let list = books.filter(b => {
    if (kindFilter && kindOf(b) !== kindFilter) return false;
    return !q || b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q);
  });
  list = sortBooks(list);
  shelf.className = 'shelf' + (view === 'list' ? ' list' : '');
  if (!list.length) { shelf.innerHTML = '<p class="empty">' + (kindFilter ? 'Este estante está vacío.' : 'Nada en las sombras con ese nombre.') + '</p>'; return; }
  shelf.innerHTML = list.map((b, i) => {
    const isManga = b.kind === 'manga';
    const delay = Math.min(i * 55, 560);
    return `<article class="book" data-id="${b.id}" style="animation-delay:${delay}ms">
      <div class="cover">
        <span class="glow"></span>
        ${coverHTML(b)}
        <span class="spine"></span>
        <span class="kindtag ${isManga ? 'manga' : ''}">${kindLabel[b.kind] || b.kind}</span>
        <button class="editbtn" data-edit="${b.id}" title="Editar título, autor y portada">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m16.5 4.5 3 3L9 18l-4 1 1-4Z"/></svg>
        </button>
        <div class="titleplate grid-hideinlist">
          <h3>${b.title}</h3>
          <div class="by">${b.author || 'Autor desconocido'}</div>
        </div>
      </div>
      <div class="lt list-only">
        <h3>${b.title}</h3><div class="by">${b.author || 'Autor desconocido'}</div>
      </div>
      <div class="meta">
        <div class="line1"><span class="code">${b.code || 'BK'}</span><span class="pages">${b.pages} p.</span></div>
        <div class="progress"><i style="width:${Math.round((b.prog || 0) * 100)}%"></i></div>
        <div class="status list-only-hide">${statusText(b)}</div>
      </div>
    </article>`;
  }).join('');
}
$('search').addEventListener('input', e => { query = e.target.value; render(); });
$('sort').addEventListener('change', e => { sortKey = e.target.value; render(); });

/* nav: filtros de estante y accesos rápidos */
function setKindFilter(k) {
  kindFilter = (kindFilter === k) ? null : k;
  document.querySelectorAll('.nav a[data-kind]').forEach(a => a.classList.toggle('active', a.dataset.kind === kindFilter));
  // marca "Biblioteca" como activa solo cuando no hay filtro
  document.querySelectorAll('.nav a').forEach(a => {
    if (!a.dataset.kind && !a.id) a.classList.toggle('active', !kindFilter);
  });
  render();
}
document.querySelectorAll('.nav a[data-kind]').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); setKindFilter(a.dataset.kind); });
});
$('navadded').addEventListener('click', e => {
  e.preventDefault();
  sortKey = 'added';
  $('sort').value = 'added';
  kindFilter = null;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.id === 'navadded'));
  render();
});
$('navcontinue').addEventListener('click', e => {
  e.preventDefault();
  const read = books.filter(b => b.prog > 0 && b.prog < 1);
  const target = read.sort((a, b) => (a.recent ?? 99) - (b.recent ?? 99))[0] || books[0];
  if (target) openReader(target.id);
});
/* Biblioteca: quita todo filtro */
document.querySelector('.nav a:not([data-kind]):not([id])')?.addEventListener('click', e => {
  e.preventDefault();
  kindFilter = null; sortKey = 'recent'; query = ''; $('search').value = ''; $('sort').value = 'recent';
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', !a.id));
  render();
});
$('viewtoggle').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  view = btn.dataset.view;
  [...e.currentTarget.children].forEach(c => c.classList.toggle('on', c === btn));
  render();
});
shelf.addEventListener('click', e => {
  const edit = e.target.closest('.editbtn');
  if (edit) { openEdit(+edit.dataset.edit); return; }
  const card = e.target.closest('.book'); if (!card) return;
  openReader(+card.dataset.id);
});

/* ---------------- upload PDF ---------------- */
$('addbtn').addEventListener('click', () => $('pdffile').click());
$('pdffile').addEventListener('change', async e => {
  for (const file of e.target.files) await addPdf(file);
  e.target.value = '';
  render(); updateCounts();
});

async function addPdf(file) {
  const buf = await file.arrayBuffer();
  let pages = 1, meta = {};
  try {
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    pages = doc.numPages;
    try { meta = await doc.getMetadata(); } catch (_) {}
  } catch (err) { alert('No pude abrir ' + file.name + ': no parece un PDF válido.'); return; }
  const name = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  const book = {
    id: nextId++,
    title: (meta.info && meta.info.Title) || name,
    author: (meta.info && meta.info.Author) || '',
    kind: 'pdf', pages, prog: 0,
    added: 0, recent: 0,
    grad: ['#1a1420', '#08070b'], ink: '#9c93bf', sym: 'book',
    pdf: new Blob([buf], { type: 'application/pdf' }),
  };
  // recency: newest first
  books.forEach(b => { if (b.added != null) b.added += 1; if (b.recent != null) b.recent += 1; });
  await dbPut(book);
  books.push(book);
}

/* ---------------- edit dialog (cover + metadata) ---------------- */
let editingId = null, pendingCover = null, pendingFit = null;
function openEdit(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  editingId = id; pendingCover = null;
  pendingFit = b.coverFit ? { ...b.coverFit } : null;
  $('edittitle').value = b.title;
  $('editauthor').value = b.author || '';
  setEditCover(b.cover || coverSVG(b));
  $('cropzoom').value = pendingFit ? pendingFit.z : 1;
  $('cropwrap').classList.toggle('has-img', !!b.cover);
  $('editmodal').classList.add('open');
  $('editmodal').setAttribute('aria-hidden', 'false');
}
function previewStyle() { return pendingFit ? fitStyle(pendingFit) : ''; }
function setEditCover(html) { $('cropwrap').innerHTML = html; applyPreviewTransform(); }
function applyPreviewTransform() {
  const img = $('cropwrap').querySelector('img');
  if (img) img.style.transform = fitStyle(pendingFit);
}
$('coverpick').addEventListener('click', () => $('coverfile').click());
$('coverfile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = () => { pendingCover = reader.result; pendingFit = null; $('cropzoom').value = 1; $('cropwrap').classList.add('has-img'); setEditCover(`<img src="${pendingCover}" alt="">`); };
  reader.readAsDataURL(f);
  e.target.value = '';
});
/* recorte: zoom con slider, arrastre para mover */
$('cropzoom').addEventListener('input', e => {
  const z = parseFloat(e.target.value);
  pendingFit = pendingFit || { z: 1, x: 0, y: 0 };
  pendingFit.z = z;
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
    const z = pendingFit ? pendingFit.z || 1 : 1;
    const r = wrap.getBoundingClientRect();
    pendingFit = pendingFit || { z: 1, x: 0, y: 0 };
    pendingFit.x = Math.max(-100, Math.min(100, ox + (e.clientX - sx) * 100 / r.width / z));
    pendingFit.y = Math.max(-100, Math.min(100, oy + (e.clientY - sy) * 100 / r.height / z));
    applyPreviewTransform();
  });
  wrap.addEventListener('pointerup', () => { dragging = false; wrap.style.cursor = 'grab'; });
})();
$('editcancel').addEventListener('click', closeEdit);
$('editmodal').addEventListener('click', e => { if (e.target === $('editmodal')) closeEdit(); });
$('editdelete').addEventListener('click', async () => {
  const b = books.find(x => x.id === editingId); if (!b) return closeEdit();
  if (!confirm('¿Eliminar "' + b.title + '" de la biblioteca? Esto no borra el archivo original.')) return;
  await new Promise(res => { const r = tx('readwrite').delete(b.id); r.onsuccess = res; });
  books = books.filter(x => x.id !== b.id);
  closeEdit(); render(); updateCounts();
});
function closeEdit() { $('editmodal').classList.remove('open'); $('editmodal').setAttribute('aria-hidden', 'true'); }
$('editsave').addEventListener('click', async () => {
  const b = books.find(x => x.id === editingId); if (!b) return closeEdit();
  b.title = $('edittitle').value.trim() || b.title;
  b.author = $('editauthor').value.trim();
  if (pendingCover) b.cover = pendingCover;
  b.coverFit = pendingFit;
  await dbPut(b);
  closeEdit(); render();
});

/* ---------------- reader ---------------- */
const reader = $('reader');
const viewport = $('viewport');
const track = $('track');
let R = { book: null, page: 1, total: 1, mode: 'horizontal', doc: null, calm: false };
const renderTasks = new Map();

function buildTicks(total) {
  $('ticks').innerHTML = Array.from({ length: Math.min(total, 40) }, () => '<span></span>').join('');
}
function pageNumEl(p, total) {
  return `<div class="page" data-p="${p}"><canvas></canvas><span class="pnum">${String(p).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span><div class="veil" style="display:none"></div></div>`;
}
function renderPages() {
  const b = R.book;
  if (R.mode === 'horizontal') {
    track.classList.remove('vertical');
    viewport.classList.remove('vertical');
    track.innerHTML = `<div class="page reveal" id="curpage"><canvas></canvas><span class="pnum">${String(R.page).padStart(2, '0')} / ${String(R.total).padStart(2, '0')}</span><div class="veil"></div></div>`;
    renderPdfPage(R.page, track.querySelector('canvas'));
  } else {
    track.classList.add('vertical');
    viewport.classList.add('vertical');
    let html = '';
    for (let p = 1; p <= R.total; p++) html += pageNumEl(p, R.total);
    track.innerHTML = html;
    for (let p = 1; p <= R.total; p++) {
      renderPdfPage(p, track.querySelector(`.page[data-p="${p}"] canvas`));
    }
    requestAnimationFrame(() => observeVertical());
  }
  updateChrome();
}
async function renderPdfPage(p, canvas) {
  if (!R.doc || !canvas) return;
  try {
    const page = await R.doc.getPage(p);
    const viewportP = page.getViewport({ scale: 1.6 });
    canvas.width = viewportP.width; canvas.height = viewportP.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewportP }).promise;
  } catch (err) { /* render cancelled or page missing */ }
}
let io = null;
function observeVertical() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        const pg = en.target;
        if (!pg.dataset.shown) {
          pg.dataset.shown = '1';
          pg.querySelector('.veil').style.display = 'block';
          pg.classList.add('reveal');
        }
        R.page = +pg.dataset.p; updateChrome();
        saveProgress();
      }
    });
  }, { root: viewport, threshold: .35 });
  track.querySelectorAll('.page').forEach(p => io.observe(p));
}
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
  b.prog = R.total > 1 ? (R.page - 1) / (R.total - 1) : 0;
  if (R.page >= R.total) b.prog = 1;
  b.recent = 0;
  books.forEach(o => { if (o.id !== b.id && o.recent != null) o.recent += 1; });
  await dbPut(b);
}
function goPage(n) {
  n = Math.max(1, Math.min(R.total, n));
  if (n === R.page && R.mode === 'horizontal') { flashReveal(); return; }
  R.page = n;
  if (R.mode === 'horizontal') { renderPages(); saveProgress(); }
  else {
    const el = track.querySelector('.page[data-p="' + n + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  wake();
}
function flashReveal() {
  const cur = $('curpage');
  if (!cur) return;
  cur.classList.remove('reveal'); void cur.offsetWidth; cur.classList.add('reveal');
}
async function openReader(id) {
  const b = books.find(x => x.id === id); if (!b) return;
  R.book = b; R.total = b.pages || 1;
  R.page = b.prog > 0 ? Math.max(1, Math.round(b.prog * R.total) + (b.prog < 1 ? 1 : 0)) : 1;
  $('rtitle').textContent = b.title;
  $('rauthor').textContent = b.author || '';
  buildTicks(R.total);
  R.mode = 'horizontal';
  [...$('modetoggle').children].forEach(c => c.classList.toggle('on', c.dataset.mode === 'horizontal'));
  // load the real pdf
  let data;
  if (b.pdf instanceof Blob) data = await b.pdf.arrayBuffer();
  else if (b.seedSlug) data = await (await fetch('books/' + b.seedSlug + '.pdf')).arrayBuffer();
  else { renderPages(); }
  R.doc = null;
  if (data) {
    try { R.doc = await pdfjsLib.getDocument({ data }).promise; R.total = R.doc.numPages; }
    catch (err) { console.error('PDF error', err); }
  }
  buildTicks(R.total); renderPages();
  reader.classList.add('open'); reader.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  showHint(); wake();
}
function closeReader() {
  saveProgress();
  reader.classList.add('closing');
  setTimeout(() => {
    reader.classList.remove('open', 'closing'); reader.setAttribute('aria-hidden', 'true');
    R.doc = null; track.innerHTML = '';
  }, 320);
}
$('rback').addEventListener('click', closeReader);
$('zoneL').addEventListener('click', () => goPage(R.page - 1));
$('zoneR').addEventListener('click', () => goPage(R.page + 1));
$('calmbtn').addEventListener('click', () => {
  R.calm = !R.calm;
  $('calmbtn').classList.toggle('on', R.calm);
  track.classList.toggle('paper', R.calm);
  wake();
});
/* modo zen: nada de chrome, solo el libro */
$('zenbtn').addEventListener('click', () => toggleZen());
function toggleZen() {
  R.zen = !R.zen;
  reader.classList.toggle('zen', R.zen);
  $('zenbtn').classList.toggle('on', R.zen);
  clearTimeout(idleT);
  if (!R.zen) wake();
}
// rueda del mouse para pasar página (horizontal)
viewport.addEventListener('wheel', e => {
  if (R.mode !== 'horizontal' || !reader.classList.contains('open')) return;
  e.preventDefault();
  if (Math.abs(e.deltaY) < 8 && Math.abs(e.deltaX) < 8) return;
  goPage(R.page + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1));
}, { passive: false });
$('modetoggle').addEventListener('click', e => {
  const btn = e.target.closest('button'); if (!btn) return;
  R.mode = btn.dataset.mode;
  [...e.currentTarget.children].forEach(c => c.classList.toggle('on', c === btn));
  renderPages();
  if (R.mode === 'vertical') { setTimeout(() => { const el = track.querySelector('.page[data-p="' + R.page + '"]'); if (el) el.scrollIntoView({ block: 'start' }); }, 40); }
  wake();
});
// scrub bar
const railtrack = $('railtrack');
function scrubTo(clientX) {
  const r = railtrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  goPage(Math.round(pct * (R.total - 1)) + 1);
}
let scrubbing = false;
railtrack.addEventListener('pointerdown', e => { scrubbing = true; railtrack.setPointerCapture(e.pointerId); scrubTo(e.clientX); });
railtrack.addEventListener('pointermove', e => { if (scrubbing) scrubTo(e.clientX); });
railtrack.addEventListener('pointerup', () => scrubbing = false);
$('fsbtn').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  else document.exitFullscreen && document.exitFullscreen();
});
// keyboard
document.addEventListener('keydown', e => {
  if ($('editmodal').classList.contains('open')) { if (e.key === 'Escape') closeEdit(); return; }
  if (!reader.classList.contains('open')) return;
  if (e.key.toLowerCase() === 'z') { toggleZen(); e.preventDefault(); return; }
  if (e.key === 'Escape' && R.zen) { toggleZen(); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { goPage(R.page + 1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { goPage(R.page - 1); e.preventDefault(); }
  else if (e.key === 'Escape') closeReader();
});

/* auto-hide chrome */
let idleT = null;
function wake() { reader.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if (reader.classList.contains('open')) reader.classList.add('idle'); }, 2600); }
reader.addEventListener('pointermove', wake);
reader.addEventListener('click', wake);
let hintT = null;
function showHint() { const h = $('hint'); h.style.opacity = '1'; clearTimeout(hintT); hintT = setTimeout(() => { h.style.opacity = '0'; }, 3400); }

/* ---------------- counts ---------------- */
function updateCounts() {
  $('navcount').textContent = books.length;
  $('volcount').textContent = books.length;
  const totalMB = books.reduce((s, b) => s + (b.pdf && b.pdf.size ? b.pdf.size / 1048576 : 0), 0);
  $('storagesize').textContent = totalMB.toFixed(1) + ' MB';
  $('meterfill').style.width = Math.min(100, totalMB / 200 * 100) + '%'; // 200 MB de referencia
}

/* ---------------- boot ---------------- */
async function seedIfFirstRun() {
  const existing = await dbAll();
  if (existing.length) return;
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i];
    let pages = 2;
    try {
      const buf = await (await fetch('books/' + s.slug + '.pdf')).arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      pages = doc.numPages;
      await dbPut({
        id: i + 1, title: s.title, author: s.author, kind: s.kind, pages, prog: 0,
        added: i, recent: i, grad: s.grad, ink: s.ink, sym: s.sym,
        seedSlug: s.slug, pdf: new Blob([buf], { type: 'application/pdf' }),
      });
    } catch (err) { console.warn('seed fail', s.slug, err); }
  }
}
(async function boot() {
  db = await openDB();
  await seedIfFirstRun();
  books = await dbAll();
  nextId = books.reduce((m, b) => Math.max(m, b.id), 0) + 1;
  render(); updateCounts();
})();
