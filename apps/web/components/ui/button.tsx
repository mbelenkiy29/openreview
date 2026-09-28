import type {ButtonHTMLAttributes} from 'react';
import {clsx} from 'clsx';
export function Button({className,...props}:ButtonHTMLAttributes<HTMLButtonElement>){return <button data-slot="button" className={clsx('inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:opacity-50',className)} {...props}/>}
