<!--
	@component
	Text cut short with an ellipsis that, when it is cut short, shows the whole of it in a
	tooltip like Storyblok's own on hover or focus. The tooltip is placed against the nearest
	positioned ancestor, so give the row it sits in `relative`; it opens upwards, since a plugin's
	frame is only as tall as its content and anything hanging below would be clipped.
-->
<script lang="ts">
	import { cn } from '../../../utils.js'

	interface Props {
		text: string
		class?: string
	}

	let { text, class: cls }: Props = $props()

	let clipped = $state(false)
	// where the arrow points: the start of the text, measured from the row the tooltip sits in
	let arrow = $state(0)

	function measure(event: Event) {
		const text = (event.currentTarget as HTMLElement).firstElementChild as HTMLElement
		clipped = text.scrollWidth > text.clientWidth
		arrow = text.offsetLeft + 16
	}
</script>

<span
	class={cn('group/clipped min-w-0', cls)}
	onpointerenter={measure}
	onfocusin={measure}
	role="presentation"
>
	<span class="block truncate">{text}</span>
	{#if clipped}
		<span
			role="tooltip"
			style:--arrow="{arrow}px"
			class="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-2 w-max max-w-full origin-bottom-left translate-y-1 scale-[0.97] rounded-lg bg-tooltip px-3 py-2 text-sm leading-snug wrap-break-word whitespace-normal text-tooltip-foreground opacity-0 shadow-lg transition-[opacity,translate,scale] duration-150 ease-out group-focus-within/clipped:translate-y-0 group-focus-within/clipped:scale-100 group-focus-within/clipped:opacity-100 group-hover/clipped:translate-y-0 group-hover/clipped:scale-100 group-hover/clipped:opacity-100 group-hover/clipped:delay-350 after:absolute after:top-full after:left-(--arrow) after:size-0 after:border-x-[6px] after:border-t-[6px] after:border-x-transparent after:border-t-tooltip motion-reduce:translate-y-0 motion-reduce:scale-100"
		>
			{text}
		</span>
	{/if}
</span>
