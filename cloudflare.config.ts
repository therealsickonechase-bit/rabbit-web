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
      DASHBOARD_ALLOWED_EMAILS: bindings.secret(),
    },
  }),
});
