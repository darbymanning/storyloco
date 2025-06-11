<script lang="ts">
  import {
    createFieldPlugin,
    type FieldPluginResponse,
  } from '@storyblok/field-plugin'
  import { onMount } from 'svelte'

  interface Heading {
    text: string
    level: 1 | 2 | 3 | 4 | 5 | 6
  }

  type Plugin = FieldPluginResponse<Heading | null>

  let plugin: Plugin | null = $state(null)
  let content: Heading = $state({ text: '', level: 1 })

  onMount(() => {
    createFieldPlugin({
      enablePortalModal: true,
      validateContent: (content) => {
        if (typeof content !== 'object' || content === null) {
          return { content: { text: '', level: 1 } as Heading }
        }

        const validated = content as Heading
        // ensure level is one of the allowed values
        if (![1, 2, 3, 4, 5, 6].includes(validated.level)) {
          validated.level = 1
        }
        // ensure text is a string
        if (typeof validated.text !== 'string') {
          validated.text = ''
        }

        return { content: validated }
      },
      onUpdateState: (state) => {
        plugin = state as Plugin
      },
    })
  })

  function update() {
    if (plugin?.type !== 'loaded') return
    const state = $state.snapshot(content)
    plugin.actions.setContent(state)
  }
</script>

{#if plugin?.type === 'loaded'}
  <fieldset>
    <input
      bind:value={content.text}
      oninput={update}
    />
    <select
      bind:value={
        () => content.level,
        (v) => (content.level = Number(v) as Heading['level'])
      }
      onchange={update}
    >
      {#each [1, 2, 3, 4, 5, 6] as level}
        <option value={level}>H{level}</option>
      {/each}
    </select>
  </fieldset>
{/if}

<style>
  input {
    width: 100%;
  }

  fieldset {
    display: flex;
    gap: 0.5rem;
  }
</style>
