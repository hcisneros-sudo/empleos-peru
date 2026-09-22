const $ = s => document.querySelector(s);
const state = {jobs:[], filtered:[], favorites:new Set(JSON.parse(localStorage.getItem('servirFavorites')||'[]'))};
const fmtMoney = n => Number.isFinite(n) ? new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN',maximumFractionDigits:0}).format(n) : null;
function parseDate(s){if(!s)return null; const m=String(s).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); return m?new Date(+m[3],+m[2]-1,+m[1]):null}
function daysUntil(s){const d=parseDate(s); if(!d)return null; const t=new Date(); t.setHours(0,0,0,0); return Math.ceil((d-t)/86400000)}
function norm(x){return String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function unique(field){return [...new Set(state.jobs.map(j=>j[field]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es'))}
function fillSelect(id,values){const el=$(id), first=el.options[0].outerHTML; el.innerHTML=first+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function searchBlob(j){return norm([j.job_title,j.public_institution,j.job_posting_number,j.educational_background,j.specialization,j.required_knowledge,j.required_experience,j.skills,j.location,j.department].join(' '))}
function apply(){
  const q=norm($('#q').value), dep=$('#department').value, inst=$('#institution').value, reg=$('#regime').value;
  const smin=Number($('#salaryMin').value)||0, smax=Number($('#salaryMax').value)||Infinity;
  const exp=$('#experienceMax').value===''?Infinity:Number($('#experienceMax').value), closing=$('#closing').value===''?Infinity:Number($('#closing').value), fav=$('#favoritesOnly').checked;
  state.filtered=state.jobs.filter(j=>{
    const sal=Number(j.salary)||0, dm=daysUntil(j.end_publication_date), em=j.experience_months==null?Infinity:Number(j.experience_months);
    return (!q||searchBlob(j).includes(q))&&(!dep||j.department===dep)&&(!inst||j.public_institution===inst)&&(!reg||j.regime===reg)&&sal>=smin&&sal<=smax&&em<=exp&&(closing===Infinity|| (dm!==null&&dm>=0&&dm<=closing))&&(!fav||state.favorites.has(j.id));
  });
  const sort=$('#sort').value;
  state.filtered.sort((a,b)=> sort==='salary'?(Number(b.salary)||0)-(Number(a.salary)||0):sort==='newest'?((parseDate(b.start_publication_date)||0)-(parseDate(a.start_publication_date)||0)):sort==='entity'?String(a.public_institution||'').localeCompare(String(b.public_institution||''),'es'):((daysUntil(a.end_publication_date)??9999)-(daysUntil(b.end_publication_date)??9999)));
  render();
}
function render(){
  $('#count').textContent=state.filtered.length;
  const chips=[]; [['#department','Departamento'],['#institution','Entidad'],['#regime','Régimen'],['#closing','Cierre']].forEach(([id,label])=>{const e=$(id);if(e.value)chips.push(`${label}: ${e.options[e.selectedIndex].text}`)}); if($('#salaryMin').value)chips.push(`Desde S/ ${$('#salaryMin').value}`); if($('#favoritesOnly').checked)chips.push('Favoritos'); $('#chips').innerHTML=chips.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
  if(!state.filtered.length){$('#cards').innerHTML='<div class="empty">No encontré convocatorias con esos filtros.</div>';return}
  $('#cards').innerHTML=state.filtered.map(j=>{
    const d=daysUntil(j.end_publication_date), close=d===null?'Sin fecha':d<0?'Vencida':d===0?'Cierra hoy':d===1?'Cierra mañana':`Cierra en ${d} días`;
    const url=j.job_posting_url||j.source_url||'#'; const fav=state.favorites.has(j.id);
    const exp=j.required_experience||j.educational_background||'';
    return `<article class="job"><div class="job-top"><div><h2>${esc(j.job_title||'Puesto sin título')}</h2><div class="entity">${esc(j.public_institution||'Entidad no indicada')}</div></div><button class="fav ${fav?'active':''}" data-fav="${esc(j.id)}" title="Favorito">${fav?'★':'☆'}</button></div><div class="meta"><span class="pill">${esc(j.department||j.location||'Perú')}</span><span class="pill">${esc(j.regime||'Régimen no indicado')}</span>${j.salary?`<span class="pill salary">${esc(fmtMoney(Number(j.salary)))}</span>`:''}${j.vacancies?`<span class="pill">${esc(j.vacancies)} vacante${Number(j.vacancies)===1?'':'s'}</span>`:''}<span class="pill deadline ${d!==null&&d<=3&&d>=0?'soon':''}">${esc(close)}</span></div>${exp?`<div class="excerpt">${esc(exp)}</div>`:''}<div class="actions"><span class="muted">${esc(j.job_posting_number||'')}</span><a class="official" href="${esc(url)}" target="_blank" rel="noopener">Ver convocatoria oficial ↗</a></div></article>`
  }).join('');
  document.querySelectorAll('[data-fav]').forEach(b=>b.onclick=()=>{const id=b.dataset.fav; state.favorites.has(id)?state.favorites.delete(id):state.favorites.add(id); localStorage.setItem('servirFavorites',JSON.stringify([...state.favorites]));apply()});
}
function reset(){['#q','#salaryMin','#salaryMax'].forEach(x=>$(x).value=''); ['#department','#institution','#regime','#experienceMax','#closing'].forEach(x=>$(x).selectedIndex=0); $('#favoritesOnly').checked=false; apply()}
['#q','#department','#institution','#regime','#salaryMin','#salaryMax','#experienceMax','#closing','#favoritesOnly','#sort'].forEach(id=>{const e=$(id); e.addEventListener(e.tagName==='INPUT'?'input':'change',apply)}); $('#reset').onclick=reset; $('#clearSearch').onclick=()=>{$('#q').value='';apply()};
fetch('data/jobs.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}).then(data=>{state.jobs=data.jobs||[]; fillSelect('#department',unique('department')); fillSelect('#institution',unique('public_institution')); fillSelect('#regime',unique('regime')); $('#updated').textContent=data.generated_at?`· actualizado ${new Date(data.generated_at).toLocaleString('es-PE')}`:''; apply()}).catch(err=>{$('#cards').innerHTML=`<div class="empty">No pude cargar los datos: ${esc(err.message)}</div>`});
