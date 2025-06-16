<script lang="ts">
	import { cn } from 'shared/utils';

	let props: { class?: string } = $props();
</script>

<div class={cn('bg-accent animate-pulse rounded', props.class)}></div>
