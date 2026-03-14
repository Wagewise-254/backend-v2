// backend/libs/supabaseClient.js
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY; // Try anon key first

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase URL or Key is missing from .env file.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Test the connection
supabase.from('payroll_runs').select('count', { count: 'exact', head: true })
  .then(({ error }) => {
    if (error) {
      console.error('Supabase connection test failed:', error.message);
    } else {
      console.log('Supabase connection successful');
    }
  });

export default supabase;