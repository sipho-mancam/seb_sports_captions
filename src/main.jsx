import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppFlowProvider } from "./context/AppFlowContext";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppFlowProvider>
        <App />
      </AppFlowProvider>
    </BrowserRouter>
  </React.StrictMode>
);
