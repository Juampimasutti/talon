"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend } from "@/lib/api/client";
import { formatQty, parseLocaleNumber } from "@/lib/format";
import { plateError } from "@/lib/guards";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Board = {
  canTrucks: boolean;
  trucks: { id: string; plate: string; name: string; description: string; km_initial: string; active: boolean; driver_user_id: string | null; trips: number }[];
  compartments: { id: string; truck_id: string; name: string; product_id: string; product_name: string; capacity: string; quantity: string }[];
  pumps: { id: string; number: number; name: string; active: boolean; readings: number }[];
  nozzles: { id: string; pump_id: string; number: number; product_id: string; tank_id: string; product_name: string; tank_name: string; reading: string }[];
  tanks: { id: string; name: string; product_id: string; product_name: string; capacity: string; active: boolean; sticks: number }[];
  sticks: { tank_id: string; measured_at: string; liters: string; note: string | null }[];
  products: { id: string; name: string; unit: string }[];
  drivers: { id: string; name: string }[];
};

export function Equipos() {
  const queryClient = useQueryClient();
  const data = useQuery({ queryKey: ["estacion-equipos"], queryFn: () => apiGet<Board>("/api/estacion/equipos"), staleTime: 15_000 });
  const board = data.data;
  const [truck, setTruck] = useState({ plate: "", name: "", description: "", driverUserId: "", kmInitial: "0", productId: "", capacity: "5000" });
  const [pump, setPump] = useState({ number: "", name: "" });
  const [nozzle, setNozzle] = useState({ pumpId: "", number: "1", productId: "", tankId: "", opening: "" });
  const [reset, setReset] = useState({ nozzleId: "", reading: "", note: "Cambio de aforador" });
  const [tank, setTank] = useState({ name: "", productId: "", capacity: "20000", initialLiters: "" });
  const [editPump, setEditPump] = useState<Board["pumps"][number] | null>(null);
  const [editNozzle, setEditNozzle] = useState<Board["nozzles"][number] | null>(null);
  const [editTank, setEditTank] = useState<Board["tanks"][number] | null>(null);
  const [editTruck, setEditTruck] = useState<Board["trucks"][number] | null>(null);
  const [confirmOff, setConfirmOff] = useState<{ title: string; body: string; run: () => Promise<unknown> } | null>(null);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ["estacion-equipos"] });
  }
  function fail(error: unknown) {
    toast.error(error instanceof ApiError ? error.message : "No se pudo guardar");
  }
  function ask(title: string, body: string, run: () => Promise<unknown>) {
    setConfirmOff({ title, body, run });
  }

  if (data.isLoading) return <p className="text-sm text-muted-foreground">Cargando equipos…</p>;
  if (!board) return <p className="text-sm">No pudimos abrir los equipos.</p>;

  return (
    <div className="grid gap-6">
      <Dialog open={Boolean(confirmOff)} onOpenChange={(open) => { if (!open) setConfirmOff(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{confirmOff?.title}</DialogTitle></DialogHeader>
          <p className="text-sm">{confirmOff?.body}</p>
          <div className="flex gap-2">
            <Button onClick={() => { const run = confirmOff?.run; setConfirmOff(null); void run?.().then(() => refresh()).catch(fail); }}>Desactivar igual</Button>
            <Button variant="outline" onClick={() => setConfirmOff(null)}>Cancelar</Button>
          </div>
        </DialogContent>
      </Dialog>
      <section className="grid gap-3">
        <h2 className="text-xl">Surtidores</h2>
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {board.pumps.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="font-semibold">{item.number} · {item.name} {item.active ? "" : "· desactivado"}</p>
              {board.nozzles.filter((pico) => pico.pump_id === item.id).map((pico) => (
                <p key={pico.id} className="text-muted-foreground">
                  Pico {pico.number} · {pico.product_name} · {pico.tank_name} · aforador {formatQty(Number(pico.reading))}
                  <Button className="ml-2" variant="outline" onClick={() => setEditNozzle(pico)}>Editar pico</Button>
                </p>
              ))}
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={() => setEditPump(item)}>Editar</Button>
                <Button variant="outline" onClick={() => {
                  const run = () => apiSend(`/api/estacion/equipos/surtidor/${item.id}`, "PATCH", { number: item.number, name: item.name, active: !item.active });
                  if (item.active && item.readings > 0) ask("Desactivar surtidor", "Este surtidor tiene lecturas. Queda inactivo y el historial se conserva.", run);
                  else void run().then(() => refresh()).catch(fail);
                }}>{item.active ? "Desactivar" : "Activar"}</Button>
              </div>
              {editPump?.id === item.id ? (
                <form noValidate className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  void apiSend(`/api/estacion/equipos/surtidor/${item.id}`, "PATCH", { number: Number(editPump.number), name: editPump.name, active: editPump.active }).then(async () => { toast.success("Surtidor actualizado"); setEditPump(null); await refresh(); }).catch(fail);
                }}>
                  <Input className="w-24" aria-label="Número" value={String(editPump.number)} onChange={(event) => setEditPump({ ...editPump, number: Number(event.target.value) })} />
                  <Input aria-label="Nombre" value={editPump.name} onChange={(event) => setEditPump({ ...editPump, name: event.target.value })} />
                  <Button type="submit">Guardar</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {editNozzle ? (
          <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
            event.preventDefault();
            void apiSend(`/api/estacion/equipos/pico/${editNozzle.id}`, "PATCH", { pumpId: editNozzle.pump_id, number: Number(editNozzle.number), productId: editNozzle.product_id, tankId: editNozzle.tank_id }).then(async () => { toast.success("Pico actualizado"); setEditNozzle(null); await refresh(); }).catch(fail);
          }}>
            <Input className="w-20" aria-label="Número de pico" value={String(editNozzle.number)} onChange={(event) => setEditNozzle({ ...editNozzle, number: Number(event.target.value) })} />
            <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Combustible" value={editNozzle.product_id} onChange={(event) => setEditNozzle({ ...editNozzle, product_id: event.target.value })}>
              {board.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Tanque" value={editNozzle.tank_id} onChange={(event) => setEditNozzle({ ...editNozzle, tank_id: event.target.value })}>
              {board.tanks.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatQty(Number(item.capacity))}</option>)}
            </select>
            <Button type="submit">Guardar pico</Button>
            <Button type="button" variant="outline" onClick={() => setEditNozzle(null)}>Cancelar</Button>
          </form>
        ) : null}
        <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          const number = Number(pump.number);
          if (!number) { toast.error("El surtidor necesita un número"); return; }
          void apiSend("/api/estacion/equipos/surtidor", "POST", { number, name: pump.name || `Surtidor ${number}` }).then(async () => { toast.success("Surtidor dado de alta"); setPump({ number: "", name: "" }); await refresh(); }).catch(fail);
        }}>
          <Input aria-label="Número de surtidor" placeholder="Número" value={pump.number} onChange={(event) => setPump({ ...pump, number: event.target.value })} className="w-24" />
          <Input aria-label="Nombre del surtidor" placeholder="Nombre" value={pump.name} onChange={(event) => setPump({ ...pump, name: event.target.value })} />
          <Button type="submit" variant="outline">Alta de surtidor</Button>
        </form>
        <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          const opening = nozzle.opening.trim() ? parseLocaleNumber(nozzle.opening) : 0;
          if (!nozzle.pumpId || !nozzle.productId || !nozzle.tankId) { toast.error("Elegí surtidor, combustible y tanque"); return; }
          if (opening == null || opening < 0) { toast.error("La lectura inicial tiene que ser un número"); return; }
          const chosen = { pumpId: nozzle.pumpId, productId: nozzle.productId };
          void apiSend("/api/estacion/equipos/pico", "POST", { ...nozzle, number: Number(nozzle.number), opening }).then(async () => { toast.success("Pico dado de alta"); setNozzle({ ...nozzle, pumpId: chosen.pumpId, productId: chosen.productId, number: "1", tankId: "", opening: "" }); await refresh(); }).catch(fail);
        }}>
          <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Surtidor del pico" value={nozzle.pumpId} onChange={(event) => setNozzle({ ...nozzle, pumpId: event.target.value })}>
            <option value="">Surtidor</option>
            {board.pumps.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.number} · {item.name}</option>)}
          </select>
          <Input className="w-20" aria-label="Número de pico" value={nozzle.number} onChange={(event) => setNozzle({ ...nozzle, number: event.target.value })} />
          <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Combustible del pico" value={nozzle.productId} onChange={(event) => setNozzle({ ...nozzle, productId: event.target.value })}>
            <option value="">Combustible</option>
            {board.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Tanque del pico" value={nozzle.tankId} onChange={(event) => setNozzle({ ...nozzle, tankId: event.target.value })}>
            <option value="">Tanque</option>
            {board.tanks.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {formatQty(Number(item.capacity))}</option>)}
          </select>
          <Input className="w-28" aria-label="Lectura inicial" placeholder="Aforador inicial" value={nozzle.opening} onChange={(event) => setNozzle({ ...nozzle, opening: event.target.value })} />
          <Button type="submit" variant="outline">Alta de pico</Button>
        </form>
        <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          const reading = parseLocaleNumber(reset.reading);
          if (!reset.nozzleId) { toast.error("Elegí el pico"); return; }
          if (reading == null || reading < 0) { toast.error("La lectura nueva tiene que ser un número"); return; }
          void apiSend("/api/estacion/equipos/reinicio", "POST", { nozzleId: reset.nozzleId, reading, note: reset.note }).then(async () => { toast.success("Aforador reiniciado. El próximo turno abre en esa lectura."); setReset({ ...reset, reading: "" }); await refresh(); }).catch(fail);
        }}>
          <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Pico a reiniciar" value={reset.nozzleId} onChange={(event) => setReset({ ...reset, nozzleId: event.target.value })}>
            <option value="">Pico</option>
            {board.nozzles.map((item) => <option key={item.id} value={item.id}>Pico {item.number} · {item.product_name}</option>)}
          </select>
          <Input className="w-32" aria-label="Lectura del aforador nuevo" placeholder="Lectura nueva" value={reset.reading} onChange={(event) => setReset({ ...reset, reading: event.target.value })} />
          <Button type="submit" variant="outline">Cambiar aforador</Button>
        </form>
      </section>
      <section className="grid gap-3">
        <h2 className="text-xl">Tanques</h2>
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {board.tanks.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="font-semibold">{item.name} · {item.product_name} · {formatQty(Number(item.capacity))} {item.active ? "" : "· desactivado"}</p>
              {board.sticks.filter((stick) => stick.tank_id === item.id).slice(0, 3).map((stick) => (
                <p key={stick.measured_at} className="text-muted-foreground">Varilla {formatQty(Number(stick.liters))}{stick.note ? ` · ${stick.note}` : ""}</p>
              ))}
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={() => setEditTank(item)}>Editar</Button>
                <Button variant="outline" onClick={() => {
                  const run = () => apiSend(`/api/estacion/equipos/tanque/${item.id}`, "PATCH", { name: item.name, productId: item.product_id, capacity: Number(item.capacity), active: !item.active });
                  if (item.active && item.sticks > 0) ask("Desactivar tanque", "Este tanque tiene varillaje. Queda inactivo y el historial se conserva.", run);
                  else void run().then(() => refresh()).catch(fail);
                }}>{item.active ? "Desactivar" : "Activar"}</Button>
              </div>
              {editTank?.id === item.id ? (
                <form noValidate className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => {
                  event.preventDefault();
                  const capacity = parseLocaleNumber(String(editTank.capacity));
                  if (capacity == null) { toast.error("La capacidad tiene que ser un número"); return; }
                  void apiSend(`/api/estacion/equipos/tanque/${item.id}`, "PATCH", { name: editTank.name, productId: editTank.product_id, capacity, active: editTank.active }).then(async () => { toast.success("Tanque actualizado"); setEditTank(null); await refresh(); }).catch(fail);
                }}>
                  <Input aria-label="Nombre" value={editTank.name} onChange={(event) => setEditTank({ ...editTank, name: event.target.value })} />
                  <Input className="w-28" aria-label="Capacidad" value={String(editTank.capacity)} onChange={(event) => setEditTank({ ...editTank, capacity: event.target.value })} />
                  <Button type="submit">Guardar</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault();
          const capacity = parseLocaleNumber(tank.capacity);
          const initialLiters = tank.initialLiters.trim() ? parseLocaleNumber(tank.initialLiters) : undefined;
          if (!tank.name.trim() || !tank.productId || capacity == null) { toast.error("Completá nombre, combustible y capacidad"); return; }
          if (initialLiters != null && initialLiters > capacity) { toast.error("La varilla inicial no puede superar la capacidad del tanque"); return; }
          const productId = tank.productId;
          void apiSend("/api/estacion/equipos/tanque", "POST", { name: tank.name.trim(), productId, capacity, ...(initialLiters != null ? { initialLiters } : {}) }).then(async () => { toast.success("Tanque dado de alta"); setTank({ name: "", productId, capacity: "20000", initialLiters: "" }); await refresh(); }).catch(fail);
        }}>
          <Input aria-label="Nombre del tanque" placeholder="Nombre" value={tank.name} onChange={(event) => setTank({ ...tank, name: event.target.value })} />
          <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Combustible del tanque" value={tank.productId} onChange={(event) => setTank({ ...tank, productId: event.target.value })}>
            <option value="">Combustible</option>
            {board.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <Input className="w-28" aria-label="Capacidad" placeholder="Capacidad" value={tank.capacity} onChange={(event) => setTank({ ...tank, capacity: event.target.value })} />
          <Input className="w-28" aria-label="Varilla inicial" placeholder="Varilla inicial" value={tank.initialLiters} onChange={(event) => setTank({ ...tank, initialLiters: event.target.value })} />
          <Button type="submit" variant="outline">Alta de tanque</Button>
        </form>
      </section>
      {board.canTrucks ? (
        <section className="grid gap-3">
          <h2 className="text-xl">Camiones</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {board.trucks.map((item) => {
              const stock = board.compartments.filter((part) => part.truck_id === item.id).reduce((sum, part) => sum + Number(part.quantity), 0);
              return (
                <li key={item.id} className="px-4 py-3">
                  <p className="font-semibold">{item.plate} · {item.name} {item.active ? "" : "· desactivado"}</p>
                  <p className="text-muted-foreground">{item.description || "Sin descripción"} · km inicial {formatQty(Number(item.km_initial))}</p>
                  {board.compartments.filter((part) => part.truck_id === item.id).map((part) => (
                    <p key={part.id} className="text-muted-foreground">{part.name} · {part.product_name} · capacidad {formatQty(Number(part.capacity))} · stock {formatQty(Number(part.quantity))}</p>
                  ))}
                  <div className="mt-2 flex gap-2">
                    <Button variant="outline" onClick={() => setEditTruck(item)}>Editar</Button>
                    <Button variant="outline" onClick={() => {
                      if (item.active && stock > 0) { toast.error(`Ese camión todavía tiene ${formatQty(stock)} litros. Vacialo antes de desactivarlo.`); return; }
                      void apiSend(`/api/estacion/equipos/camion/${item.id}`, "PATCH", { plate: item.plate, name: item.name, description: item.description, driverUserId: item.driver_user_id, kmInitial: Number(item.km_initial), active: !item.active }).then(() => refresh()).catch(fail);
                    }}>{item.active ? "Desactivar" : "Activar"}</Button>
                  </div>
                  {editTruck?.id === item.id ? (
                    <form noValidate className="mt-2 flex flex-wrap gap-2" onSubmit={(event) => {
                      event.preventDefault();
                      const invalid = plateError(editTruck.plate);
                      if (invalid) { toast.error(invalid); return; }
                      void apiSend(`/api/estacion/equipos/camion/${item.id}`, "PATCH", { plate: editTruck.plate, name: editTruck.name, description: editTruck.description, driverUserId: editTruck.driver_user_id, kmInitial: Number(editTruck.km_initial), active: editTruck.active }).then(async () => { toast.success("Camión actualizado"); setEditTruck(null); await refresh(); }).catch(fail);
                    }}>
                      <Input className="w-32" aria-label="Patente" value={editTruck.plate} onChange={(event) => setEditTruck({ ...editTruck, plate: event.target.value })} />
                      <Input aria-label="Nombre" value={editTruck.name} onChange={(event) => setEditTruck({ ...editTruck, name: event.target.value })} />
                      <Button type="submit">Guardar</Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <form noValidate className="flex flex-wrap gap-2" onSubmit={(event) => {
            event.preventDefault();
            const capacity = parseLocaleNumber(truck.capacity);
            const kmInitial = parseLocaleNumber(truck.kmInitial) ?? 0;
            const invalid = plateError(truck.plate);
            if (invalid) { toast.error(invalid); return; }
            if (!truck.name.trim() || !truck.productId || capacity == null) { toast.error("Completá patente, nombre, combustible y capacidad"); return; }
            const productId = truck.productId;
            void apiSend("/api/estacion/equipos/camion", "POST", {
              plate: truck.plate.trim(),
              name: truck.name.trim(),
              description: truck.description,
              driverUserId: truck.driverUserId || null,
              kmInitial,
              compartments: [{ name: "Compartimento 1", productId, capacity }],
            }).then(async () => { toast.success("Camión dado de alta"); setTruck({ plate: "", name: "", description: "", driverUserId: "", kmInitial: "0", productId, capacity: "5000" }); await refresh(); }).catch(fail);
          }}>
            <Input aria-label="Patente" placeholder="Patente" value={truck.plate} onChange={(event) => setTruck({ ...truck, plate: event.target.value })} className="w-32" />
            <Input aria-label="Nombre del camión" placeholder="Nombre" value={truck.name} onChange={(event) => setTruck({ ...truck, name: event.target.value })} />
            <Input aria-label="Descripción" placeholder="Descripción" value={truck.description} onChange={(event) => setTruck({ ...truck, description: event.target.value })} />
            <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Chofer asignado" value={truck.driverUserId} onChange={(event) => setTruck({ ...truck, driverUserId: event.target.value })}>
              <option value="">Chofer</option>
              {board.drivers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Input className="w-28" aria-label="Km inicial" placeholder="Km inicial" value={truck.kmInitial} onChange={(event) => setTruck({ ...truck, kmInitial: event.target.value })} />
            <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Combustible del compartimento" value={truck.productId} onChange={(event) => setTruck({ ...truck, productId: event.target.value })}>
              <option value="">Combustible</option>
              {board.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <Input className="w-28" aria-label="Capacidad del compartimento" placeholder="Capacidad" value={truck.capacity} onChange={(event) => setTruck({ ...truck, capacity: event.target.value })} />
            <Button type="submit" variant="outline">Alta de camión</Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
