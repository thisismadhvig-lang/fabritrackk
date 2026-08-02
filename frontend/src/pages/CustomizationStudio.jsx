import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Save, Plus, Boxes, Database, LayoutPanelTop, GitBranch, ListChecks, SlidersHorizontal } from "lucide-react";

const MODULE_TYPES = ["Inventory", "Ledger", "Transactions", "Master Data", "Reports", "Production", "Payments", "Custom"];
const DATA_TYPES = ["Text", "Long Text", "Number", "Decimal", "Currency", "Date", "Time", "Checkbox", "Dropdown", "Multi Select", "Auto Number", "Formula", "Relation", "Barcode", "QR Code", "Image", "Attachment"];

const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const createModuleDefinition = (overrides = {}) => ({
  id: "module",
  name: "Module",
  type: "Custom",
  status: "Active",
  records: 0,
  created_at: new Date().toISOString().slice(0, 10),
  updated_at: new Date().toISOString().slice(0, 10),
  description: "",
  icon: "Boxes",
  position: 3,
  color: "#7C3AED",
  fields: [],
  formSections: [],
  relationships: [],
  dropdowns: [],
  statuses: [],
  automations: [],
  numbering: { prefix: "MD", start: 1, length: 4, includeYear: true, resetYearly: false },
  permissions: { view: true, add: true, edit: true, delete: false, import: true, export: true, print: true },
  ...overrides,
});

const buildDefaultModules = () => [
  createModuleDefinition({ id: "dashboard", name: "Dashboard", type: "Reports", description: "Overview of business performance.", icon: "LayoutDashboard", position: 1, color: "#0F766E", numbering: { prefix: "DB", start: 1, length: 4, includeYear: true, resetYearly: false } }),
  createModuleDefinition({ id: "orders", name: "Orders", type: "Transactions", description: "Manage purchase and sale orders.", icon: "Package", position: 2, color: "#2563EB" }),
  createModuleDefinition({ id: "fabric_inventory", name: "Fabric Inventory", type: "Inventory", description: "Track fabric stock and availability.", icon: "Boxes", position: 3, color: "#7C3AED" }),
  createModuleDefinition({ id: "fabric_dispatch", name: "Fabric Dispatch", type: "Inventory", description: "Manage fabric dispatches and lot allocation.", icon: "Truck", position: 4, color: "#7C3AED", fields: [{ id: "dispatch_no", name: "Dispatch No", internal: "dispatch_no", type: "Auto Number", required: true, searchable: true, filterable: true, sortable: true, exportable: true, width: 140 }, { id: "date", name: "Date", internal: "date", type: "Date", required: true, searchable: false, filterable: true, sortable: true, exportable: true, width: 120 }], formSections: [{ title: "Primary Details", columns: 2, fields: ["dispatch_no", "date"] }], relationships: [{ type: "One to Many", target: "Ledger", direction: "outgoing" }], dropdowns: ["brands", "units"], numbering: { prefix: "FD", start: 1, length: 4, includeYear: true, resetYearly: false } }),
  createModuleDefinition({ id: "fabric_ledger", name: "Fabric Ledger", type: "Ledger", description: "Track fabric ledger movements.", icon: "BookOpen", position: 5, color: "#059669" }),
  createModuleDefinition({ id: "material_inventory", name: "Material Inventory", type: "Inventory", description: "Track material stock and availability.", icon: "Boxes", position: 6, color: "#0EA5E9" }),
  createModuleDefinition({ id: "material_dispatch", name: "Material Dispatch", type: "Transactions", description: "Manage material dispatches.", icon: "Send", position: 7, color: "#0284C7" }),
  createModuleDefinition({ id: "material_ledger", name: "Material Ledger", type: "Ledger", description: "Track material ledger movements.", icon: "BookOpen", position: 8, color: "#0891B2" }),
  createModuleDefinition({ id: "production_tracking", name: "Production Tracking", type: "Production", description: "Monitor production stages and progress.", icon: "Factory", position: 9, color: "#F59E0B" }),
  createModuleDefinition({ id: "returns_qc", name: "Returns & QC", type: "Transactions", description: "Handle returns and quality checks.", icon: "ShieldCheck", position: 10, color: "#DC2626" }),
  createModuleDefinition({ id: "payments_dashboard", name: "Payments Dashboard", type: "Payments", description: "Review payment activity.", icon: "CreditCard", position: 11, color: "#A855F7" }),
  createModuleDefinition({ id: "payables", name: "Payables", type: "Payments", description: "Manage supplier payables.", icon: "Receipt", position: 12, color: "#6D28D9" }),
  createModuleDefinition({ id: "receivables", name: "Receivables", type: "Payments", description: "Manage customer receivables.", icon: "ReceiptText", position: 13, color: "#8B5CF6" }),
  createModuleDefinition({ id: "transactions", name: "Transactions", type: "Transactions", description: "Centralize transaction records.", icon: "ArrowRightLeft", position: 14, color: "#475569" }),
  createModuleDefinition({ id: "reports", name: "Reports", type: "Reports", description: "Create and view ERP reports.", icon: "BarChart3", position: 15, color: "#0F766E" }),
  createModuleDefinition({ id: "customers", name: "Customers", type: "Master Data", description: "Manage customer records.", icon: "Users", position: 16, color: "#EA580C" }),
  createModuleDefinition({ id: "suppliers_vendors", name: "Suppliers / Vendors", type: "Master Data", description: "Manage supplier and vendor records.", icon: "Building2", position: 17, color: "#B45309" }),
];

