(() => {
  const config = window.MPC_CONFIG || {};
  const button = document.getElementById('identifyButton');
  const status = document.getElementById('identifyStatus');
  const preview = document.getElementById('preview');
  const results = document.getElementById('identifyResults');
  const list = document.getElementById('identifyResult');
  let image = null, previewUrl = null, token = '', widget = null, busy = false;
  let revision = 0, activeRequest = null;
  let endpoint;
  try {
    endpoint = new URL(config.identifyApiUrl);
    if(endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) endpoint = null;
  } catch { endpoint = null; }
  const configured = Boolean(endpoint && config.turnstileSiteKey);
  const updateButton = () => { button.disabled = !image || !configured || !token || busy || !navigator.onLine; };
  const setStatus = message => { status.textContent = message; };
  function resetChallenge() {
    token = '';
    if(widget !== null && window.turnstile) window.turnstile.reset(widget);
    updateButton();
  }
  async function prepareImage(file) {
    if(!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください。');
    if(file.size > 20 * 1024 * 1024) throw new Error('20MB以下の画像を選択してください。');
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url;
      await img.decode();
      if(!img.naturalWidth || !img.naturalHeight) throw new Error('画像を読み込めませんでした。');
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .85));
      if(!blob || blob.size > 4 * 1024 * 1024) throw new Error('画像が大きすぎます。小さい画像を選択してください。');
      return blob;
    } catch(error) {
      if(error.name === 'EncodingError') throw new Error('この画像形式を読み込めません。JPEGまたはPNGで選び直してください。');
      throw error;
    } finally { URL.revokeObjectURL(url); }
  }
  async function selectPhoto(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if(!file) return;
    const current = ++revision;
    activeRequest?.abort(); image = null; busy = false;
    results.hidden = true; list.replaceChildren();
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    preview.removeAttribute('src'); preview.style.display = 'none';
    updateButton(); setStatus('画像を準備しています…');
    try {
      const prepared = await prepareImage(file);
      if(current !== revision) return;
      image = prepared; previewUrl = URL.createObjectURL(image);
      preview.src = previewUrl; preview.style.display = 'block';
      setStatus(configured ? '画像を確認して「AI検索」を押してください。' : '画像プレビューは利用できます。AI検索は管理者によるAPI設定待ちです。');
    } catch(error) { if(current === revision) setStatus(error.message); }
    if(current === revision) updateButton();
  }
  document.getElementById('cameraPhoto').addEventListener('change', selectPhoto);
  document.getElementById('libraryPhoto').addEventListener('change', selectPhoto);
  function renderCandidates(ids) {
    if(!Array.isArray(ids) || (ids.length !== 0 && (ids.length < 3 || ids.length > 5)) || new Set(ids).size !== ids.length) throw new Error('候補データが不正です。再試行してください。');
    const candidates = ids.map(id => ITEMS.find(item => item.id === id));
    if(candidates.some(item => !item)) throw new Error('商品データの更新が必要です。オンラインで再読み込みしてください。');
    list.replaceChildren(); results.hidden = false;
    if(!candidates.length) {
      const message = document.createElement('p'); message.textContent = '候補を絞れませんでした。フィギュア全体や衣装が明るく写るように撮り直してください。';
      list.append(message); return;
    }
    for(const item of candidates) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'candidate';
      for(const [tag, text] of [['span', `${item.id} · ${item.maker}`], ['b', item.name], ['span', `登場年月：${item.date.slice(0, 7).replace('-', '/')}`], ['p', `外観・衣装：${item.outfit || '記載なし'}`]]) {
        const element = document.createElement(tag); element.textContent = text; card.append(element);
      }
      card.addEventListener('click', () => openItem(item.id)); list.append(card);
    }
  }
  button.addEventListener('click', async () => {
    if(button.disabled) return;
    const current = revision;
    const controller = new AbortController(); activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    busy = true; updateButton(); results.hidden = true; setStatus('候補を検索しています…');
    try {
      const form = new FormData(); form.append('image', image, 'figure.jpg'); form.append('turnstileToken', token);
      const response = await fetch(endpoint.href, {method:'POST', body:form, signal:controller.signal, credentials:'omit', cache:'no-store'});
      const data = await response.json();
      if(current !== revision) return;
      if(!response.ok) throw new Error(data.error || '検索できませんでした。時間を置いて再試行してください。');
      if(data.databaseUpdated !== DATABASE_META.database_updated) throw new Error('商品データの更新が必要です。オンラインで再読み込みしてください。');
      if(data.candidateIds?.length && typeof data.receipt !== 'string') throw new Error('検索結果を確定できません。再試行してください。');
      renderCandidates(data.candidateIds);
      if(data.candidateIds.length) {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if(current !== revision) return;
        const confirmUrl = endpoint.href.replace(/\/identify$/, '/identify/confirm');
        const confirmation = await fetch(confirmUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt:data.receipt}),signal:controller.signal,credentials:'omit',cache:'no-store'});
        if(!confirmation.ok) throw new Error('検索回数を確定できませんでした。再検索してください。');
      }
      setStatus(data.candidateIds.length ? '検索が完了しました。候補を見比べてください。' : '候補を絞れませんでした。この検索は日次回数に含まれません。');
    } catch(error) {
      if(current === revision) setStatus(error.name === 'AbortError' ? '検索がタイムアウトしました。再試行してください。' : error instanceof TypeError ? '通信できませんでした。ネット接続を確認し、再試行してください。' : error.message);
    } finally {
      clearTimeout(timeout);
      if(current === revision) { busy = false; activeRequest = null; }
      resetChallenge();
    }
  });
  window.addEventListener('online', updateButton);
  window.addEventListener('offline', () => { setStatus('オフラインです。AI検索にはネット接続が必要です。'); updateButton(); });
  if(!configured) { setStatus('AI検索は管理者によるAPI設定待ちです。画像プレビューは利用できます。'); return; }
  // Load Turnstile only when the camera screen is opened, preserving offline startup.
  let challengeLoading = false;
  function loadChallenge() {
    if(challengeLoading || !navigator.onLine || !document.getElementById('identify').classList.contains('active')) return;
    challengeLoading = true;
    const script = document.createElement('script');
    window.mpcTurnstileReady = () => {
      widget = window.turnstile.render('#turnstileWidget', {
        sitekey: config.turnstileSiteKey, action:'identify',
        callback: value => { token = value; updateButton(); },
        'expired-callback': () => { token = ''; updateButton(); },
        'error-callback': () => { token = ''; setStatus('利用確認に失敗しました。ネット接続を確認し、画面を再読み込みしてください。'); updateButton(); }
      });
    };
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=mpcTurnstileReady&render=explicit';
    script.async = true; script.onerror = () => { script.remove(); challengeLoading = false; setStatus('利用確認を読み込めませんでした。ネット接続を確認してください。'); };
    document.head.append(script);
  }
  new MutationObserver(loadChallenge).observe(document.getElementById('identify'), {attributes:true, attributeFilter:['class']});
  window.addEventListener('online', loadChallenge); loadChallenge();
})();
