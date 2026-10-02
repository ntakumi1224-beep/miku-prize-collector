import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,validateCandidates,RateLimiter,verifyTurnstile,candidateDiagnostics} from '../src/index.js';
import catalog from '../src/catalog.json' with {type:'json'};
const ids=catalog.items.slice(0,3).map(x=>x.id);
const env={ALLOWED_ORIGIN:'https://ntakumi1224-beep.github.io',TURNSTILE_HOSTNAME:'ntakumi1224-beep.github.io',OPENAI_API_KEY:'test-only',TURNSTILE_SECRET_KEY:'test-only',RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:async(url)=>res(new URL(url).pathname==='/admit'?{receipt:'11111111-1111-4111-8111-111111111111'}:{},200)})}};
function req({origin=env.ALLOWED_ORIGIN,method='POST',image=new Blob([new Uint8Array([255,216,255,224])],{type:'image/jpeg'}),token='test-token'}={}){
 const form=new FormData();form.append('image',image,'photo.jpg');form.append('turnstileToken',token);
 return new Request('https://worker.example/api/identify',{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.1'},...(method==='POST'?{body:form}:{})});
}
const res=(body,status=200)=>new Response(JSON.stringify(body),{status});
function upstream({challenge={success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify'},candidates=ids,status=200,inspect=()=>{}}={}){
 return async(url,options)=>{if(url.includes('siteverify'))return res(challenge);inspect(JSON.parse(options.body));return res({choices:[{message:{content:JSON.stringify({candidateIds:candidates})}}]},status);};
}
test('339 unique products, 1–5 IDs or abstention; invalid IDs/duplicates/count rejected',()=>{
 assert.equal(catalog.items.length,339);assert.equal(new Set(catalog.items.map(x=>x.id)).size,339);
 for(let count=0;count<=5;count++) assert.equal(validateCandidates({candidateIds:catalog.items.slice(0,count).map(x=>x.id)}).length,count);
 assert.deepEqual(validateCandidates({candidateIds:ids}),ids);assert.equal(validateCandidates({candidateIds:catalog.items.slice(0,5).map(x=>x.id)}).length,5);assert.deepEqual(validateCandidates({candidateIds:[]}),[]);
 for(const candidateIds of [[ids[0],ids[0],ids[1]],['invented',...ids],catalog.items.slice(0,6).map(x=>x.id),'bad'])assert.throws(()=>validateCandidates({candidateIds}));
});
test('real request builds image/catalog payload and returns ranked IDs/version',async()=>{
 const r=await createHandler(upstream({inspect:body=>{assert.match(body.messages[0].content,/Return 1 to 5 distinct existing IDs/);assert.match(body.messages[0].content,/color variants/);assert.match(body.messages[0].content,/SEGA-001/);assert.match(body.messages[1].content[1].image_url.url,/^data:image\/jpeg;base64,/);assert.equal(body.response_format.json_schema.strict,true);}}))(req(),env);
 assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(await r.json(),{candidateIds:ids,databaseUpdated:catalog.database_updated,receipt:'11111111-1111-4111-8111-111111111111'});
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
  list:async()=>new Map(data), delete:async keys=>(Array.isArray(keys)?keys:[keys]).forEach(key=>data.delete(key))
 };
 const limiter = new RateLimiter({storage}, {}, ()=>now);
 return {data, limiter, setTime:value=>{now=Date.parse(value);},
  advance:ms=>{now+=ms;},
  settle:(action,key,receipt)=>limiter.fetch(new Request('https://limiter/'+action,{method:'POST',body:JSON.stringify({key,receipt})})),
  admit:(key, dailyLimit=5)=>limiter.fetch(new Request('https://limiter/admit', {method:'POST',body:JSON.stringify({key,dailyLimit})}))};
}
async function success(f,key,limit=5) {
 const response=await f.admit(key,limit);
 if(response.status===200) {const {receipt}=await response.json();assert.equal((await f.settle('ready',key,receipt)).status,200);assert.equal((await f.settle('confirm',key,receipt)).status,200);}
 return response;
}
test('five displayed successes per IP; different IP has independent allowance',async()=>{
 const f=limiterFixture();
 for(const key of ['a','b']) {
  for(let i=0;i<5;i++){assert.equal((await success(f,key)).status,200);f.advance(60000);}
  assert.equal((await f.admit(key)).status,429);
 }
});
test('released failures do not charge daily quota but still hit minute throttle',async()=>{
 const f=limiterFixture();
 for(let i=0;i<3;i++){const receipt=(await(await f.admit('a')).json()).receipt;assert.equal((await f.settle('release','a',receipt)).status,200);}
 assert.equal((await f.admit('a')).status,429);f.advance(60000);
 for(let i=0;i<5;i++){assert.equal((await success(f,'a')).status,200);f.advance(60000);}
 assert.equal((await f.admit('a')).status,429);
});
test('quota resets at JST midnight, not UTC midnight',async()=>{
 const f=limiterFixture('2026-10-03T14:54:00Z');
 for(let i=0;i<5;i++){assert.equal((await success(f,'a')).status,200);f.advance(60000);}
 assert.equal((await f.admit('a')).status,429);
 f.setTime('2026-10-03T15:00:00Z');
 for(let i=0;i<5;i++){assert.equal((await success(f,'a')).status,200);f.advance(60000);}
 f.setTime('2026-10-04T00:00:00Z');assert.equal((await f.admit('a')).status,429);
});
test('concurrent reservations cannot bypass minute or daily cap',async()=>{
 const f=limiterFixture(), batch=()=>Promise.all(Array.from({length:20},()=>f.admit('a')));
 assert.equal((await batch()).filter(r=>r.status===200).length,3);f.advance(60000);
 assert.equal((await batch()).filter(r=>r.status===200).length,2);
});
test('confirmation is idempotent, IP-bound and requires validated candidates',async()=>{
 const f=limiterFixture(), receipt=(await(await f.admit('a',1)).json()).receipt;
 assert.equal((await f.settle('confirm','a',receipt)).status,409);
 await f.settle('ready','a',receipt);
 assert.equal((await f.settle('confirm','b',receipt)).status,409);
 assert.equal((await f.settle('confirm','a',receipt)).status,200);
 assert.equal((await f.settle('confirm','a',receipt)).status,200);
 f.advance(60000);assert.equal((await f.admit('a',1)).status,429);
});
test('missing confirmation expires without charging and cannot be replayed',async()=>{
 const f=limiterFixture(), receipt=(await(await f.admit('a',1)).json()).receipt;
 await f.settle('ready','a',receipt);f.advance(120000);
 assert.equal((await f.settle('confirm','a',receipt)).status,409);
 assert.equal((await success(f,'a',1)).status,200);
});
test('reservations from before JST midnight cannot charge the new day',async()=>{
 const f=limiterFixture('2026-10-03T14:59:59Z'), receipt=(await(await f.admit('a')).json()).receipt;
 await f.settle('ready','a',receipt);f.advance(1000);
 assert.equal((await f.settle('confirm','a',receipt)).status,409);
 assert.equal((await success(f,'a')).status,200);
});
test('legacy attempts are not charged as successes; existing minute throttle survives',async()=>{
 const f=limiterFixture(), now=Date.parse('2026-10-03T12:00:00Z');
 f.data.set('ip-day-jst:a:'+Math.floor((now+9*3600000)/86400000),5);
 f.data.set('ip:a:'+Math.floor(now/60000),3);
 assert.equal((await f.admit('a')).status,429);f.advance(60000);assert.equal((await success(f,'a')).status,200);
});
test('alarm cleans expired reservations but preserves committed usage and receipts',async()=>{
 const f=limiterFixture();await success(f,'a');await f.admit('b');f.data.set('unrelated-metadata','keep');
 f.advance(120000);await f.limiter.alarm();
 assert.equal(f.data.get('unrelated-metadata'),'keep');
 assert.equal([...f.data.values()].filter(v=>v?.confirmed).length,1);
 assert.equal([...f.data.values()].filter(v=>v?.used===1).length,1);
 assert.ok([...f.data.values()].filter(v=>v?.pending).every(v=>Object.keys(v.pending).length===0));
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
  assert.deepEqual(Object.keys(data).sort(),upstreamStatus ? ['code','error','upstreamStatus'] : code==='CANDIDATE_VALIDATION_ERROR' ? ['code','diagnostics','error'] : ['code','error']);
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

test('real limiter releases quota on each OpenAI diagnostic failure and abstention',async()=>{
 for(const [label,reply,code] of [...diagnosticCases,['empty',()=>res({choices:[{message:{content:'{"candidateIds":[]}'}}]})]]) {
  const f=limiterFixture();
  const e={...env,MAX_REQUESTS_PER_DAY:'30',RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:(url,options)=>f.limiter.fetch(new Request(url,options))})}};
  const handler=createHandler(async(url)=>url.includes('siteverify') ? res({success:true,hostname:env.TURNSTILE_HOSTNAME,action:'identify'}) : reply());
  const response=await handler(req(),e);
  assert.equal(response.status,label==='empty'?200:502);
  if(code) assert.equal((await response.json()).code,code);
  const buckets=[...f.data.values()].filter(v=>v?.pending);
  assert.ok(buckets.every(v=>v.used===0 && Object.keys(v.pending).length===0));
 }
});
test('Turnstile failure never reserves or consumes quota',async()=>{
 const f=limiterFixture();
 const e={...env,RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:(url,options)=>f.limiter.fetch(new Request(url,options))})}};
 await createHandler(upstream({challenge:{success:false}}))(req(),e);
 assert.equal(f.data.size,0);
});
test('API returns receipt without charging; display confirmation charges exactly once',async()=>{
 const f=limiterFixture();
 const e={...env,MAX_REQUESTS_PER_DAY:'30',RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:(url,options)=>f.limiter.fetch(new Request(url,options))})}};
 const handler=createHandler(upstream());const response=await handler(req(),e);assert.equal(response.status,200,await response.clone().text());
 const {receipt}=await response.json();assert.equal([...f.data.values()].filter(v=>v?.pending)[0].used,0);
 const confirm=(ip='192.0.2.1')=>new Request('https://worker.example/api/identify/confirm',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,'CF-Connecting-IP':ip,'Content-Type':'application/json'},body:JSON.stringify({receipt})});
 assert.equal((await handler(confirm('192.0.2.2'),e)).status,409);
 for(let i=0;i<2;i++)assert.deepEqual(await(await handler(confirm(),e)).json(),{confirmed:true});
 assert.equal([...f.data.values()].filter(v=>v?.pending)[0].used,1);
});
test('development daily limit allows 30 successes then blocks 31st',async()=>{
 const f=limiterFixture();
 for(let i=0;i<30;i++){assert.equal((await success(f,'a',30)).status,200);f.advance(60000);}
 assert.equal((await f.admit('a',30)).status,429);
});

