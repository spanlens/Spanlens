import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Put a fake `@spanlens/sdk` with the given version into `<root>/node_modules`. */
export function writeInstalledSdk(root: string, version: string): void {
  const dir = join(root, 'node_modules', '@spanlens', 'sdk')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@spanlens/sdk', version }))
}

/** Declare `@spanlens/sdk` in the project's package.json. */
export function declareSdkDependency(root: string, range = '^0.17.0'): void {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, dependencies: { '@spanlens/sdk': range } }),
  )
}
