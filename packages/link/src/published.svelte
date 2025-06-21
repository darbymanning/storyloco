<script lang="ts">
	let { class: classname }: { class?: string } = $props()
</script>

<svg viewBox="0 0 24 24" class={classname}>
	<g fill="none" fill-rule="evenodd">
		<circle cx="12" cy="12" r="4" fill="currentColor"></circle>
		<path
			fill="currentColor"
			d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"
			opacity=".3"
		></path>
	</g>
</svg>
