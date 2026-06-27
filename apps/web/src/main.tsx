import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { useBranding } from "./lib/branding.js";
import "./index.css";

// Apply CMS branding (colors/name/logo) as early as possible.
void useBranding.getState().load();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
