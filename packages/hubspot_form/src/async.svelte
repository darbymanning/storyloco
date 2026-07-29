<script lang="ts">
	import App from './app.svelte'
</script>

<svelte:boundary>
	{#snippet pending()}
		<p>Loading...</p>
	{/snippet}
	<App />
</svelte:boundary>
