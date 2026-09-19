import { appendFileSync, readFileSync } from 'node:fs'

const vars = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
if (!vars.BROWSERBASE_API_KEY) throw new Error('BROWSERBASE_API_KEY is missing from .dev.vars')
const response = await fetch('https://api.browserbase.com/v1/projects', { headers: { 'X-BB-API-Key': vars.BROWSERBASE_API_KEY } })
if (!response.ok) throw new Error('Unable to list Browserbase projects')
const payload = await response.json()
const projects = payload.projects ?? payload.data ?? payload
if (!Array.isArray(projects) || projects.length !== 1) {
  console.log(JSON.stringify((Array.isArray(projects) ? projects : []).map((project) => ({ id: project.id, name: project.name }))))
  throw new Error('Expected exactly one accessible Browserbase project. Set BROWSERBASE_PROJECT_ID manually when multiple projects exist.')
}
appendFileSync('.dev.vars', `\nBROWSERBASE_PROJECT_ID=${projects[0].id}\n`)
console.log('Configured the only accessible Browserbase project in ignored .dev.vars.')
