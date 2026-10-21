"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useRef, type ReactNode } from "react";

export type VirtualColumn<T> = {
  key: string;
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
};

type RowProps<T> = {
  row: T;
  columns: VirtualColumn<T>[];
  template: string;
  start: number;
  size: number;
  onClick?: (row: T) => void;
};

function RowInner<T>({ row, columns, template, start, size, onClick }: RowProps<T>) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick ? () => onClick(row) : undefined}
      className="absolute top-0 left-0 grid w-full items-center gap-x-3 border-b border-border/70 px-3 text-left text-sm hover:bg-accent/60 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      style={{ height: size, transform: `translateY(${start}px)`, gridTemplateColumns: template }}
    >
      {columns.map((column) => (
        <div key={column.key} className={column.className}>
          {column.cell(row)}
        </div>
      ))}
    </Comp>
  );
}

const Row = memo(RowInner) as typeof RowInner;

function VirtualTableInner<T>({
  rows,
  columns,
  template,
  rowHeight = 46,
  onRow,
  empty,
}: {
  rows: T[];
  columns: VirtualColumn<T>[];
  template: string;
  rowHeight?: number;
  onRow?: (row: T) => void;
  empty: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  return (
    <div className="rounded-lg border bg-card">
      <p className="border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground md:hidden">Deslizá la tabla para ver todas las columnas →</p>
      <div className="overflow-x-auto" role="region" aria-label="Tabla de resultados, desplazamiento horizontal" tabIndex={0}>
      <div className="min-w-[780px]">
      <div className="grid items-center gap-x-3 border-b bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground" style={{ gridTemplateColumns: template }}>
        {columns.map((column) => (
          <div key={column.key} className={column.className}>
            {column.header}{" "}
          </div>
        ))}
      </div>
      <div ref={parentRef} className="h-[min(68vh,640px)] overflow-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <Row
                key={item.key}
                row={rows[item.index]}
                columns={columns}
                template={template}
                start={item.start}
                size={item.size}
                onClick={onRow}
              />
            ))}
          </div>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}

export const VirtualTable = memo(VirtualTableInner) as typeof VirtualTableInner;
