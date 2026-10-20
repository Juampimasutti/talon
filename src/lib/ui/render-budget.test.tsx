// @vitest-environment happy-dom
import { memo, useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { visibleWindow } from "./window";

afterEach(cleanup);

describe("renders y virtualización", () => {
  it("una fila memoizada no se vuelve a pintar si el filtro cambia y el dato no", () => {
    let rowRenders = 0;
    const Row = memo(function Row({ name }: { name: string }) {
      rowRenders += 1;
      return <span>{name}</span>;
    });
    const items = [
      { id: "1", name: "Yerba" },
      { id: "2", name: "Tornillo" },
    ];

    function Screen() {
      const [query, setQuery] = useState("");
      return (
        <div>
          <input aria-label="buscar" value={query} onChange={(event) => setQuery(event.target.value)} />
          {items.map((item) => (
            <Row key={item.id} name={item.name} />
          ))}
        </div>
      );
    }

    const view = render(<Screen />);
    expect(rowRenders).toBe(2);
    fireEvent.change(view.getByLabelText("buscar"), { target: { value: "yer" } });
    fireEvent.change(view.getByLabelText("buscar"), { target: { value: "yerba" } });
    expect(rowRenders).toBe(2);
  });

  it("sin memo, el mismo tipeo repinta todas las filas", () => {
    let rowRenders = 0;
    function Row({ name }: { name: string }) {
      rowRenders += 1;
      return <span>{name}</span>;
    }
    const items = [
      { id: "1", name: "Yerba" },
      { id: "2", name: "Tornillo" },
    ];
    function Screen() {
      const [query, setQuery] = useState("");
      return (
        <div>
          <input aria-label="buscar" value={query} onChange={(event) => setQuery(event.target.value)} />
          {items.map((item) => (
            <Row key={item.id} name={item.name} />
          ))}
        </div>
      );
    }
    const view = render(<Screen />);
    fireEvent.change(view.getByLabelText("buscar"), { target: { value: "a" } });
    expect(rowRenders).toBe(4);
  });

  it("de 1200 artículos solo entra una ventana chica en el viewport", () => {
    const window = visibleWindow({ scrollTop: 0, viewport: 640, rowHeight: 44, count: 1200, overscan: 8 });
    expect(window.rendered).toBeLessThan(40);
    expect(window.rendered).toBeGreaterThan(10);
    const scrolled = visibleWindow({ scrollTop: 4400, viewport: 640, rowHeight: 44, count: 1200, overscan: 8 });
    expect(scrolled.start).toBeGreaterThan(80);
    expect(scrolled.rendered).toBeLessThan(40);
  });
});
