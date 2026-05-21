import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://effxuvviyhaksllmcrqh.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey || '');

export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createClient(supabaseUrl, serviceKey || supabaseAnonKey || '');
}