const mergeModules = (modules) => {
  const merged = [...buildDefaultModules()];
  normalizeArray(modules).forEach((module) => {
    const safeModule = normalizeModule(module);
    const existingIndex = merged.findIndex((item) => item.id === safeModule.id);
    if (existingIndex === -1) {
      merged.push(safeModule);
    } else {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...safeModule,
        fields: normalizeArray(safeModule.fields),
        formSections: normalizeArray(safeModule.formSections),
        relationships: normalizeArray(safeModule.relationships),
        dropdowns: normalizeArray(safeModule.dropdowns),
        statuses: normalizeArray(safeModule.statuses),
        automations: normalizeArray(safeModule.automations),
        numbering: isPlainObject(safeModule.numbering) ? safeModule.numbering : merged[existingIndex].numbering,
        permissions: isPlainObject(safeModule.permissions) ? safeModule.permissions : merged[existingIndex].permissions,
      };
    }
  });
  return merged.sort((a, b) => (a.position || 0) - (b.position || 0));
};

const normalizeModule = (module) => {
  const safeModule = isPlainObject(module) ? module : {};
  return {
    ...safeModule,
    fields: normalizeArray(safeModule.fields),
    formSections: normalizeArray(safeModule.formSections),
    relationships: normalizeArray(safeModule.relationships),
    dropdowns: normalizeArray(safeModule.dropdowns),
    statuses: normalizeArray(safeModule.statuses),
    automations: normalizeArray(safeModule.automations),
    numbering: isPlainObject(safeModule.numbering)
      ? safeModule.numbering
      : { prefix: "FD", start: 1, length: 4, includeYear: true, resetYearly: false },
    permissions: isPlainObject(safeModule.permissions)
      ? safeModule.permissions
      : { view: true, add: true, edit: true, delete: false, import: true, export: true, print: true },
  };
};

const normalizeDropdown = (dropdown) => {
  const safeDropdown = isPlainObject(dropdown) ? dropdown : {};
  return {
    ...safeDropdown,
    values: normalizeArray(safeDropdown.values),
  };
};

const normalizeCustomization = (value) => {
  const source = isPlainObject(value) ? value : {};
  return {
    ...initialCustomization,
    ...source,
    modules: mergeModules(source.modules),
    dropdowns: normalizeArray(source.dropdowns).map(normalizeDropdown),
    statuses: normalizeArray(source.statuses),
    automations: normalizeArray(source.automations),
  };
};

