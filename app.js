
async function loadProductDatabase(){
  const response = await fetch('./products.json', {cache:'no-store'});
  if(!response.ok) throw new Error('products.json could not be loaded');
  const data = await response.json();
  ITEMS = Array.isArray(data.items) ? data.items : [];
  DATABASE_META = data;

  const total = ITEMS.length;
  const sub = document.querySelector('.sub');
  if(sub){
    sub.textContent = `Miku Prize Collector · 非公式コレクション支援ツール · ${total}件収録`;
  }
  const settingCount = document.querySelector('#settings .setting:nth-of-type(2) .row > b');
  if(settingCount) settingCount.textContent = `${total}件`;

  const meta = document.querySelector('#settings .updateMeta');
  if(meta){
    const d = String(data.database_updated || '').replaceAll('-', '/');
    meta.innerHTML = `データベース更新：${d}<br>Miku Prize Collector Version 1.0.0`;
  }

  // Rebuild maker/form filters after products are loaded.
  const makerSel = document.getElementById('maker');
  if(makerSel){
    makerSel.innerHTML = '<option value="">全メーカー</option>';
    [...new Set(ITEMS.map(x=>x.maker))].sort().forEach(m=>{
      const o=document.createElement('option');
      o.value=m; o.textContent=m; makerSel.appendChild(o);
    });
  }
  const formBox = document.getElementById('formChips');
  if(formBox){
    const forms=[...new Set(ITEMS.map(x=>x.form).filter(Boolean))].sort();
    formBox.innerHTML =
      '<button type="button" class="chip active" data-form="">全形態</button>'+
      forms.map(f=>`<button type="button" class="chip" data-form="${esc(f)}">${esc(f)}</button>`).join('');
  }
}

let ITEMS = [];
let DATABASE_META = { database_updated: "2026-10-01", count: 0 };
let owned = new Set(JSON.parse(localStorage.getItem('miku_owned')||'[]'));
let wanted = new Set(JSON.parse(localStorage.getItem('miku_wanted')||'[]'));
let historyItems = JSON.parse(localStorage.getItem('miku_history')||'[]');
let ownedAt = JSON.parse(localStorage.getItem('miku_owned_at')||'{}');
let quantities = JSON.parse(localStorage.getItem('miku_quantities')||'{}');

const APPEARANCE_KEYS={theme:'mpc_theme',accent:'mpc_accent',language:'mpc_language'};
const ACCENT_LABELS={miku:'ミクカラー',hotpink:'ピンク（髪飾り）',sakura:'桜ミク',snow:'雪ミク'};
function applyAppearance(){
  const theme=localStorage.getItem(APPEARANCE_KEYS.theme)||'light';
  const accent=localStorage.getItem(APPEARANCE_KEYS.accent)||'miku';
  const language=localStorage.getItem(APPEARANCE_KEYS.language)||'ja';

  document.documentElement.setAttribute('data-theme',theme);
  document.documentElement.setAttribute('data-accent',accent);
  document.documentElement.setAttribute('lang',language);

  const ts=document.getElementById('themeSetting');
  if(ts) ts.value=theme;

  const ls=document.getElementById('languageSetting');
  if(ls) ls.value=language;

  document.querySelectorAll('[data-accent-choice]').forEach(b=>{
    b.classList.toggle('selected',b.dataset.accentChoice===accent);
  });

  const label=document.getElementById('accentLabel');
  if(label) label.textContent='現在：'+ACCENT_LABELS[accent];

  applyLanguage(language);
}

let stateFilter='all', formFilter='';


function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function go(id){
  document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('active',x.id===id));
  document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.go===id));
  if(id==='collection') renderList();
  if(id==='history') renderHistory();
  updateKpis();
  window.scrollTo({top:0,behavior:'smooth'});
}
function updateKpis(){
  const n=owned.size;
  document.getElementById('homeOwned').textContent=n;
  document.getElementById('kOwned').textContent=n;
  document.getElementById('kMissing').textContent=ITEMS.length-n;
  document.getElementById('kWant').textContent=wanted.size;
}



