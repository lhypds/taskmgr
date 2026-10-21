import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Home from "@pages/Home";
import Login from "@pages/Login";
import { Toast } from "@ui";
import { AuthProvider, useAuth } from "@store";

// The task pages only mount once someone is logged in: they load the spaces on mount, and
// without a session that request would be refused anyway.
function Gate() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Login />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/w/:work" element={<Home />} />
        <Route path="/w/:work/:repository" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
      <Toast />
    </AuthProvider>
  );
}
