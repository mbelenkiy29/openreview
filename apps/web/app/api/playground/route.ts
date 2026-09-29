import { getToken } from 'next-auth/jwt';
import { auth } from '../../../auth';
import { parsePrUrl, PlaygroundError } from '../../../lib/github';
import { capabilities, runPlayground, type Mode } from '../../../lib/playground';
import { sampleResult } from '../../../lib/sample';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;

/** The signed-in user's GitHub token, when sign-in is configured and the user has a session. */
async function userToken(request:Request):Promise<string|undefined>{if(!capabilities().auth)return undefined;
  try{const session=await auth();if(!session)return undefined;const jwt=await getToken({req:request as any,secret:process.env.AUTH_SECRET});return typeof jwt?.githubToken==='string'?jwt.githubToken:undefined}catch{return undefined}}

export async function GET(request:Request){const url=new URL(request.url);
  if(url.searchParams.has('sample'))return Response.json(sampleResult());
  return Response.json({...capabilities(),signedIn:!!(await userToken(request))});
}

export async function POST(request:Request){
  try{const body=await request.json().catch(()=>({})) as {url?:unknown;mode?:unknown};const mode:Mode=body.mode==='review'?'review':'context';
    const ref=parsePrUrl(String(body.url??'')),caps=capabilities(),user=await userToken(request);
    // A full review spends model budget, so it requires a signed-in user unless the operator explicitly opens it.
    if(mode==='review'&&!user&&!caps.anonymousReview)throw new PlaygroundError(caps.auth?'Sign in with GitHub to run a full review.':'Full review requires GitHub sign-in (AUTH_* variables) or PLAYGROUND_ALLOW_ANONYMOUS_REVIEW=true.',401);
    return Response.json(await runPlayground(ref,mode,user??process.env.PLAYGROUND_GITHUB_TOKEN,caps));
  }catch(e){const status=e instanceof PlaygroundError?e.status:500;if(status===500)console.error('playground failed',e);
    return Response.json({error:e instanceof Error?e.message.slice(0,500):'Playground failed'},{status})}
}
