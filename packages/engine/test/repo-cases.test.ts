import {describe,it,expect} from 'vitest';
import {Config,prepareLocal} from '../src/index.js';
import {evaluateRepo,evaluateRetrieval,expectedLines,materialize} from '../src/evaluation.js';
import {repoCases} from '../fixtures/repo-cases.js';

describe('repository evaluation cases',()=>{
  it('has at least 50 cases across languages with unique ids',()=>{expect(repoCases.length).toBeGreaterThanOrEqual(50);expect(new Set(repoCases.map(c=>c.id)).size).toBe(repoCases.length);expect(new Set(repoCases.map(c=>c.language)).size).toBeGreaterThanOrEqual(10)});
  it('labels resolve to added lines and referenced files exist',async()=>{for(const c of repoCases){const m=await materialize(c);try{
    const files=await prepareLocal(m.dir,m.base,m.head,Config.parse({}));expect(()=>expectedLines(c,files),c.id).not.toThrow();
    for(const p of [...c.context,...(c.decoys??[])])expect(c.head[p]??c.base[p],`${c.id} ${p}`).toBeTypeOf('string');
  }finally{await m.cleanup()}}},60000);
  it('graph retrieval finds the required context without decoys and beats grep',async()=>{const report=await evaluateRetrieval(repoCases);const graph=report.summary.graph,grep=report.summary.grep;
    const misses=report.cases.filter(x=>x.retriever==='graph'&&(x.recall<1||x.decoyHits.length)).map(x=>`${x.id}: missing ${x.missing.join(',')} decoys ${x.decoyHits.join(',')}`);
    expect(misses).toEqual([]);expect(graph.meanRecall).toBeGreaterThan(grep.meanRecall);expect(graph.decoyHits).toBeLessThanOrEqual(grep.decoyHits)},120000);
  it('scores a full review run with a mock model',async()=>{const c=repoCases.find(x=>x.id==='py-none-deref')!;let calls=0;
    const finding={path:'app/service.py',line:8,severity:'high',title:'Unchecked None from get_user',scenario:'An unknown uid reaches email_for',impact:'TypeError crashes the request',evidence:'get_user returns None when missing',remediation:'Handle the missing user before indexing'};
    const report=await evaluateRepo([c],{analyze:async()=>({findings:++calls===1?{findings:[finding]}:{decisions:[{index:0,retain:true,reason:'repo.py documents None',observedCode:"get_user(uid)['email']"}]},usage:{inputTokens:1,outputTokens:1,estimatedUsd:0.001}})});
    expect(report.summary.recall).toBe(1);expect(report.summary.precision).toBe(1)},30000);
});
