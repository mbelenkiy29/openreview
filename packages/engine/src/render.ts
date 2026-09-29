import type { ReviewConfig, Section } from './config.js';
import type { PrSummary, Review, ReviewedFinding, SequenceStep } from './index.js';

// Everything the model writes is untrusted. Outside code spans: escape HTML (which also blocks forged
// `<!-- openreview… -->` markers) and break @mentions so a comment cannot notify arbitrary users.
// Inside code spans HTML is not rendered, so only comment openers are broken, keeping `a < b` readable.
export function sanitize(text:unknown,max=2000){return String(text??'').slice(0,max).split(/(`+[^`\n]*?`+)/).map((part,i)=>i%2
  ?part.replace(/<!--/g,'<​!--')
  :part.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/@(?=[A-Za-z0-9_-])/g,'@​')).join('')}
const cell=(text:unknown,max=300)=>sanitize(text,max).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const code=(path:string)=>'`'+path.replace(/`/g,'')+'`';
const severityIcon:Record<string,string>={critical:'🔴',high:'🟠',medium:'🟡',low:'🔵'};

/** Deterministic 0-5 merge confidence from verified findings and coverage. */
export function prConfidence(findings:ReviewedFinding[],status:Review['status']):{score:number;reason:string}{
  const count=(s:string)=>findings.filter(f=>f.severity===s).length,critical=count('critical'),high=count('high'),medium=count('medium'),low=count('low');
  let score=5,reason='No verified issues in the reviewed changes.';
  if(critical){score=1;reason=`${critical} critical issue${critical>1?'s':''} must be fixed before merging.`}
  else if(high){score=high>1?1:2;reason=`${high} high-severity issue${high>1?'s':''} should be fixed before merging.`}
  else if(medium){score=medium>1?3:4;reason=`${medium} medium-severity issue${medium>1?'s':''} worth addressing.`}
  else if(low)reason=`Only minor (${low} low-severity) issue${low>1?'s':''}.`;
  if(status==='partial'&&score>4){score=4;reason+=' Part of the change was not reviewed; see coverage.'}
  return {score,reason};
}

/** Renders validated sequence steps as Mermaid; names and labels are reduced to characters Mermaid treats as plain text. */
export function mermaidSequence(steps:SequenceStep[]){const clean=(s:string,max:number)=>s.replace(/[;#"'`<>{}[\]\\|%]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)||'?';
  const ids=new Map<string,string>(),id=(name:string)=>{const key=clean(name,40);if(!ids.has(key))ids.set(key,`P${ids.size}`);return ids.get(key)!};
  const body=steps.map(s=>`    ${id(s.from)}->>${id(s.to)}: ${clean(s.message.replace(/:/g,' '),100)}`);
  return ['sequenceDiagram',...[...ids].map(([name,pid])=>`    participant ${pid} as ${name}`),...body].join('\n')}

function section(settings:Section,title:string,body:string){if(!settings.included||!body.trim())return '';
  return settings.collapsible?`<details${settings.defaultOpen?' open':''}>\n<summary><b>${title}</b></summary>\n\n${body}\n\n</details>`:`### ${title}\n\n${body}`}

/** Combines the previous full-PR summary with the summary of the latest push. */
export function mergeSummary(previous:PrSummary|undefined,latest:PrSummary|undefined):PrSummary|undefined{if(!previous)return latest;if(!latest)return previous;
  const files=new Map(previous.files.map(f=>[f.path,f]));for(const f of latest.files)files.set(f.path,f);
  return {overview:previous.overview,latest:latest.overview,files:[...files.values()],...(latest.sequence??previous.sequence?{sequence:latest.sequence??previous.sequence}:{})}}

