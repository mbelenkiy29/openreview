import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Config,configuredModel,gatherContext,git,prepareLocal,readTrustedConfig,review } from '@openreview/engine';
import { Octokit } from '@octokit/rest';
import { evaluate,type Case } from '../../../packages/engine/src/evaluation.js';

async function main(){const [command,...args]=process.argv.slice(2);if(command==='eval'){const cases=JSON.parse(await readFile(new URL('../../../packages/engine/fixtures/cases.json',import.meta.url),'utf8')) as Case[];const report=await evaluate(cases,configuredModel());const output=JSON.stringify(report,null,2);const ji=args.indexOf('--json');if(ji>=0)await writeFile(resolve(args[ji+1]),output);console.log(output);return}
  if(command!=='local'&&command!=='pr')throw new Error('Usage: pnpm review local <base> [head] [--json file] [--markdown file] | pnpm review pr <owner/repo> <number> [--json file]');
  let repo=process.cwd(),base=args[0],head=args[1]&&!args[1].startsWith('--')?args[1]:'HEAD';
  if(command==='pr'){const [owner,name]=args[0].split('/');const num=Number(args[1]);if(!owner||!name||!Number.isInteger(num))throw new Error('Expected owner/repo and PR number');const api=new Octokit({auth:process.env.GITHUB_TOKEN});const pr=(await api.pulls.get({owner,repo:name,pull_number:num})).data;repo=process.cwd();base=pr.base.sha;head=pr.head.sha;console.error(`Dry run ${owner}/${name}#${num}; local checkout must contain both commits`)}
  if(!base)throw new Error('Base revision required');repo=(await git(repo,'rev-parse','--show-toplevel')).trim();const config=Config.parse(await readTrustedConfig(repo,base));const files=await prepareLocal(repo,base,head,config);const context=await gatherContext(repo,head,files,config);const result=await review(files,configuredModel(config.mode),config,context);
  const md=`# OpenReview\n\n${result.findings.length?result.findings.map(f=>`- **${f.severity}** ${f.path}:${f.line} — ${f.title}\n  - Scenario: ${f.scenario}\n  - Impact: ${f.impact}\n  - Evidence: ${f.evidence}\n  - Fix: ${f.remediation}`).join('\n'):'No actionable findings found within the reviewed scope.'}\n\nCoverage: ${result.status}; ${result.coverage.join('; ')||'selected files'}\nUsage: ${JSON.stringify(result.usage)}\n`;
  const ji=args.indexOf('--json'),mi=args.indexOf('--markdown');if(ji>=0)await writeFile(resolve(args[ji+1]),JSON.stringify(result,null,2));if(mi>=0)await writeFile(resolve(args[mi+1]),md);process.stdout.write(md);
}
main().catch(e=>{console.error(e);process.exitCode=1});
