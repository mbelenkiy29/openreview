import {auth} from '../../../auth';
import {getToken} from 'next-auth/jwt';
export async function POST(request:Request){const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
  const session=await auth(),jwt=await getToken({req:request as any,secret:process.env.AUTH_SECRET});if(!session||typeof jwt?.githubToken!=='string'||!jwt.sub)return Response.json({error:'Unauthorized'},{status:401});
  let data:any;try{data=await request.json()}catch{return Response.json({error:'Invalid JSON'},{status:400})}if(!data||typeof data.id!=='string'||typeof data.fingerprint!=='string'||!['useful','incorrect','already_handled'].includes(data.kind))return Response.json({error:'Invalid feedback'},{status:400});
  const site=process.env.CONVEX_SITE_URL,secret=process.env.WORKER_SECRET;if(!site||!secret)return Response.json({error:'Service unavailable'},{status:503});
  const list=await fetch(`${site}/worker/recent`,{method:'POST',headers:{authorization:`Bearer ${secret}`},cache:'no-store'});if(!list.ok)return Response.json({error:'Service unavailable'},{status:502});const jobs=await list.json() as any[];const job=jobs.find(j=>j._id===data.id);if(!job)return Response.json({error:'Review not found'},{status:404});
  const access=await fetch(`https://api.github.com/repos/${encodeURIComponent(job.owner)}/${encodeURIComponent(job.repo)}`,{headers:{authorization:`Bearer ${jwt.githubToken}`,'accept':'application/vnd.github+json'},cache:'no-store'});if(!access.ok)return Response.json({error:'Repository access denied'},{status:403});
  const r=await fetch(`${site}/worker/feedback`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({id:data.id,fingerprint:data.fingerprint,kind:data.kind,user:jwt.sub})});return Response.json({saved:r.ok&&await r.json()});
}
