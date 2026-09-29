import {describe,it,expect,afterAll} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Config,configFor,git,prepareFromSnapshots,prepareLocal,readTrustedConfigFrom,type Snapshot} from '../src/index.js';

const run=promisify(execFile),dirs:string[]=[];
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true})});

describe('snapshot inputs',()=>{
  it('prepares the same file changes as the git path',async()=>{const dir=await mkdtemp(join(tmpdir(),'openreview-snapshot-'));dirs.push(dir);const g=(...a:string[])=>run('git',['-C',dir,...a]);
    const put=async(f:Record<string,string>)=>{for(const [p,c] of Object.entries(f)){await mkdir(dirname(join(dir,p)),{recursive:true});await writeFile(join(dir,p),c)}};
    await g('init','-q');await g('config','user.email','s@example.test');await g('config','user.name','S');
    await put({'src/a.ts':'export const a = 1;\nexport const b = 2;\n','src/gone.ts':'x\n','dist/out.js':'1\n'});await g('add','-A');await g('commit','-qm','base');const base=(await g('rev-parse','HEAD')).stdout.trim();
    await put({'src/a.ts':'export const a = 1;\nexport const b = 3;\nexport const c = 4;\n','src/new.ts':'export const n = 1;\n','dist/out.js':'2\n'});await rm(join(dir,'src/gone.ts'));await g('add','-A');await g('commit','-qm','head');const head=(await g('rev-parse','HEAD')).stdout.trim();
    const config=Config.parse({}),local=await prepareLocal(dir,base,head,config);
    const show=async(rev:string,p:string)=>{try{return await git(dir,'show',`${rev}:${p}`)}catch{return null}};
    // A hosted API returns hunks without the `diff --git` header lines; parsing must not depend on them.
    const snapshots:Snapshot[]=await Promise.all([['src/a.ts','M'],['src/new.ts','A'],['src/gone.ts','D'],['dist/out.js','M']].map(async([p,status])=>({path:p,status:status as Snapshot['status'],patch:(await git(dir,'diff','--unified=3',base,head,'--',p)).replace(/^[\s\S]*?(?=^@@)/m,''),before:await show(base,p),after:await show(head,p)})));
    const remote=prepareFromSnapshots(snapshots,config);const strip=(files:typeof local)=>files.map(({patch,...f})=>f).sort((a,b)=>a.path.localeCompare(b.path));
    expect(strip(remote)).toEqual(strip(local));expect(remote.notes).toEqual(local.notes);expect(remote.find(f=>f.path==='src/a.ts')!.addedLines).toEqual([2,3])});
  it('reads nested configs from an in-memory source',async()=>{const files:Record<string,string>={'greptile.json':'{"strictness":1}','api/.openreview.yml':'strictness: 3\n'};
    const c=await readTrustedConfigFrom({list:async()=>[...Object.keys(files),'api/x.ts'],read:async p=>files[p]});expect(configFor(c,'web/a.ts').threshold).toBe('low');expect(configFor(c,'api/a.ts').threshold).toBe('high')});
});
