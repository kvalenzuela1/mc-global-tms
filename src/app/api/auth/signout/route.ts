import { NextResponse } from 'next/server';
import { getServerSupabase } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';

export async function POST() {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', publicEnv.appUrl), { status: 303 });
}