function openStateList(state){
  stateFilter=state;
  formFilter='';
  syncStateChips();
  document.querySelectorAll('#formChips .chip').forEach(b=>b.classList.toggle('active',b.dataset.form===''));
  const maker=document.getElementById('maker'); if(maker) maker.value='';
  const search=document.getElementById('search'); if(search) search.value='';
  const sort=document.getElementById('sort');
  if(sort) sort.value=(state==='owned'?'added':'old');
  updateOwnedSortVisibility();
  go('collection');
}



function applyLanguage(lang){
  const t={
    ja:{
      home:'ホーム', list:'一覧', camera:'カメラ', history:'履歴', settings:'設定',
      collection:'あなたのコレクション', owned:'所持', missing:'未所持', want:'ほしい',
      cameraSearch:'カメラで検索', allItems:'全商品一覧', browsing:'閲覧履歴'
    },
    en:{
      home:'Home', list:'Collection', camera:'Camera', history:'History', settings:'Settings',
      collection:'Your Collection', owned:'Owned', missing:'Missing', want:'Wanted',
      cameraSearch:'Search by Camera', allItems:'All Items', browsing:'History'
    },
    zh:{
      home:'主页', list:'列表', camera:'相机', history:'历史', settings:'设置',
      collection:'我的收藏', owned:'已拥有', missing:'未拥有', want:'想要',
      cameraSearch:'相机搜索', allItems:'全部商品', browsing:'浏览历史'
    }
  }[lang]||null;
  if(!t) return;

  const navs=document.querySelectorAll('.nav [data-go]');
  navs.forEach(btn=>{
    const go=btn.dataset.go;
    const span=btn.querySelector('.ico');
    const icon=span?span.outerHTML:'';
    const key=go==='collection'?'list':go==='identify'?'camera':go;
    if(t[key]) btn.innerHTML=icon+t[key];
  });

  const heroLabel=document.querySelector('.hero > div:first-child');
  if(heroLabel) heroLabel.textContent=t.collection;

  const kpis=document.querySelectorAll('.kpi span');
  if(kpis[0]) kpis[0].textContent=t.owned;
  if(kpis[1]) kpis[1].textContent=t.missing;
  if(kpis[2]) kpis[2].textContent=t.want;

  const quickBtns=document.querySelectorAll('.qbtn');
  if(quickBtns[0]) quickBtns[0].childNodes[0].nodeValue='📷 '+t.cameraSearch;
  if(quickBtns[2]) quickBtns[2].childNodes[0].nodeValue='📚 '+t.allItems;
  if(quickBtns[3]) quickBtns[3].childNodes[0].nodeValue='🕘 '+t.browsing;
}

function bindAppearanceSettings(){
  const ts=document.getElementById('themeSetting');
  if(ts){
    ts.addEventListener('change',()=>{
      localStorage.setItem(APPEARANCE_KEYS.theme,ts.value);
      applyAppearance();
    });
  }

  const ls=document.getElementById('languageSetting');
  if(ls){
    ls.addEventListener('change',()=>{
      localStorage.setItem(APPEARANCE_KEYS.language,ls.value);
      applyAppearance();
    });
  }

  document.querySelectorAll('[data-accent-choice]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      localStorage.setItem(APPEARANCE_KEYS.accent,btn.dataset.accentChoice);
      applyAppearance();
    });
  });
}

function filterMissing(){stateFilter='missing';syncStateChips();go('collection');}
function syncStateChips(){
 document.querySelectorAll('#stateChips .chip').forEach(b=>b.classList.toggle('active',b.dataset.state===stateFilter));
}
document.getElementById('stateChips').addEventListener('click',e=>{
 if(e.target.dataset.state!==undefined){
   stateFilter=e.target.dataset.state;
   syncStateChips();
   updateOwnedSortVisibility();
   renderList();
 }
});
document.getElementById('formChips').addEventListener('click',e=>{
 if(e.target.dataset.form!==undefined){formFilter=e.target.dataset.form;document.querySelectorAll('#formChips .chip').forEach(b=>b.classList.toggle('active',b.dataset.form===formFilter));renderList();}
});
['search','maker','sort'].forEach(id=>document.getElementById(id).addEventListener(id==='search'?'input':'change',renderList));


