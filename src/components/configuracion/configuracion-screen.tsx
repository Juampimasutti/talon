"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiSend, clearSessionCache } from "@/lib/api/client";
import { ACTIONS, MODULES, actionApplies, can } from "@/lib/auth/permissions";
import { useMe } from "@/components/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const CompanyManagement = dynamic(() => import("./company-management").then((module) => module.CompanyManagement));

type Config = {
  company: {
    name: string;
    legalName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    province: string | null;
    pointOfSale: number;
    blockNegativeStock: boolean;
    allowNegativeCash?: boolean;
    enabledModules: string[];
    cuit: string;
    taxCondition: string;
  };
  fields: { id: string; entity: string; label: string; fieldType: string }[];
  categories: { id: string; kind: string; name: string }[];
  users: { id: string; name: string; email: string; roleName: string; roleId: string; active: boolean }[];
  roles: { id: string; key: string; name: string; description: string; permissions: string[] }[];
  canEdit: boolean;
};

export function ConfiguracionScreen() {
  const me = useMe();
  return me.data ? <CompanyConfiguration key={me.data.company.id} /> : <p className="p-4 text-sm">Cargando…</p>;
}

function CompanyConfiguration() {
  const me = useMe();
  const queryClient = useQueryClient();
  const config = useQuery({
    queryKey: ["config", me.data?.company.id],
    enabled: Boolean(me.data),
    queryFn: () => apiGet<Config>("/api/configuracion"),
  });
  const [companyDraft, setCompany] = useState<Config["company"] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [rolePerms, setRolePerms] = useState<string[]>([]);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldEntity, setFieldEntity] = useState("cliente");
  const [rubro, setRubro] = useState("");
  const [userForm, setUserForm] = useState({ name: "", email: "", password: "", roleId: "" });
  const [editUser, setEditUser] = useState<{ id: string; name: string; roleId: string; password: string; active: boolean } | null>(null);

  const company = companyDraft ?? config.data?.company;

  if (!config.data || !company) return <p className="p-6 text-sm">Cargando la configuración…</p>;
  const data = config.data;
  const editable = data.canEdit;

  async function saveCompany(event: React.FormEvent) {
    event.preventDefault();
    if (!company) return;
    try {
      await apiSend("/api/configuracion", "PATCH", { ...company, phone: company.phone ?? "", email: company.email ?? "", address: company.address ?? "", city: company.city ?? "", province: company.province ?? "" });
      toast.success("Empresa actualizada");
      clearSessionCache();
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo guardar");
    }
  }

  function toggleModule(key: string) {
    if (!company) return;
    const enabled = new Set(company.enabledModules);
    if (enabled.has(key)) enabled.delete(key);
    else enabled.add(key);
    setCompany({ ...company, enabledModules: [...enabled] });
  }

  function togglePerm(key: string) {
    setRolePerms((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-4xl tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          {company.legalName} · CUIT {company.cuit}. Los módulos apagados desaparecen del menú para todo el mundo.
        </p>
      </div>
      <Tabs defaultValue="empresa">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="campos">Campos</TabsTrigger>
          <TabsTrigger value="rubros">Rubros</TabsTrigger>
          <TabsTrigger value="puestos">Puestos</TabsTrigger>
          {me.data && (can(me.data.permissions, "configuracion", "crear") || can(me.data.permissions, "configuracion", "editar")) ? <TabsTrigger value="usuarios">Usuarios</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="empresa">
          <form noValidate onSubmit={saveCompany} className="mt-4 grid max-w-xl gap-3">
            <label className="grid gap-1 text-sm">Nombre comercial
              <Input value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} disabled={!editable} />
            </label>
            <label className="grid gap-1 text-sm">Razón social
              <Input value={company.legalName} onChange={(event) => setCompany({ ...company, legalName: event.target.value })} disabled={!editable} />
            </label>
            <label className="grid gap-1 text-sm">Localidad
              <Input value={company.city ?? ""} onChange={(event) => setCompany({ ...company, city: event.target.value })} disabled={!editable} />
            </label>
            <label className="text-sm">
              Punto de venta
              <Input type="number" value={company.pointOfSale} onChange={(event) => setCompany({ ...company, pointOfSale: Number(event.target.value) })} disabled={!editable} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={company.blockNegativeStock} disabled={!editable} onChange={(event) => setCompany({ ...company, blockNegativeStock: event.target.checked })} />
              No dejar vender ni sacar stock en negativo
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(company.allowNegativeCash)} disabled={!editable} onChange={(event) => setCompany({ ...company, allowNegativeCash: event.target.checked })} />
              Permitir caja en negativo
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULES.filter((module) => module.toggle && module.key !== "contabilidad").map((module) => (
                <label key={module.key} className="flex items-start gap-2 rounded-lg border p-2 text-sm">
                  <input type="checkbox" checked={company.enabledModules.includes(module.key)} disabled={!editable} onChange={() => toggleModule(module.key)} />
                  <span>
                    <span className="font-semibold">{module.label}</span>
                    <span className="block text-muted-foreground">{module.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {editable ? <Button type="submit">Guardar empresa</Button> : <p className="text-sm text-muted-foreground">Estás en modo lectura.</p>}
          </form>
          <CompanyManagement />
        </TabsContent>
        <TabsContent value="campos">
          <ul className="mt-4 divide-y rounded-xl border bg-card">
            {data.fields.map((field) => (
              <li key={field.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span>
                  {field.label} · {field.entity}
                </span>
                {editable ? (
                  <button
                    type="button"
                    className="text-destructive"
                    onClick={async () => {
                      await apiSend(`/api/campos/${field.id}`, "DELETE");
                      await queryClient.invalidateQueries({ queryKey: ["config"] });
                    }}
                  >
                    Quitar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? (
            <form
              noValidate
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!fieldLabel.trim()) { toast.error("Poné el nombre del campo"); return; }
                await apiSend("/api/campos", "POST", { entity: fieldEntity, label: fieldLabel, fieldType: "text" });
                setFieldLabel("");
                await queryClient.invalidateQueries({ queryKey: ["config"] });
                toast.success("Campo creado");
              }}
            >
              <select className="h-8 rounded-lg border px-2 text-sm" value={fieldEntity} onChange={(event) => setFieldEntity(event.target.value)}>
                <option value="cliente">Cliente</option>
                <option value="proveedor">Proveedor</option>
                <option value="articulo">Artículo</option>
              </select>
              <Input placeholder="Nombre del campo" value={fieldLabel} onChange={(event) => setFieldLabel(event.target.value)} />
              <Button type="submit">Agregar</Button>
            </form>
          ) : null}
        </TabsContent>
        <TabsContent value="rubros">
          <ul className="mt-4 divide-y rounded-xl border bg-card">
            {data.categories.map((category) => (
              <li key={category.id} className="flex justify-between px-4 py-2 text-sm">
                <span>
                  {category.name} · {category.kind}
                </span>
                {editable ? (
                  <button type="button" className="text-destructive" onClick={async () => { await apiSend(`/api/rubros/${category.id}`, "DELETE"); await queryClient.invalidateQueries({ queryKey: ["config"] }); }}>
                    Quitar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {editable ? (
            <form
              noValidate
              className="mt-3 flex gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!rubro.trim()) { toast.error("Poné el nombre del rubro"); return; }
                await apiSend("/api/rubros", "POST", { kind: "articulo", name: rubro });
                setRubro("");
                await queryClient.invalidateQueries({ queryKey: ["config"] });
              }}
            >
              <Input placeholder="Nuevo rubro de artículos" value={rubro} onChange={(event) => setRubro(event.target.value)} />
              <Button type="submit">Agregar</Button>
            </form>
          ) : null}
        </TabsContent>
        <TabsContent value="puestos">
          <div className="mt-4 flex flex-wrap gap-2">
            {data.roles.map((role) => (
              <Button
                key={role.id}
                variant={roleId === role.id ? "default" : "outline"}
                onClick={() => {
                  setRoleId(role.id);
                  setRolePerms(role.permissions);
                }}
              >
                {role.name}
              </Button>
            ))}
          </div>
          {roleId ? (
            <form
              noValidate
              className="mt-4 overflow-auto"
              onSubmit={async (event) => {
                event.preventDefault();
                const role = data.roles.find((item) => item.id === roleId);
                if (!role) return;
                try {
                  await apiSend(`/api/roles/${roleId}`, "PATCH", { name: role.name, description: role.description, permissions: rolePerms });
                  toast.success("Puesto actualizado");
                  clearSessionCache();
                  await queryClient.invalidateQueries({ queryKey: ["me"] });
                  await queryClient.invalidateQueries({ queryKey: ["config"] });
                } catch (error) {
                  toast.error(error instanceof ApiError ? error.message : "No se pudo guardar");
                }
              }}
            >
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Módulo</th>
                    {ACTIONS.map((action) => (
                      <th key={action} className="p-2 text-left">{action}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MODULES.filter((module) => module.key !== "contabilidad" && (!module.toggle || company.enabledModules.includes(module.key))).map((module) => (
                    <tr key={module.key} className="border-t">
                      <td className="p-2">{module.label}</td>
                      {ACTIONS.map((action) => {
                        const key = `${module.key}.${action}`;
                        const exists = actionApplies(module.key, action);
                        return (
                          <td key={action} className="p-2">
                            {exists ? (
                              <input type="checkbox" checked={rolePerms.includes(key)} disabled={!editable} onChange={() => togglePerm(key)} />
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {editable ? <Button className="mt-3" type="submit">Guardar puesto</Button> : null}
            </form>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Elegí un puesto para ver qué puede hacer.</p>
          )}
        </TabsContent>
        <TabsContent value="usuarios">
          <ul className="mt-4 divide-y rounded-xl border bg-card">
            {data.users.map((user) => (
              <li key={user.id} className="px-4 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{user.name} · {user.email} · {user.roleName}{user.active ? "" : " · inactivo"}</span>
                  {me.data && can(me.data.permissions, "configuracion", "editar") ? (
                    <Button variant="outline" onClick={() => setEditUser({ id: user.id, name: user.name, roleId: user.roleId, password: "", active: user.active })}>Editar</Button>
                  ) : null}
                </div>
                {editUser?.id === user.id ? (
                  <form noValidate className="mt-2 grid max-w-md gap-2" onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      await apiSend("/api/usuarios", "PATCH", {
                        userId: editUser.id,
                        name: editUser.name,
                        roleId: editUser.roleId,
                        active: editUser.active,
                        ...(editUser.password ? { password: editUser.password } : {}),
                      });
                      toast.success("Usuario actualizado");
                      setEditUser(null);
                      await queryClient.invalidateQueries({ queryKey: ["config"] });
                    } catch (error) {
                      toast.error(error instanceof ApiError ? error.message : "No se pudo editar");
                    }
                  }}>
                    <Input aria-label="Nombre" value={editUser.name} onChange={(event) => setEditUser({ ...editUser, name: event.target.value })} />
                    <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Puesto" value={editUser.roleId} onChange={(event) => setEditUser({ ...editUser, roleId: event.target.value })}>
                      {data.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                    <Input aria-label="Nueva clave" placeholder="Nueva clave, si querés resetearla" type="password" value={editUser.password} onChange={(event) => setEditUser({ ...editUser, password: event.target.value })} />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editUser.active} onChange={(event) => setEditUser({ ...editUser, active: event.target.checked })} /> Activo en esta empresa</label>
                    <div className="flex gap-2">
                      <Button type="submit">Guardar</Button>
                      <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {me.data && can(me.data.permissions, "configuracion", "crear") ? (
            <form
              noValidate
              className="mt-3 grid max-w-md gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!userForm.name.trim()) { toast.error("Poné el nombre"); return; }
                if (!userForm.email.includes("@")) { toast.error("El mail no es válido"); return; }
                if (!userForm.roleId) { toast.error("Elegí un puesto"); return; }
                try {
                  await apiSend("/api/usuarios", "POST", { ...userForm, password: userForm.password || undefined });
                  toast.success("Usuario creado");
                  setUserForm({ name: "", email: "", password: "", roleId: "" });
                  await queryClient.invalidateQueries({ queryKey: ["config"] });
                } catch (error) {
                  toast.error(error instanceof ApiError ? error.message : "No se pudo crear");
                }
              }}
            >
              <p className="text-sm text-muted-foreground">Si el mail ya existe en Talón, lo sumamos a esta empresa con el puesto elegido.</p>
              <Input placeholder="Nombre" value={userForm.name} onChange={(event) => setUserForm({ ...userForm, name: event.target.value })} />
              <Input placeholder="Mail" type="text" inputMode="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />
              <Input placeholder="Clave, solo si es nuevo" type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} />
              <select className="h-8 rounded-lg border px-2 text-sm" aria-label="Puesto" value={userForm.roleId} onChange={(event) => setUserForm({ ...userForm, roleId: event.target.value })}>
                <option value="">Puesto</option>
                {data.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <Button type="submit">Crear usuario</Button>
            </form>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
