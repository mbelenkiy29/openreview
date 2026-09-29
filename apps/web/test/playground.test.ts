import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parsePrUrl } from '../lib/github';
import { cappedModel, capabilities, runPlayground } from '../lib/playground';
import { sampleResult } from '../lib/sample';

const run=promisify(execFile),dirs:string[]=[];
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true})});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});

describe('playground inputs',()=>{
  it('parses pull request references',()=>{
    expect(parsePrUrl('https://github.com/acme/shop/pull/42/files?w=1')).toEqual({owner:'acme',repo:'shop',number:42});
    expect(parsePrUrl('github.com/acme/shop.git/pull/7')).toEqual({owner:'acme',repo:'shop',number:7});expect(parsePrUrl('acme/shop#9')).toEqual({owner:'acme',repo:'shop',number:9});
    for(const bad of ['https://gitlab.com/a/b/pull/1','https://github.com/a/b/issues/1','https://github.com/a/../pull/1'])expect(()=>parsePrUrl(bad)).toThrow(/pull request URL/)});
  it('reports capabilities from the environment',()=>{expect(capabilities({})).toMatchObject({model:false,prices:false,auth:false,anonymousReview:false,maxReviewUsd:0.25});
    expect(capabilities({ANTHROPIC_API_KEY:'k',ANTHROPIC_MODEL:'m',MODEL_INPUT_USD_PER_MILLION:'1',MODEL_OUTPUT_USD_PER_MILLION:'5',AUTH_SECRET:'s',AUTH_GITHUB_ID:'i',AUTH_GITHUB_SECRET:'x',PLAYGROUND_MAX_REVIEW_USD:'0.1'})).toMatchObject({model:true,prices:true,auth:true,maxReviewUsd:0.1})});
  it('caps model calls and spend',async()=>{const inner={analyze:vi.fn(async()=>({findings:{findings:[]},usage:{inputTokens:1,outputTokens:1,estimatedUsd:0.01}}))};
    const m=cappedModel(inner,{input:1,output:1},0.05);await m.analyze('x'.repeat(1000),1000);expect(m.spent()).toBeCloseTo(0.01);
    await expect(m.analyze('x'.repeat(100_000),1000)).rejects.toThrow('spend cap');await m.analyze('x',10);await expect(m.analyze('x',10)).rejects.toThrow('call limit');expect(inner.analyze).toHaveBeenCalledTimes(2)});
  it('renders the labelled sample through the real formatter',()=>{const s=sampleResult();expect(s.sample).toBe(true);expect(s.review!.summaryMarkdown).toContain('Confidence score: 2/5');expect(s.review!.comments[0].body).toContain('```suggestion')});
});