function updateOwnedSortVisibility(){
  const opt=document.getElementById('sortAddedOption');
  const hint=document.getElementById('sortOwnedHint');
  const sort=document.getElementById('sort');
  const show=stateFilter==='owned';
  if(opt) opt.hidden=!show;
  if(hint) hint.classList.toggle('show',show);
  if(!show && sort && sort.value==='added') sort.value='old';
}
function renderList(){
 const q=document.getElementById('search').value.trim().toLowerCase();
 const maker=document.getElementById('maker').value;
 const sort=document.getElementById('sort').value;
 let a=ITEMS.filter(x=>{
   const text=[x.id,x.name,x.series,x.form,x.outfit,x.artist,x.note,x.year].join(' ').toLowerCase();
   if(q && !text.includes(q)) return false;
   if(maker && x.maker!==maker) return false;
   if(formFilter && x.form!==formFilter) return false;
   if(stateFilter==='owned' && !owned.has(x.id)) return false;
   if(stateFilter==='missing' && owned.has(x.id)) return false;
   if(stateFilter==='want' && !wanted.has(x.id)) return false;
   return true;
 });
 a.sort((x,y)=>{
   if(sort==='name') return x.name.localeCompare(y.name,'ja');
   if(sort==='added'){
     return String(ownedAt[y.id]||'').localeCompare(String(ownedAt[x.id]||''));
   }
   const d=x.date.localeCompare(y.date);
   return sort==='new' ? -d : d;
 });
 document.getElementById('resultCount').textContent=`${a.length}件表示`;
 const list=document.getElementById('list');
 if(!a.length){list.innerHTML='<div class="empty">該当する商品がありません</div>';return;}
 list.innerHTML=a.map(x=>`
   <div class="card ${owned.has(x.id)?'ownedCard':''}" onclick="openItem('${x.id}')">
    <div class="badgeimg">${esc(x.maker.replace('BANDAI SPIRITS','BANDAI').slice(0,8))}</div>
    <div><h3>${esc(x.name)}</h3><div class="meta">${esc(x.id)} · ${esc(x.date)}<br>${esc(x.series||x.form||'')}</div></div>
    <div class="state">${owned.has(x.id)?'<span class="owned">●</span>':wanted.has(x.id)?'<span class="want">★</span>':'○'}</div>
   </div>`).join('');
}

function recordHistory(id){
  const now=new Date().toISOString();
  historyItems=historyItems.filter(x=>x.id!==id);
  historyItems.unshift({id,at:now});
  historyItems=historyItems.slice(0,50);
  localStorage.setItem('miku_history',JSON.stringify(historyItems));
}
function renderHistory(){
  const box=document.getElementById('historyList');
  if(!box) return;
  if(!historyItems.length){
    box.innerHTML='<div class="empty">まだ閲覧履歴がありません</div>';
    return;
  }
  box.innerHTML=historyItems.map(h=>{
    const x=ITEMS.find(i=>i.id===h.id);
    if(!x) return '';
    const d=new Date(h.at);
    const t=d.toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    return `<div class="historyItem" onclick="openItem('${x.id}')">
      <div class="badgeimg">${esc(x.maker.replace('BANDAI SPIRITS','BANDAI').slice(0,8))}</div>
      <div><h3 style="font-size:14px;margin:0 0 5px">${esc(x.name)}</h3>
      <div class="meta">${esc(x.id)} · ${esc(x.date)}</div>
      <div class="historyTime">${t}</div></div>
      <button type="button" class="historyDelete" title="履歴から削除" onclick="event.stopPropagation();removeHistory('${x.id}')">×</button>
    </div>`;
  }).join('');
}


function removeHistory(id){
  historyItems=historyItems.filter(x=>x.id!==id);
  localStorage.setItem('miku_history',JSON.stringify(historyItems));
  renderHistory();
}
function clearHistory(){
  if(!historyItems.length) return;
  if(confirm('閲覧履歴をすべて削除しますか？')){
    historyItems=[];
    localStorage.setItem('miku_history','[]');
    renderHistory();
  }
}

