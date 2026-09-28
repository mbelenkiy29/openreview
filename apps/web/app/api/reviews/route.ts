import { auth } from '../../../auth';
import { getToken } from 'next-auth/jwt';
export async function GET(request:Request){const session=await auth();const jwt=await getToken({req:request as any,secret:process.env.AUTH_SECRET});const token=jwt?.githubToken;if(!session||typeof token!=='string')return Response.json({error:'Unauthorized'},{status:401});
  const site=process.env.CONVEX_SITE_URL,secret=process.env.WORKER_SECRET;if(!site||!secret)return Response.json({error:'Server configuration missing'},{status:503});
  const response=await fetch(`${site}/worker/recent`,{method:'POST',headers:{authorization:`Bearer ${secret}`},cache:'no-store'});if(!response.ok)return Response.json({error:'Review service unavailable'},{status:502});const jobs=await response.json() as Array<any>;
  const allowed=await Promise.all(jobs.map(async(j)=>{try{const r=await fetch(`https://api.github.com/repos/${encodeURIComponent(j.owner)}/${encodeURIComponent(j.repo)}`,{headers:{authorization:`Bearer ${token}`,'accept':'application/vnd.github+json'},cache:'no-store'});return r.ok?j:null}catch{return null}}));
  return Response.json(allowed.filter(Boolean).map(j=>({id:j._id,owner:j.owner,repo:j.repo,number:j.number,head:j.head,status:j.status,created:j.created,error:j.lastError,review:j.result?JSON.parse(j.result):null})),{headers:{'cache-control':'private, no-store'}});
}
