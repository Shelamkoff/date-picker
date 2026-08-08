import { DatePicker } from './assets/date-picker/index.js'

const byId = id => document.getElementById(id)
let globalLight = false
const pickerHosts = []
function syncHostTheme(){ for (const host of pickerHosts) host.classList.toggle('sdp-theme-light', globalLight) }
function formatOutput(value){ return value ? `${value.toLocaleString()} · ${value.toISOString()}` : 'null' }

const heroHost = byId('hero-picker')
pickerHosts.push(heroHost)
new DatePicker(heroHost, {
  value: new Date(), enableTime:true, clearable:true, showNow:true, minuteStep:5,
  ariaLabel:'Hero date and time', onChange(value){ byId('hero-value').textContent = formatOutput(value) },
})
byId('hero-value').textContent = formatOutput(new Date())

let playground = null
let playgroundValue = null
const playgroundHost = byId('playground-picker')
pickerHosts.push(playgroundHost)
function mountPlayground(){
  playground?.destroy()
  playgroundHost.replaceChildren()
  playground = new DatePicker(playgroundHost, {
    value: playgroundValue,
    enableTime: byId('opt-time').checked,
    clearable: byId('opt-clear').checked,
    showNow: byId('opt-now').checked,
    loop: byId('opt-loop').checked,
    minuteStep: Number(byId('opt-step').value),
    ariaLabel: 'Playground date picker',
    onChange(value) {
      playgroundValue = value
      byId('playground-value').textContent = formatOutput(value)
    },
  })
  syncHostTheme()
}
mountPlayground()
for (const id of ['opt-time','opt-clear','opt-now','opt-loop','opt-step']) byId(id).addEventListener('change', mountPlayground)

const rangeHost = byId('range-picker')
pickerHosts.push(rangeHost)
const min = new Date()
min.setHours(0,0,0,0)
const max = new Date(min)
max.setDate(max.getDate() + 30)
new DatePicker(rangeHost, {
  minDate: min,
  maxDate: max,
  clearable: true,
  showNow: true,
  ariaLabel: 'Constrained date picker',
})

byId('theme-toggle').addEventListener('click', () => {
  globalLight = !globalLight
  document.body.classList.toggle('is-light', globalLight)
  byId('theme-toggle').textContent = globalLight ? 'Dark theme' : 'Light theme'
  syncHostTheme()
})