function openItem(id){
 const x=ITEMS.find(i=>i.id===id); if(!x)return;
 recordHistory(id);
 const ownedNow=owned.has(x.id);
 document.getElementById('detail').innerHTML=`
   <div class="pid">${esc(x.id)} · ${esc(x.date)}</div>
   <div class="title">${esc(x.name)}</div>
   <div class="detailgrid">
    <div class="k">メーカー</div><div>${esc(x.maker)}</div>
    <div class="k">シリーズ</div><div>${esc(x.series||'―')}</div>
    <div class="k">形態</div><div>${esc(x.form||'―')}</div>
    <div class="k">衣装・外観</div><div>${esc(x.outfit||'―')}</div>
    <div class="k">デザイン</div><div>${esc(x.artist||'―')}</div>
    <div class="k">備考</div><div>${esc(x.note||'―')}</div>
   </div>

   <div class="statusBox ${ownedNow?'ownedStatus':''}">
     <div class="statusInline">
       <div class="statusOwnedLabel"><b>所持状況：</b>${ownedNow?'所持':'未所持'}</div>
       ${ownedNow ? `
         <div class="qtyWrap">
           <b>個数：</b>
           <div class="qtyControl">
             <button type="button" class="qtyBtn" onclick="changeQuantity('${x.id}',-1)">−</button>
             <div class="qtyNum">${getQuantity(x.id)}</div>
             <button type="button" class="qtyBtn" onclick="changeQuantity('${x.id}',1)">＋</button>
           </div>
         </div>` : '<div></div>'}
       <button type="button" class="statusBtn" onclick="askOwnedChange()">変更</button>
     </div>
     <div id="ownedConfirm" class="confirmBar">
       <div>${ownedNow?'この商品を「未所持」に変更しますか？':'この商品を「所持済み」に変更しますか？'}</div>
       <div class="confirmActions">
         <button class="btn primary" onclick="confirmOwnedChange('${x.id}')">変更する</button>
         <button type="button" class="btn" onclick="cancelOwnedChange()">キャンセル</button>
       </div>
     </div>
   </div>

   <div class="actions">
    <button type="button" class="btn" onclick='quickExternal(${JSON.stringify(x.name)},"images")'>画像</button>
    <button type="button" class="btn" onclick='quickExternal(${JSON.stringify(x.name)},"mercari")'>探す</button>
    <button class="btn gold" onclick='quickExternal(${JSON.stringify(x.name)},"google")'>相場</button>
    <button type="button" class="btn" onclick="toggleWanted('${x.id}')">${wanted.has(x.id)?'★ 欲しい解除':'☆ 欲しい'}</button>
   </div>`;
 document.getElementById('sheet').classList.add('open');
}

function getQuantity(id){
  const q=Number(quantities[id]||1);
  return q<1 ? 1 : q;
}
function changeQuantity(id,delta){
  if(!owned.has(id)) return;
  let q=getQuantity(id)+delta;
  if(q<1) q=1;
  quantities[id]=q;
  localStorage.setItem('miku_quantities',JSON.stringify(quantities));
  openItem(id);
}

