'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Generic, glassy data table: sorting, global filter, and pagination via
 * TanStack Table. Reused by every data view in the app.
 */
export function DataTable({
  columns,
  data,
  searchable = true,
  searchPlaceholder = 'Search…',
  pageSize = 8,
  pageSizeOptions = [10, 20, 50, 75, 100],
  emptyMessage = 'No results found.',
  className,
  onRowClick,
}) {
  const [sorting, setSorting] = React.useState([]);
  const [globalFilter, setGlobalFilter] = React.useState('');

  // The rows-per-page menu offers exactly `pageSizeOptions` — a caller's own
  // pageSize is never bolted on, or odd values like 12 and 15 leak into the menu.
  // Snap the starting size to the closest offered one so the control always shows
  // a real selection.
  const startSize = React.useMemo(() => {
    if (pageSizeOptions.includes(pageSize)) return pageSize;
    return pageSizeOptions.reduce((best, n) => (Math.abs(n - pageSize) < Math.abs(best - pageSize) ? n : best), pageSizeOptions[0]);
  }, [pageSize, pageSizeOptions]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: startSize } },
  });

  const rows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;

  const currentSize = table.getState().pagination.pageSize;
  const sizeOptions = React.useMemo(() => [...pageSizeOptions].sort((a, b) => a - b), [pageSizeOptions]);
  // Show the pager/size controls once there's more data than the smallest option.
  const showPager = totalRows > sizeOptions[0] || table.getPageCount() > 1;

  return (
    <div className={cn('glass glass-highlight overflow-hidden rounded-2xl', className)}>
      {searchable ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 w-full bg-background/50 pl-9"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {totalRows} {totalRows === 1 ? 'record' : 'records'}
          </span>
        </div>
      ) : null}

      {/* Desktop / tablet: the real table (scrolls horizontally only if very wide) */}
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="border-border/60 hover:bg-transparent">
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    className="px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === 'asc' ? (
                          <ArrowUp className="size-3.5" />
                        ) : sorted === 'desc' ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-50" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn('border-border/50', onRowClick && 'cursor-pointer hover:bg-foreground/[0.04]')}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-28 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      {/* Mobile: each row as a stacked card — a multi-column table can't fit a phone */}
      <div className="space-y-2.5 p-3 sm:hidden">
        {rows.length ? (
          rows.map((row) => (
            <div
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'rounded-xl bg-foreground/[0.03] p-3 ring-1 ring-border/50',
                onRowClick && 'cursor-pointer active:bg-foreground/[0.07]',
              )}
            >
              {row.getVisibleCells().map((cell) => {
                const h = cell.column.columnDef.header;
                const label = typeof h === 'string' ? h : '';
                return (
                  <div
                    key={cell.id}
                    className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-0 last:pb-0 first:pt-0"
                  >
                    {label ? (
                      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
                    ) : (
                      <span />
                    )}
                    <div className="min-w-0 text-right text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        )}
      </div>

      {showPager ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rows</span>
            <Select value={String(currentSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
              <SelectTrigger size="sm" className="w-[4.5rem] bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} · {totalRows} total
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