export type SummaryMeta={head:string;marker:string;incremental?:boolean;comparison?:string;previous?:PrSummary};
/** Builds the PR summary comment and returns the (possibly merged) summary to store for the next incremental run. */
export function renderSummary(result:Review,config:ReviewConfig,meta:SummaryMeta):{body:string;summary?:PrSummary}{
  const summary=meta.incremental?mergeSummary(meta.previous,result.summary):result.summary,listed=[...result.findings,...result.overflow];
  const overview=summary?[sanitize(summary.overview),summary.latest&&meta.comparison?`**Latest push** (\`${meta.comparison.slice(0,8)}..${meta.head.slice(0,8)}\`): ${sanitize(summary.latest)}`:''].filter(Boolean).join('\n\n'):'';
  const {score,reason}=prConfidence(listed,result.status);
  const issues=listed.length?['| | Location | Type | Issue | Confidence |','|---|---|---|---|---|',...listed.map(f=>`| ${severityIcon[f.severity]} ${f.severity} | ${code(`${f.path}:${f.line}`)} | ${f.type} | ${cell(f.title,150)}${f.ruleId?` (rule ${code(f.ruleId)})`:''} | ${f.confidence}/5 |`)].join('\n')
    :result.status==='partial'?'Review incomplete; no findings published from the limited scope.':'No actionable findings found within the reviewed scope.';
  const counts=new Map<string,number>();for(const f of listed)counts.set(f.path,(counts.get(f.path)??0)+1);
  const files=summary?.files.length?['| File | Change | Issues |','|---|---|---|',...summary.files.map(f=>`| ${code(f.path)} | ${cell(f.change)} | ${counts.get(f.path)??0} |`)].join('\n'):'';
  const diagram=summary?.sequence?.length?'```mermaid\n'+mermaidSequence(summary.sequence)+'\n```':'';
  const parts=[`${meta.marker}\n## OpenReview · ${meta.head.slice(0,8)}`,
    section(config.summarySection,'Summary',overview),
    section(config.confidenceScore,`Confidence score: ${score}/5`,reason),
    section(config.issuesTable,'Issues',issues),
    section(config.summarySection,'Files changed',files),
    section(config.sequenceDiagram,'Sequence diagram',diagram),
    `<sub>Coverage: ${result.status}${result.coverage.length?` (${sanitize(result.coverage.join('; '),1500)})`:''}. Estimated model cost: ${result.usage.estimatedUsd===null?'unknown':`$${result.usage.estimatedUsd.toFixed(4)}`}.</sub>`];
  // The issues list must always be visible, even if the sections are turned off.
  if(!config.issuesTable.included)parts.splice(3,1,listed.length?listed.map(f=>`- **${f.severity}** ${code(`${f.path}:${f.line}`)}: ${cell(f.title,150)}`).join('\n'):issues);
  return {body:parts.filter(Boolean).join('\n\n'),...(summary?{summary}:{})};
}

function fence(text:string){const longest=Math.max(0,...(text.match(/`+/g)??[]).map(s=>s.length));return '`'.repeat(Math.max(3,longest+1))}
/** Inline review comment body with an optional GitHub suggestion block and the dedupe marker. */
export function renderFinding(f:ReviewedFinding,withSuggestion=true){
  const suggestion=withSuggestion&&f.suggestion&&!f.suggestion.code.includes('<!-- openreview')?`\n\n${fence(f.suggestion.code)}suggestion\n${f.suggestion.code}\n${fence(f.suggestion.code)}`:'';
  return `**${severityIcon[f.severity]} ${f.severity} · ${f.type}: ${sanitize(f.title,150)}**${f.ruleId?` · rule ${code(f.ruleId)}`:''}\n\nScenario: ${sanitize(f.scenario)}\n\nImpact: ${sanitize(f.impact)}\n\nEvidence: ${sanitize(f.evidence)}\n\nSuggested fix: ${sanitize(f.remediation)}${suggestion}\n\n<sub>Confidence ${f.confidence}/5</sub>\n\n<!-- openreview-finding:${f.fingerprint} -->`}

export type InlineComment={path:string;line:number;side:'RIGHT';start_line?:number;start_side?:'RIGHT';body:string};
/** GitHub review comment payload, or null when the anchor line is not an added line of the full PR diff. */
export function inlinePayload(f:ReviewedFinding,prAddedLines:number[]):InlineComment|null{if(!prAddedLines.includes(f.line))return null;
  const start=f.suggestion?.startLine??f.line,covered=!!f.suggestion&&Array.from({length:f.line-start+1},(_,i)=>start+i).every(n=>prAddedLines.includes(n));
  return {path:f.path,line:f.line,side:'RIGHT',...(covered&&start<f.line?{start_line:start,start_side:'RIGHT' as const}:{}),body:renderFinding(f,covered)}}

export const DESCRIPTION_MARKER='<!-- openreview-description -->';
/** PR body generated from the summary; only used to fill an empty description. */
export function renderDescription(summary:PrSummary){return [sanitize(summary.overview,1500),summary.files.length?`### Changes\n${summary.files.map(f=>`- ${code(f.path)}: ${cell(f.change)}`).join('\n')}`:'','<sub>Description generated by OpenReview from the diff; edit freely.</sub>',DESCRIPTION_MARKER].filter(Boolean).join('\n\n')}