function askOwnedChange(){
  const el=document.getElementById('ownedConfirm');
  if(el) el.classList.add('show');
}
function cancelOwnedChange(){
  const el=document.getElementById('ownedConfirm');
  if(el) el.classList.remove('show');
}
function confirmOwnedChange(id){
  if(owned.has(id)){
    owned.delete(id);
    delete ownedAt[id];
    delete quantities[id];
  }else{
    owned.add(id);
    ownedAt[id]=new Date().toISOString();
    quantities[id]=1;
  }
  localStorage.setItem('miku_owned_at',JSON.stringify(ownedAt));
  localStorage.setItem('miku_quantities',JSON.stringify(quantities));
  save();
  openItem(id);
}
function closeSheet(e){document.getElementById('sheet').classList.remove('open');}
function save(){
 localStorage.setItem('miku_owned',JSON.stringify([...owned]));
 localStorage.setItem('miku_wanted',JSON.stringify([...wanted]));
 localStorage.setItem('miku_owned_at',JSON.stringify(ownedAt));
 localStorage.setItem('miku_quantities',JSON.stringify(quantities));
 updateKpis(); updateOwnedSortVisibility(); renderList();
}
function toggleWanted(id){wanted.has(id)?wanted.delete(id):wanted.add(id);save();openItem(id);}
function quickExternal(raw,type){
 let q=encodeURIComponent(String(raw||'').trim());
 if(!q) return;
 let u='';
 if(type==='images')u=`https://www.google.com/search?tbm=isch&q=${q}`;
 if(type==='mercari')u=`https://jp.mercari.com/search?keyword=${q}`;
 if(type==='yahoo')u=`https://auctions.yahoo.co.jp/search/search?p=${q}`;
 if(type==='google')u=`https://www.google.com/search?q=${q}+中古+相場`;
 if(!u) return;
 const w=window.open(u,'_blank','noopener,noreferrer');
 if(!w){
   // Fallback for environments that block popups: use an ordinary anchor click.
   const a=document.createElement('a');
   a.href=u;
   a.target='_blank';
   a.rel='noopener noreferrer';
   document.body.appendChild(a);
   a.click();
   a.remove();
 }
}
document.getElementById('photo').addEventListener('change',e=>{
 const f=e.target.files[0]; if(!f)return;
 const im=document.getElementById('preview');im.src=URL.createObjectURL(f);im.style.display='block';
 document.getElementById('identifyResult').innerHTML='';
});
function demoIdentify(){
 const p=document.getElementById('photo').files[0];
 if(!p){alert('写真を選択してください');return;}
 document.getElementById('identifyResult').innerHTML=`
 <div class="market"><h3>カメラ検索は次段階で接続します</h3>
 <div class="notice">完成版では写真→候補商品→「所持済みにしますか？」の確認→1タップ登録、という流れにします。現プロトタイプではUI確認用です。</div></div>`;
}
function exportState(){
 const blob=new Blob([JSON.stringify({owned:[...owned],wanted:[...wanted],quantities,ownedAt},null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='miku_collection_state.json';a.click();
}
function resetState(){
 if(confirm('所持・欲しい状態をすべてリセットしますか？')){owned=new Set();wanted=new Set();ownedAt={};quantities={};save();}
}

// Existing prototype data may have owned flags without registration timestamps.
for(const id of owned){
  if(!ownedAt[id]) ownedAt[id]='1970-01-01T00:00:00.000Z';
  if(!quantities[id] || Number(quantities[id])<1) quantities[id]=1;
}
localStorage.setItem('miku_owned_at',JSON.stringify(ownedAt));
localStorage.setItem('miku_quantities',JSON.stringify(quantities));
updateOwnedSortVisibility();





function bindNavigation(){
  document.querySelectorAll('[data-go]').forEach(btn=>{
    btn.addEventListener('click',function(ev){
      ev.preventDefault();
      go(this.getAttribute('data-go'));
    },{passive:false});
  });
}
document.addEventListener('DOMContentLoaded',()=>{
  bindNavigation();
  updateKpis();
  updateOwnedSortVisibility();
  renderList();
});

document.addEventListener('DOMContentLoaded', async ()=>{
  applyAppearance();
  bindAppearanceSettings();

  try{
    await loadProductDatabase();
  }catch(err){
    console.error(err);
    const list=document.getElementById('list');
    if(list) list.innerHTML='<div class="empty">商品データを読み込めませんでした。通信状況をご確認ください。</div>';
  }

  // Existing prototype data may have owned flags without timestamps/quantities.
  for(const id of owned){
    if(!ownedAt[id]) ownedAt[id]='1970-01-01T00:00:00.000Z';
    if(!quantities[id] || Number(quantities[id])<1) quantities[id]=1;
  }
  localStorage.setItem('miku_owned_at',JSON.stringify(ownedAt));
  localStorage.setItem('miku_quantities',JSON.stringify(quantities));

  updateOwnedSortVisibility();
  updateKpis();
  renderList();

  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
});
