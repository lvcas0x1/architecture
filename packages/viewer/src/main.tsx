import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { BundleError, loadBundle } from "./bundle.js";
import "./styles.css";

function renderError(container: HTMLElement, message: string): void {
  container.textContent = "";
  const box = document.createElement("div");
  box.style.cssText =
    "padding:24px;font:14px system-ui,sans-serif;color:#c0504d;line-height:1.7";
  box.textContent = `Cannot render the diagram: ${message}`;
  container.append(box);
}

function boot(): void {
  const container = document.getElementById("arch-root");
  if (!container) {
    console.error("#arch-root was not found.");
    return;
  }
  try {
    createRoot(container).render(<App bundle={loadBundle()} />);
  } catch (err) {
    renderError(
      container,
      err instanceof BundleError || err instanceof Error ? err.message : String(err),
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
