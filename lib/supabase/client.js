import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://effxuvviyhaksllmcrqh.supabase.co';
const supabaseAnonKey = 'sb_publishable_dPD5nnWoEAjVgoqPc0vUXg_uz0HiI9t';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
  return createClient(supabaseUrl, serviceKey);
}