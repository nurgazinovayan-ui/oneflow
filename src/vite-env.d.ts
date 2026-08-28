/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEB_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_LEMONSQUEEZY_CHECKOUT_URL?: string;
  readonly VITE_YANDEX_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
