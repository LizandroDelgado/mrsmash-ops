import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://effxuvviyhaksllmcrqh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmZnh1dnZpeWhha3NsbG1jcnFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5OTMwMjIsImV4cCI6MjA5NDU2OTAyMn0.fXt2ql0o58IEXGCP86oM5VKizRsWgwjP4l7UCkkktpk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
  return createClient(supabaseUrl, serviceKey);
}