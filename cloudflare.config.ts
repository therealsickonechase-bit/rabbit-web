import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "rabbit-web",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      ASSETS: bindings.assets(),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      INGEST_SHARED_SECRET: bindings.secret(),
      KEY_ENCRYPTION_SECRET: bindings.secret(),
      SEND_EMAIL_HOOK_SECRET: bindings.secret(),
      // Encrypted contact records: public key (cannot decrypt) and the lookup-hash key. See scripts/contact-keys.mjs.
      CONTACT_PUBLIC_KEY: bindings.secret(),
      CONTACT_HASH_KEY: bindings.secret(),
      // Auth emails go out through Cloudflare Email Sending, from this one address only.
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: ['accounts@mail.rabbitsoftware.io'] }),
      APP_URL: bindings.text('https://app.rabbitsoftware.io'),
    },
  }),
});