// A fake GitHub backed by a real two-commit repository: REST JSON, raw files and a real tarball from `git archive`.
async function fakeGitHub(){const dir=await mkdtemp(join(tmpdir(),'openreview-pg-'));dirs.push(dir);const git=async(...a:string[])=>(await run('git',['-C',dir,...a],{maxBuffer:50_000_000})).stdout;
  const put=async(f:Record<string,string>)=>{for(const [p,c] of Object.entries(f)){await mkdir(dirname(join(dir,p)),{recursive:true});await writeFile(join(dir,p),c)}};
  await git('init','-q');await git('config','user.email','f@example.test');await git('config','user.name','F');
  await put({'greptile.json':'{"strictness":1}','src/auth.ts':"import {loadUser} from './users';\nexport function canAccess(token: string) {\n  return loadUser(token) !== null;\n}\n",
    'src/users.ts':'export function loadUser(token: string) {\n  return token ? {token} : null;\n}\n','src/routes.ts':"import {canAccess} from './auth';\nexport function handle(t: string) {\n  if (!canAccess(t)) throw new Error('denied');\n  return 'ok';\n}\n"});
  await git('add','-A');await git('commit','-qm','base');const base=(await git('rev-parse','HEAD')).trim();
  await put({'src/auth.ts':"import {loadUser} from './users';\nexport function canAccess(token: string) {\n  if (token === 'debug') return true;\n  return loadUser(token) !== null;\n}\n",'greptile.json':'{"strictness":3}'});
  await git('add','-A');await git('commit','-qm','head');const head=(await git('rev-parse','HEAD')).trim();
  const tgz=join(dir,'..',`pg-${Date.now()}.tgz`);dirs.push(tgz);await git('archive','--format=tar.gz','--prefix=acme-shop-abc/','-o',tgz,head);const tarball=await readFile(tgz);
  const changed=['src/auth.ts','greptile.json'];const files=await Promise.all(changed.map(async p=>({filename:p,status:'modified',additions:1,deletions:0,patch:(await git('diff','--unified=3',base,head,'--',p)).replace(/^[\s\S]*?(?=^@@)/m,'')})));
  const calls:string[]=[];
  const handler=async(input:RequestInfo|URL)=>{const url=String(input);calls.push(url);const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
    if(url.endsWith('/pulls/7'))return json({title:'Debug bypass',html_url:'https://github.com/acme/shop/pull/7',changed_files:2,base:{sha:base,ref:'main'},head:{sha:head,ref:'feature'}});
    if(url.includes('/pulls/7/files'))return json(files);if(url.includes('/compare/'))return json({merge_base_commit:{sha:base}});
    if(url.includes(`/tarball/${head}`))return new Response(tarball);
    const raw=/raw\.githubusercontent\.com\/acme\/shop\/([0-9a-f]+)\/(.+)$/.exec(url);if(raw){try{return new Response(await git('show',`${raw[1]}:${decodeURIComponent(raw[2])}`))}catch{return new Response('',{status:404})}}
    if(url.startsWith('https://api.anthropic.com/'))return json({content:[{type:'text',text:JSON.stringify(anthropicReplies.shift())}],usage:{input_tokens:1000,output_tokens:200}});
    return new Response('not found',{status:404})};
  const anthropicReplies:unknown[]=[];return {handler,calls,anthropicReplies}}

describe('playground pipeline with a fake GitHub',()=>{
  it('builds the graph from the tarball and retrieves cross-file context without git on the server path',async()=>{const gh=await fakeGitHub();vi.stubGlobal('fetch',gh.handler);
    const r=await runPlayground({owner:'acme',repo:'shop',number:7},'context',undefined,capabilities({}));
    expect(r.graph.files).toBe(3);expect(r.files.map(f=>[f.path,f.reviewed])).toEqual([['src/auth.ts',true],['greptile.json',true]]);
    expect(r.context.map(c=>c.path).sort()).toEqual(['src/routes.ts','src/users.ts']);expect(r.context.find(c=>c.path==='src/routes.ts')!.snippet).toContain('canAccess(t)');
    expect(r.review).toBeUndefined();expect(gh.calls.some(u=>u.includes('raw.githubusercontent.com')&&u.includes('greptile.json'))).toBe(true)});
  it('runs a full review with base-revision config, verification and rendering',async()=>{const gh=await fakeGitHub();vi.stubGlobal('fetch',gh.handler);
    vi.stubEnv('ANTHROPIC_API_KEY','test');vi.stubEnv('ANTHROPIC_MODEL','fixture-model');vi.stubEnv('MODEL_INPUT_USD_PER_MILLION','1');vi.stubEnv('MODEL_OUTPUT_USD_PER_MILLION','5');
    gh.anthropicReplies.push({summary:{overview:'Adds a debug token shortcut.',files:[{path:'src/auth.ts',change:'Debug bypass'}]},findings:[{path:'src/auth.ts',line:3,type:'logic',severity:'low',title:'Debug token bypasses authentication',scenario:'Any caller sends the token "debug"',impact:'Anyone gets access to protected routes',evidence:'The new early return grants access before loadUser',remediation:'Remove the debug shortcut'}]},
      {decisions:[{index:0,retain:true,reason:'The early return is unconditional',observedCode:"if (token === 'debug') return true;",confidence:5}]});
    const r=await runPlayground({owner:'acme',repo:'shop',number:7},'review',undefined,capabilities());
    // strictness 1 comes from the base revision; the PR's own greptile.json (strictness 3) would have rejected this low-severity finding.
    expect(r.review!.findings).toBe(1);expect(r.review!.comments[0]).toMatchObject({path:'src/auth.ts',line:3});expect(r.review!.summaryMarkdown).toContain('Adds a debug token shortcut.');
    expect(r.review!.usage.estimatedUsd).toBeCloseTo(0.004)});
});
