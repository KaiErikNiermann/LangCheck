import { mount } from 'svelte'
import './app.css'
import Inspector from './Inspector.svelte'

const app = mount(Inspector, {
  target: document.getElementById('app')!,
})

export default app
