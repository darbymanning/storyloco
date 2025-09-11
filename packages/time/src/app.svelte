<script lang="ts">
	import { Input } from 'shared'
	import { TimeManager } from './app.svelte.js'

	const input = new TimeManager()
</script>

<Input type="time" bind:value={input.content} oninput={input.update} step="60" />
