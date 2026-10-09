import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applySavedTheme } from "./game/ThemeToggle";

applySavedTheme();

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
