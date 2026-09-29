import {performance} from 'node:perf_hooks';
import {Config,review,type FileChange,type ModelAdapter,type ReviewConfig} from './index.js';
export type Case={id:string;split:'development'|'heldout';category:string;files:FileChange[];expected:{path:string;line:number}[]};
export type CaseScore={id:string;split:string;category:string;truePositive:number;falsePositive:number;missed:number;cleanFalsePositive:boolean;latencyMs:number;estimatedUsd:number|null;status:string};
export async function evaluate(cases:Case[],model:ModelAdapter,config:ReviewConfig=Config.parse({})){const results:CaseScore[]=[];
  for(const c of cases){const start=performance.now(),r=await review(c.files,model,config);const expected=new Set(c.expected.map(f=>`${f.path}:${f.line}`)),actual=new Set(r.findings.map(f=>`${f.path}:${f.line}`));const truePositive=[...actual].filter(x=>expected.has(x)).length;
    results.push({id:c.id,split:c.split,category:c.category,truePositive,falsePositive:actual.size-truePositive,missed:expected.size-truePositive,cleanFalsePositive:!expected.size&&actual.size>0,latencyMs:Math.round(performance.now()-start),estimatedUsd:r.usage.estimatedUsd,status:r.status});
  }
  const tp=results.reduce((n,x)=>n+x.truePositive,0),fp=results.reduce((n,x)=>n+x.falsePositive,0),fn=results.reduce((n,x)=>n+x.missed,0),priced=results.every(x=>x.estimatedUsd!==null),cost=priced?results.reduce((n,x)=>n+(x.estimatedUsd??0),0):null;
  return {labelStatus:'seeded fixtures; human labels pending',cases:results,summary:{precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,cleanFalsePositives:results.filter(x=>x.cleanFalsePositive).length,latencyMs:results.reduce((n,x)=>n+x.latencyMs,0),estimatedUsd:cost,costPerCorrectFinding:cost!==null&&tp?cost/tp:null}};
}
