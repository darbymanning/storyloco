import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Floor, PlotDimension, Type, Types, UUID } from '../types.js'
import { merge } from 'lodash-es'

type Plugin = FieldPluginResponse<Types | null>

export class FloorPlanManager {
  plugin = $state<Plugin | null>(null)
  content = $state<Types>({ types: [] })

  // default data structures
  private readonly default_floor: Floor = {
    id: crypto.randomUUID(),
    name: 'Floor 1',
    plot_dimensions: [
      {
        id: crypto.randomUUID(),
        plot_number: 1,
        rooms: [
          {
            id: crypto.randomUUID(),
            name: 'Room 1',
            area_m: '0.00m x 0.00m',
            area_ft: `00'00" x 00'00"`,
          },
          {
            id: crypto.randomUUID(),
            name: 'Room 2',
            area_m: '0.00m x 0.00m',
            area_ft: `00'00" x 00'00"`,
          },
        ],
      },
    ],
  }

  private readonly default_type: Type = {
    id: crypto.randomUUID(),
    name: 'Type 1',
    floors: [this.default_floor],
  }

  // derived state
  is_modal_open = $derived(this.plugin?.type === 'loaded' && this.plugin.data.isModalOpen)
  loaded = $derived(this.plugin?.type === 'loaded')

  constructor() {
    this.initialize_plugin()

    $effect(() => {
      document.documentElement.setAttribute(
        'data-modal-open',
        this.is_modal_open ? 'true' : 'false'
      )
    })
  }

  private initialize_plugin() {
    createFieldPlugin<Types>({
      enablePortalModal: true,
      onUpdateState: (state) => {
        this.plugin = state as Plugin

        const incoming_content = state.data?.content
        if (!incoming_content) return

        // merge the incoming content instead of replacing it entirely
        // this preserves object references for dnd
        merge(this.content, incoming_content)
      },
    })
  }

  update = () => {
    if (this.plugin?.type !== 'loaded') return
    const state = $state.snapshot(this.content)
    this.plugin.actions.setContent(state)
  }

  // action methods
  reset = (value?: string | UUID) => {
    if (value) {
      this.content._active_type = value as UUID
      this.content._active_floor = this.content.types.find(
        (type) => type.id === value
      )?.floors[0].id
    } else {
      this.content._active_type = this.content.types[0].id
      this.content._active_floor = this.content.types[0].floors[0].id
    }

    this.update()
  }

  add_type = () => {
    this.plugin?.actions?.setModalOpen(true)
    const id = crypto.randomUUID()

    this.content.types.push({
      ...this.default_type,
      id,
      name: `Type ${this.content.types.length + 1}`,
    })

    this.content._active_type = id
    this.content._active_floor = this.content.types.find((type) => type.id === id)?.floors[0].id

    this.update()
  }

  edit_type = (id: UUID) => {
    this.content._active_type = id
    this.content._active_floor = this.content.types.find((type) => type.id === id)?.floors[0].id
    this.update()
    this.plugin?.actions?.setModalOpen(true)
  }

  add_floor = (id: UUID) => {
    const type = this.content.types.find((type) => type.id === id)
    if (!type) return

    const floor_id = crypto.randomUUID()
    this.content._active_floor = floor_id

    type.floors.push({
      ...this.default_type.floors[0],
      id: floor_id,
      name: `Floor ${type.floors.length + 1}`,
    })

    this.update()
  }

  delete_type = (id: UUID) => {
    if (!confirm('Are you sure you want to delete this type?')) return

    this.content.types = this.content.types.filter((type) => type.id !== id)

    this.update()

    // Close the modal if there are no types left
    if (!this.content.types.length) {
      this.plugin?.actions?.setModalOpen(false)
      return
    }

    // Reset the active type and floor
    this.reset()
  }

  add_plan = async ({ type_id, floor_id }: { type_id: UUID; floor_id: UUID }) => {
    const floor = this.content.types
      .find((type) => type.id === type_id)
      ?.floors.find((floor) => floor.id === floor_id)
    if (!floor) return

    floor.plan = await this.plugin?.actions?.selectAsset()

    this.update()
  }

  add_plot_dimensions = ({
    type_id,
    floor_id,
  }: {
    type_id: UUID
    floor_id: UUID
  }) => {
    const floor = this.content.types
      .find((type) => type.id === type_id)
      ?.floors.find((floor) => floor.id === floor_id)
    if (!floor) return

    floor.plot_dimensions.push({
      ...this.default_type.floors[0].plot_dimensions[0],
      plot_number: floor.plot_dimensions.length + 1,
      id: crypto.randomUUID(),
    })

    this.update()
  }

  delete_plot_dimension = ({
    type_id,
    floor_id,
    plot_dimension_id,
  }: {
    type_id: UUID
    floor_id: UUID
    plot_dimension_id: UUID
  }) => {
    if (!confirm('Are you sure you want to delete these plot dimensions?')) return

    const floor = this.content.types
      .find((type) => type.id === type_id)
      ?.floors.find((floor) => floor.id === floor_id)
    if (!floor) return

    floor.plot_dimensions = floor.plot_dimensions.filter(
      (plot_dimension) => plot_dimension.id !== plot_dimension_id
    )

    this.update()
  }

  add_room = ({
    type_id,
    floor_id,
    plot_dimension_id,
  }: {
    type_id: UUID
    floor_id: UUID
    plot_dimension_id: UUID
  }) => {
    const floor = this.content.types
      .find((type) => type.id === type_id)
      ?.floors.find((floor) => floor.id === floor_id)
    if (!floor) return

    const plot_dimension = floor.plot_dimensions.find(
      (plot_dimension) => plot_dimension.id === plot_dimension_id
    )
    if (!plot_dimension) return

    plot_dimension.rooms.push({
      ...this.default_type.floors[0].plot_dimensions[0].rooms[0],
      name: `Room ${plot_dimension.rooms.length + 1}`,
      id: crypto.randomUUID(),
    })

    this.update()
  }

  delete_room = ({
    type_id,
    floor_id,
    plot_dimension_id,
    room_id,
  }: {
    type_id: UUID
    floor_id: UUID
    plot_dimension_id: UUID
    room_id: UUID
  }) => {
    const floor = this.content.types
      .find((type) => type.id === type_id)
      ?.floors.find((floor) => floor.id === floor_id)
    if (!floor) return

    const plot_dimension = floor.plot_dimensions.find(
      (plot_dimension) => plot_dimension.id === plot_dimension_id
    )
    if (!plot_dimension) return

    plot_dimension.rooms = plot_dimension.rooms.filter((room) => room.id !== room_id)

    this.update()
  }

  delete_floor = ({ type_id, floor_id }: { type_id: UUID; floor_id: UUID }) => {
    if (!confirm('Are you sure you want to delete this floor?')) return

    const type = this.content.types.find((type) => type.id === type_id)
    if (!type) return

    type.floors = type.floors.filter((floor) => floor.id !== floor_id)

    this.reset()
    this.update()
  }

  // utility method to handle modal state
  set_modal_open = (is_open: boolean) => {
    this.plugin?.actions?.setModalOpen(is_open)
  }
}
