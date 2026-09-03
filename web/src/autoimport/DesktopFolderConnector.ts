import { prefs } from "../data/AutoImportPreferences";
import { isAlreadyImported } from "../data/InvoiceDatabase";

// Persists the FileSystemDirectoryHandle in IndexedDB so the user only grants
// permission once per origin. The File System Access API requires the user to
// re-grant on page reload (the handle survives but permission must be re-verified).
const HANDLE_STORE = "fs_handles";
const HANDLE_KEY = "desktopFolder";

async function openHandleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("jinvoice_handles", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleStore();
  return new Promise((resolve) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
    req.onerror = () => resolve(null);
  });
}

function isElectronRenderer(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "127.0.0.1" || h === "localhost";
}

export async function isFsAccessSupported(): Promise<boolean> {
  if (isElectronRenderer()) return true;
  return "showDirectoryPicker" in window;
}

export class DesktopFolderConnector {
  private handle: FileSystemDirectoryHandle | null = null;

  async requestFolder(): Promise<string | null> {
    // On localhost, try the Electron native-dialog API first (works in Electron
    // where showDirectoryPicker may be restricted). Falls through to the File
    // System Access API when the endpoint doesn't exist (plain browser + prod.mjs).
    if (isElectronRenderer()) {
      try {
        const resp = await fetch("/api/pick-folder-local", { method: "POST" });
        if (resp.ok) {
          const data = await resp.json();
          if (data.canceled) return null; // user dismissed the dialog
          if (data.name) {
            prefs.desktopFolderName = data.name;
            return data.name;
          }
          return null;
        }
        // Non-OK (e.g. 404 — plain prod.mjs, not Electron): fall through to FSAPI
      } catch {
        // Network error: fall through to FSAPI
      }
    }
    if (!("showDirectoryPicker" in window)) return null;
    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: "readwrite",
        startIn: "downloads",
      }) as FileSystemDirectoryHandle;
      await saveHandle(handle);
      prefs.desktopFolderName = handle.name;
      this.handle = handle;
      return handle.name;
    } catch {
      return null;
    }
  }

  // Call this at component mount (not inside a click handler) to warm the
  // in-memory handle from IndexedDB. restoreFolder() can then skip the async
  // DB read during a click and go straight to queryPermission/requestPermission,
  // keeping the user-activation window alive for requestPermission.
  async preloadHandle(): Promise<void> {
    if (this.handle) return;
    const h = await loadHandle();
    if (h) this.handle = h;
  }

  async restoreFolder(): Promise<boolean> {
    const h = this.handle ?? await loadHandle();
    if (!h) return false;
    try {
      // queryPermission doesn't require user activation — use it first so
      // already-granted folders work even without a fresh user gesture.
      const current = await (h as any).queryPermission({ mode: "readwrite" });
      if (current === "granted") { this.handle = h; return true; }
      // requestPermission requires user activation; may throw SecurityError
      // if called outside a user gesture — catch silently in that case.
      const status = await (h as any).requestPermission({ mode: "readwrite" });
      if (status === "granted") { this.handle = h; return true; }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "SecurityError")) {
        console.error("[jInvoice] restoreFolder permission error:", err);
      }
    }
    return false;
  }

  async scanForNewPdfs(): Promise<{ file: File; key: string }[]> {
    if (!this.handle) {
      const restored = await this.restoreFolder();
      if (!restored) return [];
    }
    const results: { file: File; key: string }[] = [];
    try {
      for await (const entry of (this.handle as any).values()) {
        if (entry.kind !== "file") continue;
        const file: File = await (entry as any).getFile();
        const fname = file.name.toLowerCase();
        if (!fname.endsWith(".pdf") && !fname.endsWith(".html")) continue;

        const key = `desktop:${file.name}:${file.lastModified}`;
        if (await isAlreadyImported(key)) continue;

        results.push({ file, key });
      }
    } catch {
      // folder permission revoked
    }
    return results;
  }

  async saveInvoiceToFolder(data: Uint8Array, filename: string, subfolder?: string): Promise<boolean> {
    // Electron / local-server path: no FSAPI handle — post to the no-auth renderer endpoint
    if (isElectronRenderer()) {
      try {
        const xFilename = subfolder ? `${subfolder}/${filename}` : filename;
        const resp = await fetch("/api/save-to-folder-local", {
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
            "x-filename": xFilename,
          },
          body: data.buffer as ArrayBuffer,
        });
        return resp.ok;
      } catch (err) {
        console.error("[jInvoice] saveInvoiceToFolder (electron) failed:", err);
        return false;
      }
    }
    // Browser FSAPI path
    if (!this.handle) {
      const restored = await this.restoreFolder();
      if (!restored) return false;
    }
    try {
      let targetDir: any = this.handle;
      if (subfolder) {
        for (const part of subfolder.split("/").filter(Boolean)) {
          targetDir = await targetDir.getDirectoryHandle(part, { create: true });
        }
      }
      const fileHandle = await targetDir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch (err) {
      console.error("[jInvoice] saveInvoiceToFolder failed:", err);
      return false;
    }
  }

  // Renames a PDF file in the desktop folder (searches root + all known subfolders).
  // Returns true if the file was found and renamed.
  async deleteFileFromFolder(filename: string): Promise<boolean> {
    if (!filename) return false;
    const restored = await this.restoreFolder();
    if (!restored) return false;
    const bareFilename = filename.includes("/") ? filename.split("/").pop()! : filename;
    const SUBFOLDERS = ["Invoices", "Tax", "Coupons", "Travel", "Other"];
    const dirsToSearch: FileSystemDirectoryHandle[] = [this.handle as unknown as FileSystemDirectoryHandle];
    for (const sub of SUBFOLDERS) {
      try {
        const d = await (this.handle as any).getDirectoryHandle(sub, { create: false });
        dirsToSearch.push(d);
      } catch { /* subfolder doesn't exist */ }
    }
    // Also search dynamically-created per-shop subdirectories
    try {
      for await (const entry of (this.handle as any).values()) {
        if (entry.kind !== "directory") continue;
        if (SUBFOLDERS.includes(entry.name)) continue;
        dirsToSearch.push(entry as FileSystemDirectoryHandle);
      }
    } catch { /* permission revoked */ }
    for (const dir of dirsToSearch) {
      try {
        await (dir as any).removeEntry(bareFilename);
        return true;
      } catch { /* file not in this dir */ }
    }
    return false;
  }

  async renameFileInFolder(oldName: string, newName: string): Promise<boolean> {
    if (!oldName || !newName || oldName === newName) return false;
    const restored = await this.restoreFolder();
    if (!restored) return false;

    // Strip any subdirectory prefix from the stored filename so we can
    // search for the bare file name across all directories.
    const bareOldName = oldName.includes("/") ? oldName.split("/").pop()! : oldName;

    const SUBFOLDERS = ["Invoices", "Tax", "Coupons", "Travel", "Other"];
    const dirsToSearch: FileSystemDirectoryHandle[] = [this.handle as unknown as FileSystemDirectoryHandle];
    for (const sub of SUBFOLDERS) {
      try {
        const d = await (this.handle as any).getDirectoryHandle(sub, { create: false });
        dirsToSearch.push(d);
      } catch { /* subfolder doesn't exist */ }
    }

    // Also search any dynamically-created subdirectories (e.g. per-shop folders
    // created when mobile pushes a file with a ShopName/ prefix).
    try {
      for await (const entry of (this.handle as any).values()) {
        if (entry.kind !== "directory") continue;
        if (SUBFOLDERS.includes(entry.name)) continue; // already added above
        dirsToSearch.push(entry as FileSystemDirectoryHandle);
      }
    } catch { /* permission revoked */ }

    for (const dir of dirsToSearch) {
      try {
        const oldHandle = await (dir as any).getFileHandle(bareOldName, { create: false });
        const file: File = await oldHandle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());

        // Write with new name
        const newHandle = await (dir as any).getFileHandle(newName, { create: true });
        const writable = await newHandle.createWritable();
        await writable.write(bytes);
        await writable.close();

        // Delete old file
        await (dir as any).removeEntry(bareOldName);
        return true;
      } catch { /* file not in this dir */ }
    }
    return false;
  }
}