const initialCustomization = {
  modules: buildDefaultModules(),
  dropdowns: [
    { id: "brands", name: "Brands", values: ["TROPICAL", "LEGEND", "AUSTYN"] },
    { id: "units", name: "Units", values: ["KG", "PCS", "ROLL", "METER"] },
    { id: "payment-modes", name: "Payment Modes", values: ["Cash", "Bank", "UPI", "Cheque"] },
    { id: "statuses", name: "Statuses", values: ["Pending", "Completed", "Cancelled"] },
  ],
  statuses: [
    { id: "pending", name: "Pending", color: "#F59E0B", icon: "Clock3", order: 1, active: true },
    { id: "in-progress", name: "In Progress", color: "#2563EB", icon: "Loader", order: 2, active: true },
    { id: "completed", name: "Completed", color: "#16A34A", icon: "CheckCircle2", order: 3, active: true },
  ],
  automations: [
    { id: "auto-1", name: "Dispatch creates ledger", trigger: "Fabric Dispatch Created", condition: "Always", action: "Create Ledger Entry", enabled: true },
  ],
};

export default function CustomizationStudio() {
  const [config, setConfig] = useState(initialCustomization);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draftModule, setDraftModule] = useState({ name: "", type: "Custom", description: "", icon: "Boxes", position: 3, color: "#7C3AED", active: true });
  const [draftField, setDraftField] = useState({ name: "", internal: "", type: "Text", required: false, unique: false, readOnly: false, hidden: false, defaultValue: "", placeholder: "", searchable: true, filterable: true, sortable: true, exportable: true, width: 140 });
  const [draftStatus, setDraftStatus] = useState({ name: "", color: "#F59E0B", icon: "Clock3", order: 1, active: true });
  const [draftAutomation, setDraftAutomation] = useState({ name: "", trigger: "Fabric Dispatch Created", condition: "Always", action: "Create Ledger Entry", enabled: true });
  const [selectedModuleId, setSelectedModuleId] = useState("fabric_dispatch");
  const [editingFieldId, setEditingFieldId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.get("/settings/customization");
        const rawCustomization = response.data?.customization;
        const fallbackCustomization = response.data?.customization_data ? JSON.parse(response.data.customization_data) : initialCustomization;
        const parsedCustomization = isPlainObject(rawCustomization) ? rawCustomization : fallbackCustomization;
        setConfig(normalizeCustomization(parsedCustomization));
      } catch {
        setConfig(initialCustomization);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const saveCustomization = async () => {
    setBusy(true);
    try {
      await api.patch("/settings/customization", { customization: config });
      toast.success("Customization saved successfully");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Unable to save customization");
    } finally {
      setBusy(false);
    }
  };

  const addModule = () => {
    if (!draftModule.name.trim()) {
      toast.error("Module name is required");
      return;
    }
    const moduleItem = createModuleDefinition({
      id: `${draftModule.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`,
      name: draftModule.name,
      type: draftModule.type,
      status: draftModule.active ? "Active" : "Inactive",
      description: draftModule.description,
      icon: draftModule.icon,
      position: draftModule.position,
      color: draftModule.color,
      numbering: { prefix: draftModule.name.slice(0, 2).toUpperCase(), start: 1, length: 4, includeYear: true, resetYearly: false },
    });
    setConfig((prev) => ({ ...prev, modules: [moduleItem, ...normalizeArray(prev.modules)] }));
    setSelectedModuleId(moduleItem.id);
    setDraftModule({ name: "", type: "Custom", description: "", icon: "Boxes", position: 3, color: "#7C3AED", active: true });
    toast.success("Module created");
  };

  const saveField = (moduleId) => {
    if (!draftField.name.trim() || !draftField.internal.trim()) {
      toast.error("Field name and internal name are required");
      return;
    }
    const field = { id: `${draftField.internal}_${Date.now()}`, ...draftField };
    setConfig((prev) => ({
      ...prev,
      modules: normalizeArray(prev.modules).map((mod) => {
        const safeModule = normalizeModule(mod);
        if (safeModule.id !== moduleId) return safeModule;
        const existingFields = normalizeArray(safeModule.fields);
        const updatedFields = editingFieldId
          ? existingFields.map((item) => (item.id === editingFieldId ? { ...item, ...draftField } : item))
          : [...existingFields, field];
        return { ...safeModule, fields: updatedFields };
      }),
    }));
    setEditingFieldId(null);
    setDraftField({ name: "", internal: "", type: "Text", required: false, unique: false, readOnly: false, hidden: false, defaultValue: "", placeholder: "", searchable: true, filterable: true, sortable: true, exportable: true, width: 140 });
    toast.success(editingFieldId ? "Field updated" : "Field added");
  };

  const editField = (field) => {
    setEditingFieldId(field.id);
    setDraftField({
      name: field.name || "",
      internal: field.internal || "",
      type: field.type || "Text",
      required: Boolean(field.required),
      unique: Boolean(field.unique),
      readOnly: Boolean(field.readOnly),
      hidden: Boolean(field.hidden),
      defaultValue: field.defaultValue || "",
      placeholder: field.placeholder || "",
      searchable: Boolean(field.searchable),
      filterable: Boolean(field.filterable),
      sortable: Boolean(field.sortable),
      exportable: Boolean(field.exportable),
      width: field.width || 140,
    });
  };

  const duplicateField = (moduleId, field) => {
    const duplicate = { ...field, id: `${field.internal || field.name}_${Date.now()}`, name: `${field.name} Copy` };
    setConfig((prev) => ({
      ...prev,
      modules: normalizeArray(prev.modules).map((mod) => {
        const safeModule = normalizeModule(mod);
        return safeModule.id === moduleId ? { ...safeModule, fields: [...normalizeArray(safeModule.fields), duplicate] } : safeModule;
      }),
    }));
    toast.success("Field duplicated");
  };

  const deleteField = (moduleId, fieldId) => {
    setConfig((prev) => ({
      ...prev,
      modules: normalizeArray(prev.modules).map((mod) => {
        const safeModule = normalizeModule(mod);
        return safeModule.id === moduleId ? { ...safeModule, fields: normalizeArray(safeModule.fields).filter((field) => field.id !== fieldId) } : safeModule;
      }),
    }));
    if (editingFieldId === fieldId) {
      setEditingFieldId(null);
      setDraftField({ name: "", internal: "", type: "Text", required: false, unique: false, readOnly: false, hidden: false, defaultValue: "", placeholder: "", searchable: true, filterable: true, sortable: true, exportable: true, width: 140 });
    }
    toast.success("Field deleted");
  };

  const updateModule = (moduleId, patch) => {
    setConfig((prev) => ({
      ...prev,
      modules: normalizeArray(prev.modules).map((module) => {
        const safeModule = normalizeModule(module);
        return safeModule.id === moduleId ? { ...safeModule, ...patch } : safeModule;
      }),
    }));
  };

  const deleteModule = (moduleId) => {
    const module = normalizeArray(config.modules).find((item) => item.id === moduleId);
    if (!module) return;
    if (module.type === "Custom" || module.id.startsWith("module_")) {
      setConfig((prev) => ({ ...prev, modules: normalizeArray(prev.modules).filter((item) => item.id !== moduleId) }));
      if (selectedModuleId === moduleId) {
        const fallback = normalizeArray(config.modules).find((item) => item.id !== moduleId);
        setSelectedModuleId(fallback?.id || "fabric_dispatch");
      }
      toast.success("Module deleted");
      return;
    }
    toast.error("Built-in ERP modules cannot be deleted");
  };

  const addStatus = () => {
    if (!draftStatus.name.trim()) {
      toast.error("Status name is required");
      return;
    }
    const status = { id: `${draftStatus.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`, ...draftStatus };
    setConfig((prev) => ({ ...prev, statuses: [...normalizeArray(prev.statuses), status] }));
    setDraftStatus({ name: "", color: "#F59E0B", icon: "Clock3", order: 1, active: true });
    toast.success("Status created");
  };

  const addAutomation = () => {
    if (!draftAutomation.name.trim()) {
      toast.error("Automation name is required");
      return;
    }
    const automation = { id: `${draftAutomation.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`, ...draftAutomation };
    setConfig((prev) => ({ ...prev, automations: [...normalizeArray(prev.automations), automation] }));
    setDraftAutomation({ name: "", trigger: "Fabric Dispatch Created", condition: "Always", action: "Create Ledger Entry", enabled: true });
    toast.success("Automation rule created");
  };

  const updateModuleNumbering = (field, value) => {
    setConfig((prev) => ({
      ...prev,
      modules: normalizeArray(prev.modules).map((module) => {
        const safeModule = normalizeModule(module);
        return safeModule.id === selectedModule?.id
          ? { ...safeModule, numbering: { ...(isPlainObject(safeModule.numbering) ? safeModule.numbering : {}), [field]: value } }
          : safeModule;
      }),
    }));
  };

  const updatePermissions = (key) => {
    setConfig((prev) => ({
      ...prev,
      modules: normalizeArray(prev.modules).map((module) => {
        const safeModule = normalizeModule(module);
        return safeModule.id === selectedModule?.id
          ? { ...safeModule, permissions: { ...(isPlainObject(safeModule.permissions) ? safeModule.permissions : {}), [key]: !safeModule.permissions?.[key] } }
          : safeModule;
      }),
    }));
  };

  const modules = useMemo(() => mergeModules(normalizeArray(config.modules)), [config.modules]);
  const selectedModule = useMemo(() => {
    const current = modules.find((module) => module.id === selectedModuleId) || modules[0];
    return normalizeModule(current || createModuleDefinition());
  }, [modules, selectedModuleId]);

  return (
    <div className="space-y-6" data-testid="customization-studio-page">
      <PageHeader title="ERP Customization Studio" subtitle="Create modules, fields, forms, dropdowns, permissions, and automations without touching code" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Badge className="bg-slate-900 text-white">Odoo Studio-inspired</Badge>
          <Badge variant="outline">No-code builder</Badge>
        </div>
        <Button onClick={saveCustomization} disabled={busy} className="bg-slate-900 hover:bg-slate-800">
          <Save className="h-4 w-4 mr-2" /> {busy ? "Saving..." : "Save Configuration"}
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <Label className="mb-2 block">Select Module</Label>
        <select
          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          value={selectedModule?.id || ""}
          onChange={(e) => setSelectedModuleId(e.target.value)}
        >
          {modules.map((module) => (
            <option key={module.id} value={module.id}>{module.name}</option>
          ))}
        </select>
      </div>

      <Tabs defaultValue="modules" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-6 gap-2 h-auto p-1">
          <TabsTrigger value="modules"><Boxes className="h-4 w-4 mr-2" />Modules</TabsTrigger>
          <TabsTrigger value="fields"><LayoutPanelTop className="h-4 w-4 mr-2" />Fields</TabsTrigger>
          <TabsTrigger value="forms"><SlidersHorizontal className="h-4 w-4 mr-2" />Forms</TabsTrigger>
          <TabsTrigger value="relationships"><GitBranch className="h-4 w-4 mr-2" />Relationships</TabsTrigger>
          <TabsTrigger value="dropdowns"><ListChecks className="h-4 w-4 mr-2" />Dropdowns</TabsTrigger>
          <TabsTrigger value="statuses"><ListChecks className="h-4 w-4 mr-2" />Statuses</TabsTrigger>
          <TabsTrigger value="numbering"><Database className="h-4 w-4 mr-2" />Numbering</TabsTrigger>
          <TabsTrigger value="permissions"><Boxes className="h-4 w-4 mr-2" />Permissions</TabsTrigger>
          <TabsTrigger value="automation"><Database className="h-4 w-4 mr-2" />Automation</TabsTrigger>
          <TabsTrigger value="backup"><Database className="h-4 w-4 mr-2" />Backup</TabsTrigger>
          <TabsTrigger value="layout"><LayoutPanelTop className="h-4 w-4 mr-2" />Layout</TabsTrigger>
        </TabsList>

        <TabsContent value="modules" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Label>Module Name</Label>
                <Input value={draftModule.name} onChange={(e) => setDraftModule((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Warehouse Transfers" />
                <Label>Module Type</Label>
                <select className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={draftModule.type} onChange={(e) => setDraftModule((prev) => ({ ...prev, type: e.target.value }))}>
                  {MODULE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <Label>Description</Label>
                <Input value={draftModule.description} onChange={(e) => setDraftModule((prev) => ({ ...prev, description: e.target.value }))} placeholder="Describe the purpose" />
              </div>
              <div className="space-y-3">
                <Label>Sidebar Icon</Label>
                <Input value={draftModule.icon} onChange={(e) => setDraftModule((prev) => ({ ...prev, icon: e.target.value }))} placeholder="Boxes" />
                <Label>Sidebar Position</Label>
                <Input type="number" value={draftModule.position} onChange={(e) => setDraftModule((prev) => ({ ...prev, position: Number(e.target.value) }))} />
                <Label>Color</Label>
                <Input type="color" value={draftModule.color} onChange={(e) => setDraftModule((prev) => ({ ...prev, color: e.target.value }))} />
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" checked={draftModule.active} onChange={(e) => setDraftModule((prev) => ({ ...prev, active: e.target.checked }))} />
                  <Label className="mb-0">Active</Label>
                </div>
                <Button onClick={addModule} className="w-full bg-slate-900 hover:bg-slate-800">
                  <Plus className="h-4 w-4 mr-2" /> Create Module
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-3 py-2">Module Name</th>
                    <th className="px-3 py-2">Module Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Records</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map((module) => (
                    <tr key={module.id} className="border-b border-slate-100">
                      <td className="px-3 py-3 font-medium">{module.name}</td>
                      <td className="px-3 py-3">{module.type}</td>
                      <td className="px-3 py-3"><Badge variant={module.status === "Active" ? "default" : "secondary"}>{module.status}</Badge></td>
                      <td className="px-3 py-3">{module.records}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => setSelectedModuleId(module.id)}>Edit</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => updateModule(module.id, { status: module.status === "Active" ? "Inactive" : "Active" })}>{module.status === "Active" ? "Disable" : "Enable"}</Button>
                          {module.type === "Custom" || module.id.startsWith("module_") ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => deleteModule(module.id)}>Delete</Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="fields" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Label>Field Name</Label>
                <Input value={draftField.name} onChange={(e) => setDraftField((prev) => ({ ...prev, name: e.target.value }))} />
                <Label>Internal Field Name</Label>
                <Input value={draftField.internal} onChange={(e) => setDraftField((prev) => ({ ...prev, internal: e.target.value }))} />
                <Label>Data Type</Label>
                <select className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={draftField.type} onChange={(e) => setDraftField((prev) => ({ ...prev, type: e.target.value }))}>
                  {DATA_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <Label>Default Value</Label>
                <Input value={draftField.defaultValue} onChange={(e) => setDraftField((prev) => ({ ...prev, defaultValue: e.target.value }))} />
              </div>
              <div className="space-y-3">
                <Label>Placeholder</Label>
                <Input value={draftField.placeholder} onChange={(e) => setDraftField((prev) => ({ ...prev, placeholder: e.target.value }))} />
                <Label>Column Width</Label>
                <Input type="number" value={draftField.width} onChange={(e) => setDraftField((prev) => ({ ...prev, width: Number(e.target.value) }))} />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[["required", "Required"], ["unique", "Unique"], ["readOnly", "Read Only"], ["hidden", "Hidden"], ["searchable", "Searchable"], ["filterable", "Filterable"], ["sortable", "Sortable"], ["exportable", "Exportable"]].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input type="checkbox" checked={draftField[key]} onChange={(e) => setDraftField((prev) => ({ ...prev, [key]: e.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => saveField(selectedModule?.id)} className="flex-1 bg-slate-900 hover:bg-slate-800">
                    <Plus className="h-4 w-4 mr-2" /> {editingFieldId ? "Save Field" : "Add Field"}
                  </Button>
                  {editingFieldId ? (
                    <Button type="button" variant="outline" onClick={() => { setEditingFieldId(null); setDraftField({ name: "", internal: "", type: "Text", required: false, unique: false, readOnly: false, hidden: false, defaultValue: "", placeholder: "", searchable: true, filterable: true, sortable: true, exportable: true, width: 140 }); }}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Fields for {selectedModule?.name || "selected module"}</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-600">
                    <th className="px-3 py-2">Field Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Required</th>
                    <th className="px-3 py-2">Searchable</th>
                    <th className="px-3 py-2">Exportable</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {normalizeArray(selectedModule?.fields).map((field) => (
                    <tr key={field.id} className="border-b border-slate-100">
                      <td className="px-3 py-3">{field.name}</td>
                      <td className="px-3 py-3">{field.type}</td>
                      <td className="px-3 py-3">{field.required ? "Yes" : "No"}</td>
                      <td className="px-3 py-3">{field.searchable ? "Yes" : "No"}</td>
                      <td className="px-3 py-3">{field.exportable ? "Yes" : "No"}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => editField(field)}>Edit</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => duplicateField(selectedModule?.id, field)}>Duplicate</Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => deleteField(selectedModule?.id, field.id)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="forms" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="text-sm text-slate-600">The form builder supports drag-and-drop sections, tabs, collapsible groups, and two-column layout. This studio creates a reusable visual layout plan for each module.</div>
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              Preview for {selectedModule?.name || "selected module"}: {selectedModule?.formSections?.length ? selectedModule.formSections.length : 0} section(s) configured.
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="relationships" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Relationships for {selectedModule?.name || "selected module"}</div>
            {normalizeArray(selectedModule?.relationships).length ? (
              <div className="space-y-2">
                {normalizeArray(selectedModule.relationships).map((relationship, index) => (
                  <div key={`${relationship.target}-${index}`} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
                    <div className="font-medium text-slate-900">{relationship.type}</div>
                    <div className="mt-1">Target: {relationship.target} • Direction: {relationship.direction}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No relationships configured for this module yet.</div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="dropdowns" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Dropdowns for {selectedModule?.name || "selected module"}</div>
            {normalizeArray(selectedModule?.dropdowns).length ? (
              <div className="space-y-2">
                {normalizeArray(selectedModule.dropdowns).map((dropdownId) => {
                  const dropdown = normalizeArray(config.dropdowns).find((item) => item.id === dropdownId);
                  return dropdown ? (
                    <div key={dropdown.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="font-medium text-slate-900">{dropdown.name}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {normalizeArray(dropdown.values).map((value) => <Badge key={value} variant="outline">{value}</Badge>)}
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No dropdowns are assigned to this module yet.</div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="statuses" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Label>Status Name</Label>
                <Input value={draftStatus.name} onChange={(e) => setDraftStatus((prev) => ({ ...prev, name: e.target.value }))} />
                <Label>Color</Label>
                <Input type="color" value={draftStatus.color} onChange={(e) => setDraftStatus((prev) => ({ ...prev, color: e.target.value }))} />
                <Label>Icon</Label>
                <Input value={draftStatus.icon} onChange={(e) => setDraftStatus((prev) => ({ ...prev, icon: e.target.value }))} />
              </div>
              <div className="space-y-3">
                <Label>Display Order</Label>
                <Input type="number" value={draftStatus.order} onChange={(e) => setDraftStatus((prev) => ({ ...prev, order: Number(e.target.value) }))} />
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" checked={draftStatus.active} onChange={(e) => setDraftStatus((prev) => ({ ...prev, active: e.target.checked }))} />
                  <Label className="mb-0">Active</Label>
                </div>
                <Button onClick={addStatus} className="w-full bg-slate-900 hover:bg-slate-800"><Plus className="h-4 w-4 mr-2" /> Add Status</Button>
              </div>
            </div>
          </Card>
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Statuses for {selectedModule?.name || "selected module"}</div>
            {normalizeArray(selectedModule?.statuses).length ? (
              <div className="space-y-2">
                {normalizeArray(selectedModule.statuses).map((statusId) => {
                  const status = normalizeArray(config.statuses).find((item) => item.id === statusId);
                  return status ? (
                    <div key={status.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium text-slate-900">{status.name}</div>
                        <div className="text-slate-500">Order {status.order}</div>
                      </div>
                      <Badge style={{ backgroundColor: status.color, color: "white" }}>{status.active ? "Active" : "Inactive"}</Badge>
                    </div>
                  ) : null;
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No statuses are assigned to this module yet.</div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="numbering" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Label>Prefix</Label>
                <Input value={selectedModule?.numbering?.prefix || ""} onChange={(e) => updateModuleNumbering("prefix", e.target.value)} />
                <Label>Starting Number</Label>
                <Input type="number" value={selectedModule?.numbering?.start || 1} onChange={(e) => updateModuleNumbering("start", Number(e.target.value))} />
                <Label>Number Length</Label>
                <Input type="number" value={selectedModule?.numbering?.length || 4} onChange={(e) => updateModuleNumbering("length", Number(e.target.value))} />
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" checked={selectedModule?.numbering?.includeYear || false} onChange={(e) => updateModuleNumbering("includeYear", e.target.checked)} />
                  <Label className="mb-0">Include Year</Label>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" checked={selectedModule?.numbering?.resetYearly || false} onChange={(e) => updateModuleNumbering("resetYearly", e.target.checked)} />
                  <Label className="mb-0">Reset Every Year</Label>
                </div>
                <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
                  Example: {selectedModule?.numbering?.prefix || "FD"}-{new Date().getFullYear()}-{String(selectedModule?.numbering?.start || 1).padStart(selectedModule?.numbering?.length || 4, "0")}
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="permissions" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Permissions for {selectedModule?.name || "selected module"}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(isPlainObject(selectedModule?.permissions) ? selectedModule.permissions : {}).map(([key, value]) => (
                <label key={key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="capitalize">{key}</span>
                  <input type="checkbox" checked={value} onChange={() => updatePermissions(key)} />
                </label>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Label>Rule Name</Label>
                <Input value={draftAutomation.name} onChange={(e) => setDraftAutomation((prev) => ({ ...prev, name: e.target.value }))} />
                <Label>Trigger</Label>
                <Input value={draftAutomation.trigger} onChange={(e) => setDraftAutomation((prev) => ({ ...prev, trigger: e.target.value }))} />
              </div>
              <div className="space-y-3">
                <Label>Condition</Label>
                <Input value={draftAutomation.condition} onChange={(e) => setDraftAutomation((prev) => ({ ...prev, condition: e.target.value }))} />
                <Label>Action</Label>
                <Input value={draftAutomation.action} onChange={(e) => setDraftAutomation((prev) => ({ ...prev, action: e.target.value }))} />
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" checked={draftAutomation.enabled} onChange={(e) => setDraftAutomation((prev) => ({ ...prev, enabled: e.target.checked }))} />
                  <Label className="mb-0">Enabled</Label>
                </div>
                <Button onClick={addAutomation} className="w-full bg-slate-900 hover:bg-slate-800"><Plus className="h-4 w-4 mr-2" /> Add Automation</Button>
              </div>
            </div>
          </Card>
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Automation rules for {selectedModule?.name || "selected module"}</div>
            {normalizeArray(selectedModule?.automations).length ? (
              <div className="space-y-2">
                {normalizeArray(selectedModule.automations).map((automationId) => {
                  const automation = normalizeArray(config.automations).find((item) => item.id === automationId);
                  return automation ? (
                    <div key={automation.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                      <div className="font-medium text-slate-900">{automation.name}</div>
                      <div className="mt-1 text-slate-600">Trigger: {automation.trigger} • Action: {automation.action}</div>
                    </div>
                  ) : null;
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-600">No automation rules are assigned to this module yet.</div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="backup" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="font-medium text-slate-900">Manual Backup</div>
                <div className="mt-1 text-sm text-slate-600">Create a full backup of custom modules, forms, dropdowns, and automations.</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="font-medium text-slate-900">Automatic Daily Backup</div>
                <div className="mt-1 text-sm text-slate-600">Enable scheduled backups to preserve all customization changes automatically.</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="font-medium text-slate-900">Restore Backup</div>
                <div className="mt-1 text-sm text-slate-600">Import a previous configuration package and restore the ERP layout instantly.</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="font-medium text-slate-900">Export / Import Database</div>
                <div className="mt-1 text-sm text-slate-600">Move the database snapshot between environments with one click.</div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="layout" className="space-y-4 mt-4">
          <Card className="p-5 rounded-xl border border-slate-200 bg-white">
            <div className="mb-3 text-sm font-semibold text-slate-700">Table layout preferences for {selectedModule?.name || "selected module"}</div>
            <div className="space-y-2">
              {[
                ["Dispatch No", true],
                ["Date", true],
                ["Vendor", true],
                ["Brand", true],
                ["Product", true],
                ["Quantity", true],
                ["Notes", false],
                ["Created By", false],
              ].map(([column, visible]) => (
                <label key={column} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span>{column}</span>
                  <input type="checkbox" defaultChecked={visible} />
                </label>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {loading && <div className="text-sm text-slate-500">Loading customization configuration…</div>}
    </div>
  );
}
