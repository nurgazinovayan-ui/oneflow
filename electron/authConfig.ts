// Supabase used to gate access to ONEFLOW behind a login screen: ONEFLOW's own self-hosted
// Supabase in Kazakhstan (api.oneflow.art, deploy/selfhost), the same backend as oneflow.art.
//
// SUPABASE_ANON_KEY is Supabase's public "anon" key — it is designed to be shipped inside
// client apps (it only allows what the project's Row Level Security policies permit) and is
// not the secret "service_role" key, which must never appear here.
//
// Until both values below are filled in, the app skips the login gate entirely and behaves
// exactly as it did before this feature existed.
export const SUPABASE_URL = 'https://api.oneflow.art';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkyMDc2OTk3LCJleHAiOjE5NDk3NTY5OTd9.TF1AYHjnOlQp9lMUSD-GDUiWkEwKtsCPLSJSjDcQ-uo';
