import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { type ReactNode, useState } from 'react'

/**
 * A column of any value type. TanStack's TValue cannot be one type across a heterogeneous grid,
 * so the `any` is confined to this alias.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous column values
export type Column<T> = ColumnDef<T, any>

export interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  initialSort?: SortingState
  rowClass?: (row: T) => string | undefined
  onRowClick?: (row: T) => void
  /** Wrap in a max-height scroller with sticky headers. */
  scroll?: boolean
  empty?: string
  /**
   * An extra row drawn under one of the data rows — the playoff and play-in cutlines in the
   * standings. It is handed the row and where it landed after sorting, so a table sorted by
   * something other than the table's own order can decline to draw a line that would lie.
   */
  rowAfter?: ((row: T, index: number) => ReactNode) | undefined
}

/**
 * One dense sortable grid. Numeric by default; a column opts into left-aligned text with
 * `meta: { text: true }`.
 */
export function DataTable<T>({
  data,
  columns,
  initialSort,
  rowClass,
  onRowClick,
  scroll = true,
  empty = 'No rows.',
  rowAfter,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? [])
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableSortingRemoval: false,
  })

  const body = (
    <table className="grid">
      <thead>
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((h) => {
              const text = (h.column.columnDef.meta as { text?: boolean } | undefined)?.text
              const sorted = h.column.getIsSorted()
              const canSort = h.column.getCanSort()
              return (
                <th
                  key={h.id}
                  className={[text ? 'text' : '', canSort ? 'sortable' : ''].join(' ').trim()}
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                  }
                  style={h.column.columnDef.size ? { width: h.column.columnDef.size } : undefined}
                  onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                  onKeyDown={
                    canSort
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            h.column.toggleSorting()
                          }
                        }
                      : undefined
                  }
                  tabIndex={canSort ? 0 : undefined}
                  title={
                    h.column.columnDef.meta && (h.column.columnDef.meta as { title?: string }).title
                  }
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {sorted ? (
                    <span className="sort-caret">{sorted === 'asc' ? '▲' : '▼'}</span>
                  ) : null}
                </th>
              )
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.length === 0 ? (
          <tr>
            <td className="text dim" colSpan={columns.length}>
              {empty}
            </td>
          </tr>
        ) : (
          table.getRowModel().rows.flatMap((r, i) => [
            <tr
              key={r.id}
              className={[rowClass?.(r.original) ?? '', onRowClick ? 'clickable' : '']
                .join(' ')
                .trim()}
              onClick={onRowClick ? () => onRowClick(r.original) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter') onRowClick(r.original)
                    }
                  : undefined
              }
            >
              {r.getVisibleCells().map((c) => {
                const text = (c.column.columnDef.meta as { text?: boolean } | undefined)?.text
                return (
                  <td key={c.id} className={text ? 'text' : 'num'}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                )
              })}
            </tr>,
            rowAfter?.(r.original, i) ?? null,
          ])
        )}
      </tbody>
    </table>
  )

  return <div className={scroll ? 'table-scroll' : 'table-x'}>{body}</div>
}
