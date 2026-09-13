// Drive the app in headless Chrome over CDP: new game, sim a couple of months, screenshot the
// roster, the dressing room and a player card. Node has WebSocket built in.
//
//   node experiments/drive.mjs [port] [out-dir]

const PORT = process.argv[2] ?? '9297'
const OUT = process.argv[3] ?? '/tmp/morale-shots'
const APP = process.env.APP_URL ?? 'http://localhost:5183/'

const { writeFileSync, mkdirSync } = await import('node:fs')
mkdirSync(OUT, { recursive: true })

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
let page = targets.find((t) => t.type === 'page')
if (!page) {
  page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`)).json()
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const waiting = new Map()
const logs = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && waiting.has(m.id)) {
    waiting.get(m.id)(m)
    waiting.delete(m.id)
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`)
  if (m.method === 'Runtime.exceptionThrown')
    logs.push(
      `exception: ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`,
    )
})
await new Promise((r) => ws.addEventListener('open', r))

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id
    waiting.set(n, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id: n, method, params }))
  })

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${expr} })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.result))
  return r.result.value
}

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'))
  console.log(`shot ${name}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', { url: APP })
await sleep(2500)

// Start a 2003-04 save with the Spurs.
console.log(
  await evaluate(`
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const sel = document.querySelector('select')
  if (sel) {
    sel.value = '2004'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await new Promise(r => setTimeout(r, 1200))
  const teams = [...document.querySelectorAll('button')].filter(b => /SAS|Spurs/.test(b.textContent))
  if (teams[0]) click(teams[0])
  await new Promise(r => setTimeout(r, 600))
  const start = [...document.querySelectorAll('button')].find(b => /start|begin|new dynasty|take/i.test(b.textContent))
  click(start)
  return start ? start.textContent : 'no start button: ' + [...document.querySelectorAll('button')].map(b=>b.textContent).slice(0,20).join(' | ')
`),
)
await sleep(4000)
await shot('01-after-start')

// Sim a couple of months so minutes, records and morale are all real.
const clickText = (re, wait) =>
  evaluate(`
  const b = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent.trim()))
  if (!b) return 'missing'
  b.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, ${wait}))
  return b.textContent.trim()
`)

for (let i = 0; i < 3; i++) console.log('simmed', await clickText('/^Sim month$/', 12000))
await sleep(3000)

console.log('nav', await clickText('/^Roster$/', 2500))
await shot('02-roster')

// Sort by mood so the unhappiest man is at the top, then open his card.
console.log(
  await evaluate(`
  const th = [...document.querySelectorAll('th')].find(t => /Mood/.test(t.textContent))
  if (!th) return 'no Mood column: ' + [...document.querySelectorAll('th')].map(t=>t.textContent).join(',')
  th.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 600))
  return 'sorted'
`),
)
await shot('03-roster-by-mood')

console.log(
  await evaluate(`
  const room = document.querySelector('.mr-room')
  return room ? room.innerText.slice(0, 400) : 'NO DRESSING ROOM PANEL'
`),
)

console.log(
  await evaluate(`
  const rows = [...document.querySelectorAll('tbody tr')]
  if (!rows.length) return 'no rows'
  rows[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 700))
  const panel = [...document.querySelectorAll('.panel')].find(p => /Dressing room/.test(p.textContent))
  return panel ? panel.innerText.slice(0, 500) : 'NO CARD PANEL'
`),
)
await shot('04-player-card')

// The inbox: the rumour mill should now be quoting the number, not guessing at it.
await evaluate(`
  const close = [...document.querySelectorAll('button')].find(b => /Close/.test(b.textContent))
  if (close) close.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 400))
  return 'closed'
`)
console.log('nav', await clickText('/^Home$/', 2000))
console.log(
  await evaluate(`
  const t = document.body.innerText
  const hits = t.split('\\n').filter(l => /unhappy|wants out|dressing room is/i.test(l))
  return hits.length ? hits.slice(0, 6).join(' // ') : 'no morale news on this page'
`),
)
await shot('05-inbox')

console.log('console:', logs.length ? logs.join('\n') : 'clean')
ws.close()
process.exit(0)
