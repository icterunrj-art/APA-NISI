'use strict';
const $=s=>document.querySelector(s),app=$('#app');let config,mode='home',staffId='',workDate='',floor=2,draft={},editToken='',selectedRoom=null,role=null,reportRows=[],checkerRows=[];
const TYPES={S:'SINGLE',D:'DOUBLE',T:'TWIN',TR:'TRIPLE'},CATS=['OUT','KY','STAY','ECO','HIGAERI'];
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
async function api(path,method='GET',body){let r=await fetch(path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok){let j=await r.json().catch(()=>({}));throw Error(j.error||'通信に失敗しました')}return r.headers.get('content-type')?.includes('text/csv')?r.blob():r.json()}
function toast(t){let e=$('#toast');e.textContent=t;e.style.display='block';clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>e.style.display='none',3800)}
function err(e){toast(e.message||String(e))}
function field(label,html){return `<div class="field"><label>${label}</label>${html}</div>`}
function staffOptions(all=false){return (all?allStaff:config.staff).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
let allStaff=[];
async function refresh(){config=await api('/api/config');role=config.role}
async function closeEdit(){if(editToken){let t=editToken;editToken='';await api('/api/close-edit','POST',{edit_token:t}).catch(()=>{})}}
async function addMoreRooms(){await closeEdit();draft={};selectedRoom=null;await staffView()}
async function home(){await closeEdit();mode='home';await refresh();app.innerHTML=`<div class="panel"><h2>清掃報告システム</h2><p class="muted">APA HOTEL〈八王子駅西〉｜全53室・2F〜6F</p><div class="row"><button class="large" id="staffBtn">スタッフ清掃入力</button><button class="large secondary" id="checkerBtn">CHECKER 集計</button><button class="large secondary" id="adminBtn">ADMIN 管理画面</button></div></div><div class="panel"><h3>使い方</h3><p>スタッフは名前を選択して部屋ごとに清掃区分を入力します。登録内容は共通データベースに保存されます。</p><p class="muted">ホーム画面への追加：iPhoneはSafariの共有メニューから「ホーム画面に追加」を選択してください。</p></div>`;$('#staffBtn').onclick=staffStart;$('#checkerBtn').onclick=()=>login('checker');$('#adminBtn').onclick=()=>login('admin')}
function staffStart(){mode='staff';staffId=config.staff.some(x=>String(x.id)===String(staffId))?staffId:String(config.staff[0]?.id||'');workDate=config.today;draft={};editToken='';floor=2;staffView()}
async function staffView(){mode='staff';let status;try{status=await api('/api/status?date='+workDate)}catch(e){return err(e)}let used=new Map(status.records.map(x=>[x.room,x]));let myExisting=status.records.filter(x=>String(x.staff_id)===String(staffId));if(editToken&&myExisting.length&&!Object.keys(draft).length){myExisting.forEach(x=>draft[x.room]=x.category)}let locked=false;
 app.innerHTML=`<div class="panel"><h2>スタッフ清掃入力</h2><div class="row">${field('スタッフ名',`<select id="staff">${config.staff.map(s=>`<option value="${s.id}" ${String(s.id)===String(staffId)?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`)}${field('清掃日',`<input type="date" id="workDate" max="${config.today}" value="${workDate}">`)}</div><p class="muted">部屋タイプは自動設定。グレーの部屋は登録済みです。自分が登録済みの部屋は重複登録できません。</p>${locked?'<p class="error">このスタッフは当日の登録を完了済みです。後からの修正は管理者に依頼してください。</p>':''}<div class="floors">${[2,3,4,5,6].map(f=>`<button class="${f===floor?'active':'secondary'}" data-floor="${f}">${f}F</button>`).join('')}</div><div class="grid">${config.rooms.filter(r=>Math.floor(r.number/100)===floor).map(r=>{let busy=used.get(r.number),own=busy&&String(busy.staff_id)===String(staffId),chosen=draft[r.number];return `<button class="room ${chosen?'selected':''} ${busy&&!own?'busy':''} ${own?'own':''}" data-room="${r.number}" ${ (busy&&!own)||(own&&!editToken)?'disabled':''}>${r.number}<small>${TYPES[r.type]}${busy?'<br>'+esc(own?'自分が登録済':'登録済'):''}${chosen?'<br>'+esc(chosen):''}</small></button>`}).join('')}</div></div><div class="panel" id="editor"><h3>清掃区分の選択</h3><p class="muted">上の部屋番号をタップしてください。</p></div><div class="panel"><div class="row space"><h3>今回の入力 <span class="pill">${Object.keys(draft).length}室</span></h3><button class="secondary compact" id="clearDraft">入力をクリア</button></div><div class="tablewrap"><table><thead><tr><th>部屋</th><th>タイプ</th><th>区分</th><th>操作</th></tr></thead><tbody>${Object.keys(draft).sort((a,b)=>a-b).map(n=>`<tr><td>${n}</td><td>${TYPES[config.rooms.find(r=>r.number===+n)?.type]}</td><td>${draft[n]}</td><td><button class="danger" data-remove="${n}">削除</button></td></tr>`).join('')||'<tr><td colspan="4">まだ入力されていません</td></tr>'}</tbody></table></div><hr><button class="large" id="submit" ${locked||!Object.keys(draft).length?'disabled':''}>入力内容を確認して完了</button></div>`;
 $('#staff').onchange=async e=>{await closeEdit();staffId=e.target.value;draft={};staffView()};$('#workDate').onchange=async e=>{await closeEdit();workDate=e.target.value;draft={};staffView()};document.querySelectorAll('[data-floor]').forEach(b=>b.onclick=()=>{floor=+b.dataset.floor;staffView()});document.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>{selectedRoom=+b.dataset.room;let r=config.rooms.find(x=>x.number===selectedRoom);$('#editor').innerHTML=`<h3>${selectedRoom}号室 <span class="pill">${TYPES[r.type]}</span></h3><p class="muted">清掃区分を選択</p><div class="choice">${CATS.map(cat=>`<button data-cat="${cat}" class="${draft[selectedRoom]===cat?'active':''}">${cat}</button>`).join('')}</div>`;document.querySelectorAll('[data-cat]').forEach(x=>x.onclick=()=>{draft[selectedRoom]=x.dataset.cat;staffView()})});document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{delete draft[b.dataset.remove];staffView()});$('#clearDraft').onclick=()=>{if(confirm('今回の入力をクリアしますか？')){draft={};staffView()}};$('#submit').onclick=()=>confirmSubmit();}
function confirmSubmit(){let items=Object.entries(draft).map(([room,category])=>({room:+room,category})).sort((a,b)=>a.room-b.room);app.innerHTML=`<div class="panel"><h2>登録内容の確認</h2><p>スタッフ：<b>${esc(config.staff.find(s=>String(s.id)===String(staffId))?.name)}</b>　日付：<b>${workDate}</b></p><h3>合計 ${items.length}室</h3><div class="tablewrap"><table><tr><th>部屋</th><th>タイプ</th><th>清掃区分</th></tr>${items.map(x=>`<tr><td>${x.room}</td><td>${TYPES[config.rooms.find(r=>r.number===x.room).type]}</td><td>${x.category}</td></tr>`).join('')}</table></div><hr><div class="row"><button class="secondary" id="back">入力に戻る</button><button id="save">完了・保存する</button></div></div>`;$('#back').onclick=staffView;$('#save').onclick=async()=>{try{let r=await api('/api/submit','POST',{date:workDate,staff_id:+staffId,items,edit_token:editToken||undefined});editToken=r.edit_token;let latest=await api('/api/my-records?date='+encodeURIComponent(workDate)+'&staff_id='+encodeURIComponent(staffId));resultView(latest.records)}catch(e){err(e);staffView()}}}
function resultView(items){mode='result';let typeCounts={},catCounts={};items.forEach(x=>{let t=config.rooms.find(r=>r.number===x.room).type;typeCounts[t]=(typeCounts[t]||0)+1;catCounts[x.category]=(catCounts[x.category]||0)+1});app.innerHTML=`<div class="panel"><h2 class="success">✓ 清掃報告を保存しました</h2><p>${esc(config.staff.find(s=>String(s.id)===String(staffId))?.name)}　${workDate}</p><div class="summary"><div class="stat"><b>${items.length}</b><span>合計清掃室数</span></div>${CATS.map(c=>`<div class="stat"><b>${catCounts[c]||0}</b><span>${c}</span></div>`).join('')}${Object.entries(TYPES).map(([k,v])=>`<div class="stat"><b>${typeCounts[k]||0}</b><span>${v}</span></div>`).join('')}</div><hr><p class="muted">今の登録を修正する場合は「すぐに修正する」、別の部屋を追加する場合は「別の部屋を追加」を選んでください。追加登録では保存済みの記録は消えません。</p><div class="row"><button id="edit">すぐに修正する</button><button class="secondary" id="addMore">別の部屋を追加</button><button class="secondary" id="finish">終了してホームへ</button></div></div>`;$('#edit').onclick=staffView;$('#addMore').onclick=addMoreRooms;$('#finish').onclick=home}
function login(which){mode='login';if(role===which||role==='admin'&&which==='checker')return which==='admin'?adminView():checkerView();app.innerHTML=`<div class="panel"><h2>${which==='admin'?'ADMIN 管理者':'CHECKER 現場管理者'}ログイン</h2><p class="muted">スタッフの名前選択とは別に、管理画面はパスワードで保護されています。</p>${field('パスワード','<input type="password" id="password" autocomplete="current-password">')}<br><button id="loginBtn">ログイン</button></div>`;$('#loginBtn').onclick=async()=>{try{await api('/api/login','POST',{role:which,password:$('#password').value});await refresh();which==='admin'?adminView():checkerView()}catch(e){err(e)}}}
function navigation(which){return `<div class="tabs"><button class="${which==='checker'?'active':''}" id="goChecker">CHECKER</button>${role==='admin'?'<button class="'+(which==='report'?'active':'')+'" id="goReport">集計・履歴</button><button class="'+(which==='staff'?'active':'')+'" id="goStaff">スタッフ名簿</button><button class="'+(which==='rooms'?'active':'')+'" id="goRooms">部屋マスター</button><button class="'+(which==='audit'?'active':'')+'" id="goAudit">操作履歴</button>':''}<button class="secondary" id="logout">ログアウト</button></div>`}
function bindNav(){let q=id=>$('#'+id);if(q('goChecker'))q('goChecker').onclick=checkerView;if(q('goReport'))q('goReport').onclick=adminView;if(q('goStaff'))q('goStaff').onclick=staffAdmin;if(q('goRooms'))q('goRooms').onclick=roomsAdmin;if(q('goAudit'))q('goAudit').onclick=auditView;q('logout').onclick=async()=>{await api('/api/logout','POST',{});home()}}
function calc(records){let v={out_s:0,out_d:0,out_t:0,out_tr:0,ky:0,stay:0,eco:0,higaeri:0};records.forEach(r=>{let k=r.category==='OUT'?'out_'+r.type.toLowerCase():r.category.toLowerCase();if(k in v)v[k]++});return v}
const KEYS={out_s:'OUT SINGLE',out_d:'OUT DOUBLE',out_t:'OUT TWIN',out_tr:'OUT TRIPLE',ky:'KY',stay:'STAY',eco:'ECO',higaeri:'HIGAERI'};
async function checkerView(){mode='checker';let d=window.checkDate||config.today;try{let data=await api('/api/checker?date='+d);checkerRows=data.records;let counts=calc(data.records),totals=data.totals||{};app.innerHTML=navigation('checker')+`<div class="panel"><h2>CHECKER 当日全体集計</h2>${field('清掃日',`<input id="checkDate" type="date" value="${d}" max="${config.today}">`)}<p class="muted">現場管理者が確認した全体の清掃室数を入力してください。スタッフ登録数と比較します。</p><div class="tablewrap"><table><tr><th>清掃区分</th><th>スタッフ登録</th><th>CHECKER確認数</th><th>差（確認 − 登録）</th></tr>${Object.entries(KEYS).map(([k,v])=>`<tr><td>${v}</td><td>${counts[k]}</td><td><input type="number" min="0" max="999" data-total="${k}" value="${totals[k]??0}"></td><td id="diff-${k}">${(totals[k]??0)-counts[k]}</td></tr>`).join('')}</table></div><br><button id="saveCheck">CHECKER集計を保存</button></div><div class="panel"><h3>スタッフ入力状況</h3>${statsByStaff(data.records)}</div>`;bindNav();$('#checkDate').onchange=e=>{window.checkDate=e.target.value;checkerView()};document.querySelectorAll('[data-total]').forEach(e=>e.oninput=()=>{$('#diff-'+e.dataset.total).textContent=(+e.value||0)-counts[e.dataset.total]});$('#saveCheck').onclick=async()=>{let v={date:d};document.querySelectorAll('[data-total]').forEach(e=>v[e.dataset.total]=Number(e.value));try{await api('/api/checker','POST',v);toast('集計を保存しました');checkerView()}catch(e){err(e)}}}catch(e){err(e)}}
function statsByStaff(records){let names={};records.forEach(r=>{names[r.staff]??={total:0,...Object.fromEntries(CATS.map(x=>[x,0]))};names[r.staff].total++;names[r.staff][r.category]++});return `<div class="tablewrap"><table><tr><th>スタッフ</th><th>合計</th>${CATS.map(x=>`<th>${x}</th>`).join('')}</tr>${Object.entries(names).map(([name,r])=>`<tr><td>${esc(name)}</td><td><b>${r.total}</b></td>${CATS.map(x=>`<td>${r[x]}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="7">登録なし</td></tr>'}</table></div>`}
async function adminView(){mode='admin';await refresh();if(role!=='admin')return login('admin');let start=window.repStart||config.today,end=window.repEnd||config.today,staff=window.repStaff||'';try{let r=await api(`/api/admin/report?start=${start}&end=${end}&staff=${staff}`);reportRows=r.records;app.innerHTML=navigation('report')+`<div class="panel"><h2>清掃実績・検索</h2><div class="row">${field('開始日',`<input id="repStart" type="date" value="${start}">`)}${field('終了日',`<input id="repEnd" type="date" value="${end}">`)}${field('スタッフ',`<select id="repStaff"><option value="">全員</option>${config.staff.map(s=>`<option value="${s.id}" ${String(s.id)===String(staff)?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`)}</div><br><div class="row"><button id="search">検索</button><button class="secondary" id="month">当月表示</button><button class="secondary" id="export">CSVダウンロード</button></div><hr><div class="summary"><div class="stat"><b>${r.records.length}</b><span>登録件数</span></div>${CATS.map(x=>`<div class="stat"><b>${r.records.filter(y=>y.category===x).length}</b><span>${x}</span></div>`).join('')}</div><h3>スタッフ別集計</h3>${statsByStaff(r.records)}<h3>部屋別記録</h3><div class="tablewrap"><table><tr><th>日付</th><th>部屋</th><th>タイプ</th><th>スタッフ</th><th>区分</th><th>操作</th></tr>${r.records.map(x=>`<tr><td>${x.work_date}</td><td>${x.room}</td><td>${TYPES[x.type]}</td><td>${esc(x.staff)}</td><td>${x.category}</td><td><button class="compact" data-edit="${x.id}">編集</button></td></tr>`).join('')||'<tr><td colspan="6">該当する記録はありません</td></tr>'}</table></div><hr><button class="secondary" id="addRecord">清掃記録を追加・訂正</button></div>`;bindNav();$('#search').onclick=()=>{window.repStart=$('#repStart').value;window.repEnd=$('#repEnd').value;window.repStaff=$('#repStaff').value;adminView()};$('#month').onclick=()=>{window.repStart=config.today.slice(0,7)+'-01';window.repEnd=config.today;window.repStaff='';adminView()};$('#export').onclick=async()=>{try{let blob=await api(`/api/admin/export?start=${start}&end=${end}&staff=${staff}`);let url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`cleaning_${start}_${end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){err(e)}};document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>recordEditor(reportRows.find(x=>x.id===+b.dataset.edit)));$('#addRecord').onclick=()=>recordEditor(null)}catch(e){err(e)}}
function recordEditor(r){app.innerHTML=navigation('report')+`<div class="panel"><h2>${r?'清掃記録の訂正':'清掃記録の追加'}</h2><div class="row">${field('日付',`<input type="date" id="editDate" value="${r?.work_date||config.today}" ${r?'disabled':''}>`)}${field('部屋番号',`<select id="editRoom" ${r?'disabled':''}>${config.rooms.map(x=>`<option value="${x.number}" ${x.number===r?.room?'selected':''}>${x.number}（${TYPES[x.type]}）</option>`).join('')}</select>`)}</div><div class="row">${field('スタッフ',`<select id="editStaff">${config.staff.map(x=>`<option value="${x.id}" ${x.id===r?.staff_id?'selected':''}>${esc(x.name)}</option>`).join('')}</select>`)}${field('清掃区分',`<select id="editCat">${CATS.map(x=>`<option ${x===r?.category?'selected':''}>${x}</option>`).join('')}</select>`)}</div><br><div class="row"><button id="saveRecord">保存</button>${r?'<button class="danger" id="deleteRecord">記録を削除</button>':''}<button class="secondary" id="cancel">戻る</button></div><p class="muted">訂正・削除の内容は操作履歴に記録されます。</p></div>`;bindNav();$('#cancel').onclick=adminView;$('#saveRecord').onclick=async()=>{try{await api('/api/admin/record','POST',{date:$('#editDate').value,room:+$('#editRoom').value,staff_id:+$('#editStaff').value,category:$('#editCat').value});toast('保存しました');adminView()}catch(e){err(e)}};if(r)$('#deleteRecord').onclick=async()=>{if(!confirm(`${r.room}号室の記録を削除しますか？ 操作履歴には残ります。`))return;try{await api('/api/admin/record','DELETE',{date:r.work_date,room:r.room});toast('削除しました');adminView()}catch(e){err(e)}}}
async function staffAdmin(){mode='staffAdmin';try{allStaff=(await api('/api/admin/staff')).staff;app.innerHTML=navigation('staff')+`<div class="panel"><h2>スタッフ名簿</h2><div class="row">${field('新人の名前','<input id="newStaff" placeholder="例：NEW STAFF">')}<button id="addStaff">追加する</button></div><div class="tablewrap"><table><tr><th>名前</th><th>在籍</th><th>操作</th></tr>${allStaff.map(x=>`<tr><td><input id="name-${x.id}" value="${esc(x.name)}"></td><td><input type="checkbox" id="active-${x.id}" ${x.active?'checked':''}></td><td><button data-save-staff="${x.id}">保存</button></td></tr>`).join('')}</table></div><p class="muted">退職者は在籍チェックを外してください。過去の清掃記録は保持されます。</p></div>`;bindNav();$('#addStaff').onclick=async()=>{try{await api('/api/admin/staff','POST',{name:$('#newStaff').value});toast('追加しました');await refresh();staffAdmin()}catch(e){err(e)}};document.querySelectorAll('[data-save-staff]').forEach(b=>b.onclick=async()=>{let id=+b.dataset.saveStaff;try{await api('/api/admin/staff','POST',{id,name:$('#name-'+id).value,active:$('#active-'+id).checked});toast('更新しました');await refresh();staffAdmin()}catch(e){err(e)}})}catch(e){err(e)}}
async function roomsAdmin(){try{let r=await api('/api/admin/rooms');app.innerHTML=navigation('rooms')+`<div class="panel"><h2>部屋マスター（${r.rooms.length}室）</h2><div class="tablewrap"><table><tr><th>部屋番号</th><th>タイプ</th><th>有効</th><th>操作</th></tr>${r.rooms.map(x=>`<tr><td>${x.number}</td><td><select id="type-${x.number}">${Object.entries(TYPES).map(([k,v])=>`<option value="${k}" ${k===x.type?'selected':''}>${v}</option>`).join('')}</select></td><td><input type="checkbox" id="roomActive-${x.number}" ${x.active?'checked':''}></td><td><button data-save-room="${x.number}">保存</button></td></tr>`).join('')}</table></div></div>`;bindNav();document.querySelectorAll('[data-save-room]').forEach(b=>b.onclick=async()=>{let n=+b.dataset.saveRoom;try{await api('/api/admin/rooms','POST',{number:n,type:$('#type-'+n).value,active:$('#roomActive-'+n).checked});toast('更新しました');await refresh()}catch(e){err(e)}})}catch(e){err(e)}}
async function auditView(){try{let a=(await api('/api/admin/audit')).audit;app.innerHTML=navigation('audit')+`<div class="panel"><h2>操作履歴（直近200件）</h2><div class="tablewrap"><table><tr><th>日時</th><th>操作担当</th><th>内容</th><th>詳細</th></tr>${a.map(x=>`<tr><td>${esc(x.at)}</td><td>${esc(x.actor)}</td><td>${esc(x.action)}</td><td><details><summary>表示</summary><pre>${esc(x.details)}</pre></details></td></tr>`).join('')}</table></div></div>`;bindNav()}catch(e){err(e)}}
$('#home').onclick=home;refresh().then(home).catch(e=>app.innerHTML=`<div class="panel error">サーバーに接続できません。${esc(e.message)}</div>`);

/* Staff registration fix: preserves CHECKER and ADMIN features */
let editLoaded = false;

addMoreRooms = async function () {
  await closeEdit();
  draft = {};
  editLoaded = false;
  selectedRoom = null;
  await staffView();
};

staffStart = function () {
  mode = 'staff';
  staffId = config.staff.some(s => String(s.id) === String(staffId))
    ? staffId : String(config.staff[0]?.id || '');
  workDate = config.today;
  draft = {};
  editToken = '';
  editLoaded = false;
  floor = 2;
  staffView();
};

staffView = async function () {
  mode = 'staff';
  let status;
  try {
    status = await api('/api/status?date=' + encodeURIComponent(workDate));
  } catch (e) {
    return err(e);
  }

  const used = new Map(status.records.map(r => [r.room, r]));
  const mine = status.records.filter(
    r => String(r.staff_id) === String(staffId)
  );

  if (editToken && !editLoaded) {
    draft = {};
    mine.forEach(r => draft[r.room] = r.category);
    editLoaded = true;
  }

  const editing = !!editToken;
  const roomType = n => TYPES[config.rooms.find(r => r.number === +n)?.type] || '';

  app.innerHTML = `
    <div class="panel">
      <h2>スタッフ清掃入力</h2>
      <div class="row">
        ${field('スタッフ名', `<select id="staff">
          ${config.staff.map(s => `<option value="${s.id}"
          ${String(s.id) === String(staffId) ? 'selected' : ''}>
          ${esc(s.name)}</option>`).join('')}
        </select>`)}
        ${field('清掃日', `<input type="date" id="workDate"
          max="${config.today}" value="${workDate}">`)}
      </div>
      <p class="muted">${editing
        ? '修正モード：保存済みの自分の部屋を訂正できます。'
        : '追加登録モード：未登録の部屋を選んでください。'}
        部屋タイプは自動設定です。
      </p>
      <div class="floors">
        ${[2,3,4,5,6].map(f => `<button
          class="${f === floor ? 'active' : 'secondary'}"
          data-floor="${f}">${f}F</button>`).join('')}
      </div>
      <div class="grid">
        ${config.rooms.filter(r => Math.floor(r.number / 100) === floor)
          .map(r => {
            const busy = used.get(r.number);
            const own = busy && String(busy.staff_id) === String(staffId);
            const chosen = draft[r.number];
            const disabled = (busy && !own) || (own && !editing);
            return `<button class="room ${chosen ? 'selected' : ''}
              ${busy && !own ? 'busy' : ''} ${own ? 'own' : ''}"
              data-room="${r.number}" ${disabled ? 'disabled' : ''}>
              ${r.number}<small>${roomType(r.number)}
              ${busy ? '<br>' + (own ? '自分が登録済' : '登録済') : ''}
              ${chosen ? '<br>' + esc(chosen) : ''}
              </small></button>`;
          }).join('')}
      </div>
    </div>
    <div class="panel" id="editor">
      <h3>清掃区分の選択</h3>
      <p class="muted">部屋番号をタップしてください。</p>
    </div>
    <div class="panel">
      <div class="row space">
        <h3>今回の入力 <span class="pill">${Object.keys(draft).length}室</span></h3>
        <button class="secondary compact" id="clearDraft">入力をクリア</button>
      </div>
      <div class="tablewrap"><table>
        <thead><tr><th>部屋</th><th>タイプ</th><th>区分</th><th>操作</th></tr></thead>
        <tbody>
        ${Object.keys(draft).sort((a,b) => +a - +b).map(n => `
          <tr><td>${n}</td><td>${roomType(n)}</td>
          <td>${draft[n]}</td>
          <td><button class="danger" data-remove="${n}">削除</button></td></tr>
        `).join('') || '<tr><td colspan="4">まだ入力されていません</td></tr>'}
        </tbody>
      </table></div>
      <hr>
      <button class="large" id="submit"
        ${!editing && !Object.keys(draft).length ? 'disabled' : ''}>
        入力内容を確認して完了
      </button>
    </div>`;

  $('#staff').onchange = async e => {
    await closeEdit();
    staffId = e.target.value;
    draft = {};
    editLoaded = false;
    staffView();
  };
  $('#workDate').onchange = async e => {
    await closeEdit();
    workDate = e.target.value;
    draft = {};
    editLoaded = false;
    staffView();
  };
  document.querySelectorAll('[data-floor]').forEach(b => {
    b.onclick = () => { floor = +b.dataset.floor; staffView(); };
  });
  document.querySelectorAll('[data-room]').forEach(b => {
    b.onclick = () => {
      selectedRoom = +b.dataset.room;
      $('#editor').innerHTML = `
        <h3>${selectedRoom}号室
        <span class="pill">${roomType(selectedRoom)}</span></h3>
        <p class="muted">清掃区分を選択</p>
        <div class="choice">${CATS.map(cat => `
          <button data-cat="${cat}"
          class="${draft[selectedRoom] === cat ? 'active' : ''}">
          ${cat}</button>`).join('')}</div>`;
      document.querySelectorAll('[data-cat]').forEach(x => {
        x.onclick = () => {
          draft[selectedRoom] = x.dataset.cat;
          staffView();
        };
      });
    };
  });
  document.querySelectorAll('[data-remove]').forEach(b => {
    b.onclick = () => { delete draft[b.dataset.remove]; staffView(); };
  });
  $('#clearDraft').onclick = () => {
    if (confirm('今回の入力をクリアしますか？')) {
      draft = {};
      staffView();
    }
  };
  $('#submit').onclick = confirmSubmit;
};

confirmSubmit = function () {
  const items = Object.entries(draft)
    .map(([room, category]) => ({room: +room, category}))
    .sort((a,b) => a.room - b.room);

  app.innerHTML = `<div class="panel">
    <h2>登録内容の確認</h2>
    <p>スタッフ：<b>${esc(config.staff.find(
      s => String(s.id) === String(staffId))?.name)}</b>
      日付：<b>${workDate}</b></p>
    <h3>合計 ${items.length}室</h3>
    <div class="tablewrap"><table>
      <tr><th>部屋</th><th>タイプ</th><th>清掃区分</th></tr>
      ${items.map(x => `<tr><td>${x.room}</td>
        <td>${TYPES[config.rooms.find(r => r.number === x.room)?.type]}</td>
        <td>${x.category}</td></tr>`).join('')}
    </table></div>
    <hr><div class="row">
      <button class="secondary" id="back">入力に戻る</button>
      <button id="save">完了・保存する</button>
    </div>
  </div>`;

  $('#back').onclick = staffView;
  $('#save').onclick = async () => {
    const button = $('#save');
    button.disabled = true;
    try {
      const r = await api('/api/submit', 'POST', {
        date: workDate,
        staff_id: +staffId,
        items,
        edit_token: editToken || undefined
      });
      editToken = r.edit_token;
      editLoaded = false;
      draft = {};
      const latest = await api('/api/my-records?date=' +
        encodeURIComponent(workDate) + '&staff_id=' +
        encodeURIComponent(staffId));
      resultView(latest.records);
    } catch (e) {
      err(e);
      staffView();
    }
  };
};

resultView = function (items) {
  mode = 'result';
  const typeCounts = {}, catCounts = {};
  items.forEach(x => {
    const t = config.rooms.find(r => r.number === x.room)?.type;
    if (t) typeCounts[t] = (typeCounts[t] || 0) + 1;
    catCounts[x.category] = (catCounts[x.category] || 0) + 1;
  });

  app.innerHTML = `<div class="panel">
    <h2 class="success">✓ 清掃報告を保存しました</h2>
    <p>${esc(config.staff.find(
      s => String(s.id) === String(staffId))?.name)}　${workDate}</p>
    <div class="summary">
      <div class="stat"><b>${items.length}</b><span>合計清掃室数</span></div>
      ${CATS.map(c => `<div class="stat"><b>${catCounts[c] || 0}</b>
        <span>${c}</span></div>`).join('')}
      ${Object.entries(TYPES).map(([k,v]) => `
        <div class="stat"><b>${typeCounts[k] || 0}</b>
        <span>${v}</span></div>`).join('')}
    </div>
    <hr>
    <p class="muted">追加登録では保存済みの記録は消えません。
      登録直後の修正は「すぐに修正する」を選んでください。</p>
    <div class="row">
      <button id="edit">すぐに修正する</button>
      <button class="secondary" id="addMore">別の部屋を追加</button>
      <button class="secondary" id="finish">終了してホームへ</button>
    </div>
  </div>`;

  $('#edit').onclick = () => {
    draft = {};
    editLoaded = false;
    staffView();
  };
  $('#addMore').onclick = addMoreRooms;
  $('#finish').onclick = home;
};
