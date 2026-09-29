import {describe,it,expect} from 'vitest';
import {Config,parseModelJson,review,type FileChange,type ModelAdapter} from '../src/index.js';

const file:FileChange={path:'src/pay.ts',patch:'@@ -1,2 +1,4 @@\n export function pay(a: number) {\n+  const fee = a * 0.1;\n+  return charge(a + fee);\n }',addedLines:[2,3],before:'export function pay(a: number) {\n}',after:'export function pay(a: number) {\n  const fee = a * 0.1;\n  return charge(a + fee);\n}'};
const base={path:'src/pay.ts',line:3,severity:'high',title:'Fee charged twice on retry',scenario:'A retried payment calls pay again',impact:'Customers are overcharged',evidence:'charge is called with a + fee',remediation:'Make the charge idempotent'};
// First call answers discovery, second answers verification.
function mock(discovery:unknown,decisions:unknown[]):ModelAdapter{let n=0;return {analyze:async()=>({findings:++n===1?discovery:{decisions},usage:{inputTokens:1,outputTokens:1,estimatedUsd:0}})}}
const keep=(index:number,extra:object={})=>({index,retain:true,reason:'Shown by the changed line',observedCode:'return charge(a + fee);',...extra});

describe('review output',()=>{
  it('keeps type, rule and a valid suggestion; applies rule severity and returns the summary',async()=>{
    const config=Config.parse({rules:[{id:'idempotent',rule:'Payment calls must be idempotent.',severity:'critical'}]});
    const r=await review([file],mock({summary:{overview:'Adds a 10% fee to payments.',files:[{path:'src/pay.ts',change:'Adds fee'},{path:'nope.ts',change:'x'}],sequence:{steps:[{from:'API',to:'Payments',message:'pay'},{from:'Payments',to:'Stripe',message:'charge'}]}},
      findings:[{...base,type:'logic',ruleId:'idempotent',suggestion:{startLine:3,code:'  return chargeOnce(a + fee);'}}]},[keep(0,{confidence:5})]),config);
    expect(r.findings[0]).toMatchObject({type:'logic',ruleId:'idempotent',severity:'critical',confidence:5,suggestion:{startLine:3,code:'  return chargeOnce(a + fee);'}});
    expect(r.summary).toEqual({overview:'Adds a 10% fee to payments.',files:[{path:'src/pay.ts',change:'Adds fee'}],sequence:[{from:'API',to:'Payments',message:'pay'},{from:'Payments',to:'Stripe',message:'charge'}]})});
  it('filters disabled comment types and strips unknown rule ids',async()=>{
    const r=await review([file],mock({findings:[{...base,type:'style',title:'Prefer a named constant'},{...base,ruleId:'made-up'}]},[keep(0)]),Config.parse({}));
    expect(r.rejected.some(x=>x.reason.includes('style disabled'))).toBe(true);expect(r.findings).toHaveLength(1);expect(r.findings[0].ruleId).toBeUndefined();expect(r.summary).toBeUndefined()});
  it('drops suggestions that touch unchanged lines, do nothing, or are rejected by the verifier',async()=>{
    const cases=[{startLine:1,code:'x'},{startLine:3,code:'  return charge(a + fee);'},{startLine:2,code:'  const fee = a * 0.2;\n  return charge(a + fee);'}];
    for(const [i,suggestion] of cases.entries()){const r=await review([file],mock({findings:[{...base,suggestion}]},[keep(0,i===2?{suggestionValid:false}:{})]),Config.parse({}));
      expect(r.findings).toHaveLength(1);expect(r.findings[0].suggestion,`case ${i}`).toBeUndefined()}});
  it('maps strictness to the severity threshold',async()=>{const r=await review([file],mock({findings:[{...base,severity:'medium'}]},[keep(0)]),Config.parse({strictness:3}));expect(r.findings).toEqual([]);expect(r.rejected[0].reason).toBe('Below severity threshold')});
  it('rejects findings below the minimum verifier confidence',async()=>{const r=await review([file],mock({findings:[base]},[keep(0,{confidence:2})]),Config.parse({}));expect(r.findings).toEqual([]);expect(r.rejected[0].reason).toContain('confidence 2')});
  it('keeps the summary when there are no findings and tolerates fenced JSON',async()=>{const r=await review([file],mock('```json\n{"summary":{"overview":"Adds a fee."},"findings":[]}\n```',[]),Config.parse({}));expect(r.summary?.overview).toBe('Adds a fee.');expect(r.findings).toEqual([])});
  it('notes unsupported cross-repository context without marking coverage partial',async()=>{const r=await review([file],mock({findings:[]},[]),Config.parse({context:{maxFiles:60,maxBytesPerFile:60000,maxInputTokens:24000,maxOutputTokens:2500,repos:['acme/shared']}}));expect(r.coverage.join(' ')).toContain('context.repos');expect(r.status).toBe('complete')});
  it('parses model JSON wrapped in prose',()=>expect(parseModelJson('Here you go: {"findings":[]} thanks')).toEqual({findings:[]}));
});
