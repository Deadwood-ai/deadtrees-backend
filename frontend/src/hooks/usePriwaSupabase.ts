import { createClient } from "@supabase/supabase-js";

import { Settings } from "../config";

export const isPriwaSupabaseConfigured = Boolean(
  Settings.PRIWA_SUPABASE_URL && Settings.PRIWA_SUPABASE_ANON_KEY,
);

export const priwaSupabase = isPriwaSupabaseConfigured
  ? createClient(Settings.PRIWA_SUPABASE_URL, Settings.PRIWA_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      storageKey: "deadtrees-priwa-preview-auth",
    },
  })
  : null;
