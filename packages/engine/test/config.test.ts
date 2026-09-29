import {describe,it,expect,afterAll} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Config,configFor,isIgnored,prepareLocal,readTrustedConfig} from '../src/index.js';

const run=promisify(execFile),dirs:string[]=[];
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true})});
async function repo(base:Record<string,string>,head:Record<string,string>={}){const dir=await mkdtemp(join(tmpdir(),'openreview-config-'));dirs.push(dir);const git=async(...a:string[])=>(await run('git',['-C',dir,...a])).stdout.trim();
  const put=async(files:Record<string,string>)=>{for(const [p,c] of Object.entries(files)){await mkdir(dirname(join(dir,p)),{recursive:true});await writeFile(join(dir,p),c)}};
  await git('init','-q');await git('config','user.email','c@example.test');await git('config','user.name','C');await put(base);await git('add','-A');await git('commit','-qm','base');const b=await git('rev-parse','HEAD');
  await put(head);await git('add','-A');await git('commit','-qm','head','--allow-empty');return {dir,base:b,head:await git('rev-parse','HEAD')}}

describe('trusted configuration',()=>{
  it('parses a greptile.json unchanged',async()=>{const r=await repo({'greptile.json':JSON.stringify({strictness:3,commentTypes:['logic','style'],triggerOnUpdates:false,ignorePatterns:'dist/**\n*.gen.ts',instructions:'Monorepo using zod.',rules:[{id:'no-console',rule:'Use the logger, not console.log.',scope:['src/**'],severity:'low'}],summarySection:{included:true,collapsible:true,defaultOpen:false},labels:['ignored-unknown-key']})});
    const c=await readTrustedConfig(r.dir,r.base);expect(c.triggerOnUpdates).toBe(false);expect(c.summarySection).toEqual({included:true,collapsible:true,defaultOpen:false});
    const s=configFor(c,'src/a.ts');expect(s.threshold).toBe('high');expect(s.commentTypes).toEqual(['logic','style']);expect(s.rules.map(x=>x.id)).toEqual(['no-console']);expect(s.instructions[0].text).toContain('zod');
    expect(configFor(c,'lib/a.ts').rules).toEqual([]);expect(isIgnored(c,'dist/x.js')).toBe(true);expect(isIgnored(c,'src/a.gen.ts')).toBe(true);expect(isIgnored(c,'src/a.ts')).toBe(false)});
  it('prefers .openreview.yml over greptile.json at the root',async()=>{const r=await repo({'.openreview.yml':'commentLimit: 2\n','greptile.json':'{"commentLimit":9}'});expect((await readTrustedConfig(r.dir,r.base)).commentLimit).toBe(2)});
  it('applies nested configs from shallow to deep with relative scopes and disabled rules',async()=>{const r=await repo({
      '.openreview.yml':'rules:\n  - id: tests-required\n    rule: New exported functions need tests.\n  - id: no-any\n    rule: Avoid the any type.\n',
      'services/greptile.json':JSON.stringify({strictness:1,instructions:'Services talk to Postgres.',disabledRules:['no-any'],rules:[{id:'sql',rule:'Use parameterized SQL only.',scope:['db/**'],severity:'critical'}]}),
      'services/billing/.openreview.yml':'commentTypes: [logic]\nignorePatterns: "fixtures/**"\n'});
    const c=await readTrustedConfig(r.dir,r.base);expect(c.scopes.map(s=>s.dir)).toEqual(['services','services/billing']);
    const deep=configFor(c,'services/billing/db/q.ts');expect(deep.threshold).toBe('low');expect(deep.commentTypes).toEqual(['logic']);expect(deep.rules.map(x=>x.id)).toEqual(['tests-required']);
    const db=configFor(c,'services/db/q.ts');expect(db.rules.map(x=>x.id)).toEqual(['tests-required','sql']);expect(db.rules[1].severity).toBe('critical');expect(db.instructions.map(i=>i.scope)).toEqual(['services']);
    expect(configFor(c,'web/a.ts').rules.map(x=>x.id)).toEqual(['tests-required','no-any']);
    expect(isIgnored(c,'services/billing/fixtures/a.json')).toBe(true);expect(isIgnored(c,'fixtures/a.json')).toBe(false)});
  it('ignores configuration added by the pull request itself',async()=>{const r=await repo({'a.ts':'1\n'},{'greptile.json':'{"strictness":3}','sub/.openreview.yml':'strictness: 3\n','a.ts':'2\n'});
    const c=await readTrustedConfig(r.dir,r.base);expect(c.strictness).toBeUndefined();expect(c.scopes).toEqual([]);expect(configFor(c,'sub/a.ts').threshold).toBe('medium')});
  it('reports invalid nested configs instead of failing the review',async()=>{const r=await repo({'pkg/greptile.json':'{"strictness":7}'});const c=await readTrustedConfig(r.dir,r.base);expect(c.scopes).toEqual([]);expect(c.configWarnings[0]).toContain('pkg/greptile.json')});
  it('folds legacy pathStandards into scoped rules',()=>{const c=Config.parse({pathStandards:{'src/auth/**':'Check authorization at the server boundary.'}});expect(configFor(c,'src/auth/login.ts').rules[0].rule).toContain('authorization');expect(configFor(c,'src/ui/a.ts').rules).toEqual([])});
  it('drops ignored paths while preparing the diff',async()=>{const r=await repo({'greptile.json':'{"ignorePatterns":"gen/**"}','gen/a.ts':'1\n','src/a.ts':'1\n'},{'gen/a.ts':'2\n','src/a.ts':'2\n'});
    const files=await prepareLocal(r.dir,r.base,r.head,await readTrustedConfig(r.dir,r.base));expect(files.map(f=>f.path)).toEqual(['src/a.ts'])});
});
