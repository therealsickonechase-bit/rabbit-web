// Runs after `npm install` (postinstall). Re-creates node_modules/eslint-plugin-react/docs/rules/*.md from the notes in the owner's
// Obsidian vault, so the plugin README's links to those pages open. Purely local convenience: it does nothing (exit 0, no output) when the
// vault or the plugin is not there, so CI and Cloudflare builds are unaffected. Never fails an install.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

try {
  const src = process.env.RABBITOS_VAULT ? join(process.env.RABBITOS_VAULT, 'Reference', 'ESLint rules') : join(homedir(), 'Documents', 'RabbitOS Vault', 'Reference', 'ESLint rules')
  const plugin = join(process.cwd(), 'node_modules', 'eslint-plugin-react')
  if (existsSync(src) && existsSync(plugin)) {
    const dst = join(plugin, 'docs', 'rules')
    mkdirSync(dst, { recursive: true })
    let n = 0
    for (const f of readdirSync(src).filter((x) => x.endsWith('.md'))) {
      const text = readFileSync(join(src, f), 'utf8').split('\r\n').join('\n')
        .replace(/<!-- auto-links -->[\s\S]*?<!-- \/auto-links -->\n?/, '')
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace('Up: [[ESLint rules]]', 'Back to the [plugin README](../../README.md). Notes written for the RabbitOS Vault, not shipped with the package.')
        .replace('The package does not ship the docs page its README links to.', '')
      writeFileSync(join(dst, f), text.trimEnd() + '\n')
      n++
    }
    console.log(`restore-eslint-docs: wrote ${n} rule pages`)
  }
} catch (e) {
  console.warn('restore-eslint-docs: skipped (' + e.message + ')')
}
