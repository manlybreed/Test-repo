import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Opens the native macOS "Choose Folder" dialog and returns the absolute POSIX path.
 * Returns null if the user cancels.
 */
export async function chooseFolderDialog(
  prompt = "Select PM KUSUM plant folder",
): Promise<string | null> {
  if (process.platform !== "darwin") {
    throw new Error("Folder picker requires macOS (this app runs on your Mac).");
  }

  const script = `try
  set theFolder to choose folder with prompt ${JSON.stringify(prompt)}
  return POSIX path of theFolder
on error number -128
  return ""
end try`;

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    });
    const raw = (stdout || "").trim();
    if (!raw) return null;
    // AppleScript POSIX path usually ends with /
    return path.resolve(raw.replace(/\/+$/, "") || "/");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/user canceled|-128/i.test(msg)) return null;
    throw new Error(`Could not open folder picker: ${msg}`);
  }
}

export function folderDisplayName(folderPath: string): string {
  return path.basename(folderPath) || folderPath;
}
