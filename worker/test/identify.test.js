import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,validateCandidates,RateLimiter,verifyTurnstile} from '../src/index.js';
import catalog from '../src/catalog.json' with {type:'json'};
const ids=catalog.items.slice(0,3).map(x=>x.id);
const env={ALLOWED_ORIGIN:'https://ntakumi1224-beep.github.io',TURNSTILE_HOSTNAME:'ntakumi1224-beep.github.io',OPENAI_API_KEY:'test-only',TURNSTILE_SECRET_KEY:'test-only',RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:200})})}};
function req({origin=env.ALLOWED_ORIGIN,method='POST',image=new Blob([new Uint8Array([255,216,255,224])],{type:'image/jpeg'}),token='test-token'}={}){
 const form=new FormData();form.append('image',image,'photo.jpg');form.append('turnstileToken',token);
 return new Request('https://worker.example/api/identify',{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1'},...(method==='POST'?{body:form}:{})});
}
const res=(body,status=200)=>new Response(JSON.stringify(body),{status});
function upstream({challenge={success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify'},candidates=ids,status=200,inspect=()=>{}}={}){
 return async(url,options)=>{if(url.includes('siteverify'))return res(challenge);inspect(JSON.parse(options.body));return res({choices:[{message:{content:JSON.stringify({candidateIds:candidates})}}]},status);};
}
test('339 unique products, 3–5 IDs or abstention; invalid IDs/duplicates/count rejected',()=>{
 assert.equal(catalog.items.length,339);assert.equal(new Set(catalog.items.map(x=>x.id)).size,339);
 assert.deepEqual(validateCandidates({candidateIds:ids}),ids);assert.equal(validateCandidates({candidateIds:catalog.items.slice(0,5).map(x=>x.id)}).length,5);assert.deepEqual(validateCandidates({candidateIds:[]}),[]);
 for(const candidateIds of [[ids[0]],[ids[0],ids[0],ids[1]],['invented',...ids],Array(6).fill(ids[0]),'bad'])assert.throws(()=>validateCandidates({candidateIds}));
});
test('real request builds image/catalog payload and returns ranked IDs/version',async()=>{
 const r=await createHandler(upstream({inspect:body=>{assert.match(body.messages[0].content,/color variants/);assert.match(body.messages[0].content,/SEGA-001/);assert.match(body.messages[1].content[1].image_url.url,/^data:image\/jpeg;base64,/);assert.equal(body.response_format.json_schema.strict,true);}}))(req(),env);
 assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(await r.json(),{candidateIds:ids,databaseUpdated:catalog.database_updated});
});
test('abstention stays empty',async()=>{assert.deepEqual((await (await createHandler(upstream({candidates:[]}))(req(),env)).json()).candidateIds,[]);});
test('origin rejected before upstream',async()=>{const r=await createHandler(()=>assert.fail())(req({origin:'https://attacker.example'}),env);assert.equal(r.status,403);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);});
test('preflight permitted, GET rejected',async()=>{assert.equal((await createHandler()(req({method:'OPTIONS'}),env)).status,204);assert.equal((await createHandler()(req({method:'GET'}),env)).status,405);});
test('missing secret fails closed',async()=>{assert.equal((await createHandler()(req(),{...env,OPENAI_API_KEY:''})).status,503);});
test('forged image/missing token rejected',async()=>{const handler=createHandler(()=>assert.fail());assert.equal((await handler(req({image:new Blob(['bad'],{type:'image/jpeg'})}),env)).status,400);assert.equal((await handler(req({token:''}),env)).status,400);});
test('body size bounded without Content-Length',async()=>{const r=new Request('https://worker.example/api/identify',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,'Content-Type':'multipart/form-data; boundary=x'},body:new Uint8Array(4*1024*1024+40000)});assert.equal((await createHandler()(r,env)).status,413);});
test('Turnstile success, hostname and action all required',async()=>{for(const challenge of [{success:false},{success:true,hostname:'evil',action:'identify'},{success:true,hostname:env.TURNSTILE_HOSTNAME,action:'wrong'}])assert.equal((await createHandler(upstream({challenge}))(req(),env)).status,403);});
test('rate limit prevents AI request',async()=>{const e={...env,RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:429})})}};assert.equal((await createHandler(upstream({inspect:()=>assert.fail()}))(req(),e)).status,429);});
test('model invalid IDs, provider failure and network error return safe errors',async()=>{
 for(const handler of [createHandler(upstream({candidates:[...ids.slice(0,2),'invented']})),createHandler(upstream({status:401})),createHandler(async(url)=>{if(url.includes('siteverify'))return res({success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify'});throw new Error('private-details');})]){const r=await handler(req(),env);assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/test-only|private-details/);}
});
function limiterFixture(instant = '2026-10-03T12:00:00Z') {
 const data = new Map(); let alarm = null, now = Date.parse(instant), queue = Promise.resolve();
 const storage = {
  get:async key=>data.get(key), put:async(key,value)=>data.set(key,value),
  transaction:fn=>{const result=queue.then(()=>fn(storage));queue=result.catch(()=>{});return result;},
  getAlarm:async()=>alarm, setAlarm:async value=>{alarm=value;},
  list:async()=>new Map(data), delete:async keys=>keys.forEach(key=>data.delete(key))
 };
 const limiter = new RateLimiter({storage}, {}, ()=>now);
 return {data, limiter, setTime:value=>{now=Date.parse(value);},
  advance:ms=>{now+=ms;},
  admit:(key, dailyLimit=5)=>limiter.fetch(new Request('https://limiter/admit', {method:'POST',body:JSON.stringify({key,dailyLimit})}))};
}
test('five daily requests per IP; a different IP has an independent allowance',async()=>{
 const f=limiterFixture();
 for(let i=0;i<5;i++) {assert.equal((await f.admit('a')).status,200);f.advance(60000);}
 assert.equal((await f.admit('a')).status,429);
 for(let i=0;i<5;i++) {assert.equal((await f.admit('b')).status,200);f.advance(60000);}
 assert.equal((await f.admit('b')).status,429);
});
test('minute throttling remains and denied requests do not consume daily allowance',async()=>{
 const f=limiterFixture();
 for(let i=0;i<3;i++) assert.equal((await f.admit('a')).status,200);
 assert.equal((await f.admit('a')).status,429);
 f.advance(60000);
 for(let i=0;i<2;i++) assert.equal((await f.admit('a')).status,200);
 assert.equal((await f.admit('a')).status,429);
});
test('daily allowance resets at JST midnight, not UTC midnight',async()=>{
 const f=limiterFixture('2026-10-03T14:54:00Z');
 for(let i=0;i<5;i++) {assert.equal((await f.admit('a')).status,200);f.advance(60000);}
 assert.equal((await f.admit('a')).status,429); // 23:59 JST
 f.setTime('2026-10-03T15:00:00Z'); // 00:00 JST
 for(let i=0;i<5;i++) {assert.equal((await f.admit('a')).status,200);f.advance(60000);}
 assert.equal((await f.admit('a')).status,429);
 f.setTime('2026-10-04T00:00:00Z'); // 09:00 JST
 assert.equal((await f.admit('a')).status,429);
});
test('concurrent requests cannot exceed minute or daily allowances',async()=>{
 const f=limiterFixture();
 const batch=()=>Promise.all(Array.from({length:20},()=>f.admit('a')));
 assert.equal((await batch()).filter(r=>r.status===200).length,3);
 f.advance(60000);
 assert.equal((await batch()).filter(r=>r.status===200).length,2);
});
test('legacy global cap is retired; current minute counter remains effective',async()=>{
 const f=limiterFixture();const now=Date.parse('2026-10-03T12:00:00Z');
 f.data.set('day:'+Math.floor(now/86400000),5);
 f.data.set('ip:a:'+Math.floor(now/60000),3);
 assert.equal((await f.admit('a')).status,429);
 assert.equal((await f.admit('b')).status,200);
 f.advance(60000);assert.equal((await f.admit('a')).status,200);
});
test('cleanup removes expired counters, preserving the current JST daily allowance',async()=>{
 const f=limiterFixture('2026-10-03T15:00:00Z');
 await f.admit('a');
 const now=Date.parse('2026-10-03T15:00:00Z'), day=Math.floor((now+9*3600000)/86400000);
 f.data.set('ip-day-jst:old:'+String(day-1),5);
 f.data.set('day:'+String(Math.floor(now/86400000)-1),5);
 f.data.set('unrelated-metadata','keep');
 f.advance(60000);await f.limiter.alarm();
 assert.equal(f.data.get('ip-day-jst:a:'+day),1);
 assert.equal(f.data.get('unrelated-metadata'),'keep');
 assert.ok(!f.data.has('ip-day-jst:old:'+String(day-1)));
});

test('Siteverify sends explicit JSON with secret, token and IP',async()=>{
 const result=await verifyTurnstile(async(url,options)=>{
  assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(options.body),{secret:'test-only',response:'token-only',remoteip:'192.0.2.1'});
  return res({success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify'});
 },env,'token-only','192.0.2.1');assert.equal(result,null);
});
test('HTTP 400 secret errors are server configuration errors',async()=>{
 for(const code of ['missing-input-secret','invalid-input-secret']) {
  const result=await verifyTurnstile(async()=>res({success:false,'error-codes':[code]},400),env,'token-only');
  assert.equal(result.status,503);assert.equal(result.body.code,'TURNSTILE_SECRET_INVALID');
  assert.deepEqual(result.body.verificationErrors,[code]);assert.equal(result.body.verificationStatus,400);
  assert.doesNotMatch(JSON.stringify(result),/test-only|token-only/);
 }
});
test('HTTP 400 invalid token is verification failure, not network error',async()=>{
 const result=await verifyTurnstile(async()=>res({success:false,'error-codes':['invalid-input-response']},400),env,'token-only');
 assert.equal(result.status,403);assert.equal(result.body.code,'TURNSTILE_VERIFICATION_FAILED');
});
test('outage, invalid JSON and timeout handled without leaking bodies',async()=>{
 for(const fetcher of [async()=>res({success:false,'error-codes':['internal-error']},503),async()=>new Response('private upstream text',{status:502}),async()=>{throw new Error('private exception');}]) {
  const result=await verifyTurnstile(fetcher,env,'token-only');assert.equal(result.status,503);
  assert.doesNotMatch(JSON.stringify(result),/private|test-only|token-only/);
 }
});
test('non-2xx success and unexpected error-codes are never trusted',async()=>{
 const result=await verifyTurnstile(async()=>res({success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify','error-codes':['private-message']},400),env,'token-only');
 assert.equal(result.status,403);assert.deepEqual(result.body.verificationErrors,[]);
});


const privateText = 'sensitive-provider-body-secret-token';
function aiHandler(reply) {
 return createHandler(async(url)=>{
  if(url.includes('siteverify')) return res({success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify'});
  return reply();
 });
}
const diagnosticCases = [
 ['network',()=>{throw new Error(privateText);},'OPENAI_NETWORK_ERROR'],
 ['timeout',()=>{throw new DOMException(privateText,'TimeoutError');},'OPENAI_NETWORK_ERROR'],
 ['HTTP',()=>new Response(privateText,{status:401}),'OPENAI_HTTP_ERROR',401],
 ['response JSON',()=>new Response(privateText),'OPENAI_RESPONSE_PARSE_ERROR'],
 ['content JSON',()=>res({choices:[{message:{content:privateText}}]}),'CANDIDATE_PARSE_ERROR'],
 ['missing content',()=>res({choices:[]}), 'CANDIDATE_PARSE_ERROR'],
 ['null envelope',()=>res(null), 'CANDIDATE_PARSE_ERROR'],
 ['invalid IDs',()=>res({choices:[{message:{content:JSON.stringify({candidateIds:['invented',...ids.slice(0,2)]})}}]}),'CANDIDATE_VALIDATION_ERROR'],
 ['duplicate IDs',()=>res({choices:[{message:{content:JSON.stringify({candidateIds:[ids[0],ids[0],ids[1]]})}}]}),'CANDIDATE_VALIDATION_ERROR'],
 ['null candidates',()=>res({choices:[{message:{content:'null'}}]}),'CANDIDATE_VALIDATION_ERROR']
];
for(const [label,reply,code,upstreamStatus] of diagnosticCases) {
 test('safe diagnostic for '+label,async()=>{
  const r=await aiHandler(reply)(req(),env);assert.equal(r.status,502);
  assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);
  const data=await r.json();assert.equal(data.code,code);
  assert.deepEqual(Object.keys(data).sort(),upstreamStatus ? ['code','error','upstreamStatus'] : ['code','error']);
  if(upstreamStatus) assert.equal(data.upstreamStatus,upstreamStatus);
  assert.doesNotMatch(JSON.stringify(data),/sensitive-provider-body|test-only|test-token|stack|Authorization/);
 });
}
test('HTTP error body is never read',async()=>{
 const r=await aiHandler(()=>({ok:false,status:429,json:()=>assert.fail('body must not be parsed'),text:()=>assert.fail('body must not be read')}))(req(),env);
 assert.equal((await r.json()).code,'OPENAI_HTTP_ERROR');
});
test('unexpected pre-OpenAI failure has its own code, not a provider error',async()=>{
 const e={...env,RATE_LIMITER:{idFromName:()=>{throw new Error(privateText);}}};
 const r=await createHandler(upstream())(req(),e);
 const data=await r.json();assert.equal(data.code,'IDENTIFY_INTERNAL_ERROR');assert.doesNotMatch(JSON.stringify(data),/sensitive-provider-body/);
});
