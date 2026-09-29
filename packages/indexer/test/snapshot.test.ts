import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildGraph, buildGraphFromFiles, blobSha, readTarGz, retrieveContext } from '../src/index.js';

const run=promisify(execFile),dirs:string[]=[];
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true})});
const long=`src/${'deeply-nested-directory/'.repeat(6)}module.ts`;
const files:Record<string,string>={
  'package.json':'{"name":"root"}\n','tsconfig.json':'{"compilerOptions":{"baseUrl":".","paths":{"~/*":["src/*"]}}}\n',
  'src/auth.ts':"import {loadUser} from '~/users';\nexport function canAccess(t: string) {\n  return loadUser(t) !== null;\n}\n",
  'src/users.ts':'export function loadUser(t: string) {\n  return t ? {t} : null;\n}\n',
  'src/routes.ts':"import {canAccess} from './auth';\nexport const handle = (t: string) => canAccess(t);\n",
  [long]:"import {canAccess} from '~/auth';\nexport const deep = () => canAccess('x');\n",
  'logo.png':'\u0000\u0001binary',
};
async function repo(){const dir=await mkdtemp(join(tmpdir(),'openreview-snap-'));dirs.push(dir);const git=(...a:string[])=>run('git',['-C',dir,...a]);
  await git('init','-q');await git('config','user.email','s@example.test');await git('config','user.name','S');
  for(const [p,c] of Object.entries(files)){await mkdir(dirname(join(dir,p)),{recursive:true});await writeFile(join(dir,p),c)}
  await git('add','-A');await git('commit','-qm','base');return {dir,head:(await git('rev-parse','HEAD')).stdout.trim()}}
const summary=(g:Awaited<ReturnType<typeof buildGraph>>)=>[...g.files.values()].map(f=>({path:f.path,defs:f.defs.map(d=>d.name),refs:f.refs.length,resolved:f.resolved})).sort((a,b)=>a.path.localeCompare(b.path));

describe('snapshot graphs',()=>{
  it('matches the git-backed graph and uses git blob ids',async()=>{const {dir,head}=await repo();const fromGit=await buildGraph(dir,head);const fromFiles=await buildGraphFromFiles(new Map(Object.entries(files)));
    expect(summary(fromFiles)).toEqual(summary(fromGit));const blob=(await run('git',['-C',dir,'rev-parse',`${head}:src/auth.ts`])).stdout.trim();expect(blobSha(Buffer.from(files['src/auth.ts']))).toBe(blob);
    const items=await retrieveContext(fromFiles,[{path:'src/auth.ts',addedLines:[3],after:files['src/auth.ts']}]);expect(items.map(i=>i.path).sort()).toEqual([long,'src/routes.ts','src/users.ts'].sort())});
  it('reads a GitHub-style tarball with long paths, prefix stripping, filters and caps',async()=>{const {dir}=await repo();const tgz=join(dir,'..',`snap-${Date.now()}.tar.gz`);dirs.push(tgz);
    await run('git',['-C',dir,'archive','--format=tar.gz','--prefix=acme-shop-abc1234/','-o',tgz,'HEAD']);
    const all=await readTarGz(createReadStream(tgz),{stripComponents:1});expect([...all.files.keys()].sort()).toEqual(Object.keys(files).sort());expect(all.files.get(long)!.toString()).toBe(files[long]);expect(all.truncated).toBe(false);
    const ts=await readTarGz(createReadStream(tgz),{stripComponents:1,filter:p=>p.endsWith('.ts')});expect(ts.files.size).toBe(4);
    const capped=await readTarGz(createReadStream(tgz),{stripComponents:1,maxFiles:2});expect(capped.files.size).toBe(2);expect(capped.truncated).toBe(true);
    const tiny=await readTarGz(createReadStream(tgz),{stripComponents:1,maxBytes:600});expect(tiny.truncated).toBe(true)});
});
