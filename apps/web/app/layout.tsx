import './style.css';
export const metadata={title:'OpenReview',description:'Self hosted pull request reviews'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
