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

export async function isFsAccessSupported(): Promise<boolean> {
  return "showDirectoryPicker" in window;
}

export class DesktopFolderConnector {
  private handle: FileSystemDirectoryHandle | null = null;

  async requestFolder(): Promise<string | null> {
    if (!(await isFsAccessSupported())) return null;
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
    // Skip queryPermission — requestPermission auto-grants if already allowed
    // (no dialog shown) and calls the permission dialog if not. Going straight
    // to requestPermission avoids one extra IPC round-trip that could consume
    // the browser's user-activation window before the dialog is triggered.
    const h = this.handle ?? await loadHandle();
    if (!h) return false;
    try {
      const status = await (h as any).requestPermission({ mode: "readwrite" });
      if (status === "granted") { this.handle = h; return true; }
    } catch (err) {
      console.error("[jInvoice] restoreFolder permission error:", err);
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
        if (!file.name.toLowerCase().endsWith(".pdf")) continue;

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
    if (!this.handle) return false;
    try {
      const targetDir = subfolder
        ? await (this.handle as any).getDirectoryHandle(subfolder, { create: true })
        : this.handle;
      const fileHandle = await (targetDir as any).getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch (err) {
      console.error("[jInvoice] saveInvoiceToFolder failed:", err);
      return false;
    }
  }
}
