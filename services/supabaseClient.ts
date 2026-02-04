import { createClient } from '@supabase/supabase-js';

// Ensure these environment variables are set in your execution environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY; // This should be the anon public key

if (!supabaseUrl || !supabaseKey) {
  console.warn("Supabase credentials missing. App will fail to save data.");
}

// Fallback to a valid URL format to prevent the "supabaseUrl is required" crash on startup.
// Operations will fail at runtime if these are placeholders, which is handled by error blocks.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseKey || 'placeholder-key'
);