import type {HTMLAttributes} from 'react';
import {clsx} from 'clsx';
export function Card({className,...props}:HTMLAttributes<HTMLDivElement>){return <div data-slot="card" className={clsx('rounded-xl border border-emerald-900/40 bg-[#121815] p-5',className)} {...props}/>}
