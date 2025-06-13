<script lang="ts">
  import {
    createFieldPlugin,
    type FieldPluginResponse,
  } from '@storyblok/field-plugin'
  import { onMount } from 'svelte'
  import { flip } from 'svelte/animate'
  import { fly, fade } from 'svelte/transition'
  import Mux from '@mux/mux-node'
  import { format_date, format_elapse } from 'kitto'
  import {
    VideoIcon,
    VideoOffIcon,
    HourglassIcon,
    Trash2Icon,
    RefreshCwIcon,
    CheckCircle2Icon,
    EllipsisIcon,
    Settings2Icon,
  } from '@lucide/svelte'
  import '@mux/mux-uploader'

  type Video = Mux.Video.Assets.Asset | null
  type Plugin = FieldPluginResponse<Video | null>

  let plugin: Plugin | null = $state(null)
  let assets: Array<Mux.Video.Assets.Asset> | null = $state(null)
  let open_actions: string | null = $state(null)

  onMount(() => {
    createFieldPlugin({
      enablePortalModal: true,
      validateContent: (content) => {
        if (typeof content !== 'object' || content === null) {
          return { content: null }
        }

        return { content }
      },
      onUpdateState: (state) => {
        plugin = state as Plugin
      },
    })
  })

  const mux = $derived.by(() => {
    if (plugin?.type !== 'loaded' || !plugin.data.options.MOXY_SECRET_ID)
      return null

    return new Mux({
      baseURL: 'https://moxy.admin-54b.workers.dev/api/',
      tokenId: '',
      tokenSecret: '',
      defaultHeaders: {
        authorization: `Bearer ${plugin.data.options.MOXY_SECRET_ID}`,
      },
    })
  })

  const actions = {
    async list() {
      if (!mux) throw new Error('Mux not initialised')

      assets = (await mux.video.assets.list()).data
    },
    async delete(id: string) {
      if (
        plugin?.type !== 'loaded' ||
        !plugin.data.options.MOXY_SECRET_ID ||
        !mux
      )
        throw new Error('Mux not initialised')

      const confirm = window.confirm(
        'Are you sure you want to delete this video?',
      )

      if (!confirm) return

      // Update local state, for smooth transition
      if (assets?.length) assets = assets.filter((asset) => asset.id !== id)

      // Delete the video
      await mux.video.assets.delete(id)

      // Update content if the deleted video was the current one
      if (plugin?.data.content?.id === id) plugin.actions.setContent(null)

      // Refresh the list
      await actions.list()

      // Close the modal
      plugin?.actions?.setModalOpen(false)
    },
    async get_upload_endpoint() {
      if (!mux) throw new Error('Mux not initialised')

      return (
        await mux.video.uploads.create({
          cors_origin: 'https://storyblok.com',
          new_asset_settings: {
            playback_policy: ['public'],
            encoding_tier: 'baseline',
          },
        })
      ).url
    },
    toggle_actions(id: string) {
      open_actions = open_actions === id ? null : id
    },
  }

  function format_duration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remaining_seconds = Math.floor(seconds % 60)

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remaining_seconds.toString().padStart(2, '0')}`
    }

    return `${minutes}:${remaining_seconds.toString().padStart(2, '0')}`
  }

  function date(date: string): string {
    const d = new Date(Number(date) * 1000)
    return format_elapse(d) || format_date('{MMM} {d}, {YYYY}', d)
  }
</script>

<svelte:window
  onclick={(event) => {
    if (!(event.target instanceof HTMLElement)) return

    // reset target when we click outside of actions
    if (event.target.closest('.actions')) return

    open_actions = null
  }}
/>

{#snippet skeleton()}
  <ol class="asset-list skeleton">
    {#each Array(12)}
      <li>
        <div class="asset-preview skeleton">
          <figure></figure>
          <p class="title"></p>
          <span class="meta"></span>
        </div>
      </li>
    {/each}
  </ol>
{/snippet}

{#snippet asset_preview(video: NonNullable<Video>)}
  {@const playback_id = video.playback_ids?.[0]?.id}
  <figure>
    {#if playback_id && video.status === 'ready'}
      <img
        src={`https://image.mux.com/${playback_id}/thumbnail.jpg?width=240&height=135&fit_mode=smartcrop`}
        alt={video.meta?.title}
      />
    {/if}
    {#if video.status === 'errored'}
      <VideoOffIcon />
    {:else if video.status === 'preparing'}
      <HourglassIcon />
    {:else if plugin?.data?.content?.id === video.id}
      <CheckCircle2Icon />
    {/if}
  </figure>
{/snippet}

{#snippet asset_meta(video: NonNullable<Video>)}
  <p
    class="title"
    title={video.meta?.title}
  >
    {video.meta?.title}
  </p>
  <span class="meta">
    {#if video.status === 'errored'}
      {video.errors?.messages}
    {:else if video.status === 'preparing'}
      Preparing...
    {:else if video.duration}
      <span class="status">
        {format_duration(video.duration)}
      </span>
      <time
        datetime={video.created_at}
        class="date"
      >
        {date(video.created_at)}
      </time>
    {/if}
  </span>
{/snippet}

{#if plugin?.type === 'loaded' && mux}
  {#if plugin.data.isModalOpen}
    <div class="modal">
      <mux-uploader
        onsuccess={actions.list}
        endpoint={actions.get_upload_endpoint}
      ></mux-uploader>
      {#await actions.list()}
        {@render skeleton()}
      {:then}
        {#if !assets || assets.length === 0}
          <p>No videos found</p>
        {:else}
          <ol class="asset-list">
            {#each assets as video (video.id)}
              {@const actions_open = open_actions === video.id}
              <li
                class:active={actions_open}
                class="asset-item"
                animate:flip={{ duration: 300 }}
                in:fly={{ y: 20, duration: 300, delay: 100 }}
                out:fade={{ duration: 200 }}
              >
                {#if video.status === 'ready'}
                  <button
                    class="asset-actions-trigger"
                    onclick={() => actions.toggle_actions(video.id)}
                  >
                    <EllipsisIcon size={18} />
                  </button>
                  {#if actions_open}
                    <ol
                      class="actions"
                      transition:fly={{ y: 20, duration: 300, delay: 100 }}
                    >
                      <li>
                        <button onclick={() => actions.delete(video.id)}>
                          Delete
                        </button>
                      </li>
                    </ol>
                  {/if}
                {/if}
                <button
                  class="asset-preview"
                  class:selected={video.id === plugin.data.content?.id}
                  onclick={() => {
                    plugin?.actions?.setModalOpen(false)
                    plugin?.actions?.setContent($state.snapshot(video))
                  }}
                >
                  {@render asset_preview(video)}
                  {@render asset_meta(video)}
                </button>
              </li>
            {/each}
          </ol>
        {/if}
      {:catch}
        An error occurred while loading videos.
      {/await}
    </div>
  {:else if plugin.data.content}
    <div class="asset-button sb-input">
      {@render asset_preview(plugin.data.content)}
      <div class="desc text-4xl">{@render asset_meta(plugin.data.content)}</div>
      <ul class="actions">
        <li>
          <button
            onclick={() => plugin?.actions?.setModalOpen(true)}
            title="Replace video"
            aria-label="Replace video"
          >
            <RefreshCwIcon size={18} />
          </button>
        </li>
        <li>
          <button
            title="Settings"
            aria-label="Settings"
          >
            <Settings2Icon size={18} />
          </button>
        </li>
        <li>
          <button
            onclick={() => plugin?.actions?.setContent(null)}
            title="Remove video"
            aria-label="Remove video"
          >
            <Trash2Icon size={18} />
          </button>
        </li>
      </ul>
    </div>
  {:else}
    <button
      class="asset-button sb-input"
      onclick={() => plugin?.actions?.setModalOpen(true)}
      title="Add video"
      aria-label="Add video"
    >
      <figure>
        <VideoIcon />
      </figure>
      + Add Video
    </button>
  {/if}
{/if}

<style>
  /* .modal {
    padding: 30px;
    display: grid;
    gap: 30px;
  }

  .asset-button {
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    font-size: 13px;

    figure {
      height: 80px;
      width: 106px;
      border-radius: var(--border-radius);
      background-color: var(--color-sb-gray-100);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .desc {
      display: grid;
      gap: 5px;
    }

    &:hover,
    &:focus {
      .actions {
        opacity: 1;
        translate: 0 0;
        scale: 1;
      }
    }
  }

  .asset-item {
    position: relative;

    &:hover .asset-actions-trigger,
    &.active .asset-actions-trigger {
      opacity: 1;
      translate: 0 0;
      scale: 1;
    }
  }

  .asset-actions-trigger {
    opacity: 0;
    transition:
      opacity 0.2s ease,
      translate 0.2s ease,
      scale 0.2s ease;
    translate: 0 -10px;
    scale: 0.95;
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 1;
    background-color: var(--color-sb-gray-100);
    border-radius: var(--border-radius);
    padding: 4px;
    display: flex;

    + .actions {
      z-index: 1;
      opacity: 1;
      top: 60px;
      left: 0;
      width: 100%;

      &,
      li {
        display: grid;
      }

      button {
        padding: 16px;
      }
    }
  }

  .asset-preview {
    display: grid;
    gap: 10px;
    width: 100%;
    padding: 10px;
    border-radius: var(--border-radius);
    transition:
      background-color 0.2s ease,
      border-color 0.2s ease;
    border: 1px solid transparent;
    font-size: 13px;

    &:not(.skeleton):hover,
    &:focus,
    &.selected {
      background-color: var(--color-sb-gray-50);
    }

    &:focus,
    &.selected {
      border-color: var(--color-sb-1);
    }

    &.selected {
      opacity: 0.8;

      :global(svg) {
        position: absolute;
      }
    }

    figure {
      border-radius: inherit;
      overflow: hidden;
      aspect-ratio: 16 / 9;
      display: grid;
      place-items: center;
      place-content: center;
      background-color: var(--color-sb-gray-600);
      position: relative;

      .selected &::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--color-sb-1);
        opacity: 0.8;
      }

      .skeleton & {
        background-color: var(--color-sb-gray-100);
      }
    }

    .meta {
      justify-content: space-between;
    }
  }

  .title {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    .skeleton & {
      background-color: var(--color-sb-gray-100);
      width: 70%;
      height: 14px;
      border-radius: var(--border-radius);
    }
  }

  .meta {
    color: var(--text-muted);
    font-size: 11px;
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .asset-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
  }

  .actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    border: 1px solid var(--color-sb-gray-200);
    border-radius: var(--border-radius);
    background-color: var(--color-dark-gray);
    overflow: hidden;
    opacity: 0;
    translate: 0 -10px;
    scale: 0.95;
    transition:
      opacity 0.2s ease,
      translate 0.2s ease,
      scale 0.2s ease;

    button {
      padding: 8px;
      display: flex;

      &:hover,
      &:focus {
        background-color: var(--color-sb-gray-100);
        transition: background-color 0.2s ease;
      }
    }

    li + li {
      border-left: 1px solid var(--color-sb-gray-200);
    }
  } */
</style>
