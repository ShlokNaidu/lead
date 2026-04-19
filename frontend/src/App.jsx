import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import Navbar from "./components/Navbar.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import LeadDetail from "./pages/LeadDetail.jsx";
import RunPipeline from "./pages/RunPipeline.jsx";

function App() {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/pipeline" element={<RunPipeline />} />
          <Route path="/lead/:id" element={<LeadDetail />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
