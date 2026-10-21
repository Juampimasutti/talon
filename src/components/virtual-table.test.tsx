// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VirtualTable } from "./virtual-table";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 46,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 46, size: 46 })),
  }),
}));
afterEach(cleanup);
const rows = [{ id: "1", name: "Yerba" }, { id: "2", name: "Arroz" }];

describe("tabla virtual real", () => {
  it("evita repintar celdas con props estables y mide el costo de un callback nuevo", () => {
    const cell = vi.fn((row: typeof rows[number]) => row.name);
    const props = { rows, columns: [{ key: "name", header: "Nombre", cell }], template: "1fr", empty: "Vacío", onRow: vi.fn() };
    const view = render(<VirtualTable {...props} />);
    expect(cell).toHaveBeenCalledTimes(2);
    view.rerender(<VirtualTable {...props} />);
    view.rerender(<VirtualTable {...props} />);
    expect(cell).toHaveBeenCalledTimes(2);
    view.rerender(<VirtualTable {...props} onRow={() => {}} />);
    view.rerender(<VirtualTable {...props} onRow={() => {}} />);
    expect(cell).toHaveBeenCalledTimes(6);
  });

  it("actualiza datos y callbacks sin conservar una acción antigua", () => {
    const first = vi.fn(), next = vi.fn();
    const columns = [{ key: "name", header: "Nombre", cell: (row: typeof rows[number]) => row.name }];
    const view = render(<VirtualTable rows={rows} columns={columns} template="1fr" empty="Vacío" onRow={first} />);
    const updated = [{ id: "1", name: "Yerba nueva" }];
    view.rerender(<VirtualTable rows={updated} columns={columns} template="1fr" empty="Vacío" onRow={next} />);
    fireEvent.click(view.getByRole("button", { name: "Yerba nueva" }));
    expect(next).toHaveBeenCalledWith(updated[0]);
    expect(first).not.toHaveBeenCalled();
  });
});
