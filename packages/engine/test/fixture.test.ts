import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Config,prepareLocal,readTrustedConfig,review} from '../src/index.js';
const run=promisify(execFile);
async function fixture(change:string){const dir=await mkdtemp(join(tmpdir(),'openreview-test-'));const git=async(...args:string[])=>(await run('git',['-C',dir,...args])).stdout.trim();await git('init','-q');await git('config','user.email','fixture@example.test');await git('config','user.name','Fixture');await writeFile(join(dir,'auth.ts'),'export function allowed(token:string){ return token.length > 0 }\n');await writeFile(join(dir,'.openreview.yml'),'commentLimit: 1\n');await git('add','.');await git('commit','-qm','base');const base=await git('rev-parse','HEAD');await writeFile(join(dir,'auth.ts'),change);await writeFile(join(dir,'.openreview.yml'),'commentLimit: 20\n');await git('add','.');await git('commit','-qm','change');return {dir,base,head:await git('rev-parse','HEAD')}}
describe('local integration fixture',()=>{
  it('reads trusted base config and maps changed lines',async()=>{const f=await fixture('export function allowed(token:string){ return true }\n');try{const config=await readTrustedConfig(f.dir,f.base);expect(config.commentLimit).toBe(1);const files=await prepareLocal(f.dir,f.base,f.head,config);const auth=files.find(x=>x.path==='auth.ts')!;expect(auth.addedLines).toEqual([1]);expect(auth.before).toContain('token.length');expect(auth.after).toContain('return true')}finally{await rm(f.dir,{recursive:true,force:true})}});
  it('handles a clean diff without fabricated findings',async()=>{const f=await fixture('export function allowed(token:string){ return token.trim().length > 0 }\n');try{const files=await prepareLocal(f.dir,f.base,f.head,Config.parse({}));const result=await review(files,{analyze:async()=>({findings:{findings:[]},usage:{inputTokens:40,outputTokens:8,estimatedUsd:0.0001}})},Config.parse({}));expect(result.findings).toEqual([]);expect(result.usage.estimatedUsd).toBe(0.0001)}finally{await rm(f.dir,{recursive:true,force:true})}});
  it('reports truncated file coverage',async()=>{const f=await fixture('export function allowed(token:string){ return true }\n');try{const config=Config.parse({context:{maxFiles:1}});const files=await prepareLocal(f.dir,f.base,f.head,config);const result=await review(files,{analyze:async()=>({findings:{findings:[]},usage:{inputTokens:1,outputTokens:1,estimatedUsd:0}})},config);expect(result.status).toBe('partial');expect(result.coverage.join(' ')).toContain('omitted')}finally{await rm(f.dir,{recursive:true,force:true})}});
});
