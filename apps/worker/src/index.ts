import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { App } from '@octokit/app';
import { configuredModel,prepareLocal,readTrustedConfig,review } from '@openreview/engine';
const exec=promisify(execFile),site=process.env.CONVEX_SITE_URL,secret=process.env.WORKER_SECRET;
if(!site||!secret)throw Error('CONVEX_SITE_URL and WORKER_SECRET required');
async function call(path:string,payload:object={}){const r=await fetch(`${site}/worker/${path}`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify(payload)});if(!r.ok)throw Error(`Worker API ${path}: ${r.status}`);return r.json()}
async function processJob(j:any){const app=new App({appId:process.env.GITHUB_APP_ID!,privateKey:Buffer.from(process.env.GITHUB_PRIVATE_KEY_BASE64!,'base64').toString()});const octokit=await app.getInstallationOctokit(j.installation);const dir=await mkdtemp(join(tmpdir(),'openreview-'));
  try{const pr=(await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{owner:j.owner,repo:j.repo,pull_number:Number(j.number)})).data;if(pr.head.sha!==j.head)return;
    const token=(await octokit.request('POST /app/installations/{installation_id}/access_tokens',{installation_id:j.installation,repository_ids:[Number(pr.base.repo.id)]})).data.token;
    // Git receives the token via environment config rather than command arguments or remote URL.
    const env={...process.env,GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null',GIT_CONFIG_KEY_1:'protocol.file.allow',GIT_CONFIG_VALUE_1:'never',GIT_CONFIG_KEY_2:'filter.lfs.smudge',GIT_CONFIG_VALUE_2:'',GIT_CONFIG_KEY_3:'http.https://github.com/.extraheader',GIT_CONFIG_VALUE_3:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`};
    const run=async(...args:string[])=>exec('git',args,{cwd:dir,env,timeout:120000,maxBuffer:10_000_000});
    await run('init','-q');await run('remote','add','origin',`https://github.com/${encodeURIComponent(j.owner)}/${encodeURIComponent(j.repo)}.git`);
    await run('fetch','--no-tags','--no-recurse-submodules','--depth=1','origin',j.base,j.head);
    const config=await readTrustedConfig(dir,j.base);const files=await prepareLocal(dir,j.base,j.head,config);
    const inputPrice=Number(process.env.MODEL_INPUT_USD_PER_MILLION),outputPrice=Number(process.env.MODEL_OUTPUT_USD_PER_MILLION);
    if(!Number.isFinite(inputPrice)||!Number.isFinite(outputPrice)||inputPrice<0||outputPrice<0)throw Error('Set valid MODEL_INPUT_USD_PER_MILLION and MODEL_OUTPUT_USD_PER_MILLION before processing jobs');
    const amount=(config.context.maxInputTokens*inputPrice+config.context.maxOutputTokens*outputPrice)/1_000_000;
    const reserved=await call('reserve',{id:j._id,fence:j.fence,amount,reviewLimit:Math.min(config.budgetUsd,Number(process.env.SERVER_MAX_REVIEW_USD??1)),monthlyLimit:Number(process.env.SERVER_MONTHLY_USD??20)});
    let result:Awaited<ReturnType<typeof review>>|undefined;
    if(!reserved)result={findings:[],rejected:[],coverage:['Budget limit reached before model call'],usage:{inputTokens:0,outputTokens:0,estimatedUsd:0},status:'partial'};
    else try{result=await review(files,configuredModel(),config)}finally{await call('settle',{id:j._id,amount,actual:result?.usage.estimatedUsd??amount})}
    if(!result)throw Error('Review produced no result');
    if(!(await call('heartbeat',{id:j._id,fence:j.fence})))return;
    const latest=(await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{owner:j.owner,repo:j.repo,pull_number:Number(j.number)})).data;if(latest.head.sha!==j.head)return;
    if(!(await call('active',{id:j._id,fence:j.fence})))return;
    const marker=`<!-- openreview:${j.installation}:${j.owner}/${j.repo}:${j.number} -->`;const body=`${marker}\n## OpenReview · ${j.head.slice(0,8)}\n${result.findings.length?result.findings.map(f=>`- **${f.severity}** ${f.path}:${f.line}: ${f.title} — ${f.scenario}`).join('\n'):result.status==='partial'?'Review incomplete; no findings published from the limited scope.':'No actionable findings found within the reviewed scope.'}\n\nCoverage: ${result.status}${result.coverage.length?` (${result.coverage.join('; ')})`:''}. Estimated model cost: ${result.usage.estimatedUsd===null?'unknown':`$${result.usage.estimatedUsd.toFixed(4)}`}.`;
    const comments=(await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments',{owner:j.owner,repo:j.repo,issue_number:Number(j.number),per_page:100})).data;const old=comments.find(c=>c.body?.includes(marker));
    let summaryId:number;if(old){await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',{owner:j.owner,repo:j.repo,comment_id:Number(old.id),body});summaryId=Number(old.id)}else{summaryId=(await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments',{owner:j.owner,repo:j.repo,issue_number:Number(j.number),body})).data.id as number}
    const inline=result.findings.filter(f=>files.some(x=>x.path===f.path&&x.addedLines.includes(f.line))).map(f=>({path:f.path,line:f.line,side:'RIGHT' as const,body:`**${f.severity}: ${f.title}**\n\nScenario: ${f.scenario}\n\nImpact: ${f.impact}\n\nEvidence: ${f.evidence}\n\nSuggested fix: ${f.remediation}\n\n<!-- openreview-finding:${f.fingerprint} -->`}));
    const prior=(await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments',{owner:j.owner,repo:j.repo,pull_number:Number(j.number),per_page:100})).data;
    const newInline=inline.filter(c=>!prior.some(p=>p.body?.includes(c.body.match(/openreview-finding:[a-f0-9]+/)?.[0]??'impossible')));
    if(newInline.length&&await call('active',{id:j._id,fence:j.fence})){await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',{owner:j.owner,repo:j.repo,pull_number:Number(j.number),commit_id:j.head,event:'COMMENT',body:'OpenReview findings',comments:newInline})}
    await call('finish',{id:j._id,fence:j.fence,result:JSON.stringify(result),summaryId});
  }finally{await rm(dir,{recursive:true,force:true})}}
async function main(){while(true){try{const job=await call('claim');if(job){try{await processJob(job)}catch(e){console.error('Job failed',String(e));await call('fail',{id:job._id,fence:job.fence,message:String(e)})}}else await new Promise(r=>setTimeout(r,4000))}catch(e){console.error(String(e));await new Promise(r=>setTimeout(r,10000))}}}main();
