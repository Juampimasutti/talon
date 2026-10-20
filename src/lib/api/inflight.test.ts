import { describe, expect, it } from "vitest";
import { dedupe } from "./inflight";

describe("deduplicación de pedidos", () => {
  it("comparte la misma promesa si la clave coincide", async () => {
    let calls = 0;
    const run = () =>
      dedupe("catalogos", async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return "listo";
      });
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe("listo");
    expect(b).toBe("listo");
    expect(calls).toBe(1);
  });
});
