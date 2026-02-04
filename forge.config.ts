import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    afterCopy: [
      (buildPath, _electronVersion, _platform, _arch, callback) => {
        // Install production dependencies so externalized modules are available at runtime
        const pkgSrc = path.resolve(__dirname, "package.json");
        const pkgDst = path.join(buildPath, "package.json");
        fs.copyFileSync(pkgSrc, pkgDst);
        execFileSync("npm", ["install", "--omit=dev", "--no-package-lock"], {
          cwd: buildPath,
          stdio: "inherit",
          shell: true,
        });
        callback();
      },
    ],
  },
  rebuildConfig: {},
  makers: [new MakerSquirrel({}), new MakerZIP({})],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