test('candidate diagnostics report count, duplicate and unknown strings',()=>{
 assert.deepEqual(candidateDiagnostics({candidateIds:[ids[0],ids[0],'SEGA-9999']}),{count:3,hasDuplicates:true,hasUnknownIds:true,invalidIds:['SEGA-9999']});
 assert.deepEqual(candidateDiagnostics({candidateIds:ids.slice(0,2)}),{count:2,hasDuplicates:false,hasUnknownIds:false,invalidIds:[]});
 assert.deepEqual(candidateDiagnostics(null),{count:null,hasDuplicates:null,hasUnknownIds:null,invalidIds:[]});
});
test('candidate diagnostics never echo secrets, objects, free text or unbounded IDs',()=>{
 const data={candidateIds:['SEGA-9999','sk-test-secret','test-only','test-token',{secret:'private-body'},'private body text','X'.repeat(1000),...Array.from({length:10},(_,i)=>'UNKNOWN-'+i)]};
 const d=candidateDiagnostics(data,['test-only','test-token']);
 assert.equal(d.count,data.candidateIds.length);assert.equal(d.hasUnknownIds,true);assert.equal(d.invalidIds.length,5);
 assert.doesNotMatch(JSON.stringify(d),/sk-test-secret|test-only|test-token|private|X{65}/);
});
test('HTTP validation failure returns only bounded requested diagnostics',async()=>{
 const r=await aiHandler(()=>res({choices:[{message:{content:JSON.stringify({candidateIds:[ids[0],ids[0],'SEGA-9999'],ignored:'private-body'})}}]}))(req(),env);
 const data=await r.json();assert.equal(r.status,502);
 assert.deepEqual(data.diagnostics,{count:3,hasDuplicates:true,hasUnknownIds:true,invalidIds:['SEGA-9999']});
 assert.doesNotMatch(JSON.stringify(data),/private-body/);
});

test('one valid candidate succeeds and charges only after display confirmation',async()=>{
 const f=limiterFixture(), e={...env,MAX_REQUESTS_PER_DAY:'30',RATE_LIMITER:{idFromName:x=>x,get:()=>({fetch:(url,options)=>f.limiter.fetch(new Request(url,options))})}};
 const handler=createHandler(upstream({candidates:[ids[0]]}));
 const response=await handler(req(),e);assert.equal(response.status,200);
 const data=await response.json();assert.deepEqual(data.candidateIds,[ids[0]]);
 assert.equal([...f.data.values()].filter(v=>v?.pending)[0].used,0);
 const confirmation=new Request('https://worker.example/api/identify/confirm',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,'CF-Connecting-IP':'192.0.2.1','Content-Type':'application/json'},body:JSON.stringify({receipt:data.receipt})});
 assert.equal((await handler(confirmation,e)).status,200);
 assert.equal([...f.data.values()].filter(v=>v?.pending)[0].used,1);
});
