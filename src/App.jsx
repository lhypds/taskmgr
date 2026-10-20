import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Spaces from "@pages/Spaces";
import Tasks from "@pages/Tasks";
import { Toast } from "@ui";

export default function App() {
  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Spaces />} />
          <Route path="/w/:work" element={<Tasks />} />
          <Route path="/w/:work/:project" element={<Tasks />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toast />
    </>
  );
}
