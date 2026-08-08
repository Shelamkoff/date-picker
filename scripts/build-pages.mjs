import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, '_site')
await rm(out, { recursive: true, force: true })
await mkdir(resolve(out, 'assets/date-picker'), { recursive: true })
await cp(resolve(root, 'demo'), out, { recursive: true })
await cp(resolve(root, 'packages/date-picker/dist'), resolve(out, 'assets/date-picker'), { recursive: true })
await cp(resolve(root, 'packages/date-picker/src/style.css'), resolve(out, 'assets/date-picker/style.css'))
await writeFile(resolve(out, '.nojekyll'), '')
console.log(`GitHub Pages site built at ${out}`)
