import { bindings, defineConfig, defineWorker } from "cf/config";
import { cloudConsolePolicies, cloudDeployment } from "./src/lib/cloud-deployment.ts";

export default defineConfig(({ mode }) => {
  const target = cloudDeployment(mode);
  if (target.isolated) {
    return {
      accountId: "f78fa7ea6c63f95d9512053554416e32",
      worker: defineWorker({
        name: target.name,
        workersDev: true,
        entrypoint: "vinext/server/fetch-handler",
        compatibilityDate: "2026-09-01",
        compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
        assets: { notFoundHandling: "none" },
        // Independent policy and secrets. No inherited production data/AI/email bindings.
        env: {
          ASSETS: bindings.assets(),
          CLOUD_TOOLS_ACCESS_MODE: bindings.text(target.accessMode),
          ...Object.fromEntries(Object.entries(cloudConsolePolicies[target.accessMode]).map(
            ([name, value]) => [name, bindings.text(value)],
          )),
          CLOUD_TOOLS_AGENT_TOKEN: bindings.secret(),
          RABBIT_CLOUDSHELL_TOKEN: bindings.secret(),
          VAULT_AGENT_TOKEN: bindings.secret(),
        },
      }),
    };
  }
  return {
  worker: defineWorker({
    name: target.name,
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "none" },
    env: {
      CLOUD_TOOLS_ACCESS_MODE: bindings.text("local-only"),
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
      // Workers AI: makes the embeddings behind semantic search (@cf/baai/bge-base-en-v1.5).
      AI: bindings.ai(),
    },
  }),
  };
});
