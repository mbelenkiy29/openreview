import Link from 'next/link';
import { Playground } from './playground';

export const metadata={title:'Playground · OpenReview'};
export default function PlaygroundPage(){return <main><header className="top"><Link href="/" className="brand"><span className="mark">◈</span> OpenReview <span className="badge">ALPHA</span></Link></header><Playground/><footer>OpenReview · Advisory reviews · Apache 2.0</footer></main>}
