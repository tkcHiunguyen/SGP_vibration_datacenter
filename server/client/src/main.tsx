import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppVersionWatcher } from "./app/components/AppVersionWatcher";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppVersionWatcher />
    <App />
  </StrictMode>,
);
