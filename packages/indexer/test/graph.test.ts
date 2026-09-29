import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildGraph, buildResolver, coChangedFiles, resolveImport, retrieveContext } from '../src/index.js';

const run=promisify(execFile),dirs:string[]=[];
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true})});
async function repo(files:Record<string,string>){const dir=await mkdtemp(join(tmpdir(),'openreview-indexer-'));dirs.push(dir);const git=(...a:string[])=>run('git',['-C',dir,...a]);
  await git('init','-q');await git('config','user.email','f@example.test');await git('config','user.name','F');
  for(const [p,c] of Object.entries(files)){await mkdir(dirname(join(dir,p)),{recursive:true});await writeFile(join(dir,p),c)}
  await git('add','.');await git('commit','-qm','base');return {dir,head:(await git('rev-parse','HEAD')).stdout.trim()}}
const lineOf=(text:string,needle:string)=>text.split('\n').findIndex(l=>l.includes(needle))+1;

describe('import resolution',()=>{
  const r=buildResolver(['src/a.ts','src/lib/index.ts','packages/core/src/index.ts','packages/core/src/util.ts','app/auth.py','app/models/__init__.py','go/store/db.go','go/store/db_test.go','src/main/java/com/acme/Repo.java','crate/src/store/mod.rs','crate/src/lib.rs','lib/billing/invoice.rb','src/Store/Repo.php','inc/store.h'],
    new Map([['packages/core/package.json','{"name":"@acme/core","main":"src/index.ts"}'],['go/go.mod','module example.com/app\n'],['tsconfig.json','{"compilerOptions":{"baseUrl":".", /* c */ "paths":{"~/*":["src/*"]},}}']]));
  it.each([
    ['src/x.ts','./a','typescript',['src/a.ts']],['src/x.ts','./a.js','typescript',['src/a.ts']],['src/x.ts','./lib','typescript',['src/lib/index.ts']],
    ['src/x.ts','@acme/core','typescript',['packages/core/src/index.ts']],['src/x.ts','@acme/core/util','typescript',['packages/core/src/util.ts']],['src/x.ts','~/a','typescript',['src/a.ts']],['src/x.ts','react','typescript',[]],
    ['app/x.py','app.auth','python',['app/auth.py']],['app/x.py','.models','python',['app/models/__init__.py']],['go/cmd/main.go','example.com/app/store','go',['go/store/db.go']],
    ['src/main/java/com/acme/S.java','com.acme.Repo','java',['src/main/java/com/acme/Repo.java']],['crate/src/lib.rs','crate::store::Repo','rust',['crate/src/store/mod.rs']],
    ['lib/billing/x.rb','invoice','ruby',['lib/billing/invoice.rb']],['src/S.php','App\\Store\\Repo','php',['src/Store/Repo.php']],['inc/x.cpp','store.h','cpp',['inc/store.h']],
  ] as const)('%s imports %s',(from,spec,lang,expected)=>expect(resolveImport(r,from,spec,lang as any)).toEqual(expected));
});

