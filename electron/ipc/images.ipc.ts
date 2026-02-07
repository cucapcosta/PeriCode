import { ipcMain, dialog, clipboard, nativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const ALLOWED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

export interface ImageAttachment {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64Thumbnail: string;
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

export function registerImageHandlers(): void {
  ipcMain.handle(
    "image:pick",
    async (): Promise<ImageAttachment[] | null> => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Images",
            extensions: ALLOWED_IMAGE_EXTENSIONS.map((e) => e.slice(1)),
          },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const attachments: ImageAttachment[] = [];

      for (const filePath of result.filePaths) {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_IMAGE_SIZE) continue;

        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) continue;

        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString("base64");
        const mimeType = getMimeType(ext);

        attachments.push({
          filePath,
          fileName: path.basename(filePath),
          mimeType,
          sizeBytes: stat.size,
          base64Thumbnail: `data:${mimeType};base64,${base64}`,
        });
      }

      return attachments.length > 0 ? attachments : null;
    }
  );

  ipcMain.handle(
    "image:readBase64",
    async (_event, filePath: string): Promise<string | null> => {
      try {
        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) return null;

        const stat = fs.statSync(filePath);
        if (stat.size > MAX_IMAGE_SIZE) return null;

        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString("base64");
        const mimeType = getMimeType(ext);
        return `data:${mimeType};base64,${base64}`;
      } catch {
        return null;
      }
    }
  );

  ipcMain.handle(
    "image:validatePath",
    async (_event, filePath: string): Promise<boolean> => {
      try {
        const ext = path.extname(filePath).toLowerCase();
        if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) return false;

        const stat = fs.statSync(filePath);
        return stat.isFile() && stat.size <= MAX_IMAGE_SIZE;
      } catch {
        return false;
      }
    }
  );

  ipcMain.handle(
    "image:saveFromClipboard",
    async (): Promise<ImageAttachment | null> => {
      try {
        const image = clipboard.readImage();
        if (image.isEmpty()) return null;

        const pngBuffer = image.toPNG();
        if (pngBuffer.length === 0 || pngBuffer.length > MAX_IMAGE_SIZE) return null;

        // Save to temp directory
        const tempDir = os.tmpdir();
        const fileName = `clipboard-${Date.now()}.png`;
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, pngBuffer);

        const base64 = pngBuffer.toString("base64");
        return {
          filePath,
          fileName,
          mimeType: "image/png",
          sizeBytes: pngBuffer.length,
          base64Thumbnail: `data:image/png;base64,${base64}`,
        };
      } catch {
        return null;
      }
    }
  );

  // Save image from base64 data URL (used when pasting from renderer clipboard)
  ipcMain.handle(
    "image:saveFromBase64",
    async (_event, dataUrl: string, mimeType: string): Promise<ImageAttachment | null> => {
      try {
        // Extract base64 data from data URL
        const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches) return null;

        const actualMimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");

        if (buffer.length === 0 || buffer.length > MAX_IMAGE_SIZE) return null;

        // Determine file extension from mime type
        const extMap: Record<string, string> = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/gif": ".gif",
          "image/webp": ".webp",
          "image/bmp": ".bmp",
        };
        const ext = extMap[actualMimeType] || extMap[mimeType] || ".png";

        // Save to temp directory
        const tempDir = os.tmpdir();
        const fileName = `clipboard-${Date.now()}${ext}`;
        const filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, buffer);

        return {
          filePath,
          fileName,
          mimeType: actualMimeType || mimeType,
          sizeBytes: buffer.length,
          base64Thumbnail: dataUrl,
        };
      } catch {
        return null;
      }
    }
  );
}
