"""Run with Python Playwright + Chromium; starts an isolated static server.
External API/Turnstile are mocked: this does not validate recognition accuracy.
"""
import asyncio, functools, http.server, json, os, re, threading
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT.parent)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}/{ROOT.name}/'
CATALOG=json.loads((ROOT/'products.json').read_text())
IDS=[x['id'] for x in CATALOG['items'][:3]]
PUBLIC_CONFIG=(ROOT/'config.js').read_text()
SITE_KEY=re.search(r"turnstileSiteKey: '([^']+)'",PUBLIC_CONFIG).group(1)
API_URL=re.search(r"identifyApiUrl: '([^']+)'",PUBLIC_CONFIG).group(1)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
  context=await browser.new_context()
  await context.route('**/config.js',lambda route:route.fulfill(content_type='application/javascript',body="window.MPC_CONFIG={identifyApiUrl:'',turnstileSiteKey:''};"))
  page=await context.new_page(); errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE);await page.wait_for_function('ITEMS.length===339')
  await page.locator('.nav [data-go="identify"]').click()
  await page.locator('#libraryPhoto').set_input_files(str(ROOT/'icons/icon-512.png'))
  await page.wait_for_function('document.getElementById("preview").naturalWidth>0')
  assert await page.locator('#identifyButton').is_disabled()
  assert '設定待ち' in await page.locator('#identifyStatus').inner_text()
  await context.close()
  context=await browser.new_context()
  await context.route('**/config.js',lambda route:route.fulfill(content_type='application/javascript',body=PUBLIC_CONFIG))
  challenge="""window.turnstile={render:(selector,options)=>{window.testSiteKey=options.sitekey;window.testChallenge=()=>options.callback('test-token');window.testChallenge();return 1},reset:()=>window.testChallenge()};window.mpcTurnstileReady();"""
  await context.route('https://challenges.cloudflare.com/**',lambda route:route.fulfill(content_type='application/javascript',body=challenge))
  mode={'value':'ok'}; sent=[]; confirmations=[]
  async def api(route):
   if route.request.method=='OPTIONS':
    await route.fulfill(status=204,headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'});return
   if route.request.url.endswith('/confirm'):
    assert await page.locator('.candidate').count() in range(1,6)
    confirmations.append(route.request.post_data)
    await route.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body='{"confirmed":true}');return
   sent.append(route.request.post_data_buffer)
   data={'candidateIds':IDS,'databaseUpdated':CATALOG['database_updated'],'receipt':'11111111-1111-4111-8111-111111111111'};status=200
   if mode['value']=='one':data['candidateIds']=IDS[:1]
   if mode['value']=='two':data['candidateIds']=IDS[:2]
   if mode['value']=='five':data['candidateIds']=[x['id'] for x in CATALOG['items'][:5]]
   if mode['value']=='empty':data['candidateIds']=[]
   if mode['value']=='invalid':data['candidateIds']=['invented',*IDS[:2]]
   if mode['value']=='limit':status=429;data={'error':'検索回数の上限に達しました。'}
   if mode['value']=='network':await route.abort();return
   await route.fulfill(status=status,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(data))
  await context.route(API_URL+'**',api)
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE);await page.wait_for_function('ITEMS.length===339')
  await page.evaluate('navigator.serviceWorker.ready');await page.wait_for_function('!!navigator.serviceWorker.controller')
  await page.locator('.nav [data-go="identify"]').click()
  for source in ['cameraPhoto','libraryPhoto']:
   await page.locator('#'+source).set_input_files(str(ROOT/'icons/icon-512.png'))
   await page.wait_for_function('!document.getElementById("identifyButton").disabled')
   assert await page.evaluate('window.testSiteKey')==SITE_KEY
   await page.locator('#identifyButton').click();await page.wait_for_function('document.querySelectorAll(".candidate").length===3')
   assert await page.locator('.identifyWarning').inner_text()=='検索結果は参考候補です。よく見比べて確認してください。'
   card=await page.locator('.candidate').first.inner_text()
   for value in [IDS[0],CATALOG['items'][0]['maker'],CATALOG['items'][0]['name'],'登場年月','外観・衣装']:assert value in card
   await page.wait_for_function('document.getElementById("identifyStatus").textContent.includes("検索が完了")')
   await page.locator('.candidate').first.click();assert await page.locator('#sheet').get_attribute('class')=='sheet open'
   await page.evaluate('closeSheet()')
  assert len(confirmations)==2
  assert len(sent)==2 and all(b'image/jpeg' in body and b'turnstileToken' in body for body in sent)
  for value,text in [('empty','候補を絞れません'),('invalid','商品データの更新'),('limit','上限'),('network','通信できませんでした')]:
   mode['value']=value;await page.locator('#identifyButton').click()
   target='#identifyResult' if value=='empty' else '#identifyStatus'
   await page.wait_for_function('(args)=>document.querySelector(args[0]).textContent.includes(args[1])',arg=[target,text])
   await page.wait_for_function('!document.getElementById("identifyButton").disabled')
  assert len(confirmations)==2 # empty/error results must not confirm usage
  mode['value']='five';await page.locator('#identifyButton').click()
  await page.wait_for_function('document.querySelectorAll(".candidate").length===5')
  await page.wait_for_function('document.getElementById("identifyStatus").textContent.includes("検索が完了")')
  assert len(confirmations)==3
  for size,label in [(1,'one'),(2,'two')]:
   mode['value']=label;await page.locator('#identifyButton').click()
   await page.wait_for_function('(n)=>document.querySelectorAll(".candidate").length===n',arg=size)
   await page.wait_for_function('document.getElementById("identifyStatus").textContent.includes("検索が完了")')
   await page.locator('.candidate').first.click();assert await page.locator('#sheet').get_attribute('class')=='sheet open'
   await page.evaluate('closeSheet()')
  assert len(confirmations)==5
  # Existing external search links and collection filters.
  await page.evaluate('() => {window.externalLinks=[];window.open=(url)=>{externalLinks.push(url);return {}};}')
  await page.evaluate('quickExternal("初音ミク", "images");quickExternal("初音ミク", "mercari");quickExternal("初音ミク", "google")')
  links=await page.evaluate('externalLinks')
  assert len(links)==3 and 'tbm=isch' in links[0] and 'jp.mercari.com' in links[1] and 'google.com' in links[2],links
  await page.locator('.nav [data-go="collection"]').click()
  await page.locator('#search').fill('不存在xyz');assert await page.locator('#list .card').count()==0
  await page.locator('#search').fill('');assert await page.locator('#list .card').count()==339
  # Existing detail/collection/history/appearance behaviour.
  await page.evaluate('openItem('+json.dumps(IDS[0])+')')
  await page.locator('#detail .statusBtn').click();await page.locator('#ownedConfirm .primary').click()
  await page.locator('#detail .qtyBtn').last.click()
  assert await page.locator('#homeOwned').inner_text()=='1';assert await page.locator('#detail .qtyNum').inner_text()=='2'
  await page.locator('#detail .gold + .btn').click()
  assert await page.locator('#kWant').inner_text()=='1'
  await page.evaluate('closeSheet()');await page.locator('.nav [data-go="history"]').click()
  assert await page.locator('#historyList .historyItem').count()==1
  await page.locator('.nav [data-go="settings"]').click()
  await page.locator('#themeSetting').select_option('dark');await page.locator('#languageSetting').select_option('en')
  await page.locator('[data-accent-choice="sakura"]').click()
  await page.reload();await page.wait_for_function('ITEMS.length===339')
  assert await page.locator('html').get_attribute('data-theme')=='dark'
  assert await page.locator('html').get_attribute('data-accent')=='sakura'
  assert await page.locator('html').get_attribute('lang')=='en'
  await context.set_offline(True);await page.reload();await page.wait_for_function('ITEMS.length===339')
  await page.locator('.nav [data-go="collection"]').click();assert await page.locator('#list .card').count()==339
  assert await page.locator('#homeOwned').inner_text()=='1';assert await page.locator('#kWant').inner_text()=='1'
  await page.locator('.nav [data-go="identify"]').click();assert await page.locator('#identifyButton').is_disabled()
  assert not errors,errors
  print('PASS: both image inputs, resized upload, candidates/detail, empty/error/retry, settings, ownership/quantity/wanted/history persistence, offline 339 products')
  await browser.close()
try:asyncio.run(main())
finally:server.shutdown()
