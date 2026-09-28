import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
export const {handlers,auth,signIn,signOut}=NextAuth({providers:[GitHub({authorization:{params:{scope:'read:user repo'}}})],callbacks:{jwt({token,account}){if(account?.access_token)token.githubToken=account.access_token;return token}}});
