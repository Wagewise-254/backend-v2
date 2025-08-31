// backend/libs/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";


const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // must be service_role key
);

export default supabaseAdmin;
