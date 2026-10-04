// Minimal app chrome (E12-lite). The Edit menu is functional, not decor:
// without it macOS disables Cmd+V/Cmd+X in the transcript box and BYOK
// field. DevTools stay dev-only.

import type { MenuItemConstructorOptions } from "electron";
import { electron } from "./electron";

const { app, Menu } = electron;

export function installMenu(): void {
  const viewSubmenu: MenuItemConstructorOptions[] = [{ role: "reload" }];
  if (!app.isPackaged) viewSubmenu.push({ role: "toggleDevTools" });
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { label: "View", submenu: viewSubmenu },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
