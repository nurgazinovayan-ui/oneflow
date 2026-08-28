// Supabase project used to gate access to ONEFLOW behind a login screen.
//
// The admin (the app owner) creates a free project at supabase.com, then issues accounts for
// users under Authentication → Users → "Add user" in the Supabase dashboard — that dashboard
// IS the "web interface" that hands out logins/passwords. Nothing else needs to be built or
// hosted: Supabase's own hosted auth API handles the sign-in.
//
// SUPABASE_ANON_KEY is Supabase's public "anon" key — it is designed to be shipped inside
// client apps (it only allows what the project's Row Level Security policies permit) and is
// not the secret "service_role" key, which must never appear here.
//
// Until both values below are filled in, the app skips the login gate entirely and behaves
// exactly as it did before this feature existed.
export const SUPABASE_URL = 'https://ayxmfihtrsacfdhszsri.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xfd5nkUu18qvdzoo-dzhHQ_f5RKq4tS';
