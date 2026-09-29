import {it,expect} from 'vitest';
import {evaluate,type Case} from '../src/evaluation.js';
import {Config} from '../src/index.js';
it('scores clean false positives and correct diff locations on the same cases',async()=>{const f={path:'a.ts',patch:'@@ -1 +1 @@\n-old\n+new',addedLines:[1],before:'old',after:'new'};const cases:Case[]=[{id:'bug',split:'development',category:'auth',files:[f],expected:[{path:'a.ts',line:1}]},{id:'clean',split:'heldout',category:'clean',files:[f],expected:[]}];let calls=0;const finding={path:'a.ts',line:1,severity:'high',title:'Missing auth guard',scenario:'An anonymous caller invokes this',impact:'Private data becomes visible',evidence:'The added branch bypasses validation',remediation:'Check the access token first'};
  const report=await evaluate(cases,{analyze:async()=>({findings:++calls%2?{findings:[finding]}:{decisions:[{index:0,retain:true,reason:'Visible added behavior',observedCode:'new'}]},usage:{inputTokens:10,outputTokens:10,estimatedUsd:0.01}})},Config.parse({}));
  expect(report.summary.precision).toBe(0.5);expect(report.summary.recall).toBe(1);expect(report.summary.cleanFalsePositives).toBe(1);expect(report.labelStatus).toContain('human labels pending');
});
