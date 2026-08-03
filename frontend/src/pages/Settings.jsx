import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Save,
  KeyRound,
  User as UserIcon,
  Building2,
  Info,
  Database,
} from "lucide-react";

export default function Settings() {
  const navigate = useNavigate();
  const { user, settings, refreshSettings } = useAuth();
  const [appName, setAppName] = useState(settings.app_name);
  const [tagline, setTagline] = useState(settings.tagline);
  const [busy, setBusy] = useState(false);

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const [unCurrent, setUnCurrent] = useState("");
  const [unNew, setUnNew] = useState("");
  const [unBusy, setUnBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreInputRef = useRef(null);

  const saveApp = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch("/settings", { app_name: appName, tagline });
      await refreshSettings();
      toast.success("App details updated");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const changePw = async (e) => {
    e.preventDefault();
    if (!pwCurrent || !pwNew) return toast.error("Fill both password fields");
    setPwBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: pwCurrent, new_password: pwNew });
      setPwCurrent(""); setPwNew("");
      toast.success("Password changed");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    } finally {
      setPwBusy(false);
    }
  };

  const changeUn = async (e) => {
    e.preventDefault();
    if (!unCurrent || !unNew) return toast.error("Fill both fields");
    setUnBusy(true);
    try {
      await api.post("/auth/change-username", { current_password: unCurrent, new_username: unNew });
      setUnCurrent(""); setUnNew("");
      toast.success("Username changed. Refresh to see updates.");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    } finally {
      setUnBusy(false);
    }
  };

  const handleBackup = async () => {
    setBackupBusy(true);
    try {
      const response = await api.post("/backup", null, { responseType: "blob" });
      const contentDisposition = response.headers["content-disposition"] || "";
      const match = contentDisposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `FABRITRACK_Backup_${new Date().toISOString().slice(0, 10)}.sql`;
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/sql" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success("Database backup downloaded successfully");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Backup failed");
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreSelect = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".sql")) {
      toast.error("Please select a .sql file");
      event.target.value = "";
      return;
    }
    if (!window.confirm("This will restore the database from the selected backup. Continue?")) {
      event.target.value = "";
      return;
    }

    setRestoreBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post("/restore", formData, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Database restored successfully");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Restore failed");
    } finally {
      setRestoreBusy(false);
      event.target.value = "";
    }
  };

  return (
    <div data-testid="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Rebrand the ERP, change your login, or update your password"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Card className="p-6 rounded-md shadow-sm border border-slate-200 bg-white">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="h-5 w-5 text-slate-700" />
            <h3 className="font-heading font-semibold text-slate-900">App Branding</h3>
          </div>
          <form onSubmit={saveApp} className="space-y-3">
            <div>
              <Label>App Name</Label>
              <Input data-testid="settings-appname" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="e.g. My Garment ERP" />
            </div>
            <div>
              <Label>Tagline</Label>
              <Input data-testid="settings-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Manufacturing ERP" />
            </div>
            <Button data-testid="settings-appname-save" type="submit" disabled={busy} className="bg-slate-900 hover:bg-slate-800">
              <Save className="h-4 w-4 mr-2" /> Save Branding
            </Button>
          </form>
        </Card>

        <Card className="p-6 rounded-md shadow-sm border border-slate-200 bg-white">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="h-5 w-5 text-slate-700" />
            <h3 className="font-heading font-semibold text-slate-900">Change Password</h3>
          </div>
          <form onSubmit={changePw} className="space-y-3">
            <div>
              <Label>Current Password</Label>
              <Input data-testid="settings-pw-current" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
            </div>
            <div>
              <Label>New Password</Label>
              <Input data-testid="settings-pw-new" type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            </div>
            <Button data-testid="settings-pw-save" type="submit" disabled={pwBusy} className="bg-slate-900 hover:bg-slate-800">
              <KeyRound className="h-4 w-4 mr-2" /> Update Password
            </Button>
          </form>
        </Card>

        <Card className="p-6 rounded-md shadow-sm border border-slate-200 bg-white lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <UserIcon className="h-5 w-5 text-slate-700" />
            <h3 className="font-heading font-semibold text-slate-900">Change Username</h3>
          </div>
          <div className="text-sm text-slate-500 mb-4">
            Currently logged in as <b>{user?.username}</b>. Enter your current password to authorize this change.
          </div>
          <form onSubmit={changeUn} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Current Password</Label>
              <Input data-testid="settings-un-current" type="password" value={unCurrent} onChange={(e) => setUnCurrent(e.target.value)} />
            </div>
            <div>
              <Label>New Username</Label>
              <Input data-testid="settings-un-new" value={unNew} onChange={(e) => setUnNew(e.target.value)} placeholder="new username" />
            </div>
            <Button data-testid="settings-un-save" type="submit" disabled={unBusy} className="bg-slate-900 hover:bg-slate-800">
              <Save className="h-4 w-4 mr-2" /> Update Username
            </Button>
          </form>
        </Card>
      <Card className="p-6">
    <div className="flex items-center gap-3 mb-4">
        <Info className="h-5 w-5 text-blue-600" />
        <h2 className="text-lg font-semibold">
            About FABRITRACK
        </h2>
    </div>

    <p className="text-sm text-gray-500 mb-4">
        View application information, version, and copyright.
    </p>

    <Button onClick={() => navigate("/about")}>
        Open About
    </Button>
</Card>
<Card className="p-6">

    <div className="flex items-center gap-3 mb-4">
        <Database className="h-5 w-5 text-green-600" />
        <h2 className="text-lg font-semibold">
            Backup & Restore
        </h2>
    </div>

    <p className="text-sm text-gray-500 mb-6">
        Create a backup of your ERP database or restore a previous backup.
    </p>

    <div className="flex gap-4">

        <Button onClick={handleBackup} disabled={backupBusy}>
            {backupBusy ? "Backing up..." : "Backup Database"}
        </Button>

        <input
            ref={restoreInputRef}
            type="file"
            accept=".sql"
            className="hidden"
            onChange={handleRestoreSelect}
        />

        <Button variant="outline" onClick={() => restoreInputRef.current?.click()} disabled={restoreBusy}>
            {restoreBusy ? "Restoring..." : "Restore Database"}
        </Button>

    </div>

</Card>
    </div>
    </div>
  );
}
