import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler,validateCandidates,RateLimiter} from '../src/index.js';
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
 for(const handler of [createHandler(upstream({candidates:[...ids.slice(0,2),'invented']})),createHandler(upstream({status:401})),createHandler(async()=>{throw new Error('private-details');})]){const r=await handler(req(),env);assert.equal(r.status,502);assert.doesNotMatch(await r.text(),/test-only|private-details/);}
});
test('per-IP minute cap and global daily cap',async()=>{
 const data=new Map();let alarm=null;
 const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),transaction:async fn=>fn(storage),getAlarm:async()=>alarm,setAlarm:async v=>{alarm=v}};
 const limiter=new RateLimiter({storage});const admit=(key)=>limiter.fetch(new Request('https://limiter/admit',{method:'POST',body:JSON.stringify({key,dailyLimit:5})}));
 for(let i=0;i<3;i++)assert.equal((await admit('a')).status,200);assert.equal((await admit('a')).status,429);
 for(let i=0;i<2;i++)assert.equal((await admit('b')).status,200);assert.equal((await admit('c')).status,429);assert.ok(alarm);
});
