import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();

  // Redirect against the *request* origin rather than NEXT_PUBLIC_APP_URL.
  // publicEnv.appUrl falls back to http://localhost:3000, so any deployment
  // where that variable is unset would sign users out to localhost. Preview
  // deployments also get a unique URL each time, which a single configured
  // value can never match. request.url is always correct.
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
