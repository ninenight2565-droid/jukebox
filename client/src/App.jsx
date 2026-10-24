import React, { useState, useEffect } from "react";
import PlayerPage from "./pages/PlayerPage";
import AdminPage from "./pages/AdminPage";
import UserPage from "./pages/UserPage";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (path === "/player") return <PlayerPage />;
  if (path === "/admin") return <AdminPage />;
  return <UserPage />;
}
