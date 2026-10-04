const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  jobs: [],
  filtered: [],
  favorites: new Set(JSON.parse(localStorage.getItem('servirFavorites') || '[]')),
  page: 1,
  perPage: 20
};

const fmtMoney = n => Number.isFinite(n)
  ? new Intl.NumberFormat('es-PE', {style:'currency', currency:'PEN', maximumFractionDigits:0}).format(n)
  : null;

function parseDate(s){
  if(!s) return null;
  const m = String(s).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return m ? new Date(+m[3], +m[2]-1, +m[1]) : null;
}
function daysUntil(s){
  const d = parseDate(s);
  if(!d) return null;
  const t = new Date(); t.setHours(0,0,0,0);
  return Math.ceil((d - t) / 86400000);
}
function norm(x){
  return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function unique(field){
  return [...new Set(state.jobs.map(j => j[field]).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b),'es'));
}
function fillSelect(id, values){
  const el = $(id), first = el.options[0].outerHTML;
  el.innerHTML = first + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
function searchBlob(j){
  return norm([
    j.job_title, j.public_institution, j.job_posting_number,
    j.educational_background, j.specialization, j.required_knowledge,
    j.required_experience, j.skills, j.location, j.department, j.regime
  ].join(' '));
}
function activeFilterCount(){
  return [
    $('#q').value, $('#department').value, $('#institution').value, $('#regime').value,
    $('#salaryMin').value, $('#salaryMax').value, $('#experienceMax').value,
    $('#closing').value, $('#favoritesOnly').checked ? '1' : ''
  ].filter(Boolean).length;
}
function syncQuickButtons(){
  $$('[data-quick]').forEach(b => b.classList.remove('active'));
  if($('#closing').value === '3') $('[data-quick="closing3"]').classList.add('active');
  if(Number($('#salaryMin').value) === 5000) $('[data-quick="salary5000"]').classList.add('active');
  if($('#experienceMax').value === '12') $('[data-quick="experience12"]').classList.add('active');
  if($('#favoritesOnly').checked) $('[data-quick="favorites"]').classList.add('active');
}
function apply(resetPage = true){
  if(resetPage) state.page = 1;
  const q = norm($('#q').value);
  const dep = $('#department').value;
  const inst = $('#institution').value;
  const reg = $('#regime').value;
  const smin = Number($('#salaryMin').value) || 0;
  const smax = Number($('#salaryMax').value) || Infinity;
  const exp = $('#experienceMax').value === '' ? Infinity : Number($('#experienceMax').value);
  const closing = $('#closing').value === '' ? Infinity : Number($('#closing').value);
  const fav = $('#favoritesOnly').checked;

  state.filtered = state.jobs.filter(j => {
    const sal = Number(j.salary) || 0;
    const dm = daysUntil(j.end_publication_date);
    const em = j.experience_months == null ? Infinity : Number(j.experience_months);
    return (!q || searchBlob(j).includes(q)) &&
      (!dep || j.department === dep) &&
      (!inst || j.public_institution === inst) &&
      (!reg || j.regime === reg) &&
      sal >= smin && sal <= smax && em <= exp &&
      (closing === Infinity || (dm !== null && dm >= 0 && dm <= closing)) &&
      (!fav || state.favorites.has(j.id));
  });

  const sort = $('#sort').value;
  state.filtered.sort((a,b) =>
    sort === 'salary' ? (Number(b.salary)||0) - (Number(a.salary)||0) :
    sort === 'newest' ? ((parseDate(b.start_publication_date)||0) - (parseDate(a.start_publication_date)||0)) :
    sort === 'entity' ? String(a.public_institution||'').localeCompare(String(b.public_institution||''),'es') :
    ((daysUntil(a.end_publication_date) ?? 9999) - (daysUntil(b.end_publication_date) ?? 9999))
  );

  $('#filterCount').textContent = activeFilterCount() || '';
  syncQuickButtons();
  render();
}
function deadlineLabel(j){
  const d = daysUntil(j.end_publication_date);
  if(d === null) return {text:'Sin fecha', soon:false};
  if(d < 0) return {text:'Vencida', soon:false};
  if(d === 0) return {text:'Cierra hoy', soon:true};
  if(d === 1) return {text:'Cierra mañana', soon:true};
  return {text:`${d} días`, soon:d <= 3};
}
function pageSlice(){
  const pages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
  if(state.page > pages) state.page = pages;
  const start = (state.page - 1) * state.perPage;
  return {items: state.filtered.slice(start, start + state.perPage), pages, start};
}
function chip(label, field){
  return `<span class="chip">${esc(label)}<button type="button" data-clear="${field}" aria-label="Quitar filtro">×</button></span>`;
}
function renderChips(){
  const chips = [];
  const dep = $('#department'); if(dep.value) chips.push(chip(`Departamento: ${dep.options[dep.selectedIndex].text}`, 'department'));
  const inst = $('#institution'); if(inst.value) chips.push(chip(`Entidad: ${inst.options[inst.selectedIndex].text}`, 'institution'));
  const reg = $('#regime'); if(reg.value) chips.push(chip(`Régimen: ${reg.options[reg.selectedIndex].text}`, 'regime'));
  const closing = $('#closing'); if(closing.value) chips.push(chip(`Cierre: ${closing.options[closing.selectedIndex].text}`, 'closing'));
  if($('#salaryMin').value) chips.push(chip(`Desde S/ ${$('#salaryMin').value}`, 'salaryMin'));
  if($('#salaryMax').value) chips.push(chip(`Hasta S/ ${$('#salaryMax').value}`, 'salaryMax'));
  if($('#experienceMax').value) chips.push(chip(`Experiencia: ${$('#experienceMax').options[$('#experienceMax').selectedIndex].text}`, 'experienceMax'));
  if($('#favoritesOnly').checked) chips.push(chip('Solo favoritos', 'favoritesOnly'));
  $('#chips').innerHTML = chips.join('');
  $$('[data-clear]').forEach(b => b.onclick = () => clearField(b.dataset.clear));
}
function clearField(field){
  const el = $('#' + field);
  if(!el) return;
  if(el.type === 'checkbox') el.checked = false;
  else if(el.tagName === 'SELECT') el.selectedIndex = 0;
  else el.value = '';
  apply();
}
function render(){
  $('#count').textContent = state.filtered.length.toLocaleString('es-PE');
  renderChips();

  const {items, pages, start} = pageSlice();
  if(!state.filtered.length){
    $('#cards').innerHTML = '<div class="empty"><strong>No encontré convocatorias con esos filtros.</strong><br>Prueba ampliando el sueldo, experiencia o fecha de cierre.</div>';
    $('#pagination').hidden = true;
    return;
  }

  $('#cards').innerHTML = items.map(j => {
    const deadline = deadlineLabel(j);
    const url = j.job_posting_url || j.source_url || '#';
    const fav = state.favorites.has(j.id);
    const exp = j.required_experience || j.educational_background || '';
    const location = j.department || j.location || 'Perú';
    const salary = j.salary ? fmtMoney(Number(j.salary)) : 'No indicada';
    const vacancies = j.vacancies ? `${j.vacancies} vacante${Number(j.vacancies) === 1 ? '' : 's'}` : 'No indicada';
    return `
      <article class="job">
        <div class="job-top">
          <div>
            <div class="job-title-line"><h3>${esc(j.job_title || 'Puesto sin título')}</h3></div>
            <div class="entity">${esc(j.public_institution || 'Entidad no indicada')}</div>
            <div class="job-code">${esc(j.job_posting_number || '')}</div>
          </div>
          <button class="fav ${fav ? 'active' : ''}" data-fav="${esc(j.id)}" title="Guardar favorito" aria-label="Guardar favorito">${fav ? '★' : '☆'}</button>
        </div>

        <div class="job-grid">
          <div class="fact"><span>Ubicación</span><strong title="${esc(location)}">${esc(location)}</strong></div>
          <div class="fact salary"><span>Remuneración</span><strong>${esc(salary)}</strong></div>
          <div class="fact"><span>Vacantes</span><strong>${esc(vacancies)}</strong></div>
          <div class="fact deadline ${deadline.soon ? 'soon' : ''}"><span>Cierre</span><strong>${esc(deadline.text)}</strong></div>
        </div>

        ${exp ? `<div class="excerpt">${esc(exp)}</div>` : ''}

        <div class="actions">
          <a class="official" href="${esc(url)}" target="_blank" rel="noopener">Ver convocatoria oficial ↗</a>
        </div>
      </article>`;
  }).join('');

  $$('[data-fav]').forEach(b => b.onclick = () => {
    const id = b.dataset.fav;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    localStorage.setItem('servirFavorites', JSON.stringify([...state.favorites]));
    apply(false);
  });

  $('#pagination').hidden = pages <= 1;
  $('#pageInfo').textContent = `Página ${state.page} de ${pages} · ${start + 1}–${Math.min(start + state.perPage, state.filtered.length)}`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= pages;
}
function reset(){
  ['#q','#salaryMin','#salaryMax'].forEach(x => $(x).value = '');
  ['#department','#institution','#regime','#experienceMax','#closing'].forEach(x => $(x).selectedIndex = 0);
  $('#favoritesOnly').checked = false;
  apply();
}
function setQuick(type){
  if(type === 'closing3') $('#closing').value = $('#closing').value === '3' ? '' : '3';
  if(type === 'salary5000') $('#salaryMin').value = Number($('#salaryMin').value) === 5000 ? '' : '5000';
  if(type === 'experience12') $('#experienceMax').value = $('#experienceMax').value === '12' ? '' : '12';
  if(type === 'favorites') $('#favoritesOnly').checked = !$('#favoritesOnly').checked;
  apply();
}
function openFilters(){
  $('#filters').classList.add('open');
  $('#filterOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeFilters(){
  $('#filters').classList.remove('open');
  $('#filterOverlay').classList.remove('open');
  document.body.style.overflow = '';
}
function renderStats(data){
  $('#statJobs').textContent = state.jobs.length.toLocaleString('es-PE');
  $('#statEntities').textContent = unique('public_institution').length.toLocaleString('es-PE');
  $('#statDepartments').textContent = unique('department').length.toLocaleString('es-PE');
  if(data.generated_at){
    const d = new Date(data.generated_at);
    $('#updated').textContent = `Actualizado ${d.toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'})} · ${d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'})}`;
  } else {
    $('#updated').textContent = 'Fecha de actualización no disponible';
  }
}

['#q','#salaryMin','#salaryMax'].forEach(id => $(id).addEventListener('input', () => apply()));
['#department','#institution','#regime','#experienceMax','#closing','#favoritesOnly','#sort'].forEach(id => $(id).addEventListener('change', () => apply()));
$('#reset').onclick = reset;
$('#clearSearch').onclick = () => { $('#q').value = ''; apply(); $('#q').focus(); };
$$('[data-quick]').forEach(b => b.onclick = () => setQuick(b.dataset.quick));
$('#prevPage').onclick = () => { if(state.page > 1){ state.page--; render(); window.scrollTo({top: $('.results').offsetTop - 90, behavior:'smooth'}); } };
$('#nextPage').onclick = () => { const pages = Math.ceil(state.filtered.length/state.perPage); if(state.page < pages){ state.page++; render(); window.scrollTo({top: $('.results').offsetTop - 90, behavior:'smooth'}); } };
$('#openFilters').onclick = openFilters;
$('#closeFilters').onclick = closeFilters;
$('#filterOverlay').onclick = closeFilters;
window.addEventListener('keydown', e => { if(e.key === 'Escape') closeFilters(); });

fetch('data/jobs.json', {cache:'no-store'})
  .then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
  .then(data => {
    state.jobs = data.jobs || [];
    fillSelect('#department', unique('department'));
    fillSelect('#institution', unique('public_institution'));
    fillSelect('#regime', unique('regime'));
    renderStats(data);
    apply();
  })
  .catch(err => {
    $('#cards').innerHTML = `<div class="empty"><strong>No pude cargar los datos.</strong><br>${esc(err.message)}</div>`;
    $('#updated').textContent = 'No se pudo leer la actualización';
  });
