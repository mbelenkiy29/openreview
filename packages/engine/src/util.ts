import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export async function git(repo:string,...args:string[]){return (await exec('git',['-c','core.hooksPath=/dev/null','-c','filter.lfs.required=false','-c','filter.lfs.smudge=','-C',repo,...args],{maxBuffer:20_000_000,timeout:30000})).stdout}
export function pathMatches(path:string,pattern:string){const regex='^'+pattern.split('**').map(part=>part.split('*').map(s=>s.replace(/[|\\{}()[\]^$+?.]/g,'\\$&')).join('[^/]*')).join('.*')+'$';return new RegExp(regex).test(path)}
