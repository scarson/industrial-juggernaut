// ABOUTME: Entry point for the Industrial Juggernaut SPA; mounts App into #root.
// ABOUTME: No engine imports here — App is the sole composition root for the client.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./design/typography.css";
import "./design/choreography.css";
import "./design/landing.css";
import { App } from "./app/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("root element not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