describe('graph retrieval',()=>{
  it('binds method calls only to methods or direct imports, and never falls back past a changed binding',async()=>{
    const f={
      'lib/index.ts':"export * from './tar';\nexport * from './util';\n",
      'lib/tar.ts':"function text(b: Uint8Array) { return String(b) }\nexport function readTar(b: Uint8Array) { return text(b) }\n",
      'lib/util.ts':"export function git(...a: string[]) { return a.join(' ') }\n",
      'app/util.ts':"export function git(...a: string[]) { return a }\n",
      'lib/graph.ts':"export class Graph {\n  resolve(name: string) { return name }\n}\n",
      'app/cli.ts':"import {resolve} from 'node:path';\nimport {Graph} from '../lib/graph';\nexport function out(p: string) {\n  return resolve(p) + new Graph().resolve(p);\n}\n",
      'app/fetch.ts':"import {readTar} from '../lib/index';\nimport {git} from './util';\nexport async function get(res: Response) {\n  const body = await res.text();\n  git('x');\n  return readTar(new Uint8Array());\n}\n",
    };const {dir,head}=await repo(f);const graph=await buildGraph(dir,head);
    expect(graph.files.get('app/fetch.ts')!.refs.find(r=>r.name==='text')).toMatchObject({member:true});
    const items=await retrieveContext(graph,[{path:'app/fetch.ts',addedLines:[4,5,6],after:f['app/fetch.ts']},{path:'app/util.ts',addedLines:[1],after:f['app/util.ts']},{path:'app/cli.ts',addedLines:[4],after:f['app/cli.ts']}]);
    const reasons=items.map(i=>`${i.path} ${i.reason}`).join('\n');
    // res.text() is not tar.ts's private text(); git() binds to the changed app/util.ts, not lib/util.ts.
    expect(reasons).toContain('lib/tar.ts Definition of function readTar');expect(reasons).not.toMatch(/function text /);expect(reasons).not.toContain('lib/util.ts');
    // path.resolve() is not Graph#resolve, but graph.resolve() is.
    expect(items.filter(i=>i.reason.includes('method resolve')).map(i=>i.path)).toEqual(['lib/graph.ts']);expect(reasons).toMatch(/method resolve used by changed code in app\/cli.ts/);
  });
  it('finds importing callers and called definitions but not same-named decoys',async()=>{
    const f={
      'src/auth.ts':"import {loadUser} from './users';\nexport function canAccess(token: string) {\n  const user = loadUser(token);\n  return user !== null;\n}\n",
      'src/users.ts':"export function loadUser(token: string) {\n  return token ? {id: token} : null;\n}\n",
      'src/routes.ts':"import {canAccess} from './auth';\nexport function handle(req: {token: string}) {\n  if (!canAccess(req.token)) throw new Error('denied');\n  return 'ok';\n}\n",
      'legacy/auth.ts':"export function canAccess(t: string) { return false }\nexport const x = canAccess('a');\n",
      'test/auth.test.ts':"import {canAccess} from '../src/auth';\nit('denies', () => expect(canAccess('')).toBe(false));\n",
    };const {dir,head}=await repo(f);const graph=await buildGraph(dir,head);
    const items=await retrieveContext(graph,[{path:'src/auth.ts',addedLines:[4],after:f['src/auth.ts']}]);
    const paths=items.map(i=>i.path);
    expect(paths).toContain('src/routes.ts');expect(paths).toContain('src/users.ts');expect(paths).toContain('test/auth.test.ts');expect(paths).not.toContain('legacy/auth.ts');
    const caller=items.find(i=>i.path==='src/routes.ts')!;expect(caller.kind).toBe('caller');expect(caller.snippet).toContain('canAccess(req.token)');expect(caller.snippet).toMatch(/^\s+2\| export function handle/);
    expect(items.find(i=>i.path==='src/users.ts')!.kind).toBe('callee');
  });
  it('links python, go and java through imports and packages',async()=>{
    const f={
      'app/billing.py':"from app.tax import rate\n\ndef total(amount):\n    return amount * (1 + rate(amount))\n",
      'app/tax.py':"def rate(amount):\n    return 0.2 if amount > 100 else 0.1\n",
      'app/checkout.py':"from app.billing import total\n\ndef pay(cart):\n    return total(sum(cart))\n",
      'go.mod':'module example.com/shop\n',
      'store/db.go':'package store\n\nfunc Load(id string) (string, error) {\n\treturn id, nil\n}\n',
      'api/handler.go':'package api\n\nimport "example.com/shop/store"\n\nfunc Get(id string) string {\n\tv, _ := store.Load(id)\n\treturn v\n}\n',
      'src/com/acme/Repo.java':'package com.acme;\npublic class Repo {\n  public String fetch(String id) { return id; }\n}\n',
      'src/com/acme/Service.java':'package com.acme;\npublic class Service {\n  private Repo repo;\n  public String get(String id) { return repo.fetch(id); }\n}\n',
    };const {dir,head}=await repo(f);const graph=await buildGraph(dir,head);
    const py=await retrieveContext(graph,[{path:'app/billing.py',addedLines:[4],after:f['app/billing.py']}]);
    expect(py.map(i=>`${i.kind}:${i.path}`)).toEqual(expect.arrayContaining(['caller:app/checkout.py','callee:app/tax.py']));
    const go=await retrieveContext(graph,[{path:'store/db.go',addedLines:[4],after:f['store/db.go']}]);expect(go.map(i=>i.path)).toContain('api/handler.go');
    const java=await retrieveContext(graph,[{path:'src/com/acme/Repo.java',addedLines:[3],after:f['src/com/acme/Repo.java']}]);expect(java.map(i=>i.path)).toContain('src/com/acme/Service.java');
  });
  it('respects the character budget',async()=>{const body=Array.from({length:40},(_,i)=>`  const v${i} = helper(${i});`).join('\n');
    const f:Record<string,string>={'src/helper.ts':'export function helper(n: number) {\n  return n + 1;\n}\n'};for(let i=0;i<10;i++)f[`src/c${i}.ts`]=`import {helper} from './helper';\nexport function use${i}() {\n${body}\n}\n`;
    const {dir,head}=await repo(f);const items=await retrieveContext(await buildGraph(dir,head),[{path:'src/helper.ts',addedLines:[2],after:f['src/helper.ts']}],{budgetChars:3000});
    expect(items.reduce((n,i)=>n+i.snippet.length,0)).toBeLessThanOrEqual(3000);expect(items.length).toBeGreaterThan(0)});
  it('reuses the blob cache on disk',async()=>{const f={'a.py':'def a():\n    return b()\n','b.py':'def b():\n    return 1\n'};const {dir,head}=await repo(f);const cache=await mkdtemp(join(tmpdir(),'openreview-cache-'));dirs.push(cache);
    const g1=await buildGraph(dir,head,{cacheDir:cache});expect(g1.files.size).toBe(2);const versions=await readdir(cache);expect(versions).toHaveLength(1);
    const g2=await buildGraph(dir,head,{cacheDir:cache});expect(g2.defsByName.get('b')?.[0].path).toBe('b.py')});
  it('counts co-changed files',async()=>{const {dir}=await repo({'a.ts':'1','b.ts':'1'});const git=(...a:string[])=>run('git',['-C',dir,...a]);
    for(let i=2;i<4;i++){await writeFile(join(dir,'a.ts'),String(i));await writeFile(join(dir,'b.ts'),String(i));await git('commit','-qam',`c${i}`)}
    const head=(await git('rev-parse','HEAD')).stdout.trim();expect((await coChangedFiles(dir,head,['a.ts'])).get('b.ts')).toBe(3)});
  it('reports snippet line numbers from the head revision',async()=>{const f={'src/a.ts':"import {b} from './b';\nexport function a() {\n  return b();\n}\n",'src/b.ts':'\n\nexport function b() {\n  return 2;\n}\n'};
    const {dir,head}=await repo(f);const items=await retrieveContext(await buildGraph(dir,head),[{path:'src/a.ts',addedLines:[3],after:f['src/a.ts']}]);
    const callee=items.find(i=>i.path==='src/b.ts')!;expect(callee.startLine).toBe(lineOf(f['src/b.ts'],'export function b'))});
});
